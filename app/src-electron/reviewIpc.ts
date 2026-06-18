/**
 * Review IPC runtime (AIREV-003 / Epic 6 §8).
 *
 * Wires the AIREV-001 structured-output review builder and the AIREV-002
 * `match_reviews` persistence into the renderer via two IPC channels:
 *
 *   review:generate(sourceId) — reads the saved OpenRouter key + selected
 *     default model (Epic 2), the job's full extracted description (Epic 3
 *     jobs), and the user's CV text + Profile (Epic 4); runs the single
 *     structured-output call via `generateMatchReview`; persists the
 *     resulting narrative via the match-reviews store; returns the persisted
 *     review (with the stale flag).
 *
 *   review:get(sourceId) — returns the cached narrative review for a job
 *     (with the stale flag), or null if none.
 *
 * Both handlers return a TAGGED-UNION result with stable error codes so the
 * renderer can branch on `code` without parsing exception messages:
 *
 *   NO_API_KEY        — Epic 2 key missing or empty (FR-001 / FR-005)
 *   NO_DEFAULT_MODEL  — no preferred model marked default (FR-001)
 *   NO_CV             — no CV uploaded yet (Epic 4 prerequisite)
 *   JOB_NOT_FOUND     — sourceId does not match a known job
 *   MODEL_NOT_CAPABLE — selected model rejects function calling (FR-006 /
 *                       NFR-004); distinct from a generic LLM_ERROR
 *   LLM_ERROR         — network / auth / rate-limit / model error
 *   SCHEMA_ERROR      — model emitted output the Zod schema rejected
 *
 * The handlers NEVER throw raw errors across the IPC boundary — every failure
 * resolves to `{ ok: false, code, error }`.
 *
 * Mark-stale hooks (AC4 / FR-004):
 *  - `markAllReviewsStale(store, jobsStore)` flips every cached review stale
 *    when the CV or Profile changes. The narrative blob is preserved (the UI
 *    can still render the previous review with a "regenerate" affordance).
 *  - `markReviewStale(store, sourceId)` flips one review stale when its job
 *    has been re-extracted.
 *
 * Strict-separation guarantees (AC6 / NFR-001 / NFR-002):
 *  - This module never imports / reads / writes the Epic 5 deterministic
 *    score store (strict separation — never joined into a single rating).
 *  - This module opens no egress of its own — the only network reach is the
 *    OpenRouter call made by `matchReview.ts` (reusing the Epic 2 sanctioned
 *    egress).
 */
import type { IpcMain } from 'electron';

import type { CvStore } from './cv';
import type { JobsStore } from './jobs';
import type {
  MatchReviewLLM,
  MatchReview as GeneratedReview,
} from './matchReview';
import { generateMatchReview } from './matchReview';
import type { MatchReviewsStore, PersistedMatchReview } from './matchReviews';
import type { ProfileRecord } from './profile';

export type ReviewErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'NO_CV'
  | 'JOB_NOT_FOUND'
  | 'MODEL_NOT_CAPABLE'
  | 'LLM_ERROR'
  | 'SCHEMA_ERROR';

export type ReviewGenerateResult =
  | { ok: true; review: PersistedMatchReview }
  | { ok: false; code: ReviewErrorCode; error: string };

export type ReviewGetResult = PersistedMatchReview | null;

export interface ReviewIpcDeps {
  store: MatchReviewsStore;
  jobsStore: JobsStore;
  cvStore: CvStore;
  /** Pulled per call so the freshest Profile is sent (CV upload, edit, etc.). */
  getProfile: () => ProfileRecord;
  /** Decrypted OpenRouter key from the Epic 2 store, or null. */
  getApiKey: () => string | null;
  /** The user's selected default model slug (Epic 2), or null. */
  getDefaultModel: () => string | null;
  /** Build the OpenRouter-backed structured-output LLM. Injected so tests can
   *  drive the call without network access. */
  buildLlm: (input: { apiKey: string; model: string }) => Promise<MatchReviewLLM>;
  /** Injectable for deterministic timestamps in tests. */
  now?: () => number;
}

/**
 * Mark every cached review stale (CV / Profile change). We do NOT delete the
 * narrative blob — the UI can still render the prior review with a
 * "regenerate" affordance.
 *
 * Implementation note: the AIREV-002 store exposes a per-sourceId markStale,
 * so we iterate the known job sourceIds and call markStale for each. Calls
 * for jobs without a cached review are no-ops by construction (AIREV-002 AC4).
 */
export function markAllReviewsStale(
  store: MatchReviewsStore,
  jobsStore: JobsStore,
): void {
  for (const id of jobsStore.knownSourceIds()) {
    store.markStale(id);
  }
}

/** Mark one cached review stale (per-job re-extract). No-op if no row. */
export function markReviewStale(
  store: MatchReviewsStore,
  sourceId: string,
): void {
  store.markStale(sourceId);
}

function pickLatestCvText(cvStore: CvStore): string | null {
  const list = cvStore.list();
  if (!list.length) return null;
  // CvStore.list is sorted by version DESC — the newest CV wins.
  const latest = list[0];
  const text = (latest?.parsedText ?? '').trim();
  return text || null;
}

function profileToReviewProfile(
  p: ProfileRecord,
): import('./matchReview').ReviewProfile {
  return {
    name: p.name,
    targetRole: p.targetRole,
    yearsExperience: p.yearsExperience,
    skills: p.skills,
    location: p.location,
    workMode: p.workMode,
    links: p.links,
    linkedinUrl: p.linkedinUrl,
  };
}

/**
 * Register the `review:generate` and `review:get` IPC handlers.
 *
 * Each handler is `async` so even though SQLite is synchronous the IPC call
 * yields to the event loop and the renderer's UI thread is never blocked.
 * Every failure path resolves to a tagged `{ ok: false, code, error }` —
 * raw errors NEVER cross the IPC boundary.
 */
export function registerReviewIpc(ipcMain: IpcMain, deps: ReviewIpcDeps): void {
  ipcMain.handle(
    'review:get',
    async (_event, sourceId: string): Promise<ReviewGetResult> => {
      if (typeof sourceId !== 'string' || !sourceId) return null;
      return deps.store.get(sourceId) ?? null;
    },
  );

  ipcMain.handle(
    'review:generate',
    async (_event, sourceId: string): Promise<ReviewGenerateResult> => {
      try {
        // --- Pre-flight: keys / model / job / CV --------------------------
        const apiKey = (deps.getApiKey() ?? '').trim();
        if (!apiKey) {
          return {
            ok: false,
            code: 'NO_API_KEY',
            error:
              'No OpenRouter API key configured. Add one under Settings → Connect an AI provider.',
          };
        }
        const model = (deps.getDefaultModel() ?? '').trim();
        if (!model) {
          return {
            ok: false,
            code: 'NO_DEFAULT_MODEL',
            error:
              'No default model configured. Pick a default under Settings → Preferred models.',
          };
        }
        if (typeof sourceId !== 'string' || !sourceId) {
          return {
            ok: false,
            code: 'JOB_NOT_FOUND',
            error: 'review:generate requires a non-empty sourceId.',
          };
        }
        const job = deps.jobsStore.listJobs().find((j) => j.sourceId === sourceId);
        if (!job) {
          return {
            ok: false,
            code: 'JOB_NOT_FOUND',
            error: `No job found for sourceId "${sourceId}".`,
          };
        }
        const cvText = pickLatestCvText(deps.cvStore);
        if (!cvText) {
          return {
            ok: false,
            code: 'NO_CV',
            error: 'No CV uploaded yet. Add a CV under Profile to enable AI Match Review.',
          };
        }

        // --- The one structured-output call -------------------------------
        const llm = await deps.buildLlm({ apiKey, model });
        const generated = await generateMatchReview({
          llm,
          inputs: {
            sourceId,
            jobDescription: job.description ?? '',
            cvText,
            profile: profileToReviewProfile(deps.getProfile()),
          },
          modelSlug: model,
          ...(deps.now ? { now: deps.now } : {}),
        });
        if (!generated.ok) {
          // generateMatchReview already returns stable codes — pass through.
          return { ok: false, code: generated.code, error: generated.error };
        }

        // --- Persist + return ---------------------------------------------
        const persisted: PersistedMatchReview = toPersisted(generated.review);
        deps.store.upsert(persisted);
        return { ok: true, review: persisted };
      } catch (err) {
        // Defence in depth — every failure crosses the IPC boundary as a
        // tagged result, never a raw thrown error (AC2).
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, code: 'LLM_ERROR', error: message };
      }
    },
  );
}

function toPersisted(review: GeneratedReview): PersistedMatchReview {
  const out: PersistedMatchReview = {
    sourceId: review.sourceId,
    requirements: review.requirements,
    gaps: review.gaps,
    strengths: review.strengths,
    keywords: review.keywords,
    summary: review.summary,
    stale: false,
  };
  if (review.archetype !== undefined) out.archetype = review.archetype;
  if (review.modelSlug !== undefined) out.modelSlug = review.modelSlug;
  if (review.generatedAt !== undefined) out.generatedAt = review.generatedAt;
  return out;
}

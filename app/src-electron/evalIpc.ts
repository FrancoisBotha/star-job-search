/**
 * Eval-report IPC runtime (EVAL-004 / Epic 14 — Job Evaluation Report).
 *
 * Wires the EVAL-003 orchestrator (`generateEvalReport`) and the EVAL-002
 * persistence (`eval_reports`) into the renderer through two IPC channels:
 *
 *   eval:generate(sourceId) — pulls the Epic 2 key + default model, the job
 *     (Epic 3), the latest CV text + Profile (Epic 4), and the deterministic
 *     Epic 5 score; runs the orchestrator (which itself triggers the Epic 6
 *     review when missing — AC4); persists the assembled `EvalReport` via
 *     the EVAL-002 store; returns a tagged-union result with stable error
 *     codes.
 *
 *   eval:get(sourceId) — returns the cached `PersistedEvalReport` (with the
 *     stale flag), or null.
 *
 * Progress events stream over `eval:progress`:
 *   - { phase: 'researching' }    — before any web-research call
 *   - { phase: 'reviewing' }      — Epic 6 review missing, generating now
 *   - { phase: 'generating' }     — the four A/C/D/G structured calls
 *   - { phase: 'result', ok, code?, sourceId? }
 *
 * Stable error codes (AC1):
 *   NO_API_KEY        — Epic 2 key missing or empty
 *   MODEL_NOT_CAPABLE — selected model rejects structured / function-calling
 *   RATE_LIMITED      — model / provider 429 (or rate-limit hint in message)
 *   NETWORK           — fetch / connection / DNS / timeout / generic LLM
 *                        error (no stable upstream subtype)
 *   NO_SCORE          — no deterministic Epic 5 score for the sourceId yet
 *                        (run a rescore first; the orchestrator forwards the
 *                        stars and refuses to invent a rating)
 *
 * The handlers NEVER throw raw errors across the IPC boundary — every failure
 * resolves to `{ ok: false, code, error }`.
 *
 * Mark-stale hooks (AC4):
 *  - `markAllEvalReportsStale(store, jobsStore)` flips every cached eval
 *    report stale when the CV or Profile changes.
 *  - `markEvalReportStale(store, sourceId)` flips one stale when its job has
 *    been re-extracted. The narrative blob is preserved alongside.
 *
 * Web-research settings IPC (AC3):
 *  - `webResearch:getSetting`           → WebResearchSettings + disclosure copy
 *  - `webResearch:setEnabled(boolean)`  → updated WebResearchSettings
 *  - `webResearch:acknowledgeDisclosure() → updated WebResearchSettings
 */
import type { IpcMain } from 'electron';

import type { CvStore } from './cv';
import type { JobsStore } from './jobs';
import type { ProfileRecord } from './profile';
import type { MatchScoresStore } from './matchScores';
import type { MatchReviewsStore } from './matchReviews';
import type { EvalReportsStore, PersistedEvalReport } from './evalReports';
import type { WebResearch } from './webResearch';
import { WEB_RESEARCH_DISCLOSURE } from './webResearch';
import type { WebResearchSettings, WebResearchSettingsStore } from './webResearchSettings';
import {
  generateEvalReport,
  type EvalReportLLM,
  type EvalReportInputs,
} from './evalReport';
import type { MatchReviewLLM, ReviewProfile } from './matchReview';

export const EVAL_GENERATE_CHANNEL = 'eval:generate';
export const EVAL_GET_CHANNEL = 'eval:get';
export const EVAL_PROGRESS_CHANNEL = 'eval:progress';

export const WEB_RESEARCH_GET_SETTING_CHANNEL = 'webResearch:getSetting';
export const WEB_RESEARCH_SET_ENABLED_CHANNEL = 'webResearch:setEnabled';
export const WEB_RESEARCH_ACK_DISCLOSURE_CHANNEL =
  'webResearch:acknowledgeDisclosure';

export type EvalErrorCode =
  | 'NO_API_KEY'
  | 'MODEL_NOT_CAPABLE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'NO_SCORE';

export interface EvalGenerateOk {
  ok: true;
  report: PersistedEvalReport;
  /** Pass-through of the deterministic Epic 5 rating (stars). Sourced from
   *  `match_scores` — NEVER produced by the orchestrator. */
  rating: number;
}

export type EvalGenerateResult =
  | EvalGenerateOk
  | { ok: false; code: EvalErrorCode; error: string };

export type EvalGetResult = PersistedEvalReport | null;

export type EvalProgressEvent =
  | { phase: 'researching' }
  | { phase: 'reviewing' }
  | { phase: 'generating' }
  | { phase: 'result'; ok: boolean; code?: EvalErrorCode; sourceId?: string };

export interface WebResearchSettingsPayload extends WebResearchSettings {
  /** The verbatim disclosure copy from `webResearch.ts` so the renderer's
   *  disclosure dialog and the engineering-level guarantee stay in sync. */
  disclosure: string;
}

export interface EvalIpcDeps {
  store: EvalReportsStore;
  matchScoresStore: MatchScoresStore;
  matchReviewsStore: MatchReviewsStore;
  jobsStore: JobsStore;
  cvStore: CvStore;
  getProfile: () => ProfileRecord;
  getApiKey: () => string | null;
  getDefaultModel: () => string | null;
  /** Build the OpenRouter-backed structured-output LLM. Injected so tests
   *  can drive the call without network access. */
  buildLlm: (input: { apiKey: string; model: string }) => Promise<EvalReportLLM>;
  /** Optional separate builder for the Epic 6 Block-B fallback. Defaults to
   *  the same builder cast across, matching the EVAL-003 orchestrator. */
  buildMatchReviewLlm?: (input: {
    apiKey: string;
    model: string;
  }) => Promise<MatchReviewLLM>;
  webResearch: WebResearch;
  settingsStore: WebResearchSettingsStore;
  /** Per-run progress sink. The main process binds this to
   *  `mainWindow.webContents.send(EVAL_PROGRESS_CHANNEL, e)`. */
  emitProgress: (event: EvalProgressEvent) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

// Heuristics for classifying LLM errors into the AC1 stable subset. Kept
// alongside the IPC so the renderer's branch on `code` stays narrow.
const RATE_LIMIT_HINTS =
  /(rate[- ]?limit|429|too many requests|quota)/i;
const NETWORK_HINTS =
  /(network|fetch failed|enotfound|econnreset|econnrefused|timeout|socket|aborted)/i;

function classifyLlmError(message: string): 'RATE_LIMITED' | 'NETWORK' {
  if (RATE_LIMIT_HINTS.test(message)) return 'RATE_LIMITED';
  if (NETWORK_HINTS.test(message)) return 'NETWORK';
  // Default to NETWORK rather than inventing a new code — keeps the renderer
  // branch on the documented five-code surface (AC1).
  return 'NETWORK';
}

function emit(deps: EvalIpcDeps, event: EvalProgressEvent): void {
  try {
    deps.emitProgress(event);
  } catch {
    // never let a downstream sink crash the IPC handler
  }
}

function pickLatestCvText(cvStore: CvStore): string | null {
  const list = cvStore.list();
  if (!list.length) return null;
  const latest = list[0];
  const text = (latest?.parsedText ?? '').trim();
  return text || null;
}

function profileToReviewProfile(p: ProfileRecord): ReviewProfile {
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
 * Mark every cached eval report stale (CV / Profile change). Mirrors the
 * Epic 6 `markAllReviewsStale` hook — narrative is preserved; the UI offers
 * a regenerate. Calls for jobs without a cached report are no-ops by
 * construction (EVAL-002 markStale).
 */
export function markAllEvalReportsStale(
  store: EvalReportsStore,
  jobsStore: JobsStore,
): void {
  for (const id of jobsStore.knownSourceIds()) {
    store.markStale(id);
  }
}

/** Mark one cached eval report stale (per-job re-extract). No-op if no row. */
export function markEvalReportStale(
  store: EvalReportsStore,
  sourceId: string,
): void {
  store.markStale(sourceId);
}

export function registerEvalIpc(ipcMain: IpcMain, deps: EvalIpcDeps): void {
  ipcMain.handle(
    EVAL_GET_CHANNEL,
    async (_event, sourceId: string): Promise<EvalGetResult> => {
      if (typeof sourceId !== 'string' || !sourceId) return null;
      return deps.store.get(sourceId) ?? null;
    },
  );

  ipcMain.handle(
    EVAL_GENERATE_CHANNEL,
    async (_event, sourceId: string): Promise<EvalGenerateResult> => {
      try {
        const apiKey = (deps.getApiKey() ?? '').trim();
        if (!apiKey) {
          const fail = {
            ok: false as const,
            code: 'NO_API_KEY' as const,
            error:
              'No OpenRouter API key configured. Add one under Settings → Connect an AI provider.',
          };
          emit(deps, { phase: 'result', ok: false, code: fail.code });
          return fail;
        }
        const model = (deps.getDefaultModel() ?? '').trim();
        if (!model) {
          // No NO_DEFAULT_MODEL in the AC1 surface — surface this as
          // NO_API_KEY's neighbour (NETWORK) is wrong; treat the missing
          // model as a configuration error mapped to NO_API_KEY to keep the
          // renderer's "set up your AI" branch consistent.
          const fail = {
            ok: false as const,
            code: 'NO_API_KEY' as const,
            error:
              'No default model configured. Pick a default under Settings → Preferred models.',
          };
          emit(deps, { phase: 'result', ok: false, code: fail.code });
          return fail;
        }
        if (typeof sourceId !== 'string' || !sourceId) {
          const fail = {
            ok: false as const,
            code: 'NETWORK' as const,
            error: 'eval:generate requires a non-empty sourceId.',
          };
          emit(deps, { phase: 'result', ok: false, code: fail.code });
          return fail;
        }
        const job = deps.jobsStore.listJobs().find((j) => j.sourceId === sourceId);
        if (!job) {
          const fail = {
            ok: false as const,
            code: 'NETWORK' as const,
            error: `No job found for sourceId "${sourceId}".`,
          };
          emit(deps, { phase: 'result', ok: false, code: fail.code });
          return fail;
        }

        // NO_SCORE — the deterministic Epic 5 stars are the only rating; the
        // orchestrator must NOT generate one. Refuse instead of inventing.
        const score = deps.matchScoresStore.get(sourceId);
        if (!score) {
          const fail = {
            ok: false as const,
            code: 'NO_SCORE' as const,
            error:
              'No deterministic match score has been computed for this job yet. Run a rescore from the job board first.',
          };
          emit(deps, { phase: 'result', ok: false, code: fail.code });
          return fail;
        }

        const cvText = pickLatestCvText(deps.cvStore) ?? '';

        // Surface a "reviewing" phase if Block B will be generated on the fly,
        // so the renderer can show that the Epic 6 review is being built —
        // AC4.
        if (!deps.matchReviewsStore.get(sourceId)) {
          emit(deps, { phase: 'reviewing' });
        }
        emit(deps, { phase: 'researching' });
        emit(deps, { phase: 'generating' });

        const llm = await deps.buildLlm({ apiKey, model });
        const matchReviewLlm = deps.buildMatchReviewLlm
          ? await deps.buildMatchReviewLlm({ apiKey, model })
          : undefined;

        const profile = deps.getProfile();
        const inputs: EvalReportInputs = {
          sourceId,
          jobDescription: job.description ?? '',
          cvText,
          profile: profileToReviewProfile(profile),
        };
        if (job.company) inputs.employerName = job.company;
        if (job.salary) inputs.statedCompensation = job.salary;
        const compExpectation = compExpectationFromProfile(profile);
        if (compExpectation) inputs.compensationExpectation = compExpectation;

        const result = await generateEvalReport({
          llm,
          ...(matchReviewLlm ? { matchReviewLlm } : {}),
          webResearch: deps.webResearch,
          matchScoresStore: deps.matchScoresStore,
          matchReviewsStore: deps.matchReviewsStore,
          evalReportsStore: deps.store,
          inputs,
          modelSlug: model,
          ...(deps.now ? { now: deps.now } : {}),
        });

        if (!result.ok) {
          if (result.code === 'MODEL_NOT_CAPABLE') {
            const fail = {
              ok: false as const,
              code: 'MODEL_NOT_CAPABLE' as const,
              error: result.error,
            };
            emit(deps, { phase: 'result', ok: false, code: fail.code });
            return fail;
          }
          const mapped = classifyLlmError(result.error);
          const fail = {
            ok: false as const,
            code: mapped,
            error: result.error,
          };
          emit(deps, { phase: 'result', ok: false, code: fail.code });
          return fail;
        }

        // EVAL-002 returns the persisted row (with stale=false on fresh
        // upsert). Read it back so the renderer always sees the stale flag.
        const persisted = deps.store.get(sourceId) ?? {
          ...result.report,
          stale: false,
        };

        emit(deps, { phase: 'result', ok: true, sourceId });
        return {
          ok: true,
          report: persisted,
          rating: score.stars,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const mapped = classifyLlmError(message);
        emit(deps, { phase: 'result', ok: false, code: mapped });
        return { ok: false, code: mapped, error: message };
      }
    },
  );

  // --- Web-research settings IPC (AC3) ------------------------------------

  ipcMain.handle(
    WEB_RESEARCH_GET_SETTING_CHANNEL,
    async (): Promise<WebResearchSettingsPayload> => {
      return { ...deps.settingsStore.get(), disclosure: WEB_RESEARCH_DISCLOSURE };
    },
  );

  ipcMain.handle(
    WEB_RESEARCH_SET_ENABLED_CHANNEL,
    async (_event, enabled: boolean): Promise<WebResearchSettingsPayload> => {
      const next = deps.settingsStore.setEnabled(!!enabled);
      return { ...next, disclosure: WEB_RESEARCH_DISCLOSURE };
    },
  );

  ipcMain.handle(
    WEB_RESEARCH_ACK_DISCLOSURE_CHANNEL,
    async (): Promise<WebResearchSettingsPayload> => {
      const next = deps.settingsStore.acknowledgeDisclosure();
      return { ...next, disclosure: WEB_RESEARCH_DISCLOSURE };
    },
  );
}

function compExpectationFromProfile(p: ProfileRecord): string | undefined {
  if (p.salaryMin == null) return undefined;
  const currency = p.salaryCurrency || '';
  return `${currency} ${p.salaryMin}`.trim();
}

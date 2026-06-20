/**
 * Tailor Engine IPC runtime (TDE-006 — Epic 9: Tailoring Diff Engine).
 *
 * Wires the TDE-005 `runTailorEngine` (LangGraph pipeline) and the TDE-002
 * deterministic `apply()` gates into the renderer via two IPC channels:
 *
 *   tailor:propose({ sourceId }) — reads the Epic 2 saved key + default
 *     model, the JD (Epic 3 jobs), the latest CV's parsed text + structured
 *     fields (Epic 4), the user Profile, and the cached Epic 6 review's
 *     keywords when present; builds a TailoringDocument; runs the engine;
 *     forwards per-node progress events through the injected `emitProgress`
 *     sink (the main process binds it to `webContents.send` on the progress
 *     channel); returns the engine's full `TailorEngineResult`. PERSISTS
 *     NOTHING — the renderer carries the proposed document until the user
 *     chooses what to apply.
 *
 *   tailor:apply({ sourceId, doc, accepted, verifiedSkills? }) — takes the
 *     user-accepted ProposedChange[] subset, applies it DETERMINISTICALLY
 *     through `tailorGates.apply()` (no LLM), renders the resulting
 *     TailoringDocument to Markdown, persists the final draft via the Epic 7
 *     `tailored_docs` store, and triggers the Epic 5 deterministic rescore
 *     (FR-012 / NFR-002 hard boundary). NEVER calls the LLM.
 *
 * Both handlers return a TAGGED-UNION result with stable error codes so the
 * renderer can branch on `code`:
 *
 *   NO_API_KEY        — Epic 2 key missing / empty
 *   NO_DEFAULT_MODEL  — no preferred model marked default
 *   NO_DOC            — sourceId unknown / no CV uploaded / no parsed fields
 *   MODEL_NOT_CAPABLE — selected model rejects function calling
 *   RATE_LIMITED      — HTTP 429 / rate-limited responses
 *   NETWORK           — fetch / ECONN / DNS failures
 *   LLM_ERROR         — generic model error
 *   SCHEMA_ERROR      — model emitted output the Zod schema rejected
 *
 * Handlers NEVER throw raw errors across the IPC boundary — every failure
 * resolves to `{ ok: false, code, error }`.
 */
import type { IpcMain } from 'electron';

import type { CvStore, CvRecord } from './cv';
import type { CvParsedFields } from './cvStructurer';
import type { JobsStore } from './jobs';
import type { MatchReviewsStore } from './matchReviews';
import type { ProfileRecord } from './profile';
import type { ScoringListing, ScoringProfile } from './scorer';
import {
  runTailorEngine,
  type TailorEngineEvent,
  type TailorEngineResult,
  type TailorLLM,
} from './tailorEngine';
import { apply, type ProposedChange } from './tailorGates';
import {
  buildTailoringDocument,
  type TailoringDocument,
} from './tailoringDocument';
import type { TailoredDoc, TailoredDocsStore } from './tailoredDocs';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TailorEngineErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'NO_DOC'
  | 'MODEL_NOT_CAPABLE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'LLM_ERROR'
  | 'SCHEMA_ERROR';

export interface TailorProposeInput {
  sourceId: string;
}

export type TailorProposeResult =
  | { ok: true; result: TailorEngineResult }
  | { ok: false; code: TailorEngineErrorCode; error: string };

export interface TailorApplyInput {
  sourceId: string;
  doc: TailoringDocument;
  accepted: ProposedChange[];
  /** Optional verified-skill allowlist (e.g. echoed from the propose result's
   *  `skillVerdicts`) so `add_skill` actions clear the verifier gate. */
  verifiedSkills?: string[];
}

export type TailorApplyResult =
  | { ok: true; doc: TailoredDoc; scored: number }
  | { ok: false; code: TailorEngineErrorCode; error: string };

export const TAILOR_ENGINE_PROGRESS_CHANNEL = 'tailor-engine:progress';

export interface TailorEngineProgressEvent extends TailorEngineEvent {
  sourceId: string;
}

export interface TailorEngineIpcDeps {
  store: TailoredDocsStore;
  jobsStore: JobsStore;
  cvStore: CvStore;
  reviewsStore: MatchReviewsStore;
  getProfile: () => ProfileRecord;
  getApiKey: () => string | null;
  getDefaultModel: () => string | null;
  buildLlm: (input: { apiKey: string; model: string }) => Promise<TailorLLM>;
  /** Epic 5 deterministic rescore — bound to ScoringRunner.rescoreOne in
   *  electron-main.ts so the engine never touches match_scores directly. */
  rescore: (sourceId: string) => Promise<{ scored: number }>;
  /** Per-node progress sink. The main process binds this to
   *  `mainWindow.webContents.send(TAILOR_ENGINE_PROGRESS_CHANNEL, e)`. */
  emitProgress: (event: TailorEngineProgressEvent) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Error classification (engine code → IPC code)
// ---------------------------------------------------------------------------

const RATE_LIMIT_HINTS = /(429|rate[- ]limit)/i;
const NETWORK_HINTS = /(fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|getaddrinfo)/i;

function classifyMessage(message: string): { code: TailorEngineErrorCode; error: string } {
  if (RATE_LIMIT_HINTS.test(message)) return { code: 'RATE_LIMITED', error: message };
  if (NETWORK_HINTS.test(message)) return { code: 'NETWORK', error: message };
  return { code: 'LLM_ERROR', error: message };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickLatestCv(cvStore: CvStore): CvRecord | null {
  const list = cvStore.list();
  if (!list.length) return null;
  const latest = list[0];
  if (!latest) return null;
  if (!(latest.parsedText ?? '').trim()) return null;
  return latest;
}

function cvParsedFieldsFromRecord(cv: CvRecord): CvParsedFields | null {
  const raw = cv.parsedFields as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const employmentHistory = Array.isArray(raw.employmentHistory)
    ? (raw.employmentHistory as Array<Record<string, unknown>>).map((e) => ({
        company: (e.company ?? null) as string | null,
        role: (e.role ?? null) as string | null,
        startDate: (e.startDate ?? null) as string | null,
        endDate: (e.endDate ?? null) as string | null,
        summary: (e.summary ?? null) as string | null,
      }))
    : [];
  const education = Array.isArray(raw.education)
    ? (raw.education as Array<Record<string, unknown>>).map((e) => ({
        school: (e.school ?? null) as string | null,
        qualification: (e.qualification ?? null) as string | null,
        startDate: (e.startDate ?? null) as string | null,
        endDate: (e.endDate ?? null) as string | null,
      }))
    : [];
  const contact =
    raw.contact && typeof raw.contact === 'object'
      ? {
          email: ((raw.contact as Record<string, unknown>).email ?? null) as string | null,
          phone: ((raw.contact as Record<string, unknown>).phone ?? null) as string | null,
        }
      : { email: null, phone: null };
  return {
    name: (raw.name ?? null) as string | null,
    contact,
    targetRole: (raw.targetRole ?? null) as string | null,
    skills: Array.isArray(raw.skills) ? (raw.skills as string[]).filter((s) => typeof s === 'string') : [],
    employmentHistory,
    education,
    totalYearsExperience:
      typeof raw.totalYearsExperience === 'number' ? (raw.totalYearsExperience as number) : null,
    location: (raw.location ?? null) as string | null,
  };
}

function profileToScoringProfile(p: ProfileRecord): ScoringProfile {
  return {
    skills: p.skills ?? [],
    yearsExperience: p.yearsExperience,
    location: p.location,
    workMode: p.workMode,
    salaryMin: p.salaryMin,
    salaryCurrency: p.salaryCurrency,
  };
}

/** Render the tailored TailoringDocument to a Markdown blob for persistence /
 *  copy / PDF export. Deterministic — same document → same Markdown. */
function renderTailoringDocMarkdown(doc: TailoringDocument): string {
  const lines: string[] = [];
  lines.push('# Tailored CV');
  if (doc.identity.name) {
    lines.push('');
    lines.push(`**${doc.identity.name}**`);
  }
  if (doc.summary) {
    lines.push('');
    lines.push('## Summary');
    lines.push(doc.summary);
  }
  if (doc.skills.length) {
    lines.push('');
    lines.push('## Skills');
    lines.push(doc.skills.join(', '));
  }
  if (doc.experience.length) {
    lines.push('');
    lines.push('## Experience');
    for (const e of doc.experience) {
      const header = [e.role, e.company].filter(Boolean).join(' — ');
      const dates = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      lines.push('');
      lines.push(`### ${header || '(role)'}${dates ? `  (${dates})` : ''}`);
      for (const b of e.bullets) lines.push(`- ${b}`);
    }
  }
  if (doc.projects.length) {
    lines.push('');
    lines.push('## Projects');
    for (const p of doc.projects) {
      lines.push('');
      lines.push(`### ${p.name ?? '(project)'}`);
      for (const b of p.bullets) lines.push(`- ${b}`);
    }
  }
  if (doc.education.length) {
    lines.push('');
    lines.push('## Education');
    for (const ed of doc.education) {
      const header = [ed.qualification, ed.school].filter(Boolean).join(' — ');
      const dates = [ed.startDate, ed.endDate].filter(Boolean).join(' – ');
      lines.push('');
      lines.push(`### ${header || '(qualification)'}${dates ? `  (${dates})` : ''}`);
      if (ed.description) lines.push(ed.description);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerTailorEngineIpc(ipcMain: IpcMain, deps: TailorEngineIpcDeps): void {
  const now = deps.now ?? (() => Date.now());

  ipcMain.handle(
    'tailor:propose',
    async (_event, input: TailorProposeInput): Promise<TailorProposeResult> => {
      try {
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
        if (!input || typeof input.sourceId !== 'string' || !input.sourceId) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'tailor:propose requires a non-empty sourceId.',
          };
        }
        const job = deps.jobsStore
          .listJobs()
          .find((j) => j.sourceId === input.sourceId);
        if (!job) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: `No job found for sourceId "${input.sourceId}".`,
          };
        }
        const cv = pickLatestCv(deps.cvStore);
        if (!cv) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'No CV uploaded yet. Add a CV under Profile to enable tailoring.',
          };
        }
        const parsedFields = cvParsedFieldsFromRecord(cv);
        if (!parsedFields) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'CV has not been structured yet. Re-upload or wait for structuring.',
          };
        }

        const doc = buildTailoringDocument(parsedFields, cv.parsedText ?? '');
        const cachedReview = deps.reviewsStore.get(input.sourceId);
        const jdKeywords = Array.isArray(cachedReview?.keywords)
          ? (cachedReview!.keywords as string[]).filter((s) => typeof s === 'string')
          : [];

        const listing: ScoringListing = {
          sourceId: job.sourceId,
          title: job.title ?? null,
          description: job.description ?? null,
          location: job.location ?? null,
          salary: job.salary ?? null,
        };
        const profile = profileToScoringProfile(deps.getProfile());
        const llm = await deps.buildLlm({ apiKey, model });

        const run = await runTailorEngine(
          {
            jdText: job.description ?? '',
            masterCvText: cv.parsedText ?? '',
            doc,
            listing,
            profile,
            ...(jdKeywords.length ? { jdKeywords } : {}),
          },
          {
            llm,
            onEvent: (e) => {
              try {
                deps.emitProgress({ ...e, sourceId: input.sourceId });
              } catch {
                // never let a downstream sink crash the IPC handler
              }
            },
          },
        );

        if (!run.ok) {
          if (run.code === 'MODEL_NOT_CAPABLE') {
            return { ok: false, code: 'MODEL_NOT_CAPABLE', error: run.error };
          }
          if (run.code === 'MISSING_KEY') {
            return { ok: false, code: 'NO_API_KEY', error: run.error };
          }
          if (run.code === 'SCHEMA_ERROR') {
            return { ok: false, code: 'SCHEMA_ERROR', error: run.error };
          }
          return { ok: false, ...classifyMessage(run.error) };
        }
        return { ok: true, result: run.result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, ...classifyMessage(message) };
      }
    },
  );

  ipcMain.handle(
    'tailor:apply',
    async (_event, input: TailorApplyInput): Promise<TailorApplyResult> => {
      try {
        if (!input || typeof input.sourceId !== 'string' || !input.sourceId) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'tailor:apply requires a non-empty sourceId.',
          };
        }
        if (!input.doc || typeof input.doc !== 'object') {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'tailor:apply requires the working TailoringDocument.',
          };
        }
        const accepted = Array.isArray(input.accepted) ? input.accepted : [];
        const job = deps.jobsStore
          .listJobs()
          .find((j) => j.sourceId === input.sourceId);
        if (!job) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: `No job found for sourceId "${input.sourceId}".`,
          };
        }
        const cv = pickLatestCv(deps.cvStore);
        if (!cv) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'No CV uploaded yet.',
          };
        }

        // Deterministic re-apply — no LLM call (AC4 / FR-012 boundary).
        const applied = apply(input.doc, accepted, {
          ...(input.verifiedSkills ? { verifiedSkills: input.verifiedSkills } : {}),
        });

        const content = renderTailoringDocMarkdown(applied.result);
        const modelSlug = (deps.getDefaultModel() ?? '').trim() || 'unknown';
        const persisted: TailoredDoc = {
          sourceId: input.sourceId,
          kind: 'cv',
          content,
          suggestions: [],
          atsReport: { score: 0, missingKeywords: [] },
          keywords: [],
          intensity: 'light',
          baseCvId: cv.id,
          modelSlug,
          generatedAt: now(),
          stale: false,
        };
        deps.store.upsert(persisted);

        const rescored = await deps.rescore(input.sourceId);
        return { ok: true, doc: persisted, scored: rescored.scored };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, ...classifyMessage(message) };
      }
    },
  );
}

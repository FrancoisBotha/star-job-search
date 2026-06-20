/**
 * CV-Enrichment IPC runtime (ENRICH-005 — Epic 13: CV Enrichment).
 *
 * Wires the four ENRICH-001..004 backend modules into the renderer through
 * four IPC channels:
 *
 *   enrich:analyze()                          — ENRICH-001 weak-bullet analyzer
 *   enrich:questions({ report })              — ENRICH-002 question generator
 *   enrich:propose({ doc, candidates, questions, answers })
 *                                             — ENRICH-003 grounded generator
 *   enrich:apply({ doc, acceptedChanges })    — ENRICH-004 versioned apply
 *
 * Stable error codes (AC2 — mirrors the other feature IPCs):
 *   NO_API_KEY        — Epic 2 key missing / empty
 *   NO_DEFAULT_MODEL  — no preferred model marked default
 *   NO_CV             — no CV uploaded yet (Epic 4 prerequisite)
 *   MODEL_NOT_CAPABLE — selected model rejects structured / function calling
 *   RATE_LIMITED      — provider 429 / rate-limit hint
 *   NETWORK           — fetch / DNS / timeout / generic transport failure
 *   LLM_ERROR         — generic model failure
 *   INVALID_INPUT     — malformed channel payload
 *
 * Handlers NEVER throw raw errors across the IPC boundary — every failure
 * resolves to `{ ok: false, code, error }`.
 *
 * No new egress (AC5): the only LLM calls happen via the injected
 * `buildWeakBulletLlm` / `buildMetricQuestionLlm` / `buildEnrichmentLlm`
 * builders, all of which target the same OpenRouter base URL the rest of
 * the app uses (see `weakBulletAnalyzer.buildWeakBulletLlm`,
 * `metricQuestionGenerator.buildMetricQuestionLlm`). The one-time "what is
 * sent" disclosure from Epic 4 is the renderer's responsibility — it gates
 * the first send across the whole app and is reused here unchanged.
 *
 * Pre-conditions (AC6) are enforced SERVER-SIDE before any LLM builder is
 * invoked: a missing key / model / CV short-circuits to the matching stable
 * error code so the LLM is never called.
 */
import type { IpcMain } from 'electron';

import type { CvRecord, CvStore } from './cv';
import type { CvParsedFields } from './cvStructurer';
import type { ProfileRecord } from './profile';
import type { ProposedChange } from './tailorGates';
import {
  buildTailoringDocument,
  type TailoringDocument,
} from './tailoringDocument';
import {
  analyzeWeakBullets,
  type WeakBulletCandidate,
  type WeakBulletLLM,
  type WeakBulletReport,
} from './weakBulletAnalyzer';
import {
  generateMetricQuestions,
  type MetricAnswer,
  type MetricQuestion,
  type MetricQuestionLLM,
  type MetricQuestionnaire,
} from './metricQuestionGenerator';
import {
  generateEnrichment,
  type EnrichmentLLM,
  type EnrichmentProposal,
} from './enrichmentGenerate';
import {
  applyEnrichment,
  type CvVersionWriter,
  type EnrichmentApplyResult,
  type EnrichmentStaleHooks,
  type ProfileWriter,
} from './enrichmentApply';

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const ENRICH_ANALYZE_CHANNEL = 'enrich:analyze';
export const ENRICH_QUESTIONS_CHANNEL = 'enrich:questions';
export const ENRICH_PROPOSE_CHANNEL = 'enrich:propose';
export const ENRICH_APPLY_CHANNEL = 'enrich:apply';

// ---------------------------------------------------------------------------
// Error codes + tagged-union results
// ---------------------------------------------------------------------------

export type EnrichErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'NO_CV'
  | 'MODEL_NOT_CAPABLE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'LLM_ERROR'
  | 'INVALID_INPUT';

export interface EnrichFailure {
  ok: false;
  code: EnrichErrorCode;
  error: string;
}

export type EnrichAnalyzeResult =
  | { ok: true; report: WeakBulletReport; doc: TailoringDocument }
  | EnrichFailure;

export interface EnrichQuestionsInput {
  report: WeakBulletReport;
}
export type EnrichQuestionsResult =
  | { ok: true; questionnaire: MetricQuestionnaire }
  | EnrichFailure;

export interface EnrichProposeInput {
  doc: TailoringDocument;
  candidates: WeakBulletCandidate[];
  questions: MetricQuestion[];
  answers: MetricAnswer[];
}
export type EnrichProposeResult =
  | {
      ok: true;
      proposals: EnrichmentProposal[];
      applied: ProposedChange[];
      doc: TailoringDocument;
    }
  | EnrichFailure;

export interface EnrichApplyInput {
  doc: TailoringDocument;
  acceptedChanges: ProposedChange[];
  verifiedSkills?: string[];
  profileId?: string;
}
export type EnrichApplyResult =
  | { ok: true; result: EnrichmentApplyResult }
  | EnrichFailure;

// ---------------------------------------------------------------------------
// Deps — thin seams over the existing modules so this IPC stays unit-testable
// ---------------------------------------------------------------------------

export interface EnrichIpcDeps {
  cvStore: CvStore;
  getProfile: () => ProfileRecord;
  getApiKey: () => string | null;
  getDefaultModel: () => string | null;
  /** ENRICH-004 versioned-CV writer + profile re-derive seam. */
  cvVersionWriter: CvVersionWriter;
  profileWriter: ProfileWriter;
  staleHooks: EnrichmentStaleHooks;
  /** OpenRouter-backed LLM builders. Injected so tests can drive the
   *  handlers without network access. All three reuse the SAME Epic 2
   *  OpenRouter egress — this ticket opens no new egress (AC5). */
  buildWeakBulletLlm: (input: {
    apiKey: string;
    model: string;
  }) => Promise<WeakBulletLLM>;
  buildMetricQuestionLlm: (input: {
    apiKey: string;
    model: string;
  }) => Promise<MetricQuestionLLM>;
  buildEnrichmentLlm: (input: {
    apiKey: string;
    model: string;
  }) => Promise<EnrichmentLLM>;
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

const RATE_LIMIT_HINTS = /(rate[- ]?limit|429|too many requests|quota)/i;
const NETWORK_HINTS =
  /(network|fetch failed|enotfound|econnreset|econnrefused|etimedout|timeout|socket|aborted|getaddrinfo)/i;
const MODEL_NOT_CAPABLE_HINTS =
  /(function call|structured output|tool[_ ]choice|does not support|not capable)/i;

function classifyMessage(message: string): EnrichErrorCode {
  if (RATE_LIMIT_HINTS.test(message)) return 'RATE_LIMITED';
  if (MODEL_NOT_CAPABLE_HINTS.test(message)) return 'MODEL_NOT_CAPABLE';
  if (NETWORK_HINTS.test(message)) return 'NETWORK';
  return 'LLM_ERROR';
}

function fail(code: EnrichErrorCode, error: string): EnrichFailure {
  return { ok: false, code, error };
}

// ---------------------------------------------------------------------------
// Pre-condition checks (AC6)
// ---------------------------------------------------------------------------

interface Prereqs {
  apiKey: string;
  model: string;
}

function checkLlmPrereqs(deps: EnrichIpcDeps): Prereqs | EnrichFailure {
  const apiKey = (deps.getApiKey() ?? '').trim();
  if (!apiKey) {
    return fail(
      'NO_API_KEY',
      'No OpenRouter API key configured. Add one under Settings → Connect an AI provider.',
    );
  }
  const model = (deps.getDefaultModel() ?? '').trim();
  if (!model) {
    return fail(
      'NO_DEFAULT_MODEL',
      'No default model configured. Pick a default under Settings → Preferred models.',
    );
  }
  return { apiKey, model };
}

function pickLatestCv(cvStore: CvStore): CvRecord | null {
  const list = cvStore.list();
  if (!list.length) return null;
  const latest = list[0];
  if (!latest) return null;
  return latest;
}

function parsedFieldsFromRecord(cv: CvRecord): CvParsedFields | null {
  const raw = cv.parsedFields as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;
  const contactRaw =
    raw.contact && typeof raw.contact === 'object'
      ? (raw.contact as Record<string, unknown>)
      : null;
  const employmentRaw = Array.isArray(raw.employmentHistory)
    ? (raw.employmentHistory as Array<Record<string, unknown>>)
    : [];
  const educationRaw = Array.isArray(raw.education)
    ? (raw.education as Array<Record<string, unknown>>)
    : [];
  return {
    name: (raw.name ?? null) as string | null,
    contact: {
      email: (contactRaw?.email ?? null) as string | null,
      phone: (contactRaw?.phone ?? null) as string | null,
    },
    targetRole: (raw.targetRole ?? null) as string | null,
    skills: Array.isArray(raw.skills)
      ? (raw.skills as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    employmentHistory: employmentRaw.map((e) => ({
      company: (e.company ?? null) as string | null,
      role: (e.role ?? null) as string | null,
      startDate: (e.startDate ?? null) as string | null,
      endDate: (e.endDate ?? null) as string | null,
      summary: (e.summary ?? null) as string | null,
    })),
    education: educationRaw.map((e) => ({
      school: (e.school ?? null) as string | null,
      qualification: (e.qualification ?? null) as string | null,
      startDate: (e.startDate ?? null) as string | null,
      endDate: (e.endDate ?? null) as string | null,
    })),
    totalYearsExperience:
      typeof raw.totalYearsExperience === 'number'
        ? (raw.totalYearsExperience as number)
        : null,
    location: (raw.location ?? null) as string | null,
  };
}

function buildDocFromCv(cv: CvRecord): TailoringDocument {
  const parsed: CvParsedFields = parsedFieldsFromRecord(cv) ?? {
    name: null,
    contact: { email: null, phone: null },
    targetRole: null,
    skills: [],
    employmentHistory: [],
    education: [],
    totalYearsExperience: null,
    location: null,
  };
  return buildTailoringDocument(parsed, cv.parsedText ?? '');
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerEnrichmentIpc(
  ipcMain: IpcMain,
  deps: EnrichIpcDeps,
): void {
  // --- analyze ---------------------------------------------------------
  ipcMain.handle(ENRICH_ANALYZE_CHANNEL, async (): Promise<EnrichAnalyzeResult> => {
    try {
      const pre = checkLlmPrereqs(deps);
      if ('ok' in pre) return pre;
      const cv = pickLatestCv(deps.cvStore);
      if (!cv) {
        return fail(
          'NO_CV',
          'No CV uploaded yet. Upload a CV under Profile → CV before enriching.',
        );
      }
      const doc = buildDocFromCv(cv);

      let llm: WeakBulletLLM | undefined;
      try {
        llm = await deps.buildWeakBulletLlm({
          apiKey: pre.apiKey,
          model: pre.model,
        });
      } catch {
        // The analyzer already falls back to deterministic candidates on any
        // LLM failure — swallow the build error and proceed without `llm`.
        llm = undefined;
      }

      const report = await analyzeWeakBullets(
        llm ? { doc, llm } : { doc },
      );
      return { ok: true, report, doc };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(classifyMessage(message), message);
    }
  });

  // --- questions -------------------------------------------------------
  ipcMain.handle(
    ENRICH_QUESTIONS_CHANNEL,
    async (
      _event,
      input: EnrichQuestionsInput | null | undefined,
    ): Promise<EnrichQuestionsResult> => {
      try {
        if (!input || typeof input !== 'object' || !input.report) {
          return fail('INVALID_INPUT', 'enrich:questions requires { report }.');
        }
        // An empty report needs no LLM — return the empty questionnaire
        // without burning a key/model check or a builder call.
        if (
          !Array.isArray(input.report.items) ||
          input.report.items.length === 0
        ) {
          return { ok: true, questionnaire: { questions: [] } };
        }
        const pre = checkLlmPrereqs(deps);
        if ('ok' in pre) return pre;

        let llm: MetricQuestionLLM | undefined;
        try {
          llm = await deps.buildMetricQuestionLlm({
            apiKey: pre.apiKey,
            model: pre.model,
          });
        } catch {
          // Generator falls back to the deterministic baseline on LLM failure.
          llm = undefined;
        }
        const questionnaire = await generateMetricQuestions(
          llm ? { report: input.report, llm } : { report: input.report },
        );
        return { ok: true, questionnaire };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(classifyMessage(message), message);
      }
    },
  );

  // --- propose ---------------------------------------------------------
  ipcMain.handle(
    ENRICH_PROPOSE_CHANNEL,
    async (
      _event,
      input: EnrichProposeInput | null | undefined,
    ): Promise<EnrichProposeResult> => {
      try {
        if (!input || typeof input !== 'object' || !input.doc) {
          return fail(
            'INVALID_INPUT',
            'enrich:propose requires { doc, candidates, questions, answers }.',
          );
        }
        const pre = checkLlmPrereqs(deps);
        if ('ok' in pre) return pre;

        let llm: EnrichmentLLM | undefined;
        try {
          llm = await deps.buildEnrichmentLlm({
            apiKey: pre.apiKey,
            model: pre.model,
          });
        } catch (err) {
          // Unlike the other two builders the rewriter cannot fall back to a
          // deterministic refinement that uses real user numbers — that's
          // the whole point of the LLM here. Surface the failure as a
          // classified tagged-union error so the renderer can branch.
          const message = err instanceof Error ? err.message : String(err);
          return fail(classifyMessage(message), message);
        }

        const result = await generateEnrichment({
          doc: input.doc,
          candidates: input.candidates ?? [],
          questions: input.questions ?? [],
          answers: input.answers ?? [],
          ...(llm ? { llm } : {}),
        });
        return {
          ok: true,
          proposals: result.proposals,
          applied: result.applied,
          doc: result.result,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(classifyMessage(message), message);
      }
    },
  );

  // --- apply -----------------------------------------------------------
  ipcMain.handle(
    ENRICH_APPLY_CHANNEL,
    async (
      _event,
      input: EnrichApplyInput | null | undefined,
    ): Promise<EnrichApplyResult> => {
      try {
        if (!input || typeof input !== 'object' || !input.doc) {
          return fail(
            'INVALID_INPUT',
            'enrich:apply requires { doc, acceptedChanges }.',
          );
        }
        // AC6 — apply does not call the LLM, so the key/model gates do not
        // apply. The only server-side prerequisite is a base CV.
        const base = deps.cvVersionWriter.latest(input.profileId);
        if (!base) {
          return fail(
            'NO_CV',
            'No base CV available. Upload a CV under Profile → CV before applying enrichment.',
          );
        }
        const result = applyEnrichment(
          {
            doc: input.doc,
            acceptedChanges: input.acceptedChanges ?? [],
            ...(input.verifiedSkills ? { verifiedSkills: input.verifiedSkills } : {}),
            ...(input.profileId ? { profileId: input.profileId } : {}),
          },
          {
            cvVersionWriter: deps.cvVersionWriter,
            profileWriter: deps.profileWriter,
            staleHooks: deps.staleHooks,
          },
        );
        return { ok: true, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(classifyMessage(message), message);
      }
    },
  );
}

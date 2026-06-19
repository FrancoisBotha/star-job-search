/**
 * Tailor IPC runtime (TAILOR-004 / Epic 7 §8).
 *
 * Wires the TAILOR-001 structured-output tailoring builder, the TAILOR-002
 * deterministic ATS check, and the TAILOR-003 `tailored_docs` persistence into
 * the renderer via four IPC channels:
 *
 *   tailor:generate({sourceId, kind, intensity?}) — reads the Epic 2 saved
 *     key + default model, the JD (Epic 3 jobs), CV text + structured fields
 *     + Profile (Epic 4), and the cached Epic 6 review when present; runs
 *     the structured-output call via `generateTailoredCv` / `generateCoverLetter`;
 *     runs `checkAts` for the ATS rule report; persists via the tailored_docs
 *     store; returns the persisted TailoredDoc.
 *
 *   tailor:get({sourceId, kind}) — returns the cached TailoredDoc (with the
 *     stale flag), or null if none.
 *
 *   tailor:accept({sourceId, kind, suggestionId}) — applies one suggestion to
 *     the cached draft (removes it from the suggestion list) and triggers a
 *     deterministic Epic 5 rescore for the job. The accept path NEVER calls
 *     the LLM: scoring stays inside the Epic 5 deterministic scorer
 *     (FR-012 / NFR-002 hard boundary). Declining a suggestion is a renderer
 *     concern — the tailoring path otherwise NEVER writes scores.
 *
 *   tailor:export({sourceId, kind}) — returns the document as text/Markdown
 *     for copy/export. There is NO submission path — the renderer takes the
 *     payload and the user does whatever they want with it (FR-015).
 *
 * All four handlers return a TAGGED-UNION result with stable error codes so
 * the renderer can branch on `code` without parsing exception messages:
 *
 *   NO_API_KEY        — Epic 2 key missing or empty
 *   NO_DEFAULT_MODEL  — no preferred model marked default
 *   NO_CV             — no CV uploaded yet (Epic 4 prerequisite)
 *   JOB_NOT_FOUND     — sourceId does not match a known job
 *   DRAFT_NOT_FOUND   — no cached TailoredDoc for (sourceId, kind)
 *   SUGGESTION_NOT_FOUND — accept(suggestionId) cannot find the suggestion
 *   MODEL_NOT_CAPABLE — selected model rejects function calling
 *   RATE_LIMITED      — HTTP 429 / rate-limited responses
 *   NETWORK_ERROR     — fetch / ECONNRESET / DNS failures
 *   LLM_ERROR         — generic model / auth error
 *   SCHEMA_ERROR      — model emitted output the Zod schema rejected
 *
 * Handlers NEVER throw raw errors across the IPC boundary — every failure
 * resolves to `{ ok: false, code, error }`.
 *
 * Mark-stale hooks (AC5 / FR-016):
 *  - `markAllTailoredDocsStale(store, jobsStore)` flips every cached draft
 *    stale when the base CV or Profile changes.
 *  - `markTailoredDocStale(store, sourceId)` flips every draft for one job
 *    stale when that job has been re-extracted.
 *
 * Strict-separation guarantees:
 *  - tailoring NEVER writes the Epic 5 match_scores store directly — the
 *    accept path invokes the injected `rescore(sourceId)` hook, which the
 *    main process binds to the existing deterministic scoring runner.
 *  - this module opens no egress of its own — the only network reach is the
 *    OpenRouter call made by `tailor.ts` (reusing the Epic 2 sanctioned
 *    egress; NFR-002).
 */
import type { IpcMain } from 'electron';

import type { CvStore, CvRecord } from './cv';
import type { JobsStore } from './jobs';
import type { MatchReviewsStore, PersistedMatchReview } from './matchReviews';
import type { ProfileRecord } from './profile';
import {
  generateTailoredCv,
  generateCoverLetter,
  type CoverLetter,
  type TailoredCv,
  type TailorLLM,
  type TailorInputs,
  type TailorReviewBrief,
  type TailorBaseCvFields,
  type Intensity,
} from './tailor';
import { checkAts, type AtsReport as AtsRuleReport } from './atsCheck';
import type {
  AtsReport,
  TailoredDoc,
  TailoredDocKind,
  TailoredDocsStore,
  TailoredSuggestion,
} from './tailoredDocs';

export type TailorErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'NO_CV'
  | 'JOB_NOT_FOUND'
  | 'DRAFT_NOT_FOUND'
  | 'SUGGESTION_NOT_FOUND'
  | 'MODEL_NOT_CAPABLE'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'LLM_ERROR'
  | 'SCHEMA_ERROR';

export interface TailorGenerateInput {
  sourceId: string;
  kind?: TailoredDocKind;
  intensity?: Intensity;
}

export type TailorGenerateResult =
  | { ok: true; doc: TailoredDoc }
  | { ok: false; code: TailorErrorCode; error: string };

export interface TailorGetInput {
  sourceId: string;
  kind: TailoredDocKind;
}

export type TailorGetResult = TailoredDoc | null;

export interface TailorAcceptInput {
  sourceId: string;
  kind: TailoredDocKind;
  suggestionId: string;
}

export type TailorAcceptResult =
  | { ok: true; doc: TailoredDoc; scored: number }
  | { ok: false; code: TailorErrorCode; error: string };

export interface TailorExportInput {
  sourceId: string;
  kind: TailoredDocKind;
}

export type TailorExportResult =
  | {
      ok: true;
      format: 'markdown';
      mimeType: 'text/markdown';
      content: string;
      filename: string;
    }
  | { ok: false; code: TailorErrorCode; error: string };

export interface TailorIpcDeps {
  store: TailoredDocsStore;
  jobsStore: JobsStore;
  cvStore: CvStore;
  reviewsStore: MatchReviewsStore;
  /** Pulled per call so the freshest Profile is sent (CV upload, edit, etc.). */
  getProfile: () => ProfileRecord;
  /** Decrypted OpenRouter key from the Epic 2 store, or null. */
  getApiKey: () => string | null;
  /** The user's selected default model slug (Epic 2), or null. */
  getDefaultModel: () => string | null;
  /** Build the OpenRouter-backed structured-output LLM. Injected so tests can
   *  drive the call without network access. */
  buildLlm: (input: { apiKey: string; model: string }) => Promise<TailorLLM>;
  /** Hook the accept-suggestion path delegates Epic 5 rescoring to. Bound to
   *  the existing deterministic scoring runner in `electron-main.ts` — this
   *  module never touches the Epic 5 store directly (NFR-002). */
  rescore: (sourceId: string) => Promise<{ scored: number }>;
  /** Injectable for deterministic timestamps in tests. */
  now?: () => number;
}

// --- Mark-stale hooks -----------------------------------------------------

export function markAllTailoredDocsStale(
  store: TailoredDocsStore,
  jobsStore: JobsStore,
): void {
  for (const id of Array.from(jobsStore.knownSourceIds())) {
    store.markStale(id);
  }
}

export function markTailoredDocStale(
  store: TailoredDocsStore,
  sourceId: string,
): void {
  store.markStale(sourceId);
}

// --- Error classification -------------------------------------------------

const FUNCTION_CALLING_HINTS =
  /(tool|function[- ]calling|function call|does not support|tools? are not supported|no tools)/i;
const RATE_LIMIT_HINTS = /(429|rate[- ]limit)/i;
const NETWORK_HINTS = /(fetch failed|ECONN|ENOTFOUND|ETIMEDOUT|network|getaddrinfo)/i;

/** Refine a TAILOR-001 generate error code into the broader IPC code set —
 *  generate only returns `MODEL_NOT_CAPABLE | LLM_ERROR | SCHEMA_ERROR`, but
 *  the IPC contract also surfaces RATE_LIMITED / NETWORK_ERROR when the
 *  underlying message hints at one. */
function refineGenerateCode(
  code: 'MODEL_NOT_CAPABLE' | 'LLM_ERROR' | 'SCHEMA_ERROR',
  error: string,
): { code: TailorErrorCode; error: string } {
  if (code === 'LLM_ERROR') {
    if (RATE_LIMIT_HINTS.test(error)) return { code: 'RATE_LIMITED', error };
    if (NETWORK_HINTS.test(error)) return { code: 'NETWORK_ERROR', error };
  }
  return { code, error };
}

function classifyError(err: unknown): { code: TailorErrorCode; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (FUNCTION_CALLING_HINTS.test(message)) {
    return {
      code: 'MODEL_NOT_CAPABLE',
      error:
        'The selected model does not appear to support structured / function-calling output. ' +
        `Pick a function-calling capable model under Settings → Preferred models. (${message})`,
    };
  }
  if (RATE_LIMIT_HINTS.test(message)) {
    return { code: 'RATE_LIMITED', error: message };
  }
  if (NETWORK_HINTS.test(message)) {
    return { code: 'NETWORK_ERROR', error: message };
  }
  return { code: 'LLM_ERROR', error: message };
}

// --- Helpers --------------------------------------------------------------

function pickLatestCv(cvStore: CvStore): CvRecord | null {
  const list = cvStore.list();
  if (!list.length) return null;
  // CvStore.list is sorted by version DESC — the newest CV wins.
  const latest = list[0];
  if (!latest) return null;
  if (!(latest.parsedText ?? '').trim()) return null;
  return latest;
}

function profileToTailorProfile(
  p: ProfileRecord,
): import('./tailor').TailorProfile {
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

function cvFieldsFromRecord(cv: CvRecord): TailorBaseCvFields {
  const f = (cv.parsedFields ?? {}) as Record<string, unknown>;
  const out: TailorBaseCvFields = {};
  if (typeof f.name === 'string' || f.name === null) out.name = f.name as string | null;
  if (typeof f.targetRole === 'string' || f.targetRole === null) out.targetRole = f.targetRole as string | null;
  if (Array.isArray(f.skills)) out.skills = f.skills.filter((s): s is string => typeof s === 'string');
  if (Array.isArray(f.employmentHistory)) {
    out.employmentHistory = (f.employmentHistory as Array<Record<string, unknown>>).map((e) => ({
      company: (e.company ?? null) as string | null,
      role: (e.role ?? null) as string | null,
      startDate: (e.startDate ?? null) as string | null,
      endDate: (e.endDate ?? null) as string | null,
      summary: (e.summary ?? null) as string | null,
    }));
  }
  if (Array.isArray(f.education)) {
    out.education = (f.education as Array<Record<string, unknown>>).map((e) => ({
      school: (e.school ?? null) as string | null,
      qualification: (e.qualification ?? null) as string | null,
      startDate: (e.startDate ?? null) as string | null,
      endDate: (e.endDate ?? null) as string | null,
    }));
  }
  if (typeof f.totalYearsExperience === 'number' || f.totalYearsExperience === null) {
    out.totalYearsExperience = f.totalYearsExperience as number | null;
  }
  if (typeof f.location === 'string' || f.location === null) out.location = f.location as string | null;
  return out;
}

function reviewToBrief(r: PersistedMatchReview): TailorReviewBrief {
  const requirements = r.requirements.map((req) => ({
    requirement: String(req.requirement ?? ''),
    evidence: req.evidence == null ? null : String(req.evidence),
    met: Boolean(req.met),
  }));
  const gaps = r.gaps.map((g) => ({
    text: String(g.text ?? ''),
    severity: (g.severity === 'blocker' ? 'blocker' : 'nice_to_have') as 'blocker' | 'nice_to_have',
    mitigation: String(g.mitigation ?? ''),
  }));
  const brief: TailorReviewBrief = {
    requirements,
    gaps,
    strengths: r.strengths.map((s) => String(s)),
    keywords: r.keywords.map((s) => String(s)),
    summary: String(r.summary ?? ''),
  };
  if (r.archetype !== undefined) brief.archetype = r.archetype;
  return brief;
}

/** Render the tailored CV / cover letter as Markdown for persistence /
 *  copy / export. The Markdown is the renderer's source of truth — the
 *  structured fields are kept as JSON alongside it for in-app editing. */
function renderTailoredCvMarkdown(cv: TailoredCv): string {
  const lines: string[] = [];
  lines.push('# Tailored CV');
  lines.push('');
  lines.push('## Summary');
  lines.push(cv.summary);
  if (cv.competencies.length) {
    lines.push('');
    lines.push('## Core competencies');
    for (const c of cv.competencies) lines.push(`- ${c}`);
  }
  if (cv.achievementBullets.length) {
    lines.push('');
    lines.push('## Achievements');
    for (const b of cv.achievementBullets) lines.push(`- ${b}`);
  }
  if (cv.keywords.length) {
    lines.push('');
    lines.push('## ATS keywords');
    lines.push(cv.keywords.join(', '));
  }
  return lines.join('\n');
}

function renderCoverLetterMarkdown(letter: CoverLetter): string {
  const lines: string[] = [];
  lines.push('# Cover letter');
  lines.push('');
  lines.push(letter.opening);
  for (const p of letter.body) {
    lines.push('');
    lines.push(p);
  }
  lines.push('');
  lines.push(letter.closing);
  return lines.join('\n');
}

/** Map TAILOR-001 TailorSuggestion[] → TAILOR-003 TailoredSuggestion[].
 *  Each gets a stable id derived from its index so the accept path can
 *  address one without depending on the LLM emitting an id. */
function suggestionsForPersistence(
  raw: ReadonlyArray<{ area?: string; suggestion?: string; rationale?: string }>,
): TailoredSuggestion[] {
  return raw.map((s, i) => ({
    id: `sug-${i + 1}`,
    type: String(s.area ?? ''),
    gain: 0,
    text: String(s.suggestion ?? ''),
    rationale: String(s.rationale ?? ''),
  }));
}

/** Map a TAILOR-002 AtsReport (rule-based) → the TAILOR-003 persisted
 *  AtsReport shape. The persisted shape stores a coarse pass-rate score plus
 *  the JD keywords missing from the document for the renderer to render. */
function atsReportForPersistence(report: AtsRuleReport): AtsReport {
  const total = report.checks.length || 1;
  const passed = report.checks.filter((c) => c.passed).length;
  const score = Math.round((passed / total) * 100);
  const missing = new Set<string>();
  for (const c of report.checks) {
    if (c.passed || !c.detail) continue;
    const m = /missing:\s*([^)]+)/i.exec(c.detail);
    if (m && m[1]) {
      for (const k of m[1].split(',').map((s) => s.trim())) {
        if (k) missing.add(k);
      }
    }
  }
  return {
    score,
    missingKeywords: Array.from(missing),
    checks: report.checks,
  };
}

// --- Registration ---------------------------------------------------------

export function registerTailorIpc(ipcMain: IpcMain, deps: TailorIpcDeps): void {
  const now = deps.now ?? (() => Date.now());

  ipcMain.handle(
    'tailor:get',
    async (_event, input: TailorGetInput): Promise<TailorGetResult> => {
      if (!input || typeof input.sourceId !== 'string' || !input.sourceId) return null;
      const kind: TailoredDocKind = input.kind === 'cover-letter' ? 'cover-letter' : 'cv';
      return deps.store.get(input.sourceId, kind) ?? null;
    },
  );

  ipcMain.handle(
    'tailor:generate',
    async (_event, input: TailorGenerateInput): Promise<TailorGenerateResult> => {
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
            code: 'JOB_NOT_FOUND',
            error: 'tailor:generate requires a non-empty sourceId.',
          };
        }
        const job = deps.jobsStore
          .listJobs()
          .find((j) => j.sourceId === input.sourceId);
        if (!job) {
          return {
            ok: false,
            code: 'JOB_NOT_FOUND',
            error: `No job found for sourceId "${input.sourceId}".`,
          };
        }
        const cv = pickLatestCv(deps.cvStore);
        if (!cv) {
          return {
            ok: false,
            code: 'NO_CV',
            error:
              'No CV uploaded yet. Add a CV under Profile to enable tailoring.',
          };
        }

        const kind: TailoredDocKind = input.kind === 'cover-letter' ? 'cover-letter' : 'cv';
        const intensity: Intensity = input.intensity === 'aggressive' ? 'aggressive' : 'light';

        const cachedReview = deps.reviewsStore.get(input.sourceId);
        const tailorInputs: TailorInputs = {
          sourceId: input.sourceId,
          company: job.company ?? '',
          title: job.title ?? '',
          jobDescription: job.description ?? '',
          baseCvText: cv.parsedText ?? '',
          baseCvFields: cvFieldsFromRecord(cv),
          profile: profileToTailorProfile(deps.getProfile()),
          intensity,
          ...(cachedReview ? { review: reviewToBrief(cachedReview) } : {}),
        };

        const llm = await deps.buildLlm({ apiKey, model });

        if (kind === 'cv') {
          const gen = await generateTailoredCv({ llm, inputs: tailorInputs });
          if (!gen.ok) {
            const err = gen as unknown as {
              code: 'MODEL_NOT_CAPABLE' | 'LLM_ERROR' | 'SCHEMA_ERROR';
              error: string;
            };
            return { ok: false, ...refineGenerateCode(err.code, err.error) };
          }
          const content = renderTailoredCvMarkdown(gen.tailoredCv);
          const ats = checkAts(
            { text: content, summary: gen.tailoredCv.summary, skills: gen.tailoredCv.competencies },
            gen.tailoredCv.keywords,
          );
          const doc: TailoredDoc = {
            sourceId: input.sourceId,
            kind: 'cv',
            content,
            suggestions: suggestionsForPersistence(gen.tailoredCv.suggestions),
            atsReport: atsReportForPersistence(ats),
            keywords: gen.tailoredCv.keywords,
            intensity,
            baseCvId: cv.id,
            modelSlug: model,
            generatedAt: now(),
            stale: false,
          };
          deps.store.upsert(doc);
          return { ok: true, doc };
        }

        const gen = await generateCoverLetter({ llm, inputs: tailorInputs });
        if (!gen.ok) {
          const err = gen as unknown as {
            code: 'MODEL_NOT_CAPABLE' | 'LLM_ERROR' | 'SCHEMA_ERROR';
            error: string;
          };
          return { ok: false, ...refineGenerateCode(err.code, err.error) };
        }
        const content = renderCoverLetterMarkdown(gen.coverLetter);
        const ats = checkAts({ text: content }, gen.coverLetter.keywords);
        const doc: TailoredDoc = {
          sourceId: input.sourceId,
          kind: 'cover-letter',
          content,
          suggestions: [],
          atsReport: atsReportForPersistence(ats),
          keywords: gen.coverLetter.keywords,
          intensity,
          baseCvId: cv.id,
          modelSlug: model,
          generatedAt: now(),
          stale: false,
        };
        deps.store.upsert(doc);
        return { ok: true, doc };
      } catch (err) {
        return { ok: false, ...classifyError(err) };
      }
    },
  );

  ipcMain.handle(
    'tailor:accept',
    async (_event, input: TailorAcceptInput): Promise<TailorAcceptResult> => {
      try {
        if (
          !input ||
          typeof input.sourceId !== 'string' ||
          !input.sourceId ||
          typeof input.suggestionId !== 'string' ||
          !input.suggestionId
        ) {
          return {
            ok: false,
            code: 'DRAFT_NOT_FOUND',
            error: 'tailor:accept requires sourceId, kind, and suggestionId.',
          };
        }
        const kind: TailoredDocKind = input.kind === 'cover-letter' ? 'cover-letter' : 'cv';
        const draft = deps.store.get(input.sourceId, kind);
        if (!draft) {
          return {
            ok: false,
            code: 'DRAFT_NOT_FOUND',
            error: `No tailored draft found for "${input.sourceId}" / "${kind}".`,
          };
        }
        const idx = draft.suggestions.findIndex((s) => s.id === input.suggestionId);
        if (idx === -1) {
          return {
            ok: false,
            code: 'SUGGESTION_NOT_FOUND',
            error: `No suggestion "${input.suggestionId}" on the cached draft.`,
          };
        }
        const remaining = [...draft.suggestions];
        remaining.splice(idx, 1);
        const updated: TailoredDoc = {
          ...draft,
          suggestions: remaining,
          // Accepting a suggestion implicitly re-confirms the draft as the
          // user's current best — clear the stale flag so the UI can stop
          // surfacing a "regenerate" prompt for it.
          stale: false,
        };
        deps.store.upsert(updated);

        // FR-012 / NFR-002 — score is recomputed by the deterministic Epic 5
        // scorer, NOT the LLM. The injected rescore hook is bound to
        // ScoringRunner.rescoreOne in electron-main.ts.
        const rescoreResult = await deps.rescore(input.sourceId);
        return { ok: true, doc: updated, scored: rescoreResult.scored };
      } catch (err) {
        return { ok: false, ...classifyError(err) };
      }
    },
  );

  ipcMain.handle(
    'tailor:export',
    async (_event, input: TailorExportInput): Promise<TailorExportResult> => {
      if (!input || typeof input.sourceId !== 'string' || !input.sourceId) {
        return {
          ok: false,
          code: 'DRAFT_NOT_FOUND',
          error: 'tailor:export requires a non-empty sourceId.',
        };
      }
      const kind: TailoredDocKind = input.kind === 'cover-letter' ? 'cover-letter' : 'cv';
      const draft = deps.store.get(input.sourceId, kind);
      if (!draft) {
        return {
          ok: false,
          code: 'DRAFT_NOT_FOUND',
          error: `No tailored draft found for "${input.sourceId}" / "${kind}".`,
        };
      }
      const filename =
        kind === 'cv'
          ? `tailored-cv-${input.sourceId}.md`
          : `cover-letter-${input.sourceId}.md`;
      return {
        ok: true,
        format: 'markdown',
        mimeType: 'text/markdown',
        content: draft.content,
        filename,
      };
    },
  );
}

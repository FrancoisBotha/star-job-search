/**
 * Extract-this-job IPC runtime (XJOB-003 — Epic 11: Extract this job).
 *
 * Wires the foreground-view capture (XJOB-001) and the single-call structured
 * extractor (XJOB-002) into the renderer via one IPC channel:
 *
 *   ai:extractVisible() — captures the FOREGROUND embedded-browser tab the
 *     user is looking at, runs ONE structured-output LLM call against the
 *     Epic 3 JobSchema (+ EXTR-013 salary), upserts the result through the
 *     Epic 3 jobs store with provenance `source: 'manual'` (AC3 — additive),
 *     triggers the Epic 5 deterministic rescore via the injected `scoreOne`
 *     hook, and returns a tagged-union result.
 *
 * Progress events stream over `ai:extractVisible:progress`:
 *   - { phase: 'extracting' } when the LLM call is about to start
 *   - { phase: 'result', ok, code?, sourceId? } when the run finishes
 *
 * Errors NEVER throw across the IPC boundary — every failure resolves to a
 * stable `{ ok: false, code, error }` shape (AC4):
 *
 *   NO_API_KEY        — Epic 2 key missing / empty
 *   NO_DEFAULT_MODEL  — no preferred model marked default
 *   NO_VIEW           — no foreground board view is currently open
 *   CAPTURE_FAILED    — foreground-view JS evaluation threw
 *   NO_POSTING        — page has no recognisable job posting (homepage / 404 /
 *                       login wall) — the model is told NOT to fabricate one
 *   NO_INPUT          — captured text was empty (defensive — XJOB-002 reports)
 *   MODEL_NOT_CAPABLE — selected model rejects structured / function-calling
 *                       output
 *   LLM_ERROR         — generic model error
 */
import type { IpcMain, WebContents } from 'electron';

import {
  captureForegroundView,
  type ForegroundCaptureResult,
} from './foregroundCapture';
import {
  extractVisibleJob,
  type ExtractVisibleJobResult,
} from './extractVisibleJob';
import type { StructuredLlm } from './jobExtractor';
import type { JobRecord, JobsStore } from './jobs';

export const EXTRACT_VISIBLE_CHANNEL = 'ai:extractVisible';
export const EXTRACT_VISIBLE_PROGRESS_CHANNEL = 'ai:extractVisible:progress';

export type ExtractVisibleErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'NO_VIEW'
  | 'CAPTURE_FAILED'
  | 'NO_POSTING'
  | 'NO_INPUT'
  | 'MODEL_NOT_CAPABLE'
  | 'LLM_ERROR';

export type ExtractVisibleResult =
  | { ok: true; job: JobRecord }
  | { ok: false; code: ExtractVisibleErrorCode; error: string };

export type ExtractVisibleProgressEvent =
  | { phase: 'extracting' }
  | {
      phase: 'result';
      ok: boolean;
      code?: ExtractVisibleErrorCode;
      sourceId?: string;
    };

export interface ExtractVisibleIpcDeps {
  jobsStore: JobsStore;
  /** Resolves the currently-visible foreground board webContents (Discover
   *  tab). Returns undefined when no view exists — handled with NO_VIEW. */
  getVisibleTarget: () => WebContents | undefined;
  getApiKey: () => string | null;
  getDefaultModel: () => string | null;
  /** Build the structured-output LLM client. Mirrors the tailor-engine /
   *  review IPC builders so the same OpenRouter egress is reused (NFR-002 —
   *  Epic 11 opens no new network egress). */
  buildLlm: (input: { apiKey: string; model: string }) => Promise<StructuredLlm>;
  /** Epic 5 rescore for the freshly-extracted sourceId. Best-effort: a
   *  scoring failure must not mask the successful extract (matches the bulk
   *  extraction path's hook). */
  scoreOne: (sourceId: string) => Promise<unknown> | unknown;
  /** Per-run progress sink. The main process binds this to
   *  `mainWindow.webContents.send(EXTRACT_VISIBLE_PROGRESS_CHANNEL, e)`. */
  emitProgress: (event: ExtractVisibleProgressEvent) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

// Same hint set the review/tailor IPC layers use to tell "model can't do
// structured output" apart from a generic LLM error — keeps the renderer's
// branch on `MODEL_NOT_CAPABLE` working consistently across surfaces.
const FUNCTION_CALLING_HINTS =
  /(tool|function[- ]calling|function call|does not support|tools? are not supported|no tools)/i;

function emit(deps: ExtractVisibleIpcDeps, event: ExtractVisibleProgressEvent): void {
  try {
    deps.emitProgress(event);
  } catch {
    // never let a downstream sink crash the IPC handler
  }
}

function captureCodeToIpc(
  capture: Exclude<ForegroundCaptureResult, { ok: true }>,
): { code: ExtractVisibleErrorCode; error: string } {
  if (capture.code === 'NO_VIEW') return { code: 'NO_VIEW', error: capture.error };
  return { code: 'CAPTURE_FAILED', error: capture.error };
}

function extractCodeToIpc(
  result: Exclude<ExtractVisibleJobResult, { ok: true }>,
): { code: ExtractVisibleErrorCode; error: string } {
  if (result.code === 'NO_POSTING') return { code: 'NO_POSTING', error: result.error };
  if (result.code === 'NO_INPUT') return { code: 'NO_INPUT', error: result.error };
  // LLM_FAILED — classify capable-model failures distinctly.
  if (FUNCTION_CALLING_HINTS.test(result.error)) {
    return {
      code: 'MODEL_NOT_CAPABLE',
      error:
        `The selected model does not appear to support structured / function-calling output. ` +
        `Pick a function-calling capable model under Settings → Preferred models. (${result.error})`,
    };
  }
  return { code: 'LLM_ERROR', error: result.error };
}

export function registerExtractVisibleIpc(
  ipcMain: IpcMain,
  deps: ExtractVisibleIpcDeps,
): void {
  ipcMain.handle(EXTRACT_VISIBLE_CHANNEL, async (): Promise<ExtractVisibleResult> => {
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
        const fail = {
          ok: false as const,
          code: 'NO_DEFAULT_MODEL' as const,
          error:
            'No default model configured. Pick a default under Settings → Preferred models.',
        };
        emit(deps, { phase: 'result', ok: false, code: fail.code });
        return fail;
      }

      // AC1: capture the FOREGROUND view (XJOB-001). NO_VIEW / CAPTURE_FAILED
      // bubble straight through as stable codes.
      const capture = await captureForegroundView({
        getVisibleTarget: deps.getVisibleTarget,
      });
      if (!capture.ok) {
        const mapped = captureCodeToIpc(capture);
        emit(deps, { phase: 'result', ok: false, code: mapped.code });
        return { ok: false, ...mapped };
      }

      emit(deps, { phase: 'extracting' });

      // AC1 / AC3: run the single structured extraction (XJOB-002), persist
      // with source='manual' provenance, trigger the score hook.
      const llm = await deps.buildLlm({ apiKey, model });
      const run = await extractVisibleJob(
        { url: capture.url, text: capture.text },
        {
          store: wrapStoreForManualProvenance(deps.jobsStore),
          llm,
          scoreOne: deps.scoreOne,
          ...(deps.now ? { now: deps.now } : {}),
        },
      );

      if (!run.ok) {
        const mapped = extractCodeToIpc(run);
        emit(deps, { phase: 'result', ok: false, code: mapped.code });
        return { ok: false, ...mapped };
      }

      // AC3: the persisted row is the manually-extracted one — return the
      // shape with `source: 'manual'` set so the renderer can branch on it
      // without re-reading the store.
      const job: JobRecord = { ...run.job, source: 'manual' };
      emit(deps, { phase: 'result', ok: true, sourceId: job.sourceId });
      return { ok: true, job };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit(deps, { phase: 'result', ok: false, code: 'LLM_ERROR' });
      return { ok: false, code: 'LLM_ERROR', error: message };
    }
  });
}

/** Wrap the shared JobsStore so every row written through THIS IPC carries
 *  `source: 'manual'` regardless of what the inner extractor passes — keeps
 *  AC3 provenance enforced at the IPC boundary rather than relying on the
 *  pure helper to set it. */
function wrapStoreForManualProvenance(store: JobsStore): JobsStore {
  return {
    ...store,
    upsertJobs: (jobs) =>
      store.upsertJobs(jobs.map((j) => ({ ...j, source: 'manual' as const }))),
  };
}

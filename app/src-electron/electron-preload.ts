/**
 * Electron preload. Exposes safe, typed bridges to the renderer.
 * `starWindow` drives the custom (frameless) title-bar controls.
 * `starBrowser` drives the embedded job-site browser surface (BRWSR-001).
 * `starSites` drives the persisted job-sites list (BRWSR-002).
 * Future bridges (CV file picking, backup-folder selection, secure key
 * storage) belong here too.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('starWindow', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  onMaximizedChange: (cb: (maximized: boolean) => void) => {
    ipcRenderer.on('window:maximized', (_event, maximized: boolean) => cb(maximized));
  },
});

interface JobBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

contextBridge.exposeInMainWorld('starBrowser', {
  create: () => ipcRenderer.invoke('job-browser:create'),
  navigate: (url: string) => ipcRenderer.invoke('job-browser:navigate', url),
  back: () => ipcRenderer.invoke('job-browser:back'),
  forward: () => ipcRenderer.invoke('job-browser:forward'),
  show: (visible: boolean) => ipcRenderer.invoke('job-browser:show', visible),
  setBounds: (bounds: JobBrowserBounds) =>
    ipcRenderer.invoke('job-browser:set-bounds', bounds),
});

interface AddSiteInput {
  url: string;
  label?: string;
}

contextBridge.exposeInMainWorld('starSites', {
  list: () => ipcRenderer.invoke('sites:list'),
  add: (input: AddSiteInput) => ipcRenderer.invoke('sites:add', input),
  remove: (id: string) => ipcRenderer.invoke('sites:remove', id),
  setEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke('sites:setEnabled', { id, enabled }),
  setUsername: (id: string, username: string) =>
    ipcRenderer.invoke('sites:setUsername', { id, username }),
});

// Singleton Profile bridge (CVPROF-001). `get` returns the persisted Profile
// (or an empty default on first run); `save` upserts the edited fields and
// returns the updated Profile.
contextBridge.exposeInMainWorld('starProfile', {
  get: () => ipcRenderer.invoke('profile:get'),
  save: (input: unknown) => ipcRenderer.invoke('profile:save', input),
});

// Versioned CV bridge (CVPROF-003). `upload` copies the picked file under
// userData, extracts its text off-thread, and persists the new versioned CV
// record; `list` returns all versions for a profile (newest first); `get`
// loads a single version by id.
interface CvUploadInput {
  filePath: string;
  fileName: string;
  mime: 'pdf' | 'docx';
  profileId?: string;
}

// File-path bridge (CVPROF-011). Electron 32 removed the `File.path`
// property; the renderer must resolve picked/dropped File objects to an
// absolute filesystem path through this preload-side helper. The File
// object is consumed INSIDE the preload-defined function (where the
// `webUtils.getPathForFile` API lives) — `contextIsolation` keeps the
// File reference structurally cloneable across the bridge. Returns an
// empty string when no path can be resolved (e.g. a synthetic File built
// from a Blob in tests), so the renderer can surface a user-facing
// error instead of writing an invalid CV record.
contextBridge.exposeInMainWorld('starFile', {
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return '';
    }
  },
});

contextBridge.exposeInMainWorld('starCv', {
  upload: (input: CvUploadInput) => ipcRenderer.invoke('cv:upload', input),
  list: (profileId?: string) => ipcRenderer.invoke('cv:list', profileId),
  get: (id: string) => ipcRenderer.invoke('cv:get', id),
  // CVPROF-014: delete every CV row + on-disk binary for the profile and
  // return { removedRows, removedFiles } so the renderer can surface
  // partial cleanup if the file is already missing.
  clear: (profileId?: string) => ipcRenderer.invoke('cv:clear', profileId),
});

// OpenRouter API key bridge (LLM-001). The raw key never crosses this
// boundary — save/getStatus return only { present, masked }.
contextBridge.exposeInMainWorld('starApiKey', {
  save: (rawKey: string) => ipcRenderer.invoke('apiKey:save', rawKey),
  getStatus: () => ipcRenderer.invoke('apiKey:getStatus'),
  clear: () => ipcRenderer.invoke('apiKey:clear'),
});

// OpenRouter model catalogue bridge (LLM-002). Returns a tagged-union result
// so the renderer can branch on the stable error code (NO_API_KEY / AUTH_ERROR
// / RATE_LIMITED / NETWORK_ERROR / HTTP_ERROR / BAD_RESPONSE).
contextBridge.exposeInMainWorld('starModels', {
  list: () => ipcRenderer.invoke('llm:listModels'),
});

// CV LLM-structuring bridge (CVPROF-004). The renderer hands in the extracted
// CV text (from starCv.get(id).parsedText) and receives a tagged-union result
// `{ ok: true, parsedFields, confidence }` or `{ ok: false, code, message }`
// with a stable error code (NO_API_KEY / NO_DEFAULT_MODEL / EMPTY_TEXT /
// AUTH_ERROR / RATE_LIMITED / NETWORK_ERROR / HTTP_ERROR / BAD_RESPONSE /
// PARSE_ERROR / MODEL_NO_STRUCTURED_OUTPUT) so the review step can branch
// without parsing exception messages.
contextBridge.exposeInMainWorld('starCvStructurer', {
  structure: (text: string) => ipcRenderer.invoke('cv:structure', text),
});

// Preferred-models bridge (LLM-003). Each call returns the updated
// PreferredModel[] list; `add` returns a tagged union so the renderer can
// branch on EMPTY_SLUG / DUPLICATE / LIMIT_REACHED without losing the code.
contextBridge.exposeInMainWorld('starPreferredModels', {
  list: () => ipcRenderer.invoke('preferredModels:list'),
  add: (slug: string) => ipcRenderer.invoke('preferredModels:add', slug),
  remove: (slug: string) => ipcRenderer.invoke('preferredModels:remove', slug),
  setDefault: (slug: string) => ipcRenderer.invoke('preferredModels:setDefault', slug),
});

// Agentic extraction bridge (EXTR-006). `extract` kicks off an extraction
// run against whatever the visible Discover browser is currently showing
// and resolves to a tagged-union result. `onProgress` subscribes to
// `extract:progress` events streamed by the main process during the run.
interface ExtractProgressEvent {
  phase: string;
  [key: string]: unknown;
}

contextBridge.exposeInMainWorld('starExtract', {
  extract: () => ipcRenderer.invoke('ai:extract'),
  onProgress: (cb: (event: ExtractProgressEvent) => void) => {
    const listener = (_event: unknown, evt: ExtractProgressEvent) => cb(evt);
    ipcRenderer.on('extract:progress', listener);
    return () => ipcRenderer.removeListener('extract:progress', listener);
  },
});

// Extract-this-job bridge (XJOB-003 / Epic 11). `extract` captures the
// FOREGROUND embedded-browser tab the user is currently viewing, runs ONE
// structured-output LLM call against the Epic 3 JobSchema, persists the
// resulting row with `source: 'manual'` provenance, and triggers the Epic 5
// deterministic rescore. Returns a tagged-union result so the renderer can
// branch on the stable error code (NO_API_KEY / NO_DEFAULT_MODEL / NO_VIEW /
// CAPTURE_FAILED / NO_POSTING / NO_INPUT / MODEL_NOT_CAPABLE / LLM_ERROR).
// `onProgress` subscribes to `ai:extractVisible:progress` — { phase:
// 'extracting' } then { phase: 'result', ok, code?, sourceId? }.
interface ExtractVisibleProgressEvent {
  phase: 'extracting' | 'result' | string;
  ok?: boolean;
  code?: string;
  sourceId?: string;
}

contextBridge.exposeInMainWorld('starExtractVisible', {
  extract: () => ipcRenderer.invoke('ai:extractVisible'),
  onProgress: (cb: (event: ExtractVisibleProgressEvent) => void) => {
    const listener = (_event: unknown, evt: ExtractVisibleProgressEvent) => cb(evt);
    ipcRenderer.on('ai:extractVisible:progress', listener);
    return () => ipcRenderer.removeListener('ai:extractVisible:progress', listener);
  },
});

// Job-board bridge (EXTR-006). `list` reads persisted jobs (optional status
// filter), `setStatus` flips a posting's status, `open` navigates the
// embedded Discover browser to a URL (used by job-detail click-throughs).
interface BoardListFilter {
  status?: string;
  excludeStatus?: string;
}

contextBridge.exposeInMainWorld('starBoard', {
  list: (filter?: BoardListFilter) => ipcRenderer.invoke('board:list', filter),
  setStatus: (input: { sourceId: string; status: string }) =>
    ipcRenderer.invoke('board:setStatus', input),
  open: (url: string) => ipcRenderer.invoke('view:open', url),
  // EXTR-012: wipe every imported job (cascades to match_scores +
  // match_reviews in main). Returns `{ ok: true, deleted }`.
  deleteAll: () => ipcRenderer.invoke('board:deleteAll'),
  // EXTR-016: permanently delete one imported job by sourceId (cascades to
  // match_scores + match_reviews for that row in main). Returns
  // `{ ok: true, deleted }`.
  delete: (sourceId: string) => ipcRenderer.invoke('board:delete', sourceId),
});

// Scoring bridge (SCORE-004 / Epic 5). `get`/`list` read the persisted
// MatchScore rows produced by the deterministic scorer; `rescore` kicks off
// a batch over stale + unscored jobs (default), every job (mode: 'all'),
// only-unscored jobs (mode: 'unscored'), or one job (sourceId). Progress
// streams via `scores:progress` — { phase, total, completed, sourceId }.
interface ScoresRescoreInput {
  mode?: 'stale' | 'unscored' | 'all';
  sourceId?: string;
}

interface ScoresProgressEvent {
  phase: string;
  total: number;
  completed: number;
  sourceId?: string;
}

contextBridge.exposeInMainWorld('starScores', {
  get: (sourceId: string) => ipcRenderer.invoke('scores:get', sourceId),
  list: () => ipcRenderer.invoke('scores:list'),
  rescore: (input?: ScoresRescoreInput) => ipcRenderer.invoke('scores:rescore', input ?? {}),
  onProgress: (cb: (event: ScoresProgressEvent) => void) => {
    const listener = (_event: unknown, evt: ScoresProgressEvent) => cb(evt);
    ipcRenderer.on('scores:progress', listener);
    return () => ipcRenderer.removeListener('scores:progress', listener);
  },
});

// AI Match Review bridge (AIREV-003 / Epic 6 §8). `generate` runs the single
// structured-output review call against OpenRouter (Epic 2 key + default
// model) over the job's JD + the user's CV/Profile, persists the narrative
// review via `match_reviews`, and returns it. `get` returns the cached
// review with its stale flag (or null). Both return a tagged-union result
// `{ ok: true, review }` or `{ ok: false, code, error }` with a stable error
// code (NO_API_KEY / NO_DEFAULT_MODEL / NO_CV / JOB_NOT_FOUND /
// MODEL_NOT_CAPABLE / LLM_ERROR / SCHEMA_ERROR).
contextBridge.exposeInMainWorld('starReview', {
  generate: (sourceId: string) => ipcRenderer.invoke('review:generate', sourceId),
  get: (sourceId: string) => ipcRenderer.invoke('review:get', sourceId),
});

// Tailor bridge (TAILOR-004 / Epic 7 §8). `generate` runs the single
// structured-output tailoring call (CV or cover letter) against OpenRouter
// (Epic 2 key + default model) over the JD + the user's CV/Profile + the
// cached Epic 6 review (when present), runs the deterministic ATS check
// alongside, persists via `tailored_docs`, and returns the draft. `get`
// returns the cached draft with its stale flag (or null). `accept` removes
// one suggestion from the draft and triggers an Epic 5 deterministic rescore
// (NOT the LLM). `export` returns the draft as text/Markdown for copy/export.
// All return a tagged-union result `{ ok: true, ... }` or `{ ok: false, code,
// error }` with a stable error code (NO_API_KEY / NO_DEFAULT_MODEL / NO_CV /
// JOB_NOT_FOUND / DRAFT_NOT_FOUND / SUGGESTION_NOT_FOUND / MODEL_NOT_CAPABLE
// / RATE_LIMITED / NETWORK_ERROR / LLM_ERROR / SCHEMA_ERROR).
interface TailorGenerateInput {
  sourceId: string;
  kind?: 'cv' | 'cover-letter';
  intensity?: 'light' | 'aggressive';
}
interface TailorDocSelector {
  sourceId: string;
  kind: 'cv' | 'cover-letter';
}
interface TailorAcceptInput {
  sourceId: string;
  kind: 'cv' | 'cover-letter';
  suggestionId: string;
}

contextBridge.exposeInMainWorld('starTailor', {
  generate: (input: TailorGenerateInput) => ipcRenderer.invoke('tailor:generate', input),
  get: (input: TailorDocSelector) => ipcRenderer.invoke('tailor:get', input),
  accept: (input: TailorAcceptInput) => ipcRenderer.invoke('tailor:accept', input),
  export: (input: TailorDocSelector) => ipcRenderer.invoke('tailor:export', input),
});

// Tailor diff-engine bridge (TDE-006 / Epic 9). `propose` runs the bounded
// LangGraph pipeline (extract-JD-signals → plan/verify-skills → generate-diffs
// → gate-filter → refine → rescore) and returns the full TailorEngineResult
// for the renderer's diff-review UI. `apply` takes the user-accepted subset
// of ProposedChanges, applies it DETERMINISTICALLY through the TDE-002 gates
// (NO LLM call), persists the saved tailored doc via the Epic 7 tailored_docs
// store, and triggers the Epic 5 deterministic rescore. Both return a
// tagged-union result with stable error codes (NO_API_KEY / NO_DEFAULT_MODEL
// / NO_DOC / MODEL_NOT_CAPABLE / RATE_LIMITED / NETWORK / LLM_ERROR /
// SCHEMA_ERROR). Per-node progress streams over `tailor-engine:progress`.
interface TailorProposeInput {
  sourceId: string;
}
interface TailorApplyInput {
  sourceId: string;
  doc: unknown;
  accepted: unknown[];
  verifiedSkills?: string[];
}
interface TailorEngineProgressEvent {
  phase: string;
  sourceId: string;
  pass?: number;
  note?: string;
}

contextBridge.exposeInMainWorld('starTailorEngine', {
  propose: (input: TailorProposeInput) =>
    ipcRenderer.invoke('tailor:propose', input),
  apply: (input: TailorApplyInput) => ipcRenderer.invoke('tailor:apply', input),
  onProgress: (cb: (event: TailorEngineProgressEvent) => void) => {
    const listener = (_event: unknown, evt: TailorEngineProgressEvent) => cb(evt);
    ipcRenderer.on('tailor-engine:progress', listener);
    return () => ipcRenderer.removeListener('tailor-engine:progress', listener);
  },
});

// PDF-export bridge (PDFEX-004 / Epic 8). `export` compiles the persisted
// TailoredDoc via the bundled LaTeX engine (PDFEX-002), opens a native save
// dialog, writes the PDF locally — Star performs NO submission — and records
// provenance per PdfExportRecord (FR-007 / FR-008). `reveal` calls
// shell.showItemInFolder on the saved path. Both return a tagged-union
// result with stable error codes (NO_DOC / COMPILE_ERROR / TOOLCHAIN_MISSING /
// IO_ERROR) so the renderer can branch without parsing exception messages.
interface PdfExportOptsInput {
  pageSize?: 'letter' | 'a4';
}

contextBridge.exposeInMainWorld('starPdf', {
  export: (tailoredDocId: string, opts?: PdfExportOptsInput) =>
    ipcRenderer.invoke('pdf:export', { tailoredDocId, opts }),
  reveal: (fullPath: string) => ipcRenderer.invoke('pdf:reveal', fullPath),
});

// Word (.docx) export bridge (UEXP-003 / Epic 12). `export` renders the
// persisted TailoredDoc via the pinned `docx` library (UEXP-002), opens a
// native save dialog with a role/company default filename, writes the
// `.docx` locally — Star performs NO submission — and records provenance
// per WordExportRecord (epic §7). `reveal` calls shell.showItemInFolder on
// the saved path. Both return a tagged-union result with stable error
// codes (NO_DOC / RENDER_ERROR / IO_ERROR) so the renderer can branch
// without parsing exception messages.
interface WordExportOptsInput {
  locale?: string;
}

contextBridge.exposeInMainWorld('starWord', {
  export: (tailoredDocId: string, opts?: WordExportOptsInput) =>
    ipcRenderer.invoke('word:export', { tailoredDocId, opts }),
  reveal: (fullPath: string) => ipcRenderer.invoke('word:reveal', fullPath),
});

// Job Evaluation Report bridge (EVAL-004 / Epic 14). `generate` runs the
// EVAL-003 orchestrator (Blocks A/C/D/G + Epic 6 Block-B fallback +
// EVAL-001 webResearch) and persists via the EVAL-002 store. `get` reads
// the cached PersistedEvalReport (with the stale flag) or null. Both
// return a tagged-union result with stable error codes (NO_API_KEY /
// MODEL_NOT_CAPABLE / RATE_LIMITED / NETWORK / NO_SCORE). `onProgress`
// streams `eval:progress` events (researching / reviewing / generating /
// result). `webResearch` exposes the persisted opt-in setting + disclosure
// copy consumed by EVAL-001.
interface EvalProgressEventInput {
  phase: 'researching' | 'reviewing' | 'generating' | 'result' | string;
  ok?: boolean;
  code?: string;
  sourceId?: string;
}

contextBridge.exposeInMainWorld('starEval', {
  generate: (sourceId: string) => ipcRenderer.invoke('eval:generate', sourceId),
  get: (sourceId: string) => ipcRenderer.invoke('eval:get', sourceId),
  onProgress: (cb: (event: EvalProgressEventInput) => void) => {
    const listener = (_event: unknown, evt: EvalProgressEventInput) => cb(evt);
    ipcRenderer.on('eval:progress', listener);
    return () => ipcRenderer.removeListener('eval:progress', listener);
  },
  getWebResearchSetting: () => ipcRenderer.invoke('webResearch:getSetting'),
  setWebResearchEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('webResearch:setEnabled', enabled),
  acknowledgeWebResearchDisclosure: () =>
    ipcRenderer.invoke('webResearch:acknowledgeDisclosure'),
});

// External shell bridge (JOBDET-001). Opens http/https URLs in the user's OS
// default browser. Distinct from `starBoard.open` (which navigates the
// embedded Discover browser via `view:open`). The main-process handler
// enforces the http/https scheme allow-list.
contextBridge.exposeInMainWorld('starShell', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
});

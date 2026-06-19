/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/** Bridge exposed by src-electron/electron-preload.ts (present only under Electron). */
interface StarWindowApi {
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  onMaximizedChange: (cb: (maximized: boolean) => void) => void;
}

/** Bridge exposed by src-electron/electron-preload.ts for the embedded job-site browser. */
interface StarBrowserApi {
  create: () => Promise<boolean>;
  navigate: (url: string) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  show: (visible: boolean) => Promise<void>;
  setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void>;
}

/** Persisted job site as returned by the sites:list / sites:add IPC channels. */
interface StarSite {
  id: string;
  url: string;
  host: string;
  label: string;
  enabled: boolean;
  addedAt: number;
  /** Optional per-site username (SITEUSR-001). Null when never set. */
  username: string | null;
}

/** Bridge exposed by src-electron/electron-preload.ts for the persisted sites list. */
interface StarSitesApi {
  list: () => Promise<StarSite[]>;
  add: (input: { url: string; label?: string }) => Promise<StarSite>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  /** Persist the optional per-site username (SITEUSR-001). */
  setUsername: (id: string, username: string) => Promise<void>;
}

/** The user's single editable Profile (CVPROF-001). */
type StarWorkMode = 'Remote' | 'Hybrid' | 'On-site';
interface StarProfile {
  name: string;
  targetRole: string;
  yearsExperience: number | null;
  location: string;
  workMode: StarWorkMode;
  salaryMin: number | null;
  salaryCurrency: string;
  linkedinUrl: string;
  links: string[];
  skills: string[];
  strengthScore: number;
  updatedAt: number;
}

/** Bridge exposed by src-electron/electron-preload.ts for the singleton Profile (CVPROF-001). */
interface StarProfileApi {
  get: () => Promise<StarProfile>;
  save: (input: Partial<Omit<StarProfile, 'updatedAt'>>) => Promise<StarProfile>;
}

/** Versioned CV record returned by cv:* IPC channels (CVPROF-003). */
type StarCvMime = 'pdf' | 'docx';
interface StarCv {
  id: string;
  profileId: string;
  fileName: string;
  mime: StarCvMime;
  /** Relative, forward-slash path under the userData root (portable). */
  storagePath: string;
  parsedText: string;
  parsedFields: Record<string, unknown> | null;
  version: number;
  confidence: number | null;
  uploadedAt: number;
}

/** Payload accepted by cv:upload — the picker-resolved source file. */
interface StarCvUploadInput {
  filePath: string;
  fileName: string;
  mime: StarCvMime;
  profileId?: string;
}

/** Bridge exposed by src-electron/electron-preload.ts for versioned CVs (CVPROF-003). */
/** Result of cv:clear — counts of rows deleted and on-disk files unlinked. */
interface StarCvClearResult {
  removedRows: number;
  removedFiles: number;
}

interface StarCvApi {
  upload: (input: StarCvUploadInput) => Promise<StarCv>;
  list: (profileId?: string) => Promise<StarCv[]>;
  get: (id: string) => Promise<StarCv | null>;
  clear: (profileId?: string) => Promise<StarCvClearResult>;
}

/** Masked status payload returned by the apiKey:* IPC channels (LLM-001). */
interface StarApiKeyStatus {
  present: boolean;
  masked: string | null;
}

/** Bridge exposed by src-electron/electron-preload.ts for the OpenRouter API key. */
interface StarApiKeyApi {
  save: (rawKey: string) => Promise<StarApiKeyStatus>;
  getStatus: () => Promise<StarApiKeyStatus>;
  clear: () => Promise<void>;
}

/** Single model entry returned by the OpenRouter catalogue (LLM-002). */
interface StarModelInfo {
  id: string;
  name: string;
  contextLength: number;
  pricing: { prompt: string; completion: string };
  created: number;
}

/** Stable failure codes for the model catalogue. Mirrors LlmCatalogueErrorCode. */
type StarModelsErrorCode =
  | 'NO_API_KEY'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE';

type StarModelsResult =
  | { ok: true; models: StarModelInfo[] }
  | { ok: false; code: StarModelsErrorCode; message: string };

/** Bridge exposed by src-electron/electron-preload.ts for the OpenRouter catalogue. */
interface StarModelsApi {
  list: () => Promise<StarModelsResult>;
}

/** Structured CV fields returned by cv:structure (CVPROF-004). */
interface StarCvParsedEmployment {
  company: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  summary: string | null;
}
interface StarCvParsedEducation {
  school: string | null;
  qualification: string | null;
  startDate: string | null;
  endDate: string | null;
}
interface StarCvParsedFields {
  name: string | null;
  contact: { email: string | null; phone: string | null };
  targetRole: string | null;
  skills: string[];
  employmentHistory: StarCvParsedEmployment[];
  education: StarCvParsedEducation[];
  totalYearsExperience: number | null;
  location: string | null;
}
interface StarCvParsedConfidence {
  overall: number;
  perField: Record<string, number>;
}

/** Stable failure codes returned by cv:structure (CVPROF-004). Mirrors
 *  CvStructuringErrorCode in src-electron/cvStructurer.ts. */
type StarCvStructureErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'EMPTY_TEXT'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE'
  | 'PARSE_ERROR'
  | 'MODEL_NO_STRUCTURED_OUTPUT';

type StarCvStructureResult =
  | { ok: true; parsedFields: StarCvParsedFields; confidence: StarCvParsedConfidence }
  | { ok: false; code: StarCvStructureErrorCode; message: string };

/** Bridge exposed by src-electron/electron-preload.ts for CV LLM-structuring (CVPROF-004). */
interface StarCvStructurerApi {
  structure: (text: string) => Promise<StarCvStructureResult>;
}

/** One row of the user's preferred-model list (LLM-003). */
interface StarPreferredModel {
  slug: string;
  isDefault: boolean;
  position: number;
}

/** Typed validation errors returned by preferredModels:add (LLM-003). */
type StarPreferredModelsAddErrorCode = 'EMPTY_SLUG' | 'DUPLICATE' | 'LIMIT_REACHED';

type StarPreferredModelsAddResult =
  | { ok: true; models: StarPreferredModel[] }
  | { ok: false; code: StarPreferredModelsAddErrorCode; message: string };

/** Bridge exposed by src-electron/electron-preload.ts for the preferred-models list. */
interface StarPreferredModelsApi {
  list: () => Promise<StarPreferredModel[]>;
  add: (slug: string) => Promise<StarPreferredModelsAddResult>;
  remove: (slug: string) => Promise<StarPreferredModel[]>;
  setDefault: (slug: string) => Promise<StarPreferredModel[]>;
}

/** A single posting as returned by board:list (EXTR-006). */
interface StarBoardJob {
  sourceId: string;
  hostname: string;
  url: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  /** EXTR-013: salary verbatim from the posting, or null when not stated. */
  salary?: string | null;
  postedAt?: number | null;
  fetchedAt: number;
  status?: string;
}

/** Filter accepted by board:list. */
interface StarBoardListFilter {
  status?: string;
  excludeStatus?: string;
}

/** Summary returned by ai:extract on success. */
interface StarExtractSummary {
  imported: number;
  skipped: number;
  total: number;
  pages: number;
}

/** Progress event streamed via extract:progress (EXTR-006). Phases mirror jobExtractor.ProgressEvent. */
interface StarExtractProgressEvent {
  phase: string;
  [key: string]: unknown;
}

type StarExtractResult =
  | { ok: true; summary: StarExtractSummary }
  | { ok: false; error: string };

/** Bridge exposed by src-electron/electron-preload.ts for agentic extraction (EXTR-006). */
interface StarExtractApi {
  extract: () => Promise<StarExtractResult>;
  /** Subscribe to `extract:progress`. Returns an unsubscribe function. */
  onProgress: (cb: (event: StarExtractProgressEvent) => void) => () => void;
}

/** Bridge exposed by src-electron/electron-preload.ts for the job board (EXTR-006). */
interface StarBoardApi {
  list: (filter?: StarBoardListFilter) => Promise<StarBoardJob[]>;
  setStatus: (input: { sourceId: string; status: string }) => Promise<{ ok: true }>;
  open: (url: string) => Promise<{ ok: true }>;
  /** Wipe every imported job (EXTR-012). Cascades to match_scores +
   *  match_reviews in main so no orphaned per-job rows remain. */
  deleteAll: () => Promise<{ ok: true; deleted: number }>;
}

/** Result returned by the shell:openExternal IPC channel (JOBDET-001). */
type StarShellOpenExternalResult = { ok: true } | { ok: false; error: string };

/**
 * Bridge exposed by src-electron/electron-preload.ts for opening URLs in the
 * user's OS default browser (JOBDET-001). Only http/https schemes are honoured
 * — the main-process handler rejects file:/javascript:/etc.
 */
interface StarShellApi {
  openExternal: (url: string) => Promise<StarShellOpenExternalResult>;
}

/** The four scoring factor keys (Epic 5 §7). */
type StarMatchFactorKey = 'skills' | 'experience' | 'location' | 'salary';

/** Renderer-side mirror of the main-process `MatchFactor` shape (Epic 5 §7). */
interface StarMatchFactor {
  key: StarMatchFactorKey;
  /** False when the factor cannot be evaluated (e.g. listing states no salary). */
  included: boolean;
  /** 0-100 sub-score. Meaningless when `included === false`. */
  score: number;
  /** Normalised weight applied to this factor; 0 for excluded factors. */
  weight: number;
  /** Short, deterministic "why" string for the breakdown UI. */
  rationale: string;
}

/** Renderer-side mirror of the main-process `MatchScore` shape (Epic 5 §7). */
interface StarMatchScore {
  sourceId: string;
  stars: number;
  percent: number;
  factors: StarMatchFactor[];
  weightsVersion: string;
  stale: boolean;
  scoredAt: number;
}

/** Input to `scores:rescore`. */
interface StarScoresRescoreInput {
  mode?: 'stale' | 'unscored' | 'all';
  sourceId?: string;
}

/** Result returned by `scores:rescore`. */
interface StarScoresRescoreResult {
  ok: true;
  scored: number;
}

/** Progress event streamed via `scores:progress` (SCORE-004). */
interface StarScoresProgressEvent {
  phase: 'start' | 'progress' | 'done' | string;
  total: number;
  completed: number;
  sourceId?: string;
}

/** Bridge exposed by src-electron/electron-preload.ts for the deterministic
 *  scorer (SCORE-004 / Epic 5). Scoring is fully local — no network / model
 *  / API-key dependency reaches this surface. */
interface StarScoresApi {
  get: (sourceId: string) => Promise<StarMatchScore | null>;
  list: () => Promise<StarMatchScore[]>;
  rescore: (input?: StarScoresRescoreInput) => Promise<StarScoresRescoreResult>;
  /** Subscribe to `scores:progress`. Returns an unsubscribe function. */
  onProgress: (cb: (event: StarScoresProgressEvent) => void) => () => void;
}

/** Gap severity for the AI Match Review (AIREV-001). */
type StarReviewGapSeverity = 'blocker' | 'nice_to_have';

/** Requirement → evidence row in the AI Match Review (AIREV-001 / Epic 6 §7). */
interface StarReviewRequirement {
  requirement: string;
  /** Null when the CV/Profile does not actually support the requirement
   *  ("not found" — never invented). */
  evidence: string | null;
  met: boolean;
}

/** Classified gap with concrete mitigation (AIREV-001 / Epic 6 §7). */
interface StarReviewGap {
  text: string;
  severity: StarReviewGapSeverity;
  mitigation: string;
}

/**
 * Renderer-side mirror of the persisted AI Match Review (AIREV-001 /
 * AIREV-002). Narrative ONLY — by construction there is no number, score,
 * star rating, or percentage field anywhere in this shape (Epic 6 hard
 * boundary). The deterministic Epic 5 stars are the only rating in the UI.
 */
interface StarMatchReview {
  sourceId: string;
  archetype?: string;
  requirements: StarReviewRequirement[];
  gaps: StarReviewGap[];
  strengths: string[];
  keywords: string[];
  summary: string;
  modelSlug?: string;
  generatedAt?: number;
  /** True when the cached review may be out of date (CV / Profile changed or
   *  the job was re-extracted since generation). The narrative is still
   *  viewable; a regenerate is offered alongside. */
  stale: boolean;
}

/** Stable failure codes returned by review:generate (AIREV-003). Mirrors
 *  `ReviewErrorCode` in src-electron/reviewIpc.ts. */
type StarReviewErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'NO_CV'
  | 'JOB_NOT_FOUND'
  | 'MODEL_NOT_CAPABLE'
  | 'LLM_ERROR'
  | 'SCHEMA_ERROR';

type StarReviewGenerateResult =
  | { ok: true; review: StarMatchReview }
  | { ok: false; code: StarReviewErrorCode; error: string };

/** Bridge exposed by src-electron/electron-preload.ts for the AI Match
 *  Review (AIREV-003 / Epic 6 §8). The review is advisory and narrative-only
 *  — it never reads or writes the deterministic Epic 5 score store. */
interface StarReviewApi {
  generate: (sourceId: string) => Promise<StarReviewGenerateResult>;
  get: (sourceId: string) => Promise<StarMatchReview | null>;
}

/** Renderer-side mirror of a TAILOR-003 persisted TailoredSuggestion. */
interface StarTailoredSuggestion {
  id: string;
  type: string;
  gain: number;
  text: string;
  rationale?: string;
}

/** Renderer-side mirror of the persisted TAILOR-003 ATS report. */
interface StarTailoredAtsReport {
  score: number;
  missingKeywords: string[];
  checks?: Array<{ rule: string; passed: boolean; detail?: string }>;
}

/** Renderer-side mirror of a persisted TailoredDoc (TAILOR-003 / Epic 7 §7).
 *  Narrative + ATS only — there is NO score / star / percentage field anywhere
 *  in this shape (NFR-002 hard boundary; numeric ratings stay in Epic 5
 *  match_scores). */
type StarTailoredDocKind = 'cv' | 'cover-letter';
type StarTailorIntensity = 'light' | 'aggressive';
interface StarTailoredDoc {
  sourceId: string;
  kind: StarTailoredDocKind;
  content: string;
  suggestions: StarTailoredSuggestion[];
  atsReport: StarTailoredAtsReport;
  keywords: string[];
  intensity: StarTailorIntensity;
  baseCvId: string;
  modelSlug: string;
  generatedAt: number;
  /** True when the cached draft may be out of date (CV / Profile changed or
   *  the job was re-extracted since generation). The content is still
   *  viewable; a regenerate is offered alongside. */
  stale: boolean;
}

/** Stable failure codes returned by tailor:* IPC channels (TAILOR-004).
 *  Mirrors `TailorErrorCode` in src-electron/tailorIpc.ts. */
type StarTailorErrorCode =
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

interface StarTailorGenerateInput {
  sourceId: string;
  kind?: StarTailoredDocKind;
  intensity?: StarTailorIntensity;
}
interface StarTailorDocSelector {
  sourceId: string;
  kind: StarTailoredDocKind;
}
interface StarTailorAcceptInput {
  sourceId: string;
  kind: StarTailoredDocKind;
  suggestionId: string;
}

type StarTailorGenerateResult =
  | { ok: true; doc: StarTailoredDoc }
  | { ok: false; code: StarTailorErrorCode; error: string };

type StarTailorAcceptResult =
  | { ok: true; doc: StarTailoredDoc; scored: number }
  | { ok: false; code: StarTailorErrorCode; error: string };

type StarTailorExportResult =
  | {
      ok: true;
      format: 'markdown';
      mimeType: 'text/markdown';
      content: string;
      filename: string;
    }
  | { ok: false; code: StarTailorErrorCode; error: string };

/** Bridge exposed by src-electron/electron-preload.ts for tailoring
 *  (TAILOR-004 / Epic 7 §8). `generate` runs the structured-output tailoring
 *  call and persists the draft; `get` reads the cached draft; `accept` removes
 *  a suggestion and triggers an Epic 5 deterministic rescore (NOT the LLM);
 *  `export` returns the draft as text/Markdown — there is no submission
 *  path (FR-015). */
interface StarTailorApi {
  generate: (input: StarTailorGenerateInput) => Promise<StarTailorGenerateResult>;
  get: (input: StarTailorDocSelector) => Promise<StarTailoredDoc | null>;
  accept: (input: StarTailorAcceptInput) => Promise<StarTailorAcceptResult>;
  export: (input: StarTailorDocSelector) => Promise<StarTailorExportResult>;
}

/** Bridge exposed by src-electron/electron-preload.ts (CVPROF-011). Resolves
 *  a picked/dropped File object to its absolute filesystem path via Electron's
 *  `webUtils.getPathForFile` — a contextIsolation-safe replacement for the
 *  Electron-32-removed `File.path` property. Returns "" when no path can be
 *  resolved (synthetic Blob-backed File, test-only inputs); the renderer must
 *  treat empty as a hard upload error and not call cv:upload. */
interface StarFileApi {
  getPathForFile: (file: File) => string;
}

interface Window {
  starWindow?: StarWindowApi;
  starBrowser?: StarBrowserApi;
  starSites?: StarSitesApi;
  starProfile?: StarProfileApi;
  starFile?: StarFileApi;
  starCv?: StarCvApi;
  starCvStructurer?: StarCvStructurerApi;
  starApiKey?: StarApiKeyApi;
  starModels?: StarModelsApi;
  starPreferredModels?: StarPreferredModelsApi;
  starExtract?: StarExtractApi;
  starBoard?: StarBoardApi;
  starShell?: StarShellApi;
  starScores?: StarScoresApi;
  starReview?: StarReviewApi;
  starTailor?: StarTailorApi;
}

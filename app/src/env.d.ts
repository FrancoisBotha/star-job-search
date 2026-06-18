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
}

/** Bridge exposed by src-electron/electron-preload.ts for the persisted sites list. */
interface StarSitesApi {
  list: () => Promise<StarSite[]>;
  add: (input: { url: string; label?: string }) => Promise<StarSite>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
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
interface StarCvApi {
  upload: (input: StarCvUploadInput) => Promise<StarCv>;
  list: (profileId?: string) => Promise<StarCv[]>;
  get: (id: string) => Promise<StarCv | null>;
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

interface Window {
  starWindow?: StarWindowApi;
  starBrowser?: StarBrowserApi;
  starSites?: StarSitesApi;
  starProfile?: StarProfileApi;
  starCv?: StarCvApi;
  starCvStructurer?: StarCvStructurerApi;
  starApiKey?: StarApiKeyApi;
  starModels?: StarModelsApi;
  starPreferredModels?: StarPreferredModelsApi;
  starExtract?: StarExtractApi;
  starBoard?: StarBoardApi;
  starShell?: StarShellApi;
  starScores?: StarScoresApi;
}

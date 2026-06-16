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

interface Window {
  starWindow?: StarWindowApi;
  starBrowser?: StarBrowserApi;
  starSites?: StarSitesApi;
  starApiKey?: StarApiKeyApi;
  starModels?: StarModelsApi;
  starPreferredModels?: StarPreferredModelsApi;
  starExtract?: StarExtractApi;
  starBoard?: StarBoardApi;
}

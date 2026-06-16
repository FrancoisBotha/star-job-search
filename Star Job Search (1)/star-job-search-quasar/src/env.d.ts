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

interface Window {
  starWindow?: StarWindowApi;
  starBrowser?: StarBrowserApi;
  starSites?: StarSitesApi;
  starApiKey?: StarApiKeyApi;
  starModels?: StarModelsApi;
}

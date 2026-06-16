import { defineStore } from 'pinia';
import { MATCHES } from 'src/data/sample';
import { deriveCatalogue, type DerivedModel } from 'src/data/orModels';
import type {
  AppStatus,
  BoardListFilter,
  JobRecord,
  JobStatus,
  Match,
} from 'src/types/models';

export type AppFilter = 'All' | AppStatus;
export type TailorTab = 'cv' | 'letter';

/**
 * Renderer-side mirror of the persisted Site row returned by the
 * `sites:list` / `sites:add` IPC channels (BRWSR-002). The store keeps a
 * shallow copy so the Settings card and Discover dropdown can render
 * directly off `state.sites` without re-roundtripping to main.
 */
export type Site = StarSite;

interface ModelsError {
  code: StarModelsErrorCode;
  message: string;
}

export type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error';

/**
 * Normalised progress snapshot exposed to the UI (EXTR-007 AC2). The raw
 * StarExtractProgressEvent carries phase-specific keys (current/total,
 * imported/skipped, foundOnPage, etc.); this shape flattens the ones a
 * generic progress bar needs into a single object.
 */
export interface ExtractProgressSnapshot {
  phase: string;
  message: string | null;
  done: number | null;
  total: number | null;
}

/**
 * Cleanup handle returned by `window.starExtract.onProgress`. Held outside
 * the Pinia state so the function reference is never serialised or made
 * reactive — it only needs to live for the lifetime of the subscription.
 */
let extractProgressUnsubscribe: (() => void) | null = null;

interface AppState {
  filter: AppFilter;
  tailorTab: TailorTab;
  /** Last "Test connection" outcome from a real catalogue fetch (LLM-005). */
  connectionStatus: ConnectionStatus;
  connectionModelCount: number;
  connectionError: ModelsError | null;
  /** Masked OpenRouter API key status mirrored from `apiKey:getStatus` (LLM-001). */
  apiKeyStatus: StarApiKeyStatus;
  /** Enriched OpenRouter catalogue produced by deriveCatalogue() (LLM-002 + LLM-004). */
  models: DerivedModel[];
  modelsLoading: boolean;
  modelsLoaded: boolean;
  modelsError: ModelsError | null;
  /** User's short list of preferred model slugs mirrored from main (LLM-003). */
  preferredModels: StarPreferredModel[];
  sites: Site[];
  siteDraft: string;
  dismissed: string[];
  onbStep: number;
  // Profile / preferences
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  backupFolder: string;
  autoBackup: boolean;
  // Job board (EXTR-007)
  jobs: JobRecord[];
  isExtracting: boolean;
  extractProgress: ExtractProgressSnapshot | null;
  extractError: string | null;
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    filter: 'All',
    tailorTab: 'cv',
    connectionStatus: 'idle',
    connectionModelCount: 0,
    connectionError: null,
    apiKeyStatus: { present: false, masked: null },
    models: [],
    modelsLoading: false,
    modelsLoaded: false,
    modelsError: null,
    preferredModels: [],
    sites: [],
    siteDraft: '',
    dismissed: [],
    onbStep: 1,
    workMode: 'Remote',
    backupFolder: '~/Documents/Star Backups',
    autoBackup: true,
    jobs: [],
    isExtracting: false,
    extractProgress: null,
    extractError: null,
  }),

  getters: {
    /** Starred matches with dismissed ones filtered out. */
    visibleMatches: (state): Match[] =>
      MATCHES.filter((m) => !state.dismissed.includes(m.id)),
    matchCount(): number {
      return this.visibleMatches.length;
    },
    dismissedCount: (state): number => state.dismissed.length,
    onbProgress: (state): number => (state.onbStep / 4) * 100,
  },

  actions: {
    setFilter(f: AppFilter) {
      this.filter = f;
    },
    /**
     * Real "Test connection" — invokes `llm:listModels` via the same bridge
     * the catalogue picker uses, and stores the outcome as a tri-state. On
     * success exposes the model count so the UI can show "Connected · N
     * models available". On failure surfaces the LLM-002 error code verbatim
     * so the UI can render a specific message per NO_API_KEY / AUTH /
     * RATE_LIMITED / NETWORK without parsing exception text.
     */
    async testConnection() {
      const bridge = typeof window !== 'undefined' ? window.starModels : undefined;
      if (!bridge) return;
      this.connectionStatus = 'testing';
      this.connectionError = null;
      try {
        const result = await bridge.list();
        if (result.ok) {
          this.connectionStatus = 'ok';
          this.connectionModelCount = result.models.length;
        } else {
          this.connectionStatus = 'error';
          this.connectionError = { code: result.code, message: result.message };
          this.connectionModelCount = 0;
        }
      } catch (err) {
        this.connectionStatus = 'error';
        this.connectionError = {
          code: 'NETWORK_ERROR',
          message: err instanceof Error ? err.message : 'network error',
        };
        this.connectionModelCount = 0;
      }
    },
    /**
     * Pull the masked OpenRouter API key status from main via `apiKey:getStatus`.
     * No-ops when the preload bridge is absent (browser SPA build), mirroring
     * the [[hydrateSites]] pattern.
     */
    async hydrateApiKeyStatus() {
      const bridge = typeof window !== 'undefined' ? window.starApiKey : undefined;
      if (!bridge) return;
      this.apiKeyStatus = await bridge.getStatus();
    },
    /**
     * Save the raw key via `apiKey:save`. The raw key is consumed by main and
     * never persisted in renderer state; only the returned masked status is
     * mirrored locally.
     */
    async saveApiKey(rawKey: string) {
      const bridge = typeof window !== 'undefined' ? window.starApiKey : undefined;
      if (!bridge) return;
      this.apiKeyStatus = await bridge.save(rawKey);
    },
    /**
     * Forget the saved key via `apiKey:clear`. Resets the cached status to
     * `{ present: false, masked: null }` so the UI reflects the cleared state.
     */
    async clearApiKey() {
      const bridge = typeof window !== 'undefined' ? window.starApiKey : undefined;
      if (!bridge) return;
      await bridge.clear();
      this.apiKeyStatus = { present: false, masked: null };
    },
    /**
     * Fetch the OpenRouter model catalogue via `llm:listModels`. Manages the
     * loading / loaded / error tri-state so the Settings model picker can
     * render a spinner, the enriched list, or a stable error code without
     * branching on exception messages.
     */
    async listModels() {
      const bridge = typeof window !== 'undefined' ? window.starModels : undefined;
      if (!bridge) return;
      this.modelsLoading = true;
      this.modelsError = null;
      try {
        const result = await bridge.list();
        if (result.ok) {
          this.models = deriveCatalogue(result.models);
          this.modelsLoaded = true;
        } else {
          this.models = [];
          this.modelsError = { code: result.code, message: result.message };
          this.modelsLoaded = false;
        }
      } finally {
        this.modelsLoading = false;
      }
    },
    /**
     * Pull the persisted preferred-model list from main via `preferredModels:list`.
     */
    async hydratePreferredModels() {
      const bridge = typeof window !== 'undefined' ? window.starPreferredModels : undefined;
      if (!bridge) return;
      this.preferredModels = await bridge.list();
    },
    /**
     * Append a model slug to the preferred list via `preferredModels:add`.
     * Returns the tagged-union result verbatim so the caller can branch on
     * `EMPTY_SLUG` / `DUPLICATE` / `LIMIT_REACHED` without losing the code.
     * When the bridge is absent (browser SPA build) returns a synthetic
     * ok-false result so the caller still gets a defined value.
     */
    async addPreferredModel(slug: string): Promise<StarPreferredModelsAddResult> {
      const bridge = typeof window !== 'undefined' ? window.starPreferredModels : undefined;
      if (!bridge) {
        return { ok: false, code: 'EMPTY_SLUG', message: 'Preferred-models bridge unavailable' };
      }
      const result = await bridge.add(slug);
      if (result.ok) this.preferredModels = result.models;
      return result;
    },
    /** Remove a slug via `preferredModels:remove` and refresh state. */
    async removePreferredModel(slug: string) {
      const bridge = typeof window !== 'undefined' ? window.starPreferredModels : undefined;
      if (!bridge) return;
      this.preferredModels = await bridge.remove(slug);
    },
    /** Promote a slug to default via `preferredModels:setDefault` and refresh state. */
    async setDefaultPreferredModel(slug: string) {
      const bridge = typeof window !== 'undefined' ? window.starPreferredModels : undefined;
      if (!bridge) return;
      this.preferredModels = await bridge.setDefault(slug);
    },
    /**
     * Pull the persisted sites list from main via the `sites:list` IPC
     * channel. Called on Settings/Discover mount so the card reflects the
     * sites that survived a restart.
     */
    async hydrateSites() {
      const bridge = typeof window !== 'undefined' ? window.starSites : undefined;
      if (!bridge) return;
      const rows = await bridge.list();
      this.sites = rows;
    },
    /**
     * Persist the current draft via the `sites:add` IPC channel and append
     * the normalised Site returned by main to local state. URL normalisation
     * (scheme defaulting, host derivation) lives in main alongside the DB.
     */
    async addSite() {
      const draft = this.siteDraft;
      if (!draft.trim()) return;
      const bridge = typeof window !== 'undefined' ? window.starSites : undefined;
      if (!bridge) return;
      const site = await bridge.add({ url: draft });
      this.sites.push(site);
      this.siteDraft = '';
    },
    /**
     * Remove a persisted site by id via the `sites:remove` IPC channel,
     * then drop it from local state.
     */
    async removeSite(id: string) {
      const bridge = typeof window !== 'undefined' ? window.starSites : undefined;
      if (bridge) await bridge.remove(id);
      this.sites = this.sites.filter((s) => s.id !== id);
    },
    /**
     * Fetch the extracted job postings via `board:list`. Optional filter is
     * passed through verbatim so callers can request only e.g. unseen jobs.
     * No-ops when the bridge is absent (browser SPA build).
     */
    async listJobs(filter?: BoardListFilter) {
      const bridge = typeof window !== 'undefined' ? window.starBoard : undefined;
      if (!bridge) return;
      const rows = await bridge.list(filter);
      this.jobs = rows;
    },
    /**
     * Flip a job posting's status via `board:setStatus` (EXTR-006). Mirrors
     * the change into the local cache so the UI updates without a re-list.
     */
    async setJobStatus(input: { sourceId: string; status: JobStatus | string }) {
      const bridge = typeof window !== 'undefined' ? window.starBoard : undefined;
      if (!bridge) return;
      await bridge.setStatus(input);
      const job = this.jobs.find((j) => j.sourceId === input.sourceId);
      if (job) job.status = input.status;
    },
    /**
     * Open a job posting in the embedded browser via `view:open` (EXTR-006).
     */
    async openJob(url: string) {
      const bridge = typeof window !== 'undefined' ? window.starBoard : undefined;
      if (!bridge) return;
      await bridge.open(url);
    },
    /**
     * Trigger an agentic extraction run via `ai:extract` (EXTR-006). Reflects
     * the run's ok/error outcome on the store: `isExtracting` is true for the
     * duration of the call, and `extractError` carries the failure message on
     * an ok:false result. The tagged-union result is returned verbatim so the
     * caller can branch on it if needed.
     */
    async triggerExtract(): Promise<StarExtractResult | undefined> {
      const bridge = typeof window !== 'undefined' ? window.starExtract : undefined;
      if (!bridge) return undefined;
      this.isExtracting = true;
      this.extractError = null;
      try {
        const result = await bridge.extract();
        if (!result.ok) this.extractError = result.error;
        return result;
      } finally {
        this.isExtracting = false;
      }
    },
    /**
     * Subscribe to `extract:progress` events via `window.starExtract.onProgress`.
     * Updates `extractProgress` (phase, message, done/total) and the
     * `isExtracting` flag as events arrive, and stashes the cleanup function
     * for [[unsubscribeExtractProgress]].
     */
    subscribeExtractProgress() {
      const bridge = typeof window !== 'undefined' ? window.starExtract : undefined;
      if (!bridge) return;
      if (extractProgressUnsubscribe) {
        extractProgressUnsubscribe();
        extractProgressUnsubscribe = null;
      }
      extractProgressUnsubscribe = bridge.onProgress((event) => {
        const e = event as Record<string, unknown>;
        const phase = String(e.phase ?? '');
        const message =
          typeof e.message === 'string' ? e.message : null;
        const done =
          typeof e.current === 'number'
            ? e.current
            : typeof e.imported === 'number'
              ? e.imported
              : typeof e.newCount === 'number'
                ? e.newCount
                : typeof e.foundOnPage === 'number'
                  ? e.foundOnPage
                  : null;
        const total = typeof e.total === 'number' ? e.total : null;
        this.extractProgress = { phase, message, done, total };
        if (phase === 'done' || phase === 'error') {
          this.isExtracting = false;
        } else {
          this.isExtracting = true;
        }
      });
    },
    /**
     * Tear down the progress subscription created by
     * [[subscribeExtractProgress]]. Safe to call when no subscription is
     * active.
     */
    unsubscribeExtractProgress() {
      if (extractProgressUnsubscribe) {
        extractProgressUnsubscribe();
        extractProgressUnsubscribe = null;
      }
    },
    dismissMatch(id: string) {
      if (!this.dismissed.includes(id)) this.dismissed.push(id);
    },
    resetDismissed() {
      this.dismissed = [];
    },
    onbNext() {
      this.onbStep = Math.min(4, this.onbStep + 1);
    },
    onbBack() {
      this.onbStep = Math.max(1, this.onbStep - 1);
    },
    onbReset() {
      this.onbStep = 1;
    },
  },
});

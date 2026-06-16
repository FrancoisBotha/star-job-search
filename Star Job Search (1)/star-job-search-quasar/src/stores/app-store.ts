import { defineStore } from 'pinia';
import { MATCHES, SAMPLE_API_KEY } from 'src/data/sample';
import type { AppStatus, Match } from 'src/types/models';

export type AppFilter = 'All' | AppStatus;
export type TailorTab = 'cv' | 'letter';

/**
 * Renderer-side mirror of the persisted Site row returned by the
 * `sites:list` / `sites:add` IPC channels (BRWSR-002). The store keeps a
 * shallow copy so the Settings card and Discover dropdown can render
 * directly off `state.sites` without re-roundtripping to main.
 */
export type Site = StarSite;

interface AppState {
  filter: AppFilter;
  tailorTab: TailorTab;
  keyVisible: boolean;
  apiKey: string;
  tested: boolean;
  sites: Site[];
  siteDraft: string;
  dismissed: string[];
  onbStep: number;
  // Profile / preferences
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  backupFolder: string;
  autoBackup: boolean;
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    filter: 'All',
    tailorTab: 'cv',
    keyVisible: false,
    apiKey: SAMPLE_API_KEY,
    tested: false,
    sites: [],
    siteDraft: '',
    dismissed: [],
    onbStep: 1,
    workMode: 'Remote',
    backupFolder: '~/Documents/Star Backups',
    autoBackup: true,
  }),

  getters: {
    /** Starred matches with dismissed ones filtered out. */
    visibleMatches: (state): Match[] =>
      MATCHES.filter((m) => !state.dismissed.includes(m.id)),
    matchCount(): number {
      return this.visibleMatches.length;
    },
    dismissedCount: (state): number => state.dismissed.length,
    keyDisplay: (state): string =>
      state.keyVisible ? state.apiKey : 'sk-or-v1-' + '•'.repeat(24),
    onbProgress: (state): number => (state.onbStep / 4) * 100,
  },

  actions: {
    setFilter(f: AppFilter) {
      this.filter = f;
    },
    toggleKey() {
      this.keyVisible = !this.keyVisible;
    },
    testConnection() {
      this.tested = true;
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

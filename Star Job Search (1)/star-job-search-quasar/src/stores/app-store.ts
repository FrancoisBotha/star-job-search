import { defineStore } from 'pinia';
import { MATCHES, SAMPLE_API_KEY } from 'src/data/sample';
import type { AppStatus, Match } from 'src/types/models';

export type AppFilter = 'All' | AppStatus;
export type TailorTab = 'cv' | 'letter';

interface AppState {
  filter: AppFilter;
  tailorTab: TailorTab;
  keyVisible: boolean;
  apiKey: string;
  tested: boolean;
  sites: string[];
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
    sites: ['rolehub.com', 'workscout.io', 'talentstream.com'],
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
      state.keyVisible ? state.apiKey : 'sk-or-v1-' + '\u2022'.repeat(24),
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
    addSite() {
      const v = this.siteDraft.trim();
      if (!v) return;
      this.sites.push(v.replace(/^https?:\/\//, '').replace(/\/$/, ''));
      this.siteDraft = '';
    },
    removeSite(i: number) {
      this.sites.splice(i, 1);
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

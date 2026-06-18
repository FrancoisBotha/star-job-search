import { defineStore } from 'pinia';
import { MATCHES } from 'src/data/sample';
import { deriveCatalogue, type DerivedModel } from 'src/data/orModels';
import type {
  AppStatus,
  BoardListFilter,
  JobRecord,
  JobStatus,
  Match,
  MatchFactor,
  MatchScore,
} from 'src/types/models';

export type { MatchFactor, MatchScore };

/**
 * Renderer-side mirror of the persisted AI Match Review (AIREV-001 /
 * AIREV-002 / Epic 6 §7) — narrative ONLY (no number/score field by
 * construction). Re-export of the ambient [[StarMatchReview]] shape so
 * callers can import it from a single module alongside the store.
 */
export type MatchReview = StarMatchReview;

/**
 * Per-job generate state for the AI Match Review (AIREV-004 / Epic 6 §8).
 * `idle` is the resting state; `loading` while the structured-output call
 * is in flight; `error` carries the stable [[StarReviewErrorCode]]
 * (NO_API_KEY / NO_DEFAULT_MODEL / NO_CV / JOB_NOT_FOUND /
 * MODEL_NOT_CAPABLE / LLM_ERROR / SCHEMA_ERROR) so the UI can render the
 * matching message without parsing exception text (FR-006 / NFR-004).
 */
export interface MatchReviewGenerateState {
  status: 'idle' | 'loading' | 'error';
  code: StarReviewErrorCode | null;
  message: string | null;
}

/**
 * localStorage key for the Epic 4 "what is sent" disclosure acknowledgement.
 * The AI Match Review (Epic 6 / AIREV-004) reuses the same flag so the first
 * send of JD + CV text to the model is gated behind the same one-time
 * disclosure the CV review uses (FR-005 — no new disclosure copy).
 */
const REVIEW_DISCLOSURE_KEY = 'star.cvDisclosure.ack.v1';

const IDLE_REVIEW_STATE: MatchReviewGenerateState = {
  status: 'idle',
  code: null,
  message: null,
};

/** ★4+ threshold for the strong-match selector (Epic 5 §3, AC §10). */
const STRONG_MATCH_STAR_THRESHOLD = 4;

/**
 * Normalised progress snapshot for the scoring run (Epic 5 §3). Mirrors
 * the `scores:progress` event streamed from main — phase ('start' |
 * 'progress' | 'done'), batch totals, and the current sourceId when a
 * single job completes mid-batch.
 */
export interface ScoreProgressSnapshot {
  phase: string;
  total: number;
  completed: number;
  sourceId: string | null;
}

/**
 * Cleanup handle returned by `window.starScores.onProgress`. Held outside
 * Pinia state so the function reference is never serialised or made
 * reactive — same pattern as [[extractProgressUnsubscribe]].
 */
let scoresProgressUnsubscribe: (() => void) | null = null;

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
 * Current parse/structure status for the latest CV (CVPROF-005). `idle` is
 * the resting state, `extracting` is set while raw text extraction runs,
 * `structuring` while the LLM call is in flight, `ready` on success, and
 * `error` when either step fails.
 */
export type CvParseStatus =
  | 'idle'
  | 'extracting'
  | 'structuring'
  | 'ready'
  | 'error';

/**
 * One row in the profile-strength rubric (CVPROF-005 AC4). The rubric is
 * exposed verbatim so the Profile screen can render "what raises your
 * strength" alongside the bar (FR-009).
 */
export interface StrengthRubricItem {
  field: keyof StarProfile;
  label: string;
  points: number;
  /** Scoring-relevant fields are the ones gated by the minimum-scorable
   *  check (FR-010); editing one of these marks scores stale. */
  scoringRelevant: boolean;
  achieved: boolean;
}

/** Profile fields whose change invalidates existing scores (FR-010 AC5). */
const SCORING_RELEVANT_FIELDS = new Set<keyof StarProfile>([
  'targetRole',
  'skills',
  'location',
  'workMode',
  'yearsExperience',
  'salaryMin',
  'salaryCurrency',
]);

/** Per-field point allocations for the strength rubric. Sums to 100. */
const STRENGTH_RUBRIC: ReadonlyArray<{
  field: keyof StarProfile;
  label: string;
  points: number;
}> = [
  { field: 'targetRole', label: 'Target role', points: 20 },
  { field: 'skills', label: 'Skills', points: 20 },
  { field: 'location', label: 'Location', points: 15 },
  { field: 'workMode', label: 'Work mode', points: 10 },
  { field: 'yearsExperience', label: 'Years of experience', points: 10 },
  { field: 'linkedinUrl', label: 'LinkedIn profile', points: 10 },
  { field: 'salaryMin', label: 'Salary expectation', points: 5 },
  { field: 'links', label: 'Portfolio / personal links', points: 5 },
  { field: 'name', label: 'Name', points: 5 },
];

/** Minimum-scorable fields per FR-010 — target role + ≥1 skill + location + work mode. */
const MIN_SCORABLE_FIELDS: ReadonlyArray<keyof StarProfile> = [
  'targetRole',
  'skills',
  'location',
  'workMode',
];

/**
 * Predicate: is the given field "set" on the profile? Strings count when
 * non-empty after trim, arrays when non-empty, numbers when non-null, and
 * `workMode` always counts because it has a sensible default ('Remote') —
 * the user cannot leave it unset.
 */
function isProfileFieldSet(profile: StarProfile | null, field: keyof StarProfile): boolean {
  if (!profile) return false;
  const value = profile[field];
  if (field === 'workMode') return typeof value === 'string' && value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return true;
  return false;
}

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
  // Profile / preferences (CVPROF-005)
  /** Persisted Profile mirrored from main via `profile:get` / `profile:save`. */
  profile: StarProfile | null;
  profileLoaded: boolean;
  /**
   * Top-level mirror of `profile.workMode` retained so the existing
   * ProfilePage binding (`store.workMode = m`) continues to work without
   * modifying that page (which lives in a separate ticket's scope). The
   * persistence-on-edit path is [[setWorkMode]]; direct mutation only
   * updates renderer state, the same as before CVPROF-005.
   */
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  backupFolder: string;
  autoBackup: boolean;
  // CV (CVPROF-005)
  cvs: StarCv[];
  currentCv: StarCv | null;
  cvParseStatus: CvParseStatus;
  cvParseError: string | null;
  /**
   * True when a scoring-relevant Profile field has been edited since the
   * last (future-epic) re-score. CVPROF-005 only *sets* this flag — the
   * actual re-score is the scoring epic's job (FR-010 scope boundary).
   */
  scoresStale: boolean;
  // Job board (EXTR-007)
  jobs: JobRecord[];
  isExtracting: boolean;
  extractProgress: ExtractProgressSnapshot | null;
  extractError: string | null;
  /**
   * Persisted MatchScore rows keyed by `sourceId` (Epic 5 §7). Hydrated
   * via `window.starScores.list` / refreshed per-row via
   * `window.starScores.get` as scoring progress events arrive.
   */
  scores: Record<string, MatchScore>;
  /** True while a `scores:rescore` batch is in flight. */
  isScoring: boolean;
  /** Latest `scores:progress` snapshot — drives the rescore progress UI. */
  scoreProgress: ScoreProgressSnapshot | null;
  /**
   * Persisted MatchReview rows keyed by `sourceId` (AIREV-004 / Epic 6 §8).
   * Narrative only — by hard boundary (Epic 6) no score/star/percent appears
   * in this map. Hydrated lazily via [[getReview]] and refreshed on
   * [[generateReview]] success.
   */
  reviews: Record<string, MatchReview>;
  /**
   * Per-job generate state keyed by `sourceId`. Tracks
   * idle / loading / error (with the stable error code) so the Job-detail
   * modal can render specific messages for NO_API_KEY, MODEL_NOT_CAPABLE,
   * LLM_ERROR, etc. (FR-006 / NFR-004).
   */
  reviewStates: Record<string, MatchReviewGenerateState>;
  /**
   * Renderer mirror of the Epic 4 disclosure acknowledgement (AIREV-004 /
   * FR-005). True once the user has acknowledged "what is sent" — the
   * AI Match Review reuses the same one-time flag so the first JD + CV
   * send is gated. Synced from / written to `localStorage` via
   * [[hydrateReviewDisclosure]] / [[acknowledgeReviewDisclosure]].
   */
  reviewDisclosureAcknowledged: boolean;
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
    profile: null,
    profileLoaded: false,
    workMode: 'Remote',
    backupFolder: '~/Documents/Star Backups',
    autoBackup: true,
    cvs: [],
    currentCv: null,
    cvParseStatus: 'idle',
    cvParseError: null,
    scoresStale: false,
    jobs: [],
    isExtracting: false,
    extractProgress: null,
    extractError: null,
    scores: {},
    isScoring: false,
    scoreProgress: null,
    reviews: {},
    reviewStates: {},
    reviewDisclosureAcknowledged: false,
  }),

  getters: {
    /** Starred matches with dismissed ones filtered out. */
    visibleMatches: (state): Match[] =>
      MATCHES.filter((m) => !state.dismissed.includes(m.id)),
    matchCount(): number {
      return this.visibleMatches.length;
    },
    dismissedCount: (state): number => state.dismissed.length,
    /**
     * Imported jobs surfaced on the board view (EXTR-009 AC1). Hides
     * `not_interested` postings by default and orders newest-first by
     * `fetchedAt` so the most recent imports lead the list.
     */
    visibleJobs: (state): JobRecord[] =>
      [...state.jobs]
        .filter((j) => j.status !== 'not_interested')
        .sort((a, b) => b.fetchedAt - a.fetchedAt),
    /** Count of jobs hidden by the `not_interested` status (EXTR-009 AC1). */
    notInterestedCount: (state): number =>
      state.jobs.filter((j) => j.status === 'not_interested').length,
    /**
     * Jobs the user has starred — the curated shortlist surfaced on the
     * Starred page. Newest-first. Starring is just a `status` flip to
     * `'starred'` via [[setJobStatus]], so a starred job stays on the Job
     * Board (it is not `not_interested`) while also appearing here.
     */
    starredJobs: (state): JobRecord[] =>
      state.jobs
        .filter((j) => j.status === 'starred')
        .sort((a, b) => b.fetchedAt - a.fetchedAt),
    /** Count of starred jobs — drives the Starred sidebar badge. */
    starredCount: (state): number =>
      state.jobs.filter((j) => j.status === 'starred').length,
    /**
     * Active job sites — the ones rendered as tabs on the Discover page.
     * A site is active unless its `enabled` flag has been toggled off in
     * Settings.
     */
    enabledSites: (state): Site[] => state.sites.filter((s) => s.enabled),
    onbProgress: (state): number => (state.onbStep / 4) * 100,
    /**
     * Per-field strength rubric (CVPROF-005 AC4 / FR-009). Exposed verbatim
     * so the Profile screen can render "what raises your strength" beside
     * the bar. Each entry carries the field, label, point allocation, the
     * scoring-relevance flag, and whether the current profile satisfies it.
     */
    strengthRubric: (state): StrengthRubricItem[] =>
      STRENGTH_RUBRIC.map((row) => ({
        field: row.field,
        label: row.label,
        points: row.points,
        scoringRelevant: SCORING_RELEVANT_FIELDS.has(row.field),
        achieved: isProfileFieldSet(state.profile, row.field),
      })),
    /**
     * Profile strength as a 0-100 integer (FR-009). Returns 0 until the
     * profile has been persisted at least once (`updatedAt > 0`) so a fresh
     * install doesn't display points for default fields the user has not
     * confirmed.
     */
    profileStrength(): number {
      const profile = this.profile;
      if (!profile || profile.updatedAt === 0) return 0;
      let total = 0;
      for (const item of this.strengthRubric) {
        if (item.achieved) total += item.points;
      }
      return total;
    },
    /**
     * Names of the minimum-scorable fields (target role + ≥1 skill +
     * location + work mode per FR-010) that are not yet set. Empty array
     * means the profile clears the gate.
     */
    missingScoringFields: (state): Array<keyof StarProfile> =>
      MIN_SCORABLE_FIELDS.filter((f) => !isProfileFieldSet(state.profile, f)),
    /** True when the profile clears the minimum-scorable gate (FR-010). */
    isScorable(): boolean {
      return this.missingScoringFields.length === 0;
    },
    /**
     * Jobs whose score clears the ★4+ strong-match threshold (Epic 5 §3,
     * AC §10). Returns the underlying [[JobRecord]]s — augmented with the
     * matching MatchScore via [[scores]] when a tile needs the percent/
     * factors — so Board / Starred / Dashboard tiles can render directly.
     */
    strongMatches: (state): JobRecord[] =>
      state.jobs.filter((j) => {
        const score = state.scores[j.sourceId];
        return !!score && score.stars >= STRONG_MATCH_STAR_THRESHOLD;
      }),
    /** Count of strong matches — drives the Dashboard "STRONG" stat (FR-010). */
    strongMatchCount(): number {
      return this.strongMatches.length;
    },
    /**
     * Jobs ordered by their MatchScore percent (descending) — drives the
     * Dashboard "Top matches today" list and the Job Board's strong-first
     * ordering (Epic 5 §6, FR-010). Unscored jobs sort last.
     */
    topMatches: (state): JobRecord[] => {
      const scored = (j: JobRecord) => state.scores[j.sourceId]?.percent ?? -1;
      return [...state.jobs].sort((a, b) => scored(b) - scored(a));
    },
    /**
     * True iff a cached AI Match Review exists for the given job
     * (AIREV-004 AC2). Drives the "Generate review" vs "Show review" toggle
     * in the Job-detail modal.
     */
    hasReview: (state) => (sourceId: string): boolean =>
      Boolean(state.reviews[sourceId]),
    /**
     * Provenance ("AI review · {model} · {date}") for the cached review
     * (AIREV-004 AC2 / Epic 6 §6). Returns `null` when no review is cached
     * for the given sourceId.
     */
    reviewProvenance:
      (state) =>
      (sourceId: string): { modelSlug?: string; generatedAt?: number } | null => {
        const r = state.reviews[sourceId];
        if (!r) return null;
        const out: { modelSlug?: string; generatedAt?: number } = {};
        if (r.modelSlug !== undefined) out.modelSlug = r.modelSlug;
        if (r.generatedAt !== undefined) out.generatedAt = r.generatedAt;
        return out;
      },
    /**
     * True when the cached review's `stale` flag is set — drives the
     * "may be out of date — regenerate" badge (Epic 6 §6 / FR-004).
     */
    isReviewStale: (state) => (sourceId: string): boolean =>
      Boolean(state.reviews[sourceId]?.stale),
    /**
     * Per-job generate state lookup (AIREV-004 AC1 / AC3). Always returns a
     * defined snapshot so the Job-detail modal can render without nullish
     * guards — defaults to the shared `idle` constant.
     */
    reviewGenerateStateFor:
      (state) =>
      (sourceId: string): MatchReviewGenerateState =>
        state.reviewStates[sourceId] ?? IDLE_REVIEW_STATE,
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
     * Toggle whether a site is active (shown as a tab on Discover) via the
     * `sites:setEnabled` channel, mirroring the change into local state so the
     * Settings toggle and the Discover tab strip update without a re-list.
     */
    async setSiteEnabled(id: string, enabled: boolean) {
      const bridge = typeof window !== 'undefined' ? window.starSites : undefined;
      if (bridge) await bridge.setEnabled(id, enabled);
      const site = this.sites.find((s) => s.id === id);
      if (site) site.enabled = enabled;
    },
    /**
     * Persist the optional per-site username via the `sites:setUsername`
     * channel (SITEUSR-001) and mirror the value into the local cache so the
     * Settings input reflects it without a re-list. No-ops gracefully when the
     * bridge is absent (browser SPA build), mirroring [[setSiteEnabled]].
     */
    async setSiteUsername(id: string, username: string) {
      const bridge = typeof window !== 'undefined' ? window.starSites : undefined;
      if (bridge) await bridge.setUsername(id, username);
      const site = this.sites.find((s) => s.id === id);
      if (site) site.username = username;
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
     * Open a URL in the user's OS default browser via the `shell:openExternal`
     * IPC channel (JOBDET-001). The main-process handler validates the scheme
     * and opens only http/https. No-ops gracefully when the bridge is absent
     * (browser SPA build), mirroring [[hydrateSites]] / [[openJob]]. Distinct
     * from [[openJob]], which navigates the embedded Discover browser via
     * `view:open` and is left unchanged.
     */
    async openExternal(url: string) {
      const bridge = typeof window !== 'undefined' ? window.starShell : undefined;
      if (!bridge) return;
      await bridge.openExternal(url);
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
    /**
     * Flip every currently-hidden job back to `new` (EXTR-009 AC3). Mirrors
     * the Starred page's "Restore N hidden" affordance — used after a user
     * has marked one or more postings `not_interested` and wants them back
     * in the default view. Each row is persisted via `board:setStatus` so
     * the change survives a restart; the local cache is updated in lockstep.
     */
    async restoreNotInterested() {
      const bridge = typeof window !== 'undefined' ? window.starBoard : undefined;
      if (!bridge) return;
      const toRestore = this.jobs.filter((j) => j.status === 'not_interested');
      for (const job of toRestore) {
        await bridge.setStatus({ sourceId: job.sourceId, status: 'new' });
        job.status = 'new';
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
    /**
     * Pull the persisted Profile singleton from main via `profile:get`
     * (CVPROF-005 AC1). Syncs the top-level `workMode` mirror so the
     * existing ProfilePage binding stays consistent with the persisted
     * value across a restart. No-ops when the preload bridge is absent.
     */
    async loadProfile() {
      const bridge = typeof window !== 'undefined' ? window.starProfile : undefined;
      if (!bridge) return;
      const profile = await bridge.get();
      this.profile = profile;
      this.workMode = profile.workMode;
      this.profileLoaded = true;
    },
    /**
     * Persist a partial Profile edit via `profile:save` (CVPROF-005 AC1).
     * The patch is forwarded verbatim — main merges, bumps `updatedAt`, and
     * returns the new row. If any scoring-relevant field changed, the
     * `scoresStale` flag is set (FR-010 AC5); CVPROF-005 only marks stale,
     * the re-score itself belongs to the scoring epic.
     */
    async saveProfile(patch: Partial<Omit<StarProfile, 'updatedAt'>>) {
      const bridge = typeof window !== 'undefined' ? window.starProfile : undefined;
      if (!bridge) return;
      const next = await bridge.save(patch);
      this.profile = next;
      this.workMode = next.workMode;
      for (const key of Object.keys(patch) as Array<keyof StarProfile>) {
        if (SCORING_RELEVANT_FIELDS.has(key)) {
          this.scoresStale = true;
          break;
        }
      }
    },
    /**
     * Convenience setter for the work-mode toggle on the Profile screen.
     * Mirrors the legacy `store.workMode = m` binding pattern but routes
     * through [[saveProfile]] so the change persists and the staleness
     * flag is flipped (AC5).
     */
    async setWorkMode(mode: 'Remote' | 'Hybrid' | 'On-site') {
      await this.saveProfile({ workMode: mode });
    },
    /**
     * Fetch every persisted CV version via `cv:list` (CVPROF-005 AC2).
     * Sets `cvs` to the full history and pins `currentCv` to the highest
     * version (most recent upload) so the Profile card can render "latest
     * CV" without re-sorting.
     */
    async listCvs() {
      const bridge = typeof window !== 'undefined' ? window.starCv : undefined;
      if (!bridge) return;
      const rows = await bridge.list();
      this.cvs = rows;
      this.currentCv = rows.length
        ? [...rows].sort((a, b) => b.version - a.version)[0] ?? null
        : null;
    },
    /**
     * Upload a new CV via `cv:upload` (CVPROF-005 AC2 / FR-006). Re-uploads
     * always create a new version row — main never overwrites in place — so
     * this is also the "Replace" path; [[replaceCv]] is an alias for clarity
     * on the Profile screen.
     */
    async uploadCv(input: StarCvUploadInput): Promise<StarCv | null> {
      const bridge = typeof window !== 'undefined' ? window.starCv : undefined;
      if (!bridge) return null;
      this.cvParseStatus = 'extracting';
      this.cvParseError = null;
      const cv = await bridge.upload(input);
      this.cvs.push(cv);
      this.currentCv = cv;
      return cv;
    },
    /**
     * Alias of [[uploadCv]] for the "Replace" affordance on the Profile
     * screen — calling out the versioned-replace semantics in the call
     * site without duplicating the underlying flow (FR-006).
     */
    async replaceCv(input: StarCvUploadInput): Promise<StarCv | null> {
      return this.uploadCv(input);
    },
    /**
     * Fetch a specific CV version by id via `cv:get`. Returns null when
     * the bridge is absent or the row doesn't exist; the caller decides
     * whether that's an error or a soft miss.
     */
    async getCv(id: string): Promise<StarCv | null> {
      const bridge = typeof window !== 'undefined' ? window.starCv : undefined;
      if (!bridge) return null;
      return bridge.get(id);
    },
    /**
     * Structure raw CV text into Profile fields via `cv:structure` — the
     * first OpenRouter completion call (CVPROF-004). Updates `cvParseStatus`
     * (`structuring` → `ready` / `error`) and surfaces the failure message
     * on `cvParseError` so the review step can show a stable code-driven
     * message (no-key, rate-limited, etc.) without parsing exception text.
     */
    /**
     * Hydrate every persisted MatchScore via `scores:list` (SCORE-005 AC1).
     * Replaces `state.scores` with a fresh map keyed by `sourceId` so the
     * strong-match selectors reflect what main currently has.
     */
    async listScores() {
      const bridge = typeof window !== 'undefined' ? window.starScores : undefined;
      if (!bridge) return;
      const rows = await bridge.list();
      const next: Record<string, MatchScore> = {};
      for (const row of rows) next[row.sourceId] = row as MatchScore;
      this.scores = next;
    },
    /**
     * Refresh a single MatchScore via `scores:get` (SCORE-005 AC1). Inserts
     * the row into `state.scores` when present so per-row progress events
     * can keep the cache hot without re-listing every entry. Returns the
     * MatchScore (or null when none exists for the given sourceId).
     */
    async getScore(sourceId: string): Promise<MatchScore | null> {
      const bridge = typeof window !== 'undefined' ? window.starScores : undefined;
      if (!bridge) return null;
      const row = await bridge.get(sourceId);
      if (row) this.scores[sourceId] = row as MatchScore;
      return (row as MatchScore | null) ?? null;
    },
    /**
     * Trigger a (re)score batch via `scores:rescore` (SCORE-005 AC4).
     * Defaults to the "stale + unscored" mode handled by main. Sets
     * `isScoring` for the duration of the call and clears the
     * `scoresStale` flag on a successful return so the Profile screen's
     * "Scores out of date" banner dismisses itself. The `scores:progress`
     * subscription is the source of truth for per-row updates; this only
     * reflects the request/response cycle.
     */
    async rescore(
      input?: StarScoresRescoreInput,
    ): Promise<StarScoresRescoreResult | undefined> {
      const bridge = typeof window !== 'undefined' ? window.starScores : undefined;
      if (!bridge) return undefined;
      this.isScoring = true;
      try {
        const result = await bridge.rescore(input);
        if (result.ok) this.scoresStale = false;
        return result;
      } finally {
        this.isScoring = false;
      }
    },
    /**
     * Subscribe to `scores:progress` events (SCORE-005 AC5). Mirrors the
     * progress snapshot on `state.scoreProgress`, flips `isScoring` on
     * 'start' / off on 'done', and refreshes affected scores reactively:
     * a `progress` event with a sourceId re-fetches just that row via
     * [[getScore]]; a `done` event re-lists every score via [[listScores]]
     * so the strong-match selectors see the final state.
     */
    subscribeScoresProgress() {
      const bridge = typeof window !== 'undefined' ? window.starScores : undefined;
      if (!bridge) return;
      if (scoresProgressUnsubscribe) {
        scoresProgressUnsubscribe();
        scoresProgressUnsubscribe = null;
      }
      scoresProgressUnsubscribe = bridge.onProgress((event) => {
        const phase = String(event.phase ?? '');
        this.scoreProgress = {
          phase,
          total: typeof event.total === 'number' ? event.total : 0,
          completed: typeof event.completed === 'number' ? event.completed : 0,
          sourceId: typeof event.sourceId === 'string' ? event.sourceId : null,
        };
        if (phase === 'done') {
          this.isScoring = false;
          void this.listScores().catch(() => {});
        } else if (phase === 'start' || phase === 'progress') {
          this.isScoring = true;
          if (phase === 'progress' && typeof event.sourceId === 'string') {
            void this.getScore(event.sourceId).catch(() => {});
          }
        }
      });
    },
    /** Tear down the progress subscription created by [[subscribeScoresProgress]]. */
    unsubscribeScoresProgress() {
      if (scoresProgressUnsubscribe) {
        scoresProgressUnsubscribe();
        scoresProgressUnsubscribe = null;
      }
    },
    /**
     * Mark every cached score stale (SCORE-005 AC5). Used by the Epic 4
     * profile-change hook: when a scoring-relevant field is edited, the
     * top-level flag flips *and* each row's `stale` flag flips so a tile
     * can show a "stale" badge before the user triggers a re-score.
     */
    markScoresStale() {
      this.scoresStale = true;
      for (const id of Object.keys(this.scores)) {
        const row = this.scores[id];
        if (row) this.scores[id] = { ...row, stale: true };
      }
    },
    /**
     * Read the Epic 4 "what is sent" disclosure acknowledgement from
     * `localStorage` (AIREV-004 / FR-005). The AI Match Review reuses the
     * same one-time flag so the first JD + CV send is gated behind the
     * existing disclosure — no new copy. Safe in non-browser contexts
     * (defensive about a missing `window` / `localStorage`).
     */
    hydrateReviewDisclosure() {
      try {
        const w =
          typeof window !== 'undefined'
            ? (window as Window & { localStorage?: Storage })
            : undefined;
        const ack = w?.localStorage?.getItem(REVIEW_DISCLOSURE_KEY) === '1';
        this.reviewDisclosureAcknowledged = ack;
      } catch {
        this.reviewDisclosureAcknowledged = false;
      }
    },
    /**
     * Persist the Epic 4 disclosure acknowledgement (AIREV-004 / FR-005)
     * and flip the renderer flag. Idempotent — calling it twice is a
     * no-op. The same key is read by the Onboarding CV review screen so
     * acknowledging it from the Job-detail modal also satisfies the CV
     * review's first-send gate.
     */
    acknowledgeReviewDisclosure() {
      this.reviewDisclosureAcknowledged = true;
      try {
        const w =
          typeof window !== 'undefined'
            ? (window as Window & { localStorage?: Storage })
            : undefined;
        w?.localStorage?.setItem(REVIEW_DISCLOSURE_KEY, '1');
      } catch {
        /* swallow — disclosure is best-effort persisted */
      }
    },
    /**
     * Hydrate a single review from main via `review:get` (AIREV-004 AC1).
     * Inserts the row into `state.reviews` keyed by `sourceId` so the
     * provenance / stale selectors update without re-fetching. Returns the
     * persisted review (or null when none exists / the bridge is absent).
     */
    async getReview(sourceId: string): Promise<MatchReview | null> {
      const bridge = typeof window !== 'undefined' ? window.starReview : undefined;
      if (!bridge) return null;
      const row = await bridge.get(sourceId);
      if (row) this.reviews[sourceId] = row;
      return row;
    },
    /**
     * Generate (or regenerate) the AI Match Review for a job via
     * `review:generate` (AIREV-004 AC1 / AC3). Manages the per-job state
     * machine (idle → loading → idle on success / error with code on
     * failure) and stores the persisted review keyed by `sourceId` on
     * success.
     *
     * **Disclosure gate (FR-005).** The first send of JD + CV text is
     * gated behind the Epic 4 "what is sent" disclosure — when
     * [[reviewDisclosureAcknowledged]] is false this action no-ops without
     * reaching the bridge. Callers (the Job-detail modal) are expected to
     * present the disclosure and call [[acknowledgeReviewDisclosure]]
     * before re-trying.
     */
    async generateReview(
      sourceId: string,
    ): Promise<StarReviewGenerateResult | undefined> {
      const bridge = typeof window !== 'undefined' ? window.starReview : undefined;
      if (!bridge) return undefined;
      if (!this.reviewDisclosureAcknowledged) {
        this.hydrateReviewDisclosure();
        if (!this.reviewDisclosureAcknowledged) return undefined;
      }
      this.reviewStates[sourceId] = {
        status: 'loading',
        code: null,
        message: null,
      };
      try {
        const result = await bridge.generate(sourceId);
        if (result.ok) {
          this.reviews[sourceId] = result.review;
          this.reviewStates[sourceId] = {
            status: 'idle',
            code: null,
            message: null,
          };
        } else {
          this.reviewStates[sourceId] = {
            status: 'error',
            code: result.code,
            message: result.error,
          };
        }
        return result;
      } catch (err) {
        this.reviewStates[sourceId] = {
          status: 'error',
          code: 'LLM_ERROR',
          message: err instanceof Error ? err.message : 'review failed',
        };
        return { ok: false, code: 'LLM_ERROR', error: 'review failed' };
      }
    },
    async structureCv(text: string): Promise<StarCvStructureResult | null> {
      const bridge = typeof window !== 'undefined' ? window.starCvStructurer : undefined;
      if (!bridge) return null;
      this.cvParseStatus = 'structuring';
      this.cvParseError = null;
      const result = await bridge.structure(text);
      if (result.ok) {
        this.cvParseStatus = 'ready';
      } else {
        this.cvParseStatus = 'error';
        this.cvParseError = result.message;
      }
      return result;
    },
  },
});

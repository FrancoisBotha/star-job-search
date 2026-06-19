// Domain models for Star Job Search.

export type AppStatus = 'Saved' | 'Applied' | 'Interviewing' | 'Offer' | 'Rejected';

/**
 * Status flags for an extracted job posting (EXTR-007). Mirrors the
 * main-process contract used by `board:setStatus` (extraction.ts) and the
 * `jobs.status` column in `star.db`. The set is intentionally open-string in
 * the persistence layer; this union enumerates the values the renderer uses.
 */
export type JobStatus =
  | 'new'
  | 'seen'
  | 'starred'
  | 'not_interested'
  | 'saved'
  | 'applied'
  | 'hidden';

/**
 * Renderer-side mirror of the main-process JobRecord (src-electron/jobs.ts).
 * Returned by `window.starBoard.list()` (EXTR-006) and stored in the app
 * store under `state.jobs`.
 */
export interface JobRecord {
  sourceId: string;
  hostname: string;
  url: string;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  description?: string | null;
  /** Salary string as stated on the posting (e.g. "£70k–£90k"), or null when
   *  the posting states none. EXTR-013: never fabricated by the extractor. */
  salary?: string | null;
  postedAt?: number | null;
  fetchedAt: number;
  status?: JobStatus | string;
}

/** Filter accepted by `window.starBoard.list()`. */
export interface BoardListFilter {
  status?: JobStatus | string;
  excludeStatus?: JobStatus | string;
}

/** A tracked application row in the Applications history. */
export interface Application {
  mono: string;
  role: string;
  co: string;
  loc: string;
  score: number;
  status: AppStatus;
  applied: string;
  updated: string;
}

/** The four scoring factor keys (Epic 5 §7). */
export type FactorKey = 'skills' | 'experience' | 'location' | 'salary';

/**
 * Renderer-side mirror of the main-process `MatchFactor` shape (Epic 5 §7).
 * Each factor carries a 0-100 sub-score, its normalised weight, an
 * included/excluded flag (false when the factor can't be evaluated, e.g.
 * the listing states no salary), and a deterministic human-readable
 * rationale for the breakdown UI.
 */
export interface MatchFactor {
  key: FactorKey;
  included: boolean;
  score: number;
  weight: number;
  rationale: string;
}

/**
 * Renderer-side mirror of the main-process `MatchScore` shape (Epic 5 §7),
 * keyed by `sourceId` (the job board row's id). The long-promised type
 * referenced since Epic 1 §7; supersedes the legacy mock [[Match]] type
 * below for any scored-jobs surface.
 */
export interface MatchScore {
  sourceId: string;
  stars: number;
  percent: number;
  factors: MatchFactor[];
  weightsVersion: string;
  stale: boolean;
  scoredAt: number;
}

/**
 * @deprecated Superseded by real scored jobs (`JobRecord` + `MatchScore`)
 * once Epic 5's scorer is on every consumer. Retained only for the legacy
 * Starred-page mock-data path until those screens are migrated.
 */
export interface Match {
  id: string;
  mono: string;
  role: string;
  co: string;
  loc: string;
  salary: string;
  score: number;
  tag: string;
  why: string;
}

/** A live-scan source shown on the Dashboard / Discover. */
export interface ScanSource {
  name: string;
  count: number | string;
  progress: number; // 0–100
  state: 'done' | 'running' | 'queued';
}

/** A Star tailoring suggestion. */
export interface Suggestion {
  kind: 'Keyword' | 'Reword' | 'Surface gap';
  gain: string;
  text: string;
}

export const STATUS_PILL: Record<AppStatus, { bg: string; fg: string }> = {
  Saved:        { bg: '#efece4', fg: '#8a8472' },
  Applied:      { bg: '#f3e6dd', fg: '#a8552d' },
  Interviewing: { bg: '#eaeede', fg: '#5f6b3a' },
  Offer:        { bg: '#e2efe4', fg: '#3f7a52' },
  Rejected:     { bg: '#efece6', fg: '#a39d8e' },
};

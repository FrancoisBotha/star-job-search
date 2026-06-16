// Domain models for Star Job Search.

export type AppStatus = 'Saved' | 'Applied' | 'Interviewing' | 'Offer' | 'Rejected';

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

/** A potential job match surfaced on the Starred page. */
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

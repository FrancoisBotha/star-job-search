/**
 * Scoring IPC runtime (SCORE-004 / Epic 5 §3, §8).
 *
 * Wires the deterministic scorer (SCORE-001/002) and the match-scores store
 * (SCORE-003) into the renderer via IPC. Three channels:
 *
 *   scores:get      — fetch one MatchScore by sourceId (null if none).
 *   scores:list     — fetch every persisted MatchScore.
 *   scores:rescore  — batch (re)score jobs. Modes:
 *                       'stale'    (default) — stale + unscored jobs
 *                       'unscored' — only jobs with no row yet
 *                       'all'      — every job on the board
 *                     A single { sourceId } targets one job (used by the
 *                     post-extraction re-extract → re-score path, FR-006).
 *
 * Progress streams over the `scores:progress` channel ({ phase, total,
 * completed, sourceId }). The runner yields between jobs with `setImmediate`
 * so a batch over hundreds of postings never blocks the main thread / UI
 * thread (FR-007, NFR-004).
 *
 * Scoring is entirely local (FR-008, NFR-002): no OpenRouter / network /
 * model / API-key dependency reaches this module — the deps interface
 * intentionally exposes only the jobs/profile/scores stores.
 *
 * `isScoringRelevantProfileChange` is the gate the Epic 4 profile-save hook
 * uses to decide whether to flip prior scores stale; this module owns it so
 * the rule (which fields actually feed the four factors) stays alongside the
 * scorer rather than drifting in the profile module.
 */
import type { IpcMain } from 'electron';

import type { JobRecord, JobsStore } from './jobs';
import type { MatchScoresStore } from './matchScores';
import type { ProfileRecord } from './profile';
import {
  DEFAULT_WEIGHTS,
  score,
  type FactorEvaluator,
  type FactorKey,
  type MatchScore,
  type ScorerWeights,
  type ScoringListing,
  type ScoringProfile,
} from './scorer';
import { defaultFactorEvaluators } from './scorerFactors';

/** Channel the main process streams scoring progress over. The preload bridge
 *  subscribes to this same name. */
export const SCORES_PROGRESS_CHANNEL = 'scores:progress';

export type RescoreMode = 'stale' | 'unscored' | 'all';

export interface ScoringProgressEvent {
  phase: 'start' | 'progress' | 'done';
  total: number;
  completed: number;
  sourceId?: string;
}

export interface ScoringRescoreInput {
  mode?: RescoreMode;
  /** Re-score a single job (used by the per-job re-extract path, FR-006). */
  sourceId?: string;
}

export interface ScoringRescoreResult {
  ok: true;
  scored: number;
}

export interface ScoringDeps {
  scoresStore: MatchScoresStore;
  jobsStore: JobsStore;
  /** Pulled per batch so the freshest Profile is used (CV upload, edit, etc.). */
  getProfile: () => ProfileRecord;
  /** Optional override — defaults to DEFAULT_WEIGHTS / WEIGHTS_VERSION. */
  weights?: ScorerWeights;
  /** Optional override — defaults to the four-factor evaluators from SCORE-002. */
  evaluators?: Record<FactorKey, FactorEvaluator>;
  /** Stamp `scoredAt` on persistence. Injected so the pure `score()` function
   *  stays clock-free and tests stay deterministic. */
  now?: () => number;
  /** Emit a progress event on the scoring progress channel (e.g.
   *  `mainWindow.webContents.send(SCORES_PROGRESS_CHANNEL, e)`). */
  emitProgress: (event: ScoringProgressEvent) => void;
}

function jobToListing(j: JobRecord): ScoringListing {
  return {
    sourceId: j.sourceId,
    title: j.title ?? null,
    description: j.description ?? null,
    location: j.location ?? null,
    salary: j.salary ?? null,
  };
}

function profileToScoringProfile(p: ProfileRecord): ScoringProfile {
  return {
    skills: p.skills ?? [],
    yearsExperience: p.yearsExperience,
    location: p.location,
    workMode: p.workMode,
    salaryMin: p.salaryMin,
    salaryCurrency: p.salaryCurrency,
  };
}

export interface ScoringRunner {
  /** Score only jobs that have no MatchScore row yet (post-extraction hook). */
  scoreNewJobs(): Promise<{ scored: number }>;
  /** (Re)score jobs by mode. 'stale' (default) covers stale + unscored. */
  rescore(mode?: RescoreMode): Promise<{ scored: number }>;
  /** Re-score one job (per-listing re-extract path, FR-006). */
  rescoreOne(sourceId: string): Promise<{ scored: number }>;
}

/**
 * Create the scoring runner. The runner is reusable across IPC invocations
 * and across the post-extraction hook; it pulls the current Profile per batch
 * so a CV upload or profile edit takes effect on the next run.
 */
export function createScoringRunner(deps: ScoringDeps): ScoringRunner {
  const weights = deps.weights ?? DEFAULT_WEIGHTS;
  const evaluators = deps.evaluators ?? defaultFactorEvaluators;
  const now = deps.now ?? (() => Date.now());

  function selectJobs(mode: RescoreMode): JobRecord[] {
    const allJobs = deps.jobsStore.listJobs();
    if (mode === 'all') return allJobs;
    const existing = new Map(deps.scoresStore.list().map((s) => [s.sourceId, s]));
    if (mode === 'unscored') {
      return allJobs.filter((j) => !existing.has(j.sourceId));
    }
    // 'stale' covers both stale and unscored.
    return allJobs.filter((j) => {
      const e = existing.get(j.sourceId);
      return !e || e.stale;
    });
  }

  async function scoreJobs(jobs: JobRecord[]): Promise<{ scored: number }> {
    const profile = profileToScoringProfile(deps.getProfile());
    const total = jobs.length;
    deps.emitProgress({ phase: 'start', total, completed: 0 });
    let completed = 0;
    for (const job of jobs) {
      const computed = score(jobToListing(job), profile, weights, evaluators);
      const persisted: MatchScore = {
        ...computed,
        scoredAt: now(),
        stale: false,
      };
      deps.scoresStore.upsert(persisted);
      completed++;
      deps.emitProgress({
        phase: 'progress',
        total,
        completed,
        sourceId: job.sourceId,
      });
      // Yield between jobs so the main thread / UI thread stays responsive
      // (NFR-004). Without this, a batch over hundreds of jobs would run as
      // a single uninterruptible microtask chain.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    deps.emitProgress({ phase: 'done', total, completed });
    return { scored: completed };
  }

  return {
    scoreNewJobs() {
      return scoreJobs(selectJobs('unscored'));
    },
    rescore(mode: RescoreMode = 'stale') {
      return scoreJobs(selectJobs(mode));
    },
    rescoreOne(sourceId: string) {
      const job = deps.jobsStore.listJobs().find((j) => j.sourceId === sourceId);
      if (!job) {
        deps.emitProgress({ phase: 'start', total: 0, completed: 0 });
        deps.emitProgress({ phase: 'done', total: 0, completed: 0 });
        return Promise.resolve({ scored: 0 });
      }
      return scoreJobs([job]);
    },
  };
}

/**
 * Register the scoring IPC channels. The handlers are `async` so even though
 * the underlying scorer is synchronous, control returns to the event loop
 * immediately and the renderer's UI thread is never blocked (NFR-004).
 */
export function registerScoringIpc(ipcMain: IpcMain, deps: ScoringDeps): void {
  const runner = createScoringRunner(deps);

  ipcMain.handle('scores:get', async (_event, sourceId: string) => {
    if (typeof sourceId !== 'string' || !sourceId) return null;
    const row = deps.scoresStore.get(sourceId);
    return row ?? null;
  });

  ipcMain.handle('scores:list', async () => deps.scoresStore.list());

  ipcMain.handle(
    'scores:rescore',
    async (_event, input?: ScoringRescoreInput): Promise<ScoringRescoreResult> => {
      if (input && typeof input.sourceId === 'string' && input.sourceId) {
        const r = await runner.rescoreOne(input.sourceId);
        return { ok: true, scored: r.scored };
      }
      const mode: RescoreMode = input?.mode ?? 'stale';
      const r = await runner.rescore(mode);
      return { ok: true, scored: r.scored };
    },
  );
}

// --- Profile-change relevance gate (FR-006 / AC6) -------------------------

/**
 * True if `prev` and `next` differ on any Profile field that actually feeds
 * one of the four scoring factors — skills, yearsExperience, location,
 * workMode, salaryMin, salaryCurrency. The Epic 4 profile-save hook calls
 * this to decide whether to flip prior scores `stale`; non-scoring edits
 * (name, targetRole, linkedinUrl, links, strengthScore) leave scores alone
 * so the user isn't surprised by a re-score after a typo fix.
 */
export function isScoringRelevantProfileChange(
  prev: ProfileRecord,
  next: ProfileRecord,
): boolean {
  if (prev.yearsExperience !== next.yearsExperience) return true;
  if (prev.location !== next.location) return true;
  if (prev.workMode !== next.workMode) return true;
  if (prev.salaryMin !== next.salaryMin) return true;
  if (prev.salaryCurrency !== next.salaryCurrency) return true;
  const prevSkills = prev.skills ?? [];
  const nextSkills = next.skills ?? [];
  if (prevSkills.length !== nextSkills.length) return true;
  for (let i = 0; i < prevSkills.length; i++) {
    if (prevSkills[i] !== nextSkills[i]) return true;
  }
  return false;
}

/**
 * Unit tests for the scoring IPC runtime (SCORE-004 / Epic 5).
 *
 * Acceptance criteria covered:
 *  - AC1: registerScoringIpc registers scores:get, scores:list, scores:rescore
 *         and emits batch progress on the scoring progress channel.
 *  - AC2: starScores preload bridge (get/list/rescore/onProgress) is declared
 *         in electron-preload.ts; env.d.ts declares Window.starScores +
 *         MatchScore/MatchFactor renderer types.
 *  - AC3 / FR-006: a "score new jobs" path is exposed for the post-extraction
 *         hook — unscored jobs become scored; re-extracting a job re-scores it
 *         when rescore is invoked with mode='all' or after markStale on the
 *         affected sourceId.
 *  - AC4: on-demand rescore covers stale + unscored jobs and reports per-job
 *         progress over the scoring progress channel (start / progress / done).
 *  - AC5 / NFR-004: scoring yields between jobs so the main thread / UI thread
 *         stays responsive during a batch.
 *  - AC6 / FR-006: isScoringRelevantProfileChange detects edits to any of
 *         skills, yearsExperience, location, workMode, salaryMin,
 *         salaryCurrency — the gate used to flip prior scores stale.
 *  - AC7 / FR-008 / NFR-002: scoring runs with no API key, no model selected,
 *         and no network — the runtime depends only on jobs/profile/scores.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobRecord } from '../jobs';
import type { MatchScore } from '../scorer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '..', 'src');

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Fake IPC -------------------------------------------------------------

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

// --- Fake stores ----------------------------------------------------------

function makeJobs(): JobRecord[] {
  return [
    {
      sourceId: 'j1',
      hostname: 'jobs.example.com',
      url: 'https://jobs.example.com/1',
      title: 'Senior TypeScript Engineer',
      company: 'Acme',
      location: 'Remote',
      description: '5+ years TypeScript and React experience. Remote.',
      postedAt: null,
      fetchedAt: 1,
      status: 'new',
    },
    {
      sourceId: 'j2',
      hostname: 'jobs.example.com',
      url: 'https://jobs.example.com/2',
      title: 'Junior Python Engineer',
      company: 'Initech',
      location: 'New York',
      description: '1+ year of Python. On-site.',
      postedAt: null,
      fetchedAt: 2,
      status: 'new',
    },
  ];
}

function makeJobsStore(jobs: JobRecord[] = makeJobs()) {
  return {
    knownSourceIds: () => new Set(jobs.map((j) => j.sourceId)),
    upsertJobs: () => 0,
    listJobs: () => jobs,
    setStatus: vi.fn(),
    getSiteProfile: () => undefined,
    saveSiteProfile: vi.fn(),
  };
}

function makeScoresStore() {
  const rows = new Map<string, MatchScore>();
  return {
    rows,
    get: (id: string) => rows.get(id),
    list: () => Array.from(rows.values()),
    upsert: (s: MatchScore) => {
      rows.set(s.sourceId, { ...s });
    },
    markStale: (ids: string | string[]) => {
      const arr = Array.isArray(ids) ? ids : [ids];
      for (const id of arr) {
        const row = rows.get(id);
        if (row) row.stale = true;
      }
    },
  };
}

function makeProfile() {
  return {
    name: 'F',
    targetRole: '',
    yearsExperience: 6,
    location: 'Remote',
    workMode: 'Remote' as const,
    salaryMin: null,
    salaryCurrency: 'USD',
    linkedinUrl: '',
    links: [],
    skills: ['TypeScript', 'React'],
    strengthScore: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../scoring');
}

// --- AC1 / AC4: channels + scores:rescore + progress ----------------------

describe('registerScoringIpc — channel registration (AC1)', () => {
  it('registers scores:get, scores:list, scores:rescore', async () => {
    const { registerScoringIpc } = await importModule();
    const progress: unknown[] = [];
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: makeScoresStore() as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: (e) => progress.push(e),
    });
    for (const ch of ['scores:get', 'scores:list', 'scores:rescore']) {
      expect(ipcHandlers.has(ch), `missing handler ${ch}`).toBe(true);
    }
  });

  it('exports a SCORES_PROGRESS_CHANNEL constant for the renderer to subscribe to', async () => {
    const mod = await importModule();
    expect(typeof (mod as Record<string, unknown>).SCORES_PROGRESS_CHANNEL).toBe('string');
    expect((mod as { SCORES_PROGRESS_CHANNEL: string }).SCORES_PROGRESS_CHANNEL).toMatch(/score/i);
  });
});

describe('scores:get / scores:list (AC1)', () => {
  it('scores:get returns the persisted MatchScore for a sourceId, or null if none', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    scores.upsert({
      sourceId: 'j1',
      stars: 4,
      percent: 75,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 1,
    });
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    const got = (await ipcHandlers.get('scores:get')!({}, 'j1')) as MatchScore;
    expect(got.sourceId).toBe('j1');
    expect(got.percent).toBe(75);
    const miss = await ipcHandlers.get('scores:get')!({}, 'nope');
    expect(miss).toBeNull();
  });

  it('scores:list returns every persisted MatchScore', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    scores.upsert({
      sourceId: 'a',
      stars: 3,
      percent: 50,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 0,
    });
    scores.upsert({
      sourceId: 'b',
      stars: 4,
      percent: 75,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 0,
    });
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    const all = (await ipcHandlers.get('scores:list')!({})) as MatchScore[];
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.sourceId).sort()).toEqual(['a', 'b']);
  });
});

describe('scores:rescore — batch progress + persistence (AC1, AC4, AC5)', () => {
  it('rescore (default mode) scores stale + unscored jobs and emits start/progress/done', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    const events: Array<{ phase: string; total?: number; completed?: number }> = [];
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      now: () => 12345,
      emitProgress: (e) => events.push(e),
    });
    const result = (await ipcHandlers.get('scores:rescore')!({})) as { ok: true; scored: number };
    expect(result.ok).toBe(true);
    expect(result.scored).toBe(2);
    // Both jobs got a row.
    expect(scores.rows.size).toBe(2);
    // scoredAt comes from the injected clock; stale flips back to false.
    for (const row of scores.rows.values()) {
      expect(row.scoredAt).toBe(12345);
      expect(row.stale).toBe(false);
    }
    // First event is start, last is done; progress events tally up to total.
    expect(events[0]).toMatchObject({ phase: 'start', total: 2 });
    expect(events[events.length - 1]).toMatchObject({ phase: 'done', total: 2, completed: 2 });
    const progressEvents = events.filter((e) => e.phase === 'progress');
    expect(progressEvents.length).toBe(2);
    expect(progressEvents[0]!.completed).toBe(1);
    expect(progressEvents[1]!.completed).toBe(2);
  });

  it('rescore only picks up stale + unscored jobs in the default mode', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    // j1 already has a FRESH score — it should NOT be re-scored in stale mode.
    scores.upsert({
      sourceId: 'j1',
      stars: 5,
      percent: 99,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 1,
    });
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    const result = (await ipcHandlers.get('scores:rescore')!({}, {})) as { scored: number };
    expect(result.scored).toBe(1);
    expect(scores.get('j1')!.percent).toBe(99); // untouched
    expect(scores.get('j2')).toBeDefined();
  });

  it('rescore with mode="all" re-scores every job (FR-006 — covers re-extracted jobs)', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    scores.upsert({
      sourceId: 'j1',
      stars: 5,
      percent: 99,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 1,
    });
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    const result = (await ipcHandlers.get('scores:rescore')!({}, { mode: 'all' })) as {
      scored: number;
    };
    expect(result.scored).toBe(2);
    // j1 was re-scored — the previous 99 is gone.
    expect(scores.get('j1')!.percent).not.toBe(99);
  });

  it('rescore with a sourceId re-scores just that one job', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    const result = (await ipcHandlers.get('scores:rescore')!({}, { sourceId: 'j2' })) as {
      scored: number;
    };
    expect(result.scored).toBe(1);
    expect(scores.get('j1')).toBeUndefined();
    expect(scores.get('j2')).toBeDefined();
  });

  it('yields between jobs so the UI thread stays responsive (NFR-004 / AC5)', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    // Make a bigger batch so we can observe yielding.
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      sourceId: `j${i}`,
      hostname: 'x',
      url: `https://x/${i}`,
      title: 'T',
      company: 'C',
      location: 'Remote',
      description: 'desc',
      postedAt: null,
      fetchedAt: i,
      status: 'new',
    })) satisfies JobRecord[];
    registerScoringIpc(fakeIpcMain as never, {
      scoresStore: scores as never,
      jobsStore: makeJobsStore(jobs) as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    // Kick off the rescore but do NOT await yet — verify the first batch tick
    // hasn't already completed synchronously (i.e. it actually yields).
    const promise = ipcHandlers.get('scores:rescore')!({}, {});
    // Microtask flush — if scoring were a tight synchronous loop this would
    // already see all 5 rows.
    await Promise.resolve();
    expect(scores.rows.size).toBeLessThan(5);
    const result = (await promise) as { scored: number };
    expect(result.scored).toBe(5);
    expect(scores.rows.size).toBe(5);
  });
});

// --- AC7: offline / no AI key needed --------------------------------------

describe('scoring is fully offline (AC7 / FR-008 / NFR-002)', () => {
  it('runs with no API key, no model, and no network — no provider deps are required', async () => {
    const { registerScoringIpc } = await importModule();
    const scores = makeScoresStore();
    // Deliberately omit getApiKey / getDefaultModel — scoring must not need them.
    const deps = {
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    };
    registerScoringIpc(fakeIpcMain as never, deps);
    const result = (await ipcHandlers.get('scores:rescore')!({}, {})) as { ok: true };
    expect(result.ok).toBe(true);
    expect(scores.rows.size).toBe(2);
    // And just to make doubly sure: nothing in the deps interface is a
    // function whose absence would have aborted the run.
    expect(scores.get('j1')).toBeDefined();
  });
});

// --- AC3 / FR-006: post-extraction "score new jobs" path -------------------

describe('post-extraction hook — score only the new/unscored jobs (AC3 / FR-006)', () => {
  it('createScoringRunner.scoreNewJobs scores ONLY jobs that have no prior MatchScore', async () => {
    const { createScoringRunner } = await importModule();
    const scores = makeScoresStore();
    scores.upsert({
      sourceId: 'j1',
      stars: 4,
      percent: 80,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 1,
    });
    const runner = createScoringRunner({
      scoresStore: scores as never,
      jobsStore: makeJobsStore() as never,
      getProfile: () => makeProfile(),
      emitProgress: () => {},
    });
    const r = await runner.scoreNewJobs();
    expect(r.scored).toBe(1); // only j2 was unscored
    expect(scores.get('j1')!.percent).toBe(80); // untouched
    expect(scores.get('j2')).toBeDefined();
  });
});

// --- AC6 / FR-006: profile-change relevance gate --------------------------

describe('isScoringRelevantProfileChange — Epic 4 hook gate (AC6 / FR-006)', () => {
  it('detects edits to scoring-relevant fields', async () => {
    const { isScoringRelevantProfileChange } = await importModule();
    const base = makeProfile();
    expect(isScoringRelevantProfileChange(base, base)).toBe(false);
    expect(
      isScoringRelevantProfileChange(base, { ...base, skills: ['TypeScript', 'Vue'] }),
    ).toBe(true);
    expect(
      isScoringRelevantProfileChange(base, { ...base, yearsExperience: 7 }),
    ).toBe(true);
    expect(
      isScoringRelevantProfileChange(base, { ...base, location: 'Berlin' }),
    ).toBe(true);
    expect(
      isScoringRelevantProfileChange(base, { ...base, workMode: 'Hybrid' }),
    ).toBe(true);
    expect(
      isScoringRelevantProfileChange(base, { ...base, salaryMin: 100000 }),
    ).toBe(true);
    expect(
      isScoringRelevantProfileChange(base, { ...base, salaryCurrency: 'EUR' }),
    ).toBe(true);
  });

  it('ignores edits to non-scoring fields (name, targetRole, linkedinUrl, links, strengthScore)', async () => {
    const { isScoringRelevantProfileChange } = await importModule();
    const base = makeProfile();
    expect(
      isScoringRelevantProfileChange(base, { ...base, name: 'Other' }),
    ).toBe(false);
    expect(
      isScoringRelevantProfileChange(base, { ...base, targetRole: 'PM' }),
    ).toBe(false);
    expect(
      isScoringRelevantProfileChange(base, { ...base, linkedinUrl: 'https://x' }),
    ).toBe(false);
    expect(
      isScoringRelevantProfileChange(base, { ...base, links: ['x'] }),
    ).toBe(false);
    expect(
      isScoringRelevantProfileChange(base, { ...base, strengthScore: 42 }),
    ).toBe(false);
  });
});

// --- AC2: preload + env.d.ts surfacing ------------------------------------

describe('preload + env.d.ts — window.starScores bridge (AC2)', () => {
  it('preload exposes starScores with get / list / rescore / onProgress', () => {
    const preload = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starScores['"]/);
    expect(preload).toMatch(/['"]scores:get['"]/);
    expect(preload).toMatch(/['"]scores:list['"]/);
    expect(preload).toMatch(/['"]scores:rescore['"]/);
    expect(preload).toMatch(/['"]scores:progress['"]/);
    expect(preload).toMatch(/onProgress/);
  });

  it('env.d.ts declares Window.starScores + MatchScore + MatchFactor types', () => {
    const env = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(env).toMatch(/starScores\??:/);
    expect(env).toMatch(/StarMatchScore\b/);
    expect(env).toMatch(/StarMatchFactor\b/);
    // The bridge surface must declare get / list / rescore / onProgress.
    expect(env).toMatch(/StarScoresApi\b/);
    expect(env).toMatch(/onProgress/);
  });
});

/**
 * Unit tests for SCORE-005 — app-store scores state, types, selectors, and
 * rescore action + progress wiring.
 *
 * Covers:
 *  - AC1: scores keyed by sourceId, hydrated via window.starScores.list/get
 *  - AC2: renderer-side MatchScore / MatchFactor types mirror the main contract
 *  - AC3: strong-match (★4+) + top-matches (ordered-by-score) selectors
 *  - AC4: rescore action invokes scores:rescore and reflects progress + clears stale
 *  - AC5: scores update reactively on progress events (completion / mark stale)
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord, MatchScore, MatchFactor } from 'src/types/models';

type ScoresProgressEvent = {
  phase: 'start' | 'progress' | 'done' | string;
  total: number;
  completed: number;
  sourceId?: string;
};

type ProgressCb = (e: ScoresProgressEvent) => void;

function installBridges(opts: {
  scores?: {
    get?: (sourceId: string) => Promise<MatchScore | null>;
    list?: () => Promise<MatchScore[]>;
    rescore?: (input?: { mode?: 'stale' | 'unscored' | 'all'; sourceId?: string }) => Promise<{ ok: true; scored: number }>;
    onProgress?: (cb: ProgressCb) => () => void;
  };
} = {}) {
  const w: Record<string, unknown> = {};
  if (opts.scores) w.starScores = opts.scores;
  (globalThis as { window?: unknown }).window = w;
  return w;
}

function makeScore(sourceId: string, stars: number, percent: number, stale = false): MatchScore {
  const factors: MatchFactor[] = [
    { key: 'skills', included: true, score: percent, weight: 1, rationale: 'matched skills' },
    { key: 'experience', included: false, score: 0, weight: 0, rationale: 'not stated' },
    { key: 'location', included: true, score: percent, weight: 0, rationale: 'matches' },
    { key: 'salary', included: false, score: 0, weight: 0, rationale: 'not stated' },
  ];
  return {
    sourceId,
    stars,
    percent,
    factors,
    weightsVersion: 'v1',
    stale,
    scoredAt: 1000,
  };
}

function makeJob(sourceId: string): JobRecord {
  return {
    sourceId,
    hostname: 'example.com',
    url: `https://example.com/${sourceId}`,
    title: `Job ${sourceId}`,
    company: 'Acme',
    location: 'Remote',
    description: null,
    postedAt: null,
    fetchedAt: 1000,
    status: 'new',
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — scores hydration (AC1)', () => {
  it('listScores() calls window.starScores.list and stores by sourceId', async () => {
    const rows = [makeScore('a', 5, 95), makeScore('b', 3, 60)];
    const list = vi.fn(async () => rows);
    installBridges({ scores: { list } });
    const store = useAppStore();
    await store.listScores();
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.scores['a']?.percent).toBe(95);
    expect(store.scores['b']?.stars).toBe(3);
    expect(Object.keys(store.scores).sort()).toEqual(['a', 'b']);
  });

  it('getScore() calls window.starScores.get and inserts the row into state', async () => {
    const score = makeScore('only', 4, 80);
    const get = vi.fn(async (_id: string) => score);
    installBridges({ scores: { get } });
    const store = useAppStore();
    const result = await store.getScore('only');
    expect(get).toHaveBeenCalledWith('only');
    expect(result?.sourceId).toBe('only');
    expect(store.scores['only']).toEqual(score);
  });

  it('listScores() no-ops when starScores bridge is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    await expect(store.listScores()).resolves.toBeUndefined();
    expect(store.scores).toEqual({});
  });
});

describe('renderer-side MatchScore / MatchFactor types (AC2)', () => {
  it('MatchScore / MatchFactor are exported from src/types/models', () => {
    const score: MatchScore = makeScore('x', 4, 80);
    const factor: MatchFactor = score.factors[0]!;
    expect(score.weightsVersion).toBe('v1');
    expect(factor.key).toBe('skills');
  });
});

describe('app-store — strong-match + top-matches selectors (AC3)', () => {
  it('strongMatches returns only jobs with stars >= 4', async () => {
    const list = vi.fn(async () => [
      makeScore('a', 5, 95),
      makeScore('b', 4, 80),
      makeScore('c', 3, 60),
      makeScore('d', 1, 20),
    ]);
    installBridges({ scores: { list } });
    const store = useAppStore();
    store.jobs = [makeJob('a'), makeJob('b'), makeJob('c'), makeJob('d')];
    await store.listScores();
    const ids = store.strongMatches.map((m) => m.sourceId).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('strongMatchCount mirrors strongMatches.length for the Dashboard STRONG stat', async () => {
    const list = vi.fn(async () => [makeScore('a', 5, 95), makeScore('b', 2, 40)]);
    installBridges({ scores: { list } });
    const store = useAppStore();
    store.jobs = [makeJob('a'), makeJob('b')];
    await store.listScores();
    expect(store.strongMatchCount).toBe(1);
  });

  it('topMatches returns jobs sorted by score descending', async () => {
    const list = vi.fn(async () => [
      makeScore('a', 3, 60),
      makeScore('b', 5, 95),
      makeScore('c', 4, 80),
    ]);
    installBridges({ scores: { list } });
    const store = useAppStore();
    store.jobs = [makeJob('a'), makeJob('b'), makeJob('c')];
    await store.listScores();
    const ordered = store.topMatches.map((m) => m.sourceId);
    expect(ordered).toEqual(['b', 'c', 'a']);
  });
});

describe('app-store — rescore action + progress (AC4)', () => {
  it('rescore() invokes window.starScores.rescore, sets isScoring during the call, and clears scoresStale on success', async () => {
    let resolveRun: (v: { ok: true; scored: number }) => void = () => {};
    const rescore = vi.fn(
      () =>
        new Promise<{ ok: true; scored: number }>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const list = vi.fn(async () => [makeScore('a', 5, 95)]);
    installBridges({ scores: { rescore, list } });
    const store = useAppStore();
    store.scoresStale = true;

    const p = store.rescore({ mode: 'stale' });
    expect(store.isScoring).toBe(true);
    resolveRun({ ok: true, scored: 1 });
    const result = await p;

    expect(rescore).toHaveBeenCalledWith({ mode: 'stale' });
    expect(store.isScoring).toBe(false);
    expect(store.scoresStale).toBe(false);
    expect(result).toEqual({ ok: true, scored: 1 });
  });

  it('rescore() no-ops gracefully when the bridge is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    const result = await store.rescore();
    expect(result).toBeUndefined();
    expect(store.isScoring).toBe(false);
  });

  it('subscribeScoresProgress() reflects progress events on state.scoreProgress', () => {
    let captured: ProgressCb | null = null;
    const onProgress = vi.fn((cb: ProgressCb) => {
      captured = cb;
      return () => {};
    });
    installBridges({ scores: { onProgress } });
    const store = useAppStore();
    store.subscribeScoresProgress();

    expect(onProgress).toHaveBeenCalledTimes(1);
    captured!({ phase: 'start', total: 3, completed: 0 });
    expect(store.scoreProgress?.phase).toBe('start');
    expect(store.scoreProgress?.total).toBe(3);
    expect(store.isScoring).toBe(true);

    captured!({ phase: 'progress', total: 3, completed: 2, sourceId: 'a' });
    expect(store.scoreProgress?.completed).toBe(2);

    captured!({ phase: 'done', total: 3, completed: 3 });
    expect(store.isScoring).toBe(false);
  });
});

describe('app-store — reactive updates on scoring completion / stale (AC5)', () => {
  it('refreshes scores via list() when a progress "done" event arrives', async () => {
    let captured: ProgressCb | null = null;
    const list = vi.fn(async () => [makeScore('a', 5, 95)]);
    const onProgress = vi.fn((cb: ProgressCb) => {
      captured = cb;
      return () => {};
    });
    installBridges({ scores: { list, onProgress } });
    const store = useAppStore();
    store.subscribeScoresProgress();

    captured!({ phase: 'done', total: 1, completed: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(list).toHaveBeenCalled();
  });

  it('refreshes a single score via get() on a "progress" event with a sourceId', async () => {
    let captured: ProgressCb | null = null;
    const get = vi.fn(async (id: string) => makeScore(id, 4, 80));
    const onProgress = vi.fn((cb: ProgressCb) => {
      captured = cb;
      return () => {};
    });
    installBridges({ scores: { get, onProgress } });
    const store = useAppStore();
    store.subscribeScoresProgress();

    captured!({ phase: 'progress', total: 2, completed: 1, sourceId: 'a' });
    await Promise.resolve();
    await Promise.resolve();
    expect(get).toHaveBeenCalledWith('a');
  });

  it('markScoresStale() flips the scoresStale flag and tags every cached score stale', async () => {
    const list = vi.fn(async () => [makeScore('a', 5, 95, false), makeScore('b', 3, 60, false)]);
    installBridges({ scores: { list } });
    const store = useAppStore();
    await store.listScores();
    store.markScoresStale();
    expect(store.scoresStale).toBe(true);
    expect(store.scores['a']?.stale).toBe(true);
    expect(store.scores['b']?.stale).toBe(true);
  });

  it('unsubscribeScoresProgress() calls the cleanup returned by onProgress', () => {
    const unsubscribe = vi.fn();
    const onProgress = vi.fn((_cb: ProgressCb) => unsubscribe);
    installBridges({ scores: { onProgress } });
    const store = useAppStore();
    store.subscribeScoresProgress();
    store.unsubscribeScoresProgress();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

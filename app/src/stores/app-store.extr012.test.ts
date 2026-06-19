/**
 * EXTR-012 — app-store wiring for "delete all imported jobs".
 *
 * Covers acceptance criteria from the renderer side:
 *
 *  AC2: deleteAllJobs() calls window.starBoard.deleteAll() and clears
 *       store.jobs reactively.
 *  AC3: derived selectors (visibleJobs, strongMatchCount, topMatches,
 *       starredJobs) all reflect the empty board.
 *  AC4: cached scores + reviews + per-job review states are cleared so no
 *       stale derived data lingers after the wipe.
 *  AC6: no-ops gracefully when the preload bridge is absent.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord, MatchScore } from 'src/types/models';

function installBridge(deleteAll: () => Promise<{ ok: true; deleted: number }>) {
  (globalThis as { window?: unknown }).window = {
    starBoard: { deleteAll },
  };
}

const SAMPLE_JOB: JobRecord = {
  sourceId: 'j1',
  hostname: 'example.com',
  url: 'https://example.com/jobs/j1',
  title: 'Engineer',
  company: 'Acme',
  location: 'Remote',
  description: null,
  postedAt: null,
  fetchedAt: 1000,
  status: 'new',
};

const SAMPLE_SCORE: MatchScore = {
  sourceId: 'j1',
  stars: 5,
  percent: 95,
  factors: [],
  weightsVersion: 'v1',
  stale: false,
  scoredAt: 1,
};

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — deleteAllJobs (AC2/AC3/AC4)', () => {
  it('calls starBoard.deleteAll and clears jobs + derived selectors', async () => {
    const deleteAll = vi.fn(async () => ({ ok: true as const, deleted: 1 }));
    installBridge(deleteAll);
    const store = useAppStore();

    store.jobs = [SAMPLE_JOB, { ...SAMPLE_JOB, sourceId: 'j2', status: 'starred' }];
    store.scores = { j1: SAMPLE_SCORE };
    store.reviews = {
      j1: {
        sourceId: 'j1',
        requirements: [],
        gaps: [],
        strengths: [],
        keywords: [],
        summary: 's',
        generatedAt: 1,
      } as never,
    };
    store.reviewStates = {
      j1: { status: 'idle', code: null, message: null },
    };

    expect(store.visibleJobs).toHaveLength(2);
    expect(store.strongMatchCount).toBe(1);

    await store.deleteAllJobs();

    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(store.jobs).toEqual([]);
    expect(store.scores).toEqual({});
    expect(store.reviews).toEqual({});
    expect(store.reviewStates).toEqual({});
    expect(store.visibleJobs).toEqual([]);
    expect(store.starredJobs).toEqual([]);
    expect(store.strongMatchCount).toBe(0);
    expect(store.topMatches).toEqual([]);
  });

  it('no-ops gracefully when starBoard is absent (AC6)', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    store.jobs = [SAMPLE_JOB];
    await expect(store.deleteAllJobs()).resolves.toBeUndefined();
    expect(store.jobs).toEqual([SAMPLE_JOB]);
  });
});

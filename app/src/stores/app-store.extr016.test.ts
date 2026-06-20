/**
 * EXTR-016 — app-store wiring for single-job delete + restore + not-interested list.
 *
 * Covers acceptance criteria from the renderer side:
 *
 *  AC3: deleteJob(sourceId) calls window.starBoard.delete(sourceId) and
 *       removes the job from local `jobs` state — visibleJobs / starredJobs
 *       / notInterestedJobs / strongMatchCount all reflect the removal.
 *  AC4: restoreJob(sourceId) returns a single job to the board by reusing
 *       setJobStatus with the same active/default value `restoreNotInterested`
 *       uses (i.e. NOT `'not_interested'`).
 *  AC5: notInterestedJobs getter returns the list of `status === 'not_interested'`
 *       jobs, suitable for a manage UI.
 *  AC6 (renderer side): both actions no-op gracefully when the preload bridge
 *       is absent (browser SPA build).
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord } from 'src/types/models';

function installBridge(overrides: Partial<{
  deleteFn: (sourceId: string) => Promise<{ ok: true; deleted: number }>;
  setStatus: (input: { sourceId: string; status: string }) => Promise<{ ok: true }>;
}>) {
  (globalThis as { window?: unknown }).window = {
    starBoard: {
      delete: overrides.deleteFn ?? (async () => ({ ok: true as const, deleted: 1 })),
      setStatus: overrides.setStatus ?? (async () => ({ ok: true as const })),
    },
  };
}

function jobA(): JobRecord {
  return {
    sourceId: 'a',
    hostname: 'example.com',
    url: 'https://example.com/jobs/a',
    title: 'Engineer',
    company: 'Acme',
    location: 'Remote',
    description: null,
    postedAt: null,
    fetchedAt: 100,
    status: 'new',
  };
}
function jobB(): JobRecord {
  return { ...jobA(), sourceId: 'b', fetchedAt: 200, status: 'not_interested' };
}
function jobC(): JobRecord {
  return { ...jobA(), sourceId: 'c', fetchedAt: 300, status: 'not_interested' };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — deleteJob (AC3)', () => {
  it('calls starBoard.delete and removes the job from local state', async () => {
    const deleteFn = vi.fn(async (_sourceId: string) => ({ ok: true as const, deleted: 1 }));
    installBridge({ deleteFn });
    const store = useAppStore();
    store.jobs = [jobA(), jobB()];

    await store.deleteJob('a');

    expect(deleteFn).toHaveBeenCalledWith('a');
    expect(store.jobs.map((j) => j.sourceId)).toEqual(['b']);
    expect(store.visibleJobs.map((j) => j.sourceId)).toEqual([]);
    expect(store.notInterestedJobs.map((j) => j.sourceId)).toEqual(['b']);
  });

  it('no-ops gracefully when starBoard is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    store.jobs = [jobA()];
    await expect(store.deleteJob('a')).resolves.toBeUndefined();
    expect(store.jobs).toEqual([jobA()]);
  });
});

describe('app-store — restoreJob (AC4)', () => {
  it('flips a single not_interested job back to the same active value restoreNotInterested uses', async () => {
    const setStatus = vi.fn(async (_input: { sourceId: string; status: string }) => ({
      ok: true as const,
    }));
    installBridge({ setStatus });
    const store = useAppStore();
    store.jobs = [jobA(), jobB(), jobC()];

    await store.restoreJob('b');

    expect(setStatus).toHaveBeenCalledTimes(1);
    const call = setStatus.mock.calls[0]![0];
    expect(call.sourceId).toBe('b');
    // Must NOT be 'not_interested' — the spec says the same active/default
    // value restoreNotInterested uses.
    expect(call.status).not.toBe('not_interested');
    expect(call.status).toBe('new');

    const restored = store.jobs.find((j) => j.sourceId === 'b');
    expect(restored?.status).toBe('new');
    // 'c' is untouched — restoreJob only affects the one targeted.
    expect(store.jobs.find((j) => j.sourceId === 'c')?.status).toBe('not_interested');
  });

  it('no-ops gracefully when starBoard is absent', async () => {
    (globalThis as { window?: unknown }).window = {};
    const store = useAppStore();
    store.jobs = [jobB()];
    await expect(store.restoreJob('b')).resolves.toBeUndefined();
    expect(store.jobs[0]!.status).toBe('not_interested');
  });
});

describe('app-store — notInterestedJobs getter (AC5)', () => {
  it('returns only the jobs with status === "not_interested"', () => {
    installBridge({});
    const store = useAppStore();
    store.jobs = [jobA(), jobB(), jobC()];

    const list = store.notInterestedJobs;
    expect(list.map((j) => j.sourceId).sort()).toEqual(['b', 'c']);
  });
});

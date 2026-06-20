/**
 * Epic 11 acceptance test for XJOB-005 — Discover wiring.
 *
 * Pins the user-visible click-through: pressing the Discover chrome "Extract
 * this job" button (XJOB-004) drives the store action wired to the XJOB-003
 * preload bridge, the returned JobRecord lands on the board so the board view
 * refreshes reactively, and the success-toast surface (`extractVisibleStatus`
 * = `'success'` + `extractVisibleLastJob`) carries the title+company that the
 * Discover chrome renders as "Added: {title} — {company}".
 *
 * The bridge `extract()` is stubbed so the test runs fully offline.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord } from 'src/types/models';

type ExtractVisibleResult =
  | { ok: true; job: JobRecord }
  | { ok: false; code: string; error: string };

function installBridges(opts: {
  extract?: () => Promise<ExtractVisibleResult>;
}) {
  const _ls: Record<string, string> = {};
  const w: Record<string, unknown> = {
    localStorage: {
      getItem(k: string) {
        return _ls[k] ?? null;
      },
      setItem(k: string, v: string) {
        _ls[k] = v;
      },
    },
  };
  if (opts.extract) {
    w.starExtractVisible = {
      extract: opts.extract,
      onProgress: () => () => undefined,
    };
  }
  (globalThis as { window?: unknown }).window = w;
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const EXTRACTED: JobRecord = {
  sourceId: 'xjob005-1',
  hostname: 'example.com',
  url: 'https://example.com/jobs/view/1',
  title: 'Senior Platform Engineer',
  company: 'Acme Cloud',
  location: 'Remote',
  description: 'Build the multi-region control plane.',
  postedAt: null,
  fetchedAt: 1_700_000_000_000,
  status: 'new',
};

describe('XJOB-005 — Discover wiring (button → action → board add + toast)', () => {
  it('clicking the button drives the action, adds the row to the board, and prepares the success toast', async () => {
    const extract = vi.fn(
      async (): Promise<ExtractVisibleResult> => ({ ok: true, job: EXTRACTED }),
    );
    installBridges({ extract });
    const store = useAppStore();
    // The disclosure gate already passed elsewhere (Epic 4 — no new copy).
    store.acknowledgeReviewDisclosure();

    // The Discover chrome's @click="onExtractThisJob" handler calls this
    // action — pin the contract directly.
    const result = await store.extractVisibleJob();

    expect(extract).toHaveBeenCalledTimes(1);
    expect(result?.ok).toBe(true);

    // Board add — the JobRecord lands on `store.jobs` so the board's
    // reactive selectors refresh on the next tick.
    const added = store.jobs.find((j) => j.sourceId === EXTRACTED.sourceId);
    expect(added).toBeDefined();
    expect(added?.title).toBe('Senior Platform Engineer');
    expect(added?.company).toBe('Acme Cloud');

    // "Toast" surface — the success status + last-job pin drive the Discover
    // chrome's "Added: {title} — {company}" message.
    expect(store.extractVisibleStatus).toBe('success');
    expect(store.extractVisibleLastJob?.title).toBe('Senior Platform Engineer');
    expect(store.extractVisibleLastJob?.company).toBe('Acme Cloud');
  });

  it('no-posting outcome surfaces as a dedicated status and does NOT add anything to the board', async () => {
    const extract = vi.fn(
      async (): Promise<ExtractVisibleResult> => ({
        ok: false,
        code: 'NO_POSTING',
        error: 'No recognisable job posting was detected on this page.',
      }),
    );
    installBridges({ extract });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    const before = store.jobs.length;

    await store.extractVisibleJob();

    expect(store.extractVisibleStatus).toBe('no_posting');
    expect(store.jobs.length).toBe(before);
  });

  it('flips status to "extracting" while the bridge call is in flight (button shows the busy state)', async () => {
    let resolveFn: (r: ExtractVisibleResult) => void = () => undefined;
    const pending = new Promise<ExtractVisibleResult>((r) => {
      resolveFn = r;
    });
    const extract = vi.fn(async () => pending);
    installBridges({ extract });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();

    const p = store.extractVisibleJob();
    expect(store.extractVisibleStatus).toBe('extracting');
    expect(store.isExtractingVisible).toBe(true);
    resolveFn({ ok: true, job: EXTRACTED });
    await p;
    expect(store.extractVisibleStatus).toBe('success');
    expect(store.isExtractingVisible).toBe(false);
  });
});

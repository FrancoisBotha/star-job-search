/**
 * Unit tests for the XJOB-004 app-store wiring (Epic 11 — Extract this job).
 *
 * Covers the renderer-side action that drives the chrome "Extract this job"
 * control:
 *   - AC1 — `canExtractVisibleJob` getter reflects key + default model
 *     availability so the button can be disabled with a clear reason when
 *     either is missing.
 *   - AC2 — `extractVisibleJob()` action manages the per-flight state
 *     machine (idle → extracting → success / no_posting / error) and
 *     pushes the returned JobRecord into `store.jobs` so the board refreshes
 *     reactively (AC3).
 *   - AC3 — gated behind the existing `reviewDisclosureAcknowledged` flag
 *     (Epic 4 "what is sent" disclosure — no new disclosure copy). When the
 *     flag is false the action no-ops without reaching the bridge so the
 *     caller can present the disclosure first.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord } from 'src/types/models';

type ExtractVisibleResult =
  | { ok: true; job: JobRecord }
  | { ok: false; code: string; error: string };

function installBridges(opts: {
  extractVisible?: {
    extract?: () => Promise<ExtractVisibleResult>;
    onProgress?: (cb: (e: Record<string, unknown>) => void) => () => void;
  };
} = {}) {
  const _store: Record<string, string> = {};
  const w: Record<string, unknown> = {
    localStorage: {
      getItem(k: string) {
        return _store[k] ?? null;
      },
      setItem(k: string, v: string) {
        _store[k] = v;
      },
    },
  };
  if (opts.extractVisible) w.starExtractVisible = opts.extractVisible;
  (globalThis as { window?: unknown }).window = w;
  return w;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const SAMPLE_JOB: JobRecord = {
  sourceId: 'j-manual-1',
  hostname: 'example.com',
  url: 'https://example.com/jobs/1',
  title: 'Senior Engineer',
  company: 'Acme',
  location: 'Remote',
  description: null,
  postedAt: null,
  fetchedAt: 1000,
  status: 'new',
};

describe('app-store — canExtractVisibleJob (XJOB-004 AC1)', () => {
  it('is false when no API key is present', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: false, masked: null };
    store.preferredModels = [
      { slug: 'anthropic/claude', isDefault: true, position: 0 },
    ];
    expect(store.canExtractVisibleJob).toBe(false);
  });

  it('is false when no default model is selected', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: true, masked: 'sk-…abcd' };
    store.preferredModels = [
      { slug: 'anthropic/claude', isDefault: false, position: 0 },
    ];
    expect(store.canExtractVisibleJob).toBe(false);
  });

  it('is true when key is present and a default model is selected', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: true, masked: 'sk-…abcd' };
    store.preferredModels = [
      { slug: 'anthropic/claude', isDefault: true, position: 0 },
    ];
    expect(store.canExtractVisibleJob).toBe(true);
  });

  it('exposes a stable disabled-reason string for the UI tooltip', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: false, masked: null };
    expect(store.extractVisibleDisabledReason).toMatch(/API key|key/i);
    store.apiKeyStatus = { present: true, masked: 'x' };
    store.preferredModels = [];
    expect(store.extractVisibleDisabledReason).toMatch(/model/i);
  });
});

describe('app-store — extractVisibleJob action (XJOB-004 AC2)', () => {
  it('pushes the returned JobRecord into store.jobs on success', async () => {
    const extract = vi.fn(
      async (): Promise<ExtractVisibleResult> => ({ ok: true, job: SAMPLE_JOB }),
    );
    installBridges({ extractVisible: { extract } });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    const result = await store.extractVisibleJob();
    expect(extract).toHaveBeenCalledTimes(1);
    expect(result?.ok).toBe(true);
    expect(store.jobs.some((j) => j.sourceId === 'j-manual-1')).toBe(true);
    expect(store.extractVisibleStatus).toBe('success');
    expect(store.extractVisibleLastJob?.sourceId).toBe('j-manual-1');
  });

  it('flips status to "extracting" while in flight, then back to terminal', async () => {
    let resolveFn: (r: ExtractVisibleResult) => void = () => {};
    const pending = new Promise<ExtractVisibleResult>((r) => {
      resolveFn = r;
    });
    const extract = vi.fn(async () => pending);
    installBridges({ extractVisible: { extract } });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    const p = store.extractVisibleJob();
    // synchronously the action should have flipped the status
    expect(store.extractVisibleStatus).toBe('extracting');
    resolveFn({ ok: true, job: SAMPLE_JOB });
    await p;
    expect(store.extractVisibleStatus).toBe('success');
  });

  it('maps NO_POSTING to a dedicated status (not generic error)', async () => {
    const extract = vi.fn(
      async (): Promise<ExtractVisibleResult> => ({
        ok: false,
        code: 'NO_POSTING',
        error: 'no posting',
      }),
    );
    installBridges({ extractVisible: { extract } });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    await store.extractVisibleJob();
    expect(store.extractVisibleStatus).toBe('no_posting');
  });

  it('maps other failure codes to error status with the code preserved', async () => {
    const extract = vi.fn(
      async (): Promise<ExtractVisibleResult> => ({
        ok: false,
        code: 'LLM_ERROR',
        error: 'boom',
      }),
    );
    installBridges({ extractVisible: { extract } });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    await store.extractVisibleJob();
    expect(store.extractVisibleStatus).toBe('error');
    expect(store.extractVisibleErrorCode).toBe('LLM_ERROR');
  });

  it('no-ops without calling the bridge when disclosure is not acknowledged (AC3)', async () => {
    const extract = vi.fn();
    installBridges({ extractVisible: { extract } });
    const store = useAppStore();
    // do NOT acknowledge the disclosure
    const result = await store.extractVisibleJob();
    expect(extract).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('no-ops gracefully when the bridge is absent', async () => {
    installBridges();
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    await expect(store.extractVisibleJob()).resolves.toBeUndefined();
  });
});

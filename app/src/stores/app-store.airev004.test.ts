/**
 * Unit tests for AIREV-004 — app-store reviews state, generate action,
 * stale/provenance selectors, error-code surfacing, and the Epic 4
 * "what is sent" disclosure gate on first send (FR-005).
 *
 * Covers:
 *  - AC1: reviews keyed by sourceId + per-job generate state
 *         (idle/loading/error with the error code), generate action calls
 *         window.starReview.generate, and a hydrate/get path on demand.
 *  - AC2: selectors expose whether a review exists, its provenance
 *         (model + date), and whether it is stale for a given sourceId.
 *  - AC3: generate action surfaces NO_API_KEY / LLM_ERROR / MODEL_NOT_CAPABLE
 *         via the per-code error state.
 *  - AC4: first send of JD + CV text is gated behind the Epic 4 disclosure
 *         (reused localStorage key 'star.cvDisclosure.ack.v1'); a generate
 *         call before acknowledgement does not reach the bridge.
 *  - AC5: renderer-side MatchReview types mirror the main-process contract.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type { MatchReview, MatchReviewGenerateState } from './app-store';

type ReviewBridge = {
  generate?: (sourceId: string) => Promise<StarReviewGenerateResult>;
  get?: (sourceId: string) => Promise<StarMatchReview | null>;
};

class FakeLocalStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

function installBridges(opts: {
  review?: ReviewBridge;
  acknowledged?: boolean;
} = {}) {
  const storage = new FakeLocalStorage();
  if (opts.acknowledged) storage.setItem('star.cvDisclosure.ack.v1', '1');
  const w: Record<string, unknown> = { localStorage: storage };
  if (opts.review) w.starReview = opts.review;
  (globalThis as { window?: unknown }).window = w;
  return { w, storage };
}

function makeReview(overrides: Partial<StarMatchReview> = {}): StarMatchReview {
  return {
    sourceId: 'job-1',
    requirements: [{ requirement: 'TypeScript', evidence: 'TS for 5 years', met: true }],
    gaps: [{ text: 'No k8s', severity: 'nice_to_have', mitigation: 'mention CKAD plans' }],
    strengths: ['Hands-on TS'],
    keywords: ['typescript'],
    summary: 'Solid fit with one nice-to-have gap.',
    modelSlug: 'openai/gpt-4o-mini',
    generatedAt: 1_700_000_000_000,
    stale: false,
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — reviews state + generate action (AC1)', () => {
  it('initial reviews map is empty and review state for any sourceId is idle', () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    expect(store.reviews).toEqual({});
    const state = store.reviewGenerateStateFor('job-1');
    expect(state.status).toBe('idle');
    expect(state.code).toBeNull();
  });

  it('generateReview() calls window.starReview.generate, sets loading then stores the result keyed by sourceId', async () => {
    let resolveCall: (v: StarReviewGenerateResult) => void = () => {};
    const review = makeReview({ sourceId: 'job-1' });
    const generate = vi.fn(
      () =>
        new Promise<StarReviewGenerateResult>((resolve) => {
          resolveCall = resolve;
        }),
    );
    installBridges({ review: { generate }, acknowledged: true });
    const store = useAppStore();
    store.hydrateReviewDisclosure();

    const p = store.generateReview('job-1');
    expect(store.reviewGenerateStateFor('job-1').status).toBe('loading');

    resolveCall({ ok: true, review });
    await p;

    expect(generate).toHaveBeenCalledWith('job-1');
    expect(store.reviews['job-1']?.summary).toBe(review.summary);
    expect(store.reviewGenerateStateFor('job-1').status).toBe('idle');
  });

  it('getReview() calls window.starReview.get and stores the row', async () => {
    const review = makeReview({ sourceId: 'job-2' });
    const get = vi.fn(async (_id: string) => review);
    installBridges({ review: { get }, acknowledged: true });
    const store = useAppStore();
    const result = await store.getReview('job-2');
    expect(get).toHaveBeenCalledWith('job-2');
    expect(result?.sourceId).toBe('job-2');
    expect(store.reviews['job-2']).toEqual(review);
  });

  it('generateReview() no-ops when bridge absent', async () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    await expect(store.generateReview('job-1')).resolves.toBeUndefined();
  });
});

describe('app-store — review selectors (AC2)', () => {
  it('hasReview / reviewProvenance / isReviewStale reflect cached state', async () => {
    const review = makeReview({
      sourceId: 'job-1',
      modelSlug: 'openai/gpt-4o-mini',
      generatedAt: 1_700_000_000_000,
      stale: true,
    });
    const get = vi.fn(async () => review);
    installBridges({ review: { get }, acknowledged: true });
    const store = useAppStore();

    expect(store.hasReview('job-1')).toBe(false);
    expect(store.reviewProvenance('job-1')).toBeNull();
    expect(store.isReviewStale('job-1')).toBe(false);

    await store.getReview('job-1');
    expect(store.hasReview('job-1')).toBe(true);
    const prov = store.reviewProvenance('job-1');
    expect(prov?.modelSlug).toBe('openai/gpt-4o-mini');
    expect(prov?.generatedAt).toBe(1_700_000_000_000);
    expect(store.isReviewStale('job-1')).toBe(true);
  });
});

describe('app-store — error-code surfacing (AC3)', () => {
  it('surfaces NO_API_KEY as an error state with the code', async () => {
    const generate = vi.fn(
      async (): Promise<StarReviewGenerateResult> => ({
        ok: false,
        code: 'NO_API_KEY',
        error: 'no key',
      }),
    );
    installBridges({ review: { generate }, acknowledged: true });
    const store = useAppStore();
    await store.generateReview('job-1');
    const s = store.reviewGenerateStateFor('job-1');
    expect(s.status).toBe('error');
    expect(s.code).toBe('NO_API_KEY');
    expect(s.message).toBe('no key');
  });

  it('surfaces MODEL_NOT_CAPABLE distinctly from LLM_ERROR', async () => {
    const generate = vi.fn(
      async (): Promise<StarReviewGenerateResult> => ({
        ok: false,
        code: 'MODEL_NOT_CAPABLE',
        error: 'model lacks function calling',
      }),
    );
    installBridges({ review: { generate }, acknowledged: true });
    const store = useAppStore();
    await store.generateReview('job-1');
    expect(store.reviewGenerateStateFor('job-1').code).toBe('MODEL_NOT_CAPABLE');
  });

  it('surfaces LLM_ERROR (network/model)', async () => {
    const generate = vi.fn(
      async (): Promise<StarReviewGenerateResult> => ({
        ok: false,
        code: 'LLM_ERROR',
        error: 'network down',
      }),
    );
    installBridges({ review: { generate }, acknowledged: true });
    const store = useAppStore();
    await store.generateReview('job-1');
    expect(store.reviewGenerateStateFor('job-1').code).toBe('LLM_ERROR');
  });
});

describe('app-store — disclosure gate on first send (AC4 / FR-005)', () => {
  it('does NOT call the bridge when disclosure not acknowledged', async () => {
    const generate = vi.fn(
      async (): Promise<StarReviewGenerateResult> => ({
        ok: true,
        review: makeReview(),
      }),
    );
    installBridges({ review: { generate }, acknowledged: false });
    const store = useAppStore();
    store.hydrateReviewDisclosure();
    expect(store.reviewDisclosureAcknowledged).toBe(false);

    await store.generateReview('job-1');
    expect(generate).not.toHaveBeenCalled();
  });

  it('hydrateReviewDisclosure() reads the Epic 4 localStorage flag', () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    store.hydrateReviewDisclosure();
    expect(store.reviewDisclosureAcknowledged).toBe(true);
  });

  it('acknowledgeReviewDisclosure() flips the flag and writes the Epic 4 key', () => {
    const { storage } = installBridges({ acknowledged: false });
    const store = useAppStore();
    store.acknowledgeReviewDisclosure();
    expect(store.reviewDisclosureAcknowledged).toBe(true);
    expect(storage.getItem('star.cvDisclosure.ack.v1')).toBe('1');
  });

  it('after acknowledgement, generateReview() reaches the bridge', async () => {
    const review = makeReview();
    const generate = vi.fn(
      async (): Promise<StarReviewGenerateResult> => ({ ok: true, review }),
    );
    installBridges({ review: { generate }, acknowledged: false });
    const store = useAppStore();
    store.hydrateReviewDisclosure();
    expect(store.reviewDisclosureAcknowledged).toBe(false);

    store.acknowledgeReviewDisclosure();
    await store.generateReview('job-1');
    expect(generate).toHaveBeenCalledWith('job-1');
    expect(store.reviews['job-1']?.summary).toBe(review.summary);
  });
});

describe('renderer-side MatchReview types mirror the main contract (AC5)', () => {
  it('MatchReview / MatchReviewGenerateState are exported from app-store', () => {
    const review: MatchReview = makeReview();
    expect(review.requirements.length).toBeGreaterThan(0);
    const state: MatchReviewGenerateState = {
      status: 'error',
      code: 'NO_API_KEY',
      message: 'oops',
    };
    expect(state.code).toBe('NO_API_KEY');
  });
});

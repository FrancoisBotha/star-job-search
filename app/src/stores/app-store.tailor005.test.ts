/**
 * Unit tests for TAILOR-005 — app-store tailored-docs state, generate /
 * accept / export actions, stale selector, error-code surfacing, and reuse
 * of the Epic 4 "what is sent" disclosure gate.
 *
 * Covers:
 *  - AC1: tailoredDocs keyed by (sourceId, kind) with per-key generate /
 *         accept / export action state (idle / loading / error + code),
 *         and a hydrate/get path on demand.
 *  - AC2: stale selector reports when a draft is out of date so the UI
 *         can show the stale banner + Regenerate (FR-016); markStale
 *         actions flip the renderer-side stale flag.
 *  - AC3: the Epic 4 "what is sent" disclosure (reused localStorage key
 *         'star.cvDisclosure.ack.v1') gates the first send; tailoring is
 *         unavailable without an API key (FR-014 / NFR-003).
 *  - AC4: accept action surfaces the recomputed deterministic Epic 5
 *         star/% live by refreshing the score via the scores bridge — the
 *         store NEVER computes any score itself (FR-012).
 *  - AC5: renderer-side TailoredDoc types are exported and mirror the
 *         main-process contract.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';
import type {
  TailoredDoc,
  TailorActionState,
  TailoredDocKind,
} from './app-store';

type TailorBridge = {
  generate?: (input: StarTailorGenerateInput) => Promise<StarTailorGenerateResult>;
  get?: (input: StarTailorDocSelector) => Promise<StarTailoredDoc | null>;
  accept?: (input: StarTailorAcceptInput) => Promise<StarTailorAcceptResult>;
  export?: (input: StarTailorDocSelector) => Promise<StarTailorExportResult>;
};

type ScoresBridge = {
  get?: (sourceId: string) => Promise<StarMatchScore | null>;
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
  tailor?: TailorBridge;
  scores?: ScoresBridge;
  acknowledged?: boolean;
} = {}) {
  const storage = new FakeLocalStorage();
  if (opts.acknowledged) storage.setItem('star.cvDisclosure.ack.v1', '1');
  const w: Record<string, unknown> = { localStorage: storage };
  if (opts.tailor) w.starTailor = opts.tailor;
  if (opts.scores) w.starScores = opts.scores;
  (globalThis as { window?: unknown }).window = w;
  return { w, storage };
}

function makeDoc(
  overrides: Partial<StarTailoredDoc> = {},
): StarTailoredDoc {
  return {
    sourceId: 'job-1',
    kind: 'cv',
    content: '# Tailored CV\n\n...',
    suggestions: [
      { id: 'sug-1', type: 'wording', gain: 0, text: 'Add metric', rationale: 'why' },
      { id: 'sug-2', type: 'keyword', gain: 0, text: 'Add k8s', rationale: 'why2' },
    ],
    atsReport: { score: 90, missingKeywords: [], checks: [] },
    keywords: ['typescript'],
    intensity: 'light',
    baseCvId: 'cv-1',
    modelSlug: 'openai/gpt-4o-mini',
    generatedAt: 1_700_000_000_000,
    stale: false,
    ...overrides,
  };
}

function makeScore(
  overrides: Partial<StarMatchScore> = {},
): StarMatchScore {
  return {
    sourceId: 'job-1',
    stars: 4,
    percent: 87,
    factors: [],
    weightsVersion: 'v1',
    stale: false,
    scoredAt: 1_700_000_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — tailored-docs state + generate action (AC1)', () => {
  it('initial tailoredDocs map is empty and action state for any (sourceId, kind) is idle', () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    expect(store.tailoredDocs).toEqual({});
    const state = store.tailorStateFor('job-1', 'cv');
    expect(state.status).toBe('idle');
    expect(state.code).toBeNull();
  });

  it('generateTailoredDoc() calls window.starTailor.generate, sets loading then stores the result keyed by (sourceId, kind)', async () => {
    let resolveCall: (v: StarTailorGenerateResult) => void = () => {};
    const doc = makeDoc({ sourceId: 'job-1', kind: 'cv' });
    const generate = vi.fn(
      () =>
        new Promise<StarTailorGenerateResult>((resolve) => {
          resolveCall = resolve;
        }),
    );
    installBridges({ tailor: { generate }, acknowledged: true });
    const store = useAppStore();
    store.hydrateReviewDisclosure();

    const p = store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    expect(store.tailorStateFor('job-1', 'cv').status).toBe('loading');

    resolveCall({ ok: true, doc });
    await p;

    expect(generate).toHaveBeenCalledWith({ sourceId: 'job-1', kind: 'cv' });
    expect(store.getTailoredDocCached('job-1', 'cv')?.content).toBe(doc.content);
    expect(store.tailorStateFor('job-1', 'cv').status).toBe('idle');
  });

  it('getTailoredDoc() calls window.starTailor.get and stores the row', async () => {
    const doc = makeDoc({ sourceId: 'job-2', kind: 'cover-letter' });
    const get = vi.fn(async (_input: StarTailorDocSelector) => doc);
    installBridges({ tailor: { get }, acknowledged: true });
    const store = useAppStore();
    const result = await store.getTailoredDoc({
      sourceId: 'job-2',
      kind: 'cover-letter',
    });
    expect(get).toHaveBeenCalledWith({ sourceId: 'job-2', kind: 'cover-letter' });
    expect(result?.sourceId).toBe('job-2');
    expect(store.getTailoredDocCached('job-2', 'cover-letter')?.kind).toBe(
      'cover-letter',
    );
  });

  it('generateTailoredDoc() no-ops when bridge absent', async () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    await expect(
      store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' }),
    ).resolves.toBeUndefined();
  });

  it('keys CV and cover-letter separately for the same job', async () => {
    const cvDoc = makeDoc({ sourceId: 'job-1', kind: 'cv' });
    const letterDoc = makeDoc({ sourceId: 'job-1', kind: 'cover-letter' });
    const generate = vi.fn(
      async (input: StarTailorGenerateInput): Promise<StarTailorGenerateResult> => ({
        ok: true,
        doc: input.kind === 'cover-letter' ? letterDoc : cvDoc,
      }),
    );
    installBridges({ tailor: { generate }, acknowledged: true });
    const store = useAppStore();
    await store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    await store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cover-letter' });
    expect(store.getTailoredDocCached('job-1', 'cv')?.kind).toBe('cv');
    expect(store.getTailoredDocCached('job-1', 'cover-letter')?.kind).toBe(
      'cover-letter',
    );
  });
});

describe('app-store — stale selector + markStale (AC2 / FR-016)', () => {
  it('isTailoredDocStale reflects the persisted stale flag', async () => {
    const doc = makeDoc({ sourceId: 'job-1', kind: 'cv', stale: true });
    const get = vi.fn(async () => doc);
    installBridges({ tailor: { get }, acknowledged: true });
    const store = useAppStore();
    expect(store.isTailoredDocStale('job-1', 'cv')).toBe(false);
    await store.getTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    expect(store.isTailoredDocStale('job-1', 'cv')).toBe(true);
  });

  it('markTailoredDocsStaleForJob() flips both kinds stale locally', async () => {
    const cv = makeDoc({ sourceId: 'job-1', kind: 'cv', stale: false });
    const letter = makeDoc({ sourceId: 'job-1', kind: 'cover-letter', stale: false });
    const get = vi.fn(
      async (input: StarTailorDocSelector) =>
        input.kind === 'cv' ? cv : letter,
    );
    installBridges({ tailor: { get }, acknowledged: true });
    const store = useAppStore();
    await store.getTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    await store.getTailoredDoc({ sourceId: 'job-1', kind: 'cover-letter' });
    expect(store.isTailoredDocStale('job-1', 'cv')).toBe(false);
    expect(store.isTailoredDocStale('job-1', 'cover-letter')).toBe(false);
    store.markTailoredDocsStaleForJob('job-1');
    expect(store.isTailoredDocStale('job-1', 'cv')).toBe(true);
    expect(store.isTailoredDocStale('job-1', 'cover-letter')).toBe(true);
  });

  it('markAllTailoredDocsStale() flips every cached draft stale', async () => {
    const a = makeDoc({ sourceId: 'job-1', kind: 'cv', stale: false });
    const b = makeDoc({ sourceId: 'job-2', kind: 'cv', stale: false });
    const get = vi.fn(
      async (input: StarTailorDocSelector) => (input.sourceId === 'job-1' ? a : b),
    );
    installBridges({ tailor: { get }, acknowledged: true });
    const store = useAppStore();
    await store.getTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    await store.getTailoredDoc({ sourceId: 'job-2', kind: 'cv' });
    store.markAllTailoredDocsStale();
    expect(store.isTailoredDocStale('job-1', 'cv')).toBe(true);
    expect(store.isTailoredDocStale('job-2', 'cv')).toBe(true);
  });

  it('hasTailoredDoc / tailoredDocProvenance reflect cached state', async () => {
    const doc = makeDoc({
      sourceId: 'job-1',
      kind: 'cv',
      modelSlug: 'openai/gpt-4o-mini',
      generatedAt: 1_700_000_000_000,
    });
    const get = vi.fn(async () => doc);
    installBridges({ tailor: { get }, acknowledged: true });
    const store = useAppStore();
    expect(store.hasTailoredDoc('job-1', 'cv')).toBe(false);
    expect(store.tailoredDocProvenance('job-1', 'cv')).toBeNull();
    await store.getTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    expect(store.hasTailoredDoc('job-1', 'cv')).toBe(true);
    const prov = store.tailoredDocProvenance('job-1', 'cv');
    expect(prov?.modelSlug).toBe('openai/gpt-4o-mini');
    expect(prov?.generatedAt).toBe(1_700_000_000_000);
  });
});

describe('app-store — disclosure gate + no-key unavailability (AC3 / FR-014 / NFR-003)', () => {
  it('does NOT call the bridge when the Epic 4 disclosure has not been acknowledged', async () => {
    const generate = vi.fn(
      async (): Promise<StarTailorGenerateResult> => ({
        ok: true,
        doc: makeDoc(),
      }),
    );
    installBridges({ tailor: { generate }, acknowledged: false });
    const store = useAppStore();
    store.hydrateReviewDisclosure();
    expect(store.reviewDisclosureAcknowledged).toBe(false);

    await store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('after acknowledgement, generateTailoredDoc() reaches the bridge', async () => {
    const doc = makeDoc();
    const generate = vi.fn(
      async (): Promise<StarTailorGenerateResult> => ({ ok: true, doc }),
    );
    installBridges({ tailor: { generate }, acknowledged: false });
    const store = useAppStore();
    store.hydrateReviewDisclosure();
    store.acknowledgeReviewDisclosure();

    await store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    expect(generate).toHaveBeenCalledWith({ sourceId: 'job-1', kind: 'cv' });
  });

  it('isTailoringAvailable is false until the API key is saved (FR-014 / NFR-003)', () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    store.apiKeyStatus = { present: false, masked: null };
    expect(store.isTailoringAvailable).toBe(false);
    store.apiKeyStatus = { present: true, masked: '••••1234' };
    expect(store.isTailoringAvailable).toBe(true);
  });

  it('surfaces NO_API_KEY as an error state with the code', async () => {
    const generate = vi.fn(
      async (): Promise<StarTailorGenerateResult> => ({
        ok: false,
        code: 'NO_API_KEY',
        error: 'no key',
      }),
    );
    installBridges({ tailor: { generate }, acknowledged: true });
    const store = useAppStore();
    await store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    const s = store.tailorStateFor('job-1', 'cv');
    expect(s.status).toBe('error');
    expect(s.code).toBe('NO_API_KEY');
    expect(s.message).toBe('no key');
  });

  it('surfaces MODEL_NOT_CAPABLE distinctly from LLM_ERROR', async () => {
    const generate = vi.fn(
      async (): Promise<StarTailorGenerateResult> => ({
        ok: false,
        code: 'MODEL_NOT_CAPABLE',
        error: 'model lacks function calling',
      }),
    );
    installBridges({ tailor: { generate }, acknowledged: true });
    const store = useAppStore();
    await store.generateTailoredDoc({ sourceId: 'job-1', kind: 'cv' });
    expect(store.tailorStateFor('job-1', 'cv').code).toBe('MODEL_NOT_CAPABLE');
  });
});

describe('app-store — accept action refreshes Epic 5 score from IPC (AC4 / FR-012)', () => {
  it('removes the accepted suggestion and refreshes the deterministic score via scores:get', async () => {
    const updated = makeDoc({
      sourceId: 'job-1',
      kind: 'cv',
      suggestions: [
        { id: 'sug-2', type: 'keyword', gain: 0, text: 'Add k8s', rationale: 'why2' },
      ],
    });
    const recomputed = makeScore({ sourceId: 'job-1', stars: 5, percent: 92 });
    const accept = vi.fn(
      async (_input: StarTailorAcceptInput): Promise<StarTailorAcceptResult> => ({
        ok: true,
        doc: updated,
        scored: 1,
      }),
    );
    const get = vi.fn(async (_id: string) => recomputed);
    installBridges({
      tailor: { accept },
      scores: { get },
      acknowledged: true,
    });
    const store = useAppStore();

    const result = await store.acceptTailoredSuggestion({
      sourceId: 'job-1',
      kind: 'cv',
      suggestionId: 'sug-1',
    });

    expect(accept).toHaveBeenCalledWith({
      sourceId: 'job-1',
      kind: 'cv',
      suggestionId: 'sug-1',
    });
    expect(store.getTailoredDocCached('job-1', 'cv')?.suggestions).toHaveLength(1);
    // The store does NOT compute any score itself — the recomputed Epic 5
    // score is read live via `scores:get` and reflected in state.scores.
    expect(get).toHaveBeenCalledWith('job-1');
    expect(store.scores['job-1']?.stars).toBe(5);
    expect(store.scores['job-1']?.percent).toBe(92);
    expect(result?.ok).toBe(true);
  });

  it('surfaces SUGGESTION_NOT_FOUND as an error state on the per-key action state', async () => {
    const accept = vi.fn(
      async (): Promise<StarTailorAcceptResult> => ({
        ok: false,
        code: 'SUGGESTION_NOT_FOUND',
        error: 'no suggestion',
      }),
    );
    installBridges({ tailor: { accept }, acknowledged: true });
    const store = useAppStore();
    await store.acceptTailoredSuggestion({
      sourceId: 'job-1',
      kind: 'cv',
      suggestionId: 'sug-x',
    });
    const s = store.tailorStateFor('job-1', 'cv');
    expect(s.status).toBe('error');
    expect(s.code).toBe('SUGGESTION_NOT_FOUND');
  });
});

describe('app-store — export action (AC1)', () => {
  it('exportTailoredDoc() returns the bridge result verbatim', async () => {
    const exp = vi.fn(
      async (_input: StarTailorDocSelector): Promise<StarTailorExportResult> => ({
        ok: true,
        format: 'markdown',
        mimeType: 'text/markdown',
        content: '# Tailored CV',
        filename: 'tailored-cv-job-1.md',
      }),
    );
    installBridges({ tailor: { export: exp }, acknowledged: true });
    const store = useAppStore();
    const result = await store.exportTailoredDoc({
      sourceId: 'job-1',
      kind: 'cv',
    });
    expect(exp).toHaveBeenCalledWith({ sourceId: 'job-1', kind: 'cv' });
    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.filename).toBe('tailored-cv-job-1.md');
    }
  });

  it('returns undefined when the bridge is absent', async () => {
    installBridges({ acknowledged: true });
    const store = useAppStore();
    await expect(
      store.exportTailoredDoc({ sourceId: 'job-1', kind: 'cv' }),
    ).resolves.toBeUndefined();
  });
});

describe('renderer-side TailoredDoc types mirror the main contract (AC5)', () => {
  it('TailoredDoc / TailorActionState / TailoredDocKind are exported from app-store', () => {
    const doc: TailoredDoc = makeDoc();
    expect(doc.kind).toBe('cv');
    const state: TailorActionState = {
      status: 'error',
      code: 'NO_API_KEY',
      message: 'oops',
    };
    expect(state.code).toBe('NO_API_KEY');
    const kind: TailoredDocKind = 'cover-letter';
    expect(kind).toBe('cover-letter');
  });
});

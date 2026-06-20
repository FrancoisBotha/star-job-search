/**
 * Unit tests for EVAL-005 — app-store eval-report state, generate action,
 * stale selectors, can-eval gate, and web-research disclosure / setting.
 *
 * Covers:
 *  - AC1: evalReports keyed by sourceId + per-job generate state
 *         (idle/loading/error with the stable EVAL-004 error code), generate
 *         action calls window.starEval.generate, get action calls
 *         window.starEval.get, and stale selectors expose the cached flag.
 *  - AC2: canGenerateEval / evalDisabledReason gates rely on API key +
 *         default model + persisted Epic 5 score for the sourceId.
 *  - AC3: web-research disclosure / setting hydrate + setEnabled +
 *         acknowledge calls route through window.starEval.* and mirror
 *         the persisted state.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

type EvalBridge = {
  generate?: (sourceId: string) => Promise<StarEvalGenerateResult>;
  get?: (sourceId: string) => Promise<EvalReport | null>;
  onProgress?: (cb: (e: StarEvalProgressEvent) => void) => () => void;
  getWebResearchSetting?: () => Promise<StarWebResearchSetting>;
  setWebResearchEnabled?: (enabled: boolean) => Promise<StarWebResearchSetting>;
  acknowledgeWebResearchDisclosure?: () => Promise<StarWebResearchSetting>;
};

function installBridges(opts: { eval?: EvalBridge } = {}) {
  const w: Record<string, unknown> = { localStorage: { getItem: () => '1', setItem: () => {} } };
  if (opts.eval) {
    w.starEval = {
      onProgress: () => () => undefined,
      ...opts.eval,
    };
  }
  (globalThis as { window?: unknown }).window = w;
  return w;
}

function makeReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    sourceId: 'job-1',
    blockA: 'About the company',
    blockC: 'Comp expectations',
    blockD: 'Working there day to day',
    blockG: 'Why they would say yes',
    blockH: 'Verification & sources',
    sources: [{ title: 'src', url: 'https://x', snippet: 's' }],
    legitimacyVerdict: 'plausible',
    verificationNote: 'best-effort',
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

describe('app-store — evalReports state + generate action (AC1)', () => {
  it('initial evalReports map is empty and evalGenerateStateFor any sourceId is idle', () => {
    installBridges();
    const store = useAppStore();
    expect(store.evalReports).toEqual({});
    const state = store.evalGenerateStateFor('job-1');
    expect(state.status).toBe('idle');
    expect(state.code).toBeNull();
  });

  it('generateEval() calls window.starEval.generate, sets loading then stores the result keyed by sourceId', async () => {
    let resolveCall: (v: StarEvalGenerateResult) => void = () => {};
    const report = makeReport({ sourceId: 'job-1' });
    const generate = vi.fn(
      () =>
        new Promise<StarEvalGenerateResult>((resolve) => {
          resolveCall = resolve;
        }),
    );
    installBridges({ eval: { generate } });
    const store = useAppStore();

    const p = store.generateEval('job-1');
    expect(store.evalGenerateStateFor('job-1').status).toBe('loading');

    resolveCall({ ok: true, report, rating: 4 });
    await p;

    expect(generate).toHaveBeenCalledWith('job-1');
    expect(store.evalReports['job-1']?.blockA).toBe(report.blockA);
    expect(store.evalGenerateStateFor('job-1').status).toBe('idle');
  });

  it('getEvalReport() calls window.starEval.get and stores the row', async () => {
    const report = makeReport({ sourceId: 'job-2' });
    const get = vi.fn(async (_id: string) => report);
    installBridges({ eval: { get } });
    const store = useAppStore();
    const result = await store.getEvalReport('job-2');
    expect(get).toHaveBeenCalledWith('job-2');
    expect(result?.sourceId).toBe('job-2');
    expect(store.evalReports['job-2']).toEqual(report);
  });

  it('hasEvalReport / isEvalReportStale reflect cached state', async () => {
    const report = makeReport({ sourceId: 'job-3', stale: true });
    const get = vi.fn(async () => report);
    installBridges({ eval: { get } });
    const store = useAppStore();

    expect(store.hasEvalReport('job-3')).toBe(false);
    expect(store.isEvalReportStale('job-3')).toBe(false);

    await store.getEvalReport('job-3');
    expect(store.hasEvalReport('job-3')).toBe(true);
    expect(store.isEvalReportStale('job-3')).toBe(true);
  });

  it('surfaces NO_API_KEY / MODEL_NOT_CAPABLE / NO_SCORE / NETWORK distinctly', async () => {
    for (const code of ['NO_API_KEY', 'MODEL_NOT_CAPABLE', 'NO_SCORE', 'NETWORK'] as const) {
      setActivePinia(createPinia());
      const generate = vi.fn(
        async (): Promise<StarEvalGenerateResult> => ({ ok: false, code, error: code }),
      );
      installBridges({ eval: { generate } });
      const store = useAppStore();
      await store.generateEval('job-1');
      const s = store.evalGenerateStateFor('job-1');
      expect(s.status).toBe('error');
      expect(s.code).toBe(code);
    }
  });

  it('markEvalReportStaleForJob flips the cached row stale locally', async () => {
    const report = makeReport({ sourceId: 'job-x', stale: false });
    const get = vi.fn(async () => report);
    installBridges({ eval: { get } });
    const store = useAppStore();
    await store.getEvalReport('job-x');
    store.markEvalReportStaleForJob('job-x');
    expect(store.evalReports['job-x']?.stale).toBe(true);
  });

  it('markAllEvalReportsStale flips every cached row stale', async () => {
    const a = makeReport({ sourceId: 'a', stale: false });
    const b = makeReport({ sourceId: 'b', stale: false });
    let next = a;
    const get = vi.fn(async () => next);
    installBridges({ eval: { get } });
    const store = useAppStore();
    await store.getEvalReport('a');
    next = b;
    await store.getEvalReport('b');
    store.markAllEvalReportsStale();
    expect(store.evalReports['a']?.stale).toBe(true);
    expect(store.evalReports['b']?.stale).toBe(true);
  });
});

describe('app-store — can-eval gate (AC2)', () => {
  it('canGenerateEval is false without an API key and reason mentions OpenRouter', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: false, masked: null };
    store.preferredModels = [{ slug: 'm', isDefault: true, position: 0 }];
    store.scores = {
      'job-1': {
        sourceId: 'job-1',
        stars: 4,
        percent: 80,
        factors: [],
        weightsVersion: 'v1',
        stale: false,
        scoredAt: 1,
      },
    };
    expect(store.canGenerateEval('job-1')).toBe(false);
    expect(store.evalDisabledReason('job-1')).toMatch(/OpenRouter|API key/i);
  });

  it('canGenerateEval is false without a default model and reason mentions model', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: true, masked: 'sk-…' };
    store.preferredModels = [];
    store.scores = {
      'job-1': {
        sourceId: 'job-1',
        stars: 4,
        percent: 80,
        factors: [],
        weightsVersion: 'v1',
        stale: false,
        scoredAt: 1,
      },
    };
    expect(store.canGenerateEval('job-1')).toBe(false);
    expect(store.evalDisabledReason('job-1')).toMatch(/model/i);
  });

  it('canGenerateEval is false without a persisted Epic 5 score and reason mentions score / rescore', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: true, masked: 'sk-…' };
    store.preferredModels = [{ slug: 'm', isDefault: true, position: 0 }];
    store.scores = {};
    expect(store.canGenerateEval('job-1')).toBe(false);
    expect(store.evalDisabledReason('job-1')).toMatch(/score|rescore|rate/i);
  });

  it('canGenerateEval is true when key + default model + score all present, reason empty', () => {
    installBridges();
    const store = useAppStore();
    store.apiKeyStatus = { present: true, masked: 'sk-…' };
    store.preferredModels = [{ slug: 'm', isDefault: true, position: 0 }];
    store.scores = {
      'job-1': {
        sourceId: 'job-1',
        stars: 4,
        percent: 80,
        factors: [],
        weightsVersion: 'v1',
        stale: false,
        scoredAt: 1,
      },
    };
    expect(store.canGenerateEval('job-1')).toBe(true);
    expect(store.evalDisabledReason('job-1')).toBe('');
  });
});

describe('app-store — web-research disclosure / setting (AC3)', () => {
  it('hydrateWebResearchSetting reads through the bridge and mirrors into state', async () => {
    const setting: StarWebResearchSetting = {
      webResearchEnabled: false,
      disclosureAcknowledged: false,
      disclosure: 'Disclosure copy.',
    };
    const getWebResearchSetting = vi.fn(async () => setting);
    installBridges({ eval: { getWebResearchSetting } });
    const store = useAppStore();
    await store.hydrateWebResearchSetting();
    expect(getWebResearchSetting).toHaveBeenCalled();
    expect(store.webResearchSetting?.disclosureAcknowledged).toBe(false);
    expect(store.webResearchSetting?.disclosure).toBe('Disclosure copy.');
  });

  it('setWebResearchEnabled writes through and updates state', async () => {
    const setWebResearchEnabled = vi.fn(async (enabled: boolean) => ({
      webResearchEnabled: enabled,
      disclosureAcknowledged: true,
      disclosure: 'D',
    }));
    installBridges({ eval: { setWebResearchEnabled } });
    const store = useAppStore();
    await store.setWebResearchEnabled(true);
    expect(setWebResearchEnabled).toHaveBeenCalledWith(true);
    expect(store.webResearchSetting?.webResearchEnabled).toBe(true);
  });

  it('acknowledgeWebResearchDisclosure writes through and flips disclosureAcknowledged', async () => {
    const acknowledgeWebResearchDisclosure = vi.fn(async () => ({
      webResearchEnabled: false,
      disclosureAcknowledged: true,
      disclosure: 'D',
    }));
    installBridges({ eval: { acknowledgeWebResearchDisclosure } });
    const store = useAppStore();
    await store.acknowledgeWebResearchDisclosure();
    expect(acknowledgeWebResearchDisclosure).toHaveBeenCalled();
    expect(store.webResearchSetting?.disclosureAcknowledged).toBe(true);
  });

  it('needsWebResearchDisclosure is true when setting hydrated with disclosureAcknowledged=false', async () => {
    const getWebResearchSetting = vi.fn(async () => ({
      webResearchEnabled: false,
      disclosureAcknowledged: false,
      disclosure: 'D',
    }));
    installBridges({ eval: { getWebResearchSetting } });
    const store = useAppStore();
    await store.hydrateWebResearchSetting();
    expect(store.needsWebResearchDisclosure).toBe(true);
  });

  it('needsWebResearchDisclosure is false once acknowledged', async () => {
    const getWebResearchSetting = vi.fn(async () => ({
      webResearchEnabled: false,
      disclosureAcknowledged: true,
      disclosure: 'D',
    }));
    installBridges({ eval: { getWebResearchSetting } });
    const store = useAppStore();
    await store.hydrateWebResearchSetting();
    expect(store.needsWebResearchDisclosure).toBe(false);
  });
});

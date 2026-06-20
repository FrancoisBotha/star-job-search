/**
 * Unit tests for TDE-007 — app-store actions for the Epic 7 → Epic 9 wiring:
 *   proposeTailorEngine(sourceId)
 *   applyTailorEngine({ sourceId, accepted, verifiedSkills? })
 *
 * Covers:
 *   AC1: proposeTailorEngine calls window.starTailorEngine.propose, stores the
 *        TailorEngineResult under tailorEngineProposals[sourceId], and the
 *        per-source action state moves idle → loading → idle.
 *   AC3: applyTailorEngine forwards ONLY the accepted subset to
 *        window.starTailorEngine.apply, persists the returned TailoredDoc
 *        under the CV key, and refreshes the deterministic Epic 5 score.
 *   AC4: error responses surface the stable engine code in the per-source
 *        state without the renderer parsing exception text.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

function installBridges(opts: {
  propose?: (input: StarTailorProposeInput) => Promise<StarTailorProposeResult>;
  apply?: (input: StarTailorApplyInput) => Promise<StarTailorApplyResult>;
  onProgress?: (cb: (e: StarTailorEngineProgressEvent) => void) => () => void;
  scoreGet?: (sourceId: string) => Promise<StarMatchScore | null>;
} = {}) {
  const w: Record<string, unknown> = {
    localStorage: {
      getItem: () => '1',
      setItem: () => {},
      removeItem: () => {},
    },
  };
  w.starTailorEngine = {
    propose: opts.propose ?? (async () => ({ ok: false, code: 'NO_DOC', error: 'noop' })),
    apply: opts.apply ?? (async () => ({ ok: false, code: 'NO_DOC', error: 'noop' })),
    onProgress: opts.onProgress ?? (() => () => {}),
  };
  if (opts.scoreGet) w.starScores = { get: opts.scoreGet };
  (globalThis as { window?: unknown }).window = w;
}

function makeProposal(
  overrides: Partial<StarTailorEngineResult> = {},
): StarTailorEngineResult {
  return {
    proposedChanges: [
      { path: 'summary', action: 'replace', original: 'a', value: 'b', reason: 'tighten' },
      { path: 'skills', action: 'add_skill', value: 'Go', reason: 'JD keyword' },
    ],
    rejected: [],
    warnings: [],
    refinementStats: {
      initialPercent: 50,
      finalPercent: 70,
      passes: 1,
      exitReason: 'no_injectable_keywords',
    },
    doc: {
      identity: { name: null, contact: { email: null, phone: null }, location: null },
      summary: '',
      skills: [],
      experience: [],
      projects: [],
      education: [],
      meta: { bulletSource: 'parsed' },
    },
    skillVerdicts: [],
    ...overrides,
  };
}

function makeTailoredDoc(): StarTailoredDoc {
  return {
    sourceId: 'job-1',
    kind: 'cv',
    content: '# Tailored CV',
    suggestions: [],
    atsReport: { score: 0, missingKeywords: [], checks: [] } as unknown as StarTailoredDoc['atsReport'],
    keywords: [],
    intensity: 'light',
    baseCvId: 'cv-1',
    modelSlug: 'm',
    generatedAt: 1,
    stale: false,
  } as StarTailoredDoc;
}

beforeEach(() => setActivePinia(createPinia()));

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('proposeTailorEngine (AC1)', () => {
  it('calls window.starTailorEngine.propose and stores the result keyed by sourceId', async () => {
    const proposal = makeProposal();
    const propose = vi.fn(async () => ({ ok: true as const, result: proposal }));
    installBridges({ propose });
    const store = useAppStore();

    const res = await store.proposeTailorEngine('job-1');

    expect(propose).toHaveBeenCalledWith({ sourceId: 'job-1' });
    expect(res?.ok).toBe(true);
    expect(store.tailorEngineProposals['job-1']).toEqual(proposal);
    expect(store.tailorEngineStateFor('job-1').status).toBe('idle');
  });

  it('surfaces the stable engine error code without parsing exception text', async () => {
    const propose = vi.fn(async () =>
      ({ ok: false as const, code: 'MODEL_NOT_CAPABLE' as const, error: 'no tools' }),
    );
    installBridges({ propose });
    const store = useAppStore();

    await store.proposeTailorEngine('job-1');

    const s = store.tailorEngineStateFor('job-1');
    expect(s.status).toBe('error');
    expect(s.code).toBe('MODEL_NOT_CAPABLE');
  });
});

describe('applyTailorEngine (AC3)', () => {
  it('sends ONLY the accepted subset to window.starTailorEngine.apply and persists the returned doc', async () => {
    const proposal = makeProposal();
    const propose = vi.fn(async () => ({ ok: true as const, result: proposal }));
    const persisted = makeTailoredDoc();
    const apply = vi.fn(
      async (_input: StarTailorApplyInput) =>
        ({ ok: true as const, doc: persisted, scored: 1 }),
    );
    const scoreGet = vi.fn(async () => null);
    installBridges({ propose, apply, scoreGet });
    const store = useAppStore();
    await store.proposeTailorEngine('job-1');

    // Only the FIRST change is accepted — the apply call must mirror that.
    const accepted = [proposal.proposedChanges[0]!];
    const res = await store.applyTailorEngine({
      sourceId: 'job-1',
      accepted,
      verifiedSkills: ['Go'],
    });

    expect(apply).toHaveBeenCalledTimes(1);
    const callArg = apply.mock.calls[0]![0];
    expect(callArg.sourceId).toBe('job-1');
    expect(callArg.accepted).toEqual(accepted);
    expect(callArg.verifiedSkills).toEqual(['Go']);
    expect(callArg.doc).toEqual(proposal.doc);
    expect(res?.ok).toBe(true);
    expect(store.tailoredDocs['job-1::cv']).toEqual(persisted);
    expect(scoreGet).toHaveBeenCalledWith('job-1');
  });
});

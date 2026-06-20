/**
 * Unit tests for the Tailor Engine IPC layer (TDE-006 — Epic 9).
 *
 * Acceptance criteria coverage:
 *  - AC1: tailor:propose runs the engine and returns TailorEngineResult.
 *         tailor:apply applies the user-accepted subset deterministically,
 *         persists via tailored_docs, and triggers the Epic 5 rescore.
 *  - AC2: handlers return tagged-union results with stable error codes
 *         (NO_API_KEY, NO_DOC, MODEL_NOT_CAPABLE, RATE_LIMITED, NETWORK).
 *         Progress events are forwarded to the injected sink.
 *  - AC4: tailor:apply is deterministic and NEVER calls the LLM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LangGraph shim — same lightweight one used by tailorEngine tests.
vi.mock('@langchain/langgraph', () => {
  const END = '__end__';
  const START = '__start__';
  class StateGraph<S extends Record<string, unknown>> {
    nodes = new Map<string, (s: S) => Promise<Partial<S>>>();
    edges = new Map<string, string>();
    conditional = new Map<
      string,
      { router: (s: S) => string | Promise<string>; mapping: Record<string, string> }
    >();
    constructor(_channels: unknown) {}
    addNode(name: string, fn: (s: S) => Promise<Partial<S>>) {
      this.nodes.set(name, fn);
      return this;
    }
    addEdge(from: string, to: string) {
      this.edges.set(from, to);
      return this;
    }
    addConditionalEdges(
      from: string,
      router: (s: S) => string | Promise<string>,
      mapping: Record<string, string>,
    ) {
      this.conditional.set(from, { router, mapping });
      return this;
    }
    compile() {
      return {
        invoke: async (initial: S): Promise<S> => {
          let state = { ...initial } as S;
          let current = this.edges.get(START);
          if (!current) throw new Error('no entry edge');
          for (let i = 0; i < 1000; i++) {
            if (current === END) break;
            const node = this.nodes.get(current);
            if (!node) throw new Error(`unknown node: ${current}`);
            const update = await node(state);
            state = { ...state, ...(update ?? {}) } as S;
            const cond = this.conditional.get(current);
            if (cond) {
              const pick = await cond.router(state);
              const next = cond.mapping[pick];
              if (!next) throw new Error(`bad route ${pick}`);
              current = next;
              continue;
            }
            const next = this.edges.get(current);
            if (!next) break;
            current = next;
          }
          return state;
        },
      };
    }
  }
  return { StateGraph, END, START };
});

vi.mock('better-sqlite3', () => ({ default: class {} }));

import type { TailorLLM } from '../tailorEngine';
import type { ProposedChange } from '../tailorGates';
import type { CvRecord } from '../cv';
import type { CvParsedFields } from '../cvStructurer';
import type { JobRecord } from '../jobs';
import type { ProfileRecord } from '../profile';
import type { TailoredDoc, TailoredDocsStore } from '../tailoredDocs';

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

// --- Fixtures -------------------------------------------------------------

const PARSED: CvParsedFields = {
  name: 'Alex Morgan',
  contact: { email: 'alex@example.com', phone: null },
  targetRole: 'Senior Engineer',
  skills: ['TypeScript', 'Node.js'],
  employmentHistory: [
    {
      company: 'Acme Co',
      role: 'Staff Engineer',
      startDate: '2022-01',
      endDate: '2026-01',
      summary: '- Led migration of monolith to services\n- Cut p95 latency by 40%',
    },
  ],
  education: [],
  totalYearsExperience: 10,
  location: 'London',
};

const MASTER_TEXT = [
  'Alex Morgan',
  'Skills: TypeScript, Node.js, Kubernetes, Docker, AWS',
  'Led migration of monolith to services.',
  'Cut p95 latency by 40%.',
].join('\n');

const JD_TEXT =
  'We are hiring a Senior Engineer with TypeScript, Kubernetes, and AWS. Docker experience a plus.';

function makeJob(over: Partial<JobRecord> = {}): JobRecord {
  return {
    sourceId: 'job-1',
    hostname: 'jobs.example.com',
    url: 'https://jobs.example.com/1',
    title: 'Senior Engineer',
    company: 'Acme',
    location: 'London',
    description: JD_TEXT,
    postedAt: null,
    fetchedAt: 1,
    status: 'new',
    ...over,
  };
}

function makeProfile(over: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    name: 'Alex',
    targetRole: 'Senior Engineer',
    yearsExperience: 10,
    location: 'London',
    workMode: 'Hybrid',
    salaryMin: null,
    salaryCurrency: 'GBP',
    linkedinUrl: '',
    links: [],
    skills: ['TypeScript', 'Node.js'],
    strengthScore: 0,
    updatedAt: 0,
    ...over,
  };
}

function makeCv(over: Partial<CvRecord> = {}): CvRecord {
  return {
    id: 'cv-1',
    profileId: 'singleton',
    fileName: 'cv.pdf',
    mime: 'pdf',
    storagePath: 'cv/singleton/1-cv.pdf',
    parsedText: MASTER_TEXT,
    parsedFields: PARSED as unknown as Record<string, unknown>,
    version: 1,
    confidence: null,
    uploadedAt: 1,
    ...over,
  };
}

function makeTailoredDocsStore() {
  const rows = new Map<string, TailoredDoc>();
  const store: TailoredDocsStore = {
    get: (sourceId, kind) => rows.get(`${sourceId}::${kind}`),
    upsert: (doc) => {
      rows.set(`${doc.sourceId}::${doc.kind}`, { ...doc });
    },
    markStale: (sourceId, kind) => {
      if (kind) {
        const row = rows.get(`${sourceId}::${kind}`);
        if (row) row.stale = true;
      } else {
        for (const [k, v] of Array.from(rows.entries())) {
          if (v.sourceId === sourceId) {
            v.stale = true;
            rows.set(k, v);
          }
        }
      }
    },
  };
  return { store, rows };
}

interface StubResponses {
  jdSignals?: { keywords: string[] };
  skillCandidates?: { skills: string[] };
  diffChanges?: { changes: ProposedChange[] };
  throwOn?: 'jdSignals' | 'skillCandidates' | 'diffChanges';
  throwMessage?: string;
}

function makeStubLlm(responses: StubResponses = {}): TailorLLM & { calls: string[] } {
  const calls: string[] = [];
  const llm: TailorLLM = {
    withStructuredOutput<T>(_schema: T, opts?: { name?: string }) {
      const name = opts?.name ?? 'anon';
      return {
        invoke: async (_input: unknown): Promise<unknown> => {
          calls.push(name);
          if (name === 'JdSignals') {
            if (responses.throwOn === 'jdSignals') {
              throw new Error(responses.throwMessage ?? 'forced failure');
            }
            return responses.jdSignals ?? { keywords: [] };
          }
          if (name === 'SkillCandidates') {
            if (responses.throwOn === 'skillCandidates') {
              throw new Error(responses.throwMessage ?? 'forced failure');
            }
            return responses.skillCandidates ?? { skills: [] };
          }
          if (name === 'ProposedChanges') {
            if (responses.throwOn === 'diffChanges') {
              throw new Error(responses.throwMessage ?? 'forced failure');
            }
            return responses.diffChanges ?? { changes: [] };
          }
          throw new Error(`stub LLM: unknown structured-output name ${name}`);
        },
      } as never;
    },
  };
  return Object.assign(llm, { calls });
}

function baseDeps(over: Record<string, unknown> = {}) {
  const docsStore = makeTailoredDocsStore();
  const jobs = [makeJob()];
  const cvs = [makeCv()];
  const reviewRows = new Map<string, { keywords: string[] }>();
  const reviewsStore = {
    get: (id: string) => reviewRows.get(id),
    upsert: vi.fn(),
    markStale: vi.fn(),
  };
  const rescore = vi.fn(async (_sourceId: string) => ({ scored: 1 }));
  const progress: unknown[] = [];
  const emitProgress = (e: unknown) => {
    progress.push(e);
  };
  const llm = makeStubLlm({
    jdSignals: { keywords: ['TypeScript', 'Kubernetes', 'AWS'] },
    skillCandidates: { skills: ['Kubernetes', 'AWS'] },
    diffChanges: { changes: [] },
  });
  const buildLlm = vi.fn(async () => llm);
  return {
    docsStore,
    reviewRows,
    rescore,
    progress,
    llm,
    buildLlm,
    deps: {
      store: docsStore.store,
      jobsStore: {
        knownSourceIds: () => new Set(jobs.map((j) => j.sourceId)),
        upsertJobs: () => 0,
        listJobs: () => jobs,
        setStatus: vi.fn(),
        deleteAll: () => 0,
        getSiteProfile: () => undefined,
        saveSiteProfile: vi.fn(),
      },
      cvStore: {
        upload: vi.fn(),
        list: () => cvs,
        get: (id: string) => cvs.find((c) => c.id === id) ?? null,
        clear: vi.fn(),
      },
      reviewsStore,
      getProfile: () => makeProfile(),
      getApiKey: () => 'sk-test' as string | null,
      getDefaultModel: () => 'openrouter/test' as string | null,
      buildLlm,
      rescore,
      emitProgress,
      now: () => 99999,
      ...over,
    },
  };
}

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../tailorEngineIpc');
}

// -------------------------------------------------------------------------
// AC1 — registration
// -------------------------------------------------------------------------

describe('registerTailorEngineIpc — channel registration (AC1)', () => {
  it('registers tailor:propose and tailor:apply', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const { deps } = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, deps as never);
    expect(ipcHandlers.has('tailor:propose')).toBe(true);
    expect(ipcHandlers.has('tailor:apply')).toBe(true);
  });
});

// -------------------------------------------------------------------------
// AC1 — propose runs the graph and returns TailorEngineResult
// -------------------------------------------------------------------------

describe('tailor:propose happy path (AC1)', () => {
  it('runs the engine and returns a TailorEngineResult', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);

    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: boolean; result?: { refinementStats: unknown; doc: unknown } };

    expect(result.ok).toBe(true);
    if (!result.ok || !result.result) throw new Error('expected ok');
    expect(result.result.refinementStats).toBeDefined();
    expect(result.result.doc).toBeDefined();
    expect(setup.buildLlm).toHaveBeenCalled();
  });

  it('forwards progress events to the injected sink (AC2)', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    await ipcHandlers.get('tailor:propose')!({}, { sourceId: 'job-1' });
    const phases = (setup.progress as Array<{ phase: string; sourceId: string }>).map(
      (e) => e.phase,
    );
    expect(phases).toContain('extract-jd-signals');
    expect(phases).toContain('rescore');
    for (const e of setup.progress as Array<{ sourceId: string }>) {
      expect(e.sourceId).toBe('job-1');
    }
  });

  it('reuses cached Epic 6 review keywords (skips JD-signals LLM call)', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    setup.reviewRows.set('job-1', { keywords: ['TypeScript', 'Kubernetes'] });
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    await ipcHandlers.get('tailor:propose')!({}, { sourceId: 'job-1' });
    expect(setup.llm.calls).not.toContain('JdSignals');
  });
});

// -------------------------------------------------------------------------
// AC2 — tagged-union errors
// -------------------------------------------------------------------------

describe('tailor:propose error codes (AC2)', () => {
  it('NO_API_KEY when the API key is missing', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps({ getApiKey: () => null });
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_API_KEY');
  });

  it('NO_DOC when the sourceId does not match a known job', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'nope' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_DOC');
  });

  it('NO_DOC when there is no CV uploaded', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps({
      cvStore: {
        upload: vi.fn(),
        list: () => [],
        get: () => null,
        clear: vi.fn(),
      },
    });
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_DOC');
  });

  it('MODEL_NOT_CAPABLE when the model rejects function calling', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    const badLlm = makeStubLlm({
      throwOn: 'jdSignals',
      throwMessage: 'The model does not support function calling / tools.',
    });
    setup.deps.buildLlm = vi.fn(async () => badLlm) as never;
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('MODEL_NOT_CAPABLE');
  });

  it('RATE_LIMITED on a 429-flavoured LLM failure', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    const badLlm = makeStubLlm({
      throwOn: 'jdSignals',
      throwMessage: 'HTTP 429 rate-limit exceeded',
    });
    setup.deps.buildLlm = vi.fn(async () => badLlm) as never;
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RATE_LIMITED');
  });

  it('NETWORK on a network-flavoured LLM failure', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    const badLlm = makeStubLlm({
      throwOn: 'jdSignals',
      throwMessage: 'fetch failed: ECONNRESET',
    });
    setup.deps.buildLlm = vi.fn(async () => badLlm) as never;
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const result = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NETWORK');
  });
});

// -------------------------------------------------------------------------
// AC1 + AC4 — apply is deterministic, persists, rescore, no LLM
// -------------------------------------------------------------------------

describe('tailor:apply (AC1 + AC4)', () => {
  it('applies the accepted subset deterministically, persists, triggers rescore — no LLM', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);

    // First propose to obtain a doc the renderer would persist.
    const propose = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: true; result: { doc: unknown } };
    expect(propose.ok).toBe(true);

    // Reset LLM call counter — apply must NOT invoke the LLM.
    setup.llm.calls.length = 0;
    setup.buildLlm.mockClear();

    const accepted: ProposedChange[] = [
      {
        path: 'summary',
        action: 'replace',
        original: '',
        value: 'Senior engineer focused on Kubernetes and AWS.',
        reason: 'tighten summary',
      },
    ];

    const applyRes = (await ipcHandlers.get('tailor:apply')!(
      {},
      {
        sourceId: 'job-1',
        doc: propose.result.doc,
        accepted,
      },
    )) as { ok: boolean; doc?: TailoredDoc; scored?: number };

    expect(applyRes.ok).toBe(true);
    if (!applyRes.ok || !applyRes.doc) throw new Error('expected ok');
    expect(applyRes.doc.sourceId).toBe('job-1');
    expect(applyRes.doc.kind).toBe('cv');
    expect(applyRes.doc.baseCvId).toBe('cv-1');
    expect(applyRes.doc.modelSlug).toBe('openrouter/test');
    expect(applyRes.doc.generatedAt).toBe(99999);
    expect(applyRes.doc.stale).toBe(false);
    expect(applyRes.doc.content).toContain('Senior engineer focused on Kubernetes');
    expect(setup.docsStore.rows.get('job-1::cv')).toBeDefined();
    expect(setup.rescore).toHaveBeenCalledWith('job-1');
    expect(applyRes.scored).toBe(1);

    // AC4 — apply NEVER calls the LLM.
    expect(setup.buildLlm).not.toHaveBeenCalled();
    expect(setup.llm.calls.length).toBe(0);
  });

  it('apply is deterministic: same inputs → identical persisted content', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);

    const propose = (await ipcHandlers.get('tailor:propose')!(
      {},
      { sourceId: 'job-1' },
    )) as { ok: true; result: { doc: unknown } };
    const accepted: ProposedChange[] = [];
    const a = (await ipcHandlers.get('tailor:apply')!(
      {},
      { sourceId: 'job-1', doc: propose.result.doc, accepted },
    )) as { ok: true; doc: TailoredDoc };
    const b = (await ipcHandlers.get('tailor:apply')!(
      {},
      { sourceId: 'job-1', doc: propose.result.doc, accepted },
    )) as { ok: true; doc: TailoredDoc };
    expect(a.doc.content).toEqual(b.doc.content);
  });

  it('NO_DOC when the sourceId does not match a known job', async () => {
    const { registerTailorEngineIpc } = await importModule();
    const setup = baseDeps();
    registerTailorEngineIpc(fakeIpcMain as never, setup.deps as never);
    const res = (await ipcHandlers.get('tailor:apply')!(
      {},
      { sourceId: 'nope', doc: {}, accepted: [] },
    )) as { ok: false; code: string };
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NO_DOC');
  });
});

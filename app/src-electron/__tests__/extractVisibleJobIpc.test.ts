/**
 * Unit tests for the visible-job extract IPC (XJOB-003 / Epic 11).
 *
 * Acceptance criteria coverage:
 *  - AC1: `ai:extractVisible` captures the foreground view (XJOB-001) and runs
 *         the structuring (XJOB-002), returning a tagged-union result and
 *         emitting `extracting` / `result` progress events.
 *  - AC3: extracted job carries `source: 'manual'` provenance.
 *  - AC4: stable error codes for NO_API_KEY / MODEL_NOT_CAPABLE / NO_VIEW /
 *         NO_POSTING surface across the IPC boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));
vi.mock('@langchain/langgraph', () => {
  class StateGraph {
    addNode() { return this; }
    addEdge() { return this; }
    addConditionalEdges() { return this; }
    compile() { return { invoke: async (s: unknown) => s }; }
  }
  return { StateGraph, END: '__end__', START: '__start__' };
});

import type { JobsStore, JobRecord } from '../jobs';
import type { StructuredLlm, StructuredJob } from '../jobExtractor';
import {
  registerExtractVisibleIpc,
  EXTRACT_VISIBLE_PROGRESS_CHANNEL,
  type ExtractVisibleIpcDeps,
} from '../extractVisibleJobIpc';

// --- Fake IPC -------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
  removeHandler: (channel: string) => handlers.delete(channel),
};

beforeEach(() => handlers.clear());
afterEach(() => handlers.clear());

// --- Fakes ----------------------------------------------------------------

function makeStore(): { store: JobsStore; upserted: JobRecord[] } {
  const upserted: JobRecord[] = [];
  const known = new Set<string>();
  const store: JobsStore = {
    knownSourceIds: () => new Set(known),
    upsertJobs: (jobs) => {
      let inserted = 0;
      for (const j of jobs) {
        if (!known.has(j.sourceId)) {
          known.add(j.sourceId);
          upserted.push(j);
          inserted++;
        }
      }
      return inserted;
    },
    listJobs: () => upserted.slice(),
    setStatus: () => undefined,
    deleteAll: () => 0,
    delete: () => 0,
    getSiteProfile: () => undefined,
    saveSiteProfile: () => undefined,
  };
  return { store, upserted };
}

function makeWc(opts: { url?: string; text?: string }) {
  return {
    getURL: () => opts.url ?? 'https://jobs.example.com/postings/123',
    executeJavaScript: vi.fn(async (code: string) => {
      if (code.includes('STAR_FG_REGION')) {
        return { sel: 'main', text: opts.text ?? 'Senior Engineer description body' };
      }
      return opts.text ?? '';
    }),
  };
}

function makeLlm(payload: Partial<StructuredJob> | Error): StructuredLlm {
  return {
    withStructuredOutput: () => ({
      invoke: async () => {
        if (payload instanceof Error) throw payload;
        return payload as never;
      },
    }),
  };
}

function baseDeps(over: Partial<ExtractVisibleIpcDeps> = {}): {
  deps: ExtractVisibleIpcDeps;
  progress: Array<Record<string, unknown>>;
  upserted: JobRecord[];
  scoreCalls: string[];
} {
  const { store, upserted } = makeStore();
  const progress: Array<Record<string, unknown>> = [];
  const scoreCalls: string[] = [];
  const deps: ExtractVisibleIpcDeps = {
    jobsStore: store,
    getVisibleTarget: () => makeWc({}) as never,
    getApiKey: () => 'sk-test',
    getDefaultModel: () => 'openrouter/test',
    buildLlm: async () =>
      makeLlm({
        title: 'Senior Engineer',
        company: 'Acme',
        location: 'Remote',
        description: 'Build cool things.',
        salary: null,
      }),
    scoreOne: async (id) => {
      scoreCalls.push(id);
    },
    emitProgress: (e) => progress.push(e),
    now: () => 1_700_000_000_000,
    ...over,
  };
  return { deps, progress, upserted, scoreCalls };
}

// --- Tests ----------------------------------------------------------------

describe('extract-visible IPC — XJOB-003', () => {
  it('AC1: ai:extractVisible captures the foreground view, runs structuring, returns { ok, job }', async () => {
    const { deps, progress, upserted, scoreCalls } = baseDeps();
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const handler = handlers.get('ai:extractVisible');
    expect(handler).toBeDefined();

    const res = (await handler!(null)) as {
      ok: true;
      job: JobRecord;
    };
    expect(res.ok).toBe(true);
    expect(res.job.title).toBe('Senior Engineer');
    expect(upserted).toHaveLength(1);
    expect(scoreCalls).toEqual([upserted[0]!.sourceId]);

    // AC1: progress emits extracting then result
    const phases = progress.map((p) => p['phase']);
    expect(phases[0]).toBe('extracting');
    expect(phases[phases.length - 1]).toBe('result');
    expect(progress[progress.length - 1]!['ok']).toBe(true);
  });

  it('AC3: manually-extracted job is marked with source: "manual"', async () => {
    const { deps, upserted } = baseDeps();
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const res = (await handlers.get('ai:extractVisible')!(null)) as {
      ok: true;
      job: JobRecord;
    };
    expect(res.ok).toBe(true);
    expect(res.job.source).toBe('manual');
    expect(upserted[0]!.source).toBe('manual');
  });

  it('AC4: NO_API_KEY when the Epic 2 key is missing', async () => {
    const { deps, progress } = baseDeps({ getApiKey: () => null });
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const res = (await handlers.get('ai:extractVisible')!(null)) as {
      ok: false;
      code: string;
    };
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NO_API_KEY');
    // result event still emitted so the renderer can drop the spinner
    expect(progress.some((p) => p['phase'] === 'result' && p['ok'] === false)).toBe(true);
  });

  it('AC4: NO_DEFAULT_MODEL when no preferred model is marked default', async () => {
    const { deps } = baseDeps({ getDefaultModel: () => null });
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const res = (await handlers.get('ai:extractVisible')!(null)) as {
      ok: false;
      code: string;
    };
    expect(res.code).toBe('NO_DEFAULT_MODEL');
  });

  it('AC4: NO_VIEW when no foreground board view is open', async () => {
    const { deps } = baseDeps({ getVisibleTarget: () => undefined });
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const res = (await handlers.get('ai:extractVisible')!(null)) as {
      ok: false;
      code: string;
    };
    expect(res.code).toBe('NO_VIEW');
  });

  it('AC4: NO_POSTING when the LLM extracts no recognisable job (empty title)', async () => {
    const { deps } = baseDeps({
      buildLlm: async () =>
        makeLlm({
          title: '',
          company: null,
          location: null,
          description: null,
          salary: null,
        }),
    });
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const res = (await handlers.get('ai:extractVisible')!(null)) as {
      ok: false;
      code: string;
    };
    expect(res.code).toBe('NO_POSTING');
  });

  it('AC4: MODEL_NOT_CAPABLE when the selected model rejects structured output', async () => {
    const { deps } = baseDeps({
      buildLlm: async () =>
        makeLlm(new Error('model does not support function calling tools')),
    });
    registerExtractVisibleIpc(fakeIpcMain as never, deps);
    const res = (await handlers.get('ai:extractVisible')!(null)) as {
      ok: false;
      code: string;
    };
    expect(res.code).toBe('MODEL_NOT_CAPABLE');
  });

  it('progress channel name is exported for the preload bridge', () => {
    expect(EXTRACT_VISIBLE_PROGRESS_CHANNEL).toBe('ai:extractVisible:progress');
  });
});

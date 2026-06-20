/**
 * EXTR-018 — Graceful stop for gated / un-learnable boards.
 *
 * Acceptance criteria covered:
 *  AC1 — Discover/selector-learning phase is bounded: if relearn still
 *        produces zero cards after the EXTR-014 readiness waits, extraction
 *        STOPS with a terminal `error` phase (kind: 'unsupported') instead of
 *        looping or hanging on 'Discovering listing…'.
 *  AC2 — Login-wall / authenticated-gate detection extends the existing
 *        CAPTCHA check: matching markers raise a terminal `error` phase
 *        (kind: 'gated') — no bypass attempt — per FR-SCAN-010.
 *  AC4 — The terminal error phase resolves the run cleanly so a subsequent
 *        run can be started without lingering state.
 *  AC5 — Tests cover both stop paths (discover-timeout and gated).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// Trimmed langgraph fake (mirrors extr-014 + extr-013 tests).
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
          if (!current) throw new Error('graph missing entry edge');
          for (let i = 0; i < 1000; i++) {
            if (current === END) break;
            const node = this.nodes.get(current);
            if (!node) throw new Error(`unknown node ${current}`);
            const update = await node(state);
            state = { ...state, ...(update ?? {}) } as S;
            const cond = this.conditional.get(current);
            if (cond) {
              const pick = await cond.router(state);
              const next = cond.mapping[pick];
              if (!next) throw new Error(`router for ${current} → unknown key ${pick}`);
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

interface StoreData {
  known: Set<string>;
  profiles: Map<
    string,
    { hostname: string; selectors?: Record<string, string> | null; learnedAt: number }
  >;
  upserted: Array<{ sourceId: string; title?: string | null }>;
}

function makeStore() {
  const data: StoreData = { known: new Set(), profiles: new Map(), upserted: [] };
  return {
    data,
    store: {
      knownSourceIds: () => new Set(data.known),
      upsertJobs: (jobs: Array<{ sourceId: string; title?: string | null }>) => {
        let inserted = 0;
        for (const j of jobs) {
          if (!data.known.has(j.sourceId)) {
            data.known.add(j.sourceId);
            data.upserted.push(j);
            inserted++;
          }
        }
        return inserted;
      },
      listJobs: () => [],
      setStatus: () => {},
      getSiteProfile: (host: string) => data.profiles.get(host),
      saveSiteProfile: (p: {
        hostname: string;
        learnedAt: number;
        selectors?: Record<string, string> | null;
      }) => {
        data.profiles.set(p.hostname, p);
      },
    },
  };
}

function makeStubLlm(
  selectors: { cardSelector: string; linkSelector: string; nextSelector?: string | null } = {
    cardSelector: '.job',
    linkSelector: 'a',
    nextSelector: null,
  },
) {
  return {
    withStructuredOutput: (_schema: unknown, meta?: { name?: string }) => {
      const name = meta?.name ?? '';
      return {
        invoke: async (_input: unknown) => {
          if (name === 'SelectorSet' || name === 'SelectorSchema') return selectors;
          return { title: 'Stub job', company: 'Acme' };
        },
      };
    },
  };
}

afterEach(() => {
  vi.resetModules();
});

describe('EXTR-018 — graceful stop for un-learnable boards (AC1, AC4, AC5)', () => {
  it('emits a terminal `error` event with kind "unsupported" when relearn still yields zero cards', async () => {
    const { createJobExtractor } = await import('../jobExtractor');
    const { store } = makeStore();

    const surface = {
      navigate: vi.fn(async () => undefined),
      waitForReady: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => false),
      // Always empty — selector-learning + relearn both produce zero cards.
      queryAll: vi.fn(async () => []),
      getText: vi.fn(async () => ''),
      click: vi.fn(async () => undefined),
      getOuterHtml: vi.fn(async () => '<html><body><div/></body></html>'),
    };

    const events: Array<Record<string, unknown>> = [];
    const extractor = createJobExtractor({
      store: store as never,
      browser: surface as never,
      llm: makeStubLlm() as never,
      throttleMs: 0,
      onProgress: (e) => events.push(e as unknown as Record<string, unknown>),
    });

    const result = await extractor.run({
      searchUrl: 'https://corporate-careers.example.com/jobs',
    });

    // AC1 + AC4: run completes (no hang) with a terminal error event, NOT 'done'.
    const phases = events.map((e) => String(e.phase));
    const terminal = events[events.length - 1]!;
    expect(terminal.phase).toBe('error');
    expect(terminal.kind).toBe('unsupported');
    expect(phases).not.toContain('done');
    expect(result.imported).toBe(0);
  });
});

describe('EXTR-018 — login-wall / gated-board detection (AC2, AC5)', () => {
  it('detects a login-wall via body text markers and emits `error` kind "gated" — no bypass attempted', async () => {
    const { createJobExtractor } = await import('../jobExtractor');
    const { store } = makeStore();

    const surface = {
      navigate: vi.fn(async () => undefined),
      waitForReady: vi.fn(async () => undefined),
      waitForSelector: vi.fn(async () => true),
      queryAll: vi.fn(async () => []),
      // Body advertises a login-wall — a classic FR-SCAN-010 gated case.
      getText: vi.fn(async () =>
        'Please sign in to continue. You must log in to view these jobs.',
      ),
      click: vi.fn(async () => undefined),
      getOuterHtml: vi.fn(async () => '<html><body/></html>'),
    };

    const events: Array<Record<string, unknown>> = [];
    const extractor = createJobExtractor({
      store: store as never,
      browser: surface as never,
      llm: makeStubLlm() as never,
      throttleMs: 0,
      onProgress: (e) => events.push(e as unknown as Record<string, unknown>),
    });

    const result = await extractor.run({
      searchUrl: 'https://gated-board.example.com/jobs',
    });

    const terminal = events[events.length - 1]!;
    expect(terminal.phase).toBe('error');
    expect(terminal.kind).toBe('gated');
    expect(result.imported).toBe(0);
    // Never attempted to bypass — no detail navigation happened.
    expect(surface.navigate).toHaveBeenCalledTimes(1);
  });
});

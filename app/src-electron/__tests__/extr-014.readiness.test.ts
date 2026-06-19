/**
 * EXTR-014 — Wait for page load + dynamic content before selector-learning
 *            and enumeration.
 *
 * Acceptance criteria covered:
 *  AC2 — The hidden crawler waits for the navigated page to FINISH loading
 *        before capturing HTML for selector-learning and before enumerate.
 *        (Surfaced via BrowserSurface.waitForReady being awaited after
 *        navigate and before getOuterHtml / queryAll.)
 *  AC3 — For JS-rendered boards, extraction additionally waits for dynamic
 *        listing content to render before enumerate (polls waitForSelector
 *        until the cards exist). A stubbed surface returning empty-then-
 *        populated cards must end with candidates, not zero.
 *  AC4 — If no cards are found after waiting, the relearn fallback runs even
 *        for newly-learned (non-cached) selectors before concluding zero.
 *  AC5 — A regression test (stubbed browser, empty-then-populated DOM)
 *        asserts enumeration waits for readiness and returns candidates.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// Mirror the trimmed-down langgraph fake used by extr-013 so the StateGraph
// can run end-to-end in node without pulling the real langgraph runtime.
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

function makeStore(seedKnown: string[] = []) {
  const data: StoreData = {
    known: new Set(seedKnown),
    profiles: new Map(),
    upserted: [],
  };
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

describe('EXTR-014 — readiness waits before selector-learning and enumeration', () => {
  it('AC2: waits for page load (waitForReady) before capturing HTML for selector-learning', async () => {
    const { createJobExtractor } = await import('../jobExtractor');
    const { store } = makeStore();

    const order: string[] = [];
    let ready = false;
    const surface = {
      navigate: vi.fn(async (_url: string) => {
        order.push('navigate');
        ready = false;
      }),
      waitForReady: vi.fn(async () => {
        order.push('waitForReady');
        ready = true;
      }),
      waitForSelector: vi.fn(async (_sel: string) => {
        return ready;
      }),
      queryAll: vi.fn(async () => {
        order.push('queryAll');
        return ready
          ? [{ text: 'Senior Eng', href: 'https://au.seek.com/job/1?id=1', html: '<div/>' }]
          : [];
      }),
      getText: vi.fn(async () => {
        order.push('getText');
        return '';
      }),
      click: vi.fn(async () => undefined),
      getOuterHtml: vi.fn(async (_sel?: string) => {
        order.push('getOuterHtml');
        // Should never be reached before waitForReady has marked the page ready.
        if (!ready) throw new Error('getOuterHtml called before waitForReady resolved');
        return '<html><body><div class="job"><a href="/job/1">Hi</a></div></body></html>';
      }),
    };

    const extractor = createJobExtractor({
      store: store as never,
      browser: surface as never,
      llm: makeStubLlm() as never,
      throttleMs: 0,
    });

    const result = await extractor.run({ searchUrl: 'https://au.seek.com/jobs?keywords=engineer' });

    expect(surface.waitForReady).toHaveBeenCalled();
    // waitForReady must precede the FIRST HTML-capture call.
    expect(order.indexOf('waitForReady')).toBeLessThan(order.indexOf('getOuterHtml'));
    // And must precede the FIRST enumerate (queryAll) call.
    expect(order.indexOf('waitForReady')).toBeLessThan(order.indexOf('queryAll'));
    expect(result.imported).toBe(1);
  });

  it(
    'AC3 + AC5: empty-then-populated DOM → enumeration waits for cards to render and ' +
      'returns candidates rather than reporting zero',
    async () => {
      const { createJobExtractor } = await import('../jobExtractor');
      const { store } = makeStore();

      // The page reports "loading" for the first two waitForSelector polls,
      // then populates cards. queryAll mirrors that: empty until the selector
      // wait resolved truthy.
      let pollsBeforeReady = 1;
      let cardsRendered = false;
      const surface = {
        navigate: vi.fn(async (_url: string) => {
          cardsRendered = false;
        }),
        waitForReady: vi.fn(async () => undefined),
        waitForSelector: vi.fn(async (_selector: string) => {
          if (pollsBeforeReady > 0) {
            pollsBeforeReady--;
            return false;
          }
          cardsRendered = true;
          return true;
        }),
        queryAll: vi.fn(async () => {
          if (!cardsRendered) return [];
          return [
            { text: 'Senior Eng', href: 'https://au.seek.com/job/1?id=1', html: '<div/>' },
            { text: 'Backend Eng', href: 'https://au.seek.com/job/2?id=2', html: '<div/>' },
          ];
        }),
        getText: vi.fn(async () => ''),
        click: vi.fn(async () => undefined),
        getOuterHtml: vi.fn(async () => '<html><body><div class="job"/></body></html>'),
      };

      const extractor = createJobExtractor({
        store: store as never,
        browser: surface as never,
        llm: makeStubLlm() as never,
        throttleMs: 0,
      });

      const result = await extractor.run({
        searchUrl: 'https://au.seek.com/jobs?keywords=engineer',
      });

      // The selector wait must have been polled.
      expect(surface.waitForSelector).toHaveBeenCalled();
      // And enumeration ultimately found the cards rather than returning 0.
      expect(result.total).toBe(2);
      expect(result.imported).toBe(2);
    },
  );

  it(
    'AC4: when freshly-learned (non-cached) selectors enumerate zero cards, the ' +
      'relearn fallback runs once before concluding "no listings"',
    async () => {
      const { createJobExtractor } = await import('../jobExtractor');
      const { store } = makeStore();

      // No cached profile → discoverNode learns selectors for the first time.
      // The first enumerate sees the page still rendering a loading state, so
      // returns zero. After that, the relearn fallback re-learns and finds
      // cards.
      let enumerateCalls = 0;
      const surface = {
        navigate: vi.fn(async (_url: string) => undefined),
        waitForReady: vi.fn(async () => undefined),
        // First two selector waits resolve false (no cards yet); after that the
        // page settles and cards appear.
        waitForSelector: vi.fn(async (_selector: string) => true),
        queryAll: vi.fn(async () => {
          enumerateCalls++;
          if (enumerateCalls === 1) return [];
          return [
            { text: 'Senior Eng', href: 'https://au.seek.com/job/1?id=1', html: '<div/>' },
          ];
        }),
        getText: vi.fn(async () => ''),
        click: vi.fn(async () => undefined),
        getOuterHtml: vi.fn(async () => '<html><body><div class="job"/></body></html>'),
      };

      // LLM returns different selectors on the 2nd call so we can see relearn
      // actually re-invoked the learner.
      let learnCalls = 0;
      const llm = {
        withStructuredOutput: (_schema: unknown, meta?: { name?: string }) => {
          const name = meta?.name ?? '';
          return {
            invoke: async (_input: unknown) => {
              if (name === 'SelectorSet' || name === 'SelectorSchema') {
                learnCalls++;
                return learnCalls === 1
                  ? { cardSelector: '.stale', linkSelector: 'a', nextSelector: null }
                  : { cardSelector: '.job', linkSelector: 'a', nextSelector: null };
              }
              return { title: 'Stub job' };
            },
          };
        },
      };

      const extractor = createJobExtractor({
        store: store as never,
        browser: surface as never,
        llm: llm as never,
        throttleMs: 0,
      });

      const result = await extractor.run({
        searchUrl: 'https://au.seek.com/jobs?keywords=engineer',
      });

      // Relearn fired exactly once (two total selector-learn invocations).
      expect(learnCalls).toBe(2);
      // And the second enumerate succeeded — we did NOT conclude zero.
      expect(result.total).toBe(1);
      expect(result.imported).toBe(1);
    },
  );
});

/**
 * Unit tests for extraction safety boundaries (EXTR-005).
 *
 * Covers acceptance criteria:
 *  - AC1: When a results or detail page presents a CAPTCHA / bot challenge,
 *         the run stops with a clear 'error' progress event and does NOT
 *         attempt to bypass it.
 *  - AC2: Requests are paced (throttle between navigations/pages) and the
 *         crawl never exceeds the configured maxPages cap.
 *  - AC3: On any mid-run failure, jobs already extracted are still persisted
 *         and a clear failure message is surfaced — the board is not left in
 *         a corrupted/partial state.
 *  - AC4: Page content is treated as untrusted — the extractor only uses the
 *         read-mostly BrowserSurface contract (navigate, queryAll, getText,
 *         getOuterHtml, click) and never reaches for a trusted-only JS
 *         evaluation surface against arbitrary pages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Reuse the minimal StateGraph fake from EXTR-004 -----------------------
//
// Drives nodes deterministically using the edges/conditionals declared by the
// extractor module.

interface GraphRecord {
  nodes: string[];
  edges: Array<[string, string]>;
  conditional: Array<{ from: string; mapping: Record<string, string> }>;
  routerCalls: Array<{ from: string; pick: string }>;
}

const lastGraph: { current?: GraphRecord | undefined } = {};

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
    record: GraphRecord = { nodes: [], edges: [], conditional: [], routerCalls: [] };

    constructor(_channels: unknown) {
      lastGraph.current = this.record;
    }
    addNode(name: string, fn: (s: S) => Promise<Partial<S>>) {
      this.nodes.set(name, fn);
      this.record.nodes.push(name);
      return this;
    }
    addEdge(from: string, to: string) {
      this.edges.set(from, to);
      this.record.edges.push([from, to]);
      return this;
    }
    addConditionalEdges(
      from: string,
      router: (s: S) => string | Promise<string>,
      mapping: Record<string, string>,
    ) {
      this.conditional.set(from, { router, mapping });
      this.record.conditional.push({ from, mapping });
      return this;
    }
    compile() {
      return {
        invoke: async (initial: S): Promise<S> => {
          let state = { ...initial } as S;
          let current = this.edges.get(START);
          if (!current) throw new Error('graph has no entry edge from __start__');
          for (let i = 0; i < 1000; i++) {
            if (current === END) break;
            const node = this.nodes.get(current);
            if (!node) throw new Error(`unknown node: ${current}`);
            const update = await node(state);
            state = { ...state, ...(update ?? {}) } as S;
            const cond = this.conditional.get(current);
            if (cond) {
              const pick = await cond.router(state);
              this.record.routerCalls.push({ from: current, pick });
              const next = cond.mapping[pick];
              if (!next) throw new Error(`router for ${current} returned unknown key ${pick}`);
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

  const Annotation = {
    Root: (cfg: unknown) => cfg,
  } as unknown as { Root: (cfg: unknown) => unknown } & ((..._a: unknown[]) => unknown);

  return { StateGraph, END, START, Annotation };
});

beforeEach(() => {
  lastGraph.current = undefined;
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../jobExtractor');
}

// --- helpers ---------------------------------------------------------------

interface FakeStoreState {
  known: Set<string>;
  profiles: Map<
    string,
    {
      hostname: string;
      selectors?: Record<string, string> | null;
      idRegex?: string | null;
      learnedAt: number;
    }
  >;
  upserted: Array<{ sourceId: string; title?: string | null }>;
}

function makeStore() {
  const data: FakeStoreState = { known: new Set(), profiles: new Map(), upserted: [] };
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
        idRegex?: string | null;
      }) => {
        data.profiles.set(p.hostname, p);
      },
    },
  };
}

interface Card {
  text: string;
  href: string;
  html: string;
}
interface PageScript {
  cards: Card[];
  bodyText: Record<string, string>;
}

interface BrowserOpts {
  /** body text to return when getText('body') runs against the search URL */
  searchBody?: string;
  /** body text per detail URL; falls back to PageScript.bodyText */
  detailBody?: Record<string, string>;
  /** make browser.navigate throw on these URLs */
  navigateFails?: string[];
}

function makeBrowser(pages: PageScript[], opts: BrowserOpts = {}) {
  let pageIdx = 0;
  let currentUrl = '';
  const calls: Array<{ kind: string; args?: unknown }> = [];
  return {
    calls,
    pageIdx: () => pageIdx,
    currentUrl: () => currentUrl,
    surface: {
      navigate: async (url: string) => {
        calls.push({ kind: 'navigate', args: url });
        if (opts.navigateFails?.includes(url)) throw new Error(`nav failed: ${url}`);
        currentUrl = url;
      },
      queryAll: async (qopts: { selector: string; linkSelector?: string }) => {
        calls.push({ kind: 'queryAll', args: qopts });
        const page = pages[pageIdx];
        return page ? page.cards : [];
      },
      getText: async (selector?: string) => {
        calls.push({ kind: 'getText', args: selector });
        // First call against the search URL — return the configured search body
        // (lets us inject CAPTCHA-looking content for AC1).
        if (currentUrl && opts.searchBody !== undefined && pages[0]?.cards.every((c) => c.href !== currentUrl)) {
          // currentUrl points at the original search URL (not a detail)
          return opts.searchBody;
        }
        if (opts.detailBody && currentUrl in opts.detailBody) {
          return opts.detailBody[currentUrl]!;
        }
        const page = pages[pageIdx];
        const text = page?.bodyText[currentUrl];
        return text ?? 'fallback body';
      },
      getOuterHtml: async (selector?: string) => {
        calls.push({ kind: 'getOuterHtml', args: selector });
        return '<html><body>sample</body></html>';
      },
      click: async (selector: string) => {
        calls.push({ kind: 'click', args: selector });
        pageIdx++;
      },
    },
  };
}

function makeLlm(opts: {
  selectors?: { cardSelector: string; linkSelector: string; nextSelector?: string | null };
  extract?: (input: unknown) => {
    title: string;
    company?: string;
    location?: string;
    description?: string;
  };
}) {
  const calls: Array<{ schema: string; input: unknown }> = [];
  return {
    calls,
    llm: {
      withStructuredOutput: (_schema: unknown, meta?: { name?: string }) => {
        const name = meta?.name ?? '';
        return {
          invoke: async (input: unknown) => {
            calls.push({ schema: name, input });
            if (name === 'SelectorSet' || name === 'SelectorSchema') {
              return (
                opts.selectors ?? { cardSelector: '.job', linkSelector: 'a', nextSelector: null }
              );
            }
            return opts.extract ? opts.extract(input) : { title: 'Default', company: 'Default Co' };
          },
        };
      },
    },
  };
}

// --- AC1: CAPTCHA stop ------------------------------------------------------

describe('CAPTCHA stop (AC1)', () => {
  it('halts the run on a CAPTCHA challenge on the search page and emits an error event', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser(
      [{ cards: [{ text: 'X', href: 'https://example.com/view?id=1', html: '' }], bodyText: {} }],
      { searchBody: 'Please verify you are human (reCAPTCHA required to continue)' },
    );
    const llm = makeLlm({ extract: () => ({ title: 'never' }) });
    const events: Array<{ phase: string; kind?: string; message?: string }> = [];
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      throttleMs: 0,
      sleep: async () => {},
      onProgress: (e) => events.push(e as { phase: string; kind?: string; message?: string }),
    });

    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    // No detail navigations attempted — only the initial search nav.
    const navs = browser.calls.filter((c) => c.kind === 'navigate').map((c) => c.args);
    expect(navs).toEqual(['https://example.com/jobs']);
    // queryAll must not have been invoked — we stopped before enumerate.
    expect(browser.calls.filter((c) => c.kind === 'queryAll')).toHaveLength(0);
    // No persistence happened (no jobs were extracted).
    expect(data.upserted).toHaveLength(0);
    expect(result.imported).toBe(0);

    const err = events.find((e) => e.phase === 'error');
    expect(err).toBeDefined();
    expect(err!.kind).toBe('captcha');
    expect(typeof err!.message).toBe('string');
    expect(err!.message!.length).toBeGreaterThan(0);
  });

  it('halts and persists nothing further when a detail page is a CAPTCHA challenge', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser(
      [
        {
          cards: [
            { text: 'A', href: 'https://example.com/view?id=1', html: '' },
            { text: 'B', href: 'https://example.com/view?id=2', html: '' },
          ],
          bodyText: {
            'https://example.com/view?id=1': 'plain body of 1',
            'https://example.com/view?id=2': 'Cloudflare bot detection — please complete the challenge.',
          },
        },
      ],
      {
        detailBody: {
          'https://example.com/view?id=1': 'plain body of 1',
          'https://example.com/view?id=2': 'Cloudflare bot detection — please complete the challenge.',
        },
      },
    );
    const llm = makeLlm({ extract: () => ({ title: 'real title' }) });
    const events: Array<{ phase: string; kind?: string }> = [];
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      throttleMs: 0,
      sleep: async () => {},
      onProgress: (e) => events.push(e as { phase: string; kind?: string }),
    });

    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    // Job #1 was successfully extracted before the challenge fired.
    expect(data.upserted).toHaveLength(1);
    expect(data.upserted[0]!.sourceId).toBe('1');
    expect(result.imported).toBe(1);

    const err = events.find((e) => e.phase === 'error');
    expect(err).toBeDefined();
    expect(err!.kind).toBe('captcha');
  });
});

// --- AC2: throttle + page cap ----------------------------------------------

describe('throttle + page cap (AC2)', () => {
  it('sleeps for the configured throttle between navigations and page-clicks', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a', nextSelector: '.next' },
      learnedAt: 1,
    });
    const pages: PageScript[] = [
      { cards: [{ text: 'A', href: 'https://example.com/view?id=1', html: '' }], bodyText: {} },
      { cards: [{ text: 'B', href: 'https://example.com/view?id=2', html: '' }], bodyText: {} },
    ];
    const browser = makeBrowser(pages);
    const llm = makeLlm({ extract: () => ({ title: 'T' }) });
    const sleepCalls: number[] = [];
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      pageCap: 2,
      throttleMs: 75,
      sleep: async (ms: number) => {
        sleepCalls.push(ms);
      },
    });
    await ext.run({ searchUrl: 'https://example.com/jobs' });
    // At least one sleep occurred and every recorded sleep used the configured value.
    expect(sleepCalls.length).toBeGreaterThan(0);
    for (const ms of sleepCalls) expect(ms).toBe(75);
    // Sleeps should outnumber detail navigations (init nav + pagination + each detail nav each throttle).
    const detailNavs = browser.calls.filter(
      (c) => c.kind === 'navigate' && (c.args as string).includes('view?id='),
    );
    expect(sleepCalls.length).toBeGreaterThanOrEqual(detailNavs.length);
  });

  it('never exceeds the configured pageCap even if more pages are available', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a', nextSelector: '.next' },
      learnedAt: 1,
    });
    const pages: PageScript[] = [];
    for (let i = 0; i < 50; i++) {
      pages.push({
        cards: [{ text: `J${i}`, href: `https://example.com/view?id=${i}`, html: '' }],
        bodyText: {},
      });
    }
    const browser = makeBrowser(pages);
    const llm = makeLlm({ extract: () => ({ title: 'T' }) });
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      pageCap: 2,
      throttleMs: 0,
      sleep: async () => {},
    });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });
    expect(result.pages).toBeLessThanOrEqual(2);
    expect(browser.calls.filter((c) => c.kind === 'click').length).toBeLessThanOrEqual(1);
  });
});

// --- AC3: graceful failure --------------------------------------------------

describe('graceful failure (AC3)', () => {
  it('persists already-extracted jobs when the run blows up mid-extraction', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser(
      [
        {
          cards: [
            { text: 'A', href: 'https://example.com/view?id=1', html: '' },
            { text: 'B', href: 'https://example.com/view?id=2', html: '' },
            { text: 'C', href: 'https://example.com/view?id=3', html: '' },
          ],
          bodyText: {
            'https://example.com/view?id=1': 'body 1',
            'https://example.com/view?id=3': 'body 3',
          },
        },
      ],
      {
        // Navigation to job #2 explodes — simulates a network/crash mid-run.
        navigateFails: ['https://example.com/view?id=2'],
      },
    );
    const llm = makeLlm({ extract: () => ({ title: 'Real Job' }) });
    const events: Array<{ phase: string; kind?: string; message?: string }> = [];
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      throttleMs: 0,
      sleep: async () => {},
      onProgress: (e) => events.push(e as { phase: string; kind?: string; message?: string }),
    });

    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    // Job #1 was extracted before the crash — it must remain persisted.
    expect(data.upserted.map((j) => j.sourceId)).toContain('1');
    expect(result.imported).toBeGreaterThanOrEqual(1);

    // An error progress event surfaced the failure with a clear message.
    const err = events.find((e) => e.phase === 'error');
    expect(err).toBeDefined();
    expect(err!.kind).toBe('failure');
    expect(typeof err!.message).toBe('string');
    expect(err!.message!.length).toBeGreaterThan(0);
  });

  it('never partially writes a record — every persisted job has a sourceId and a title', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser(
      [
        {
          cards: [
            { text: 'A', href: 'https://example.com/view?id=1', html: '' },
            { text: 'B', href: 'https://example.com/view?id=2', html: '' },
          ],
          bodyText: {
            'https://example.com/view?id=1': 'body 1',
          },
        },
      ],
      { navigateFails: ['https://example.com/view?id=2'] },
    );
    const llm = makeLlm({ extract: () => ({ title: 'Real Job' }) });
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      throttleMs: 0,
      sleep: async () => {},
    });
    await ext.run({ searchUrl: 'https://example.com/jobs' });
    for (const j of data.upserted) {
      expect(j.sourceId).toBeTruthy();
      expect(j.title).toBeTruthy();
    }
  });
});

// --- AC4: untrusted-page boundary ------------------------------------------

describe('untrusted page boundary (AC4)', () => {
  it('only uses the read-mostly BrowserSurface contract — no JS evaluation hook is consulted', async () => {
    // If the extractor were to call a trusted-only "eval"-style tool on the
    // browser surface, we'd see it on the surface object the test passes in.
    // We intentionally pass a surface that does NOT expose any executeJavaScript
    // / eval-like function. The run must complete using only the documented
    // contract methods.
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser([
      {
        cards: [{ text: 'A', href: 'https://example.com/view?id=1', html: '' }],
        bodyText: { 'https://example.com/view?id=1': 'safe body content' },
      },
    ]);
    // Attach a forbidden method that should NEVER be called by the extractor.
    let evalCalls = 0;
    (browser.surface as unknown as { executeJavaScript: () => Promise<void> }).executeJavaScript =
      async () => {
        evalCalls++;
      };

    const llm = makeLlm({ extract: () => ({ title: 'Real Job' }) });
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      throttleMs: 0,
      sleep: async () => {},
    });
    await ext.run({ searchUrl: 'https://example.com/jobs' });

    expect(evalCalls).toBe(0);
    // Every browser call must be one of the documented read-mostly verbs.
    const allowed = new Set(['navigate', 'queryAll', 'getText', 'getOuterHtml', 'click']);
    for (const c of browser.calls) {
      expect(allowed.has(c.kind)).toBe(true);
    }
    expect(data.upserted).toHaveLength(1);
  });
});

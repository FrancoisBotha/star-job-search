/**
 * Unit tests for the LangGraph job extractor (EXTR-004).
 *
 * Covers acceptance criteria:
 *  - AC1: createJobExtractor builds a StateGraph wiring
 *         init -> discover -> enumerate -> (paginate loop) -> dedup ->
 *         extractDetails -> persist, with the documented conditional routing
 *         after enumerate.
 *  - AC2: discover reuses a cached SiteProfile when present and asks the LLM
 *         (withStructuredOutput, SelectorSchema) and caches the result when
 *         absent.
 *  - AC3: enumerate uses browser_query_all + deriveSourceId, dedup diffs
 *         against store.knownSourceIds() BEFORE any detail fetch, and
 *         pagination stops on (a) page cap, (b) missing next control,
 *         (c) a page that adds nothing new.
 *  - AC4: extractDetails opens each NEW job sequentially, structures the
 *         body through the LLM (JobSchema), falling back to a stub on
 *         failure; persist upserts and returns {imported, skipped, total,
 *         pages}.
 *  - AC5: every phase reports progress via the onProgress callback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Minimal fake of the StateGraph slice we use ---------------------------
//
// Drives nodes deterministically using the edges/conditionals declared by the
// extractor module. Exposes the recorded wiring so AC1 can verify it.

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
    conditional = new Map<string, { router: (s: S) => string | Promise<string>; mapping: Record<string, string> }>();
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
  profiles: Map<string, { hostname: string; selectors?: Record<string, string> | null; idRegex?: string | null; learnedAt: number }>;
  upserted: Array<unknown>;
}

function makeStore() {
  const data: FakeStoreState = { known: new Set(), profiles: new Map(), upserted: [] };
  return {
    data,
    store: {
      knownSourceIds: () => new Set(data.known),
      upsertJobs: (jobs: Array<{ sourceId: string }>) => {
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
      saveSiteProfile: (p: { hostname: string; learnedAt: number; selectors?: Record<string, string> | null; idRegex?: string | null }) => {
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
  bodyText: Record<string, string>; // url -> body text
}

function makeBrowser(pages: PageScript[], options: { hasNext?: boolean; clickFails?: boolean } = {}) {
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
        currentUrl = url;
        // if navigating to a job-detail URL on the script, pageIdx stays
      },
      queryAll: async (opts: { selector: string; linkSelector?: string }) => {
        calls.push({ kind: 'queryAll', args: opts });
        const page = pages[pageIdx];
        return page ? page.cards : [];
      },
      getText: async (selector?: string) => {
        calls.push({ kind: 'getText', args: selector });
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
        if (options.clickFails) throw new Error('click failed');
        if (options.hasNext === false) throw new Error('no next');
        pageIdx++;
      },
    },
  };
}

function makeLlm(opts: {
  selectors?: { cardSelector: string; linkSelector: string; nextSelector?: string | null };
  extract?: (input: unknown) => { title: string; company?: string; location?: string; description?: string };
  extractThrows?: boolean;
}) {
  const calls: Array<{ schema: string; input: unknown }> = [];
  return {
    calls,
    llm: {
      withStructuredOutput: (schema: { _def?: unknown }, meta?: { name?: string }) => {
        const name = meta?.name ?? '';
        return {
          invoke: async (input: unknown) => {
            calls.push({ schema: name, input });
            if (name === 'SelectorSet' || name === 'SelectorSchema') {
              return opts.selectors ?? { cardSelector: '.job', linkSelector: 'a', nextSelector: null };
            }
            if (opts.extractThrows) throw new Error('llm extract failed');
            return opts.extract ? opts.extract(input) : { title: 'Default Title', company: 'Default Co' };
          },
        };
      },
    },
  };
}

// --- AC1: graph wiring -----------------------------------------------------

describe('createJobExtractor — graph wiring (AC1)', () => {
  it('builds the documented node sequence with conditional routing after enumerate', async () => {
    const mod = await importModule();
    const { store } = makeStore();
    const browser = makeBrowser([{ cards: [], bodyText: {} }]);
    const llm = makeLlm({});

    const extractor = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
    });
    // Trigger graph construction by running once with an empty page.
    await extractor.run({ searchUrl: 'https://example.com/jobs' });

    const rec = lastGraph.current!;
    // The `relearn` node (EXTR-005) re-learns selectors when cached ones
    // enumerate nothing on page 1; it sits between discover and enumerate in
    // registration order and is reached only via the enumerate conditional.
    expect(rec.nodes).toEqual([
      'init',
      'discover',
      'relearn',
      'enumerate',
      'paginate',
      'dedup',
      'extractDetails',
      'persist',
    ]);
    // start -> init -> discover -> enumerate
    expect(rec.edges).toEqual(
      expect.arrayContaining([
        ['__start__', 'init'],
        ['init', 'discover'],
        ['discover', 'enumerate'],
        ['relearn', 'enumerate'],
        ['paginate', 'enumerate'],
        ['dedup', 'extractDetails'],
        ['extractDetails', 'persist'],
      ]),
    );
    // enumerate is conditional: paginate, dedup, or relearn
    expect(rec.conditional).toHaveLength(1);
    expect(rec.conditional[0]!.from).toBe('enumerate');
    expect(Object.keys(rec.conditional[0]!.mapping).sort()).toEqual([
      'dedup',
      'paginate',
      'relearn',
    ]);
  });
});

// --- AC2: discover (cache + LLM) -------------------------------------------

describe('discover (AC2)', () => {
  it('reuses a cached SiteProfile and does NOT call the LLM', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.cached-card', linkSelector: 'a.cached', nextSelector: '.cached-next' },
      learnedAt: 1,
    });

    // The page must yield at least one card so enumerate succeeds — an empty
    // page would (correctly) trip the EXTR-005 relearn fallback, which DOES
    // call the LLM. With a card present, the cached selectors are honoured and
    // the LLM is never asked to (re)learn them.
    const browser = makeBrowser([
      {
        cards: [{ text: 'A', href: 'https://example.com/view?id=1', html: '' }],
        bodyText: { 'https://example.com/view?id=1': 'b' },
      },
    ]);
    const llm = makeLlm({});

    const extractor = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
    });
    await extractor.run({ searchUrl: 'https://example.com/jobs' });

    expect(llm.calls.filter((c) => c.schema === 'SelectorSet')).toHaveLength(0);
    // enumerate should have used the cached selector
    const qa = browser.calls.find((c) => c.kind === 'queryAll')!;
    expect((qa.args as { selector: string }).selector).toBe('.cached-card');
  });

  it('asks the LLM with withStructuredOutput(SelectorSchema) and caches the result', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    const browser = makeBrowser([{ cards: [], bodyText: {} }]);
    const llm = makeLlm({
      selectors: { cardSelector: '.learned-card', linkSelector: 'a.learned', nextSelector: '.learned-next' },
    });

    const extractor = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      now: () => 12345,
    });
    await extractor.run({ searchUrl: 'https://example.com/jobs' });

    expect(llm.calls.filter((c) => c.schema === 'SelectorSet')).toHaveLength(1);
    const cached = data.profiles.get('example.com');
    expect(cached).toBeDefined();
    expect(cached!.selectors).toMatchObject({
      cardSelector: '.learned-card',
      linkSelector: 'a.learned',
      nextSelector: '.learned-next',
    });
    expect(cached!.learnedAt).toBe(12345);
  });
});

// --- AC3: enumerate / paginate / dedup -------------------------------------

describe('enumerate / paginate / dedup (AC3)', () => {
  it('dedup diffs sourceIds against store.knownSourceIds BEFORE any detail fetch', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.known.add('111');
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser([
      {
        cards: [
          { text: 'Known', href: 'https://example.com/view?id=111', html: '' },
          { text: 'Fresh', href: 'https://example.com/view?id=222', html: '' },
        ],
        bodyText: { 'https://example.com/view?id=222': 'fresh body' },
      },
    ]);
    const llm = makeLlm({ extract: () => ({ title: 'Fresh Job' }) });

    const ext = mod.createJobExtractor({ store, browser: browser.surface, llm: llm.llm });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    // navigate calls: initial search + 1 detail = 2 (not 3)
    const navCalls = browser.calls.filter((c) => c.kind === 'navigate');
    expect(navCalls.map((c) => c.args)).toEqual([
      'https://example.com/jobs',
      'https://example.com/view?id=222',
    ]);
    expect(result.total).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.imported).toBe(1);
  });

  it('stops paginating when no nextSelector is configured', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser([
      { cards: [{ text: 'A', href: 'https://example.com/view?id=1', html: '' }], bodyText: {} },
      { cards: [{ text: 'B', href: 'https://example.com/view?id=2', html: '' }], bodyText: {} },
    ]);
    const llm = makeLlm({ extract: () => ({ title: 'T' }) });
    const ext = mod.createJobExtractor({ store, browser: browser.surface, llm: llm.llm });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });
    // never paginated past page 1
    expect(browser.calls.filter((c) => c.kind === 'click')).toHaveLength(0);
    expect(result.pages).toBe(1);
  });

  it('stops paginating at the page cap', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a', nextSelector: '.next' },
      learnedAt: 1,
    });
    const pages: PageScript[] = [];
    for (let i = 0; i < 10; i++) {
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
      pageCap: 3,
    });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });
    expect(result.pages).toBe(3);
    // 2 clicks: between page1->2, page2->3, then stop at cap
    expect(browser.calls.filter((c) => c.kind === 'click')).toHaveLength(2);
  });

  it('stops paginating when a page adds nothing new', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a', nextSelector: '.next' },
      learnedAt: 1,
    });
    const browser = makeBrowser([
      { cards: [{ text: 'A', href: 'https://example.com/view?id=1', html: '' }], bodyText: {} },
      // duplicate of page 1 -> nothing new added on page 2
      { cards: [{ text: 'A', href: 'https://example.com/view?id=1', html: '' }], bodyText: {} },
      { cards: [{ text: 'B', href: 'https://example.com/view?id=2', html: '' }], bodyText: {} },
    ]);
    const llm = makeLlm({ extract: () => ({ title: 'T' }) });
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      pageCap: 10,
    });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });
    // Stopped after page 2 (which produced no new ids)
    expect(result.pages).toBe(2);
    expect(browser.calls.filter((c) => c.kind === 'click')).toHaveLength(1);
  });
});

// --- AC4: extractDetails + persist -----------------------------------------

describe('extractDetails + persist (AC4)', () => {
  it('opens each NEW job sequentially and persists structured results', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser([
      {
        cards: [
          { text: 'A', href: 'https://example.com/view?id=1', html: '' },
          { text: 'B', href: 'https://example.com/view?id=2', html: '' },
        ],
        bodyText: {
          'https://example.com/view?id=1': 'body of 1',
          'https://example.com/view?id=2': 'body of 2',
        },
      },
    ]);
    const llm = makeLlm({
      extract: (input) => {
        const s = String(input);
        if (s.includes('body of 1')) return { title: 'Job One', company: 'Acme' };
        return { title: 'Job Two', company: 'Beta' };
      },
    });
    const ext = mod.createJobExtractor({ store, browser: browser.surface, llm: llm.llm });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    expect(result).toEqual({ imported: 2, skipped: 0, total: 2, pages: 1 });
    const navCalls = browser.calls.filter((c) => c.kind === 'navigate').map((c) => c.args);
    expect(navCalls).toEqual([
      'https://example.com/jobs',
      'https://example.com/view?id=1',
      'https://example.com/view?id=2',
    ]);
    // Verify detail navigations happen sequentially AFTER all enumerate work.
    const enumIdx = browser.calls.findIndex((c) => c.kind === 'queryAll');
    const firstDetail = browser.calls.findIndex(
      (c) => c.kind === 'navigate' && (c.args as string).includes('id=1'),
    );
    expect(firstDetail).toBeGreaterThan(enumIdx);

    expect(data.upserted).toHaveLength(2);
    expect((data.upserted[0] as { title: string }).title).toBe('Job One');
    expect((data.upserted[1] as { title: string }).title).toBe('Job Two');
  });

  it('falls back to a stub title/company when the LLM extraction fails', async () => {
    const mod = await importModule();
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const browser = makeBrowser([
      {
        cards: [{ text: 'A • Acme Corp', href: 'https://example.com/view?id=1', html: '' }],
        bodyText: { 'https://example.com/view?id=1': 'body' },
      },
    ]);
    const llm = makeLlm({ extractThrows: true });
    const ext = mod.createJobExtractor({ store, browser: browser.surface, llm: llm.llm });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });
    expect(result.imported).toBe(1);
    expect(data.upserted).toHaveLength(1);
    const upserted = data.upserted[0] as { title?: string; company?: string };
    expect(upserted.title).toBeDefined();
    expect(upserted.title!.length).toBeGreaterThan(0);
  });
});

// --- AC5: onProgress reporting ---------------------------------------------

describe('onProgress (AC5)', () => {
  it('reports progress for each phase', async () => {
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
        bodyText: { 'https://example.com/view?id=1': 'b' },
      },
    ]);
    const llm = makeLlm({ extract: () => ({ title: 'T' }) });
    const events: Array<{ phase: string }> = [];
    const ext = mod.createJobExtractor({
      store,
      browser: browser.surface,
      llm: llm.llm,
      onProgress: (e) => events.push(e),
    });
    await ext.run({ searchUrl: 'https://example.com/jobs' });
    const phases = events.map((e) => e.phase);
    expect(phases).toEqual(
      expect.arrayContaining(['discover', 'enumerate', 'dedup', 'extract', 'persist', 'done']),
    );
    const done = events.find((e) => e.phase === 'done') as { phase: string; imported: number; total: number };
    expect(done.imported).toBe(1);
    expect(done.total).toBe(1);
  });
});

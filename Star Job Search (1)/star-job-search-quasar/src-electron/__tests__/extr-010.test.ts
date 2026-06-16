/**
 * EXTR-010 ticket-scoped tests.
 *
 * Anchors test coverage explicitly to the EXTR-010 acceptance criteria:
 *
 *  AC1: deriveSourceId tests cover the user-story Scenario Outline examples
 *       (LinkedIn currentJobId, Indeed jk, Greenhouse gh_jid) plus generic id
 *       and numeric-path fallback.
 *  AC2: jobBoard tests cover insert-if-absent (no duplicates, status
 *       preserved on re-import), listJobs status filters, and setStatus.
 *  AC3: extraction-graph tests cover dedup-before-detail (only new stubs
 *       fetched), incremental re-run (0 new when nothing changed), and
 *       stop-on-CAPTCHA — using fake MCP tools + a stubbed structured-output
 *       LLM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// ============================================================================
// AC1 — deriveSourceId Scenario Outline examples
// ============================================================================

describe('EXTR-010 AC1 — deriveSourceId Scenario Outline', () => {
  it('LinkedIn currentJobId is the sourceId', async () => {
    const { deriveSourceId } = await import('../jobs');
    expect(
      deriveSourceId(
        'https://www.linkedin.com/jobs/view/?currentJobId=4011223344&trk=guest_jobs',
        'www.linkedin.com',
      ),
    ).toBe('4011223344');
  });

  it('Indeed jk is the sourceId', async () => {
    const { deriveSourceId } = await import('../jobs');
    expect(
      deriveSourceId('https://www.indeed.com/viewjob?jk=abc123def', 'www.indeed.com'),
    ).toBe('abc123def');
  });

  it('Greenhouse gh_jid is the sourceId', async () => {
    const { deriveSourceId } = await import('../jobs');
    expect(
      deriveSourceId(
        'https://boards.greenhouse.io/acme/jobs/5557777?gh_jid=5557777',
        'boards.greenhouse.io',
      ),
    ).toBe('5557777');
  });

  it('generic boards: id query param is the sourceId', async () => {
    const { deriveSourceId } = await import('../jobs');
    expect(
      deriveSourceId('https://jobs.example.com/view?id=xyz-42', 'jobs.example.com'),
    ).toBe('xyz-42');
  });

  it('numeric-path fallback: a long digit run in the path is the sourceId', async () => {
    const { deriveSourceId } = await import('../jobs');
    expect(
      deriveSourceId(
        'https://careers.example.com/jobs/987654321/software-engineer',
        'careers.example.com',
      ),
    ).toBe('987654321');
  });
});

// ============================================================================
// AC2 — jobBoard insert-if-absent, listJobs status filters, setStatus
// ============================================================================
//
// Uses a minimal in-memory fake of the better-sqlite3 surface so the store's
// SQL contract is exercised without the native binding.

interface JobRow {
  source_id: string;
  hostname: string;
  url: string;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string | null;
  posted_at: number | null;
  fetched_at: number;
  status: string;
}

interface SiteProfileRow {
  hostname: string;
  id_regex: string | null;
  selectors: string | null;
  learned_at: number;
}

class FakeDb {
  jobs: JobRow[] = [];
  profiles: SiteProfileRow[] = [];
  exec(_sql: string) {}
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+IGNORE\s+INTO\s+jobs/i.test(text)) {
      return {
        run: (params: JobRow) => {
          if (this.jobs.some((j) => j.source_id === params.source_id)) {
            return { changes: 0 };
          }
          this.jobs.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+jobs\s+SET\s+status/i.test(text)) {
      return {
        run: (status: string, sourceId: string) => {
          const row = this.jobs.find((j) => j.source_id === sourceId);
          if (!row) return { changes: 0 };
          row.status = status;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT\s+source_id\s+FROM\s+jobs/i.test(text)) {
      return { all: () => this.jobs.map((j) => ({ source_id: j.source_id })) };
    }
    if (/^SELECT[\s\S]+FROM\s+jobs/i.test(text)) {
      return { all: () => [...this.jobs].sort((a, b) => b.fetched_at - a.fetched_at) };
    }
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+site_profiles/i.test(text)) {
      return {
        run: (params: SiteProfileRow) => {
          const idx = this.profiles.findIndex((p) => p.hostname === params.hostname);
          if (idx >= 0) this.profiles.splice(idx, 1);
          this.profiles.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+site_profiles\s+WHERE\s+hostname/i.test(text)) {
      return {
        all: (hostname: string) => this.profiles.filter((p) => p.hostname === hostname),
      };
    }
    throw new Error(`FakeDb: unsupported SQL: ${text}`);
  }
}

describe('EXTR-010 AC2 — jobBoard insert-if-absent + status', () => {
  it('upsertJobs is insert-if-absent: re-importing the same sourceId does not duplicate', async () => {
    const { createJobsStore } = await import('../jobs');
    const store = createJobsStore(new FakeDb() as never);

    const insertedFirst = store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', title: 'A', fetchedAt: 100 },
    ]);
    expect(insertedFirst).toBe(1);

    const insertedSecond = store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', title: 'A', fetchedAt: 200 },
    ]);
    expect(insertedSecond).toBe(0);
    expect(store.listJobs()).toHaveLength(1);
  });

  it('user-set status is preserved when the posting is re-imported', async () => {
    const { createJobsStore } = await import('../jobs');
    const store = createJobsStore(new FakeDb() as never);

    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', title: 'A', fetchedAt: 100 },
    ]);
    store.setStatus('a', 'applied');

    // re-import attempts to overwrite title and clobber status — must be ignored.
    store.upsertJobs([
      {
        sourceId: 'a',
        hostname: 'x.com',
        url: 'https://x.com/a',
        title: 'OVERWRITE',
        fetchedAt: 999,
        status: 'new',
      },
    ]);
    const row = store.listJobs()[0]!;
    expect(row.title).toBe('A');
    expect(row.status).toBe('applied');
  });

  it('listJobs filters by status', async () => {
    const { createJobsStore } = await import('../jobs');
    const store = createJobsStore(new FakeDb() as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    store.setStatus('a', 'saved');
    expect(store.listJobs({ status: 'saved' }).map((j) => j.sourceId)).toEqual(['a']);
    expect(store.listJobs({ status: 'new' }).map((j) => j.sourceId)).toEqual(['b']);
  });

  it('listJobs filters by excludeStatus (e.g. hide hidden postings)', async () => {
    const { createJobsStore } = await import('../jobs');
    const store = createJobsStore(new FakeDb() as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    store.setStatus('a', 'hidden');
    expect(
      store.listJobs({ excludeStatus: 'hidden' }).map((j) => j.sourceId),
    ).toEqual(['b']);
  });

  it('setStatus updates exactly the targeted row', async () => {
    const { createJobsStore } = await import('../jobs');
    const store = createJobsStore(new FakeDb() as never);
    store.upsertJobs([
      { sourceId: 'a', hostname: 'x.com', url: 'https://x.com/a', fetchedAt: 100 },
      { sourceId: 'b', hostname: 'x.com', url: 'https://x.com/b', fetchedAt: 200 },
    ]);
    store.setStatus('b', 'applied');
    const all = store.listJobs();
    expect(all.find((j) => j.sourceId === 'a')!.status).toBe('new');
    expect(all.find((j) => j.sourceId === 'b')!.status).toBe('applied');
  });
});

// ============================================================================
// AC3 — extraction-graph: dedup-before-detail, incremental re-run, CAPTCHA stop
// ============================================================================
//
// Mocks the LangGraph runtime so we drive the extractor's nodes directly,
// and provides fake MCP-style browser tools (navigate / query_all / get_text
// / click / outer_html) bridged into the BrowserSurface contract the
// extractor consumes.

interface GraphRecord {
  nodes: string[];
  edges: Array<[string, string]>;
  conditional: Array<{ from: string; mapping: Record<string, string> }>;
}

const lastGraph: { current?: GraphRecord } = {};

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
    record: GraphRecord = { nodes: [], edges: [], conditional: [] };

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
      const graph = this;
      return {
        invoke: async (initial: S): Promise<S> => {
          let state = { ...initial } as S;
          let current = graph.edges.get(START);
          if (!current) throw new Error('graph: no __start__ edge');
          for (let i = 0; i < 1000; i++) {
            if (current === END) break;
            const node = graph.nodes.get(current);
            if (!node) throw new Error(`graph: unknown node ${current}`);
            const update = await node(state);
            state = { ...state, ...(update ?? {}) } as S;
            const cond = graph.conditional.get(current);
            if (cond) {
              const pick = await cond.router(state);
              const next = cond.mapping[pick];
              if (!next) throw new Error(`graph: bad router pick ${pick}`);
              current = next;
              continue;
            }
            const next = graph.edges.get(current);
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

// --- Fake jobs store reused across the AC3 scenarios -----------------------

interface FakeStoreData {
  known: Set<string>;
  profiles: Map<
    string,
    { hostname: string; selectors?: Record<string, string> | null; learnedAt: number }
  >;
  upserted: Array<{ sourceId: string; title?: string | null }>;
}

function makeStore(seedKnown: string[] = []) {
  const data: FakeStoreData = {
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

// --- Fake MCP browser tools, bridged to a BrowserSurface -------------------
//
// The shape mirrors the in-process MCP browser server's tool surface
// (browser_navigate / browser_query_all / browser_get_text / browser_click /
// browser_outer_html). We wire them through a tiny adapter so the extractor
// can drive them via the BrowserSurface contract without any langchain MCP
// adapter on the test path.

interface FakeCard {
  text: string;
  href: string;
  html: string;
}

interface FakePage {
  cards: FakeCard[];
  /** Body text per URL when get_text is invoked at that URL. */
  bodyByUrl: Record<string, string>;
}

interface FakeMcpToolset {
  navigate: ReturnType<typeof vi.fn>;
  queryAll: ReturnType<typeof vi.fn>;
  getText: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  outerHtml: ReturnType<typeof vi.fn>;
}

function makeFakeMcpTools(pages: FakePage[], opts: { searchBodyOverride?: string } = {}) {
  let pageIdx = 0;
  let currentUrl = '';
  const tools: FakeMcpToolset = {
    navigate: vi.fn(async (url: string) => {
      currentUrl = url;
      return { ok: true };
    }),
    queryAll: vi.fn(async () => {
      const page = pages[pageIdx];
      return page ? page.cards : [];
    }),
    getText: vi.fn(async () => {
      // First get_text against the original search URL — honour any override.
      const page = pages[pageIdx];
      const isCardHref = page?.cards.some((c) => c.href === currentUrl) ?? false;
      if (!isCardHref && opts.searchBodyOverride !== undefined) {
        return opts.searchBodyOverride;
      }
      return page?.bodyByUrl[currentUrl] ?? '';
    }),
    click: vi.fn(async () => {
      pageIdx++;
      return { ok: true };
    }),
    outerHtml: vi.fn(async () => '<html><body>sample</body></html>'),
  };
  // Adapter: shape it as a BrowserSurface for the extractor.
  const surface = {
    navigate: (url: string) => tools.navigate(url) as Promise<void>,
    queryAll: (qopts: { selector: string; linkSelector?: string; limit?: number }) =>
      tools.queryAll(qopts) as Promise<FakeCard[]>,
    getText: (sel?: string) => tools.getText(sel) as Promise<string>,
    click: (sel: string) => tools.click(sel) as Promise<void>,
    getOuterHtml: (sel?: string) => tools.outerHtml(sel) as Promise<string>,
  };
  return { tools, surface };
}

// Stubbed structured-output LLM — returns canned selectors + canned extracts.
function makeStubLlm(opts: {
  selectors?: { cardSelector: string; linkSelector: string; nextSelector?: string | null };
  extract?: (input: unknown) => { title: string; company?: string };
}) {
  const calls: Array<{ schema: string }> = [];
  return {
    calls,
    llm: {
      withStructuredOutput: (_schema: unknown, meta?: { name?: string }) => {
        const name = meta?.name ?? '';
        return {
          invoke: async (input: unknown) => {
            calls.push({ schema: name });
            if (name === 'SelectorSet' || name === 'SelectorSchema') {
              return (
                opts.selectors ?? {
                  cardSelector: '.job',
                  linkSelector: 'a',
                  nextSelector: null,
                }
              );
            }
            return opts.extract ? opts.extract(input) : { title: 'Stubbed' };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  lastGraph.current = undefined;
});

afterEach(() => {
  vi.resetModules();
});

describe('EXTR-010 AC3 — extraction-graph dedup-before-detail', () => {
  it('only fetches detail pages for sourceIds not already in the store', async () => {
    const { createJobExtractor } = await import('../jobExtractor');
    const { store, data } = makeStore(['known-1']);
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const { tools, surface } = makeFakeMcpTools([
      {
        cards: [
          { text: 'Known', href: 'https://example.com/view?id=known-1', html: '' },
          { text: 'Fresh', href: 'https://example.com/view?id=fresh-2', html: '' },
        ],
        bodyByUrl: { 'https://example.com/view?id=fresh-2': 'fresh body' },
      },
    ]);
    const { llm } = makeStubLlm({ extract: () => ({ title: 'Fresh Job' }) });

    const ext = createJobExtractor({
      store,
      browser: surface,
      llm,
      throttleMs: 0,
      sleep: async () => {},
    });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    // navigate was called for the search URL + the ONE fresh detail (not the known one).
    const navArgs = tools.navigate.mock.calls.map((c) => c[0]);
    expect(navArgs).toEqual([
      'https://example.com/jobs',
      'https://example.com/view?id=fresh-2',
    ]);
    expect(result).toMatchObject({ imported: 1, skipped: 1, total: 2 });
    expect(data.upserted.map((u) => u.sourceId)).toEqual(['fresh-2']);
  });
});

describe('EXTR-010 AC3 — extraction-graph incremental re-run', () => {
  it('a second run over an unchanged board imports 0 new postings', async () => {
    const { createJobExtractor } = await import('../jobExtractor');
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });

    const buildBrowser = () =>
      makeFakeMcpTools([
        {
          cards: [
            { text: 'One', href: 'https://example.com/view?id=1', html: '' },
            { text: 'Two', href: 'https://example.com/view?id=2', html: '' },
          ],
          bodyByUrl: {
            'https://example.com/view?id=1': 'b1',
            'https://example.com/view?id=2': 'b2',
          },
        },
      ]);

    const first = buildBrowser();
    const { llm } = makeStubLlm({ extract: () => ({ title: 'T' }) });
    const ext1 = createJobExtractor({
      store,
      browser: first.surface,
      llm,
      throttleMs: 0,
      sleep: async () => {},
    });
    const r1 = await ext1.run({ searchUrl: 'https://example.com/jobs' });
    expect(r1).toMatchObject({ imported: 2, skipped: 0, total: 2 });

    // Re-run against an unchanged board.
    const second = buildBrowser();
    const ext2 = createJobExtractor({
      store,
      browser: second.surface,
      llm,
      throttleMs: 0,
      sleep: async () => {},
    });
    const r2 = await ext2.run({ searchUrl: 'https://example.com/jobs' });

    expect(r2).toMatchObject({ imported: 0, skipped: 2, total: 2 });
    // Zero detail navigations on the re-run — only the initial search nav.
    const secondNavs = second.tools.navigate.mock.calls.map((c) => c[0]);
    expect(secondNavs).toEqual(['https://example.com/jobs']);
    // Nothing extra written to the store on the re-run.
    expect(data.upserted).toHaveLength(2);
  });
});

describe('EXTR-010 AC3 — extraction-graph stop-on-CAPTCHA', () => {
  it('halts before enumerate when the search page is a bot challenge', async () => {
    const { createJobExtractor } = await import('../jobExtractor');
    const { store, data } = makeStore();
    data.profiles.set('example.com', {
      hostname: 'example.com',
      selectors: { cardSelector: '.c', linkSelector: 'a' },
      learnedAt: 1,
    });
    const { tools, surface } = makeFakeMcpTools(
      [
        {
          cards: [{ text: 'X', href: 'https://example.com/view?id=1', html: '' }],
          bodyByUrl: {},
        },
      ],
      {
        searchBodyOverride:
          'Please verify you are human — reCAPTCHA required to continue browsing.',
      },
    );
    const { llm } = makeStubLlm({ extract: () => ({ title: 'never' }) });
    const events: Array<{ phase: string; kind?: string; message?: string }> = [];

    const ext = createJobExtractor({
      store,
      browser: surface,
      llm,
      throttleMs: 0,
      sleep: async () => {},
      onProgress: (e) => events.push(e as { phase: string; kind?: string; message?: string }),
    });
    const result = await ext.run({ searchUrl: 'https://example.com/jobs' });

    // Only the initial navigation happened; queryAll was never called.
    expect(tools.navigate.mock.calls.map((c) => c[0])).toEqual([
      'https://example.com/jobs',
    ]);
    expect(tools.queryAll).not.toHaveBeenCalled();
    // No persistence.
    expect(data.upserted).toHaveLength(0);
    expect(result.imported).toBe(0);
    // An explicit captcha error event was emitted.
    const err = events.find((e) => e.phase === 'error');
    expect(err).toBeDefined();
    expect(err!.kind).toBe('captcha');
    expect(err!.message!.length).toBeGreaterThan(0);
  });
});

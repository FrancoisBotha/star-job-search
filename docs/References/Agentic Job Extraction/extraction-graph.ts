// extraction-graph.ts
//
// The extraction brain. A LangGraph StateGraph that crawls a job listing and imports
// only NEW jobs into the board. The graph code is deterministic; the LLM is used for
// just two things:
//   1. discover  -> learn the page's CSS selectors once per host (cached)
//   2. extract   -> turn each new job's detail text into a structured record
// Everything else (enumeration, pagination, dedup) is plain code calling MCP tools.

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { z } from 'zod';
import type {
  JobRecord,
  JobStub,
  SiteProfile,
  JobStatus,
} from './job-board-store.js';

// ---- the slice of the board store the graph needs (lets you inject/mock it) ----
export interface BoardStore {
  knownSourceIds(): Set<string>;
  getSiteProfile(hostname: string): SiteProfile | null;
  saveSiteProfile(p: SiteProfile): void;
  upsertJobs(records: JobRecord[]): number;
}

export interface Progress {
  phase: 'init' | 'discover' | 'enumerate' | 'paginate' | 'dedup' | 'extract' | 'done' | 'error';
  message: string;
  done?: number;
  total?: number;
}

export interface ExtractorDeps {
  // MCP tools by name (from MultiServerMCPClient.getTools()).
  tools: Record<string, { invoke(args: Record<string, unknown>): Promise<unknown> }>;
  // A LangChain chat model (ChatOpenAI pointed at OpenRouter).
  llm: {
    withStructuredOutput: <T>(schema: z.ZodType<T>, opts?: { name?: string }) => {
      invoke(input: string): Promise<T>;
    };
  };
  store: BoardStore;
  onProgress?: (p: Progress) => void;
  maxPages?: number;
}

// ---- helpers ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalize a LangChain tool result to a plain string (handles string / blocks / {content}). */
function toText(res: unknown): string {
  if (typeof res === 'string') return res;
  if (Array.isArray(res)) return res.map((b) => (typeof b === 'string' ? b : (b as any)?.text ?? '')).join('');
  if (res && typeof res === 'object' && 'content' in (res as any)) {
    const c = (res as any).content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((b: any) => b?.text ?? '').join('');
    return String(c);
  }
  return String(res ?? '');
}

async function callTool(deps: ExtractorDeps, name: string, args: Record<string, unknown>): Promise<string> {
  const tool = deps.tools[name];
  if (!tool) throw new Error(`MCP tool not available: ${name}`);
  return toText(await tool.invoke(args));
}

/** Derive a stable per-job id from its URL. Handles the common job-site patterns. */
function deriveSourceId(url: string, hostname: string, idRegex?: string): string {
  try {
    const u = new URL(url);
    if (idRegex) {
      const m = u.href.match(new RegExp(idRegex));
      if (m?.[1]) return `${hostname}:${m[1]}`;
    }
    for (const key of ['currentJobId', 'jobId', 'job_id', 'gh_jid', 'jk', 'id']) {
      const v = u.searchParams.get(key);
      if (v) return `${hostname}:${v}`;
    }
    const numeric = u.pathname.split('/').filter(Boolean).reverse().find((s) => /\d{4,}/.test(s));
    return `${hostname}:${numeric ?? u.pathname}`;
  } catch {
    return `${hostname}:${url}`;
  }
}

// ---- LLM output schemas ----
const SelectorSchema = z.object({
  cardSelector: z.string().describe('CSS selector matching EACH job result card/row in the list'),
  linkSelector: z.string().optional().describe('<a> inside a card linking to the detail page; omit if the card is the link'),
  nextSelector: z.string().optional().describe('control that loads the NEXT page; omit if infinite scroll or none'),
});

const JobSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().optional(),
  workplaceType: z.string().optional(),
  employmentType: z.string().optional(),
  salary: z.string().optional(),
  postedDate: z.string().optional(),
  description: z.string().optional(),
  applyUrl: z.string().optional(),
});

// ---- graph state ----
const S = Annotation.Root({
  startUrl: Annotation<string>,
  hostname: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  profile: Annotation<SiteProfile | null>({ reducer: (_, b) => b, default: () => null }),
  stubs: Annotation<JobStub[]>({ reducer: (_, b) => b, default: () => [] }),
  newStubs: Annotation<JobStub[]>({ reducer: (_, b) => b, default: () => [] }),
  extracted: Annotation<JobRecord[]>({ reducer: (_, b) => b, default: () => [] }),
  page: Annotation<number>({ reducer: (_, b) => b, default: () => 1 }),
  maxPages: Annotation<number>({ reducer: (_, b) => b, default: () => 20 }),
  prevStubCount: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  summary: Annotation<{ imported: number; skipped: number; total: number; pages: number } | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),
});
type State = typeof S.State;

export function createJobExtractor(deps: ExtractorDeps) {
  const report = (p: Progress) => deps.onProgress?.(p);
  const selLlm = deps.llm.withStructuredOutput(SelectorSchema, { name: 'selectors' });
  const jobLlm = deps.llm.withStructuredOutput(JobSchema, { name: 'job' });

  // 1) Load the listing the user already filtered (filters live in the URL).
  async function init(state: State): Promise<Partial<State>> {
    report({ phase: 'init', message: 'Opening the filtered listing…' });
    await callTool(deps, 'browser_navigate', { url: state.startUrl });
    await sleep(1200);
    return { hostname: new URL(state.startUrl).hostname, maxPages: deps.maxPages ?? 20 };
  }

  // 2) Learn the page layout once per host (or reuse the cached / hand-authored profile).
  async function discover(state: State): Promise<Partial<State>> {
    const cached = deps.store.getSiteProfile(state.hostname);
    if (cached) {
      report({ phase: 'discover', message: `Using saved layout for ${state.hostname}` });
      return { profile: cached };
    }
    report({ phase: 'discover', message: `Learning ${state.hostname} layout…` });
    const html = await callTool(deps, 'browser_outer_html', { selector: 'body', maxChars: 14000 });
    const sel = await selLlm.invoke(
      `Configure a scraper for the job-listing page on ${state.hostname}. ` +
        `Return robust CSS selectors from this HTML. cardSelector must match each individual job result. ` +
        `linkSelector is the <a> inside a card pointing to the job detail page. ` +
        `nextSelector loads the next page of results (omit if infinite scroll or none).\n\nHTML:\n${html}`,
    );
    const profile: SiteProfile = { hostname: state.hostname, ...sel };
    deps.store.saveSiteProfile(profile);
    return { profile };
  }

  // 3) Enumerate every card on the current page (deterministic). Cheap; no detail fetch.
  async function enumerate(state: State): Promise<Partial<State>> {
    const p = state.profile!;
    const json = await callTool(deps, 'browser_query_all', {
      selector: p.cardSelector,
      linkSelector: p.linkSelector,
      limit: 1000,
    });
    let items: Array<{ text: string; href: string | null }> = [];
    try {
      items = JSON.parse(json);
    } catch {
      items = [];
    }
    const merged = new Map(state.stubs.map((s) => [s.sourceId, s]));
    for (const it of items) {
      if (!it.href) continue;
      const sourceId = deriveSourceId(it.href, state.hostname, p.idFromUrl);
      if (!merged.has(sourceId)) {
        const title = (it.text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0];
        merged.set(sourceId, { sourceId, url: it.href, title });
      }
    }
    const stubs = [...merged.values()];
    report({ phase: 'enumerate', message: `Found ${stubs.length} jobs so far (page ${state.page})` });
    return { stubs, prevStubCount: state.stubs.length };
  }

  // Route: keep paginating until we hit the cap, run out of "next", or stop finding new cards.
  function afterEnumerate(state: State): 'paginate' | 'dedup' {
    if (state.page >= state.maxPages) return 'dedup';
    if (!state.profile?.nextSelector) return 'dedup';
    if (state.stubs.length === state.prevStubCount) return 'dedup'; // this page added nothing new
    return 'paginate';
  }

  // 4) Advance to the next page. (Production: replace the sleep with a wait-for-selector tool.)
  async function paginate(state: State): Promise<Partial<State>> {
    report({ phase: 'paginate', message: `Loading page ${state.page + 1}…` });
    await callTool(deps, 'browser_click', { selector: state.profile!.nextSelector! });
    await sleep(1800);
    return { page: state.page + 1 };
  }

  // 5) Diff against the board: only sourceIds we've never seen survive.
  function dedup(state: State): Partial<State> {
    const known = deps.store.knownSourceIds();
    const newStubs = state.stubs.filter((s) => !known.has(s.sourceId));
    report({
      phase: 'dedup',
      message: `${newStubs.length} new of ${state.stubs.length} (${state.stubs.length - newStubs.length} already imported)`,
    });
    return { newStubs };
  }

  // 6) Open each NEW job and structure it. Sequential — there's only one browser.
  async function extractDetails(state: State): Promise<Partial<State>> {
    const records: JobRecord[] = [];
    let i = 0;
    for (const stub of state.newStubs) {
      i++;
      await callTool(deps, 'browser_navigate', { url: stub.url });
      await sleep(600);
      const text = await callTool(deps, 'browser_get_text', { selector: 'body' });
      let fields: z.infer<typeof JobSchema>;
      try {
        fields = await jobLlm.invoke(
          `Extract this job posting into structured fields from the page text below. ` +
            `Omit any field that is absent. Keep the description complete and plain-text.\n\n${text.slice(0, 12000)}`,
        );
      } catch {
        fields = { title: stub.title ?? 'Unknown', company: 'Unknown' };
      }
      records.push({
        ...fields,
        title: fields.title || stub.title || 'Unknown',
        company: fields.company || 'Unknown',
        sourceId: stub.sourceId,
        url: stub.url,
        status: 'new' as JobStatus,
        importedAt: new Date().toISOString(),
      });
      report({
        phase: 'extract',
        message: `Extracted ${i}/${state.newStubs.length}: ${records[records.length - 1].title}`,
        done: i,
        total: state.newStubs.length,
      });
    }
    return { extracted: records };
  }

  // 7) Persist to the board (insert-if-absent), report the tally.
  function persist(state: State): Partial<State> {
    const imported = deps.store.upsertJobs(state.extracted);
    const summary = {
      imported,
      skipped: state.stubs.length - state.newStubs.length,
      total: state.stubs.length,
      pages: state.page,
    };
    report({ phase: 'done', message: `Imported ${imported} new job(s) from ${summary.total} listed.` });
    return { summary };
  }

  const graph = new StateGraph(S)
    .addNode('init', init)
    .addNode('discover', discover)
    .addNode('enumerate', enumerate)
    .addNode('paginate', paginate)
    .addNode('dedup', dedup)
    .addNode('extractDetails', extractDetails)
    .addNode('persist', persist)
    .addEdge(START, 'init')
    .addEdge('init', 'discover')
    .addEdge('discover', 'enumerate')
    .addConditionalEdges('enumerate', afterEnumerate, { paginate: 'paginate', dedup: 'dedup' })
    .addEdge('paginate', 'enumerate')
    .addEdge('dedup', 'extractDetails')
    .addEdge('extractDetails', 'persist')
    .addEdge('persist', END)
    .compile();

  return {
    /** Crawl `startUrl` and import new jobs. Returns the import summary. */
    async extract(startUrl: string) {
      const final = await graph.invoke({ startUrl }, { recursionLimit: 150 });
      return final.summary;
    },
  };
}

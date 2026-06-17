/**
 * Unit tests for EXTR-002: browser + extraction MCP tools.
 *
 * Verifies that the in-process MCP browser server registers the base
 * navigation/interaction tools and the extraction tools, that every
 * tool resolves the active target via the injected seam and runs its
 * work through webContents (executeJavaScript / loadURL / capturePage),
 * and that any general eval tool is flagged trusted-pages-only.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');

interface FakeMcpServer {
  meta: unknown;
  tools: Map<string, { handler: (...a: unknown[]) => unknown; description?: string }>;
  connected: boolean;
  closed: boolean;
}

const mockMcpServers: FakeMcpServer[] = [];

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer implements FakeMcpServer {
    meta: unknown;
    tools = new Map<string, { handler: (...a: unknown[]) => unknown; description?: string }>();
    connected = false;
    closed = false;
    constructor(meta: unknown) {
      this.meta = meta;
      mockMcpServers.push(this);
    }
    tool(name: string, ...rest: unknown[]) {
      const handler = rest[rest.length - 1] as (...a: unknown[]) => unknown;
      const description = typeof rest[0] === 'string' ? (rest[0] as string) : undefined;
      // exactOptionalPropertyTypes: only set `description` when present rather
      // than assigning `undefined` to the optional property.
      this.tools.set(name, description !== undefined ? { handler, description } : { handler });
    }
    async connect() {
      this.connected = true;
    }
    async close() {
      this.closed = true;
    }
  }
  return { McpServer };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => {
  class StreamableHTTPServerTransport {
    opts: unknown;
    onclose?: () => void;
    sessionId?: string;
    constructor(opts: unknown) {
      this.opts = opts;
    }
    async handleRequest(_req: unknown, res: { end: () => void }) {
      res.end();
    }
  }
  return { StreamableHTTPServerTransport };
});

interface ExecCall {
  code: string;
}

interface FakeWebContents {
  executeJavaScript: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  capturePage: ReturnType<typeof vi.fn>;
  getURL: () => string;
  execCalls: ExecCall[];
  execResult: unknown;
}

function makeWc(execResult: unknown = undefined): FakeWebContents {
  const wc: FakeWebContents = {
    execCalls: [],
    execResult,
    executeJavaScript: vi.fn((code: string) => {
      wc.execCalls.push({ code });
      return Promise.resolve(wc.execResult);
    }),
    loadURL: vi.fn(() => Promise.resolve()),
    capturePage: vi.fn(() =>
      Promise.resolve({ toDataURL: () => 'data:image/png;base64,AAAA' }),
    ),
    getURL: () => 'https://example.test/',
  };
  return wc;
}

async function loadServer() {
  return await import('../mcp-browser-server');
}

function build(wc: FakeWebContents) {
  // Build the MCP server with this target. Returns the server and the
  // active-target spy so tests can assert the per-call lookup contract.
  return async () => {
    const getActiveTarget = vi.fn(() => wc as never);
    const mod = await loadServer();
    const server = mod.buildMcpBrowserServer({ getActiveTarget }) as unknown as FakeMcpServer;
    return { server, getActiveTarget };
  };
}

beforeEach(() => {
  mockMcpServers.length = 0;
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const BASE_TOOLS = [
  'browser_navigate',
  'browser_get_text',
  'browser_click',
  'browser_type',
  'browser_query',
  'browser_scroll',
  'browser_screenshot',
];

const EXTRACTION_TOOLS = ['browser_query_all', 'browser_outer_html', 'browser_scroll'];

describe('EXTR-002: base browser tools', () => {
  it('AC1: registers every base browser tool', async () => {
    const { server } = await build(makeWc())();
    for (const name of BASE_TOOLS) {
      expect(server.tools.has(name), `missing tool ${name}`).toBe(true);
    }
  });

  it('browser_navigate calls loadURL on the active target', async () => {
    const wc = makeWc();
    const { server, getActiveTarget } = await build(wc)();
    const tool = server.tools.get('browser_navigate')!;
    const res = await tool.handler({ url: 'https://job.example/list' });
    expect(getActiveTarget).toHaveBeenCalledTimes(1);
    expect(wc.loadURL).toHaveBeenCalledWith('https://job.example/list');
    expect(res).toMatchObject({ content: [{ type: 'text' }] });
  });

  it('browser_get_text runs executeJavaScript and returns the text content', async () => {
    const wc = makeWc('Hello world');
    const { server, getActiveTarget } = await build(wc)();
    const tool = server.tools.get('browser_get_text')!;
    const res = (await tool.handler({ selector: 'h1.title' })) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(getActiveTarget).toHaveBeenCalledTimes(1);
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(wc.execCalls[0]!.code).toContain('h1.title');
    expect(res.content[0]!.type).toBe('text');
    expect(res.content[0]!.text).toBe('Hello world');
  });

  it('browser_click runs executeJavaScript referencing the selector', async () => {
    const wc = makeWc(true);
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_click')!;
    await tool.handler({ selector: 'button#apply' });
    expect(wc.executeJavaScript).toHaveBeenCalled();
    expect(wc.execCalls[0]!.code).toContain('button#apply');
    expect(wc.execCalls[0]!.code).toMatch(/\.click\(\)/);
  });

  it('browser_type injects both selector and value into the page script', async () => {
    const wc = makeWc(true);
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_type')!;
    await tool.handler({ selector: 'input[name="q"]', text: 'remote devops' });
    const code = wc.execCalls[0]!.code;
    expect(code).toContain('input[name=\\"q\\"]');
    expect(code).toContain('remote devops');
  });

  it('browser_query returns the first match outerHTML', async () => {
    const wc = makeWc('<div class="job">hi</div>');
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_query')!;
    const res = (await tool.handler({ selector: '.job' })) as {
      content: Array<{ text: string }>;
    };
    expect(wc.executeJavaScript).toHaveBeenCalled();
    expect(res.content[0]!.text).toBe('<div class="job">hi</div>');
  });

  it('browser_screenshot calls capturePage and returns a data URL', async () => {
    const wc = makeWc();
    const { server, getActiveTarget } = await build(wc)();
    const tool = server.tools.get('browser_screenshot')!;
    const res = (await tool.handler({})) as { content: Array<{ text: string }> };
    expect(getActiveTarget).toHaveBeenCalledTimes(1);
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    expect(res.content[0]!.text).toContain('data:image/png;base64,');
  });
});

describe('EXTR-002: extraction tools', () => {
  it('AC2: extraction tools are registered', async () => {
    const { server } = await build(makeWc())();
    for (const name of EXTRACTION_TOOLS) {
      expect(server.tools.has(name), `missing extraction tool ${name}`).toBe(true);
    }
  });

  it('browser_query_all returns the page script output verbatim as JSON text', async () => {
    const payload = [
      { text: 'Senior Engineer', href: 'https://j.example/1', html: '<a>Senior Engineer</a>' },
      { text: 'Junior Engineer', href: 'https://j.example/2', html: '<a>Junior Engineer</a>' },
    ];
    const wc = makeWc(payload);
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_query_all')!;
    const res = (await tool.handler({
      selector: 'li.job',
      linkSelector: 'a',
      limit: 50,
    })) as { content: Array<{ text: string }> };
    expect(wc.executeJavaScript).toHaveBeenCalled();
    const code = wc.execCalls[0]!.code;
    // The script must pass through the selector, link-selector and limit.
    expect(code).toContain('li.job');
    expect(code).toContain('"a"');
    expect(code).toContain('50');
    // Result text is parseable JSON matching the captured page result.
    expect(JSON.parse(res.content[0]!.text)).toEqual(payload);
  });

  it('browser_query_all defaults linkSelector to "a" and applies a default limit', async () => {
    const wc = makeWc([]);
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_query_all')!;
    await tool.handler({ selector: 'li.job' });
    const code = wc.execCalls[0]!.code;
    expect(code).toContain('li.job');
    // A default link-selector and an integer default limit must be present.
    expect(code).toMatch(/"a"/);
    expect(code).toMatch(/\b\d{1,4}\b/);
  });

  it('browser_outer_html returns truncated outerHTML when given a selector', async () => {
    const wc = makeWc('<body>...</body>');
    const { server, getActiveTarget } = await build(wc)();
    const tool = server.tools.get('browser_outer_html')!;
    const res = (await tool.handler({ selector: 'main' })) as {
      content: Array<{ text: string }>;
    };
    expect(getActiveTarget).toHaveBeenCalled();
    const code = wc.execCalls[0]!.code;
    expect(code).toContain('main');
    // The script must apply a truncation cap so we never blast back MB of HTML.
    expect(code).toMatch(/slice\(0, ?\d+\)/);
    expect(res.content[0]!.text).toBe('<body>...</body>');
  });

  it('browser_outer_html falls back to body when no selector is given', async () => {
    const wc = makeWc('<body>fallback</body>');
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_outer_html')!;
    await tool.handler({});
    expect(wc.execCalls[0]!.code).toContain('body');
  });

  it('browser_scroll supports to-bottom and returns the new height', async () => {
    const wc = makeWc(4321);
    const { server, getActiveTarget } = await build(wc)();
    const tool = server.tools.get('browser_scroll')!;
    const res = (await tool.handler({ toBottom: true })) as {
      content: Array<{ text: string }>;
    };
    expect(getActiveTarget).toHaveBeenCalled();
    expect(wc.execCalls[0]!.code).toContain('scrollTo');
    expect(res.content[0]!.text).toContain('4321');
  });

  it('browser_scroll supports by-pixels via the by parameter', async () => {
    const wc = makeWc(1000);
    const { server } = await build(wc)();
    const tool = server.tools.get('browser_scroll')!;
    await tool.handler({ by: 800 });
    const code = wc.execCalls[0]!.code;
    expect(code).toContain('800');
    expect(code).toMatch(/scrollBy|scrollTo/);
  });
});

describe('EXTR-002: cross-cutting contract', () => {
  it('AC3: every tool resolves the active target on each call', async () => {
    let cur: FakeWebContents = makeWc();
    const getActiveTarget = vi.fn(() => cur as never);
    const mod = await loadServer();
    const server = mod.buildMcpBrowserServer({ getActiveTarget }) as unknown as FakeMcpServer;

    // Drive a representative handler twice with a retarget in between.
    const tool = server.tools.get('browser_get_text')!;
    cur.execResult = 'first';
    await tool.handler({ selector: 'body' });
    cur = makeWc('second');
    await tool.handler({ selector: 'body' });
    expect(getActiveTarget).toHaveBeenCalledTimes(2);
  });

  it('AC4: any browser_eval surface is flagged trusted-pages-only', async () => {
    const { server } = await build(makeWc())();
    if (!server.tools.has('browser_eval')) return; // tool is optional
    const evalTool = server.tools.get('browser_eval')!;
    const desc = (evalTool.description ?? '').toLowerCase();
    expect(desc).toMatch(/trusted/);
    // Source-level guard so the warning isn't only in the tool description.
    const src = readFileSync(path.join(ELECTRON_DIR, 'mcp-browser-server.ts'), 'utf8');
    expect(src.toLowerCase()).toMatch(/trusted[^\n]*pages?\s*only|trusted-pages-only/);
  });
});

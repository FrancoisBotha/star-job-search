/**
 * Unit tests for the in-process MCP browser server (EXTR-001).
 *
 * The module under test:
 *  - declares the agentic-extraction deps in package.json
 *  - exposes a Streamable HTTP MCP server bound to 127.0.0.1
 *  - mints a fresh session per connection
 *  - resolves the active browser target per tool call (the seam)
 *  - logs and survives a start failure
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(ELECTRON_DIR, '..');

// --- Mock the MCP SDK so tests don't depend on its install ----------------

interface FakeMcpServer {
  meta: unknown;
  tools: Map<string, { handler: (...a: unknown[]) => unknown }>;
  connected: boolean;
  closed: boolean;
}

const mockMcpServers: FakeMcpServer[] = [];
const mockTransports: Array<{ opts: unknown; onclose?: () => void }> = [];

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer implements FakeMcpServer {
    meta: unknown;
    tools = new Map<string, { handler: (...a: unknown[]) => unknown }>();
    connected = false;
    closed = false;
    constructor(meta: unknown) {
      this.meta = meta;
      mockMcpServers.push(this);
    }
    tool(name: string, ...rest: unknown[]) {
      const handler = rest[rest.length - 1] as (...a: unknown[]) => unknown;
      this.tools.set(name, { handler });
    }
    async connect(_t: unknown) {
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
      mockTransports.push(this);
    }
    async handleRequest(_req: unknown, res: { end: () => void }) {
      res.end();
    }
  }
  return { StreamableHTTPServerTransport };
});

beforeEach(() => {
  mockMcpServers.length = 0;
  mockTransports.length = 0;
});

afterEach(() => {
  vi.resetModules();
});

// --- AC1: deps ------------------------------------------------------------

describe('EXTR-001 package.json deps', () => {
  it('declares the agentic-extraction dependencies', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const dep of [
      '@langchain/langgraph',
      '@langchain/openai',
      '@langchain/mcp-adapters',
      '@langchain/core',
      '@modelcontextprotocol/sdk',
      'zod',
    ]) {
      expect(all, `missing dep ${dep}`).toHaveProperty(dep);
    }
  });
});

// --- AC2 / AC4 / AC5: server behavior -------------------------------------

describe('startMcpBrowserServer', () => {
  it('AC2: binds to 127.0.0.1 (not reachable off-machine)', async () => {
    const mod = await import('../mcp-browser-server');
    const running = await mod.startMcpBrowserServer({
      getActiveTarget: () => undefined,
      port: 0,
    });
    expect(running).toBeDefined();
    expect(running!.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
    await running!.close();

    // Belt-and-braces — the source must never hard-code a public bind.
    const src = readFileSync(path.join(ELECTRON_DIR, 'mcp-browser-server.ts'), 'utf8');
    expect(src).toMatch(/127\.0\.0\.1/);
    expect(src).not.toMatch(/0\.0\.0\.0/);
  });

  it('AC2: a fresh MCP session is created per connection', async () => {
    const mod = await import('../mcp-browser-server');
    const running = await mod.startMcpBrowserServer({
      getActiveTarget: () => undefined,
      port: 0,
    });

    await fetch(running!.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});
    await fetch(running!.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => {});

    // Two connections without an Mcp-Session-Id => two MCP servers built.
    expect(mockMcpServers.length).toBeGreaterThanOrEqual(2);
    expect(mockTransports.length).toBeGreaterThanOrEqual(2);
    await running!.close();
  });

  it('AC4: tool handlers resolve the active target on EVERY call', async () => {
    let current = { getURL: () => 'about:blank' } as unknown;
    const getActiveTarget = vi.fn(() => current as never);

    const mod = await import('../mcp-browser-server');
    const server = mod.buildMcpBrowserServer({ getActiveTarget }) as unknown as FakeMcpServer;

    expect(server.tools.size).toBeGreaterThan(0);
    const tool = server.tools.values().next().value!;

    await tool.handler({});
    expect(getActiveTarget).toHaveBeenCalledTimes(1);

    // Retarget — the next call must see the new value, proving the lookup
    // happens per call rather than being captured once at build time.
    current = { getURL: () => 'https://retargeted.example' };
    await tool.handler({});
    expect(getActiveTarget).toHaveBeenCalledTimes(2);
  });

  it('AC5: start failure is logged and returns undefined (no crash)', async () => {
    const mod = await import('../mcp-browser-server');
    const logger = { error: vi.fn() };

    const first = await mod.startMcpBrowserServer({
      getActiveTarget: () => undefined,
      port: 0,
      logger,
    });
    expect(first).toBeDefined();

    // Re-binding the same port on 127.0.0.1 must fail; the function must
    // swallow the error, log it, and return undefined.
    const second = await mod.startMcpBrowserServer({
      getActiveTarget: () => undefined,
      port: first!.port,
      logger,
    });
    expect(second).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();

    await first!.close();
  });
});

// --- AC3: electron-main active-target seam --------------------------------

describe('electron-main active-target seam', () => {
  it('AC3: defines getActiveTarget/setActiveTarget defaulting to the embedded browser', () => {
    const src = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
    expect(src).toMatch(/getActiveTarget/);
    expect(src).toMatch(/setActiveTarget/);
    // The default target must come from the embedded job-browser surface.
    expect(src).toMatch(/createJobBrowser/);
    // The MCP server must be started from the main process on app-ready.
    expect(src).toMatch(/startMcpBrowserServer/);
    expect(src).toMatch(/whenReady/);
  });
});

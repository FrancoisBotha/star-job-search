/**
 * In-process MCP browser server (EXTR-001 / EXTR-002).
 *
 * Hosts a Streamable HTTP MCP server bound to 127.0.0.1 so an in-process
 * LangGraph agent — and only this machine — can drive the embedded browser
 * via MCP tools. Each fresh HTTP client gets its own MCP session.
 *
 * The seam: tool handlers resolve the "active target" (an Electron
 * `WebContents`) on every call via the injected `getActiveTarget()`. Later
 * tickets can retarget to a hidden crawler webContents without touching any
 * tool definition.
 *
 * EXTR-002 adds the navigation/interaction surface (navigate, get_text,
 * click, type, query, scroll, screenshot) and the extraction surface
 * (query_all, outer_html, scroll-by-pixels/to-bottom) the agent needs to
 * harvest job listings from arbitrary boards.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const HOST = '127.0.0.1';

// Cap returned HTML so a runaway page can't flood the agent's context.
const OUTER_HTML_MAX = 200_000;
const QUERY_ALL_DEFAULT_LIMIT = 200;

export interface McpLogger {
  error(...args: unknown[]): void;
  info?(...args: unknown[]): void;
}

export interface McpBrowserServerOptions {
  /** Resolves the active browser webContents — invoked per tool call. */
  getActiveTarget: () => WebContents | undefined;
  /** Port to bind. Defaults to 0 (ephemeral). */
  port?: number;
  /** Logger used for start/request failures. Defaults to console. */
  logger?: McpLogger;
}

export interface RunningMcpBrowserServer {
  /** The actual bound port (resolved when `port: 0`). */
  port: number;
  /** Loopback URL — never reachable off-machine. */
  url: string;
  close(): Promise<void>;
}

function requireTarget(getActiveTarget: () => WebContents | undefined): WebContents {
  const wc = getActiveTarget();
  if (!wc) throw new Error('no active browser target');
  return wc;
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

/**
 * Build (but don't start) a fresh MCP server wired to the given target seam.
 * Exported so tools can be unit-tested directly without spinning up HTTP.
 */
export function buildMcpBrowserServer(opts: {
  getActiveTarget: () => WebContents | undefined;
}): McpServer {
  const server = new McpServer({ name: 'star-browser', version: '0.2.0' });
  const getTarget = () => requireTarget(opts.getActiveTarget);

  server.tool(
    'browser_get_url',
    'Return the current URL of the active browser target.',
    async () => textResult(getTarget().getURL()),
  );

  server.tool(
    'browser_navigate',
    'Navigate the active browser target to the given URL and wait for load.',
    { url: z.string() },
    async ({ url }: { url: string }) => {
      const wc = getTarget();
      await wc.loadURL(url);
      return textResult(`navigated:${url}`);
    },
  );

  server.tool(
    'browser_get_text',
    'Return the textContent of the first element matching the CSS selector (defaults to body).',
    { selector: z.string().optional() },
    async ({ selector }: { selector?: string | undefined }) => {
      const sel = JSON.stringify(selector ?? 'body');
      const code = `(() => {
        const el = document.querySelector(${sel});
        return el ? (el.innerText || el.textContent || '') : '';
      })()`;
      const text = (await getTarget().executeJavaScript(code)) as string;
      return textResult(String(text ?? ''));
    },
  );

  server.tool(
    'browser_click',
    'Click the first element matching the CSS selector. Throws if no element is found.',
    { selector: z.string() },
    async ({ selector }: { selector: string }) => {
      const sel = JSON.stringify(selector);
      const code = `(() => {
        const el = document.querySelector(${sel});
        if (!el) throw new Error('selector not found: ' + ${sel});
        el.click();
        return true;
      })()`;
      await getTarget().executeJavaScript(code);
      return textResult(`clicked:${selector}`);
    },
  );

  server.tool(
    'browser_type',
    'Focus the matching input/textarea, set its value to text, and dispatch input + change.',
    { selector: z.string(), text: z.string() },
    async ({ selector, text }: { selector: string; text: string }) => {
      const sel = JSON.stringify(selector);
      const val = JSON.stringify(text);
      const code = `(() => {
        const el = document.querySelector(${sel});
        if (!el) throw new Error('selector not found: ' + ${sel});
        el.focus && el.focus();
        if ('value' in el) el.value = ${val};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`;
      await getTarget().executeJavaScript(code);
      return textResult(`typed:${selector}`);
    },
  );

  server.tool(
    'browser_query',
    'Return the outerHTML of the first element matching the CSS selector, or empty string.',
    { selector: z.string() },
    async ({ selector }: { selector: string }) => {
      const sel = JSON.stringify(selector);
      const code = `(() => {
        const el = document.querySelector(${sel});
        return el ? el.outerHTML : '';
      })()`;
      const html = (await getTarget().executeJavaScript(code)) as string;
      return textResult(String(html ?? ''));
    },
  );

  // --- EXTR-002 extraction surface ---------------------------------------

  server.tool(
    'browser_query_all',
    'For every element matching selector return {text, href, html}. If linkSelector ' +
      'is given the href is taken from that descendant. Capped at limit (default ' +
      `${QUERY_ALL_DEFAULT_LIMIT}). Result is JSON text.`,
    {
      selector: z.string(),
      linkSelector: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    async ({
      selector,
      linkSelector,
      limit,
    }: {
      selector: string;
      linkSelector?: string | undefined;
      limit?: number | undefined;
    }) => {
      const sel = JSON.stringify(selector);
      const linkSel = JSON.stringify(linkSelector ?? 'a');
      const lim = Math.max(1, Math.min(limit ?? QUERY_ALL_DEFAULT_LIMIT, 5000));
      const code = `(() => {
        const out = [];
        const nodes = document.querySelectorAll(${sel});
        for (let i = 0; i < nodes.length && i < ${lim}; i++) {
          const el = nodes[i];
          const link = el.matches(${linkSel}) ? el : el.querySelector(${linkSel});
          out.push({
            text: (el.innerText || el.textContent || '').trim(),
            href: link && link.href ? link.href : '',
            html: el.outerHTML || '',
          });
        }
        return out;
      })()`;
      const rows = (await getTarget().executeJavaScript(code)) as unknown[];
      return textResult(JSON.stringify(rows ?? []));
    },
  );

  server.tool(
    'browser_outer_html',
    `Return outerHTML of the matched element (defaults to body), truncated to ${OUTER_HTML_MAX} chars.`,
    { selector: z.string().optional() },
    async ({ selector }: { selector?: string | undefined }) => {
      const sel = JSON.stringify(selector ?? 'body');
      const code = `(() => {
        const el = document.querySelector(${sel});
        const html = el ? (el.outerHTML || '') : '';
        return html.slice(0, ${OUTER_HTML_MAX});
      })()`;
      const html = (await getTarget().executeJavaScript(code)) as string;
      return textResult(String(html ?? ''));
    },
  );

  server.tool(
    'browser_scroll',
    'Scroll the page. Pass {toBottom:true} to jump to the bottom, or {by:N} to ' +
      'scroll by N pixels. Returns the new document height (useful for ' +
      'infinite-scroll loops).',
    {
      toBottom: z.boolean().optional(),
      by: z.number().optional(),
    },
    async ({ toBottom, by }: { toBottom?: boolean | undefined; by?: number | undefined }) => {
      const wantBottom = toBottom === true || (by === undefined);
      const pixels = typeof by === 'number' ? by : 0;
      const code = wantBottom
        ? `(() => {
            window.scrollTo(0, document.documentElement.scrollHeight);
            return document.documentElement.scrollHeight;
          })()`
        : `(() => {
            window.scrollBy(0, ${pixels});
            return document.documentElement.scrollHeight;
          })()`;
      const height = (await getTarget().executeJavaScript(code)) as number;
      return textResult(String(height ?? 0));
    },
  );

  server.tool(
    'browser_screenshot',
    'Capture the active target as a PNG and return a data: URL (no file write).',
    async () => {
      const wc = getTarget();
      const img = await wc.capturePage();
      return textResult(img.toDataURL());
    },
  );

  // NOTE: browser_eval is intentionally omitted from the default surface
  // because arbitrary JS execution against a third-party page is a generic
  // XSS vector (NFR-001). If a future ticket re-enables it, the description
  // MUST carry the "trusted-pages-only" warning kept in source below:
  //   trusted-pages-only — never expose to untrusted job-board content.

  return server;
}

export async function startMcpBrowserServer(
  opts: McpBrowserServerOptions,
): Promise<RunningMcpBrowserServer | undefined> {
  const logger: McpLogger = opts.logger ?? console;
  const requestedPort = opts.port ?? 0;

  try {
    interface Session {
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    }
    const sessions = new Map<string, Session>();

    const httpServer = http.createServer((req, res) => {
      void (async () => {
        try {
          const header = req.headers['mcp-session-id'];
          const sessionId = Array.isArray(header) ? header[0] : header;

          let session = sessionId ? sessions.get(sessionId) : undefined;
          if (!session) {
            const newId = randomUUID();
            const server = buildMcpBrowserServer({
              getActiveTarget: opts.getActiveTarget,
            });
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => newId,
              onsessioninitialized: (sid: string) => {
                sessions.set(sid, { server, transport });
              },
            });
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid) sessions.delete(sid);
            };
            // The SDK's concrete transport types its optional `onclose` as
            // `(() => void) | undefined`, which exactOptionalPropertyTypes
            // treats as incompatible with the Transport interface's optional
            // `onclose?`. The class does implement Transport — cast past the
            // strict-optional mismatch.
            await server.connect(
              transport as unknown as Parameters<McpServer['connect']>[0],
            );
            session = { server, transport };
            // Cover the not-yet-initialized case so close() can still see it.
            sessions.set(newId, session);
          }

          await session.transport.handleRequest(req, res);
        } catch (err) {
          logger.error('mcp-browser-server: request failed', err);
          if (!res.headersSent) res.writeHead(500);
          try {
            res.end();
          } catch {
            /* swallow — connection already gone */
          }
        }
      })();
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        httpServer.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        httpServer.removeListener('error', onError);
        resolve();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      // Loopback only; the agent runs in-process.
      httpServer.listen(requestedPort, HOST);
    });

    const addr = httpServer.address();
    const boundPort =
      typeof addr === 'object' && addr !== null ? addr.port : requestedPort;

    return {
      port: boundPort,
      url: `http://${HOST}:${boundPort}/`,
      close: () =>
        new Promise<void>((resolve) => {
          for (const s of sessions.values()) {
            try {
              void s.server.close();
            } catch {
              /* ignore */
            }
          }
          sessions.clear();
          httpServer.close(() => resolve());
        }),
    };
  } catch (err) {
    // Start failure must not crash the app — log and return undefined.
    logger.error('mcp-browser-server: failed to start', err);
    return undefined;
  }
}

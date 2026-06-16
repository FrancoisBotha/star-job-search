/**
 * In-process MCP browser server (EXTR-001).
 *
 * Hosts a Streamable HTTP MCP server bound to 127.0.0.1 so an in-process
 * LangGraph agent — and only this machine — can drive the embedded browser
 * via MCP tools. Each fresh HTTP client gets its own MCP session.
 *
 * The seam: tool handlers resolve the "active target" (an Electron
 * `WebContents`) on every call via the injected `getActiveTarget()`. Later
 * tickets can retarget to a hidden crawler webContents without touching any
 * tool definition.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const HOST = '127.0.0.1';

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

/**
 * Build (but don't start) a fresh MCP server wired to the given target seam.
 * Exported so tools can be unit-tested directly without spinning up HTTP.
 */
export function buildMcpBrowserServer(opts: {
  getActiveTarget: () => WebContents | undefined;
}): McpServer {
  const server = new McpServer({ name: 'star-browser', version: '0.1.0' });

  // Minimal tool surface for EXTR-001 — later tickets add navigate / snapshot
  // / click / type / wait_for. Each handler MUST resolve the target via
  // `opts.getActiveTarget()` so retargeting works without tool changes.
  server.tool(
    'browser_get_url',
    'Return the current URL of the active browser target.',
    async () => {
      const wc = opts.getActiveTarget();
      if (!wc) throw new Error('no active browser target');
      return { content: [{ type: 'text', text: wc.getURL() }] };
    },
  );

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
            await server.connect(transport);
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

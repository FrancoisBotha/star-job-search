// extraction-tools.ts
//
// Extra MCP tools the extraction graph needs for *deterministic* enumeration.
// Register these on the same McpServer as the browser tools from mcp-browser-server.ts.

import type { WebContents } from 'electron';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerExtractionTools(server: McpServer, getWebContents: () => WebContents): void {
  const run = <T>(wc: WebContents, code: string) => wc.executeJavaScript(code, true) as Promise<T>;

  server.registerTool(
    'browser_query_all',
    {
      title: 'Query all elements',
      description:
        'Return data for EVERY element matching a CSS selector. Use to enumerate job cards/rows. ' +
        'Returns a JSON array of { text, href, html }.',
      inputSchema: {
        selector: z.string(),
        linkSelector: z.string().optional(), // anchor inside each match to read href from
        limit: z.number().optional(),
      },
    },
    async ({ selector, linkSelector, limit }) => {
      const wc = getWebContents();
      const args = JSON.stringify({ selector, linkSelector: linkSelector ?? null, limit: limit ?? 1000 });
      const json = await run<string>(
        wc,
        `(() => {
           const { selector, linkSelector, limit } = ${args};
           const nodes = Array.from(document.querySelectorAll(selector)).slice(0, limit);
           const out = nodes.map((el) => {
             const a = linkSelector ? el.querySelector(linkSelector)
                     : (el.matches('a') ? el : el.querySelector('a'));
             return {
               text: (el.innerText || '').trim().slice(0, 1500),
               href: a && a.href ? a.href : null,
               html: el.outerHTML.slice(0, 4000),
             };
           });
           return JSON.stringify(out);
         })()`,
      );
      return { content: [{ type: 'text', text: json }] };
    },
  );

  server.registerTool(
    'browser_outer_html',
    {
      title: 'Get outer HTML',
      description: 'Return the (truncated) outer HTML of a selector, or of the page body. For layout discovery.',
      inputSchema: { selector: z.string().optional(), maxChars: z.number().optional() },
    },
    async ({ selector, maxChars }) => {
      const wc = getWebContents();
      const sel = JSON.stringify(selector ?? 'body');
      const html = await run<string>(wc, `(() => { const el = document.querySelector(${sel}); return el ? el.outerHTML : ''; })()`);
      return { content: [{ type: 'text', text: String(html).slice(0, maxChars ?? 14000) }] };
    },
  );

  server.registerTool(
    'browser_scroll',
    {
      title: 'Scroll',
      description: 'Scroll the page (to trigger infinite-scroll loading). Returns the new document height.',
      inputSchema: { toBottom: z.boolean().optional(), byPixels: z.number().optional() },
    },
    async ({ toBottom, byPixels }) => {
      const wc = getWebContents();
      const args = JSON.stringify({ toBottom: toBottom ?? true, byPixels: byPixels ?? 0 });
      const height = await run<number>(
        wc,
        `(() => {
           const { toBottom, byPixels } = ${args};
           if (toBottom) window.scrollTo(0, document.body.scrollHeight);
           else window.scrollBy(0, byPixels);
           return document.body.scrollHeight;
         })()`,
      );
      return { content: [{ type: 'text', text: String(height) }] };
    },
  );
}

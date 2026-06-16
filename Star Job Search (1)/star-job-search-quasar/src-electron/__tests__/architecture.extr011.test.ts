/**
 * Architecture doc test (EXTR-011).
 *
 * docs/Architecture/Architecture.md must note the agentic extraction subsystem
 * delivered by the EXTR-001…010 tickets — the in-process MCP browser server,
 * the hidden crawler, the LangGraph extraction graph, and the local job board —
 * and call out that it builds on Epic 1 (embedded browser / sites persistence)
 * and Epic 2 (OpenRouter LLM integration).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// star-job-search-quasar/src-electron/__tests__ → repo root
const ARCH = readFileSync(
  path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'Architecture', 'Architecture.md'),
  'utf8',
);

describe('Architecture.md — agentic extraction subsystem (EXTR-011)', () => {
  it('names the MCP browser server / tools', () => {
    expect(ARCH).toMatch(/MCP/);
  });

  it('describes a hidden crawler driving the embedded browser', () => {
    expect(ARCH).toMatch(/hidden crawler/i);
  });

  it('names the LangGraph extraction graph', () => {
    expect(ARCH).toMatch(/LangGraph/);
  });

  it('names the local job board (jobs + site_profiles, sourceId dedup)', () => {
    expect(ARCH).toMatch(/job board/i);
    expect(ARCH).toMatch(/sourceId/);
  });

  it('calls out the Epic 1 (embedded browser) dependency', () => {
    expect(ARCH).toMatch(/Epic 1/);
    expect(ARCH).toMatch(/embedded browser/i);
  });

  it('calls out the Epic 2 (OpenRouter / LLM) dependency', () => {
    expect(ARCH).toMatch(/Epic 2/);
    expect(ARCH).toMatch(/OpenRouter/);
  });
});

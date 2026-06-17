/**
 * Unit tests for the Help page (EXTR-011).
 *
 * The Help page must gain guidance for the AI Extract flow delivered by the
 * EXTR-001…010 tickets: log into the chosen site in Discover, narrow the
 * listing to a filtered search, click AI Extract, watch progress, and triage
 * the resulting board on the Starred matches page (Open / Not interested /
 * Restore).
 *
 * Mirrors the regex-scan precedent of HelpPage.test.ts / HelpPage.llm008.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — AI Extract guidance (EXTR-011)', () => {
  it('introduces an AI Extract section', () => {
    expect(HELP).toMatch(/AI Extract/);
  });

  it('tells the user to log in and filter on Discover before extracting', () => {
    expect(HELP).toMatch(/Discover/);
    expect(HELP).toMatch(/log in/i);
    expect(HELP).toMatch(/filter/i);
  });

  it('describes clicking AI Extract and watching progress', () => {
    expect(HELP).toMatch(/click [^.]*AI Extract/i);
    expect(HELP).toMatch(/progress/i);
  });

  it('describes triaging the board with Open / Not interested / Restore', () => {
    expect(HELP).toMatch(/Open/);
    expect(HELP).toMatch(/Not interested/);
    expect(HELP).toMatch(/Restore/);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

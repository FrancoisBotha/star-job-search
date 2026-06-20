/**
 * Unit tests for the Help page (ENRICH-009).
 *
 * The Help page must gain user-facing guidance covering the features
 * delivered by Epic 13 (CV Enrichment):
 *  - The new CV Enrichment screen + sidebar item + /enrich route.
 *  - The 3-step Analyze → Questions → Review flow.
 *  - The never-invent grounding rule (skip / "no number" → minimally
 *    reworded, never invented).
 *  - The per-bullet accept/reject diff workflow on Review.
 *  - The "CV updated (v{n})" outcome after Apply.
 *
 * Mirrors the regex-scan precedent of HelpPage.uexp008.test.ts and
 * HelpPage.tailor010.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Epic 13 (CV Enrichment) guidance (ENRICH-009)', () => {
  it('introduces a dedicated CV Enrichment section', () => {
    expect(HELP).toMatch(/CV Enrichment/);
    expect(HELP).toMatch(/section-title sec[^>]*>\s*CV Enrichment/);
  });

  it('describes the new sidebar item and /enrich route', () => {
    expect(HELP).toMatch(/sidebar/i);
    expect(HELP).toMatch(/CV Enrichment/);
  });

  it('describes the 3-step Analyze → Questions → Review flow', () => {
    expect(HELP).toMatch(/Analyze/);
    expect(HELP).toMatch(/Questions/);
    expect(HELP).toMatch(/Review/);
    expect(HELP).toMatch(/three[- ]step|3[- ]step/i);
  });

  it('mentions the weak-bullet analysis with reasons', () => {
    expect(HELP).toMatch(/weak/i);
    expect(HELP).toMatch(/reason/i);
  });

  it("describes the skip / 'no number' behaviour on Questions", () => {
    expect(HELP).toMatch(/skip/i);
    expect(HELP).toMatch(/don't have that number|no number|don&#39;t have/i);
  });

  it('states the never-invent grounding rule', () => {
    expect(HELP).toMatch(/never invent|not invent|won't invent|do(es)? not invent/i);
    expect(HELP).toMatch(/minimally reworded|minimal reword/i);
  });

  it('describes the per-bullet accept/reject diff workflow on Review', () => {
    expect(HELP).toMatch(/[Aa]ccept/);
    expect(HELP).toMatch(/[Rr]eject/);
    expect(HELP).toMatch(/diff|per[- ]bullet|each (proposed )?change/i);
  });

  it("explains what 'CV updated (v{n})' means after Apply", () => {
    expect(HELP).toMatch(/CV updated/);
    expect(HELP).toMatch(/v\{n\}|version/i);
  });

  it('requires an OpenRouter key + default model (LLM feature)', () => {
    expect(HELP).toMatch(/OpenRouter/);
    expect(HELP).toMatch(/default model|API key/);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });

  it('declares an enrichSteps array following the existing section pattern', () => {
    expect(HELP).toMatch(/const enrichSteps\s*=/);
    expect(HELP).toMatch(/v-for="\(step, i\) in enrichSteps"/);
  });
});

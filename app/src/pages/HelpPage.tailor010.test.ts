/**
 * Unit tests for the Help page (TAILOR-010).
 *
 * The Help page must gain user-facing guidance covering the features
 * delivered by Epic 7 (Tailoring):
 *  - The Generate button on Starred jobs that deep-links into the Tailor view.
 *  - The Tailored CV and Cover-letter tabs.
 *  - The diff against the base CV (added / removed / unchanged).
 *  - Accept / Dismiss suggestions, with a live deterministic Epic 5 rescore.
 *  - The ATS checklist (rule pass/fail, missing keywords).
 *  - The intensity toggle (Light touch ↔ Aggressive).
 *  - Gap prompts on the cover letter (Confirm / Not applicable).
 *  - Copy + Export (text / Markdown).
 *  - Drafts are grounded, advisory and ATS-targeted.
 *  - The one-time "what is sent" disclosure governs egress; no new egress.
 *  - Star never submits applications — Copy / Export only.
 *  - Stale + Regenerate behaviour, with code-driven error states.
 *
 * Mirrors the regex-scan precedent of HelpPage.airev008.test.ts /
 * HelpPage.score011.test.ts / HelpPage.cvprof010.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Epic 7 (Tailoring) guidance (TAILOR-010)', () => {
  it('introduces a dedicated Tailoring section', () => {
    expect(HELP).toMatch(/Tailoring|Tailored CV|Tailor(\s|ed)/);
  });

  it('describes the Generate button on Starred jobs', () => {
    expect(HELP).toMatch(/Starred/);
    expect(HELP).toMatch(/Generate/);
  });

  it('describes the Tailored CV and Cover-letter tabs', () => {
    expect(HELP).toMatch(/Tailored CV/);
    expect(HELP).toMatch(/[Cc]over(\s|-)letter/);
    expect(HELP).toMatch(/tab/i);
  });

  it('describes the diff against the base CV', () => {
    expect(HELP).toMatch(/diff|added|removed|side(\s|-)by(\s|-)side/i);
    expect(HELP).toMatch(/base CV/i);
  });

  it('describes Accept / Dismiss suggestions with a live deterministic rescore', () => {
    expect(HELP).toMatch(/Accept/);
    expect(HELP).toMatch(/Dismiss/);
    expect(HELP).toMatch(/rescore|re(\s|-)score/i);
    expect(HELP).toMatch(/determinist/i);
  });

  it('describes the ATS checklist', () => {
    expect(HELP).toMatch(/ATS/);
    expect(HELP).toMatch(/checklist/i);
    expect(HELP).toMatch(/missing keyword/i);
  });

  it('describes the intensity toggle (Light ↔ Aggressive)', () => {
    expect(HELP).toMatch(/intensity/i);
    expect(HELP).toMatch(/light/i);
    expect(HELP).toMatch(/aggressive/i);
  });

  it('describes gap prompts on the cover letter', () => {
    expect(HELP).toMatch(/gap/i);
    expect(HELP).toMatch(/Confirm|Not applicable|question/i);
  });

  it('describes Copy and Export (text + Markdown)', () => {
    expect(HELP).toMatch(/Copy/);
    expect(HELP).toMatch(/Export/);
    expect(HELP).toMatch(/Markdown/);
    expect(HELP).toMatch(/text/i);
  });

  it('makes clear drafts are grounded, advisory and ATS-targeted', () => {
    expect(HELP).toMatch(/grounded|evidence|from your CV/i);
    expect(HELP).toMatch(/advisory/i);
    expect(HELP).toMatch(/ATS/);
  });

  it('states the one-time disclosure governs egress and there is no new egress', () => {
    expect(HELP).toMatch(/one(\s|-)time/i);
    expect(HELP).toMatch(/what is sent|what's sent|disclosure/i);
    expect(HELP).toMatch(/OpenRouter/);
    expect(HELP).toMatch(/no new egress|same.*egress|only.*OpenRouter|OpenRouter.*only/i);
  });

  it('makes clear Star never submits — Copy / Export only', () => {
    expect(HELP).toMatch(/never submits|does not submit|never sends|never appl(y|ies)/i);
    expect(HELP).toMatch(/Copy/);
    expect(HELP).toMatch(/Export/);
  });

  it('documents stale and regenerate behaviour for drafts', () => {
    expect(HELP).toMatch(/stale|out of date/i);
    expect(HELP).toMatch(/[Rr]egenerate/);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

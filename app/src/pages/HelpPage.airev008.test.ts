/**
 * Unit tests for the Help page (AIREV-008).
 *
 * The Help page must gain user-facing guidance covering the features delivered
 * by Epic 6 (AI Match Review): an on-demand, LLM-powered narrative review of
 * how the CV/Profile lines up with a specific job, generated from the
 * Job-detail modal, requiring a saved OpenRouter key + default model, clearly
 * advisory and separate from the deterministic star rating (no number/score),
 * preceded by a one-time "what is sent" disclosure (JD + CV text go only to
 * OpenRouter — no new egress), with stale/regenerate behaviour and per-code
 * error states (no key / model error / model-not-capable).
 *
 * Mirrors the regex-scan precedent of HelpPage.test.ts / HelpPage.llm008.test.ts /
 * HelpPage.extr011.test.ts / HelpPage.cvprof010.test.ts / HelpPage.score011.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — AI Match Review guidance (AIREV-008)', () => {
  it('introduces a dedicated AI Match Review section', () => {
    expect(HELP).toMatch(/AI Match Review/);
  });

  it('explains how to generate it from the Job-detail modal', () => {
    expect(HELP).toMatch(/job(\s|-)detail/i);
    expect(HELP).toMatch(/generate/i);
  });

  it('requires a saved OpenRouter key + default model', () => {
    expect(HELP).toMatch(/OpenRouter/);
    expect(HELP).toMatch(/key/i);
    expect(HELP).toMatch(/default model/i);
  });

  it('makes explicit it is advisory and separate from the deterministic stars', () => {
    expect(HELP).toMatch(/advisory/i);
    expect(HELP).toMatch(/separate|distinct|alongside|apart/i);
    expect(HELP).toMatch(/determinist/i);
    expect(HELP).toMatch(/star/i);
  });

  it('states the review emits no number/score and stars remain authoritative', () => {
    expect(HELP).toMatch(/no (number|score|rating)|never (a |emits |produces )?(number|score|rating)|words only|narrative/i);
    expect(HELP).toMatch(/authoritative|the only rating|remain(s)?|stay(s)?/i);
  });

  it('documents the one-time "what is sent" disclosure', () => {
    expect(HELP).toMatch(/one(\s|-)time/i);
    expect(HELP).toMatch(/what is sent|what's sent|disclosure/i);
  });

  it('states JD + CV text go only to OpenRouter (no new egress)', () => {
    expect(HELP).toMatch(/JD|job description/i);
    expect(HELP).toMatch(/CV/);
    expect(HELP).toMatch(/only.*OpenRouter|OpenRouter.*only|no new egress|no other (provider|destination)/i);
  });

  it('documents stale and regenerate behaviour', () => {
    expect(HELP).toMatch(/stale/i);
    expect(HELP).toMatch(/regenerate/i);
  });

  it('documents the per-code error states (no key / model error / model-not-capable)', () => {
    expect(HELP).toMatch(/no key|without a key|no API key|missing key/i);
    expect(HELP).toMatch(/model error|model(\s|-)not(\s|-)capable|not capable|capability|function(\s|-)calling/i);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

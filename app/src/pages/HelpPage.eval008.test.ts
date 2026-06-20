/**
 * Unit tests for the Help page (EVAL-008).
 *
 * The Help page must gain user-facing guidance covering the features
 * delivered by Epic 14 (Job Evaluation Report):
 *  - The A–H block structure of the Eval report.
 *  - The deterministic Epic 5 stars carry the rating; the Eval report
 *    emits no number / score / star / percentage of its own.
 *  - Opt-in web research with a one-time disclosure and a local-only
 *    `webResearchEnabled` setting (default OFF).
 *  - The shared `webResearch` capability that reuses the embedded
 *    browser surface — no new egress path is opened.
 *  - The anti-bot / CAPTCHA "detect and stop, never bypass" rule.
 *
 * Mirrors the regex-scan precedent of HelpPage.airev008.test.ts /
 * HelpPage.tailor010.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Epic 14 (Job Evaluation Report) guidance (EVAL-008)', () => {
  it('introduces a dedicated Eval report section', () => {
    expect(HELP).toMatch(/Eval(uation)? report|Job evaluation/i);
  });

  it('describes the A–H block structure', () => {
    expect(HELP).toMatch(/A.{0,30}Role Summary|Role Summary.{0,20}Employer/i);
    expect(HELP).toMatch(/B.{0,40}Match with CV|Match with CV/i);
    expect(HELP).toMatch(/C.{0,30}Level.{0,20}Strategy|Level &.{0,5}Strategy/i);
    expect(HELP).toMatch(/D.{0,30}Compensation/i);
    expect(HELP).toMatch(/E.{0,30}Tailored CV|Tailor(ed CV)?/i);
    expect(HELP).toMatch(/F.{0,30}Interview Prep/i);
    expect(HELP).toMatch(/G.{0,30}Legitimacy/i);
    expect(HELP).toMatch(/H.{0,30}Cover Letter.{0,20}Apply|Cover letter & Apply/i);
  });

  it('states the deterministic Epic 5 stars carry the rating — Eval report emits no number', () => {
    expect(HELP).toMatch(/determinist/i);
    expect(HELP).toMatch(/star/i);
    expect(HELP).toMatch(/no (number|score|rating|star|percentage)|never (a |emits |produces )?(number|score|rating)|words only|narrative/i);
    expect(HELP).toMatch(/authoritative|the only rating|remain(s)?|carry the rating/i);
  });

  it('describes opt-in web research with a default-OFF local-only setting', () => {
    expect(HELP).toMatch(/web research/i);
    expect(HELP).toMatch(/opt(-|\s)?in/i);
    expect(HELP).toMatch(/off by default|default(s)? (to )?off|default OFF|disabled by default/i);
    expect(HELP).toMatch(/local(-|\s)only|stays on this device|never leaves/i);
  });

  it('documents the one-time "what is sent" disclosure for web research', () => {
    expect(HELP).toMatch(/one(\s|-)time/i);
    expect(HELP).toMatch(/what is sent|what's sent|disclosure/i);
  });

  it('describes the shared webResearch capability that reuses the embedded browser surface', () => {
    expect(HELP).toMatch(/shared|reuse(d|s)?|same browser|same surface|embedded browser/i);
    expect(HELP).toMatch(/no new egress|same.*OpenRouter|same sanctioned|reuse(d|s)? the (embedded|same) browser/i);
  });

  it('documents the anti-bot / CAPTCHA detect-and-stop, no-bypass rule', () => {
    expect(HELP).toMatch(/CAPTCHA|anti(\s|-)bot|login wall|paywall/i);
    expect(HELP).toMatch(/never bypass|does not bypass|do(es)? not (attempt to )?bypass|stop|uncertain/i);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

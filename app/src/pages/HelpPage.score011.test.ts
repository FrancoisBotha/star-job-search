/**
 * Unit tests for the Help page (SCORE-011).
 *
 * The Help page must gain user-facing guidance covering the features delivered
 * by Epic 5 (Job Match Scoring): the 1–5 star match, the 0–100% match, the
 * four factors (skills/experience/location/salary), how to read the per-factor
 * breakdown, that excluded factors are labelled (not zeroed), that scoring is
 * local, deterministic, and fully offline (works with no AI key / no network),
 * how to re-score stale jobs after editing the Profile, the Job-detail
 * breakdown surface, and the Dashboard STRONG / top-matches surfacing.
 *
 * Mirrors the regex-scan precedent of HelpPage.test.ts / HelpPage.llm008.test.ts /
 * HelpPage.extr011.test.ts / HelpPage.cvprof010.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Job match scoring guidance (SCORE-011)', () => {
  it('introduces a dedicated scoring section', () => {
    expect(HELP).toMatch(/match score|match scoring|how scoring works|star score/i);
  });

  it('documents the 1–5 star match and the 0–100% match', () => {
    expect(HELP).toMatch(/1(\s|-|–|—)*to(\s|-|–|—)*5|1(\s|-|–|—)*5|one to five/i);
    expect(HELP).toMatch(/star/i);
    expect(HELP).toMatch(/0(\s|-|–|—)*to(\s|-|–|—)*100|0(\s|-|–|—)*100|percentage|percent/i);
  });

  it('documents the four factors (skills, experience, location, salary)', () => {
    expect(HELP).toMatch(/four factors|4 factors/i);
    expect(HELP).toMatch(/skills/i);
    expect(HELP).toMatch(/experience/i);
    expect(HELP).toMatch(/location/i);
    expect(HELP).toMatch(/salary/i);
  });

  it('explains how to read the per-factor breakdown', () => {
    expect(HELP).toMatch(/breakdown/i);
    expect(HELP).toMatch(/rationale|why|reason/i);
    expect(HELP).toMatch(/bar|weighted|contribution/i);
  });

  it('explains that excluded factors are labelled, not zeroed', () => {
    expect(HELP).toMatch(/exclud/i);
    expect(HELP).toMatch(/labell|labeled|marked/i);
    expect(HELP).toMatch(/not(\s|-)zero|never zero|not as zero|re(\s|-)normalis|re(\s|-)normaliz/i);
  });

  it('documents that scoring is local, deterministic, and fully offline', () => {
    expect(HELP).toMatch(/determinist/i);
    expect(HELP).toMatch(/offline/i);
    expect(HELP).toMatch(/local|on this device/i);
    expect(HELP).toMatch(/no AI key|without an? AI key|no network|no OpenRouter|without OpenRouter/i);
  });

  it('explains how to re-score stale jobs after editing the Profile', () => {
    expect(HELP).toMatch(/re(\s|-)?score/i);
    expect(HELP).toMatch(/stale/i);
    expect(HELP).toMatch(/Profile/);
  });

  it('mentions the Job-detail breakdown surface', () => {
    expect(HELP).toMatch(/job(\s|-)detail/i);
  });

  it('mentions the Dashboard STRONG count and top matches', () => {
    expect(HELP).toMatch(/Dashboard/);
    expect(HELP).toMatch(/STRONG|strong(\s|-)match/i);
    expect(HELP).toMatch(/top(\s|-)match/i);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

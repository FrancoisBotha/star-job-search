/**
 * Unit tests for the Help page (CVPROF-010).
 *
 * The Help page must gain user-facing guidance covering the features delivered
 * by Epic 4 (Add CV to profile): uploading a CV (PDF/DOCX) on onboarding and on
 * the Profile screen, the local off-thread extraction, the LLM-assisted
 * structuring + review/confirm step (gated on an Epic 2 key with a one-time
 * "what is sent" disclosure), the no-key / manual-entry fallback, CV
 * versioning via Replace, the editable + persisted Profile, the
 * profile-strength rubric, and the minimum-scorable gate.
 *
 * Also asserts the architecture doc has been updated for the CV → Profile flow
 * and the first real OpenRouter completion call (epic §13).
 *
 * Mirrors the regex-scan precedent of HelpPage.test.ts / HelpPage.llm008.test.ts /
 * HelpPage.extr011.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');
const ARCH = readFileSync(
  path.join(__dirname, '..', '..', '..', 'docs', 'Architecture', 'Architecture.md'),
  'utf8',
);

describe('HelpPage — CV → Profile guidance (CVPROF-010)', () => {
  it('introduces a dedicated CV & Profile section', () => {
    expect(HELP).toMatch(/CV(\s|&amp;|and)+Profile/i);
  });

  it('documents uploading a PDF or DOCX on onboarding and Profile', () => {
    expect(HELP).toMatch(/PDF/);
    expect(HELP).toMatch(/DOCX/);
    expect(HELP).toMatch(/Onboarding/i);
    expect(HELP).toMatch(/Profile/);
    // drag-drop or file picker affordance
    expect(HELP).toMatch(/drag(-|\s)?(and(-|\s)?)?drop|picker/i);
  });

  it('explains the local, off-thread extraction (file never leaves the device for text extraction)', () => {
    expect(HELP).toMatch(/extract/i);
    expect(HELP).toMatch(/locally|on this device|stays on/i);
    expect(HELP).toMatch(/off(\s|-)the(\s|-)UI(\s|-)thread|responsive|background|without freezing/i);
  });

  it('explains the LLM-assisted structuring plus review/confirm step with low-confidence flags', () => {
    expect(HELP).toMatch(/structur/i);
    expect(HELP).toMatch(/review/i);
    expect(HELP).toMatch(/confirm/i);
    expect(HELP).toMatch(/low(\s|-)confidence|uncertain|flag/i);
  });

  it('covers the one-time "what is sent" disclosure and that structuring needs an Epic 2 key', () => {
    expect(HELP).toMatch(/what(\s|&#39;|')*s sent|what is sent|what we send/i);
    expect(HELP).toMatch(/OpenRouter/);
    expect(HELP).toMatch(/key/i);
  });

  it('describes the no-key / parse-failure manual-entry fallback', () => {
    expect(HELP).toMatch(/manual(\s|-)entry|enter[^.]*manually|fill in[^.]*manually/i);
    expect(HELP).toMatch(/retry|try again|different file/i);
  });

  it('documents CV versioning via Replace', () => {
    expect(HELP).toMatch(/Replace/);
    expect(HELP).toMatch(/version/i);
  });

  it('documents the editable + persisted Profile fields', () => {
    expect(HELP).toMatch(/target role/i);
    expect(HELP).toMatch(/skills/i);
    expect(HELP).toMatch(/work(\s|-)mode/i);
    expect(HELP).toMatch(/salary/i);
    expect(HELP).toMatch(/persist|survives a restart|saved locally/i);
  });

  it('explains the profile-strength rubric and the minimum-scorable gate', () => {
    expect(HELP).toMatch(/profile(\s|-)strength|strength/i);
    expect(HELP).toMatch(/rubric|raises it|what raises|completeness/i);
    expect(HELP).toMatch(/minimum(\s|-)scorable|scorable/i);
    expect(HELP).toMatch(/missing/i);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

describe('Architecture doc — CV → Profile flow (CVPROF-010)', () => {
  it('describes the CV → Profile flow added in Epic 4', () => {
    expect(ARCH).toMatch(/CV.*Profile|Profile.*CV/);
    expect(ARCH).toMatch(/Epic 4|CV to profile|CV\s*→\s*Profile|Add CV to profile/i);
  });

  it('records the first real OpenRouter completion / structured-output call', () => {
    expect(ARCH).toMatch(/OpenRouter/);
    expect(ARCH).toMatch(/completion|structured(\s|-)output|structuring/i);
    expect(ARCH).toMatch(/first/i);
  });

  it('keeps the two-egress boundary intact (no new outbound path)', () => {
    expect(ARCH).toMatch(/two[- ]?egress|exactly two/i);
  });
});

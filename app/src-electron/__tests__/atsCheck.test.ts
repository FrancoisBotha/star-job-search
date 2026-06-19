/**
 * Unit tests for the ATS-check + punctuation-normaliser module (TAILOR-002).
 *
 * The module is a pure, deterministic validator for generated tailoring
 * outputs (CV + cover letter) against the Epic 7 §4 ATS ruleset and exposes
 * the §7 AtsCheck contract.
 *
 * Acceptance-criteria coverage (one focus area per `describe` block):
 *  - AC1 — Per-rule validation of §4 ATS ruleset: single-column layout,
 *          no tables/images/text-in-graphics, recognised section titles in
 *          reverse-chronological order, selectable UTF-8 text, JD-keyword
 *          coverage in summary, role bullets, and skills.
 *  - AC2 — Punctuation normaliser converts smart punctuation and removes
 *          zero-width / non-breaking characters.
 *  - AC3 — checkAts returns AtsCheck[] matching §7 ({ rule, passed, detail? })
 *          AND automatically applies normalisation (punctuation) rather than
 *          only flagging it.
 *  - AC4 — Functions are side-effect-free and contain no LLM/network calls
 *          (verified structurally — pure-function determinism across calls).
 */
import { describe, expect, it } from 'vitest';

import {
  checkAts,
  normalisePunctuation,
  type AtsCheck,
  type AtsReport,
  type CvDocument,
} from '../atsCheck';

// --- fixtures --------------------------------------------------------------

const cleanDoc = (): CvDocument => ({
  text: [
    'SUMMARY',
    'Senior typescript engineer with 7 years building vue platforms.',
    '',
    'EXPERIENCE',
    'Senior Engineer, Cedar Co (2022 - present)',
    '- Led typescript platform team',
    '- Shipped vue design system',
    'Engineer, Lumen Labs (2020 - 2022)',
    '- Built typescript services',
    '',
    'SKILLS',
    'typescript, vue, node',
  ].join('\n'),
  summary: 'Senior typescript engineer with 7 years building vue platforms.',
  experience: [
    {
      role: 'Senior Engineer',
      company: 'Cedar Co',
      startDate: '2022',
      endDate: null,
      bullets: ['Led typescript platform team', 'Shipped vue design system'],
    },
    {
      role: 'Engineer',
      company: 'Lumen Labs',
      startDate: '2020',
      endDate: '2022',
      bullets: ['Built typescript services'],
    },
  ],
  skills: ['typescript', 'vue', 'node'],
  columns: 1,
  hasTables: false,
  hasImages: false,
});

const KEYWORDS = ['typescript', 'vue', 'node'];

function check(report: AtsReport, rule: string): AtsCheck {
  const c = report.checks.find((x) => x.rule === rule);
  if (!c) throw new Error(`rule not found: ${rule}`);
  return c;
}

// --- AC2: punctuation normaliser ------------------------------------------

describe('normalisePunctuation', () => {
  it('converts em-dashes and en-dashes to ASCII hyphen', () => {
    expect(normalisePunctuation('a — b – c − d ― e')).toBe('a - b - c - d - e');
  });

  it('converts smart single and double quotes to straight quotes', () => {
    expect(normalisePunctuation('‘hi’ and “hoi”')).toBe(`'hi' and "hoi"`);
  });

  it('converts the ellipsis character to three dots', () => {
    expect(normalisePunctuation('wait…')).toBe('wait...');
  });

  it('converts arrows and middots to plain text', () => {
    expect(normalisePunctuation('a → b ← c ⇒ d · e • f')).toBe(
      'a -> b <- c => d * e * f',
    );
  });

  it('strips zero-width and BOM characters', () => {
    expect(normalisePunctuation('a​b‌c‍d﻿e')).toBe('abcde');
  });

  it('converts non-breaking and narrow spaces to regular space', () => {
    expect(normalisePunctuation('a b c d')).toBe('a b c d');
  });

  it('is idempotent on already-ASCII text', () => {
    const s = "Plain ASCII text - with 'quotes' and \"more\".";
    expect(normalisePunctuation(s)).toBe(s);
  });

  it('is a pure function (same input always same output)', () => {
    const s = 'a—b‘c’d';
    expect(normalisePunctuation(s)).toBe(normalisePunctuation(s));
  });
});

// --- AC1 + AC3: per-rule ATS report ---------------------------------------

describe('checkAts — report shape (§7 contract)', () => {
  it('returns a checks array of { rule, passed, detail? } items', () => {
    const r = checkAts(cleanDoc(), KEYWORDS);
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks.length).toBeGreaterThan(0);
    for (const c of r.checks) {
      expect(typeof c.rule).toBe('string');
      expect(c.rule.length).toBeGreaterThan(0);
      expect(typeof c.passed).toBe('boolean');
      if (c.detail !== undefined) expect(typeof c.detail).toBe('string');
    }
  });

  it('all rules pass for a clean compliant document', () => {
    const r = checkAts(cleanDoc(), KEYWORDS);
    for (const c of r.checks) {
      expect(c.passed, `${c.rule} failed: ${c.detail ?? ''}`).toBe(true);
    }
  });
});

describe('checkAts — §4 ATS ruleset', () => {
  it('fails the single-column rule when columns > 1', () => {
    const d = cleanDoc();
    d.columns = 2;
    const r = checkAts(d, KEYWORDS);
    expect(check(r, 'layout-single-column').passed).toBe(false);
  });

  it('fails the no-tables-or-graphics rule when tables or images are present', () => {
    const d1 = cleanDoc();
    d1.hasTables = true;
    expect(check(checkAts(d1, KEYWORDS), 'no-tables-or-graphics').passed).toBe(false);

    const d2 = cleanDoc();
    d2.hasImages = true;
    expect(check(checkAts(d2, KEYWORDS), 'no-tables-or-graphics').passed).toBe(false);
  });

  it('fails when a section title is not one of the recognised standard titles', () => {
    const d = cleanDoc();
    d.text = d.text.replace('EXPERIENCE', 'MY JOURNEY');
    const r = checkAts(d, KEYWORDS);
    const c = check(r, 'section-titles-recognised');
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/MY JOURNEY/i);
  });

  it('fails when experience entries are not in reverse-chronological order', () => {
    const d = cleanDoc();
    d.experience = [
      {
        role: 'Engineer',
        company: 'Lumen Labs',
        startDate: '2020',
        endDate: '2022',
        bullets: ['old role first'],
      },
      {
        role: 'Senior Engineer',
        company: 'Cedar Co',
        startDate: '2022',
        endDate: null,
        bullets: ['new role second'],
      },
    ];
    const r = checkAts(d, KEYWORDS);
    expect(check(r, 'experience-reverse-chronological').passed).toBe(false);
  });

  it('fails the selectable-UTF-8 rule when the text contains a replacement character', () => {
    const d = cleanDoc();
    d.text = d.text + '\nGarbled: ��';
    const r = checkAts(d, KEYWORDS);
    expect(check(r, 'selectable-utf8-text').passed).toBe(false);
  });

  it('flags JD-keyword coverage in summary, role bullets, and skills independently', () => {
    const d = cleanDoc();
    d.summary = 'Generic summary with no role-specific terms.';
    d.experience![0]!.bullets = ['Did unrelated things'];
    d.experience![1]!.bullets = ['More unrelated things'];
    d.skills = ['communication', 'leadership'];
    const r = checkAts(d, KEYWORDS);
    expect(check(r, 'keywords-in-summary').passed).toBe(false);
    expect(check(r, 'keywords-in-role-bullets').passed).toBe(false);
    expect(check(r, 'keywords-in-skills').passed).toBe(false);
  });

  it('passes keyword rules when at least one keyword appears in each placement', () => {
    const r = checkAts(cleanDoc(), KEYWORDS);
    expect(check(r, 'keywords-in-summary').passed).toBe(true);
    expect(check(r, 'keywords-in-role-bullets').passed).toBe(true);
    expect(check(r, 'keywords-in-skills').passed).toBe(true);
  });
});

// --- AC3: auto-fix (punctuation normalised, not only flagged) -------------

describe('checkAts — auto-normalisation', () => {
  it('returns a normalisedDoc whose text has smart punctuation replaced', () => {
    const d = cleanDoc();
    d.text = `Smart “quote” and em—dash…`;
    d.summary = `“smart” vue and typescript`;
    const r = checkAts(d, KEYWORDS);
    expect(r.normalisedDoc.text).not.toContain('“');
    expect(r.normalisedDoc.text).not.toContain('”');
    expect(r.normalisedDoc.text).not.toContain('—');
    expect(r.normalisedDoc.text).not.toContain('…');
    expect(r.normalisedDoc.text).toContain('"quote"');
    expect(r.normalisedDoc.text).toContain('em-dash...');
    expect(r.normalisedDoc.summary).toContain('"smart"');
  });

  it('selectable-utf8-text rule evaluates the NORMALISED text so zero-width chars do not fail it', () => {
    const d = cleanDoc();
    d.text = d.text.replace('SUMMARY', 'SUM​MARY');
    const r = checkAts(d, KEYWORDS);
    expect(check(r, 'selectable-utf8-text').passed).toBe(true);
    expect(r.normalisedDoc.text).not.toContain('​');
  });
});

// --- AC4: purity / determinism --------------------------------------------

describe('checkAts — purity', () => {
  it('does not mutate the input document', () => {
    const d = cleanDoc();
    d.text = `mut — ate`;
    const before = JSON.parse(JSON.stringify(d));
    checkAts(d, KEYWORDS);
    expect(d).toEqual(before);
  });

  it('is deterministic across repeated calls (same input → same output)', () => {
    const a = checkAts(cleanDoc(), KEYWORDS);
    const b = checkAts(cleanDoc(), KEYWORDS);
    expect(b).toEqual(a);
  });
});

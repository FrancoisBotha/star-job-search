/**
 * Unit tests for refine.ts (TDE-003, AC2-5).
 */
import { describe, expect, it } from 'vitest';

import {
  analyzeGaps,
  checkMasterAlignment,
  inventedMetricsWarnings,
  removeAiPhrases,
  wordCountBlowupWarnings,
} from '../refine.js';

describe('analyzeGaps (AC2)', () => {
  const masterText = 'Built distributed systems in Kubernetes and Kafka. Wrote Python ETLs.';
  const jdText =
    'We need Kubernetes, Kafka, Rust, and Terraform experience. Bonus: Snowflake.';

  it('classifies JD keywords present in master CV as injectable', () => {
    const r = analyzeGaps(jdText, masterText, '');
    expect(r.injectable).toEqual(expect.arrayContaining(['Kubernetes', 'Kafka']));
  });

  it('classifies JD keywords absent from master CV as non-injectable (flagged)', () => {
    const r = analyzeGaps(jdText, masterText, '');
    expect(r.nonInjectable).toEqual(expect.arrayContaining(['Rust', 'Terraform', 'Snowflake']));
  });

  it('does not flag a JD keyword that is already in the current tailored text', () => {
    const r = analyzeGaps(jdText, masterText, 'I use Kubernetes daily.');
    expect(r.injectable).not.toContain('Kubernetes');
  });

  it('never returns the same keyword in both injectable and non-injectable', () => {
    const r = analyzeGaps(jdText, masterText, '');
    const inj = new Set(r.injectable);
    for (const k of r.nonInjectable) expect(inj.has(k)).toBe(false);
  });
});

describe('removeAiPhrases (AC3)', () => {
  it('replaces blacklist filler phrases with plainer wording', () => {
    const out = removeAiPhrases('I leveraged synergies to deliver results.', '');
    expect(out).not.toMatch(/leveraged/i);
    expect(out).not.toMatch(/synergies/i);
  });

  it('NEVER alters a blacklisted term that appears verbatim in the JD', () => {
    const jd = 'You will leverage cross-team synergies.';
    const input = 'I leveraged synergies across teams.';
    const out = removeAiPhrases(input, jd);
    expect(out.toLowerCase()).toContain('leverage');
    expect(out.toLowerCase()).toContain('synerg');
  });

  it('is local / deterministic (no LLM): same input → same output', () => {
    const a = removeAiPhrases('I leveraged a robust solution.', '');
    const b = removeAiPhrases('I leveraged a robust solution.', '');
    expect(a).toBe(b);
  });
});

describe('checkMasterAlignment (AC4)', () => {
  const master = {
    skills: ['TypeScript'],
    employers: ['Acme Co'],
    certs: ['AWS Solutions Architect'],
    text: 'I worked at Acme Co. AWS Solutions Architect (2022).',
  };
  const jd = 'Looking for TypeScript and Postgres.';

  it('passes when skill/cert/employer is present in master CV', () => {
    expect(checkMasterAlignment('TypeScript', 'skill', master, jd).ok).toBe(true);
    expect(checkMasterAlignment('Acme Co', 'employer', master, jd).ok).toBe(true);
    expect(checkMasterAlignment('AWS Solutions Architect', 'cert', master, jd).ok).toBe(true);
  });

  it('passes (info-level) when item is in JD but absent from master CV', () => {
    const r = checkMasterAlignment('Postgres', 'skill', master, jd);
    expect(r.ok).toBe(true);
    expect(r.level).toBe('info');
    expect(r.note).toBeTruthy();
  });

  it('blocks (critical) when item is absent from both master CV and JD', () => {
    const r = checkMasterAlignment('Kotlin', 'skill', master, jd);
    expect(r.ok).toBe(false);
    expect(r.level).toBe('critical');
  });

  it('blocks an invented employer not in master CV', () => {
    const r = checkMasterAlignment('Google', 'employer', master, jd);
    expect(r.ok).toBe(false);
    expect(r.level).toBe('critical');
  });

  it('blocks an invented certification not in master CV', () => {
    const r = checkMasterAlignment('PMP', 'cert', master, jd);
    expect(r.ok).toBe(false);
    expect(r.level).toBe('critical');
  });
});

describe('inventedMetricsWarnings (AC5)', () => {
  it('warns when proposed text introduces a number not in the original', () => {
    const w = inventedMetricsWarnings('I led migration.', 'I led migration of 40 services.');
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]!.kind).toBe('invented_metric');
    expect(w[0]!.value).toContain('40');
  });

  it('does not warn when the number appeared in the original', () => {
    const w = inventedMetricsWarnings('Cut latency by 40%.', 'Reduced latency by 40% across services.');
    expect(w).toEqual([]);
  });

  it('handles percentages, decimals, and unit-suffixed numbers', () => {
    const w = inventedMetricsWarnings('Built it.', 'Saved 1.5M and shipped 200k req/s.');
    const vals = w.map((x) => x.value).join(' ');
    expect(vals).toMatch(/1\.5M/);
    expect(vals).toMatch(/200k/);
  });
});

describe('wordCountBlowupWarnings (AC5)', () => {
  it('warns when proposed text is substantially longer than original', () => {
    const original = 'Led migration.';
    const proposed =
      'Led the strategic enterprise-grade migration of the legacy monolithic platform to a modern resilient set of microservices across multiple regions.';
    const w = wordCountBlowupWarnings(original, proposed);
    expect(w.length).toBeGreaterThan(0);
    expect(w[0]!.kind).toBe('word_count_blowup');
  });

  it('does not warn when proposed text is similar length', () => {
    const w = wordCountBlowupWarnings('Led migration of monolith.', 'Migrated the monolith.');
    expect(w).toEqual([]);
  });
});

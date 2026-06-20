/**
 * Unit tests for enrichmentGenerate.ts (ENRICH-003 — Epic 13: CV Enrichment).
 *
 * AC1 — generates ProposedChange diffs (X-Y-Z / condensed-STAR), grounded
 *       ONLY in existing CV content reworded or the user's answers.
 * AC2 — passes Epic 9 four gates (identity, employers, dates, institutions
 *       and degrees frozen).
 * AC3 — answer-provenance metric gate: a new number is accepted ONLY if it
 *       traces to a user-provided answer (or already exists in the CV);
 *       any other added number is rejected.
 * AC4 — each proposed change carries path + reason + provenance + gate
 *       verdict.
 * AC5 — a skipped / 'no number' item yields at most a minimal rewording
 *       with no fabricated metric.
 * AC6 — pure gate logic is unit-tested (this file).
 */
import { describe, expect, it } from 'vitest';

import type { CvParsedFields } from '../cvStructurer.js';
import { buildTailoringDocument, type TailoringDocument } from '../tailoringDocument.js';
import type { MetricAnswer, MetricQuestion } from '../metricQuestionGenerator.js';
import type { WeakBulletCandidate } from '../weakBulletAnalyzer.js';
import {
  answerProvenanceGate,
  extractNumberTokens,
  generateEnrichment,
} from '../enrichmentGenerate.js';

const PARSED: CvParsedFields = {
  name: 'Alex Morgan',
  contact: { email: 'alex@example.com', phone: '+44 7000 000000' },
  targetRole: 'Senior Engineer',
  skills: ['TypeScript', 'Node.js'],
  employmentHistory: [
    {
      company: 'Acme Co',
      role: 'Staff Engineer',
      startDate: '2022-01',
      endDate: '2026-01',
      summary:
        '- Worked on the data ingestion pipeline\n- Responsible for the migration project\n- Helped with the rebuild of the dashboard',
    },
  ],
  education: [
    {
      school: 'Some University',
      qualification: 'BSc Computer Science',
      startDate: '2014',
      endDate: '2017',
    },
  ],
  totalYearsExperience: 10,
  location: 'London, UK',
};

function makeDoc(): TailoringDocument {
  return buildTailoringDocument(PARSED, '');
}

function cand(
  path: string,
  text: string,
  signals: WeakBulletCandidate['signals'],
): WeakBulletCandidate {
  return { path, text, signals, reason: signals.join('; ') };
}

function q(id: string, path: string, bulletText: string): MetricQuestion {
  return { id, path, bulletText, kind: 'outcome', question: '...' };
}

// ---------------------------------------------------------------------------
// AC3 — answer-provenance gate (pure logic)
// ---------------------------------------------------------------------------

describe('answerProvenanceGate (AC3, AC6)', () => {
  it('extracts numeric tokens from text (digits, %, $ amounts, k/m/b)', () => {
    expect(extractNumberTokens('Reduced p95 latency by 40% across 250k users.')).toEqual(
      expect.arrayContaining(['40', '40%', '250k', '250000']),
    );
    expect(extractNumberTokens('No metrics here.')).toEqual([]);
  });

  it('accepts a new number that traces to an answer', () => {
    const verdict = answerProvenanceGate({
      originalText: 'Worked on the data ingestion pipeline.',
      rewrittenText: 'Built data ingestion pipeline serving 250k users.',
      answerCorpus: '250k users',
      docCorpus: '',
    });
    expect(verdict.ok).toBe(true);
  });

  it('accepts a number already in the CV (docCorpus)', () => {
    const verdict = answerProvenanceGate({
      originalText: 'Mentored engineers.',
      rewrittenText: 'Mentored 5 engineers on the platform team.',
      answerCorpus: '',
      docCorpus: 'Mentored 5 engineers',
    });
    expect(verdict.ok).toBe(true);
  });

  it('rejects an invented number not in the answer or CV', () => {
    const verdict = answerProvenanceGate({
      originalText: 'Worked on the rebuild of the dashboard.',
      rewrittenText: 'Rebuilt the dashboard, increasing engagement by 35%.',
      answerCorpus: '',
      docCorpus: '',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/provenance|untraceable|invented/i);
  });

  it('passes through when no new numbers are added (pure rewording)', () => {
    const verdict = answerProvenanceGate({
      originalText: 'Worked on the data ingestion pipeline.',
      rewrittenText: 'Built and shipped the data ingestion pipeline.',
      answerCorpus: '',
      docCorpus: '',
    });
    expect(verdict.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC1, AC4, AC5 — generateEnrichment end-to-end with a stub LLM
// ---------------------------------------------------------------------------

describe('generateEnrichment (AC1, AC4, AC5)', () => {
  it('grounds added metrics in user answers and emits provenance + gate verdict', async () => {
    const doc = makeDoc();
    const candidates = [
      cand('experience[0].bullets[0]', doc.experience[0]!.bullets[0]!, ['generic_verb', 'no_metric']),
    ];
    const questions = [q('mq_1', 'experience[0].bullets[0]', doc.experience[0]!.bullets[0]!)];
    const answers: MetricAnswer[] = [
      { questionId: 'mq_1', status: 'answered', value: '250k users' },
    ];
    const result = await generateEnrichment({
      doc,
      candidates,
      questions,
      answers,
      llm: {
        rewriteBullet: async () =>
          'Built data ingestion pipeline serving 250k users across the platform.',
      },
    });
    expect(result.proposals.length).toBe(1);
    const p = result.proposals[0]!;
    expect(p.change.path).toBe('experience[0].bullets[0]');
    expect(p.change.action).toBe('replace');
    expect(p.provenance).toMatch(/250k|users/i);
    expect(p.gateVerdict.ok).toBe(true);
    expect(p.reason.length).toBeGreaterThan(0);
    expect(result.applied.length).toBe(1);
  });

  it('AC5 — skipped/no-number items yield a minimal reword with no fabricated metric', async () => {
    const doc = makeDoc();
    const candidates = [
      cand('experience[0].bullets[0]', doc.experience[0]!.bullets[0]!, ['generic_verb', 'no_metric']),
    ];
    const questions = [q('mq_1', 'experience[0].bullets[0]', doc.experience[0]!.bullets[0]!)];
    const answers: MetricAnswer[] = [{ questionId: 'mq_1', status: 'skipped' }];
    const result = await generateEnrichment({
      doc,
      candidates,
      questions,
      answers,
      llm: {
        // Even if the LLM tries to invent a number, the provenance gate strips it.
        rewriteBullet: async () =>
          'Built the data ingestion pipeline, lifting throughput by 30%.',
      },
    });
    // Either the proposal was downgraded to a minimal reword (no new digits)
    // OR the provenance-violating proposal was rejected.
    for (const p of result.proposals) {
      if (p.gateVerdict.ok) {
        // Any digits in the rewritten text must already trace to original or CV.
        const verdict = answerProvenanceGate({
          originalText: doc.experience[0]!.bullets[0]!,
          rewrittenText: p.change.value as string,
          answerCorpus: '',
          docCorpus: '',
        });
        expect(verdict.ok).toBe(true);
      }
    }
    // It must not blindly apply a fabricated-metric change.
    for (const a of result.applied) {
      expect(typeof a.value).toBe('string');
      // No invented percentage like 30% should survive.
      expect(/\b30%\b/.test(a.value as string)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AC2 — frozen / Epic 9 gates are still enforced
// ---------------------------------------------------------------------------

describe('generateEnrichment — Epic 9 gates (AC2)', () => {
  it('rejects a proposed change targeting a frozen field (identity.name)', async () => {
    const doc = makeDoc();
    const candidates = [cand('identity.name', 'Alex Morgan', ['no_metric'])];
    const questions = [q('mq_1', 'identity.name', 'Alex Morgan')];
    const answers: MetricAnswer[] = [
      { questionId: 'mq_1', status: 'answered', value: 'Alex M.' },
    ];
    const result = await generateEnrichment({
      doc,
      candidates,
      questions,
      answers,
      llm: { rewriteBullet: async () => 'Alex M.' },
    });
    expect(result.applied.length).toBe(0);
    expect(result.proposals.every((p) => !p.gateVerdict.ok)).toBe(true);
  });

  it('rejects an edit to experience[i].company (employer is frozen)', async () => {
    const doc = makeDoc();
    const candidates = [cand('experience[0].company', 'Acme Co', ['no_metric'])];
    const questions = [q('mq_1', 'experience[0].company', 'Acme Co')];
    const answers: MetricAnswer[] = [
      { questionId: 'mq_1', status: 'answered', value: 'Acme Corp' },
    ];
    const result = await generateEnrichment({
      doc,
      candidates,
      questions,
      answers,
      llm: { rewriteBullet: async () => 'Acme Corp' },
    });
    expect(result.applied.length).toBe(0);
  });
});

/**
 * Epic-level holistic acceptance verification (ENRICH-007 — Epic 13: CV
 * Enrichment).
 *
 * This file re-verifies every preceding ENRICH-001..006 criterion against the
 * SHIPPED implementation (not via per-ticket unit tests, which can drift),
 * plus the epic-level §10 "airtight answer-provenance grounding" guarantee.
 *
 * Each describe block is anchored to a single ticket / criterion. Failures
 * are read as "the implementation no longer satisfies the criterion" rather
 * than as a regression of any one source file.
 */
import { describe, expect, it } from 'vitest';

import type { CvParsedFields } from '../cvStructurer.js';
import {
  buildTailoringDocument,
  type TailoringDocument,
} from '../tailoringDocument.js';
import {
  analyzeWeakBullets,
  findWeakBulletCandidates,
  hasGenericVerb,
  hasNoMetric,
  hasNoScope,
  isPassiveVoice,
  type WeakBulletCandidate,
  type WeakBulletLLM,
} from '../weakBulletAnalyzer.js';
import {
  buildDeterministicQuestions,
  generateMetricQuestions,
  isAnswerUsable,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  type MetricAnswer,
  type MetricQuestion,
  type MetricQuestionLLM,
} from '../metricQuestionGenerator.js';
import {
  answerProvenanceGate,
  extractNumberTokens,
  generateEnrichment,
  minimalReword,
} from '../enrichmentGenerate.js';
import {
  applyEnrichment,
  computeApplyKey,
  ENRICHMENT_APPLY_KEY_FIELD,
  type CvVersionWriter,
  type EnrichmentBaseCvRecord,
  type EnrichmentNewCvRecord,
  type EnrichmentStaleHooks,
  type ProfileWriter,
} from '../enrichmentApply.js';
import {
  ENRICH_ANALYZE_CHANNEL,
  ENRICH_APPLY_CHANNEL,
  ENRICH_PROPOSE_CHANNEL,
  ENRICH_QUESTIONS_CHANNEL,
} from '../enrichmentIpc.js';
import type { ProposedChange } from '../tailorGates.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
        '- Worked on the data ingestion pipeline\n- Responsible for the migration project\n- Helped with the rebuild of the dashboard\n- Mentored 5 engineers and shipped the platform rewrite',
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

// ---------------------------------------------------------------------------
// ENRICH-001 — Weak-bullet analyzer
// ---------------------------------------------------------------------------

describe('ENRICH-001 AC1/AC6 — deterministic signal pass detects weak bullets', () => {
  it('flags generic verbs, missing metrics, passive voice, missing scope', () => {
    expect(hasGenericVerb('Responsible for the platform rewrite.')).toBe(true);
    expect(hasGenericVerb('Led the platform rewrite.')).toBe(false);
    expect(hasNoMetric('Built a new pipeline.')).toBe(true);
    expect(hasNoMetric('Built a pipeline serving 250 users.')).toBe(false);
    expect(isPassiveVoice('The dashboard was deployed by the team.')).toBe(true);
    expect(hasNoScope('Worked on things.')).toBe(true);
    expect(hasNoScope('Led a team of 5 engineers.')).toBe(false);
  });

  it('walks experience + projects bullets and produces addressable paths', () => {
    const doc = makeDoc();
    const cands = findWeakBulletCandidates(doc);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.path).toMatch(/^(experience|projects)\[\d+\]\.bullets\[\d+\]$/);
      expect(c.signals.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('ENRICH-001 AC4 — conservative: strong bullets are never flagged', () => {
  it('a bullet that fires no signal is omitted entirely', () => {
    const cands = findWeakBulletCandidates(makeDoc());
    // The 4th bullet ("Mentored 5 engineers and shipped the platform rewrite")
    // has an outcome verb, a number, and named scope — must not be flagged.
    const flaggedTexts = cands.map((c) => c.text);
    expect(
      flaggedTexts.some((t) => t.includes('Mentored 5 engineers and shipped')),
    ).toBe(false);
  });
});

describe('ENRICH-001 AC2 — LLM ranking pass cannot invent paths', () => {
  it('silently discards invented paths returned by the LLM', async () => {
    const doc = makeDoc();
    const llm: WeakBulletLLM = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          prioritized: [
            // One real path, one invented — invented must be discarded.
            { path: 'experience[0].bullets[0]', reason: 'refined' },
            { path: 'identity.name', reason: 'invented' },
          ],
        }),
      }),
    };
    const report = await analyzeWeakBullets({ doc, llm });
    for (const item of report.items) {
      expect(item.path).toMatch(/^experience\[\d+\]\.bullets\[\d+\]$/);
    }
  });
});

describe('ENRICH-001 AC5 — anti-injection framing', () => {
  it('the prompt builder frames bullet text as untrusted data', async () => {
    // Black-box: exercise the LLM hook with a candidate whose text would be
    // an injection attempt. The candidate's text is forwarded as data, never
    // as instruction — the structured-output schema guarantees it.
    const llm: WeakBulletLLM = {
      withStructuredOutput: () => ({
        invoke: async (input) => {
          const s = typeof input === 'string' ? input : JSON.stringify(input);
          // The prompt must mark the candidate block as untrusted.
          expect(s).toMatch(/UNTRUSTED|untrusted/);
          return { prioritized: [] };
        },
      }),
    };
    const doc = makeDoc();
    await analyzeWeakBullets({ doc, llm });
  });
});

// ---------------------------------------------------------------------------
// ENRICH-002 — Metric question generator
// ---------------------------------------------------------------------------

describe('ENRICH-002 AC1/AC2 — generates between MIN and MAX questions for weak items', () => {
  it('caps at MAX_QUESTIONS and respects MIN_QUESTIONS floor', async () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      cand(`experience[0].bullets[${i}]`, `Worked on thing ${i}.`, [
        'generic_verb',
        'no_metric',
      ]),
    );
    const qq = buildDeterministicQuestions(items);
    expect(qq.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(qq.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
  });

  it('returns no questions when there are fewer than MIN candidates', () => {
    const qq = buildDeterministicQuestions([
      cand('experience[0].bullets[0]', 'Worked on a thing.', ['generic_verb']),
    ]);
    expect(qq).toEqual([]);
  });
});

describe('ENRICH-002 AC4/AC5 — questions never demand estimates; skip is first-class', () => {
  it('no question template uses estimate/approximate/guess/ballpark language', () => {
    const items = [
      cand('experience[0].bullets[0]', 'Helped with onboarding.', [
        'generic_verb',
        'no_metric',
      ]),
      cand('experience[0].bullets[1]', 'Was deployed weekly.', [
        'passive_voice',
        'no_metric',
      ]),
      cand('experience[0].bullets[2]', 'Worked on rollouts.', [
        'generic_verb',
        'no_scope',
      ]),
    ];
    const qq = buildDeterministicQuestions(items);
    for (const q of qq) {
      expect(q.question).not.toMatch(
        /\b(estimate|approximate|approx\.|guess|ballpark|roughly|guesstimate)\b/i,
      );
      // Each must offer a skip path.
      expect(q.question).toMatch(/skip/i);
    }
  });

  it('isAnswerUsable rejects empty and "no number" placeholder answers', () => {
    expect(isAnswerUsable({ questionId: 'a', status: 'skipped' })).toBe(false);
    expect(
      isAnswerUsable({ questionId: 'a', status: 'answered', value: '   ' }),
    ).toBe(false);
    expect(
      isAnswerUsable({ questionId: 'a', status: 'answered', value: 'n/a' }),
    ).toBe(false);
    expect(
      isAnswerUsable({ questionId: 'a', status: 'answered', value: "don't know" }),
    ).toBe(false);
    expect(
      isAnswerUsable({ questionId: 'a', status: 'answered', value: '250k users' }),
    ).toBe(true);
  });
});

describe('ENRICH-002 AC3 — LLM pass cannot invent paths and is hard-capped', () => {
  it('drops invented paths and caps at MAX_QUESTIONS', async () => {
    const items = Array.from({ length: 4 }, (_, i) =>
      cand(`experience[0].bullets[${i}]`, `Worked on thing ${i}.`, [
        'generic_verb',
        'no_metric',
      ]),
    );
    const llm: MetricQuestionLLM = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          questions: [
            {
              id: 'q1',
              path: 'experience[0].bullets[0]',
              kind: 'outcome',
              question: 'What real outcome? Skip if you don\'t have a number.',
            },
            {
              id: 'q2',
              path: 'identity.name', // INVENTED
              kind: 'outcome',
              question: 'Bogus. Skip if unsure.',
            },
            ...Array.from({ length: MAX_QUESTIONS + 3 }, (_, i) => ({
              id: `q${i + 3}`,
              path: `experience[0].bullets[${(i % items.length)}]`,
              kind: 'outcome' as const,
              question: 'Another. Skip if you don\'t have a number.',
            })),
          ],
        }),
      }),
    };
    const out = await generateMetricQuestions({
      report: { items },
      llm,
    });
    expect(out.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    for (const q of out.questions) {
      expect(q.path).not.toBe('identity.name');
    }
  });
});

// ---------------------------------------------------------------------------
// ENRICH-003 — Grounded enrichment + answer-provenance gate
// ---------------------------------------------------------------------------

describe('ENRICH-003 AC3 / Epic §10 — airtight answer-provenance grounding', () => {
  it('extracts numeric tokens including raw, percent, currency, k/m/b expansions', () => {
    const toks = extractNumberTokens('Saved $1.2m, cut latency by 40%, and reached 250k users.');
    expect(toks).toEqual(
      expect.arrayContaining(['1.2', '$1.2', '40', '40%', '250', '250k', '250000']),
    );
  });

  it('accepts numbers grounded in the user answer', () => {
    const v = answerProvenanceGate({
      originalText: 'Worked on the data ingestion pipeline.',
      rewrittenText: 'Built pipeline serving 250k users.',
      answerCorpus: '250k users',
      docCorpus: '',
    });
    expect(v.ok).toBe(true);
  });

  it('accepts numbers grounded in the existing CV (docCorpus)', () => {
    const v = answerProvenanceGate({
      originalText: 'Mentored engineers.',
      rewrittenText: 'Mentored 5 engineers.',
      answerCorpus: '',
      docCorpus: 'Mentored 5 engineers',
    });
    expect(v.ok).toBe(true);
  });

  it('REJECTS untraceable / invented numbers — never estimated, never invented', () => {
    const v = answerProvenanceGate({
      originalText: 'Rebuilt the dashboard.',
      rewrittenText: 'Rebuilt the dashboard, lifting engagement 35%.',
      answerCorpus: '',
      docCorpus: '',
    });
    expect(v.ok).toBe(false);
    expect(v.untraceable).toContain('35');
  });
});

describe('ENRICH-003 AC5 — skipped/no-number items fall back to minimal reword', () => {
  it('downgrades to a deterministic active-verb reword with no fabricated metric', async () => {
    const doc = makeDoc();
    const c = cand(
      'experience[0].bullets[0]',
      doc.experience[0]!.bullets[0]!,
      ['generic_verb', 'no_metric'],
    );
    const q: MetricQuestion = {
      id: 'mq_1',
      path: c.path,
      bulletText: c.text,
      kind: 'outcome',
      question: '...',
    };
    const answers: MetricAnswer[] = [{ questionId: 'mq_1', status: 'skipped' }];
    const result = await generateEnrichment({
      doc,
      candidates: [c],
      questions: [q],
      answers,
      // LLM tries to smuggle in a number — the provenance gate must strip it.
      llm: {
        rewriteBullet: async () =>
          'Built the data ingestion pipeline, lifting throughput 30%.',
      },
    });
    expect(result.proposals.length).toBe(1);
    const p = result.proposals[0]!;
    if (p.gateVerdict.ok) {
      // The proposal made it through — it MUST be the minimal reword (no new
      // digit relative to the original text).
      const newDigits = extractNumberTokens(p.change.value as string).filter(
        (n) => !extractNumberTokens(c.text).includes(n),
      );
      expect(newDigits).toEqual([]);
      expect(p.provenance).toMatch(/minimal reword|no fabricated metric/i);
    } else {
      // Or it was rejected outright. Either is a valid AC5 outcome — what is
      // forbidden is a passed proposal that contains an invented number.
      expect(p.gateVerdict.reason).toMatch(/provenance|untraceable|invented|no rewrite/i);
    }
  });

  it('minimalReword swaps weak verbs and never adds digits', () => {
    const out = minimalReword('Responsible for the migration project.');
    expect(out).not.toBe('Responsible for the migration project.');
    expect(/\d/.test(out)).toBe(false);
  });
});

describe('ENRICH-003 AC2 — Epic 9 four gates block frozen-field edits', () => {
  it('a proposal targeting identity.name is rejected without reaching apply', async () => {
    const doc = makeDoc();
    const c = cand('identity.name', 'Alex Morgan', ['generic_verb']);
    const q: MetricQuestion = {
      id: 'mq_1',
      path: c.path,
      bulletText: c.text,
      kind: 'outcome',
      question: '...',
    };
    const answers: MetricAnswer[] = [
      { questionId: 'mq_1', status: 'answered', value: 'Hacker' },
    ];
    const result = await generateEnrichment({
      doc,
      candidates: [c],
      questions: [q],
      answers,
      llm: { rewriteBullet: async () => 'Hacker' },
    });
    expect(result.applied.length).toBe(0);
    expect(result.proposals[0]?.gateVerdict.ok).toBe(false);
    expect(result.proposals[0]?.gateVerdict.reason).toMatch(/frozen/i);
  });
});

// ---------------------------------------------------------------------------
// ENRICH-004 — Versioned apply, profile re-derive, stale hooks, dedup
// ---------------------------------------------------------------------------

function makeWriter(initial: EnrichmentBaseCvRecord): {
  writer: CvVersionWriter;
  rows: EnrichmentBaseCvRecord[];
} {
  const rows: EnrichmentBaseCvRecord[] = [initial];
  const writer: CvVersionWriter = {
    latest(profileId?: string) {
      const filtered = rows.filter((r) =>
        profileId ? r.profileId === profileId : true,
      );
      if (filtered.length === 0) return null;
      return [...filtered].sort((a, b) => b.version - a.version)[0] ?? null;
    },
    create(input) {
      const next: EnrichmentNewCvRecord = {
        id: `cv_${rows.length + 1}`,
        profileId: input.profileId,
        version: Math.max(...rows.map((r) => r.version)) + 1,
        parsedText: input.parsedText,
        parsedFields: input.parsedFields,
        uploadedAt: 1000 + rows.length,
      };
      rows.push({
        id: next.id,
        profileId: next.profileId,
        version: next.version,
        parsedText: next.parsedText,
        parsedFields: next.parsedFields,
      });
      return next;
    },
  };
  return { writer, rows };
}

function makeProfileWriter(): { writer: ProfileWriter; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    writer: { save: (input) => calls.push(input) },
    calls,
  };
}

function makeHooks(): { hooks: EnrichmentStaleHooks; counts: Record<string, number> } {
  const counts: Record<string, number> = {
    markScoresStale: 0,
    markReviewsStale: 0,
    markEvalReportsStale: 0,
    markTailoredDocsStale: 0,
  };
  return {
    hooks: {
      markScoresStale: () => void counts.markScoresStale!++,
      markReviewsStale: () => void counts.markReviewsStale!++,
      markEvalReportsStale: () => void counts.markEvalReportsStale!++,
      markTailoredDocsStale: () => void counts.markTailoredDocsStale!++,
    },
    counts,
  };
}

describe('ENRICH-004 AC1/AC2/AC3 — apply writes new version, re-derives profile, fires stale hooks', () => {
  it('produces a v+1 CV row, re-derives parsedFields, and flips the caches stale', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].bullets[0]',
      action: 'replace',
      original: doc.experience[0]!.bullets[0]!,
      value: 'Owned the data ingestion pipeline.',
      reason: 'reword',
    };
    const { writer, rows } = makeWriter({
      id: 'cv_1',
      profileId: 'profile_main',
      version: 1,
      parsedFields: PARSED as unknown as Record<string, unknown>,
      parsedText: 'base text',
    });
    const { writer: profileWriter, calls } = makeProfileWriter();
    const { hooks, counts } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.created).toBe(true);
    expect(rows.length).toBe(2);
    expect(rows[1]!.version).toBe(2);
    expect(calls.length).toBe(1);
    expect(counts.markScoresStale).toBe(1);
    expect(counts.markReviewsStale).toBe(1);
  });
});

describe('ENRICH-004 AC4 — dedup on identical accepted set', () => {
  it('re-applying the same change does NOT create a duplicate version or double-fire hooks', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].bullets[1]',
      action: 'replace',
      original: doc.experience[0]!.bullets[1]!,
      value: 'Owned the migration project.',
      reason: 'reword',
    };
    const baseFields: Record<string, unknown> = {
      ...(PARSED as unknown as Record<string, unknown>),
      [ENRICHMENT_APPLY_KEY_FIELD]: computeApplyKey('cv_1', [change]),
    };
    const { writer, rows } = makeWriter({
      id: 'cv_1',
      profileId: 'profile_main',
      version: 1,
      parsedFields: baseFields,
      parsedText: 'base',
    });
    const { writer: profileWriter, calls } = makeProfileWriter();
    const { hooks, counts } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.created).toBe(false);
    expect(rows.length).toBe(1);
    expect(calls.length).toBe(0);
    expect(counts.markScoresStale).toBe(0);
    expect(counts.markReviewsStale).toBe(0);
  });
});

describe('ENRICH-004 AC5 — Epic 9 rejections never reach the new version', () => {
  it('a frozen-field change is dropped even if "accepted"', () => {
    const doc = makeDoc();
    const frozen: ProposedChange = {
      path: 'identity.name',
      action: 'replace',
      original: 'Alex Morgan',
      value: 'Hacker',
      reason: 'should be blocked',
    };
    const { writer } = makeWriter({
      id: 'cv_1',
      profileId: 'profile_main',
      version: 1,
      parsedFields: PARSED as unknown as Record<string, unknown>,
      parsedText: '',
    });
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: [frozen] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.applied.length).toBe(0);
    expect(r.rejected.length).toBe(1);
    // Identity is unchanged in the resulting doc.
    expect(r.result.identity.name).toBe('Alex Morgan');
  });
});

// ---------------------------------------------------------------------------
// ENRICH-005 — IPC channels exist with the documented names and error union
// ---------------------------------------------------------------------------

describe('ENRICH-005 AC1 — the four enrich:* IPC channels are exported with stable names', () => {
  it('channels match the contract documented in the preload bridge', () => {
    expect(ENRICH_ANALYZE_CHANNEL).toBe('enrich:analyze');
    expect(ENRICH_QUESTIONS_CHANNEL).toBe('enrich:questions');
    expect(ENRICH_PROPOSE_CHANNEL).toBe('enrich:propose');
    expect(ENRICH_APPLY_CHANNEL).toBe('enrich:apply');
  });
});

// ---------------------------------------------------------------------------
// ENRICH-006 — Three-step UI exists with the right disabled / loading / error
// surfaces. Verified statically (no DOM mount needed) to keep this fast.
// ---------------------------------------------------------------------------

describe('ENRICH-006 — UI surfaces every required state', () => {
  it('the enrichment page renders the three documented steps with provenance + gate slots', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const PAGE = readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'pages', 'EnrichPage.vue'),
      'utf8',
    );
    // Stepper with the three named steps.
    expect(PAGE).toMatch(/Analyze/);
    expect(PAGE).toMatch(/Questions/);
    expect(PAGE).toMatch(/Review/);
    // Disabled states for "no CV" and "no key".
    expect(PAGE).toMatch(/enrich-no-cv/);
    expect(PAGE).toMatch(/enrich-no-key/);
    // Per-step loading + error surfaces.
    expect(PAGE).toMatch(/enrich-analyze-loading/);
    expect(PAGE).toMatch(/enrich-error/);
    // Step 2 — answer input + explicit skip control.
    expect(PAGE).toMatch(/enrich-answer-input/);
    expect(PAGE).toMatch(/enrich-skip/);
    expect(PAGE).toMatch(/enrich-skipped-hint/);
    // Step 3 — provenance + gate verdict surfaced per proposal.
    expect(PAGE).toMatch(/enrich-provenance/);
    expect(PAGE).toMatch(/enrich-gate-warning/);
  });
});

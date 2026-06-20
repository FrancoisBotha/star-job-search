/**
 * Epic 13 (CV Enrichment) behavioural regression suite — ENRICH-008.
 *
 * Per-ticket tests cover each layer in isolation (`weakBulletAnalyzer.test.ts`,
 * `metricQuestionGenerator.test.ts`, `enrichmentGenerate.test.ts`,
 * `enrichmentApply.test.ts`, `enrichmentIpc.test.ts`, `EnrichPage.enrich006.test.ts`).
 * The `epic-acceptance.enrich007.test.ts` re-verifies each ENRICH-001..006
 * criterion against the shipped implementation.
 *
 * This file complements both by exercising the EPIC'S key user-facing
 * behaviours end-to-end through the REAL modules — the real
 * `findWeakBulletCandidates`, the real `buildDeterministicQuestions`, the real
 * `generateEnrichment`, the real `applyEnrichment` — driven by realistic CV
 * fixtures. No mocks for anything that has a real implementation; the only
 * stub is the optional `EnrichmentLLM.rewriteBullet`, which has no
 * deterministic implementation by design (the deterministic fallback is the
 * `minimalReword` path).
 *
 * Behaviours guarded (per ENRICH-008 acceptance criteria):
 *   §1 Analyzer signals     — deterministic signals walk experience + projects
 *                             and emit addressable, signalled candidates.
 *   §2 Capped questions     — `buildDeterministicQuestions` honours
 *                             MIN_QUESTIONS / MAX_QUESTIONS and never asks for
 *                             estimates; skip is first-class.
 *   §3 Provenance gate      — number-from-answer ACCEPTED;
 *                             invented-number REJECTED;
 *                             skip → minimal reword (no fabricated metric).
 *   §4 Frozen-field guard   — frozen paths never reach the new version.
 *   §5 Apply contract       — apply writes a v+1 CV row, re-derives the
 *                             profile, and fires Epic 5/6/14/7 stale hooks.
 *
 * Following the project's `epic-regression.*.test.ts` convention: real
 * implementations everywhere they exist, realistic CV fixtures, no mocks
 * for things that have real implementations available.
 */
import { describe, expect, it } from 'vitest';

import type { CvParsedFields } from '../cvStructurer.js';
import {
  buildTailoringDocument,
  type TailoringDocument,
} from '../tailoringDocument.js';
import {
  findWeakBulletCandidates,
} from '../weakBulletAnalyzer.js';
import {
  buildDeterministicQuestions,
  MAX_QUESTIONS,
  MIN_QUESTIONS,
  type MetricAnswer,
  type MetricQuestion,
} from '../metricQuestionGenerator.js';
import {
  generateEnrichment,
  type EnrichmentLLM,
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
import type { ProposedChange } from '../tailorGates.js';

// ---------------------------------------------------------------------------
// Realistic fixture — a CV with a deliberate mix of weak and strong bullets
// so the analyzer/questions/generate/apply chain exercises real behaviour.
// ---------------------------------------------------------------------------

const PARSED: CvParsedFields = {
  name: 'Sam Carter',
  contact: { email: 'sam@example.com', phone: '+1 555 0100' },
  targetRole: 'Senior Software Engineer',
  skills: ['TypeScript', 'Node.js', 'AWS', 'React'],
  employmentHistory: [
    {
      company: 'Globex Corp',
      role: 'Staff Engineer',
      startDate: '2021-03',
      endDate: '2026-01',
      summary:
        '- Responsible for the checkout rewrite\n' +
        '- Worked on the data pipeline\n' +
        '- Helped with the dashboard migration\n' +
        '- Shipped the platform rewrite, cutting p99 latency by 45% across 12 services',
    },
    {
      company: 'Initech Ltd',
      role: 'Senior Engineer',
      startDate: '2018-06',
      endDate: '2021-02',
      summary:
        '- Involved in the analytics rollout\n' +
        '- Mentored 4 engineers and shipped onboarding redesign for 30k monthly active users',
    },
  ],
  education: [
    {
      school: 'State University',
      qualification: 'BSc Computer Science',
      startDate: '2013',
      endDate: '2016',
    },
  ],
  totalYearsExperience: 10,
  location: 'Seattle, WA',
};

function makeDoc(): TailoringDocument {
  return buildTailoringDocument(PARSED, '');
}

// ---------------------------------------------------------------------------
// Versioned-CV/profile/hooks fakes — minimal in-memory implementations of the
// EXACT seams the real `applyEnrichment` integrates against. These are not
// mocks of the unit under test; they are thin storage stand-ins.
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
        uploadedAt: 1_000 + rows.length,
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

function makeProfileWriter(): {
  writer: ProfileWriter;
  saved: Array<Record<string, unknown>>;
} {
  const saved: Array<Record<string, unknown>> = [];
  return {
    writer: { save: (input) => void saved.push(input as Record<string, unknown>) },
    saved,
  };
}

function makeHooks(): {
  hooks: EnrichmentStaleHooks;
  counts: Record<string, number>;
} {
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

// ===========================================================================
// §1 — Analyzer signals: deterministic walk of the editable bullet tree
// ===========================================================================

describe('ENRICH-008 §1 — analyzer signals walk real bullets and produce signalled candidates', () => {
  it('emits candidates only for bullets that fire at least one signal', () => {
    const cands = findWeakBulletCandidates(makeDoc());
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.signals.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it('every candidate path is addressable on the same TailoringDocument', () => {
    const doc = makeDoc();
    const cands = findWeakBulletCandidates(doc);
    for (const c of cands) {
      expect(c.path).toMatch(/^(experience|projects)\[\d+\]\.bullets\[\d+\]$/);
      // Pull the bullet text back out via the same shape the path describes —
      // any drift between analyzer paths and the doc shape would break this.
      const m = /^experience\[(\d+)\]\.bullets\[(\d+)\]$/.exec(c.path);
      if (m) {
        const exp = doc.experience[Number(m[1])];
        expect(exp).toBeDefined();
        const bullet = exp!.bullets[Number(m[2])];
        expect(bullet).toBe(c.text);
      }
    }
  });

  it('strong bullets are conservatively NEVER flagged', () => {
    const cands = findWeakBulletCandidates(makeDoc());
    const flagged = cands.map((c) => c.text);
    // Bullet 4 of Globex carries an outcome, a metric, and named scope.
    expect(flagged.some((t) => t.includes('Shipped the platform rewrite'))).toBe(
      false,
    );
    // Initech's mentored-30k-users bullet is similarly strong.
    expect(
      flagged.some((t) => t.includes('Mentored 4 engineers and shipped onboarding')),
    ).toBe(false);
  });
});

// ===========================================================================
// §2 — Capped question generation: MIN/MAX, no estimates, skip is first-class
// ===========================================================================

describe('ENRICH-008 §2 — capped question generation respects MIN/MAX and never asks for estimates', () => {
  it('caps at MAX_QUESTIONS even when many weak candidates exist', () => {
    const cands = findWeakBulletCandidates(makeDoc());
    // Pad the candidate set so we exceed the cap, mirroring a low-signal CV.
    const padded = [
      ...cands,
      ...Array.from({ length: MAX_QUESTIONS + 4 }, (_, i) => ({
        path: `experience[0].bullets[${i}]`,
        text: `Worked on extra thing ${i}.`,
        signals: ['generic_verb' as const, 'no_metric' as const],
        reason: 'generic_verb; no_metric',
      })),
    ];
    const qq = buildDeterministicQuestions(padded);
    expect(qq.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(qq.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
  });

  it('returns no questions when there are fewer than MIN candidates', () => {
    const qq = buildDeterministicQuestions([
      {
        path: 'experience[0].bullets[0]',
        text: 'Worked on a thing.',
        signals: ['generic_verb'],
        reason: 'generic_verb',
      },
    ]);
    expect(qq).toEqual([]);
  });

  it('every question forbids estimate language and surfaces a skip path', () => {
    const cands = findWeakBulletCandidates(makeDoc());
    const qq = buildDeterministicQuestions(cands);
    expect(qq.length).toBeGreaterThanOrEqual(MIN_QUESTIONS);
    for (const q of qq) {
      expect(q.question).not.toMatch(
        /\b(estimate|approximate|approx\.|guess|ballpark|roughly|guesstimate)\b/i,
      );
      expect(q.question).toMatch(/skip/i);
    }
  });
});

// ===========================================================================
// §3 — Answer-provenance gate behaviour
//      (number-from-answer accepted; invented rejected; skip → minimal reword)
// ===========================================================================

describe('ENRICH-008 §3 — number-from-answer is ACCEPTED end-to-end', () => {
  it('a real number from the user\'s answer survives the provenance gate and reaches "applied"', async () => {
    const doc = makeDoc();
    // Pick a real weak bullet from the fixture so the candidate is grounded
    // in actual analyzer output, not hand-typed paths.
    const cands = findWeakBulletCandidates(doc).filter(
      (c) => c.signals.includes('no_metric') || c.signals.includes('generic_verb'),
    );
    expect(cands.length).toBeGreaterThan(0);
    const candidate = cands[0]!;
    const question: MetricQuestion = {
      id: 'mq_1',
      path: candidate.path,
      bulletText: candidate.text,
      kind: 'outcome',
      question: 'What real outcome? Skip if you don\'t have a number.',
    };
    const answers: MetricAnswer[] = [
      { questionId: 'mq_1', status: 'answered', value: '250k users' },
    ];
    const llm: EnrichmentLLM = {
      rewriteBullet: async () =>
        `Built the pipeline, serving 250k users.`,
    };

    const result = await generateEnrichment({
      doc,
      candidates: [candidate],
      questions: [question],
      answers,
      llm,
    });

    expect(result.proposals.length).toBe(1);
    const p = result.proposals[0]!;
    expect(p.gateVerdict.ok).toBe(true);
    expect(p.provenance).toMatch(/from your answer.*250k users/);
    expect(result.applied.length).toBe(1);
    expect(result.applied[0]!.value).toContain('250k');
  });
});

describe('ENRICH-008 §3 — INVENTED numbers are REJECTED by the provenance gate', () => {
  it('a metric the LLM hallucinated, with no answer or doc grounding, fails the gate', async () => {
    const doc = makeDoc();
    const cands = findWeakBulletCandidates(doc).filter(
      (c) => c.signals.includes('no_metric') || c.signals.includes('generic_verb'),
    );
    const candidate = cands[0]!;
    const question: MetricQuestion = {
      id: 'mq_inv',
      path: candidate.path,
      bulletText: candidate.text,
      kind: 'outcome',
      question: 'What real outcome? Skip if you don\'t have a number.',
    };
    // User answered with a usable phrase that contains NO number tokens.
    const answers: MetricAnswer[] = [
      { questionId: 'mq_inv', status: 'answered', value: 'cross-team rollout' },
    ];
    const llm: EnrichmentLLM = {
      // The LLM smuggles in 37% — not present in the answer, not in the doc
      // (the bullets we care about don't already contain "37").
      rewriteBullet: async () =>
        'Owned the cross-team rollout, lifting engagement 37%.',
    };

    const result = await generateEnrichment({
      doc,
      candidates: [candidate],
      questions: [question],
      answers,
      llm,
    });
    expect(result.proposals.length).toBe(1);
    const p = result.proposals[0]!;
    expect(p.gateVerdict.ok).toBe(false);
    expect(p.gateVerdict.reason).toMatch(/untraceable|invented/i);
    expect(p.gateVerdict.untraceable).toContain('37');
    // And it does NOT reach `applied`.
    expect(result.applied.length).toBe(0);
  });
});

describe('ENRICH-008 §3 — skip downgrades to a minimal reword with no fabricated metric', () => {
  it('a skipped answer plus an LLM that tries to inject a number falls back to minimalReword', async () => {
    const doc = makeDoc();
    const cands = findWeakBulletCandidates(doc);
    // Pick the "Responsible for the checkout rewrite" bullet — the verb-rewrite
    // table maps "Responsible for" → "Owned" deterministically.
    const candidate =
      cands.find((c) => c.text.toLowerCase().startsWith('responsible for')) ??
      cands[0]!;
    const question: MetricQuestion = {
      id: 'mq_skip',
      path: candidate.path,
      bulletText: candidate.text,
      kind: 'outcome',
      question: 'What real outcome? Skip if you don\'t have a number.',
    };
    const answers: MetricAnswer[] = [
      { questionId: 'mq_skip', status: 'skipped' },
    ];
    const llm: EnrichmentLLM = {
      // Even though the user skipped, the LLM still tries to invent a number.
      // The provenance gate must strip it and the generator must fall back
      // to the deterministic minimalReword path.
      rewriteBullet: async () =>
        'Drove the checkout rewrite, saving 22% in latency.',
    };

    const result = await generateEnrichment({
      doc,
      candidates: [candidate],
      questions: [question],
      answers,
      llm,
    });
    expect(result.proposals.length).toBe(1);
    const p = result.proposals[0]!;
    // Two valid AC5 outcomes:
    //   (a) the proposal passed the gate after fall-back to minimalReword, OR
    //   (b) the proposal was rejected outright because no rewrite was usable.
    // What is FORBIDDEN is a passed proposal containing a fabricated number.
    if (p.gateVerdict.ok) {
      expect(p.provenance).toMatch(/minimal reword|no fabricated metric/i);
      // No NEW digit may appear in the accepted value.
      const value = p.change.value as string;
      expect(/\d/.test(value)).toBe(/\d/.test(candidate.text));
      // The deterministic reword must have replaced the generic verb phrase.
      if (candidate.text.toLowerCase().startsWith('responsible for')) {
        expect(value).toMatch(/^Owned\b/);
      }
    } else {
      expect(p.gateVerdict.reason).toMatch(
        /provenance|untraceable|invented|no rewrite/i,
      );
    }
    // And no smuggled metric ever reached `applied`.
    for (const ch of result.applied) {
      expect(ch.value as string).not.toMatch(/22%/);
    }
  });
});

// ===========================================================================
// §4 — Frozen-field guard: identity / employers / dates / institutions never edited
// ===========================================================================

describe('ENRICH-008 §4 — frozen-field paths are NEVER edited by enrichment or apply', () => {
  it('generateEnrichment refuses to propose a frozen-field change', async () => {
    const doc = makeDoc();
    // Synthesize a "candidate" pointing at a frozen identity path. The
    // generator runs the path through the Epic 9 frozen check and emits a
    // verdict-failed proposal without producing a successful edit.
    const candidate = {
      path: 'identity.name',
      text: 'Sam Carter',
      signals: ['generic_verb' as const],
      reason: 'generic_verb',
    };
    const question: MetricQuestion = {
      id: 'mq_frozen',
      path: candidate.path,
      bulletText: candidate.text,
      kind: 'outcome',
      question: 'What is your name? Skip if you don\'t have a number.',
    };
    const answers: MetricAnswer[] = [
      { questionId: 'mq_frozen', status: 'answered', value: 'Hacker McEvil' },
    ];
    const llm: EnrichmentLLM = {
      rewriteBullet: async () => 'Hacker McEvil',
    };
    const result = await generateEnrichment({
      doc,
      candidates: [candidate],
      questions: [question],
      answers,
      llm,
    });
    expect(result.proposals.length).toBe(1);
    expect(result.proposals[0]!.gateVerdict.ok).toBe(false);
    expect(result.proposals[0]!.gateVerdict.reason).toMatch(/frozen/i);
    expect(result.applied.length).toBe(0);
  });

  it('applyEnrichment drops a frozen-field change even if it is in `acceptedChanges`', () => {
    const doc = makeDoc();
    const frozen: ProposedChange = {
      path: 'experience[0].company',
      action: 'replace',
      original: doc.experience[0]!.company!,
      value: 'Forged Co',
      reason: 'should be blocked',
    };
    const { writer, rows } = makeWriter({
      id: 'cv_1',
      profileId: 'profile_main',
      version: 1,
      parsedFields: PARSED as unknown as Record<string, unknown>,
      parsedText: 'base',
    });
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: [frozen] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.applied.length).toBe(0);
    expect(r.rejected.length).toBe(1);
    expect(r.rejected[0]!.reason).toMatch(/frozen|gate/i);
    // The KEY regression guard: the frozen company name is NOT mutated by
    // the apply path, even though the change was "accepted" by the caller.
    expect(r.result.experience[0]!.company).toBe(doc.experience[0]!.company);
    const persistedCompany =
      ((rows[rows.length - 1]!.parsedFields as Record<string, unknown> | null)
        ?.employmentHistory as Array<Record<string, unknown>> | undefined)?.[0]
        ?.company;
    expect(persistedCompany).toBe(doc.experience[0]!.company);
  });
});

// ===========================================================================
// §5 — Apply contract: new version + profile re-derive + Epic 5/6/14/7 stale
// ===========================================================================

describe('ENRICH-008 §5 — apply produces a v+1 CV row and fires every documented stale hook', () => {
  it('happy path: writes v=2, re-derives profile, and flips every cache stale exactly once', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].bullets[0]',
      action: 'replace',
      original: doc.experience[0]!.bullets[0]!,
      value: 'Owned the checkout rewrite.',
      reason: 'reword',
    };
    const { writer, rows } = makeWriter({
      id: 'cv_1',
      profileId: 'profile_main',
      version: 1,
      parsedFields: PARSED as unknown as Record<string, unknown>,
      parsedText: 'base text',
    });
    const { writer: profileWriter, saved } = makeProfileWriter();
    const { hooks, counts } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.created).toBe(true);
    expect(rows.length).toBe(2);
    expect(rows[1]!.version).toBe(2);
    // The new row's parsedFields carries the apply-key for dedup.
    expect(rows[1]!.parsedFields![ENRICHMENT_APPLY_KEY_FIELD]).toBe(r.applyKey);
    // The first experience's first bullet reflects the edit.
    expect(r.result.experience[0]!.bullets[0]).toBe(
      'Owned the checkout rewrite.',
    );
    // Profile re-derive: skills/identity propagated.
    expect(saved.length).toBe(1);
    expect((saved[0] as { skills?: string[] }).skills).toEqual(doc.skills);
    expect((saved[0] as { name?: string }).name).toBe('Sam Carter');
    // Every stale hook fires exactly once (Epic 5, 6, 14, 7).
    expect(counts.markScoresStale).toBe(1);
    expect(counts.markReviewsStale).toBe(1);
    expect(counts.markEvalReportsStale).toBe(1);
    expect(counts.markTailoredDocsStale).toBe(1);
  });

  it('dedup: re-applying the IDENTICAL accepted set is a no-op (no v+1, no hooks)', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].bullets[1]',
      action: 'replace',
      original: doc.experience[0]!.bullets[1]!,
      value: 'Built the data pipeline.',
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
    const { writer: profileWriter, saved } = makeProfileWriter();
    const { hooks, counts } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.created).toBe(false);
    expect(rows.length).toBe(1);
    expect(saved.length).toBe(0);
    expect(counts.markScoresStale).toBe(0);
    expect(counts.markReviewsStale).toBe(0);
    expect(counts.markEvalReportsStale).toBe(0);
    expect(counts.markTailoredDocsStale).toBe(0);
  });

  it('end-to-end: generate → apply on a real candidate writes v=2 and fires the hooks', async () => {
    const doc = makeDoc();
    const cands = findWeakBulletCandidates(doc).filter(
      (c) => c.signals.includes('no_metric') || c.signals.includes('generic_verb'),
    );
    expect(cands.length).toBeGreaterThan(0);
    const candidate = cands[0]!;
    const question: MetricQuestion = {
      id: 'mq_e2e',
      path: candidate.path,
      bulletText: candidate.text,
      kind: 'outcome',
      question: 'What outcome? Skip if you don\'t have a number.',
    };
    const answers: MetricAnswer[] = [
      { questionId: 'mq_e2e', status: 'answered', value: '12 services' },
    ];
    const llm: EnrichmentLLM = {
      rewriteBullet: async ({ originalText }) =>
        `${originalText.replace(/\.$/, '')} across 12 services.`,
    };
    const gen = await generateEnrichment({
      doc,
      candidates: [candidate],
      questions: [question],
      answers,
      llm,
    });
    expect(gen.applied.length).toBe(1);
    const { writer, rows } = makeWriter({
      id: 'cv_1',
      profileId: 'profile_main',
      version: 1,
      parsedFields: PARSED as unknown as Record<string, unknown>,
      parsedText: 'base text',
    });
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks, counts } = makeHooks();
    const r = applyEnrichment(
      { doc, acceptedChanges: gen.applied },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(r.created).toBe(true);
    expect(rows.length).toBe(2);
    expect(rows[1]!.version).toBe(2);
    expect(counts.markScoresStale).toBe(1);
    expect(counts.markReviewsStale).toBe(1);
  });
});

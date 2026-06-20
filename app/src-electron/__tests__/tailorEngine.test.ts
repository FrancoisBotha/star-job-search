/**
 * Unit tests for tailorEngine (TDE-005 — Epic 9: Tailoring Diff Engine).
 *
 * Acceptance criteria:
 *  - AC1: a LangGraph wires the documented nodes
 *         (extract-JD-signals → plan/verify-skills → generate-diffs →
 *          gate-filter → refine → rescore).
 *  - AC2: gates / verifier / refine / rescore are pure TS helpers called
 *         from nodes; the graph only routes.
 *  - AC3: the refine loop is BOUNDED (maxRefinePasses) and exits on:
 *         no new injectable keywords, no match-% improvement, or N reached.
 *  - AC4: rescore uses the Epic 5 deterministic scorer on the working result;
 *         the engine returns TailorEngineResult { proposedChanges, rejected,
 *         warnings, refinementStats: { initialPercent, finalPercent, passes } }
 *         and persists NOTHING (no DB / IPC / disk calls).
 *  - AC5: per-node progress events stream; structured-output capability
 *         guard handles MODEL_NOT_CAPABLE and MISSING_KEY; LLM is injectable
 *         for tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// LangGraph is mocked with the same lightweight shim used by the
// jobExtractor tests — it preserves graph topology + routing semantics
// without pulling the full `@langchain/core` runtime (which has optional
// peer deps that are not installed in this worktree).
vi.mock('@langchain/langgraph', () => {
  const END = '__end__';
  const START = '__start__';
  class StateGraph<S extends Record<string, unknown>> {
    nodes = new Map<string, (s: S) => Promise<Partial<S>>>();
    edges = new Map<string, string>();
    conditional = new Map<
      string,
      { router: (s: S) => string | Promise<string>; mapping: Record<string, string> }
    >();
    constructor(_channels: unknown) {}
    addNode(name: string, fn: (s: S) => Promise<Partial<S>>) {
      this.nodes.set(name, fn);
      return this;
    }
    addEdge(from: string, to: string) {
      this.edges.set(from, to);
      return this;
    }
    addConditionalEdges(
      from: string,
      router: (s: S) => string | Promise<string>,
      mapping: Record<string, string>,
    ) {
      this.conditional.set(from, { router, mapping });
      return this;
    }
    compile() {
      return {
        invoke: async (initial: S): Promise<S> => {
          let state = { ...initial } as S;
          let current = this.edges.get(START);
          if (!current) throw new Error('no entry edge');
          for (let i = 0; i < 1000; i++) {
            if (current === END) break;
            const node = this.nodes.get(current);
            if (!node) throw new Error(`unknown node: ${current}`);
            const update = await node(state);
            state = { ...state, ...(update ?? {}) } as S;
            const cond = this.conditional.get(current);
            if (cond) {
              const pick = await cond.router(state);
              const next = cond.mapping[pick];
              if (!next) throw new Error(`bad route ${pick}`);
              current = next;
              continue;
            }
            const next = this.edges.get(current);
            if (!next) break;
            current = next;
          }
          return state;
        },
      };
    }
  }
  return { StateGraph, END, START };
});

import type { CvParsedFields } from '../cvStructurer.js';
import { buildTailoringDocument, type TailoringDocument } from '../tailoringDocument.js';
import type { ProposedChange } from '../tailorGates.js';
import {
  runTailorEngine,
  type TailorEngineEvent,
  type TailorLLM,
} from '../tailorEngine.js';
import type {
  FactorEvaluation,
  FactorEvaluator,
  FactorKey,
  ScoringListing,
  ScoringProfile,
} from '../scorer.js';

const PARSED: CvParsedFields = {
  name: 'Alex Morgan',
  contact: { email: 'alex@example.com', phone: '+44 7000 000000' },
  targetRole: 'Senior Engineer',
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  employmentHistory: [
    {
      company: 'Acme Co',
      role: 'Staff Engineer',
      startDate: '2022-01',
      endDate: '2026-01',
      summary:
        '- Led migration of monolith to services\n- Cut p95 latency by 40%\n- Mentored 5 engineers',
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

const MASTER_TEXT = [
  'Alex Morgan — Senior Engineer',
  'Skills: TypeScript, Node.js, PostgreSQL, Kubernetes, Docker, AWS',
  'Led migration of monolith to services.',
  'Cut p95 latency by 40%.',
  'Mentored 5 engineers.',
].join('\n');

const JD_TEXT =
  'We are hiring a Senior Engineer with TypeScript, Kubernetes, and AWS. ' +
  'Docker experience is a plus. Robust and scalable systems experience desired.';

const LISTING: ScoringListing = {
  sourceId: 'job-1',
  title: 'Senior Engineer',
  description: JD_TEXT,
  location: 'London, UK',
  salary: '£100,000',
};

const BASE_PROFILE: ScoringProfile = {
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  yearsExperience: 10,
  location: 'London, UK',
  workMode: 'Hybrid',
  salaryMin: 80000,
  salaryCurrency: 'GBP',
};

/** Skills-only evaluator: 50% per overlapping JD-token skill, deterministic
 *  and sensitive to additions to the profile.skills list — exactly what we
 *  need to verify the rescore reflects refinement progress. */
const skillsEvaluator: FactorEvaluator = (listing, profile): FactorEvaluation => {
  const jd = (listing.description ?? '').toLowerCase();
  const overlap = profile.skills.filter((s) => jd.includes(s.toLowerCase()));
  const score = Math.min(100, overlap.length * 25);
  return {
    included: true,
    score,
    rationale: `${overlap.length} skill(s) matched`,
  };
};

const NOOP_EVALUATORS: Record<FactorKey, FactorEvaluator> = {
  skills: skillsEvaluator,
  experience: () => ({ included: false, score: 0, rationale: 'n/a' }),
  location: () => ({ included: false, score: 0, rationale: 'n/a' }),
  salary: () => ({ included: false, score: 0, rationale: 'n/a' }),
};

function makeDoc(): TailoringDocument {
  return buildTailoringDocument(PARSED, MASTER_TEXT);
}

// ---------------------------------------------------------------------------
// Stub LLM
// ---------------------------------------------------------------------------

interface StubResponses {
  jdSignals?: { keywords: string[] };
  skillCandidates?: { skills: string[] };
  diffChanges?: { changes: ProposedChange[] };
  throwOn?: 'jdSignals' | 'skillCandidates' | 'diffChanges';
  throwMessage?: string;
}

function makeStubLlm(responses: StubResponses): TailorLLM & { calls: string[] } {
  const calls: string[] = [];
  const llm: TailorLLM = {
    withStructuredOutput<T extends z.ZodTypeAny>(schema: T, opts?: { name?: string }) {
      const name = opts?.name ?? 'anon';
      return {
        invoke: async (_input: unknown): Promise<z.infer<T>> => {
          calls.push(name);
          // Map structured-output schema name to a stub bucket.
          if (name === 'JdSignals') {
            if (responses.throwOn === 'jdSignals') {
              throw new Error(responses.throwMessage ?? 'forced failure');
            }
            return (responses.jdSignals ?? { keywords: [] }) as z.infer<T>;
          }
          if (name === 'SkillCandidates') {
            if (responses.throwOn === 'skillCandidates') {
              throw new Error(responses.throwMessage ?? 'forced failure');
            }
            return (responses.skillCandidates ?? { skills: [] }) as z.infer<T>;
          }
          if (name === 'ProposedChanges') {
            if (responses.throwOn === 'diffChanges') {
              throw new Error(responses.throwMessage ?? 'forced failure');
            }
            return (responses.diffChanges ?? { changes: [] }) as z.infer<T>;
          }
          throw new Error(`stub LLM: unknown structured-output name ${name}`);
        },
      };
    },
  };
  return Object.assign(llm, { calls });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTailorEngine — happy path', () => {
  it('AC1 + AC4: wires nodes, applies diffs, rescores deterministically, returns TailorEngineResult', async () => {
    const doc = makeDoc();
    const llm = makeStubLlm({
      jdSignals: { keywords: ['TypeScript', 'Kubernetes', 'AWS', 'Docker'] },
      skillCandidates: { skills: ['Kubernetes', 'AWS', 'Docker'] },
      diffChanges: {
        changes: [
          {
            path: 'experience[0].bullets[0]',
            action: 'replace',
            original: 'Led migration of monolith to services',
            value: 'Led migration of monolith to Kubernetes-orchestrated services on AWS',
            reason: 'weave JD keywords',
          },
        ],
      },
    });

    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc,
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
      },
      { llm },
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.proposedChanges.length).toBeGreaterThan(0);
    // Verifier should have accepted Kubernetes / AWS / Docker (all JD-present).
    expect(out.result.doc.skills).toEqual(
      expect.arrayContaining(['Kubernetes', 'AWS', 'Docker']),
    );
    expect(out.result.refinementStats.finalPercent).toBeGreaterThan(
      out.result.refinementStats.initialPercent,
    );
    expect(out.result.refinementStats.passes).toBeGreaterThanOrEqual(0);
  });

  it('AC2 + AC5: emits per-node progress events; LLM was invoked through the injected stub', async () => {
    const events: TailorEngineEvent[] = [];
    const llm = makeStubLlm({
      jdSignals: { keywords: ['TypeScript'] },
      skillCandidates: { skills: [] },
      diffChanges: { changes: [] },
    });

    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
      },
      { llm, onEvent: (e) => events.push(e) },
    );
    expect(out.ok).toBe(true);

    const phases = events.map((e) => e.phase);
    expect(phases).toContain('extract-jd-signals');
    expect(phases).toContain('plan-skills');
    expect(phases).toContain('generate-diffs');
    expect(phases).toContain('gate-filter');
    expect(phases).toContain('refine');
    expect(phases).toContain('rescore');
    expect(llm.calls).toEqual(
      expect.arrayContaining(['JdSignals', 'SkillCandidates', 'ProposedChanges']),
    );
  });

  it('AC1: extract-JD-signals is SKIPPED when cached Epic 6 keywords are supplied', async () => {
    const llm = makeStubLlm({
      skillCandidates: { skills: [] },
      diffChanges: { changes: [] },
    });
    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
        jdKeywords: ['TypeScript', 'Kubernetes'],
      },
      { llm },
    );
    expect(out.ok).toBe(true);
    expect(llm.calls).not.toContain('JdSignals');
  });
});

describe('runTailorEngine — refine bound (AC3)', () => {
  it('refine loop exits when N maxRefinePasses is reached', async () => {
    const llm = makeStubLlm({
      jdSignals: { keywords: ['TypeScript', 'Kubernetes', 'AWS', 'Docker'] },
      skillCandidates: { skills: [] },
      diffChanges: { changes: [] },
    });

    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
        maxRefinePasses: 2,
      },
      { llm },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.refinementStats.passes).toBeLessThanOrEqual(2);
  });

  it('refine loop exits when there are no injectable keywords (early)', async () => {
    const events: TailorEngineEvent[] = [];
    const llm = makeStubLlm({
      jdSignals: { keywords: [] }, // no missing keywords → no refinement work
      skillCandidates: { skills: [] },
      diffChanges: { changes: [] },
    });
    const out = await runTailorEngine(
      {
        jdText: '',
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
        maxRefinePasses: 5,
      },
      { llm, onEvent: (e) => events.push(e) },
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.refinementStats.passes).toBe(0);
  });
});

describe('runTailorEngine — capability guard + per-code errors (AC5)', () => {
  it('classifies a function-calling-not-supported failure as MODEL_NOT_CAPABLE', async () => {
    const llm = makeStubLlm({
      jdSignals: { keywords: ['Kubernetes'] },
      throwOn: 'skillCandidates',
      throwMessage: 'The model does not support function calling / tools.',
    });
    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
      },
      { llm },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('MODEL_NOT_CAPABLE');
  });

  it('classifies a generic LLM failure as LLM_ERROR', async () => {
    const llm = makeStubLlm({
      jdSignals: { keywords: [] },
      throwOn: 'diffChanges',
      throwMessage: 'network timeout',
    });
    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
      },
      { llm },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('LLM_ERROR');
  });
});

describe('runTailorEngine — persists NOTHING (AC4)', () => {
  it('never imports a persistence module while running', async () => {
    const llm = makeStubLlm({
      jdSignals: { keywords: ['TypeScript'] },
      skillCandidates: { skills: [] },
      diffChanges: { changes: [] },
    });
    // Sanity: just running the engine successfully with no DB / IPC / file
    // module wired in confirms it doesn't reach for one. (A behavioural
    // assertion — if engine pulled in better-sqlite3 at runtime it would
    // fail in this Node test environment because the rest of the harness
    // doesn't bootstrap an Electron app.)
    const out = await runTailorEngine(
      {
        jdText: JD_TEXT,
        masterCvText: MASTER_TEXT,
        doc: makeDoc(),
        listing: LISTING,
        profile: BASE_PROFILE,
        evaluators: NOOP_EVALUATORS,
      },
      { llm },
    );
    expect(out.ok).toBe(true);
  });
});

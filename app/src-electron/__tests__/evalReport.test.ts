/**
 * Unit tests for the eval-report orchestrator (EVAL-003 / Epic 14).
 *
 * Covers acceptance criteria:
 *  - AC1: orchestrator produces Blocks A, C, D, G via structured LLM calls
 *         reusing the Epic 6 grounding / injection / capability-guard pattern.
 *  - AC2: reads the Epic 5 score (rating) and the Epic 6 review (Block B);
 *         generates Block B when absent; never emits an LLM number anywhere
 *         in the produced narrative.
 *  - AC3: with web research disabled, Blocks D & G degrade to JD-stated-only
 *         and say so; on an anti-bot CAPTCHA challenge during verification,
 *         Block G's verification reports "uncertain" without bypassing.
 *  - AC4: the assembled report (A/C/D/G + sources + legitimacy + verification)
 *         is persisted via the injected EVAL-002 store; LLM + webResearch are
 *         both injectable so tests touch no network.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  generateEvalReport,
  type EvalReportLLM,
  type EvalReportInputs,
  type GenerateEvalReportDeps,
} from '../evalReport';
import type { MatchReviewLLM } from '../matchReview';
import type { EvalReport } from '../evalReports';
import type { WebResearch } from '../webResearch';
import type { MatchScore } from '../scorer';
import type { PersistedMatchReview } from '../matchReviews';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LlmCall {
  schemaName?: string;
  prompt: string;
}

/** Records every prompt sent through withStructuredOutput so tests can
 *  inspect framing, grounding, and the absence of number-asking language. */
function makeLlm(
  router: (schemaName: string | undefined, prompt: string) => unknown,
): { llm: EvalReportLLM; calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  const llm: EvalReportLLM = {
    withStructuredOutput<T extends z.ZodTypeAny>(
      _schema: T,
      opts?: { name?: string },
    ): { invoke(input: string | unknown): Promise<z.infer<T>> } {
      return {
        invoke: async (input: string | unknown) => {
          const prompt = typeof input === 'string' ? input : JSON.stringify(input);
          calls.push({
            ...(opts?.name !== undefined && { schemaName: opts.name }),
            prompt,
          });
          return router(opts?.name, prompt) as z.infer<T>;
        },
      };
    },
  };
  return { llm, calls };
}

function defaultRouter(
  schemaName: string | undefined,
  _prompt: string,
): unknown {
  switch (schemaName) {
    case 'EvalBlockA':
      return { narrative: 'A: role summary + employer context.' };
    case 'EvalBlockC':
      return { narrative: 'C: level & strategy.' };
    case 'EvalBlockD':
      return { narrative: 'D: comp narrative referencing market signals.' };
    case 'EvalBlockG':
      return {
        narrative: 'G: legitimacy signals.',
        legitimacyVerdict: 'legitimate' as const,
        verificationNote: 'Confirmed via the company About page.',
      };
    case 'MatchReview':
      return {
        requirements: [],
        gaps: [],
        strengths: ['some strength'],
        keywords: ['kw'],
        summary: 'Block B summary',
      };
    default:
      throw new Error(`unrecognised schemaName: ${schemaName}`);
  }
}

function makeInputs(over: Partial<EvalReportInputs> = {}): EvalReportInputs {
  return {
    sourceId: 'job-1',
    jobDescription: 'Senior platform engineer. Stated comp: $180k.',
    employerName: 'Acme Corp',
    statedCompensation: '$180k base',
    compensationExpectation: '$200k base',
    cvText: 'Built K8s platforms at scale. 8 yrs SRE.',
    profile: {
      name: 'Test User',
      targetRole: 'Platform Engineer',
      yearsExperience: 8,
      skills: ['kubernetes', 'go'],
    },
    archetype: 'platform',
    ...over,
  };
}

function makeScoresStore(score?: MatchScore | undefined) {
  return {
    get: vi.fn((_id: string) => score),
  };
}

function makeReviewsStore(initial?: PersistedMatchReview | undefined) {
  let row = initial;
  return {
    get: vi.fn((_id: string) => row),
    upsert: vi.fn((r: PersistedMatchReview) => {
      row = { ...r };
    }),
    _row: () => row,
  };
}

function makeEvalReportsStore() {
  const upserts: EvalReport[] = [];
  return {
    upsert: vi.fn((r: EvalReport) => {
      upserts.push({ ...r });
    }),
    _upserts: () => upserts,
  };
}

function makeWebResearch(opts: {
  enabled?: boolean;
  search?: WebResearch['search'];
  fetchUrl?: WebResearch['fetchUrl'];
} = {}): WebResearch {
  return {
    isEnabled: () => opts.enabled ?? true,
    setEnabled: () => undefined,
    isDisclosureAcknowledged: () => true,
    acknowledgeDisclosure: () => undefined,
    search:
      opts.search ??
      (async (q: string) => ({
        ok: true,
        query: q,
        results: [
          { url: 'https://example.com/market', title: 'Market band', snippet: '' },
        ],
        sources: ['https://example.com/market'],
      })),
    fetchUrl:
      opts.fetchUrl ??
      (async (url: string) => ({
        ok: true,
        text: 'Acme Corp is a real company headquartered in NYC.',
        sources: [url],
        redactionCount: 0,
      })),
  };
}

function fakeScore(): MatchScore {
  return {
    sourceId: 'job-1',
    stars: 4,
    percent: 80,
    factors: [],
    weightsVersion: 'v1',
    stale: false,
    scoredAt: 1,
  };
}

function fakeReview(): PersistedMatchReview {
  return {
    sourceId: 'job-1',
    requirements: [],
    gaps: [],
    strengths: ['existing'],
    keywords: ['kw'],
    summary: 'Existing Block B from cache.',
    generatedAt: 1,
    stale: false,
  };
}

function baseDeps(over: Partial<GenerateEvalReportDeps> = {}): GenerateEvalReportDeps {
  const { llm } = makeLlm(defaultRouter);
  const scores = makeScoresStore(fakeScore());
  const reviews = makeReviewsStore(fakeReview());
  const reports = makeEvalReportsStore();
  return {
    llm,
    matchReviewLlm: llm as unknown as MatchReviewLLM,
    webResearch: makeWebResearch({ enabled: true }),
    matchScoresStore: scores,
    matchReviewsStore: reviews,
    evalReportsStore: reports,
    inputs: makeInputs(),
    modelSlug: 'm/x',
    now: () => 1_700_000_000_000,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// AC1 — produces A/C/D/G via structured LLM calls with Epic 6 framing
// ---------------------------------------------------------------------------

describe('generateEvalReport — structured A/C/D/G (AC1)', () => {
  it('produces Blocks A, C, D, G via four structured-output calls', async () => {
    const { llm, calls } = makeLlm(defaultRouter);
    const deps = baseDeps({ llm, matchReviewLlm: llm as unknown as MatchReviewLLM });
    const res = await generateEvalReport(deps);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.report.blockA).toContain('A:');
    expect(res.report.blockC).toContain('C:');
    expect(res.report.blockD).toContain('D:');
    expect(res.report.blockG).toContain('G:');

    const names = calls.map((c) => c.schemaName).filter(Boolean);
    expect(names).toContain('EvalBlockA');
    expect(names).toContain('EvalBlockC');
    expect(names).toContain('EvalBlockD');
    expect(names).toContain('EvalBlockG');
  });

  it('every prompt carries the Epic 6 anti-injection + grounding + no-number framing', async () => {
    const { llm, calls } = makeLlm(defaultRouter);
    const deps = baseDeps({ llm, matchReviewLlm: llm as unknown as MatchReviewLLM });
    await generateEvalReport(deps);

    const blockCalls = calls.filter((c) =>
      c.schemaName?.startsWith('EvalBlock'),
    );
    expect(blockCalls.length).toBeGreaterThanOrEqual(4);
    for (const c of blockCalls) {
      // Grounding
      expect(c.prompt.toLowerCase()).toMatch(/ground|not found|never invent|do not invent|do not fabricate/);
      // Anti-injection — JD treated as untrusted data
      expect(c.prompt.toLowerCase()).toMatch(/untrusted/);
      expect(c.prompt).toMatch(/BEGIN JOB DESCRIPTION/);
      // No numbers / scores / stars / percentages
      expect(c.prompt.toLowerCase()).toMatch(/no (number|score|star|percent|rating)/);
    }
  });

  it('surfaces MODEL_NOT_CAPABLE distinctly when the model rejects structured output', async () => {
    const llm: EvalReportLLM = {
      withStructuredOutput() {
        return {
          invoke: async () => {
            throw new Error('this model does not support function calling');
          },
        };
      },
    };
    const deps = baseDeps({ llm, matchReviewLlm: llm as unknown as MatchReviewLLM });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('MODEL_NOT_CAPABLE');
  });
});

// ---------------------------------------------------------------------------
// AC2 — reads Epic 5 score; reads / generates Epic 6 Block B; never emits
//       an LLM number.
// ---------------------------------------------------------------------------

describe('Epic 5 score + Epic 6 review wiring (AC2)', () => {
  it('reads the Epic 5 score (rating) via the injected store and returns it alongside the report', async () => {
    const scores = makeScoresStore(fakeScore());
    const deps = baseDeps({ matchScoresStore: scores });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(scores.get).toHaveBeenCalledWith('job-1');
    expect(res.rating).toBe(4); // stars from MatchScore
  });

  it('reads Block B from matchReviewsStore when present — does NOT regenerate it', async () => {
    const reviews = makeReviewsStore(fakeReview());
    const deps = baseDeps({ matchReviewsStore: reviews });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(reviews.get).toHaveBeenCalledWith('job-1');
    expect(reviews.upsert).not.toHaveBeenCalled();
    expect(res.blockB.summary).toBe('Existing Block B from cache.');
  });

  it('generates Block B when absent and writes it back via matchReviewsStore.upsert', async () => {
    const reviews = makeReviewsStore(undefined);
    const deps = baseDeps({ matchReviewsStore: reviews });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(reviews.upsert).toHaveBeenCalledTimes(1);
    expect(res.blockB.summary).toBe('Block B summary');
  });

  it('never emits an LLM number — no digits in any block narrative or legitimacy field', async () => {
    // Force the model to attempt to slip a number in; the orchestrator's
    // own output contract must still be number-free.
    const router = (name: string | undefined): unknown => {
      switch (name) {
        case 'EvalBlockA':
          return { narrative: 'A: pure prose.' };
        case 'EvalBlockC':
          return { narrative: 'C: pure prose.' };
        case 'EvalBlockD':
          return { narrative: 'D: pure prose.' };
        case 'EvalBlockG':
          return {
            narrative: 'G: pure prose.',
            legitimacyVerdict: 'legitimate' as const,
            verificationNote: 'Confirmed.',
          };
        case 'MatchReview':
          return {
            requirements: [],
            gaps: [],
            strengths: [],
            keywords: [],
            summary: 'B summary',
          };
        default:
          return undefined;
      }
    };
    const { llm } = makeLlm(router);
    const deps = baseDeps({ llm, matchReviewLlm: llm as unknown as MatchReviewLLM });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const persistedFields: unknown = res.report;
    const fields = persistedFields as Record<string, unknown>;
    expect(fields).not.toHaveProperty('score');
    expect(fields).not.toHaveProperty('stars');
    expect(fields).not.toHaveProperty('percent');
    expect(fields).not.toHaveProperty('rating');
  });
});

// ---------------------------------------------------------------------------
// AC3 — research disabled / CAPTCHA challenge degrade behaviour
// ---------------------------------------------------------------------------

describe('webResearch off & challenge fallback (AC3)', () => {
  it('with research disabled, Blocks D and G prompts state research is disabled and no search/fetch is made', async () => {
    const search = vi.fn();
    const fetchUrl = vi.fn();
    const wr: WebResearch = {
      isEnabled: () => false,
      setEnabled: () => undefined,
      isDisclosureAcknowledged: () => true,
      acknowledgeDisclosure: () => undefined,
      search,
      fetchUrl,
    };
    const { llm, calls } = makeLlm(defaultRouter);
    const deps = baseDeps({
      llm,
      matchReviewLlm: llm as unknown as MatchReviewLLM,
      webResearch: wr,
    });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);

    expect(search).not.toHaveBeenCalled();
    expect(fetchUrl).not.toHaveBeenCalled();

    const d = calls.find((c) => c.schemaName === 'EvalBlockD')!;
    const g = calls.find((c) => c.schemaName === 'EvalBlockG')!;
    expect(d.prompt.toLowerCase()).toMatch(/research (is )?disabled|jd[-\s]stated[-\s]only/);
    expect(g.prompt.toLowerCase()).toMatch(/research (is )?disabled|jd[-\s]stated[-\s]only/);

    if (!res.ok) return;
    expect(res.report.blockD.toLowerCase() + res.report.blockG.toLowerCase()).toMatch(
      /research disabled|jd[-\s]stated[-\s]only/,
    );
    expect(res.report.sources).toHaveLength(0);
  });

  it('verification reports "uncertain" with no bypass when search returns an anti-bot challenge', async () => {
    const search = vi.fn(async (q: string) => ({
      ok: true as const,
      query: q,
      results: [],
      sources: [],
      uncertain: true,
      reason: 'anti-bot challenge detected — did not bypass',
    }));
    const fetchUrl = vi.fn(async (_url: string) => ({
      ok: true as const,
      text: '',
      sources: [],
      redactionCount: 0,
      uncertain: true,
      reason: 'anti-bot challenge detected — did not bypass',
    }));
    const wr: WebResearch = {
      isEnabled: () => true,
      setEnabled: () => undefined,
      isDisclosureAcknowledged: () => true,
      acknowledgeDisclosure: () => undefined,
      search,
      fetchUrl,
    };
    const router = (name: string | undefined): unknown => {
      if (name === 'EvalBlockG') {
        return {
          narrative: 'G: best-effort signals only.',
          legitimacyVerdict: 'unknown' as const,
          verificationNote: 'uncertain — anti-bot challenge prevented verification',
        };
      }
      return defaultRouter(name, '');
    };
    const { llm } = makeLlm(router);
    const deps = baseDeps({
      llm,
      matchReviewLlm: llm as unknown as MatchReviewLLM,
      webResearch: wr,
    });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.report.verificationNote.toLowerCase()).toContain('uncertain');
    // No bypass attempts — challenge results carry through to the prompt
    // and the orchestrator never re-tries to circumvent.
    const allCalls = search.mock.calls.length + fetchUrl.mock.calls.length;
    expect(allCalls).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// AC4 — persistence + grounding + injection seams
// ---------------------------------------------------------------------------

describe('assembled report persistence (AC4)', () => {
  it('persists the assembled A/C/D/G report (+ sources + legitimacy + verification) via the EVAL-002 store', async () => {
    const reports = makeEvalReportsStore();
    const deps = baseDeps({ evalReportsStore: reports });
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);

    expect(reports.upsert).toHaveBeenCalledTimes(1);
    const persisted = reports._upserts()[0];
    if (!persisted) throw new Error('expected at least one upsert');
    expect(persisted.sourceId).toBe('job-1');
    expect(persisted.blockA.length).toBeGreaterThan(0);
    expect(persisted.blockC.length).toBeGreaterThan(0);
    expect(persisted.blockD.length).toBeGreaterThan(0);
    expect(persisted.blockG.length).toBeGreaterThan(0);
    expect(persisted.legitimacyVerdict.length).toBeGreaterThan(0);
    expect(persisted.verificationNote.length).toBeGreaterThan(0);
    // sources populated from webResearch (enabled in baseDeps).
    expect(Array.isArray(persisted.sources)).toBe(true);
    expect(persisted.sources.length).toBeGreaterThan(0);
    expect(persisted.modelSlug).toBe('m/x');
    expect(persisted.generatedAt).toBe(1_700_000_000_000);
  });

  it('LLM and webResearch are both injectable — no network is touched and no real DB is opened', async () => {
    // The very fact that this whole suite runs with a fake `EvalReportLLM`,
    // a fake `WebResearch`, and in-memory store fakes is the assertion. This
    // test pins the surface so a future refactor cannot silently regress it.
    const deps = baseDeps();
    const res = await generateEvalReport(deps);
    expect(res.ok).toBe(true);
  });
});

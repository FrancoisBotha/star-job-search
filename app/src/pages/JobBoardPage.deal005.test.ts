/**
 * DEAL-005 AC2 — Job Board flag/order behaviour.
 *
 * Two surfaces are asserted here:
 *
 *  1. JobBoardPage.vue source-scan (mirrors the DEAL-003 / DEAL-004 style
 *     used elsewhere in this folder, since vitest runs in `node` env and
 *     mounting a Quasar page would require jsdom + @vue/test-utils that
 *     this repo deliberately does not pull in):
 *       - a ⚠ chip element is rendered, gated by `isFlagged(j)`
 *       - the board's sort comparator places clean tiles before flagged
 *         tiles AND still keys off the Epic-5 score percent within each
 *         group (Epic 5 ordering is untouched)
 *
 *  2. Behavioural: the Pinia store selector `dealbreakerVerdicts` (the
 *     same data the ⚠ chip and the sort comparator read) — when paired
 *     with the same comparator used by the page — orders flagged jobs
 *     after clean jobs without disturbing the cached MatchScore rows.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from 'src/stores/app-store';
import type { JobRecord, MatchScore } from 'src/types/models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_SRC = readFileSync(path.join(__dirname, 'JobBoardPage.vue'), 'utf8');

// ---------------------------------------------------------------- source-scan

describe('DEAL-005 AC2 — JobBoardPage source: ⚠ chip is rendered on flagged tiles', () => {
  it('renders a ⚠ glyph somewhere in the template', () => {
    expect(PAGE_SRC).toContain('⚠');
  });

  it('gates the chip on isFlagged(j)', () => {
    expect(PAGE_SRC).toMatch(/v-if="isFlagged\(j\)"/);
  });

  it('defines isFlagged off the store.dealbreakerVerdicts map', () => {
    expect(PAGE_SRC).toMatch(/isFlagged[\s\S]{0,200}dealbreakerVerdicts/);
  });

  it('tags the chip with a stable data-test hook', () => {
    expect(PAGE_SRC).toMatch(/data-test="dealbreaker-chip"/);
  });
});

describe('DEAL-005 AC2 — JobBoardPage source: ordering puts clean before flagged and preserves Epic 5 score', () => {
  it('sort comparator subtracts flagged(a) - flagged(b) so clean (0) sorts before flagged (1)', () => {
    expect(PAGE_SRC).toMatch(/flagged\(a\)\s*-\s*flagged\(b\)/);
  });

  it('within each group the comparator still reads the Epic 5 score percent', () => {
    expect(PAGE_SRC).toMatch(/scores\[[^\]]+\]\?\.percent/);
  });

  it('the comparator does not mutate store.scores', () => {
    // Negative assertion: no assignment into store.scores[...] from the
    // ordering helper. Epic 5 percent is read, not rewritten.
    expect(PAGE_SRC).not.toMatch(/store\.scores\[[^\]]+\]\s*=/);
  });
});

// --------------------------------------------------------------- behavioural

interface ProfileShape {
  name: string;
  targetRole: string;
  yearsExperience: number | null;
  location: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  salaryMin: number | null;
  salaryCurrency: string;
  linkedinUrl: string;
  links: string[];
  skills: string[];
  strengthScore: number;
  dealbreakerKeywords: string[];
  dealbreakerCompanies: string[];
  dealbreakerSalaryMin: number | null;
  updatedAt: number;
}

function emptyProfile(): ProfileShape {
  return {
    name: '',
    targetRole: '',
    yearsExperience: null,
    location: '',
    workMode: 'Remote',
    salaryMin: null,
    salaryCurrency: 'GBP',
    linkedinUrl: '',
    links: [],
    skills: [],
    strengthScore: 0,
    dealbreakerKeywords: [],
    dealbreakerCompanies: [],
    dealbreakerSalaryMin: null,
    updatedAt: 1,
  };
}

function job(over: Partial<JobRecord> = {}): JobRecord {
  return {
    sourceId: 'j',
    hostname: 'example.com',
    url: 'https://example.com/j',
    title: 'Engineer',
    company: 'Acme',
    location: 'Remote',
    description: null,
    postedAt: null,
    fetchedAt: 1,
    status: 'new',
    ...over,
  };
}

function score(sourceId: string, percent: number): MatchScore {
  return {
    sourceId,
    percent,
    stars: Math.max(1, Math.min(5, Math.round(percent / 20))),
    factors: [],
    weightsVersion: 'test',
    stale: false,
    scoredAt: 1,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/**
 * Mirror of the JobBoardPage `orderedJobs` comparator (lines around
 * JobBoardPage.vue:182). Kept in lock-step with the page intentionally so
 * the source-scan above pins the production comparator while this helper
 * exercises its observable behaviour. A drift between the two trips the
 * regex assertions, not this helper.
 */
function orderedJobsFor(
  jobs: JobRecord[],
  scores: Record<string, MatchScore>,
  verdicts: Record<string, { flagged: boolean }>,
): JobRecord[] {
  const flagged = (j: JobRecord) => (verdicts[j.sourceId]?.flagged ? 1 : 0);
  const percent = (j: JobRecord) => scores[j.sourceId]?.percent ?? -1;
  return [...jobs].sort((a, b) => {
    const d = flagged(a) - flagged(b);
    if (d !== 0) return d;
    const p = percent(b) - percent(a);
    if (p !== 0) return p;
    return b.fetchedAt - a.fetchedAt;
  });
}

describe('DEAL-005 AC2 — flagged jobs sort after clean matches, scores untouched', () => {
  it('clean jobs lead, flagged jobs trail; Epic 5 percent ordering survives within each group', () => {
    const store = useAppStore();
    const p = emptyProfile();
    p.dealbreakerKeywords = ['onsite-only'];
    store.profile = p as unknown as StarProfile;

    const dirtyHi = job({ sourceId: 'dirty-hi', description: 'onsite-only role', fetchedAt: 4 });
    const cleanHi = job({ sourceId: 'clean-hi', fetchedAt: 3 });
    const cleanLo = job({ sourceId: 'clean-lo', fetchedAt: 2 });
    const dirtyLo = job({ sourceId: 'dirty-lo', description: 'onsite-only', fetchedAt: 1 });
    store.jobs = [dirtyHi, cleanHi, cleanLo, dirtyLo];

    const scoresSnapshot: Record<string, MatchScore> = {
      'dirty-hi': score('dirty-hi', 95),
      'clean-hi': score('clean-hi', 88),
      'clean-lo': score('clean-lo', 42),
      'dirty-lo': score('dirty-lo', 30),
    };
    store.scores = scoresSnapshot;

    const ordered = orderedJobsFor(
      store.visibleJobs,
      store.scores,
      store.dealbreakerVerdicts,
    );

    expect(ordered.map((j) => j.sourceId)).toEqual([
      'clean-hi', // clean group, highest percent
      'clean-lo', // clean group, lower percent
      'dirty-hi', // flagged group, highest percent within flagged
      'dirty-lo', // flagged group, lowest percent within flagged
    ]);

    // Epic 5 score map is untouched — the comparator reads, never writes.
    // (Pinia wraps state in a reactive proxy, so a reference-identity check
    // against the raw snapshot would always fail; assert by value instead.)
    expect(store.scores).toEqual(scoresSnapshot);
    expect(scoresSnapshot['dirty-hi']?.percent).toBe(95);
    expect(scoresSnapshot['clean-hi']?.percent).toBe(88);
    expect(scoresSnapshot['clean-lo']?.percent).toBe(42);
    expect(scoresSnapshot['dirty-lo']?.percent).toBe(30);
  });

  it('the salary rule no-ops when a job has no stated salary — that job stays in the clean group', () => {
    const store = useAppStore();
    const p = emptyProfile();
    p.dealbreakerSalaryMin = 100_000;
    store.profile = p as unknown as StarProfile;

    const noSalary = job({ sourceId: 'no-salary', salary: null, fetchedAt: 2 });
    const lowSalary = job({ sourceId: 'low', salary: '£50,000', fetchedAt: 1 });
    store.jobs = [noSalary, lowSalary];

    const verdicts = store.dealbreakerVerdicts;
    expect(verdicts['no-salary']?.flagged).toBe(false);
    expect(verdicts['low']?.flagged).toBe(true);

    const ordered = orderedJobsFor(store.visibleJobs, store.scores, verdicts);
    expect(ordered.map((j) => j.sourceId)).toEqual(['no-salary', 'low']);
  });
});

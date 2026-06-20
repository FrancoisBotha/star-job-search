/**
 * DEAL-004 — app-store `dealbreakerVerdicts` selector applies
 * [[evaluateDealbreakers]] (DEAL-001) to [[visibleJobs]] using the persisted
 * Profile rules (DEAL-002), keyed by sourceId. Reactive on rule edits and
 * never persists verdicts.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app-store';
import type { JobRecord } from 'src/types/models';

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

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('DEAL-004 — dealbreakerVerdicts selector (AC1)', () => {
  it('returns an empty verdict map when no rules are set', () => {
    const store = useAppStore();
    store.profile = emptyProfile() as unknown as StarProfile;
    store.jobs = [job({ sourceId: 'j1', description: 'requires security clearance' })];
    const verdicts = store.dealbreakerVerdicts;
    expect(verdicts['j1']?.flagged).toBe(false);
  });

  it('flags a job whose description contains a dealbreaker keyword', () => {
    const store = useAppStore();
    const p = emptyProfile();
    p.dealbreakerKeywords = ['security clearance'];
    store.profile = p as unknown as StarProfile;
    store.jobs = [
      job({ sourceId: 'clean', description: 'fully remote, fun stack' }),
      job({ sourceId: 'dirty', description: 'requires security clearance' }),
    ];
    expect(store.dealbreakerVerdicts['clean']?.flagged).toBe(false);
    expect(store.dealbreakerVerdicts['dirty']?.flagged).toBe(true);
    expect(store.dealbreakerVerdicts['dirty']?.hits[0]).toMatchObject({
      rule: 'keyword',
      field: 'description',
      term: 'security clearance',
    });
  });

  it('is reactive: editing a rule re-flags immediately (AC1)', () => {
    const store = useAppStore();
    store.profile = emptyProfile() as unknown as StarProfile;
    store.jobs = [job({ sourceId: 'j1', company: 'Initech' })];
    expect(store.dealbreakerVerdicts['j1']?.flagged).toBe(false);
    store.profile = {
      ...(store.profile as unknown as ProfileShape),
      dealbreakerCompanies: ['Initech'],
    } as unknown as StarProfile;
    expect(store.dealbreakerVerdicts['j1']?.flagged).toBe(true);
    expect(store.dealbreakerVerdicts['j1']?.hits[0]?.rule).toBe('company');
  });

  it('only evaluates visibleJobs — not_interested jobs are absent from the map', () => {
    const store = useAppStore();
    const p = emptyProfile();
    p.dealbreakerKeywords = ['onsite-only'];
    store.profile = p as unknown as StarProfile;
    store.jobs = [
      job({ sourceId: 'hidden', status: 'not_interested', description: 'onsite-only' }),
      job({ sourceId: 'shown', description: 'onsite-only role' }),
    ];
    expect(store.dealbreakerVerdicts['hidden']).toBeUndefined();
    expect(store.dealbreakerVerdicts['shown']?.flagged).toBe(true);
  });
});

describe('DEAL-004 — salary rule never flags jobs with no stated salary (AC4)', () => {
  it('does not flag a job whose salary is null even when salaryMin is set', () => {
    const store = useAppStore();
    const p = emptyProfile();
    p.dealbreakerSalaryMin = 100_000;
    store.profile = p as unknown as StarProfile;
    store.jobs = [
      job({ sourceId: 'no-salary', salary: null }),
      job({ sourceId: 'blank-salary', salary: '' }),
      job({ sourceId: 'not-stated', salary: 'Not stated' }),
      job({ sourceId: 'low', salary: '£50,000' }),
    ];
    expect(store.dealbreakerVerdicts['no-salary']?.flagged).toBe(false);
    expect(store.dealbreakerVerdicts['blank-salary']?.flagged).toBe(false);
    expect(store.dealbreakerVerdicts['not-stated']?.flagged).toBe(false);
    expect(store.dealbreakerVerdicts['low']?.flagged).toBe(true);
    expect(store.dealbreakerVerdicts['low']?.hits[0]?.rule).toBe('salaryMin');
  });
});

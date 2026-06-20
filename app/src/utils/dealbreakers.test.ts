/**
 * Unit tests for the pure dealbreaker evaluator (DEAL-001).
 *
 * Covers every acceptance criterion: word-boundary keyword matching,
 * case-insensitivity, phrase matching, company matching, salary floor
 * (below / above / absent), and the empty-rules no-op contract.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateDealbreakers,
  type DealbreakerRules,
} from './dealbreakers';

const emptyRules: DealbreakerRules = {
  dealbreakerKeywords: [],
  dealbreakerCompanies: [],
  dealbreakerSalaryMin: null,
};

describe('evaluateDealbreakers — keyword rules', () => {
  it("matches 'java' as a whole word but NOT inside 'javascript'", () => {
    const rules: DealbreakerRules = {
      ...emptyRules,
      dealbreakerKeywords: ['java'],
    };
    const hit = evaluateDealbreakers(
      { title: 'Senior Java Engineer', description: '' },
      rules,
    );
    expect(hit.flagged).toBe(true);
    expect(hit.hits).toEqual([
      { rule: 'keyword', field: 'title', term: 'java' },
    ]);

    const miss = evaluateDealbreakers(
      { title: 'JavaScript Developer', description: 'React + javascript' },
      rules,
    );
    expect(miss.flagged).toBe(false);
    expect(miss.hits).toEqual([]);
  });

  it('is case-insensitive across title and description', () => {
    const rules: DealbreakerRules = {
      ...emptyRules,
      dealbreakerKeywords: ['COBOL'],
    };
    const t = evaluateDealbreakers(
      { title: 'cobol maintainer', description: '' },
      rules,
    );
    expect(t.flagged).toBe(true);
    expect(t.hits[0]).toEqual({ rule: 'keyword', field: 'title', term: 'COBOL' });

    const d = evaluateDealbreakers(
      { title: 'Engineer', description: 'must know Cobol well' },
      rules,
    );
    expect(d.flagged).toBe(true);
    expect(d.hits[0]).toEqual({
      rule: 'keyword',
      field: 'description',
      term: 'COBOL',
    });
  });

  it('supports multi-word phrase matches', () => {
    const rules: DealbreakerRules = {
      ...emptyRules,
      dealbreakerKeywords: ['on-call rotation'],
    };
    const hit = evaluateDealbreakers(
      { title: 'SRE', description: 'Includes ON-CALL ROTATION duties.' },
      rules,
    );
    expect(hit.flagged).toBe(true);
    expect(hit.hits[0]).toEqual({
      rule: 'keyword',
      field: 'description',
      term: 'on-call rotation',
    });
  });
});

describe('evaluateDealbreakers — company rules', () => {
  it('matches the company case-insensitively', () => {
    const rules: DealbreakerRules = {
      ...emptyRules,
      dealbreakerCompanies: ['Acme Corp'],
    };
    const hit = evaluateDealbreakers(
      { title: 'Engineer', description: '', company: 'acme corp' },
      rules,
    );
    expect(hit.flagged).toBe(true);
    expect(hit.hits).toEqual([
      { rule: 'company', field: 'company', term: 'Acme Corp' },
    ]);
  });

  it('does not flag when the company differs', () => {
    const rules: DealbreakerRules = {
      ...emptyRules,
      dealbreakerCompanies: ['Acme Corp'],
    };
    const r = evaluateDealbreakers(
      { title: 'Engineer', description: '', company: 'Globex' },
      rules,
    );
    expect(r.flagged).toBe(false);
  });
});

describe('evaluateDealbreakers — salary floor rule', () => {
  const rules: DealbreakerRules = {
    ...emptyRules,
    dealbreakerSalaryMin: 80000,
  };

  it('flags when stated salary parses below the floor', () => {
    const r = evaluateDealbreakers(
      { title: 'Dev', description: '', salary: '£70k–£90k' },
      { ...emptyRules, dealbreakerSalaryMin: 80000 },
    );
    expect(r.flagged).toBe(true);
    expect(r.hits[0]).toEqual({
      rule: 'salaryMin',
      field: 'salary',
      term: '80000',
    });
  });

  it('does not flag when stated salary parses at or above the floor', () => {
    const r = evaluateDealbreakers(
      { title: 'Dev', description: '', salary: '$120,000' },
      rules,
    );
    expect(r.flagged).toBe(false);
  });

  it("NO-OPS when salary is absent / null / blank / 'not stated'", () => {
    const cases: Array<string | null | undefined> = [
      undefined,
      null,
      '',
      '   ',
      'not stated',
      'Not Stated',
    ];
    for (const salary of cases) {
      const r = evaluateDealbreakers(
        { title: 'Dev', description: '', salary },
        rules,
      );
      expect(r.flagged).toBe(false);
      expect(r.hits).toEqual([]);
    }
  });
});

describe('evaluateDealbreakers — empty rule lists', () => {
  it('flags nothing even on a job that would otherwise match', () => {
    const r = evaluateDealbreakers(
      {
        title: 'Java COBOL Engineer',
        description: 'on-call rotation',
        company: 'Acme Corp',
        salary: '£10k',
      },
      emptyRules,
    );
    expect(r.flagged).toBe(false);
    expect(r.hits).toEqual([]);
  });
});

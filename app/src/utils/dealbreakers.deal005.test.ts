/**
 * DEAL-005 AC1 — evaluator unit tests covering every required scenario:
 *   - word-boundary keyword (title and description)
 *   - case-insensitive keyword
 *   - phrase (multi-token) match
 *   - company match (case-insensitive)
 *   - salary below / above / absent the floor
 *   - empty rules no-op
 *
 * These run offline against the pure evaluator from DEAL-001 — no network,
 * no LLM. Kept separate from `dealbreakers.test.ts` so the DEAL-005 ticket
 * has a single, AC-numbered test surface.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateDealbreakers,
  type DealbreakerRules,
} from './dealbreakers';

const empty: DealbreakerRules = {
  dealbreakerKeywords: [],
  dealbreakerCompanies: [],
  dealbreakerSalaryMin: null,
};

describe('DEAL-005 AC1 — keyword matching is word-bounded and case-insensitive', () => {
  it("flags 'java' in the title but NOT inside 'javascript'", () => {
    const rules: DealbreakerRules = { ...empty, dealbreakerKeywords: ['java'] };
    expect(
      evaluateDealbreakers({ title: 'Senior Java Engineer', description: '' }, rules)
        .flagged,
    ).toBe(true);
    expect(
      evaluateDealbreakers(
        { title: 'JavaScript Developer', description: 'js / javascript' },
        rules,
      ).flagged,
    ).toBe(false);
  });

  it('flags case-insensitively in the description', () => {
    const rules: DealbreakerRules = { ...empty, dealbreakerKeywords: ['COBOL'] };
    const v = evaluateDealbreakers(
      { title: 'Engineer', description: 'must know Cobol' },
      rules,
    );
    expect(v.flagged).toBe(true);
    expect(v.hits[0]).toMatchObject({
      rule: 'keyword',
      field: 'description',
      term: 'COBOL',
    });
  });

  it('flags a multi-word phrase ("on-call rotation") across casing', () => {
    const rules: DealbreakerRules = {
      ...empty,
      dealbreakerKeywords: ['on-call rotation'],
    };
    const v = evaluateDealbreakers(
      { title: 'SRE', description: 'Includes ON-CALL ROTATION duties.' },
      rules,
    );
    expect(v.flagged).toBe(true);
    expect(v.hits[0]?.rule).toBe('keyword');
  });
});

describe('DEAL-005 AC1 — company matching', () => {
  it('flags a case-insensitive company match', () => {
    const rules: DealbreakerRules = {
      ...empty,
      dealbreakerCompanies: ['Acme Corp'],
    };
    const v = evaluateDealbreakers(
      { title: 'Engineer', description: '', company: 'acme corp' },
      rules,
    );
    expect(v.flagged).toBe(true);
    expect(v.hits[0]?.rule).toBe('company');
  });

  it('does not flag a different company', () => {
    const rules: DealbreakerRules = {
      ...empty,
      dealbreakerCompanies: ['Acme Corp'],
    };
    expect(
      evaluateDealbreakers(
        { title: 'Engineer', description: '', company: 'Globex' },
        rules,
      ).flagged,
    ).toBe(false);
  });
});

describe('DEAL-005 AC1 — salary floor: below / above / absent', () => {
  const rules: DealbreakerRules = { ...empty, dealbreakerSalaryMin: 80_000 };

  it('flags when the stated salary parses below the floor', () => {
    const v = evaluateDealbreakers(
      { title: 'Dev', description: '', salary: '£70k–£90k' },
      rules,
    );
    expect(v.flagged).toBe(true);
    expect(v.hits[0]?.rule).toBe('salaryMin');
  });

  it('does NOT flag when the stated salary is at or above the floor', () => {
    expect(
      evaluateDealbreakers(
        { title: 'Dev', description: '', salary: '$120,000' },
        rules,
      ).flagged,
    ).toBe(false);
  });

  it('NO-OPS when the salary is absent / blank / "not stated"', () => {
    for (const salary of [undefined, null, '', '   ', 'Not stated']) {
      const v = evaluateDealbreakers(
        { title: 'Dev', description: '', salary: salary as string | null | undefined },
        rules,
      );
      expect(v.flagged).toBe(false);
      expect(v.hits).toEqual([]);
    }
  });
});

describe('DEAL-005 AC1 — empty rule lists are a no-op', () => {
  it('does not flag even when every field would otherwise match', () => {
    const v = evaluateDealbreakers(
      {
        title: 'Java COBOL Engineer',
        description: 'on-call rotation',
        company: 'Acme Corp',
        salary: '£10k',
      },
      empty,
    );
    expect(v.flagged).toBe(false);
    expect(v.hits).toEqual([]);
  });
});

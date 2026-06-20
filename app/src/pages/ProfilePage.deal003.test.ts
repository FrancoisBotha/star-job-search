/**
 * Unit tests for DEAL-003 — Dealbreakers section on the Profile page.
 *
 * Regex-scan style, mirroring the other ProfilePage.*.test.ts files.
 *
 * Acceptance criteria:
 *  1. ProfilePage.vue has a 'Dealbreakers' section with three inputs:
 *     keyword dealbreakers, company dealbreakers, and a minimum-salary
 *     number.
 *  2. Each input is bound to the Profile and persists via
 *     `store.saveProfile({...})` on edit.
 *  3. Values reload correctly after restart (read from store.profile);
 *     empty inputs clear the rule; reuses existing field styling/tokens
 *     (no new tokens).
 *  4. A short helper line explains that matches are flagged (not hidden)
 *     on the Job Board.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'ProfilePage.vue'), 'utf8');

describe('ProfilePage — Dealbreakers section with three inputs (AC1)', () => {
  it('renders a "Dealbreakers" section header', () => {
    expect(SRC).toMatch(/Dealbreakers/);
  });

  it('has an input for keyword dealbreakers', () => {
    expect(SRC).toMatch(/dealbreakerKeywords/);
  });

  it('has an input for company dealbreakers', () => {
    expect(SRC).toMatch(/dealbreakerCompanies/);
  });

  it('has a numeric minimum-salary input', () => {
    expect(SRC).toMatch(/dealbreakerSalaryMin/);
    // The minimum-salary field is a number input.
    expect(SRC).toMatch(/dealbreaker[\s\S]{0,400}type="number"/);
  });
});

describe('ProfilePage — inputs bound to the Profile and persist via saveProfile (AC2)', () => {
  it('reads keyword dealbreakers from store.profile', () => {
    expect(SRC).toMatch(/store\.profile\?\.dealbreakerKeywords/);
  });

  it('reads company dealbreakers from store.profile', () => {
    expect(SRC).toMatch(/store\.profile\?\.dealbreakerCompanies/);
  });

  it('reads minimum salary from store.profile', () => {
    expect(SRC).toMatch(/store\.profile\?\.dealbreakerSalaryMin/);
  });

  it('persists keyword dealbreakers via store.saveProfile', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{\s*dealbreakerKeywords/);
  });

  it('persists company dealbreakers via store.saveProfile', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{\s*dealbreakerCompanies/);
  });

  it('persists minimum salary via store.saveProfile', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{\s*dealbreakerSalaryMin/);
  });
});

describe('ProfilePage — empty inputs clear the rule + reuse existing styling (AC3)', () => {
  it('empty keyword list clears the rule (saves an empty array)', () => {
    // The keyword change handler should produce [] for an empty input
    // so the rule is disabled, not retained from a previous value.
    expect(SRC).toMatch(/onDealbreakerKeywords/);
    // A trim/split-and-filter pipeline turns "" into [] (rule cleared).
    expect(SRC).toMatch(/\.split\(/);
    expect(SRC).toMatch(/\.filter\(/);
  });

  it('empty minimum-salary input clears the rule (saves null)', () => {
    expect(SRC).toMatch(/onDealbreakerSalaryMinChange|onDealbreakerSalaryChange/);
    expect(SRC).toMatch(/dealbreakerSalaryMin[^]{0,160}null/);
  });

  it('reuses the existing .field class for layout — no new tokens', () => {
    // The dealbreaker inputs must share the existing .field styling used
    // by the other Profile fields (e.g. LinkedIn).
    const matches = SRC.match(/class="field"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('does not introduce a new CSS variable token', () => {
    // Reuse only — no --dealbreaker-* tokens.
    expect(SRC).not.toMatch(/--dealbreaker/);
  });
});

describe('ProfilePage — helper line clarifies that matches are flagged, not hidden (AC4)', () => {
  it('mentions flagged (not hidden) on the Job Board', () => {
    expect(SRC).toMatch(/flag/i);
    expect(SRC).toMatch(/not hidden|never hidden|aren'?t hidden|still (?:appear|show)/i);
  });
});

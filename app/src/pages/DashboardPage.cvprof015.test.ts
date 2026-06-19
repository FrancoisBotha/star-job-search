/**
 * CVPROF-015 — Dashboard greeting uses the saved name.
 *
 * AC3/AC4: the hardcoded 'Good morning, Alex' must be gone. The greeting
 * uses the first name from the saved profile and falls back to a neutral
 * 'Good morning' when no name is set.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD = readFileSync(
  path.join(__dirname, 'DashboardPage.vue'),
  'utf8',
);

describe('DashboardPage — greeting uses the saved name (AC3/AC4)', () => {
  it('drops the hardcoded "Good morning, Alex" greeting', () => {
    expect(DASHBOARD).not.toMatch(/Good morning,\s*Alex/);
  });

  it('exposes a first-name binding driven by the store profile', () => {
    expect(DASHBOARD).toMatch(/store\.profile/);
    expect(DASHBOARD).toMatch(/firstName/);
    expect(DASHBOARD).toMatch(/computed/);
  });

  it('keeps a neutral "Good morning" string as the fallback greeting', () => {
    expect(DASHBOARD).toMatch(/Good morning/);
  });
});

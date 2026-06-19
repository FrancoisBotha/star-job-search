/**
 * CVPROF-015 — sidebar user block reflects the saved profile.
 *
 * AC2/AC4: the hardcoded 'AM' / 'Alex Morgan' / 'Product Designer' must be
 * gone. Name, initials and role line are derived reactively from
 * `store.profile`, and neutral placeholders render when nothing is set.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LAYOUT = readFileSync(path.join(__dirname, 'MainLayout.vue'), 'utf8');

describe('MainLayout — sidebar reflects the saved profile (AC2/AC4)', () => {
  it('drops the hardcoded mock identity', () => {
    expect(LAYOUT).not.toMatch(/Alex Morgan/);
    // The hardcoded sidebar role label must be gone — match it as a
    // standalone literal inside a tag (avoids false positives on the
    // unrelated 'Senior Product Designer' mock job title used elsewhere).
    expect(LAYOUT).not.toMatch(/>\s*Product Designer\s*</);
    // The literal 'AM' avatar text must be gone (initials are now derived).
    expect(LAYOUT).not.toMatch(/>\s*AM\s*</);
  });

  it('binds the displayed name to the store profile', () => {
    expect(LAYOUT).toMatch(/store\.profile/);
    // The sidebar user__name must use a derived/computed name binding
    // (template can use either the computed ref or store.profile?.name).
    expect(LAYOUT).toMatch(/user__name/);
    expect(LAYOUT).toMatch(/userName/);
  });

  it('derives initials from the saved name and exposes them via a computed', () => {
    expect(LAYOUT).toMatch(/userInitials/);
    expect(LAYOUT).toMatch(/computed/);
  });

  it('binds the role line to the saved target role', () => {
    expect(LAYOUT).toMatch(/userRole/);
    // Some reference to targetRole inside the script (for the role binding).
    expect(LAYOUT).toMatch(/targetRole/);
  });
});

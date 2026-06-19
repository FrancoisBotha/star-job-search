/**
 * Unit tests for TAILOR-006 (Tailor view) — CV + Cover-letter tabs reachable
 * via a deep-link route, CV tab with diff-vs-base, per-suggestion
 * accept/dismiss, live star/% chip, ATS checklist, intensity toggle, Copy +
 * Export controls, error / spinner / stale states, provenance badge,
 * Studio visual system reuse.
 *
 * Static-source scan (same pattern as DashboardPage.score008.test.ts) —
 * verifies the .vue template/script wires up to the store contract from
 * TAILOR-004 / TAILOR-005 without rendering the component.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR = readFileSync(path.join(__dirname, 'TailorPage.vue'), 'utf8');
const ROUTES = readFileSync(
  path.join(__dirname, '..', 'router', 'routes.ts'),
  'utf8',
);

describe('TailorPage — deep-link route (AC1)', () => {
  it('keeps a named "tailor" route registered in the router', () => {
    expect(ROUTES).toMatch(/name:\s*['"]tailor['"]/);
    expect(ROUTES).toMatch(/path:\s*['"]tailor['"]/);
  });

  it('reads the sourceId query param on mount so the route is deep-linkable', () => {
    expect(TAILOR).toMatch(/useRoute\b/);
    expect(TAILOR).toMatch(/sourceId/);
  });

  it('exposes CV and Cover-letter tabs in the same view', () => {
    expect(TAILOR).toMatch(/Tailored CV/);
    expect(TAILOR).toMatch(/Cover letter/);
  });
});

describe('TailorPage — CV diff-vs-base (AC3)', () => {
  it('renders both the base CV and the tailored content with diff highlighting', () => {
    // The base CV is read off the store's current CV.
    expect(TAILOR).toMatch(/currentCv/);
    // The diff is highlighted — use a marker class (e.g. "diff" /
    // "diff-add" / "diff-del") in the template so changes are visible.
    expect(TAILOR).toMatch(/diff/);
  });
});

describe('TailorPage — per-suggestion accept/dismiss + live star/% (AC4)', () => {
  it('renders Accept and Dismiss controls per suggestion', () => {
    expect(TAILOR).toMatch(/label="Accept"/);
    expect(TAILOR).toMatch(/label="Dismiss"/);
  });

  it('wires Accept to the store.acceptTailoredSuggestion action', () => {
    expect(TAILOR).toMatch(/acceptTailoredSuggestion\(/);
  });

  it('reads a live star/% chip off the deterministic Epic 5 score store', () => {
    expect(TAILOR).toMatch(/store\.scores\[/);
    expect(TAILOR).toMatch(/StarRating/);
    expect(TAILOR).toMatch(/percent/);
  });
});

describe('TailorPage — ATS checklist panel (AC5)', () => {
  it('renders the ATS report checks with pass/fail surfacing', () => {
    expect(TAILOR).toMatch(/atsReport/);
    expect(TAILOR).toMatch(/checks/);
    expect(TAILOR).toMatch(/passed/);
  });
});

describe('TailorPage — intensity toggle + Copy/Export (AC6)', () => {
  it('renders a light ↔ aggressive intensity toggle', () => {
    expect(TAILOR).toMatch(/light/);
    expect(TAILOR).toMatch(/aggressive/);
  });

  it('renders a Copy control and an Export-as-text/markdown control', () => {
    expect(TAILOR).toMatch(/label="Copy"/);
    expect(TAILOR).toMatch(/Export/);
    expect(TAILOR).toMatch(/exportTailoredDoc\(/);
  });

  it('has no submission affordance (FR-015 — no apply/send button)', () => {
    expect(TAILOR).not.toMatch(/label="Apply"/);
    expect(TAILOR).not.toMatch(/label="Submit"/);
    expect(TAILOR).not.toMatch(/label="Send"/);
  });
});

describe('TailorPage — states + badging (AC7)', () => {
  it('renders a generating spinner while the tailor action is loading', () => {
    expect(TAILOR).toMatch(/loading/);
    expect(TAILOR).toMatch(/spinner|q-spinner|Generating/);
  });

  it('surfaces specific copy for each tailor error code', () => {
    expect(TAILOR).toMatch(/NO_API_KEY/);
    expect(TAILOR).toMatch(/MODEL_NOT_CAPABLE/);
    expect(TAILOR).toMatch(/RATE_LIMITED/);
    expect(TAILOR).toMatch(/NETWORK_ERROR/);
  });

  it('shows a stale banner with a Regenerate action', () => {
    expect(TAILOR).toMatch(/stale/);
    expect(TAILOR).toMatch(/Regenerate/);
  });

  it('shows the AI draft provenance badge + "built from CV v{n}" + advisory tag', () => {
    expect(TAILOR).toMatch(/AI draft/);
    expect(TAILOR).toMatch(/modelSlug/);
    expect(TAILOR).toMatch(/built from CV/);
    expect(TAILOR).toMatch(/advisory|AI/);
  });
});

describe('TailorPage — Studio visual system reuse (AC8)', () => {
  it('reuses StarRating.vue rather than re-implementing the star UI', () => {
    expect(TAILOR).toMatch(
      /import\s+StarRating\s+from\s+['"]src\/components\/StarRating\.vue['"]|import\s+StarRating\s+from\s+['"]components\/StarRating\.vue['"]/,
    );
  });

  it('uses existing design tokens (var(--...)) rather than declaring new tokens', () => {
    expect(TAILOR).toMatch(/var\(--/);
  });
});

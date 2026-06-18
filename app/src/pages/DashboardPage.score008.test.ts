/**
 * Unit tests for SCORE-008 — Dashboard ★4+ STRONG count + top-matches list.
 *
 * Covers:
 *  - AC1: stat strip's STRONG number is the ★4+ strong-match count, read
 *    from the store's strongMatchCount selector (FR-010).
 *  - AC2: 'Top matches today' lists the highest-scoring jobs ordered by
 *    score, using store.topMatches selector (FR-010).
 *  - AC3: each top-match entry shows stars + percentage via StarRating.vue.
 *  - AC4: counts/list update reactively as scores are (re)computed or
 *    marked stale (drives off store state, which itself reacts to
 *    score-progress and markScoresStale).
 *  - AC5: matches mockup 01 — reuses existing components/tokens only.
 *
 * Follows the existing pattern (regex scan of the .vue source) used by
 * DiscoverPage.test.ts and others — no @vue/test-utils.
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

describe('DashboardPage — STRONG stat (AC1 / FR-010)', () => {
  it('reads the strong-match count from the store, not a hard-coded value', () => {
    expect(DASHBOARD).toMatch(/useAppStore/);
    expect(DASHBOARD).toMatch(/strongMatchCount/);
    // The previous hard-coded '38' must be gone.
    expect(DASHBOARD).not.toMatch(/value:\s*['"]38['"]/);
  });

  it('binds the STRONG stat number to the strongMatchCount selector', () => {
    // Either the stats array reads from store.strongMatchCount, or the
    // template inlines the binding — both forms satisfy the AC.
    expect(DASHBOARD).toMatch(/store\.strongMatchCount/);
  });
});

describe('DashboardPage — Top matches list (AC2 / FR-010)', () => {
  it('drops the legacy MATCHES sample import for the top-matches list', () => {
    // The list must be driven by the store's topMatches selector, not the
    // mock MATCHES sample array.
    expect(DASHBOARD).not.toMatch(/MATCHES\.slice/);
  });

  it('renders the top-matches list off the store.topMatches selector', () => {
    expect(DASHBOARD).toMatch(/store\.topMatches/);
    // v-for over the top-matches collection.
    expect(DASHBOARD).toMatch(/v-for="[^"]*\bin\b[^"]*topMatches/);
  });
});

describe('DashboardPage — StarRating + percentage per entry (AC3)', () => {
  it('imports and renders the StarRating component for each top match', () => {
    expect(DASHBOARD).toMatch(/import\s+StarRating\s+from\s+['"]components\/StarRating\.vue['"]/);
    expect(DASHBOARD).toMatch(/<StarRating\b/);
  });

  it('shows the percentage alongside the stars per entry', () => {
    // % is read from the score map keyed by sourceId; either via a helper
    // or inline. Look for a percent expression anywhere in the template.
    expect(DASHBOARD).toMatch(/percent/);
    expect(DASHBOARD).toMatch(/%/);
  });
});

describe('DashboardPage — hydrates scores + jobs on mount (AC4)', () => {
  it('mounts to a real Vue lifecycle hook and pulls jobs + scores from main', () => {
    expect(DASHBOARD).toMatch(/onMounted\b/);
    expect(DASHBOARD).toMatch(/store\.listJobs\(/);
    expect(DASHBOARD).toMatch(/store\.listScores\(/);
  });

  it('subscribes to the scoring progress stream so the list updates reactively', () => {
    expect(DASHBOARD).toMatch(/store\.subscribeScoresProgress\(/);
    expect(DASHBOARD).toMatch(/onBeforeUnmount\b/);
    expect(DASHBOARD).toMatch(/store\.unsubscribeScoresProgress\(/);
  });
});

describe('DashboardPage — reuses existing components/tokens (AC5)', () => {
  it('does not introduce a new star-rendering component', () => {
    // Must reuse StarRating.vue from /components — no inline star markup
    // duplication, no new component import path.
    expect(DASHBOARD).not.toMatch(/import\s+\w+Star\w+\s+from\s+['"](?!components\/StarRating)/);
  });

  it('preserves the stat strip + cols layout (mockup 01) so existing tokens drive style', () => {
    expect(DASHBOARD).toMatch(/class="stat-strip stats"/);
    expect(DASHBOARD).toMatch(/class="cols"/);
  });
});

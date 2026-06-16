/**
 * Unit tests for the Discover page load / error / empty states (BRWSR-005).
 *
 * The page must:
 *  - AC1: show a loading indicator while a selected site is loading.
 *  - AC2: show a clear failed-to-load message when a site cannot be loaded.
 *  - AC3 (Epic §6): show an empty state "Add a site in Settings to start
 *    browsing" when no sites are configured.
 *  - AC4: the empty state replaces the dropdown / browser chrome when the
 *    persisted sites list is empty (mutually exclusive with the browser UI).
 *  - AC5 (Epic §6): the states reuse the existing Studio visual system — no
 *    new tokens, colours, or components are introduced.
 *
 * Following the precedent set by DiscoverPage.test.ts: regex scans of the
 * .vue source file (no @vue/test-utils).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DISCOVER = readFileSync(
  path.join(__dirname, 'DiscoverPage.vue'),
  'utf8',
);

describe('DiscoverPage — loading state (BRWSR-005 AC1)', () => {
  it('tracks a reactive isLoading flag', () => {
    expect(DISCOVER).toMatch(/isLoading\s*=\s*ref\(/);
  });

  it('flips isLoading on while navigate() is in flight', () => {
    // The flag must be set true before navigate is awaited, and cleared
    // after (success or failure).
    expect(DISCOVER).toMatch(/isLoading\.value\s*=\s*true/);
    expect(DISCOVER).toMatch(/isLoading\.value\s*=\s*false/);
  });

  it('renders a loading indicator bound to isLoading', () => {
    // A loading overlay/indicator must appear while isLoading is true.
    expect(DISCOVER).toMatch(/v-if="isLoading"|v-show="isLoading"/);
    expect(DISCOVER.toLowerCase()).toMatch(/loading/);
  });
});

describe('DiscoverPage — failed-to-load state (BRWSR-005 AC2)', () => {
  it('tracks a reactive load-error message', () => {
    expect(DISCOVER).toMatch(/loadError\s*=\s*ref\(/);
  });

  it('catches navigate() failures and surfaces them via loadError', () => {
    // The navigate() call must be wrapped in try/catch (or .catch) so a
    // rejection is captured and assigned to loadError.
    expect(DISCOVER).toMatch(/loadError\.value\s*=/);
    expect(DISCOVER).toMatch(/catch\b/);
  });

  it('renders a clear failed-to-load message bound to loadError', () => {
    expect(DISCOVER).toMatch(/v-if="loadError"/);
    expect(DISCOVER.toLowerCase()).toMatch(/(failed to load|could not load|unable to load)/);
  });
});

describe('DiscoverPage — empty state (BRWSR-005 AC3, AC4)', () => {
  it('shows the "Add a site in Settings to start browsing" copy', () => {
    expect(DISCOVER.toLowerCase()).toMatch(/add a site in settings to start browsing/);
  });

  it('hides the browser chrome and the site dropdown when no sites are configured', () => {
    // The empty state must replace — not sit alongside — the chrome and dock.
    // Look for a v-if on store.sites.length (the truthy branch) that guards
    // the chrome row, and a v-else (or inverse v-if) for the empty panel.
    expect(DISCOVER).toMatch(/v-if="store\.sites\.length"|v-if="hasSites"/);
    expect(DISCOVER).toMatch(/v-else\b|v-if="!store\.sites\.length"|v-if="!hasSites"/);
  });
});

describe('DiscoverPage — Studio visual system (BRWSR-005 AC5)', () => {
  it('uses existing Studio CSS variables (no new colour tokens introduced)', () => {
    // The new states must reuse existing tokens — at least one var(--…) the
    // page already relies on. The file should not introduce raw hex/rgb
    // colours beyond what was already present for the chrome.
    expect(DISCOVER).toMatch(/var\(--/);
  });

  it('does not pull in new Quasar components beyond the existing q-select', () => {
    // The states should be plain markup styled via the existing scoped
    // styles — no q-spinner, q-banner, q-card, q-dialog, etc.
    expect(DISCOVER).not.toMatch(/<q-spinner\b/);
    expect(DISCOVER).not.toMatch(/<q-banner\b/);
    expect(DISCOVER).not.toMatch(/<q-card\b/);
    expect(DISCOVER).not.toMatch(/<q-dialog\b/);
  });
});

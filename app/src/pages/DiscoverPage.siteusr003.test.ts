/**
 * Unit tests for SITEUSR-003 — display saved username + silent copy button
 * alongside the active Discover tab.
 *
 * Acceptance criteria:
 *  1. When the active site has a saved username, the username is displayed
 *     alongside the embedded browser for that tab.
 *  2. A copy button is shown next to the displayed username and copies the
 *     username to the clipboard with no confirmation message (silent).
 *  3. When the active site has no saved username, no username and no copy
 *     button are displayed.
 *  4. The displayed username tracks the selected tab — switching tabs
 *     updates (or hides) it.
 *
 * Mirrors the regex-scan precedent set by DiscoverPage.test.ts (no
 * @vue/test-utils dependency).
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

describe('DiscoverPage — saved username display (SITEUSR-003 AC1, AC4)', () => {
  it('exposes a reactive computed/ref for the active site so its username can be rendered', () => {
    // Implementation derives the active site from store.sites + selectedSiteId
    // so the displayed username tracks the selected tab.
    expect(DISCOVER).toMatch(/selectedSiteId/);
    expect(DISCOVER).toMatch(/store\.sites/);
    // A computed (activeSite / activeUsername) sources the rendered value.
    expect(DISCOVER).toMatch(/activeUsername|activeSite/);
  });

  it('renders the saved username in the template, gated on its presence (AC1, AC3)', () => {
    // A v-if guard ensures nothing renders when the active site has no
    // saved username (AC3).
    expect(DISCOVER).toMatch(/v-if="[^"]*(activeUsername|activeSite\?\.username|username)[^"]*"/);
    // The username value is bound into the template — i.e. there is a
    // {{ ... username ... }} or :value="username" interpolation.
    expect(DISCOVER).toMatch(/\{\{\s*[^}]*(activeUsername|username)[^}]*\}\}|:value="[^"]*username[^"]*"/);
  });
});

describe('DiscoverPage — silent copy button (SITEUSR-003 AC2)', () => {
  it('renders a copy button next to the username', () => {
    // The copy control must exist (button with an aria-label or class
    // identifying it as the copy affordance).
    expect(DISCOVER).toMatch(/aria-label="Copy username"|class="[^"]*username__copy[^"]*"/);
  });

  it('writes to the clipboard via navigator.clipboard.writeText', () => {
    expect(DISCOVER).toMatch(/navigator\.clipboard\.writeText\(/);
  });

  it('does NOT surface a confirmation message — the copy is silent', () => {
    // No toast / notify / "copied" affordance anywhere in the copy flow.
    expect(DISCOVER).not.toMatch(/\$q\.notify|Notify\.create|['"]Copied['"]|copied to clipboard/i);
  });
});

describe('DiscoverPage — hidden when unset (SITEUSR-003 AC3)', () => {
  it('uses a v-if (not v-show) so the element is absent — not just hidden — when no username is saved', () => {
    // v-show would leave the element in the DOM; AC3 requires "no username
    // and no copy button are displayed" — i.e. not rendered.
    const usernameBlock = DISCOVER.match(/username[\s\S]{0,400}?navigator\.clipboard|navigator\.clipboard[\s\S]{0,400}?username/);
    expect(usernameBlock).not.toBeNull();
    expect(DISCOVER).not.toMatch(/v-show="[^"]*username[^"]*"/);
  });
});

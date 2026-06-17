/**
 * Unit tests for the Discover page (BRWSR-004).
 *
 * The page must:
 *  - AC1 (FR-001): render the real embedded browser surface in place of the
 *    mock chrome — i.e. drive the `starBrowser` preload bridge.
 *  - AC2 (FR-004): replace the hardcoded `siteToggles` dock with a dropdown
 *    populated from the persisted sites list (`store.sites`).
 *  - AC3: the dropdown lists exactly the persisted sites (matches Settings).
 *  - AC4 (FR-005): selecting a site loads it in the embedded browser and the
 *    URL pill reflects the active URL.
 *  - AC5 (FR-006): the back/forward chevrons drive `starBrowser.back/.forward`.
 *  - AC6: the embedded browser surface is positioned/resized to fit the
 *    Discover layout and follows window resizes (calls `setBounds`).
 *  - AC7 (Epic §6): existing browser chrome is reused — the chrome row with
 *    back/forward chevrons, the URL pill, and the "Star browsing" tag is
 *    preserved, not redesigned.
 *
 * The test surface mirrors the precedent set by `app-store.test.ts`: regex
 * scans of the .vue source file (no `@vue/test-utils`).
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

describe('DiscoverPage — embedded browser (AC1 / FR-001)', () => {
  it('drives the starBrowser preload bridge (create + navigate)', () => {
    expect(DISCOVER).toMatch(/window\.starBrowser/);
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.create\(/);
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.navigate\(/);
  });

  it('shows the embedded browser surface when the page mounts and hides it on unmount', () => {
    expect(DISCOVER).toMatch(/onMounted\b/);
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.show\(\s*true\s*\)/);
    expect(DISCOVER).toMatch(/onBeforeUnmount\b/);
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.show\(\s*false\s*\)/);
  });

  it('removes the mock results list (no scraping/extraction creeps in)', () => {
    expect(DISCOVER).not.toMatch(/results\.map/);
    expect(DISCOVER).not.toMatch(/v-for="\(m, i\)/);
    expect(DISCOVER).not.toMatch(/Tailor &amp; apply/);
  });
});

describe('DiscoverPage — site dropdown (AC2, AC3 / FR-004)', () => {
  it('drops the hardcoded siteToggles array and its toggle rows', () => {
    expect(DISCOVER).not.toMatch(/siteToggles/);
    expect(DISCOVER).not.toMatch(/toggle-row/);
  });

  it('renders a site tab per active site sourced from the persisted store list', () => {
    // EXTR replaced the original q-select dropdown with a browser-style tab
    // strip — one tab per active site, iterated from the persisted store.
    expect(DISCOVER).toMatch(/v-for="s in store\.enabledSites"/);
    expect(DISCOVER).toMatch(/store\.sites/);
  });

  it('hydrates the persisted sites on mount so the dropdown matches Settings', () => {
    expect(DISCOVER).toMatch(/hydrateSites\(\)/);
  });

  it('shows an empty state when no sites are configured', () => {
    expect(DISCOVER.toLowerCase()).toMatch(/add a site in settings/);
  });
});

describe('DiscoverPage — site selection + URL pill (AC4 / FR-005)', () => {
  it('navigates the embedded browser when a site is selected', () => {
    // A change/select handler must call starBrowser.navigate with the
    // selected site's URL.
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.navigate\(/);
    // The selected site's URL — not a hardcoded string — feeds navigate().
    expect(DISCOVER).not.toMatch(/rolehub\.com\/search\?q=product-designer/);
  });

  it('renders the URL pill from a reactive activeUrl (not a hardcoded string)', () => {
    expect(DISCOVER).toMatch(/activeUrl/);
    expect(DISCOVER).toMatch(/\{\{\s*activeUrl[^}]*\}\}/);
  });
});

describe('DiscoverPage — back/forward navigation (AC5 / FR-006)', () => {
  it('wires the back chevron to starBrowser.back()', () => {
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.back\(\)/);
  });

  it('wires the forward chevron to starBrowser.forward()', () => {
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.forward\(\)/);
  });

  it('attaches the chevrons as click handlers in the chrome row', () => {
    // Both chevrons must be clickable — i.e. the chrome__nav has @click
    // handlers, not just static SVGs.
    expect(DISCOVER).toMatch(/chrome__nav[\s\S]*@click/);
  });
});

describe('DiscoverPage — surface positioning + resize (AC6)', () => {
  it('sets the BrowserView bounds based on the page layout', () => {
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.setBounds\(/);
  });

  it('follows window/layout resizes (ResizeObserver or window resize listener)', () => {
    expect(DISCOVER).toMatch(/ResizeObserver|addEventListener\(\s*['"]resize['"]/);
  });
});

describe('DiscoverPage — chrome reuse (AC7 / Epic §6)', () => {
  it('preserves the existing browser chrome row (back/forward chevrons, URL pill, Star browsing tag)', () => {
    expect(DISCOVER).toMatch(/class="chrome"/);
    expect(DISCOVER).toMatch(/chrome__nav/);
    expect(DISCOVER).toMatch(/chrome__url/);
    expect(DISCOVER).toMatch(/chrome__tag/);
    expect(DISCOVER).toMatch(/Star browsing/);
  });
});

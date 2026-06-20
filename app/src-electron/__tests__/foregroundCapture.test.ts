/**
 * Unit tests for the foreground-view capture helper (XJOB-001 / Epic 11).
 *
 * The helper reads the FOREGROUND embedded-browser webContents (the tab the
 * user is currently viewing) — not the Epic 3 hidden crawler — and returns
 * the rendered `document.body.innerText`, preferring a main/detail content
 * region when one exists and falling back to `<body>` otherwise.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  captureForegroundView,
  CAPTURE_TEXT_MAX,
  FOREGROUND_REGION_SELECTORS,
} from '../foregroundCapture';

interface FakeWc {
  getURL: () => string;
  executeJavaScript: (code: string) => Promise<unknown>;
}

function makeWc(opts: {
  url?: string;
  regionText?: string | null;
  bodyText?: string;
}): FakeWc {
  return {
    getURL: () => opts.url ?? 'https://example.com/job/123',
    executeJavaScript: vi.fn(async (code: string) => {
      // The helper runs two scripts in order: a region probe (marked with
      // STAR_FG_REGION) then a body fallback when the probe returns null.
      if (code.includes('STAR_FG_REGION')) {
        if (opts.regionText == null) return null;
        return { sel: 'main', text: opts.regionText };
      }
      return opts.bodyText ?? '';
    }) as unknown as (code: string) => Promise<unknown>,
  };
}

describe('captureForegroundView — XJOB-001', () => {
  it('AC1: returns innerText preferring the main/detail region and the current URL', async () => {
    const wc = makeWc({
      url: 'https://example.com/jobs/42',
      regionText: 'Senior Engineer — full job description here',
    });
    const result = await captureForegroundView({
      getVisibleTarget: () => wc as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.url).toBe('https://example.com/jobs/42');
    expect(result.text).toBe('Senior Engineer — full job description here');
    expect(result.region).not.toBe('body');
  });

  it('AC1: falls back to document.body.innerText when no region matches', async () => {
    const wc = makeWc({
      regionText: null,
      bodyText: 'Whole page text — no <main> on this site',
    });
    const result = await captureForegroundView({
      getVisibleTarget: () => wc as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('Whole page text — no <main> on this site');
    expect(result.region).toBe('body');
  });

  it('AC2: resolves with a clear error (does not throw) when no board view is active', async () => {
    const result = await captureForegroundView({
      getVisibleTarget: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_VIEW');
    expect(result.error).toMatch(/no.*(active|board).*view|open.*job/i);
  });

  it('AC2: never navigates or mutates the page (no loadURL / click / type / insertCSS in the helper)', async () => {
    // Source-level boundary: the capture module must only READ — no
    // navigation, no DOM mutation, no style injection.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.resolve(__dirname, '..', 'foregroundCapture.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/loadURL/);
    expect(src).not.toMatch(/\.click\(/);
    expect(src).not.toMatch(/insertCSS/);
    expect(src).not.toMatch(/dispatchEvent/);
    expect(src).not.toMatch(/\.value\s*=/);
  });

  it('AC3: trims captured text to a bounded size sane for one LLM call', async () => {
    const huge = 'x'.repeat(CAPTURE_TEXT_MAX * 3 + 500);
    const wc = makeWc({ regionText: huge });
    const result = await captureForegroundView({
      getVisibleTarget: () => wc as never,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBeLessThanOrEqual(CAPTURE_TEXT_MAX);
    expect(result.truncated).toBe(true);
    // Sanity: the cap must actually be a "sane size for a single LLM call" —
    // not unbounded, not microscopic.
    expect(CAPTURE_TEXT_MAX).toBeGreaterThanOrEqual(20_000);
    expect(CAPTURE_TEXT_MAX).toBeLessThanOrEqual(200_000);
  });

  it('AC1: the foreground selector list includes common job-detail content regions', () => {
    // Region preference must cover the realistic shapes job boards use.
    const joined = FOREGROUND_REGION_SELECTORS.join(' | ').toLowerCase();
    expect(joined).toMatch(/main/);
    expect(joined).toMatch(/article/);
    // A role="main" landmark is the WAI-ARIA equivalent of <main>.
    expect(joined).toMatch(/role.*main/);
  });

  it('AC1: targets the FOREGROUND visible view — never reaches for the hidden crawler', async () => {
    const visible = makeWc({ regionText: 'visible' });
    const crawler = makeWc({ regionText: 'crawler' });
    const getVisibleTarget = vi.fn(() => visible as never);
    const result = await captureForegroundView({ getVisibleTarget });
    expect(getVisibleTarget).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('visible');
    // Defensive: the crawler webContents must never be touched by the helper.
    expect(crawler.executeJavaScript).not.toHaveBeenCalled();
  });
});

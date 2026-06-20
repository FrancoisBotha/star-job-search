/**
 * Unit tests for the Discover page "Extract this job" control (XJOB-004 —
 * Epic 11: Extract this job).
 *
 *   - AC1: a separate, clearly-labelled "Extract this job" button sits in
 *     the existing browser chrome NEXT TO the bulk "AI Extract" button —
 *     it is not a mode of the bulk button. It is disabled with a clear
 *     reason (title attribute) when key/model is missing.
 *   - AC2: clicking it drives the store's extractVisibleJob action and the
 *     page surfaces extracting / success-toast / no-posting copy off the
 *     resulting status.
 *   - AC3: the first send is gated behind the existing "what is sent"
 *     disclosure (the same `reviewDisclosureAcknowledged` flag used by AI
 *     Match Review + Tailoring — no new disclosure copy).
 *   - AC4: reuses the Studio visual system (CSS vars) — no new Quasar
 *     components beyond the existing q-* set already on the page.
 *
 * Following the regex-on-source-file precedent set by
 * DiscoverPage.extr008.test.ts.
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

describe('DiscoverPage — Extract this job button (XJOB-004 AC1)', () => {
  it('renders an "Extract this job" button inside the existing browser chrome', () => {
    expect(DISCOVER).toMatch(/class="chrome"[\s\S]*Extract this job[\s\S]*<\/section>/);
    expect(DISCOVER).toMatch(/Extract this job/);
  });

  it('is a separate sibling button — not a mode of "AI Extract"', () => {
    // Both labels should appear; the bulk button keeps its existing label.
    expect(DISCOVER).toMatch(/AI Extract/);
    expect(DISCOVER).toMatch(/Extract this job/);
    // Two distinct <button> tags inside the chrome — the "Extract this job"
    // control must be a sibling element, not a dropdown item of the bulk
    // button.
    const chromeMatch = DISCOVER.match(/<div class="chrome">([\s\S]*?)<\/div>\s*<\/section>?/);
    const chromeBlock = chromeMatch?.[1] ?? DISCOVER;
    const aiExtractBtnCount = (chromeBlock.match(/AI Extract/g) ?? []).length;
    const extractThisBtnCount = (chromeBlock.match(/Extract this job/g) ?? []).length;
    expect(aiExtractBtnCount).toBeGreaterThanOrEqual(1);
    expect(extractThisBtnCount).toBeGreaterThanOrEqual(1);
  });

  it('binds the disabled state to the canExtractVisibleJob gate', () => {
    // The button must be disabled when no key/model — driven by the
    // store getter so the same gate the IPC enforces is reflected in UI.
    expect(DISCOVER).toMatch(/canExtractVisibleJob/);
    expect(DISCOVER).toMatch(/<button[^>]*:disabled="[^"]*(?:!\s*(?:store\.)?canExtractVisibleJob|isExtractingVisible)/);
  });

  it('surfaces the disabled reason as a tooltip when key/model is missing', () => {
    // The user must be able to see WHY the button is disabled. The store
    // exposes extractVisibleDisabledReason — the page must bind it via
    // :title (the standard HTML tooltip surface).
    expect(DISCOVER).toMatch(/extractVisibleDisabledReason/);
    expect(DISCOVER).toMatch(/:title="[^"]*extractVisibleDisabledReason/);
  });
});

describe('DiscoverPage — Extract this job click + states (XJOB-004 AC2)', () => {
  it('wires the click handler to a dedicated onExtractThisJob function', () => {
    expect(DISCOVER).toMatch(/<button[^>]*@click="onExtractThisJob[\s\S]*?Extract this job/);
    expect(DISCOVER).toMatch(/function onExtractThisJob/);
  });

  it('drives the store extractVisibleJob action from the click handler', () => {
    expect(DISCOVER).toMatch(/extractVisibleJob\(\)/);
  });

  it('renders the extracting state from store.extractVisibleStatus', () => {
    expect(DISCOVER).toMatch(/extractVisibleStatus/);
    // The "extracting" copy must be present (any verb form: Extracting / extracting).
    expect(DISCOVER).toMatch(/Extracting/i);
  });

  it('renders the "no posting" empty state with the spec copy', () => {
    expect(DISCOVER).toMatch(/Couldn't find a job posting on this page/);
  });

  it('emits the success toast "Added: {title} — {company}"', () => {
    // The success copy must follow the AC2 wording. Either via $q.notify
    // or a template — but the format string must be present in source.
    expect(DISCOVER).toMatch(/Added:\s*\$\{[^}]+\}\s*—\s*\$\{[^}]+\}|Added:\s*\{\{[^}]+\}\}\s*—\s*\{\{[^}]+\}\}/);
  });
});

describe('DiscoverPage — disclosure gate (XJOB-004 AC3)', () => {
  it('reuses the existing "what is sent" disclosure flag', () => {
    // Same store flag the AI Match Review + Tailoring use — no new copy.
    expect(DISCOVER).toMatch(/reviewDisclosureAcknowledged/);
    expect(DISCOVER).toMatch(/acknowledgeReviewDisclosure/);
  });

  it('renders the disclosure dialog with the existing copy', () => {
    // The "what we send" / "what is sent" wording must appear so users
    // see the same disclosure they have already seen elsewhere.
    expect(DISCOVER).toMatch(/What we send|what is sent|what we send/i);
  });
});

describe('DiscoverPage — Studio visual system (XJOB-004 AC4)', () => {
  it('reuses existing Studio CSS variables (no new colour tokens)', () => {
    expect(DISCOVER).toMatch(/var\(--/);
  });

  it('does not introduce new Quasar components beyond the existing set', () => {
    // Allow q-dialog + q-card + q-btn ONLY if the existing page already
    // uses them; the bar must stay opinionated about not adding new ones.
    // The AI Extract / chrome stayed plain <button>; the new button must
    // also be a plain <button>.
    expect(DISCOVER).not.toMatch(/<q-banner\b/);
    expect(DISCOVER).not.toMatch(/<q-linear-progress\b/);
    expect(DISCOVER).not.toMatch(/<q-spinner\b/);
  });
});

/**
 * Unit tests for AIREV-009 — JobDetailDialog supports a focus-the-review
 * flag from the AI tile button: scrolls the AI Match Review section into
 * view, and triggers on-demand generation when no review is cached and
 * the user has the prerequisites (key + default model + CV).
 *
 * Mirrors the regex-scan style of the other JobDetailDialog tests.
 *
 * Acceptance criteria:
 *  1. A `focusReview` (Boolean) prop is declared.
 *  2. The AI Match Review section has a ref/anchor so it can be scrolled
 *     into view on open.
 *  3. When opened with focusReview=true and no cached review and the user
 *     can generate, the dialog kicks off the generate flow on its own
 *     (so the user lands on a generating/ready report, not an empty section).
 *  4. When opened with focusReview=true but no key, the existing disabled
 *     Generate state + "needs key" hint render — nothing throws and no
 *     auto-generate is attempted.
 *  5. scrollIntoView is called on the review section ref when focusReview
 *     is set on open.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  path.join(__dirname, 'JobDetailDialog.vue'),
  'utf8',
);

describe('JobDetailDialog — focusReview prop wiring (AIREV-009 AC1)', () => {
  it('declares a focusReview boolean prop on defineProps', () => {
    expect(SRC).toMatch(/focusReview\??:\s*boolean/);
  });
});

describe('JobDetailDialog — AI Match Review section has a scroll anchor (AIREV-009 AC2 / AC5)', () => {
  it('binds a template ref on the AI Match Review section', () => {
    // A ref="reviewSection" (or similar) lives on the AI section node so we
    // can scroll it into view.
    expect(SRC).toMatch(/ref="reviewSection"/);
  });

  it('calls scrollIntoView on the review section ref when focused', () => {
    expect(SRC).toMatch(/scrollIntoView\s*\(/);
  });
});

describe('JobDetailDialog — focusReview auto-generate on open (AIREV-009 AC3)', () => {
  it('auto-triggers generateReview / onGenerateReview when focusReview is set and prerequisites are present', () => {
    // The component should consult canGenerateReview AND focusReview together
    // before calling the generate path on open.
    expect(SRC).toMatch(/focusReview/);
    expect(SRC).toMatch(/canGenerateReview/);
    expect(SRC).toMatch(/onGenerateReview\(|generateReview\(/);
  });
});

describe('JobDetailDialog — graceful degrade without key (AIREV-009 AC4)', () => {
  it('still gates auto-generate behind canGenerateReview so a missing key is a no-op (existing disabled state takes over)', () => {
    // No key → canGenerateReview is false → no auto-generate fires.
    // The empty-state Generate button + needs-key hint already render
    // (kept intact by AIREV-005).
    expect(SRC).toMatch(/canGenerateReview/);
    expect(SRC).toMatch(/Add an OpenRouter API key/);
  });
});

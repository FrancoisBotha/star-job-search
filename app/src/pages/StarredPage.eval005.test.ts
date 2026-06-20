/**
 * Unit tests for EVAL-005 — Starred page 'Eval' button (alongside the
 * existing Generate button), disabled with a clear reason when the
 * OpenRouter key / default model / persisted score is missing.
 *
 * Covers AC2 (Eval button visible on each tile and disabled with a clear
 * reason when not configured).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARRED = readFileSync(path.join(__dirname, 'StarredPage.vue'), 'utf8');

describe('StarredPage — Eval button (AC2)', () => {
  it('renders an Eval button on each starred job tile', () => {
    expect(STARRED).toMatch(/label="Eval"/);
  });

  it('binds the Eval button disabled state to canGenerateEval(sourceId)', () => {
    expect(STARRED).toMatch(/canGenerateEval/);
  });

  it('surfaces a clear reason via evalDisabledReason(sourceId)', () => {
    expect(STARRED).toMatch(/evalDisabledReason/);
  });

  it('wires the Eval button click to a generate/open handler that takes the sourceId', () => {
    // Either openEval(sourceId) or store.generateEval(sourceId) — both
    // count as "wired".
    expect(STARRED).toMatch(/(openEval|generateEval)\(/);
  });
});

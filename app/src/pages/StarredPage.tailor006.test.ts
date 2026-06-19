/**
 * Unit tests for TAILOR-006 (Starred page) — Generate Tailor button per
 * starred job that deep-links to the Tailor view, disabled with a clear
 * reason when no API key / default model is configured.
 *
 * Covers AC1 (Generate button + deep-link route) and AC2 (disabled state
 * with clear reason when OpenRouter key or default model is missing).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARRED = readFileSync(path.join(__dirname, 'StarredPage.vue'), 'utf8');

describe('StarredPage — Generate Tailor button (AC1)', () => {
  it('renders a Generate button on each starred job tile', () => {
    expect(STARRED).toMatch(/label="Generate"/);
  });

  it('deep-links the Generate action to the tailor route with the job id', () => {
    // Either router push to { name: 'tailor', query: { sourceId } } or a
    // path navigate to /tailor?sourceId=... — both forms count.
    expect(STARRED).toMatch(/name:\s*['"]tailor['"]/);
    expect(STARRED).toMatch(/sourceId/);
  });
});

describe('StarredPage — Generate button disabled when not configured (AC2)', () => {
  it('binds the Generate button disabled state to a "tailoring available" gate', () => {
    // Gate is the combination of API key + default preferred model.
    expect(STARRED).toMatch(/isTailoringAvailable/);
    expect(STARRED).toMatch(/:disable/);
  });

  it('surfaces a clear reason when the gate fails (title / tooltip)', () => {
    // Reason text must mention OpenRouter key or default model so the user
    // knows where to fix it (no silent disabled).
    expect(STARRED).toMatch(/OpenRouter|default model|Settings/i);
  });
});

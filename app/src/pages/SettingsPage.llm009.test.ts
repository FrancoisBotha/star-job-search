/**
 * Unit tests for SettingsPage saved-API-key field width (LLM-009).
 *
 * Acceptance criteria:
 *  AC1: The 'Key on file · …masked' status row no longer overstretches; it
 *       sits within the same width as the API-key entry row below it.
 *  AC2: A long masked key value truncates with an ellipsis inside the key
 *       box; the 'Clear' button stays aligned and visible.
 *  AC3: Layout holds at the page max width and on narrower window sizes.
 *  AC4: Purely visual — no change to key storage, masking, or clear
 *       behavior.
 *
 * The fix is CSS-only: flex children need `min-width: 0` so long content
 * shrinks under ellipsis instead of pushing the row wide, and the saved
 * status row should align vertically with the Clear button. Both rows
 * remain card-width and use the same flex shape so they hold at the page
 * max width and at narrower window sizes.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = readFileSync(path.join(__dirname, 'SettingsPage.vue'), 'utf8');

function extractRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = SETTINGS.match(re);
  return m?.[1] ?? '';
}

describe('SettingsPage — saved-API-key row width (AC1, AC2, AC3)', () => {
  it('.key-box allows shrinking via min-width: 0 so a long masked key cannot overstretch the row', () => {
    const rule = extractRule('.key-box');
    expect(rule).toMatch(/min-width:\s*0/);
  });

  it('.key-box__val still truncates with an ellipsis inside the key box', () => {
    const rule = extractRule('.key-box__val');
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/white-space:\s*nowrap/);
  });

  it('.key-status vertically aligns the Clear button with the key box', () => {
    const rule = extractRule('.key-status');
    expect(rule).toMatch(/align-items:\s*center/);
  });

  it('.key-status uses the same flex shape as .key-row so both rows share the card width', () => {
    const status = extractRule('.key-status');
    const row = extractRule('.key-row');
    expect(status).toMatch(/display:\s*flex/);
    expect(row).toMatch(/display:\s*flex/);
  });
});

describe('SettingsPage — purely visual (AC4)', () => {
  it('still reads the masked status from the store without re-rendering the raw key', () => {
    expect(SETTINGS).toMatch(/apiKeyStatus\.masked/);
    expect(SETTINGS).not.toMatch(/v-model="store\.apiKeyStatus/);
  });

  it('still wires Clear to the existing store action', () => {
    expect(SETTINGS).toMatch(/store\.clearApiKey\(/);
    expect(SETTINGS).toMatch(/label="Clear"/);
  });
});

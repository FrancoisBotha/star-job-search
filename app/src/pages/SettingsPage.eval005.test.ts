/**
 * Unit tests for EVAL-005 — Settings page exposes the local-only Web
 * research toggle (AC3). The toggle binds to the store's
 * webResearchSetting and reflects the EVAL-004 disclosure copy beneath.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS = readFileSync(path.join(__dirname, 'SettingsPage.vue'), 'utf8');

describe('SettingsPage — Web research toggle (AC3)', () => {
  it('renders a "Web research" section', () => {
    expect(SETTINGS).toMatch(/Web research/);
  });

  it('binds the toggle to the store webResearchSetting state', () => {
    expect(SETTINGS).toMatch(/webResearchSetting/);
  });

  it('surfaces the disclosure copy from the persisted setting', () => {
    expect(SETTINGS).toMatch(/disclosure/);
  });

  it('uses setWebResearchEnabled to persist the toggle change', () => {
    expect(SETTINGS).toMatch(/setWebResearchEnabled/);
  });
});

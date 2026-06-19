/**
 * CVPROF-015 — App.vue boots the persisted profile.
 *
 * AC1: on boot, the store hydrates the persisted profile so the Profile
 * screen and every other surface (sidebar, dashboard) show the last-saved
 * values without the user having to open Onboarding first.
 *
 * Follows the repo's source-scan test pattern (see DashboardPage.score008.test.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(path.join(__dirname, 'App.vue'), 'utf8');

describe('App.vue — hydrates the persisted profile on boot (AC1)', () => {
  it('imports the app store', () => {
    expect(APP).toMatch(/useAppStore/);
  });

  it('calls store.loadProfile() inside onMounted', () => {
    expect(APP).toMatch(/onMounted/);
    expect(APP).toMatch(/store\.loadProfile\(\)/);
  });
});

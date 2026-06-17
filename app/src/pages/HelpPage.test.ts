/**
 * Unit tests for the Help page (BRWSR-008).
 *
 * The help content must describe the features delivered by Epic 1
 * (Embedded Job-Site Browser):
 *  - AC2: the embedded browser surface on Discover.
 *  - AC2: adding and removing job sites on Settings.
 *  - AC2: the Discover site dropdown.
 *  - AC2: back/forward navigation in the embedded browser.
 *  - AC3: voice/structure matches the existing file (Quasar `.vue`
 *    page with section cards and FAQs).
 *  - AC4: any new UI controls / workflows are reflected.
 *
 * Mirrors the regex-scan precedent of `DiscoverPage.test.ts`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Epic 1 features documented (BRWSR-008)', () => {
  it('describes the embedded browser on Discover', () => {
    expect(HELP).toMatch(/embedded browser/i);
    expect(HELP).toMatch(/Discover/);
  });

  it('describes adding and removing job sites on Settings', () => {
    expect(HELP).toMatch(/Settings/);
    expect(HELP).toMatch(/Job sites/i);
    expect(HELP).toMatch(/add/i);
    expect(HELP).toMatch(/remove/i);
  });

  it('describes the Discover site tabs', () => {
    expect(HELP).toMatch(/tab/i);
  });

  it('describes back/forward navigation in the embedded browser', () => {
    expect(HELP).toMatch(/back\s*\/\s*forward|back and forward/i);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

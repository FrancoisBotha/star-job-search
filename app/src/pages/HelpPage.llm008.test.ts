/**
 * Unit tests for the Help page (LLM-008).
 *
 * The "Connect an AI provider" guidance must reflect the real Settings
 * surface delivered by LLM-005 (key save/clear/test-connection) and
 * LLM-006 (preferred-models picker + default selection).
 *
 * Mirrors the regex-scan precedent of HelpPage.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Connect an AI provider guidance (LLM-008)', () => {
  it('keeps a Connect an AI provider step', () => {
    expect(HELP).toMatch(/Connect an AI provider/);
  });

  it('describes saving the OpenRouter key in Settings', () => {
    expect(HELP).toMatch(/OpenRouter/);
    expect(HELP).toMatch(/Settings/);
    expect(HELP).toMatch(/Save/);
    expect(HELP).toMatch(/key/i);
  });

  it('mentions the Test connection action', () => {
    expect(HELP).toMatch(/Test connection/);
  });

  it('describes choosing models and setting a default', () => {
    // The picker button on Settings is labelled "Select models…"
    expect(HELP).toMatch(/Select models/);
    expect(HELP).toMatch(/default/i);
    // "Set default" affordance from LLM-006
    expect(HELP).toMatch(/Set default/);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});

/**
 * Unit tests for CVPROF-007 — wire Onboarding steps 1–2 to the real
 * upload + parsed-review flow, with manual-entry fallback and the
 * one-time "what is sent" disclosure.
 *
 * Mirrors the regex-scan style used by the other page tests in this
 * repo — no @vue/test-utils.
 *
 * Acceptance criteria:
 *  1. Step 1 wires the dropzone to a real picker + upload; PDF/DOCX
 *     accepted, others rejected; progress shown during extract/structure.
 *  2. Privacy line kept + one-time "what is sent" disclosure exists.
 *  3. Step 2 shows the REAL parsed result (no PARSED_SKILLS / Alex_Morgan
 *     hardcodes), flags low-confidence fields, skills are editable.
 *  4. No-key / parse-failure fallback: retry, different file, or manual
 *     entry — no dead-end.
 *  5. Confirming step 2 persists via store.saveProfile.
 *  6. Reuses existing dropzone / chips / field styling.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'OnboardingPage.vue'), 'utf8');

describe('OnboardingPage step 1 — real upload + picker (AC1)', () => {
  it('exposes a real file input that accepts PDF and DOCX', () => {
    expect(SRC).toMatch(/<input[^>]*type="file"/);
    expect(SRC).toMatch(/accept="[^"]*\.pdf[^"]*\.docx"|accept="[^"]*\.docx[^"]*\.pdf"/);
  });

  it('the "browse files" affordance triggers the picker', () => {
    expect(SRC).toMatch(/browse files/);
    expect(SRC).toMatch(/@click="[^"]*(pickFile|openPicker|chooseFile)/);
  });

  it('wires drag-and-drop on the dropzone', () => {
    expect(SRC).toMatch(/@dragover[^=]*="[^"]+"/);
    expect(SRC).toMatch(/@drop[^=]*="[^"]+"/);
  });

  it('rejects unsupported file types with a clear message', () => {
    expect(SRC).toMatch(/PDF.*DOCX|pdf.*docx/i);
    expect(SRC).toMatch(/fileError|uploadError/);
  });

  it('shows progress while extracting / structuring', () => {
    expect(SRC).toMatch(/cvParseStatus/);
    // shows "Extracting" or "Structuring" copy bound to the status
    expect(SRC).toMatch(/Extracting|Reading|Structuring|Analysing|Analyzing/i);
  });

  it('calls the store.uploadCv + store.structureCv flow', () => {
    expect(SRC).toMatch(/store\.uploadCv\(/);
    expect(SRC).toMatch(/store\.structureCv\(/);
  });
});

describe('OnboardingPage step 1 — privacy + "what is sent" disclosure (AC2)', () => {
  it('keeps the "stays on this device" privacy line', () => {
    expect(SRC).toMatch(/stays on this device/);
  });

  it('mounts a one-time "what is sent" disclosure dialog', () => {
    expect(SRC).toMatch(/<q-dialog/);
    expect(SRC).toMatch(/what (?:is|we) send|What (?:we|is) send/i);
  });

  it('the disclosure is shown before the first model call (gated by a flag)', () => {
    // a "disclosure shown / acknowledged" flag controls structuring
    expect(SRC).toMatch(/disclosureAcknowledged|showDisclosure|hasSeenDisclosure/);
  });
});

describe('OnboardingPage step 2 — real parsed result, no mocks (AC3)', () => {
  it('does not import PARSED_SKILLS', () => {
    expect(SRC).not.toMatch(/PARSED_SKILLS/);
  });

  it('does not hardcode Alex_Morgan or "Alex Morgan"', () => {
    expect(SRC).not.toMatch(/Alex_Morgan/);
    expect(SRC).not.toMatch(/Alex Morgan/);
  });

  it('does not hardcode "Senior Product Designer" / "6 years" / "London, UK"', () => {
    expect(SRC).not.toMatch(/Senior Product Designer'/);
    expect(SRC).not.toMatch(/'6 years'/);
    expect(SRC).not.toMatch(/'London, UK'/);
  });

  it('binds the parsed fields from the store', () => {
    // Step 2 reads from currentCv.parsedFields and store.profile
    expect(SRC).toMatch(/parsedFields|currentCv/);
  });

  it('flags low-confidence fields', () => {
    expect(SRC).toMatch(/confidence/);
    expect(SRC).toMatch(/low.?confidence|uncertain|isLowConfidence|low-confidence/i);
  });

  it('renders skill chips that can be removed', () => {
    expect(SRC).toMatch(/skill__x/);
    expect(SRC).toMatch(/@click="[^"]*removeSkill/);
  });

  it('allows adding a new skill chip', () => {
    expect(SRC).toMatch(/addSkill/);
  });
});

describe('OnboardingPage — no-key / failure fallback (AC4)', () => {
  it('offers a manual-entry path when no key or parsing fails', () => {
    expect(SRC).toMatch(/manual|Manual entry|Enter manually/i);
  });

  it('offers a retry and a different-file affordance', () => {
    expect(SRC).toMatch(/Retry|Try again/i);
    expect(SRC).toMatch(/different file|Upload a different|another file/i);
  });

  it('the structuring path is gated by the API-key status', () => {
    expect(SRC).toMatch(/apiKeyStatus/);
  });
});

describe('OnboardingPage — confirming step 2 persists the profile (AC5)', () => {
  it('Continue from step 2 calls store.saveProfile', () => {
    expect(SRC).toMatch(/store\.saveProfile\(/);
  });

  it('hydrates the existing profile + API-key status on mount', () => {
    expect(SRC).toMatch(/store\.loadProfile\(\)/);
    expect(SRC).toMatch(/hydrateApiKeyStatus\(\)/);
  });
});

describe('OnboardingPage — reuses existing Studio styling (AC6)', () => {
  it('reuses the existing dropzone class', () => {
    expect(SRC).toMatch(/class="dropzone/);
  });

  it('reuses the existing skill chip class', () => {
    expect(SRC).toMatch(/class="skill/);
  });

  it('reuses existing field / grid classes', () => {
    expect(SRC).toMatch(/class="grid2/);
    expect(SRC).toMatch(/class="lbl/);
  });
});

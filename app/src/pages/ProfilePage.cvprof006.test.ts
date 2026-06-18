/**
 * Unit tests for CVPROF-006: wire the Profile screen to real Profile + CV
 * state — CV card/Replace, links, target & preferences, profile-strength
 * rail, minimum-scorable gate.
 *
 * Mirrors the regex-scan style used by other component/page tests in this
 * repo — no @vue/test-utils.
 *
 * Acceptance criteria:
 *  1. CV card shows the real current CV (file name + uploaded-at + parse
 *     status) instead of the Alex_Morgan_CV.pdf mock.
 *  2. Replace dropzone re-uploads via a real picker → new CV version + re-
 *     derives profile (FR-006); accepts PDF/DOCX only and rejects others
 *     with a clear message; UI stays responsive during extract/structure
 *     (NFR-003).
 *  3. Editable links (LinkedIn + portfolio) and target & preferences
 *     (target role, min salary + currency, work-mode toggle) bind to and
 *     persist the real Profile (FR-007/FR-008).
 *  4. Profile-strength rail reflects real completeness and exposes the
 *     rubric (what raises it) — replaces the fixed "85/100".
 *  5. Minimum-scorable gate states what is missing (FR-010).
 *  6. "Re-scan with new profile" button remains but only marks scores
 *     stale here — no star score / breakdown shown.
 *  7. Reuses the existing dropzone/chips/field/rail styling — no new
 *     tokens, colours, or components.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'ProfilePage.vue'), 'utf8');

describe('ProfilePage — CV card shows the real CV (AC1)', () => {
  it('no longer hard-codes Alex_Morgan_CV.pdf', () => {
    expect(SRC).not.toMatch(/Alex_Morgan_CV\.pdf/);
  });

  it('binds the file name from the real currentCv', () => {
    expect(SRC).toMatch(/store\.currentCv/);
    expect(SRC).toMatch(/currentCv[^}]*fileName/);
  });

  it('renders uploaded-at and parse status from the store', () => {
    expect(SRC).toMatch(/uploadedAt/);
    expect(SRC).toMatch(/cvParseStatus/);
  });

  it('does not import the PARSED_SKILLS sample mock', () => {
    expect(SRC).not.toMatch(/PARSED_SKILLS/);
    expect(SRC).not.toMatch(/from ['"]src\/data\/sample['"]/);
  });
});

describe('ProfilePage — Replace dropzone uploads a new CV version (AC2 / FR-006)', () => {
  it('renders a real file <input type="file"> picker (drag/drop or click)', () => {
    expect(SRC).toMatch(/<input[^>]*type="file"/);
  });

  it('restricts the picker to PDF and DOCX (accept attribute)', () => {
    const input = SRC.match(/<input[^>]*type="file"[^>]*>/);
    expect(input).not.toBeNull();
    expect(input![0]).toMatch(/accept="[^"]*\.pdf[^"]*\.docx|accept="[^"]*\.docx[^"]*\.pdf/);
  });

  it('rejects unsupported types with a clear message exposed to the user', () => {
    // A user-visible reject message and the matching unsupported-type guard.
    expect(SRC).toMatch(/Only PDF or DOCX|PDF or DOCX|unsupported|Unsupported/);
  });

  it('invokes store.replaceCv (or uploadCv) so a new version is created and the profile re-derives', () => {
    expect(SRC).toMatch(/store\.(replaceCv|uploadCv)\(/);
  });

  it('shows progress while extracting / structuring (NFR-003)', () => {
    expect(SRC).toMatch(/extracting|structuring/);
  });
});

describe('ProfilePage — Links and preferences bind to and persist the Profile (AC3)', () => {
  it('binds LinkedIn input to the persisted profile (not a local ref)', () => {
    const linkedin = SRC.match(/<q-input[^>]*label="LinkedIn profile"[^>]*\/?>/);
    expect(linkedin).not.toBeNull();
    // No `v-model="linkedin"` local ref — must point at profile state.
    expect(linkedin![0]).not.toMatch(/v-model="linkedin"/);
    // Some binding to profile is required (model-value or v-model).
    expect(linkedin![0]).toMatch(/profile\??\./);
  });

  it('persists the LinkedIn URL through store.saveProfile', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{\s*linkedinUrl/);
  });

  it('persists the target role through store.saveProfile', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{\s*targetRole/);
  });

  it('persists the min salary (and currency) through store.saveProfile', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{[^}]*salaryMin/);
    expect(SRC).toMatch(/salaryCurrency/);
  });

  it('persists the work mode through store.setWorkMode (or saveProfile workMode)', () => {
    expect(SRC).toMatch(/setWorkMode\(|saveProfile\(\s*\{\s*workMode/);
    // Must not write directly to the legacy local mutation pattern.
    expect(SRC).not.toMatch(/store\.workMode\s*=\s*m/);
  });

  it('reflects the active work-mode from the persisted profile (not the local mirror only)', () => {
    expect(SRC).toMatch(/profile\?\.workMode|profile\.workMode/);
  });
});

describe('ProfilePage — Profile-strength rail reflects real completeness (AC4)', () => {
  it('does not hard-code 85/100', () => {
    expect(SRC).not.toMatch(/>85<|"85"|\b85\/100\b/);
    expect(SRC).not.toMatch(/:value="0\.85"/);
  });

  it('renders the real profileStrength getter', () => {
    expect(SRC).toMatch(/store\.profileStrength|profileStrength/);
  });

  it('exposes the rubric (what raises strength) via strengthRubric', () => {
    expect(SRC).toMatch(/strengthRubric/);
  });

  it('iterates the rubric in the checklist so each rubric row appears', () => {
    expect(SRC).toMatch(/v-for="[^"]*\s+in\s+[^"]*strengthRubric/);
  });
});

describe('ProfilePage — minimum-scorable gate states what is missing (AC5 / FR-010)', () => {
  it('reads the missingScoringFields list from the store', () => {
    expect(SRC).toMatch(/missingScoringFields/);
  });

  it('reads isScorable from the store so the gate can branch on it', () => {
    expect(SRC).toMatch(/isScorable/);
  });

  it('names the four FR-010 fields in the missing-fields copy', () => {
    // The Profile screen must surface "what is missing" — at minimum it
    // must spell out each FR-010 field somewhere in the gate area.
    expect(SRC).toMatch(/target role/i);
    expect(SRC).toMatch(/skill/i);
    expect(SRC).toMatch(/location/i);
    expect(SRC).toMatch(/work mode/i);
  });
});

describe('ProfilePage — Re-scan marks stale (AC6 — scope boundary)', () => {
  it("still renders the 'Re-scan with new profile' button", () => {
    expect(SRC).toMatch(/label="Re-scan with new profile"/);
  });

  it('the Re-scan click only marks scores stale here (no scoring call)', () => {
    const rescan = SRC.match(/<q-btn[^>]*label="Re-scan with new profile"[^>]*\/?>/);
    expect(rescan).not.toBeNull();
    expect(rescan![0]).toMatch(/@click="[^"]*scoresStale[^"]*"|@click="[^"]*markScoresStale[^"]*"/);
  });

  it('does not render a star match score / explainable breakdown (scope boundary)', () => {
    // No 1-5 star match score; no factor breakdown. The rubric checklist
    // is allowed — those are profile-strength rows, not match factors.
    expect(SRC).not.toMatch(/match\s*score|star\s*rating|factor\s*breakdown/i);
  });
});

describe('ProfilePage — reuses existing Studio styling (AC7)', () => {
  it('still uses the cv-card / dropzone / chip / field / strength styles', () => {
    expect(SRC).toMatch(/class="cv-card"/);
    expect(SRC).toMatch(/class="dropzone"/);
    expect(SRC).toMatch(/class="chip\b|class="chips"/);
    expect(SRC).toMatch(/class="field"/);
    expect(SRC).toMatch(/class="strength"/);
  });
});

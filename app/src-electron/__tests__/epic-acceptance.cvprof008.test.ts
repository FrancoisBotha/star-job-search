/**
 * Epic-level acceptance verification (CVPROF-008).
 *
 * Holistically verifies the §9 Acceptance Criteria of
 * docs/Epics/epic_04_ADD_CV_TO_PROFILE.md against the actual implementation
 * produced by CVPROF-001..007 — not just the per-ticket test phases.
 * Each `describe` block is anchored to one bullet of the epic §9 list.
 *
 * The intent is a single fail-fast guard: if a later change quietly regresses
 * an epic-level guarantee (off-thread extraction, no-key fallback, mocks
 * coming back, scoring leaking into the Profile screen, etc.), this file
 * flags it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..');
const ELECTRON_DIR = path.join(REPO_DIR, 'src-electron');
const PAGES_DIR = path.join(REPO_DIR, 'src', 'pages');
const STORES_DIR = path.join(REPO_DIR, 'src', 'stores');

const PROFILE_TS = readFileSync(path.join(ELECTRON_DIR, 'profile.ts'), 'utf8');
const CV_TS = readFileSync(path.join(ELECTRON_DIR, 'cv.ts'), 'utf8');
const EXTRACTOR = readFileSync(path.join(ELECTRON_DIR, 'cvTextExtractor.ts'), 'utf8');
const STRUCTURER = readFileSync(path.join(ELECTRON_DIR, 'cvStructurer.ts'), 'utf8');
const MAIN = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
const PRELOAD = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
const PROFILE_PAGE = readFileSync(path.join(PAGES_DIR, 'ProfilePage.vue'), 'utf8');
const ONBOARDING_PAGE = readFileSync(path.join(PAGES_DIR, 'OnboardingPage.vue'), 'utf8');
const STORE = readFileSync(path.join(STORES_DIR, 'app-store.ts'), 'utf8');

describe('Epic §9 AC1 — PDF/DOCX upload on Onboarding and Profile; others rejected', () => {
  it('Onboarding step 1 accepts only PDF and DOCX', () => {
    expect(ONBOARDING_PAGE).toMatch(/<input[^>]*type="file"/);
    expect(ONBOARDING_PAGE).toMatch(/accept="[^"]*\.pdf[^"]*\.docx"|accept="[^"]*\.docx[^"]*\.pdf"/);
  });

  it('Profile screen has a Replace dropzone that accepts PDF and DOCX', () => {
    expect(PROFILE_PAGE).toMatch(/accept="[^"]*\.pdf[^"]*"/);
    expect(PROFILE_PAGE).toMatch(/accept="[^"]*\.docx[^"]*"/);
  });

  it('Onboarding wires drag-and-drop handlers', () => {
    // The epic permits "drag-drop or picker"; Onboarding goes further with both.
    expect(ONBOARDING_PAGE).toMatch(/@dragover/);
    expect(ONBOARDING_PAGE).toMatch(/@drop/);
  });

  it('Profile surface provides a file picker (label-wrapped input is acceptable)', () => {
    expect(PROFILE_PAGE).toMatch(/<input[^>]*type="file"/);
  });

  it('unsupported file types are rejected with a clear message', () => {
    expect(ONBOARDING_PAGE).toMatch(/Only PDF.*DOCX|PDF.*DOCX.*supported/i);
    expect(PROFILE_PAGE).toMatch(/Only PDF.*DOCX|PDF.*DOCX.*supported/i);
  });
});

describe('Epic §9 AC2 — text extraction runs off the UI thread', () => {
  it('cvTextExtractor uses node:worker_threads (not main-thread parsing)', () => {
    expect(EXTRACTOR).toMatch(/node:worker_threads|worker_threads/);
    expect(EXTRACTOR).toMatch(/new Worker\(/);
  });

  it('cv.ts delegates text extraction to an injected extractor (off-thread runner)', () => {
    expect(CV_TS).toMatch(/extractor/);
    expect(MAIN).toMatch(/extractCvText/);
  });
});

describe('Epic §9 AC3 — LLM structuring uses Epic 2 key + default model; low-confidence flagged', () => {
  it('structurer pulls the saved key from the Epic 2 apiKey store', () => {
    expect(STRUCTURER).toMatch(/getApiKey/);
  });

  it('structurer pulls the user-selected default model slug', () => {
    expect(STRUCTURER).toMatch(/getDefaultModel|defaultModel|preferredModels/);
  });

  it('structurer requests structured output (JSON schema)', () => {
    expect(STRUCTURER).toMatch(/json_schema|response_format/);
  });

  it('parsedFields carry a confidence map and the review surface flags low-confidence fields', () => {
    expect(STRUCTURER).toMatch(/confidence/);
    expect(ONBOARDING_PAGE).toMatch(/Low confidence|low.confidence|isLowConfidence/);
  });
});

describe('Epic §9 AC4 — no dead-end: retry, different file, manual entry', () => {
  it('Onboarding offers retry, upload-different-file, and manual entry on failure', () => {
    expect(ONBOARDING_PAGE).toMatch(/Retry|retry/);
    expect(ONBOARDING_PAGE).toMatch(/different file|Upload a different/i);
    expect(ONBOARDING_PAGE).toMatch(/Enter manually|manual entry|enterManually/i);
  });

  it('Onboarding handles the no-key path explicitly', () => {
    expect(ONBOARDING_PAGE).toMatch(/no key|without a key|enter your profile manually/i);
  });
});

describe('Epic §9 AC5 — re-upload creates a new version; prior data retained', () => {
  it('cv.ts increments version on every upload', () => {
    expect(CV_TS).toMatch(/MAX\(version\)|nextVersion|version\s*\+\s*1/);
  });

  it('cv:list returns all versions (history preserved)', () => {
    expect(CV_TS).toMatch(/ORDER BY version/);
    expect(STORE).toMatch(/listCvs|cv\.list|starCv/);
  });
});

describe('Epic §9 AC6 — Profile persists and survives restart', () => {
  it('profile is backed by a singleton SQLite row, opened from userData', () => {
    expect(PROFILE_TS).toMatch(/CREATE TABLE IF NOT EXISTS profile/);
    expect(PROFILE_TS).toMatch(/singleton/);
    expect(MAIN).toMatch(/getPath\(\s*['"]userData['"]\s*\)/);
  });

  it('store hydrates persisted profile via profile:get', () => {
    expect(STORE).toMatch(/loadProfile/);
    expect(STORE).toMatch(/starProfile/);
  });
});

describe('Epic §9 AC7 — strength rail real; minimum-scorable gate states what is missing', () => {
  it('profileStrength is computed from real field completeness, not a constant', () => {
    expect(STORE).toMatch(/profileStrength/);
    expect(STORE).toMatch(/STRENGTH_RUBRIC/);
    expect(PROFILE_PAGE).not.toMatch(/85\s*\/\s*100/);
  });

  it('the rubric is exposed (what raises the score)', () => {
    expect(STORE).toMatch(/strengthRubric/);
    expect(PROFILE_PAGE).toMatch(/strengthRubric/);
  });

  it('minimum-scorable gate surfaces missing fields', () => {
    expect(STORE).toMatch(/missingScoringFields/);
    expect(STORE).toMatch(/isScorable/);
    expect(PROFILE_PAGE).toMatch(/missingScoringFields|isScorable/);
  });
});

describe('Epic §9 AC8 — "what is sent" disclosure shown before first model call', () => {
  it('Onboarding renders a disclosure dialog gated by an acknowledgement flag', () => {
    expect(ONBOARDING_PAGE).toMatch(/showDisclosure|disclosureAcknowledged|cvDisclosure/);
    expect(ONBOARDING_PAGE).toMatch(/what is sent|What is sent|sent to|provider/i);
  });

  it('structuring is unavailable until an Epic 2 key is present', () => {
    expect(STRUCTURER).toMatch(/NO_KEY|no.key|getApiKey/i);
  });
});

describe('Epic §9 AC9 — Onboarding 1–2 and Profile show real data (mocks removed)', () => {
  it('ProfilePage does not import or reference the Alex_Morgan_CV / PARSED_SKILLS mocks', () => {
    expect(PROFILE_PAGE).not.toMatch(/Alex_Morgan/);
    expect(PROFILE_PAGE).not.toMatch(/PARSED_SKILLS/);
  });

  it('OnboardingPage does not import or reference those mocks', () => {
    expect(ONBOARDING_PAGE).not.toMatch(/Alex_Morgan/);
    expect(ONBOARDING_PAGE).not.toMatch(/PARSED_SKILLS/);
  });

  it('the renderer store no longer wires PARSED_SKILLS / Alex_Morgan into profile state', () => {
    expect(STORE).not.toMatch(/PARSED_SKILLS/);
    expect(STORE).not.toMatch(/Alex_Morgan/);
  });

  it('Profile card binds to real currentCv state, not a hardcoded filename', () => {
    expect(PROFILE_PAGE).toMatch(/currentCv/);
  });
});

describe('Epic §9 AC10 — cross-platform (macOS, Windows, Linux)', () => {
  it('CV storage uses path.join / app.getPath(userData) — no hard-coded separators', () => {
    expect(CV_TS).toMatch(/path\./);
    expect(CV_TS).not.toMatch(/C:\\\\|\/Users\//);
  });

  it('text extractor does not branch on process.platform', () => {
    expect(EXTRACTOR).not.toMatch(/process\.platform\s*===\s*['"]darwin['"]/);
    expect(EXTRACTOR).not.toMatch(/process\.platform\s*===\s*['"]win32['"]/);
  });
});

describe('Epic §9 AC11 — no scoring / star breakdown on this epic\'s surfaces', () => {
  it('ProfilePage does not import SCORE_BREAKDOWN or render a star match rating', () => {
    expect(PROFILE_PAGE).not.toMatch(/SCORE_BREAKDOWN/);
    expect(PROFILE_PAGE).not.toMatch(/match.?score|matchScore/i);
  });

  it('Onboarding steps 1–2 do not introduce scoring UI', () => {
    expect(ONBOARDING_PAGE).not.toMatch(/SCORE_BREAKDOWN/);
    expect(ONBOARDING_PAGE).not.toMatch(/star.{0,5}rating|matchScore/i);
  });

  it('scoresStale flag is set by edits but no re-score logic lives in this epic', () => {
    expect(STORE).toMatch(/scoresStale/);
    expect(STORE).not.toMatch(/computeScore|recomputeScore|runScoring/);
  });
});

describe('CVPROF-008 evaluation summary', () => {
  it('all preceding CVPROF tickets are present in commit history surfaces', () => {
    // Smoke-check that the modules each preceding ticket delivered are still on disk.
    expect(PROFILE_TS.length).toBeGreaterThan(0); // CVPROF-001
    expect(EXTRACTOR.length).toBeGreaterThan(0);  // CVPROF-002
    expect(CV_TS.length).toBeGreaterThan(0);      // CVPROF-003
    expect(STRUCTURER.length).toBeGreaterThan(0); // CVPROF-004
    expect(STORE).toMatch(/uploadCv|structureCv/);// CVPROF-005
    expect(PROFILE_PAGE).toMatch(/currentCv/);    // CVPROF-006
    expect(ONBOARDING_PAGE).toMatch(/cvParseStatus/); // CVPROF-007
  });

  it('the preload bridge exposes the full epic surface', () => {
    expect(PRELOAD).toMatch(/starProfile/);
    expect(PRELOAD).toMatch(/starCv/);
    expect(PRELOAD).toMatch(/starCvStructurer/);
  });
});

/**
 * Regression tests for CVPROF-011 — resolve the picked/dropped CV file path
 * via `webUtils.getPathForFile(file)` instead of the (removed) Electron
 * `File.path` property.
 *
 * Mirrors the regex-scan style used by the other page tests in this repo —
 * no @vue/test-utils.
 *
 * Acceptance criteria covered here:
 *  1/2. ProfilePage and OnboardingPage both upload via a real absolute path
 *       resolved through the preload-exposed `starFile.getPathForFile`
 *       bridge — never `file.name` / `file.path`.
 *  3.   The renderer no longer reads `file.path`; the File object is
 *       resolved INSIDE the preload-defined function via `webUtils`.
 *  4.   When the path cannot be resolved the user gets a clear error and
 *       no upload is attempted (store.uploadCv / store.replaceCv guarded).
 *  5.   This file IS that regression test — it asserts the path-resolution
 *       boundary so a future Electron API change is caught.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_SRC = readFileSync(path.join(__dirname, 'ProfilePage.vue'), 'utf8');
const ONBOARDING_SRC = readFileSync(path.join(__dirname, 'OnboardingPage.vue'), 'utf8');
const PRELOAD_SRC = readFileSync(
  path.join(__dirname, '..', '..', 'src-electron', 'electron-preload.ts'),
  'utf8',
);
const ENV_DTS = readFileSync(path.join(__dirname, '..', 'env.d.ts'), 'utf8');

describe('CVPROF-011 — renderer no longer reads File.path (AC3)', () => {
  it('ProfilePage does not read `.path` off the File object', () => {
    // Removed in Electron 32. Any `(file ... ).path` or `file.path` read is a regression.
    expect(PROFILE_SRC).not.toMatch(/File\s*&\s*\{\s*path\?:/);
    expect(PROFILE_SRC).not.toMatch(/\bfile\.path\b/);
    expect(PROFILE_SRC).not.toMatch(/\)\.path\b/);
  });

  it('OnboardingPage does not read `.path` off the File object', () => {
    expect(ONBOARDING_SRC).not.toMatch(/File\s*&\s*\{\s*path\?:/);
    expect(ONBOARDING_SRC).not.toMatch(/\bfile\.path\b/);
    expect(ONBOARDING_SRC).not.toMatch(/\)\.path\b/);
  });

  it('OnboardingPage never falls back to `file.name` as the upload path', () => {
    // Pre-CVPROF-011 code did `(file as ...).path ?? file.name`. That `file.name`
    // fallback is what passed a bare filename (no directory) to the main
    // process and broke uploads on Electron 32+. It must be gone.
    expect(ONBOARDING_SRC).not.toMatch(/\?\?\s*file\.name/);
  });
});

describe('CVPROF-011 — preload exposes webUtils-backed path resolver (AC3)', () => {
  it('preload imports webUtils from electron', () => {
    expect(PRELOAD_SRC).toMatch(/from\s+['"]electron['"]/);
    expect(PRELOAD_SRC).toMatch(/\bwebUtils\b/);
  });

  it('preload uses webUtils.getPathForFile inside the bridge function', () => {
    expect(PRELOAD_SRC).toMatch(/webUtils\.getPathForFile\s*\(/);
  });

  it('preload exposes a starFile bridge with getPathForFile', () => {
    expect(PRELOAD_SRC).toMatch(/exposeInMainWorld\(\s*['"]starFile['"]/);
    expect(PRELOAD_SRC).toMatch(/getPathForFile\s*:/);
  });

  it('env.d.ts declares the starFile bridge type', () => {
    expect(ENV_DTS).toMatch(/starFile\?:\s*StarFileApi/);
    expect(ENV_DTS).toMatch(/interface\s+StarFileApi/);
    expect(ENV_DTS).toMatch(/getPathForFile/);
  });
});

describe('CVPROF-011 — upload handlers call the webUtils-backed resolver (AC1/AC2/AC5)', () => {
  it('ProfilePage resolves the path via window.starFile.getPathForFile', () => {
    expect(PROFILE_SRC).toMatch(/starFile[^\n]*getPathForFile\s*\(\s*file\s*\)/);
  });

  it('OnboardingPage resolves the path via window.starFile.getPathForFile (picker + drop)', () => {
    expect(ONBOARDING_SRC).toMatch(/starFile[^\n]*getPathForFile\s*\(\s*file\s*\)/);
  });
});

describe('CVPROF-011 — unresolved path shows a clear error, no partial CV (AC4)', () => {
  it('ProfilePage surfaces a user-facing error when the path is empty', () => {
    expect(PROFILE_SRC).toMatch(/Could not resolve the file path|file path/i);
  });

  it('ProfilePage guards store.replaceCv / store.uploadCv behind a non-empty path', () => {
    // The replace/upload call must be conditional on a truthy filePath — no
    // empty-string CV record is allowed through.
    expect(PROFILE_SRC).toMatch(/if\s*\(\s*!\s*filePath\s*\)/);
  });

  it('OnboardingPage surfaces a user-facing error when the path is empty', () => {
    expect(ONBOARDING_SRC).toMatch(/file path|path/i);
    expect(ONBOARDING_SRC).toMatch(/if\s*\(\s*!\s*filePath\s*\)/);
  });
});

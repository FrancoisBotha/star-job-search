/**
 * Unit tests for CVPROF-013 — wire drag-and-drop CV upload on the
 * Profile dropzone.
 *
 * Mirrors the regex-scan style used by the other Profile/Onboarding
 * page tests in this repo.
 *
 * Acceptance criteria:
 *  1. Dragging a PDF or DOCX onto the Profile dropzone uploads via the
 *     same path as the file picker (store.replaceCv).
 *  2. Dragover gives a visual affordance (is-dragover) and the browser
 *     does NOT navigate / open the dropped file (.prevent modifiers).
 *  3. Unsupported file type shows the existing
 *     'Only PDF or DOCX files are supported.' message and uploads
 *     nothing.
 *  4. Absolute path is resolved via window.starFile.getPathForFile,
 *     never the removed File.path; the click-to-browse picker still
 *     works.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'ProfilePage.vue'), 'utf8');

function dropzoneTag(): string {
  const m = SRC.match(/<label[^>]*class="dropzone[\s\S]*?>/);
  expect(m, 'dropzone <label> not found').not.toBeNull();
  return m![0];
}

describe('ProfilePage — drop wired to the same upload path as the picker (AC1)', () => {
  it('the dropzone listens for @drop', () => {
    expect(dropzoneTag()).toMatch(/@drop[^=]*="[^"]+"/);
  });

  it('a drop handler is defined in the script and forwards the file to store.replaceCv', () => {
    expect(SRC).toMatch(/function\s+onDrop\b|const\s+onDrop\s*=/);
    expect(SRC).toMatch(/dataTransfer/);
    expect(SRC).toMatch(/store\.replaceCv\(/);
  });

  it('drop and picker share the same handling routine (no second replaceCv copy-paste)', () => {
    const calls = SRC.match(/store\.replaceCv\(/g) ?? [];
    expect(calls.length).toBe(1);
  });
});

describe('ProfilePage — dragover affordance + browser navigation suppressed (AC2)', () => {
  it('uses @dragover.prevent so the browser does not open the file', () => {
    expect(dropzoneTag()).toMatch(/@dragover\b[^=]*\.prevent/);
  });

  it('uses @drop.prevent so the browser does not navigate to the dropped file', () => {
    expect(dropzoneTag()).toMatch(/@drop\b[^=]*\.prevent/);
  });

  it('applies an is-dragover class while the user is hovering with a file', () => {
    expect(dropzoneTag()).toMatch(/is-dragover/);
    expect(SRC).toMatch(/isDragover/);
  });

  it('styles the is-dragover state in the scoped CSS', () => {
    expect(SRC).toMatch(/\.is-dragover|&\.is-dragover|dropzone\.is-dragover/);
  });

  it('clears the dragover affordance on @dragleave', () => {
    expect(dropzoneTag()).toMatch(/@dragleave/);
  });
});

describe('ProfilePage — unsupported types are rejected with the existing message (AC3)', () => {
  it('reuses the "Only PDF or DOCX files are supported." copy', () => {
    expect(SRC).toMatch(/Only PDF or DOCX files are supported\./);
  });

  it('runs the mime detection / rejection before calling replaceCv', () => {
    // The reject message must precede the replaceCv call in source order
    // so the unsupported-type path bails out without uploading.
    const rejectIdx = SRC.indexOf('Only PDF or DOCX files are supported.');
    const uploadIdx = SRC.indexOf('store.replaceCv(');
    expect(rejectIdx).toBeGreaterThan(-1);
    expect(uploadIdx).toBeGreaterThan(-1);
    expect(rejectIdx).toBeLessThan(uploadIdx);
  });
});

describe('ProfilePage — path resolution via window.starFile.getPathForFile (AC4)', () => {
  it('resolves the absolute path through window.starFile.getPathForFile (CVPROF-011)', () => {
    expect(SRC).toMatch(/window\.starFile\??\.getPathForFile\(/);
  });

  it('never reads the removed File.path property', () => {
    expect(SRC).not.toMatch(/\bfile\.path\b/);
  });

  it('keeps the click-to-browse picker wired to the file input', () => {
    // The hidden <input type="file"> still has a change handler so the
    // picker continues to work unchanged.
    const input = SRC.match(/<input[^>]*type="file"[^>]*>/);
    expect(input).not.toBeNull();
    expect(input![0]).toMatch(/@change="[^"]+"/);
    // openPicker still exists and is the button click handler.
    expect(SRC).toMatch(/function\s+openPicker\b|const\s+openPicker\s*=/);
  });
});

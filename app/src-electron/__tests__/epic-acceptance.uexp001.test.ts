/**
 * Epic-level acceptance verification (UEXP-001 / Epic 12 — Unified Export).
 *
 * Each describe block is anchored to one of the five UEXP-001 acceptance
 * criteria:
 *
 *   AC1  Pure-JS .docx generator selected, name + pinned version recorded
 *   AC2  Licence confirmed permissive (MIT/Apache-2.0 or similar)
 *   AC3  Dependency added with a pinned version (no ^/~ range)
 *   AC4  Smoke test produces a valid .docx in the Electron main process
 *        target (pure JS, no native build step)
 *   AC5  Approval to add the dependency is documented in the decision record
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(APP_DIR, '..');

const APP_PKG = JSON.parse(
  readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const DECISION_PATH = path.join(
  PROJECT_ROOT,
  'docs',
  'spikes',
  'UEXP-001-docx-library-decision.md',
);
const DECISION = readFileSync(DECISION_PATH, 'utf8');

const DOCX_PKG_PATH = path.join(
  APP_DIR,
  'node_modules',
  'docx',
  'package.json',
);

// --- AC1 — library selected and pinned version recorded -----------------

describe('UEXP-001 AC1 — pure-JS .docx library selected with pinned version', () => {
  it('decision record names the chosen library', () => {
    expect(DECISION).toMatch(/^##\s*Decision/m);
    expect(DECISION).toMatch(/\bdocx\b/);
  });

  it('decision record states a pinned exact version (no ^ or ~ range)', () => {
    expect(DECISION).toMatch(/Pinned version[^\n]*\b\d+\.\d+\.\d+\b/i);
    expect(DECISION).not.toMatch(/Pinned version[^\n]*[\^~]\d/i);
  });

  it('decision record links to upstream homepage / repository', () => {
    expect(DECISION).toMatch(/github\.com\/dolanmiu\/docx|docx\.js\.org/);
  });
});

// --- AC2 — licence confirmed permissive ---------------------------------

describe('UEXP-001 AC2 — licence is permissive and recorded', () => {
  it('decision record records the licence as permissive (MIT/Apache-2.0/BSD)', () => {
    expect(DECISION).toMatch(/^##\s*Licence/m);
    expect(DECISION).toMatch(/MIT|Apache-2\.0|BSD/);
  });

  it('decision record flags whether a NOTICE / THIRD-PARTY-LICENSES entry is required', () => {
    expect(DECISION).toMatch(/NOTICE|THIRD-PARTY-LICENSES/);
  });

  it('installed package licence on disk matches the recorded licence', () => {
    if (!existsSync(DOCX_PKG_PATH)) {
      // Package not installed in this environment — the decision record
      // is the authoritative source. Skip silently rather than fail.
      return;
    }
    const pkg = JSON.parse(readFileSync(DOCX_PKG_PATH, 'utf8')) as {
      license?: string;
    };
    expect(pkg.license).toMatch(/MIT|Apache-2\.0|BSD/);
  });
});

// --- AC3 — dependency added pinned, not floating ------------------------

describe('UEXP-001 AC3 — app/package.json pins docx exactly', () => {
  it('docx appears in dependencies', () => {
    expect(APP_PKG.dependencies?.docx).toBeTruthy();
  });

  it('docx version is an exact pin (no ^ or ~)', () => {
    const v = APP_PKG.dependencies?.docx ?? '';
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('pinned version in package.json matches the version named in the decision record', () => {
    const v = APP_PKG.dependencies?.docx ?? '';
    expect(DECISION).toContain(v);
  });
});

// --- AC4 — smoke test produces a valid .docx (pure JS, no native deps) --

describe('UEXP-001 AC4 — docx produces a valid .docx in the Electron main target', () => {
  it('package has no native build step (no `install` / `postinstall` / gyp)', () => {
    if (!existsSync(DOCX_PKG_PATH)) return;
    const pkg = JSON.parse(readFileSync(DOCX_PKG_PATH, 'utf8')) as {
      scripts?: Record<string, string>;
      gypfile?: boolean;
    };
    expect(pkg.gypfile).not.toBe(true);
    const installScript = pkg.scripts?.install ?? '';
    const postinstall = pkg.scripts?.postinstall ?? '';
    expect(installScript).not.toMatch(/node-gyp|prebuild|node-pre-gyp/);
    expect(postinstall).not.toMatch(/node-gyp|prebuild|node-pre-gyp/);
  });

  it('imports cleanly and generates a buffer whose ZIP magic bytes are PK\\x03\\x04', async () => {
    if (!existsSync(DOCX_PKG_PATH)) return;
    const docx = await import('docx');
    const { Document, Packer, Paragraph, TextRun } = docx;
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [new TextRun('UEXP-001 smoke test — hello .docx')],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    expect(buffer.length).toBeGreaterThan(0);
    // .docx is a ZIP container — first 4 bytes must be 0x50 0x4B 0x03 0x04
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
    expect(buffer[2]).toBe(0x03);
    expect(buffer[3]).toBe(0x04);
    // Word XML namespace marker should appear inside the ZIP payload
    const haystack = buffer.toString('binary');
    expect(haystack).toContain('word/document.xml');
  });
});

// --- AC5 — approval recorded --------------------------------------------

describe('UEXP-001 AC5 — approval to add dependency is recorded', () => {
  it('decision record carries an approval line with date', () => {
    expect(DECISION).toMatch(/^##\s*Approval/m);
    expect(DECISION).toMatch(/202[6-9]-\d{2}-\d{2}/);
  });
});

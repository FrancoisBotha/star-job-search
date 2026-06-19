/**
 * Unit tests for the PDF-export core (PDFEX-002 / Epic 8).
 *
 * Each describe block is anchored to one of the six PDFEX-002 acceptance
 * criteria:
 *
 *   AC1  Maps an Epic 7 tailored doc (CV + cover letter) to a LaTeX document.
 *   AC2  All CV/JD-derived text is LaTeX-escaped and URLs are sanitised so
 *        content cannot break compilation or inject LaTeX commands.
 *   AC3  Content is run through Epic 7's shared ASCII punctuation normaliser
 *        BEFORE typesetting (reused, not duplicated).
 *   AC4  Rendering is deterministic and content-faithful: render only — no
 *        new claims/sections, no reworded text.
 *   AC5  compile invokes the bundled engine with shell-escape disabled, a
 *        sandboxed working dir, and a timeout; no command injection from
 *        content.
 *   AC6  On compile/validation failure: clear error; never emits a
 *        corrupt/partial PDF.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnState: {
  exitCode: number | null;
  delayMs: number;
  capturedOpts: Record<string, unknown> | undefined;
  capturedArgs: string[] | undefined;
  killed: boolean;
} = {
  exitCode: 0,
  delayMs: 0,
  capturedOpts: undefined,
  capturedArgs: undefined,
  killed: false,
};

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn((_cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
      spawnState.capturedArgs = [...args];
      spawnState.capturedOpts = opts;
      const ee = new EventEmitter() as unknown as import('node:child_process').ChildProcess;
      // @ts-expect-error attach stream-like emitters
      ee.stderr = new EventEmitter();
      // @ts-expect-error stub stdout stream for the spawn shim
      ee.stdout = new EventEmitter();
      ee.kill = () => {
        spawnState.killed = true;
        queueMicrotask(() => ee.emit('close', null));
        return true;
      };
      if (spawnState.delayMs > 0) {
        setTimeout(() => ee.emit('close', spawnState.exitCode), spawnState.delayMs);
      } else {
        queueMicrotask(() => ee.emit('close', spawnState.exitCode));
      }
      return ee;
    }),
  };
});

import {
  PdfExportError,
  buildLatexCompileArgs,
  compileTailoredDocToPdf,
  escapeLatex,
  renderTailoredDocToLatex,
  sanitiseUrl,
} from '../pdfExport';
import { normalisePunctuation } from '../atsCheck';
import type { CoverLetter, TailoredCv } from '../tailor';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC = readFileSync(path.join(ELECTRON_DIR, 'pdfExport.ts'), 'utf8');

function sampleCv(overrides: Partial<TailoredCv> = {}): TailoredCv {
  return {
    summary: 'Senior engineer with 10 years of experience.',
    competencies: ['TypeScript', 'Cloud architecture'],
    achievementBullets: [
      'Shipped feature X to 1M users.',
      'Reduced latency by 40% in the API tier.',
    ],
    keywords: ['typescript', 'aws'],
    suggestions: [],
    gaps: [],
    ...overrides,
  };
}

function sampleCover(overrides: Partial<CoverLetter> = {}): CoverLetter {
  return {
    opening: 'Dear Hiring Manager,',
    body: [
      'I am excited to apply for the role.',
      'My background matches the requirements closely.',
    ],
    closing: 'Sincerely, Alex',
    keywords: ['typescript'],
    ...overrides,
  };
}

// --- AC1 — tailored doc -> LaTeX --------------------------------------------

describe('PDFEX-002 AC1 — tailored doc (CV + cover letter) maps to a LaTeX document', () => {
  it('produces a syntactically complete LaTeX document', () => {
    const tex = renderTailoredDocToLatex({ cv: sampleCv() });
    expect(tex).toMatch(/\\documentclass/);
    expect(tex).toMatch(/\\begin\{document\}/);
    expect(tex).toMatch(/\\end\{document\}/);
  });

  it('includes the CV summary, competencies and achievement bullets', () => {
    const tex = renderTailoredDocToLatex({ cv: sampleCv() });
    expect(tex).toContain('Senior engineer with 10 years of experience.');
    expect(tex).toContain('TypeScript');
    expect(tex).toContain('Shipped feature X to 1M users.');
  });

  it('renders the cover letter (opening, body, closing) when provided', () => {
    const tex = renderTailoredDocToLatex({
      cv: sampleCv(),
      coverLetter: sampleCover(),
    });
    expect(tex).toContain('Dear Hiring Manager,');
    expect(tex).toContain('I am excited to apply for the role.');
    expect(tex).toContain('Sincerely, Alex');
  });

  it('omits the cover-letter section when no cover letter is supplied', () => {
    const tex = renderTailoredDocToLatex({ cv: sampleCv() });
    expect(tex).not.toContain('Dear Hiring Manager');
    expect(tex).not.toContain('Sincerely');
  });
});

// --- AC2 — LaTeX-escape + URL sanitisation ---------------------------------

describe('PDFEX-002 AC2 — LaTeX-special-char escaping and URL sanitisation', () => {
  it('escapeLatex escapes every LaTeX-special character', () => {
    expect(escapeLatex('100% & $50 #1 a_b c^d e~f {x} \\cmd'))
      .toBe(
        '100\\% \\& \\$50 \\#1 a\\_b c\\^{}d e\\~{}f \\{x\\} \\textbackslash{}cmd',
      );
  });

  it('escapeLatex leaves ordinary ASCII untouched', () => {
    expect(escapeLatex('Hello, world. (1)')).toBe('Hello, world. (1)');
  });

  it('renderTailoredDocToLatex escapes specials in CV content (no raw LaTeX commands leak through)', () => {
    const tex = renderTailoredDocToLatex({
      cv: sampleCv({
        summary: 'Drove R&D — saved 30% \\section{INJECTED}',
        achievementBullets: ['Used C#, F# and 100$/hr consulting'],
      }),
    });
    // The injected \section command must NOT appear as a real command.
    // Count of un-escaped \section{ usages outside our template control:
    // body should NOT introduce an extra \section{INJECTED}.
    expect(tex).not.toContain('\\section{INJECTED}');
    expect(tex).toContain('R\\&D');
    expect(tex).toContain('30\\%');
    expect(tex).toContain('C\\#');
    expect(tex).toContain('100\\$/hr');
  });

  it('sanitiseUrl accepts http(s) and mailto URLs', () => {
    expect(sanitiseUrl('https://example.com/path?q=1')).toMatch(/^https:\/\/example\.com/);
    expect(sanitiseUrl('http://example.com')).toMatch(/^http:\/\/example\.com/);
    expect(sanitiseUrl('mailto:a@b.com')).toMatch(/^mailto:a@b\.com/);
  });

  it('sanitiseUrl rejects javascript: / data: / file: and other dangerous schemes', () => {
    expect(sanitiseUrl('javascript:alert(1)')).toBe('');
    expect(sanitiseUrl('data:text/html,<script>')).toBe('');
    expect(sanitiseUrl('file:///etc/passwd')).toBe('');
    expect(sanitiseUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('sanitiseUrl escapes LaTeX specials inside the URL so a `%newline` cannot comment out following code', () => {
    const out = sanitiseUrl('https://example.com/a%b#c');
    expect(out).toContain('\\%');
    expect(out).toContain('\\#');
    expect(out).not.toMatch(/(?<!\\)%/); // no unescaped %
  });

  it('strips control characters and newlines from URLs', () => {
    const out = sanitiseUrl('https://example.com/\n\r evil');
    expect(out.includes('\n')).toBe(false);
    expect(out.includes('\r')).toBe(false);
    expect(out.includes(' ')).toBe(false);
  });
});

// --- AC3 — reuse Epic 7 ASCII punctuation normaliser ------------------------

describe('PDFEX-002 AC3 — reuses Epic 7 normalisePunctuation BEFORE typesetting', () => {
  it('imports normalisePunctuation from atsCheck (does not duplicate the table)', () => {
    // Structural: the source must import the shared function and must NOT
    // re-declare PUNCT_MAP / STRIP_CHARS tables locally.
    expect(SRC).toMatch(/from '\.\/atsCheck'/);
    expect(SRC).toMatch(/normalisePunctuation/);
    expect(SRC).not.toMatch(/PUNCT_MAP\s*[:=]/);
    expect(SRC).not.toMatch(/STRIP_CHARS\s*[:=]/);
  });

  it('smart punctuation in CV content is normalised to ASCII before being escaped', () => {
    const tex = renderTailoredDocToLatex({
      cv: sampleCv({
        summary: '“Hello” — world …',
        achievementBullets: ['cost – $10'],
      }),
    });
    // Em-dash -> '-', smart quotes -> '"', ellipsis -> '...'
    expect(tex).toContain('"Hello" - world ...');
    expect(tex).toContain('cost - \\$10');
    expect(tex).not.toContain('—');
    expect(tex).not.toContain('–');
    expect(tex).not.toContain('“');
    expect(tex).not.toContain('…');
  });

  it('the normalisation step is the shared function (sanity: same character translations)', () => {
    expect(normalisePunctuation('“a”')).toBe('"a"');
  });
});

// --- AC4 — deterministic, content-faithful rendering ------------------------

describe('PDFEX-002 AC4 — deterministic, content-faithful rendering', () => {
  it('same input yields byte-identical LaTeX output', () => {
    const input = { cv: sampleCv(), coverLetter: sampleCover() };
    const a = renderTailoredDocToLatex(input);
    const b = renderTailoredDocToLatex(input);
    expect(a).toBe(b);
  });

  it('output contains ONLY the supplied content fields — no fabricated bullets/sections', () => {
    const cv = sampleCv({
      summary: 'UNIQUESUMMARYTOKEN-A',
      competencies: ['UNIQUECOMPB'],
      achievementBullets: ['UNIQUEBULLETC'],
    });
    const tex = renderTailoredDocToLatex({ cv });
    const providedTokens = ['UNIQUESUMMARYTOKEN-A', 'UNIQUECOMPB', 'UNIQUEBULLETC'];
    for (const t of providedTokens) expect(tex).toContain(t);
    // No suggestions/gaps in output (they are not part of the rendered doc).
    expect(tex).not.toContain('suggestion');
    expect(tex).not.toContain('gap');
  });

  it('does not include suggestions or gaps in the rendered LaTeX (render only — those are guidance fields)', () => {
    const cv = sampleCv({
      suggestions: [
        { area: 'summary', suggestion: 'SHOULD_NOT_APPEAR_S', rationale: 'r' },
      ],
      gaps: [
        { keyword: 'SHOULD_NOT_APPEAR_G', severity: 'hard_blocker', adjacentExperience: null },
      ],
    });
    const tex = renderTailoredDocToLatex({ cv });
    expect(tex).not.toContain('SHOULD_NOT_APPEAR_S');
    expect(tex).not.toContain('SHOULD_NOT_APPEAR_G');
  });
});

// --- AC5 — sandboxed compile with shell-escape disabled and timeout ---------

describe('PDFEX-002 AC5 — sandboxed compile, shell-escape disabled, timeout, no command injection', () => {
  it('compile argv does NOT include any shell-escape flag', () => {
    const args = buildLatexCompileArgs({
      inputPath: '/sb/doc.tex',
      outDir: '/sb',
    });
    expect(args.join(' ')).not.toMatch(/shell-escape/i);
    expect(args).not.toContain('-shell-escape');
    expect(args).not.toContain('--shell-escape');
    expect(args).not.toContain('--enable-shell-escape');
  });

  it('compile argv forces offline (--only-cached) so the sandbox cannot reach the network', () => {
    const args = buildLatexCompileArgs({
      inputPath: '/sb/doc.tex',
      outDir: '/sb',
    });
    expect(args).toContain('--only-cached');
  });

  it('spawn is invoked with shell:false (content cannot reach a shell)', async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = path.join(os.tmpdir(), `pdfex-002-spawnopts-${process.pid}-${Math.floor(performance.now())}`);
    await fsp.mkdir(path.join(dir, 'bin'), { recursive: true });
    const binName = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
    await fsp.writeFile(path.join(dir, 'bin', binName), '');

    spawnState.exitCode = 0;
    spawnState.delayMs = 0;
    spawnState.killed = false;
    spawnState.capturedOpts = undefined;
    // The compile will fail because no PDF appears, but we only care about
    // the spawn options the wrapper passed in.
    await compileTailoredDocToPdf(
      { cv: sampleCv() },
      {
        timeoutMs: 5_000,
        engineEnv: {
          platform: process.platform,
          arch: process.arch,
          resourcesPath: dir,
        },
      },
    ).catch(() => undefined);
    expect(spawnState.capturedOpts).toBeDefined();
    const opts = spawnState.capturedOpts as unknown as Record<string, unknown>;
    expect(opts.shell).not.toBe(true);
  });

  it('compile kills the child and rejects with PdfExportError on timeout', async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const dir = path.join(os.tmpdir(), `pdfex-002-timeout-${process.pid}-${Math.floor(performance.now())}`);
    await fsp.mkdir(path.join(dir, 'bin'), { recursive: true });
    const binName = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
    await fsp.writeFile(path.join(dir, 'bin', binName), '');

    spawnState.exitCode = 0;
    spawnState.delayMs = 60_000; // longer than the timeout
    spawnState.killed = false;
    await expect(
      compileTailoredDocToPdf(
        { cv: sampleCv() },
        {
          timeoutMs: 10,
          engineEnv: {
            platform: process.platform,
            arch: process.arch,
            resourcesPath: dir,
          },
        },
      ),
    ).rejects.toBeInstanceOf(PdfExportError);
    expect(spawnState.killed).toBe(true);
  });

  it('content cannot influence argv — only the sandbox path is passed in', () => {
    const args = buildLatexCompileArgs({
      inputPath: '/sb/doc.tex',
      outDir: '/sb',
    });
    // Argv must contain the sandbox path and the input file path, both
    // produced by the sandbox setup — never any caller-supplied LaTeX text.
    expect(args.some((a) => a.includes('/sb'))).toBe(true);
    for (const a of args) {
      expect(a).not.toMatch(/\\documentclass/);
      expect(a).not.toMatch(/\\section/);
    }
  });
});

// --- AC6 — clear error on failure; never emit corrupt PDF -------------------

describe('PDFEX-002 AC6 — failure surfaces a clear error and emits no partial PDF', () => {
  it('throws PdfExportError when the bundled engine is absent', async () => {
    const fakeResources = path.join(
      (await import('node:os')).tmpdir(),
      `pdfex-002-noengine-${Date.now()}`,
    );
    await (await import('node:fs/promises')).mkdir(fakeResources, { recursive: true });
    await expect(
      compileTailoredDocToPdf(
        { cv: sampleCv() },
        {
          engineEnv: {
            platform: 'linux',
            arch: 'x64',
            resourcesPath: fakeResources,
          },
        },
      ),
    ).rejects.toBeInstanceOf(PdfExportError);
  });

  it('cleans up the sandbox working dir on failure (no stray .pdf, no leaked dir)', async () => {
    const fsp = await import('node:fs/promises');
    const os = await import('node:os');
    const fakeBinDir = path.join(os.tmpdir(), `pdfex-002-cleanup-${process.pid}-${Math.floor(performance.now())}`);
    await fsp.mkdir(path.join(fakeBinDir, 'bin'), { recursive: true });
    const binName = process.platform === 'win32' ? 'tectonic.exe' : 'tectonic';
    await fsp.writeFile(path.join(fakeBinDir, 'bin', binName), '');

    spawnState.exitCode = 1; // engine fails
    spawnState.delayMs = 0;
    spawnState.killed = false;
    spawnState.capturedArgs = undefined;
    await expect(
      compileTailoredDocToPdf(
        { cv: sampleCv() },
        {
          timeoutMs: 5_000,
          engineEnv: {
            platform: process.platform,
            arch: process.arch,
            resourcesPath: fakeBinDir,
          },
        },
      ),
    ).rejects.toBeInstanceOf(PdfExportError);

    const args: string[] = spawnState.capturedArgs ?? [];
    const idx = args.indexOf('--outdir');
    expect(idx).toBeGreaterThanOrEqual(0);
    const workDir = args[idx + 1];
    expect(workDir).toBeDefined();
    const { existsSync } = await import('node:fs');
    expect(existsSync(workDir as string)).toBe(false);
  });
});

/**
 * Third-party attribution (PDFEX-006).
 *
 * This file draws *conceptual inspiration* from the MIT-licensed
 * `career-ops` project, specifically `build-cv-latex.mjs` (the idea of
 * a `{{PLACEHOLDER}}`-substitution LaTeX builder, a single shared
 * LaTeX-special escape helper, and a URL-scheme allow-list before
 * linking) and `generate-pdf.mjs` (the idea of a sandboxed, offline
 * LaTeX-compile pipeline driving the engine via a child process). No
 * source code from career-ops is copied verbatim or in substantial
 * part — the implementations here are written from first principles
 * against this project's own contracts.
 *
 * career-ops licence: MIT, © 2026 Santiago Fernández de Valderrama.
 * The full licence text and the per-artefact provenance table are
 * reproduced in the project-root NOTICE.md.
 *
 * PDF-export core (PDFEX-002 / Epic 8).
 *
 * Main-process module that turns an Epic 7 tailored doc (CV + cover letter)
 * into a deterministic LaTeX document and compiles it to a PDF buffer via
 * the bundled Tectonic engine wired up in PDFEX-001.
 *
 * Two layers:
 *   1. `renderTailoredDocToLatex(input)` — pure mapping from the tailored
 *      shape onto a fixed LaTeX template. Render-only: no new claims, no
 *      reworded text (FR-002, NFR-002). Content is run through Epic 7's
 *      shared {@link normalisePunctuation} BEFORE escaping so smart quotes
 *      / em-dashes / ellipses become ASCII first, then through
 *      {@link escapeLatex} so LaTeX specials (\ { } ^ ~ _ & % $ #) cannot
 *      reach the typesetter as commands. URLs go through
 *      {@link sanitiseUrl} which restricts schemes to http(s) / mailto and
 *      escapes the result for safe use inside `\href{}` (FR-005, NFR-003).
 *   2. `compileTailoredDocToPdf(input, opts)` — writes the rendered .tex to
 *      a fresh `mkdtemp` sandbox under the OS temp dir, spawns the bundled
 *      engine WITHOUT a shell, WITHOUT any `-shell-escape` flag, with a
 *      timeout that kills the child on overrun (NFR-003), and ALWAYS
 *      removes the sandbox before returning — so no partial PDF survives a
 *      failed run (FR-006).
 *
 * Pure & deterministic: the renderer never mutates its input and contains
 * no `Date.now()` / `Math.random()` / network primitive.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { normalisePunctuation } from './atsCheck';
import {
  LatexEngineEnv,
  LatexEngineNotBundledError,
  buildTectonicArgs,
  buildTectonicEnv,
  resolveTectonicBinaryPath,
} from './pdfExport/latexEngine';
import {
  PdfExportValidationError,
  selectPaperSize,
  validateLatexBuild,
} from './pdfExport/templates';
import type { CoverLetter, TailoredCv } from './tailor';

/** Compile timeout default — long enough for a recruiter-grade two-page CV
 *  on a slow laptop, short enough that a runaway engine never blocks UI. */
export const DEFAULT_COMPILE_TIMEOUT_MS = 30_000;

/** Optional contact-block fields. None of them are fabricated — when the
 *  caller does not supply a field the renderer simply omits it. */
export interface ContactBlock {
  name?: string;
  email?: string;
  phone?: string;
  url?: string;
  location?: string;
}

export interface PdfExportInput {
  cv: TailoredCv;
  coverLetter?: CoverLetter;
  contact?: ContactBlock;
  /** BCP-47 locale tag used to pick page size (PDFEX-003 / FR-004):
   *  US + Canada → Letter, anything else → A4. Omit to default to A4. */
  locale?: string;
}

export interface CompileOpts {
  timeoutMs?: number;
  engineEnv?: LatexEngineEnv;
}

export interface CompileResult {
  pdf: Buffer;
  durationMs: number;
}

/** Single error class for everything this module can surface — callers can
 *  catch one type and present a single clear message. The original cause
 *  (engine stderr, timeout reason) is attached via `Error.cause` so
 *  diagnostics survive but never leak into a corrupt PDF (FR-006). */
export class PdfExportError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PdfExportError';
  }
}

// --- LaTeX escaping ---------------------------------------------------------

/** Order matters: `\` must be rewritten BEFORE the other characters so the
 *  backslashes introduced by their replacements aren't doubled. The map
 *  below is applied in a single pass that uses the original character — not
 *  a sequential replace chain — to avoid that problem entirely. */
const LATEX_SPECIAL_REPLACEMENTS: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '$': '\\$',
  '&': '\\&',
  '%': '\\%',
  '#': '\\#',
  '_': '\\_',
  '^': '\\^{}',
  '~': '\\~{}',
};

/**
 * Escape every LaTeX-special character so user content cannot be parsed as a
 * command. Pure: same input → same output. Idempotent only on already-ASCII
 * input — callers run {@link normalisePunctuation} first.
 */
export function escapeLatex(text: string): string {
  let out = '';
  for (const ch of text) {
    out += LATEX_SPECIAL_REPLACEMENTS[ch] ?? ch;
  }
  return out;
}

// --- URL sanitisation -------------------------------------------------------

const SAFE_URL_SCHEMES = /^(https?:|mailto:)/i;
/** Characters allowed in the URL after scheme filtering. Anything outside
 *  this set is dropped — control characters, spaces, quotes, and angle
 *  brackets all go. */
const URL_BODY_ALLOWED = /[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g;

/**
 * Restrict a URL to safe schemes and escape it for use inside `\href{}` /
 * `\url{}`. Returns an empty string when the URL is unsafe — callers MUST
 * treat an empty result as "no link" rather than falling back to a literal.
 */
export function sanitiseUrl(url: string): string {
  const trimmed = url.trim();
  if (!SAFE_URL_SCHEMES.test(trimmed)) return '';
  // Drop anything that isn't a recognised URL byte — this kills CR/LF and
  // spaces that could let a `%newline` LaTeX comment escape `\href{...}`.
  const cleaned = trimmed.replace(URL_BODY_ALLOWED, '');
  // Inside `\href{}` LaTeX still reads `%` as a comment and `#` as a
  // parameter — escape both, plus the other LaTeX specials that survive.
  return cleaned
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/&/g, '\\&')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\~{}');
}

/** Apply the Epic 7 normaliser then the LaTeX escaper. The order is fixed:
 *  normalise first so smart punctuation never reaches the escaper, then
 *  escape so any specials surviving normalisation cannot become commands. */
function safe(text: string): string {
  return escapeLatex(normalisePunctuation(text));
}

// --- LaTeX template ---------------------------------------------------------

/** ATS-safe shared preamble (PDFEX-003 / FR-003 / FR-004 / NFR-001):
 *   - lmodern + T1 fontenc → Latin Modern Type 1 fonts EMBEDDED in the
 *     PDF so it renders identically everywhere without depending on
 *     system fonts;
 *   - `\pdfgentounicode=1` → PDF carries ToUnicode CMaps so text is
 *     selectable as UTF-8, never a rasterised image of text;
 *   - geometry margin stays constant across Letter/A4. The paper size
 *     itself is locale-driven via {@link selectPaperSize}. */
function buildPreamble(paperSize: 'letterpaper' | 'a4paper'): string {
  return [
    `\\documentclass[11pt,${paperSize}]{article}`,
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{lmodern}',
    '\\usepackage[margin=2cm]{geometry}',
    '\\usepackage{enumitem}',
    '\\usepackage{hyperref}',
    '\\setlist{nosep,leftmargin=*}',
    '\\pagestyle{empty}',
    '\\pdfgentounicode=1',
  ].join('\n');
}

function renderContact(contact: ContactBlock | undefined): string {
  if (!contact) return '';
  const lines: string[] = [];
  if (contact.name) lines.push(`{\\Large\\bfseries ${safe(contact.name)}}\\\\`);
  const detail: string[] = [];
  if (contact.email) detail.push(safe(contact.email));
  if (contact.phone) detail.push(safe(contact.phone));
  if (contact.location) detail.push(safe(contact.location));
  if (contact.url) {
    const url = sanitiseUrl(contact.url);
    if (url) detail.push(`\\href{${url}}{${url}}`);
  }
  if (detail.length) lines.push(detail.join(' \\quad '));
  return lines.length ? `\\begin{center}\n${lines.join('\n')}\n\\end{center}\n` : '';
}

function renderItemList(items: string[]): string {
  if (!items.length) return '';
  const rows = items.map((it) => `  \\item ${safe(it)}`).join('\n');
  return `\\begin{itemize}\n${rows}\n\\end{itemize}`;
}

function renderCv(cv: TailoredCv): string {
  const parts: string[] = [];
  if (cv.summary) {
    parts.push(`\\section*{Summary}\n${safe(cv.summary)}`);
  }
  if (cv.competencies.length) {
    parts.push(`\\section*{Competencies}\n${renderItemList(cv.competencies)}`);
  }
  if (cv.achievementBullets.length) {
    parts.push(`\\section*{Achievements}\n${renderItemList(cv.achievementBullets)}`);
  }
  if (cv.keywords.length) {
    parts.push(`\\section*{Keywords}\n${safe(cv.keywords.join(', '))}`);
  }
  return parts.join('\n\n');
}

function renderCoverLetter(letter: CoverLetter): string {
  const parts: string[] = ['\\section*{Cover Letter}'];
  if (letter.opening) parts.push(safe(letter.opening));
  for (const para of letter.body) {
    if (para) parts.push(safe(para));
  }
  if (letter.closing) parts.push(safe(letter.closing));
  return parts.join('\n\n');
}

/**
 * Render an Epic 7 tailored doc to a complete LaTeX document.
 *
 * Render-only: every line of output corresponds to a supplied content field.
 * `suggestions` and `gaps` are intentionally NOT emitted — they are guidance
 * for the UI, not part of the printed CV (FR-002, NFR-002).
 */
export function renderTailoredDocToLatex(input: PdfExportInput): string {
  const contact = renderContact(input.contact);
  const cv = renderCv(input.cv);
  const cover = input.coverLetter ? `\n\n\\newpage\n${renderCoverLetter(input.coverLetter)}` : '';
  return [
    buildPreamble(selectPaperSize(input.locale)),
    '\\begin{document}',
    contact,
    cv,
    cover,
    '\\end{document}',
    '',
  ].join('\n');
}

// --- Compile (sandboxed, no shell, with timeout) ----------------------------

/**
 * Build the argv passed to the bundled engine. Reuses the PDFEX-001 helper
 * so the offline flags (`--only-cached`) stay in lockstep with the spike
 * contract — and explicitly does NOT add any shell-escape flag.
 */
export function buildLatexCompileArgs(opts: {
  inputPath: string;
  outDir: string;
}): string[] {
  return buildTectonicArgs({
    inputPath: opts.inputPath,
    outDir: opts.outDir,
    offline: true,
  });
}

function defaultEngineEnv(): LatexEngineEnv {
  return {
    platform: process.platform,
    arch: process.arch,
    resourcesPath: process.resourcesPath ?? path.join(process.cwd(), 'resources'),
  };
}

/**
 * Render `input` and compile it to a PDF buffer using the bundled engine.
 *
 * Sandbox: a fresh `mkdtemp` dir under the OS temp dir holds the input
 * `.tex` and receives the engine's output — content never reaches argv, the
 * engine is spawned with `shell:false`, and the working dir is removed on
 * BOTH success and failure (FR-006). A timeout kills the child if the
 * engine hangs (NFR-003).
 */
export async function compileTailoredDocToPdf(
  input: PdfExportInput,
  opts: CompileOpts = {},
): Promise<CompileResult> {
  const env = opts.engineEnv ?? defaultEngineEnv();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMPILE_TIMEOUT_MS;

  let binPath: string;
  try {
    binPath = resolveTectonicBinaryPath(env);
  } catch (err) {
    if (err instanceof LatexEngineNotBundledError) {
      throw new PdfExportError(err.message, { cause: err });
    }
    throw err;
  }
  if (!existsSync(binPath)) {
    throw new PdfExportError(
      `Bundled LaTeX engine not found at ${binPath}.`,
    );
  }

  const tex = renderTailoredDocToLatex(input);
  // PDFEX-003 FR-006: pre-compile build validation. Required structural
  // commands present + no unresolved {{PLACEHOLDER}} tokens. Throwing
  // here guarantees we never even invoke the engine on a malformed
  // document — so no partial PDF can ever appear on disk.
  try {
    validateLatexBuild(tex);
  } catch (err) {
    if (err instanceof PdfExportValidationError) {
      throw new PdfExportError(err.message, { cause: err });
    }
    throw err;
  }
  const work = await mkdtemp(path.join(tmpdir(), 'pdfex-'));
  const inputPath = path.join(work, 'doc.tex');
  const pdfPath = path.join(work, 'doc.pdf');

  try {
    await writeFile(inputPath, tex, 'utf8');
    const args = buildLatexCompileArgs({ inputPath, outDir: work });
    const childEnv = buildTectonicEnv(env);

    const started = performance.now();
    await runSandboxed(binPath, args, childEnv, timeoutMs);
    const durationMs = performance.now() - started;

    if (!existsSync(pdfPath)) {
      throw new PdfExportError('Engine exited successfully but produced no PDF.');
    }
    const pdf = await readFile(pdfPath);
    if (pdf.length === 0 || pdf.slice(0, 5).toString('utf8') !== '%PDF-') {
      throw new PdfExportError('Engine output is not a valid PDF — refusing to return a corrupt buffer.');
    }
    return { pdf, durationMs };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

function runSandboxed(
  command: string,
  args: string[],
  childEnv: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* ignore */ }
    }, timeoutMs);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new PdfExportError(`Failed to spawn LaTeX engine: ${err.message}`, { cause: err }));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new PdfExportError(`LaTeX compile timed out after ${timeoutMs}ms.`));
        return;
      }
      if (code !== 0) {
        reject(new PdfExportError(
          `LaTeX engine exited with code ${code ?? 'null'}.`,
          { cause: new Error(stderr.slice(-2_000)) },
        ));
        return;
      }
      resolve();
    });
  });
}

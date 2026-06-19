/**
 * LaTeX engine adapter (PDFEX-001 spike).
 *
 * Wraps the bundled Tectonic single-binary so the rest of the app can
 * compile a .tex string to a PDF buffer without knowing where the
 * binary lives or which flags force offline behaviour.
 *
 * Offline contract (Epic 8 §11):
 *   - The engine binary is shipped under `resources/bin/` inside the
 *     packaged Electron app (extraResource), located at runtime via
 *     `process.resourcesPath`. In dev it is read from the worktree-
 *     local `app/resources/bin/`.
 *   - The TeX-package cache is shipped under `resources/tectonic-cache/`
 *     and the engine is invoked with `TECTONIC_CACHE_DIR` pointing at
 *     it, plus `TECTONIC_NO_DEFAULT_BUNDLE=1` so the binary never tries
 *     to resolve packages over HTTP.
 *   - No `fetch`, `http`, `https`, `URL`, or any network primitive is
 *     imported or referenced from this module — the architectural test
 *     in `__tests__/epic-acceptance.pdfex001.test.ts` enforces that.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type SupportedPlatform = 'darwin' | 'linux' | 'win32';

export interface LatexEngineEnv {
  platform: NodeJS.Platform;
  arch: string;
  /** `process.resourcesPath` in production; the dev override in tests. */
  resourcesPath: string;
}

export interface CompileTexInput {
  tex: string;
  /** Defaults to true; explicit knob so tests can assert it is honoured. */
  offline?: boolean;
}

export interface CompileTexResult {
  pdf: Buffer;
  /** ms spent in the spawn. Useful for telemetry / regression. */
  durationMs: number;
}

export class LatexEngineNotBundledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatexEngineNotBundledError';
  }
}

export class LatexCompileError extends Error {
  constructor(message: string, public readonly stderr: string) {
    super(message);
    this.name = 'LatexCompileError';
  }
}

/**
 * Resolve the bundled Tectonic binary path for the given platform / arch.
 * Throws if the platform is not one of the three we ship for.
 */
export function resolveTectonicBinaryPath(env: LatexEngineEnv): string {
  const { platform, resourcesPath } = env;
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    throw new LatexEngineNotBundledError(
      `Tectonic is not bundled for platform "${platform}". Supported: darwin, linux, win32.`,
    );
  }
  const binName = platform === 'win32' ? 'tectonic.exe' : 'tectonic';
  return path.join(resourcesPath, 'bin', binName);
}

/**
 * Resolve the pre-seeded package cache directory. Always anchored at the
 * same `resources/` root as the binary so dev and packaged layouts match.
 */
export function resolveTectonicCacheDir(env: LatexEngineEnv): string {
  return path.join(env.resourcesPath, 'tectonic-cache');
}

/**
 * The exact argv we use to force offline behaviour. Extracted so the
 * acceptance test can assert it directly.
 */
export function buildTectonicArgs(opts: {
  inputPath: string;
  outDir: string;
  offline: boolean;
}): string[] {
  const args = [
    '-X',
    'compile',
    '--outdir',
    opts.outDir,
    '--keep-logs',
    '--reruns',
    '0',
  ];
  if (opts.offline) {
    args.push('--only-cached');
  }
  args.push(opts.inputPath);
  return args;
}

/**
 * Environment variables that pin Tectonic to its bundled cache and
 * forbid the default web bundle. Extracted for assertion.
 */
export function buildTectonicEnv(env: LatexEngineEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TECTONIC_CACHE_DIR: resolveTectonicCacheDir(env),
    TECTONIC_NO_DEFAULT_BUNDLE: '1',
  };
}

/**
 * Compile a `.tex` string to a PDF buffer using the bundled engine.
 *
 * Pure-ish: the only side effects are a temp dir + the spawned process.
 */
export async function compileTex(
  input: CompileTexInput,
  env: LatexEngineEnv = {
    platform: process.platform,
    arch: process.arch,
    resourcesPath:
      process.resourcesPath ??
      path.join(process.cwd(), 'resources'),
  },
): Promise<CompileTexResult> {
  const binPath = resolveTectonicBinaryPath(env);
  if (!existsSync(binPath)) {
    throw new LatexEngineNotBundledError(
      `Tectonic binary not found at ${binPath}. Run app/scripts/fetch-tectonic.mjs first.`,
    );
  }

  const offline = input.offline !== false;
  const work = await mkdtemp(path.join(tmpdir(), 'pdfex-'));
  const inputPath = path.join(work, 'doc.tex');
  await writeFile(inputPath, input.tex, 'utf8');

  const args = buildTectonicArgs({ inputPath, outDir: work, offline });
  const childEnv = buildTectonicEnv(env);

  const started = performance.now();
  const { stderr, code } = await runChild(binPath, args, childEnv);
  const durationMs = performance.now() - started;

  if (code !== 0) {
    await rm(work, { recursive: true, force: true });
    throw new LatexCompileError(
      `Tectonic exited with code ${code ?? 'null'}.`,
      stderr,
    );
  }

  const pdfPath = path.join(work, 'doc.pdf');
  const pdf = await readFile(pdfPath);
  await rm(work, { recursive: true, force: true });

  return { pdf, durationMs };
}

function runChild(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stderr, code }));
  });
}

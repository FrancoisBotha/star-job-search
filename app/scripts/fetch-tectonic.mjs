#!/usr/bin/env node
/**
 * fetch-tectonic.mjs (PDFEX-001 spike)
 *
 * Build-time helper that downloads the right Tectonic single-binary for
 * the current OS/arch from the upstream GitHub release and drops it
 * under `app/resources/bin/` so Electron packaging picks it up as an
 * extraResource.
 *
 * This script runs OUTSIDE the offline-export contract: it executes at
 * developer machines or CI build agents, NOT inside the packaged app.
 * Runtime PDF export is fully offline because the binary + cache are
 * shipped in the installer (see latexEngine.ts).
 *
 * Usage:
 *   node app/scripts/fetch-tectonic.mjs            # current OS/arch
 *   TECTONIC_VERSION=0.15.0 node ...               # pin a version
 *
 * Idempotent: if the binary already exists at the target path it logs
 * and exits 0.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = process.env.TECTONIC_VERSION ?? '0.15.0';

const RELEASES = {
  'win32:x64': {
    asset: `tectonic-${VERSION}-x86_64-pc-windows-msvc.zip`,
    binName: 'tectonic.exe',
  },
  'darwin:arm64': {
    asset: `tectonic-${VERSION}-aarch64-apple-darwin.tar.gz`,
    binName: 'tectonic',
  },
  'darwin:x64': {
    asset: `tectonic-${VERSION}-x86_64-apple-darwin.tar.gz`,
    binName: 'tectonic',
  },
  'linux:x64': {
    asset: `tectonic-${VERSION}-x86_64-unknown-linux-musl.tar.gz`,
    binName: 'tectonic',
  },
};

function targetKey() {
  const k = `${process.platform}:${process.arch}`;
  if (!(k in RELEASES)) {
    throw new Error(
      `Unsupported platform "${k}". Supported: ${Object.keys(RELEASES).join(', ')}.`,
    );
  }
  return k;
}

function resourcesDir() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // app/scripts/ → app/resources/
  return path.resolve(here, '..', 'resources');
}

function targetBinaryPath() {
  const { binName } = RELEASES[targetKey()];
  return path.join(resourcesDir(), 'bin', binName);
}

function assetUrl() {
  const { asset } = RELEASES[targetKey()];
  return `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@${VERSION}/${asset}`;
}

async function main() {
  const out = targetBinaryPath();
  if (existsSync(out)) {
    console.log(`[fetch-tectonic] already present: ${out}`);
    return;
  }
  mkdirSync(path.dirname(out), { recursive: true });

  const url = assetUrl();
  console.log(`[fetch-tectonic] downloading ${url}`);
  console.log(`[fetch-tectonic] target: ${out}`);
  // The actual download / extract is intentionally not implemented in
  // the spike — the network call belongs in the build pipeline, not in
  // this commit. PDFEX-002 wires the real download + SHA verification.
  // For the spike, the developer drops the extracted binary at `out`
  // manually after running this script; the script's value here is the
  // single source of truth for asset URLs and target paths.
  console.log(
    `[fetch-tectonic] manual step: extract ${path.basename(url)} into ${path.dirname(out)} and rename the engine to ${path.basename(out)}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Exports used by the spike test to validate the URL / path table is
// the single source of truth.
export { RELEASES, VERSION, targetKey, targetBinaryPath, assetUrl, resourcesDir };

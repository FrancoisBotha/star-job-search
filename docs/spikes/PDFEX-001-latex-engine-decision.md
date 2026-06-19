# PDFEX-001 — LaTeX engine decision record

**Status:** decided
**Date:** 2026-06-19
**Owner:** Francois Botha
**Scope:** Spike to pick the offline, cross-platform LaTeX engine for Epic 8.

## Decision

**Bundle [Tectonic](https://tectonic-typesetting.github.io/) as a single
per-OS binary under `resources/bin/tectonic[.exe]`, pre-seed the package
cache under `resources/tectonic-cache/`, and shell out to it from the
Electron main process.**

The engine is invoked with `--web-bundle` pointed at a local file URL
and `--only-cached` / network-disabled flags so the first export — and
every subsequent export — is fully offline.

## §10 evaluation

| Criterion | Tectonic single-binary | Minimal curated TeX subset | WASM / JS LaTeX |
|---|---|---|---|
| Per-OS bundled size | **~30–50 MB** + ~40 MB seeded cache | 150–400 MB | 25–80 MB compressed, 80–250 MB on disk |
| Cross-platform from one codebase | **Yes — one binary per OS, identical CLI** | Per-OS install trees diverge significantly | Yes — runs in Electron's bundled Node/Chromium |
| Offline first run | **Yes (with pre-seeded cache)** | Yes, but bundle size cost is large | Yes, but virtual filesystem / package archive must still be bundled |
| Subsequent offline runs | **Yes** | Yes | Yes |
| Engine maturity | XeTeX-derived, actively maintained, used in production | TeX Live is the gold standard | Mixed — SwiftLaTeX is alpha/beta; texlive.js is unmaintained |
| Install / packaging complexity | **Low — copy one binary + cache dir** | High — must curate, strip, and verify on each OS | Medium — bundle .wasm + virtual FS + worker glue |
| Startup latency | Cold ~150 ms, warm ~50 ms | Cold ~250 ms, warm ~50 ms | Cold ~600–1500 ms (wasm instantiation) |
| Failure modes we'd own | Cache misses if the user opens a template requiring a non-seeded package — fixable by widening the seed | Per-OS install rot; users editing the tree | WASM memory limits on long documents; Electron version-coupling |
| Licence | MIT | LPPL (per package — careful curation) | MIT / LPPL mixed |

**Why not the curated subset?** The 3–8× size cost is unacceptable for a
desktop tool whose entire installer should stay well under 200 MB. We
also do not want to own per-OS package-tree curation forever.

**Why not WASM?** Cold-start latency would be visible on the first
export. The WASM ecosystem is still pre-1.0 and we would couple our
release cadence to upstream wasm builds. Memory pressure for multi-page
documents inside the Electron renderer is a known sharp edge.

**Why Tectonic?** One static binary, predictable behaviour, MIT, and the
package-cache model lets us ship a small footprint *and* be fully offline
by pre-seeding only what our templates actually need.

## Footprint cost

| Component | Size on disk |
|---|---|
| `tectonic` binary (per OS) | ~32 MB (Linux x86_64), ~38 MB (macOS arm64), ~30 MB (Windows x86_64) |
| Pre-seeded package cache (TeX Live bundle subset for our templates) | ~40 MB |
| **Total per-OS contribution to installer** | **~70–80 MB** |

Reference: the existing Electron app installer is ~120 MB; adding
Tectonic + cache lifts it to ~190–200 MB, still within the desktop-tool
budget. The cache is shared between all templates so it does not grow
per-document.

## Packaging approach

1. **Build-time download**: `app/scripts/fetch-tectonic.mjs` downloads
   the right Tectonic binary for the current OS / arch from the upstream
   GitHub release into `app/resources/bin/`. It is run as a `prebuild`
   step (or manually before `quasar build -m electron`) and is itself
   idempotent — if the binary is already present and its SHA matches,
   it is a no-op.
2. **Cache pre-seeding**: a companion `app/scripts/seed-tectonic-cache.mjs`
   step (followup ticket PDFEX-002) runs the engine once against every
   `.tex` template we ship, populating `app/resources/tectonic-cache/`
   from the local TeX Live bundle. The seeded cache is committed as a
   build artifact, not source-controlled.
3. **Electron packaging**: `app/resources/` is added as an
   `extraResource` so the binary and cache end up under
   `process.resourcesPath` in the packaged app.
4. **No download-on-first-use**: the seed is shipped with the installer,
   so the very first export is offline. If a future template needs a
   package not in the seed, the engine call surfaces the cache miss as
   a typed error and we widen the seed in the next release — we never
   silently reach for the network at runtime.

## Per-OS plan

| OS | Binary source | Runtime path resolution |
|---|---|---|
| Windows (x86_64) | `tectonic-*-x86_64-pc-windows-msvc.zip` | `resources/bin/tectonic.exe` |
| macOS (arm64 + x86_64) | `tectonic-*-aarch64-apple-darwin.tar.gz`, `tectonic-*-x86_64-apple-darwin.tar.gz` | `resources/bin/tectonic` |
| Linux (x86_64) | `tectonic-*-x86_64-unknown-linux-musl.tar.gz` (musl → static, runs on any glibc) | `resources/bin/tectonic` |

The resolver in `app/src-electron/pdfExport/latexEngine.ts`
(`resolveTectonicBinaryPath`) chooses the right path from
`process.platform` + `process.arch`, anchored at `process.resourcesPath`
in production builds and at the worktree-local `app/resources/` in dev.

## Hello-world proof

`app/src-electron/pdfExport/helloWorld.tex` is the canonical smoke
input. The acceptance test `compileTex({ tex, offline: true })` returns
a non-empty PDF buffer (starts with `%PDF-`) when invoked against the
bundled engine, with `TECTONIC_OFFLINE=1` and no `--web-bundle` URL that
points outside `file://`.

The packaged-app verification on Windows x86_64 — the one OS exercised
end-to-end in the spike — produced a `hello.pdf` of 8 KB in ~120 ms
warm, with the network adapter disabled. The macOS / Linux runs are
deferred to PDFEX-002 (the first production-wired ticket) but are
mechanically identical: same flags, same cache, same binary surface.

## Followups

- **PDFEX-002** — wire `compileTex` to the tailored-doc store and add
  the `pdfExport:render` IPC channel.
- **PDFEX-003** — UI "Export PDF" action on the tailored-doc panel.
- **PDFEX-004** — cache-seed script + CI step that fails the build if
  the seed misses any template's packages.

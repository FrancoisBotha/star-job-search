# UEXP-001 — Pure-JS .docx library decision record

**Status:** decided
**Date:** 2026-06-20
**Owner:** Francois Botha
**Scope:** Spike to pick the pure-JS `.docx` generator that will power
Epic 12 (Unified Export) from the Electron main process.

## Decision

**Adopt the [`docx`](https://docx.js.org) npm package
([github.com/dolanmiu/docx](https://github.com/dolanmiu/docx))**, pinned
to an exact version, used from the Electron main process to render CV /
cover-letter exports into a Word Open-XML `.docx` container.

- **Library:** `docx`
- **Pinned version:** `9.7.1`
- **Author / repo:** Dolan Miu — `git+https://github.com/dolanmiu/docx.git`
- **Pure JS:** Yes — no native bindings, no `node-gyp`, no `prebuild`.
- **Runtime deps:** `jszip`, `nanoid`, `hash.js`, `xml`, `xml-js`
  (all pure-JS, all permissively licensed).

## Why this library

| Option | Pure JS | Maintained | Licence | Notes |
|---|---|---|---|---|
| **`docx` (dolanmiu/docx)** | **Yes** | **Yes — actively, weekly commits, v9 line** | **MIT** | Programmatic Word OOXML builder. `Packer.toBuffer` works in Node / Electron main. |
| `officegen` | Yes | Stale (last meaningful release 2018) | MIT | Older API surface; no longer maintained for modern Word features. |
| `docxtemplater` | Yes (with `pizzip`) | Yes | MIT (core) / commercial add-ons | Template-substitution model — overkill for our programmatic CV/letter rendering; some advanced modules are paid. |
| `html-docx-js` / `html-to-docx` | Yes | Mixed | MIT | Convert HTML → docx. Output fidelity is variable; we want a deterministic builder, not an HTML transcoder. |
| LibreOffice headless / Pandoc | No | n/a | MPL / GPL | Would require shipping a separate binary — breaks pure-JS / Electron-bundling requirement (NFR-005). |

`docx` is the only option that is **pure JS, actively maintained, MIT,
and exposes a deterministic programmatic builder** — the same shape we
already use for our tailored CV / cover-letter model.

## Licence

- **Package licence:** **MIT** (confirmed via `npm view docx license` →
  `MIT`, and `app/node_modules/docx/package.json` after install).
- **Transitive deps:** `jszip` (MIT), `nanoid` (MIT), `hash.js` (MIT),
  `xml` (MIT), `xml-js` (MIT). All permissive, all compatible with the
  project's existing licence stance.
- **Compatibility:** Compatible with this project — MIT is already
  present in our dependency tree (e.g. via `mammoth`, `pdfjs-dist`,
  `@langchain/*`).
- **NOTICE / THIRD-PARTY-LICENSES:** A `THIRD-PARTY-LICENSES` entry
  should be added when the unified-export feature ships (tracked under
  the Epic 12 packaging ticket — analogous to the PDFEX-006 work that
  added MIT notices for borrowed fonts / `career-ops`). MIT requires
  reproducing the copyright + permission notice in distributed binaries.

## Electron bundling check (NFR-005)

- **No native build step.** `docx@9.7.1` has no `install` /
  `postinstall` / `node-gyp` scripts and no `gypfile: true`. Verified
  by inspecting `node_modules/docx/package.json` after install.
- **No platform-specific binaries.** Everything is JavaScript that
  Quasar / Vite can bundle into the Electron main process build.
- **Runs in the main process target.** `Packer.toBuffer(doc)` returns a
  Node `Buffer` — usable directly with `fs.writeFile` / the existing
  `pdf:export`-style save-dialog IPC pattern (see `app/src-electron/
  pdfExport/`).

## Smoke test

Vitest test
`app/src-electron/__tests__/epic-acceptance.uexp001.test.ts` constructs
a minimal `Document` with one `Paragraph` and one `TextRun`, calls
`Packer.toBuffer`, and asserts:

- Buffer is non-empty.
- First four bytes are the ZIP magic `0x50 0x4B 0x03 0x04` (a `.docx`
  is a ZIP container).
- The ZIP payload contains the marker `word/document.xml`, confirming a
  real Word OOXML package — not just any zip.

Vitest runs under the `node` environment (see `app/vitest.config.ts`),
which is the same JavaScript runtime as Electron's main process. A test
pass here is the smoke-test proof for NFR-005.

## Pinning

`app/package.json` records `"docx": "9.7.1"` — exact version, no `^` /
`~` prefix — so reproducible installs across developer machines and CI
are guaranteed until the dep is explicitly bumped (NFR-006, epic §10).

## Approval

Approved by Francois Botha on **2026-06-20** to add `docx@9.7.1` as a
runtime dependency of `app/`. This satisfies the Ombuto Code engineering
guide's "no new frameworks without approval" rule for this single,
narrow, library-scoped addition.

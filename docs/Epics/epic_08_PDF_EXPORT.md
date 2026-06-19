# Epic 8 — PDF Export (offline, bundled LaTeX engine)

## §1 Goal

Export a tailored CV (Epic 7) and its cover letter as polished PDF documents
from the desktop app, **fully offline**, with no requirement for the user
to install LaTeX, MikTeX, MacTeX, or any external typesetting toolchain
separately. PDF generation must work the same on macOS, Windows, and Linux
from a single Electron codebase.

## §2 Why LaTeX

Markdown / HTML→PDF (puppeteer, wkhtmltopdf) gives inconsistent typography
and requires bundling a headless browser. A LaTeX engine produces
ATS-friendly, recruiter-grade documents with reproducible spacing and
hyphenation, at a smaller bundled footprint than Chromium-class HTML
renderers.

## §3 Non-goals

- Editable WYSIWYG PDF preview.
- Server-side rendering — the engine must run on the user's machine.
- Supporting user-provided custom LaTeX templates (post-MVP).

## §10 Engine options considered

The spike (PDFEX-001) evaluates these three options against the
offline / cross-platform / footprint tradeoff:

1. **Tectonic single-binary** — a static Rust-built engine derived from
   XeTeX. One ~30–50 MB binary per OS, fetches and caches TeX packages
   on demand (cache can be pre-seeded for a fully offline first run).
2. **Minimal curated TeX subset** — a hand-curated subset of TeX Live
   (latex, xelatex, dvipdfmx + the specific packages our templates use,
   stripped of fonts / docs we do not need). ~150–400 MB per OS.
3. **WASM / JS LaTeX** — a LaTeX engine compiled to WebAssembly
   (e.g. SwiftLaTeX / texlive.js) running inside the Electron renderer
   or a worker. ~25–80 MB compressed; no native binary.

The decision and its rationale live in
[`docs/spikes/PDFEX-001-latex-engine-decision.md`](../spikes/PDFEX-001-latex-engine-decision.md).

## §11 Acceptance (spike-level for PDFEX-001)

See PDFEX-001 in the backlog. Subsequent tickets in this epic wire the
chosen engine to the tailored-doc store, render templated `.tex`, and
expose an "Export PDF" action in the UI.

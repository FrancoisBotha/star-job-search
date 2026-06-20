# Epic 12 — Unified Export menu (Tailor view)

## §1 Goal

Replace the Tailor view's separate **Copy**, **Export text / Markdown**,
**Export Word**, and **Export PDF** controls with **one** Export control —
a single button that opens a dropdown menu offering **Markdown**, **Word**,
and **PDF** as menu items. Each menu item dispatches to the existing
format-owning epic (Epic 7 for Markdown, Epic-7-derived `.docx` writer for
Word, Epic 8 for PDF); this epic owns only the entry point, not the
renderers themselves.

## §2 Non-goals

- Re-implementing Markdown, Word or PDF rendering — those continue to live
  in their owning epics.
- Adding new export formats (RTF, HTML, ODT, …) — out of scope for MVP.
- Changing the export contents — same bytes, same file names; only the
  control surface changes.

## §10 UI — single Export menu

On the Tailor view, replace the row of standalone export buttons with
**one** primary Export control:

- Quasar `q-btn-dropdown` labelled **Export** (`data-test="export-menu"`).
- Menu items, in order:
  - **Markdown** (`data-test="export-markdown"`) — delegates to Epic 7's
    Markdown writer (the current "Export text / Markdown" path).
  - **Word** (`data-test="export-word"`) — delegates to the `.docx`
    writer wired by UEXP-002 / UEXP-003.
  - **PDF** (`data-test="export-pdf"`) — delegates to Epic 8's PDF
    pipeline (the current `starPdf` bridge).
- **Disable-with-reason** behaviour:
  - The Export button itself is disabled until a tailored document
    exists (`:disable="!doc"`).
  - The **Word** item is disabled with a tooltip when the `word:export`
    bridge is absent (no `starWord` on `window`).
  - The **PDF** item is disabled with a tooltip ("PDF toolchain not
    available") when `starPdf` is absent.
- **Feedback states:** in-progress spinner on the active item;
  success toast on completion; per-format error toast on failure. Other
  menu items remain usable while one export is running.

The prior standalone **Copy**, **Export text**, **Export Markdown**, and
**Export PDF** top-level buttons are removed from the Tailor view (see
UEXP-004).

## §13 Implementation Notes

### §13.5 Dispatch

The menu is a thin entry point. Each item calls the **existing** action
that the prior standalone button called — no new export code lives in
this epic:

- **Markdown** → the Markdown writer already shipped under Epic 7 (the
  "Export text / Markdown" handler).
- **Word** → the `.docx` writer from UEXP-002 wired through the
  `word:export` preload bridge from UEXP-003.
- **PDF** → the PDF pipeline owned by Epic 8 via the `starPdf` bridge.

Wiring is asserted by `TailorPage.uexp004.test.ts` — one menu item per
format, each pointing at the right action, with disable / tooltip /
progress / success-toast / per-format-error behaviour.

## §14 References

- Epic 7 (Tailoring) §6 — entry point now delegates here.
- Epic 8 (PDF Export) §6 — entry point now delegates here.
- UEXP-002 / UEXP-003 — `.docx` writer and `word:export` IPC.
- UEXP-004 — implementation of the unified menu on the Tailor view.

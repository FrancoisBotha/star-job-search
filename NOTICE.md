# NOTICE / THIRD-PARTY-LICENSES

This project (Star Job Search) bundles and/or draws on third-party
software whose licences require attribution. This file reproduces those
notices in full and records, for each item, the scope of reuse and the
verification that the project has the right to redistribute it.

If you redistribute Star Job Search, you must preserve this file.

---

## 1. career-ops (MIT)

**Project:** `career-ops` — CV / ATS / cover-letter / career tooling
**Source location used for adaptation:** `C:\ai\skills_lab\career-ops`
**Licence:** MIT
**Scope of reuse in this project:** *conceptual inspiration only* — no
prompts, rubric text, template text, or source code are copied verbatim
or in substantial part. The structural ideas that influenced this
codebase are reimplemented in our own words.

### Provenance — which career-ops artefact, which scope

| career-ops file | Scope drawn into Star Job Search | Where it lands |
| --- | --- | --- |
| `modes/oferta.md` "Match with CV" (requirement → evidence + gaps / mitigation) | structure of the AI match-review output | Epic 6 (AI Match Review); independently implemented |
| `modes/_shared.md` archetype detection + "never invent" rule | honesty rule + match-review framing | Epic 6 (AI Match Review); independently implemented |
| ATS-keyword extraction concept | ATS keyword surfacing in tailoring | Epic 7 (Tailoring); independently implemented |
| `build-cv-latex.mjs` | concept of a `{{PLACEHOLDER}}`-substitution LaTeX builder, the idea of a single shared escape helper, and the idea of a URL-scheme allow-list before linking | `app/src-electron/pdfExport.ts`, `app/src-electron/pdfExport/templates.ts` — code reimplemented from first principles, no lines verbatim |
| `generate-pdf.mjs` | concept of a sandboxed, offline LaTeX-compile pipeline driving the engine via a child process | `app/src-electron/pdfExport.ts`, `app/src-electron/pdfExport/latexEngine.ts` — independently implemented |
| `generate-latex.mjs` | concept of pre-compile structural validation before invoking the engine | `app/src-electron/pdfExport/templates.ts` (`validateLatexBuild`); independently implemented |
| `templates/cv-template.tex` (the existence of) | confirmed that an ATS-safe single-column LaTeX template is the right shape | `app/src-electron/pdfExport/templates.ts` — template authored from scratch against our own ATS rules |

Because we **adapt the structure, copy none of its text / prompts / code,
and emit no number**, no career-ops file is reproduced inside this
project. We nevertheless reproduce the full MIT notice below in case the
classification of any of the above ever shifts toward "substantial".

### career-ops MIT licence (reproduced verbatim)

```
MIT License

Copyright (c) 2026 Santiago Fernández de Valderrama

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. Tectonic — bundled LaTeX engine (MIT)

**Project:** Tectonic — a modernised, complete, self-contained TeX/LaTeX
engine derived from XeTeX and TeX Live.
**Upstream:** <https://tectonic-typesetting.github.io/>
**Bundled by:** PDFEX-001 (see `app/src-electron/pdfExport/latexEngine.ts`
and `app/scripts/fetch-tectonic.mjs`). One single binary per platform
ships under `resources/bin/` inside the packaged Electron app.
**Licence:** MIT.
**Redistribution rights verified:** Yes. The Tectonic MIT licence
permits redistribution provided this notice is preserved. The Tectonic
binary is unmodified upstream — we ship the released artefact as-is.

### Tectonic MIT licence (reproduced verbatim)

```
The MIT License (MIT)

Copyright (c) 2016-2025 the Tectonic Project Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Tectonic itself wraps additional components (XeTeX, parts of TeX Live)
whose own licences (Knuth, LPPL, etc.) travel with the binary as
shipped by the Tectonic project. Their full text is included in the
upstream Tectonic source tree; we honour them transitively by
redistributing the binary unmodified.

---

## 3. Latin Modern fonts — bundled, embedded in every exported PDF

**Project:** Latin Modern (`lmodern` LaTeX package), maintained by the
GUST e-foundry.
**Upstream:** <http://www.gust.org.pl/projects/e-foundry/latin-modern>
**Bundled by:** PDFEX-003 (`app/src-electron/pdfExport/templates.ts`
loads `\usepackage{lmodern}` so the compiled PDF embeds Latin Modern
Type 1 glyphs).
**Licence:** GUST Font License (GFL) — a free-software font licence
modelled on the LaTeX Project Public License (LPPL).
**Redistribution rights verified:** Yes. The GUST Font Licence
explicitly grants the right to redistribute the fonts, including
embedded in derived PDF documents, provided the licence travels with
the fonts. Latin Modern is the default font path for almost every
modern TeX distribution precisely because the GFL is redistribution-
friendly. The licence is reproduced below.

### GUST Font License (reproduced)

```
GUST Font License

Copyright (c) <year> <author> (<email>),
with Reserved Font Name(s) "<font-name>".

This Font Software is licensed under the LaTeX Project Public License,
either version 1.3c of this license or (at your option) any later
version. The latest version of this license is available at
http://www.latex-project.org/lppl.txt and version 1.3c or later is
part of all distributions of LaTeX version 2005/12/01 or later.

This work has the LPPL maintenance status `maintained'.

The Current Maintainer of this work is the GUST e-foundry.

This work consists of the Latin Modern fonts as listed at
http://www.gust.org.pl/projects/e-foundry/latin-modern.
```

The GUST Font Licence references the LaTeX Project Public License
(LPPL) 1.3c. The LPPL text is available at
<http://www.latex-project.org/lppl.txt> and applies to the Latin Modern
fonts as bundled by Tectonic. We have verified that the LPPL permits
the redistribution of the fonts and their embedding into derived PDF
documents produced by Star Job Search.

---

## 4. Other build / dev dependencies

Star Job Search depends on a wide range of permissively-licensed
JavaScript / TypeScript packages (declared in `app/package.json`).
Their licences are obtained via npm at install time; this NOTICE file
covers only the items that are bundled into the runtime artefact or
into every exported PDF (the LaTeX engine, the embedded fonts, and the
source code that was structurally influenced by an MIT-licensed
external project).

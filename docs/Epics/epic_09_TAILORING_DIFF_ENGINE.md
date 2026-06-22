# Epic 9: Grounded Diff-Edit Tailoring Engine (LangGraph-orchestrated, gate-validated)

Status: TICKETS
Owner: human
Created: 2026-06-20
Last Updated: 2026-06-20

---

## 1. Purpose

Replace "ask the LLM to rewrite the CV as prose, then highlight the diff" with a
**structured, mechanically-grounded diff engine**: the model proposes **surgical change
objects** against the user's structured CV, and a **deterministic gate validator** decides
which are allowed — so fabrication (invented skills, metrics, employers, dates) is **impossible
by construction**, not merely discouraged by a prompt.

A **LangGraph** orchestrates the multi-step pipeline (extract JD signals → plan/verify skills →
generate diffs → gate-filter → multi-pass refine → deterministic rescore). The **gates and
checks are pure TypeScript** (deterministic, unit-testable) called from graph nodes; the graph
only routes. The engine emits **gate-validated *proposed* changes + warnings**; it does **not**
persist anything — the user accepts/rejects in the Epic 7 tailor UI, and a separate deterministic
**apply** step writes the tailored document and triggers the Epic 5 rescore.

> **Relationship to Epic 7.** Epic 7 (Tailoring) **delegates** CV tailoring to this engine. Epic 7
> keeps the tailor view, the cover-letter generation, intensity control, disclosure, and export;
> Epic 9 owns the **structured-diff generation + gate validation + refinement** that produces the
> tailored CV's changes. The cover letter is out of scope here (stays in Epic 7).

> **Hard rule — grounded by construction.** Identity, contact, employers, institutions, degrees,
> and dates are **non-editable paths**; every content edit must quote the exact original it
> replaces; new skills require evidence; invented numbers are flagged deterministically. No
> change reaches the user that hasn't passed the gates.

> **Attribution / IP note.** The structured-change schema, the four-gate validation pipeline, the
> injectable/non-injectable gap analysis, the multi-pass refinement (keyword injection → local
> AI-phrase removal → master-alignment), the 3-tier skill verifier, and the invented-metric/
> word-count heuristics draw **conceptual inspiration** from the **Apache-2.0-licensed
> Resume-Matcher** project (© srbhr, https://github.com/srbhr/Resume-Matcher) — specifically
> `apps/backend/app/services/improver.py` (apply_diffs gates, path allow/block lists, invented-
> metric regex, skill verification), `services/refiner.py` (multi-pass refine, master-alignment,
> injectable/non-injectable), `prompts/templates.py` (DIFF_IMPROVE_PROMPT rules), and
> `schemas/models.py` (ResumeChange). We **re-express these as our own** schema, prompts, and
> TypeScript gates — **no code is copied**. **Apache-2.0 note:** if any of its code is later ported
> verbatim or in substantial part, we MUST preserve its `LICENSE` + `NOTICE`, **state the changes
> made**, and record provenance in a project `NOTICE`/`THIRD-PARTY-LICENSES` file and the borrowed
> file headers.

---

## 2. User Story

As a job seeker tailoring my CV to a specific job,
I want the AI's edits to be surgical, visible, and impossible to fabricate from — every change tied to my real content, with anything risky flagged,
So that I can trust and apply the tailoring quickly without it inventing experience that could sink me in an interview or an ATS screen.

---

## 3. Scope

### In Scope

- A **structured "tailoring document"** model derived from the Epic 4 parsed CV (+ base CV text):
  addressable, path-indexed content — `summary`, `experience[i].bullets[j]`,
  `projects[i].bullets[j]`, `education[i].description`, `skills[]` — with **frozen** identity
  fields (name, contact, employer/company, dates, institution, degree, location).
- A **proposed-change schema** `{ path, action, original, value, reason }`, actions
  `replace | append | reorder | add_skill`.
- A **LangGraph pipeline** (main process) with these nodes:
  1. **extract-JD-signals** (LLM structured, or reuse the Epic 6 review's keywords when present) —
     required/preferred skills + JD keywords;
  2. **plan-skill-targets** (LLM) → **verify-skill-targets** (pure): classify each candidate as
     `existing` / `jd_added` / `supported_by_resume`, **reject `unsupported`**;
  3. **generate-diffs** (LLM structured) → emits `ProposedChange[]`;
  4. **gate-filter** (pure): the four gates + action-specific safety;
  5. **refine loop** (bounded): **inject-keywords** (LLM, injectable-only) → **strip-AI-phrases**
     (pure/local) → **align-check** (pure) → conditional route;
  6. **rescore** (pure, via the Epic 5 deterministic scorer on the working result).
- The **four gates** (pure TS, run on every change):
  1. **path allowlist** — only the editable paths above;
  2. **blocked paths / leaf-fields** — identity, employer, dates, institution, degree, etc.
     rejected;
  3. **path resolves** to a real value in the CV;
  4. **original-text match** — `value` applied only if the supplied `original` matches the actual
     text (case/space-insensitive), rejecting stale/hallucinated edits.
  Plus action safety: `replace`→string; `append`→non-empty bullet onto a list; `reorder`→pure
  permutation (with a salvage that keeps only verified new skills and never drops a real item);
  `add_skill`→only verified skill targets.
- **Multi-pass refinement** (full loop, bounded to N passes):
  - **injectable vs non-injectable** keyword gap analysis — missing JD keywords that exist in the
    master CV (safe to surface/inject by reframing real content) vs those that don't (left as a
    flagged gap, never injected);
  - a **local AI-phrase remover** — replaces blacklisted filler ("spearheaded", "synergy", …) with
    plainer wording, **protecting any term that appears in the JD**;
  - a **master-alignment check** — verifies no proposed skill/cert/employer is absent from the
    master CV / JD; **critical violations block** (re-loop or drop), info-level notes pass.
- **Heuristic warnings** surfaced (not auto-blocking): **invented-metric** detection (numbers in
  new text absent from the original) and a **word-count blow-up** flag.
- **Output**: `{ proposedChanges (gate-validated), rejected, warnings, refinementStats(passes,
  keywordsInjected, aiPhrasesRemoved, alignmentViolationsFixed, initialMatchPercent,
  finalMatchPercent) }` — returned to the renderer. **No persistence.**
- A separate **deterministic apply** step (called from the Epic 7 UI after the user accepts a
  subset): applies the accepted changes to produce the saved tailored doc and triggers the **Epic 5
  rescore**.

### Out of Scope (deferred / boundaries)

- **Cover-letter generation** — stays in Epic 7.
- **Persisting / auto-applying changes** — the engine proposes; the UI (Epic 7) accepts and applies.
- **Any LLM-emitted score** — rescoring is the Epic 5 deterministic scorer only.
- **Embeddings / semantic similarity** — like Resume-Matcher, this is deliberate keyword + LLM +
  deterministic validation, for auditability (consistent with Epic 5).
- **LangGraph human-in-the-loop interrupts / checkpointers** — not needed: the graph ends at
  "validated proposed changes"; accept/apply is UI-driven and outside the graph.
- **PDF rendering** — Epic 8.

---

## 4. Functional Requirements

### Structured substrate & schema
1. FR-001 — The engine operates on a **structured tailoring document** built from the Epic 4 parsed
   CV (+ base CV text), exposing **addressable editable paths** (`summary`,
   `experience[i].bullets[j]`, `projects[i].bullets[j]`, `education[i].description`, `skills[]`) and
   treating identity/employer/date/institution/degree fields as **frozen**.
2. FR-002 — The LLM returns a validated **`ProposedChange[]`** (Zod schema):
   `{ path, action(replace|append|reorder|add_skill), original, value, reason }`; the prompt
   requires the exact `original` and a `reason`, forbids touching frozen fields, forbids invented
   metrics, and instructs reframing **existing** content into the JD's vocabulary (preserving
   casing/proper nouns).

### The gates (pure, deterministic)
3. FR-003 — Every change passes four gates before it can be applied: **(1)** path in the editable
   allowlist, **(2)** not a blocked path/leaf-field, **(3)** path resolves to a real value, **(4)**
   for `replace`, the supplied `original` matches the actual text (case/space-insensitive). Failing
   any gate → the change is **rejected** (recorded, not applied).
4. FR-004 — Action-specific safety holds: `replace`→string only; `append`→non-empty string onto a
   list; `reorder`→permutation of the existing items (salvage keeps only verified new skills, never
   drops a real item); `add_skill`→only a skill in the **verified** targets.
5. FR-005 — A **3-tier skill verifier** (pure) gates `add_skill`: accept `existing` /
   `jd_added` / `supported_by_resume`; **reject `unsupported`** (fabrication). Every accepted skill
   traces to evidence.

### Refinement loop
6. FR-006 — **Injectable/non-injectable gap analysis**: missing JD keywords present in the master CV
   are injectable (surfaced/woven in by reframing real content); those absent from the master are
   **non-injectable** and returned as flagged gaps — never injected.
7. FR-007 — A **local AI-phrase remover** replaces blacklisted filler with plainer wording but never
   alters a term that appears in the JD; it makes no LLM call.
8. FR-008 — A **master-alignment check** rejects any proposed skill/certification/employer not
   grounded in the master CV or JD; **critical violations block** (re-loop or drop), info-level
   variants pass with a note.
9. FR-009 — The refine loop is **bounded** (max N passes) and terminates on: no new injectable
   keywords, no match-percent improvement, or N reached — it can never loop indefinitely.

### Orchestration, warnings, output, apply
10. FR-010 — The pipeline is a **LangGraph** in the main process; **all validation/checks are pure
    TypeScript** called from nodes (the graph routes, the functions decide). Per-node **progress
    events** stream to the renderer (reusing the extraction progress pattern).
11. FR-011 — **Heuristic warnings** accompany the output: invented-metric detection (a number in new
    text absent from the original) and a word-count blow-up flag — surfaced to the user, not
    silently dropped.
12. FR-012 — The engine returns **gate-validated proposed changes + rejected list + warnings +
    `RefinementStats`** (passes, keywords injected, AI phrases removed, alignment violations fixed,
    **initial→final match %**) and **persists nothing**.
13. FR-013 — A separate **deterministic apply** entry point takes the user-accepted subset, applies
    it to produce the saved tailored document, and triggers the **Epic 5 deterministic rescore**
    (never an LLM score).
14. FR-014 — JD and CV text are **untrusted**: a deterministic **prompt-injection pre-sanitizer**
    runs before any LLM node, and the JD is framed as data, never instructions.
15. FR-015 — The engine requires a saved **OpenRouter key + default model** (Epic 2) and degrades
    with a clear, per-code message when absent or when the model is not structured-output capable.

---

## 5. Non-Functional Requirements

- NFR-001 (Grounded by construction) — Fabrication is prevented by the gates + verifiers in code,
  not by prompt wording; identity/dates/employers are unreachable by any change.
- NFR-002 (Determinism & auditability) — Gates, verifiers, AI-phrase removal, alignment, and rescore
  are pure and unit-testable; every change carries a path, reason, and gate verdict for an auditable
  trail (and to power the Epic 7 diff preview / high-risk flag).
- NFR-003 (Separation from the score) — The engine never emits a number; rescoring is the Epic 5
  deterministic scorer; the stars remain the one authoritative rating.
- NFR-004 (Prompt-injection resistance) — Pre-sanitizer + JD-as-data + structured output; the engine
  cannot be steered to fabricate, leak the CV, or change behaviour.
- NFR-005 (Resilience) — Malformed LLM output (bad paths, missing originals, non-permutation
  reorders) is rejected gracefully; the pipeline always returns a well-formed result.
- NFR-006 (Performance/cost) — Bounded passes; reuse the Epic 6 review's keywords when cached to
  save a call; on-demand per job.
- NFR-007 (Cross-platform) — Engine, gates, graph, and rescore work on macOS/Windows/Linux from one
  codebase (main process / `src-electron`).

---

## 6. UI/UX Notes

This epic is **engine-only**; its UI lives in the **Epic 7 tailor view**, which consumes the output:

- The CV tab renders the **proposed changes** as an accept/reject diff (per-change +/–/~, the
  `reason`, and **high-risk flags** from the warnings — invented metric, big word-count jump, any
  surfaced non-injectable gap).
- A **match-% before→after** readout (from `RefinementStats`) and the live Epic 5 star/% that updates
  on **apply** (deterministic rescore).
- Accept-all or per-change accept; on apply, only the accepted subset is written.
- Per-node progress ("analysing JD → planning → drafting edits → validating → refining → rescoring");
  per-code errors (no key / model-not-capable / rate-limited / network).

---

## 7. Data Model Impact

```ts
type TailorAction = 'replace' | 'append' | 'reorder' | 'add_skill';

interface ProposedChange {
  path: string;                 // e.g. "experience[0].bullets[1]"
  action: TailorAction;
  original: string | string[] | null;   // exact current text (for verification)
  value: string | string[];
  reason: string;               // why it helps match the JD
}

type SkillTier = 'existing' | 'jd_added' | 'supported_by_resume' | 'unsupported';
interface VerifiedSkill { skill: string; tier: SkillTier; }   // 'unsupported' rejected

interface TailorWarning { kind: 'invented_metric' | 'word_count' | 'non_injectable_gap'; path?: string; detail: string; }

interface RefinementStats {
  passes: number; keywordsInjected: number; aiPhrasesRemoved: string[];
  alignmentViolationsFixed: number; initialMatchPercent: number; finalMatchPercent: number;
}

interface TailorEngineResult {
  proposedChanges: ProposedChange[];   // gate-validated
  rejected: ProposedChange[];
  warnings: TailorWarning[];
  stats: RefinementStats;
}
```

- **No new persisted table by this epic.** The accepted result is written by Epic 7's `tailored_docs`
  (the apply step). The structured **tailoring document** model is derived on demand from the Epic 4
  parsed CV; if Epic 4's parsed schema does not expose per-role **bullet lists**, that becomes a
  small dependency (see §10).

---

## 8. Integration Impact

- **New main-process module** `src-electron/tailorEngine.ts` — builds the **LangGraph** (reusing the
  Epic 3 `@langchain/langgraph` + `ChatOpenAI`→OpenRouter pattern), with nodes calling **pure-TS**
  helpers in sibling modules: `tailorGates.ts` (4 gates + apply-to-working-copy), `skillVerifier.ts`
  (3-tier), `refine.ts` (injectable analysis, AI-phrase remover, alignment), and reuse of the **Epic 5
  scorer** for rescore. A deterministic `applyAcceptedChanges()` for the UI-driven apply.
- **Prompts**: a `generate-diffs` structured prompt (our own wording, the rules in §4) + a
  `skill-target` prompt; a deterministic **injection sanitizer** shared with Epics 3/6/7.
- **electron-main / preload / types**: `tailor:propose` (run the graph → `TailorEngineResult`) and
  `tailor:apply` (accepted subset → tailored doc + Epic 5 rescore) IPC; `window.starTailorEngine`
  bridge with stable error codes; progress events.
- **Epic 7 wiring**: Epic 7's "generate tailored CV" delegates to `tailor:propose`; its tailor view
  renders the diff/accept UI and calls `tailor:apply`. Epic 7 retains cover letter, intensity,
  disclosure, export.
- **Reuse**: Epic 6 review keywords (when cached) feed extract-JD-signals; Epic 4 CV/Profile;
  Epic 3 JD text; Epic 2 key/model.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] The engine returns **gate-validated proposed changes** as `{path, action, original, value,
      reason}`, built only from the user's real content; identity/employer/date/institution/degree
      paths are unreachable and any change targeting them is rejected.
- [ ] A change whose `original` does not match the actual CV text is rejected (no stale/hallucinated
      edits applied).
- [ ] `add_skill` is accepted only for skills verified as existing / JD-required / supported-by-
      resume; `unsupported` skills are rejected.
- [ ] The full **refine loop** runs (injectable-keyword injection, local AI-phrase removal protecting
      JD terms, master-alignment with critical-violation blocking), is **bounded**, and reports
      **initial→final match %** plus pass/injection/removal/violation stats.
- [ ] Invented-metric and word-count warnings are surfaced; non-injectable gaps are returned as flags,
      never injected.
- [ ] The engine **persists nothing**; the Epic 7 UI accepts a subset and the **deterministic apply**
      writes the tailored doc and triggers the **Epic 5 rescore** (no LLM number anywhere).
- [ ] Orchestration is a **LangGraph** with **pure-TS gates/checks**; per-node progress streams; the
      gates/verifiers/refine/rescore have unit tests independent of the network.
- [ ] A prompt-injection-laden JD cannot fabricate content, leak the CV, or change behaviour; missing
      key / non-capable model degrade with clear messages.

---

## 10. Risks & Unknowns

- **Structured-CV substrate depth:** path-addressed bullet edits need the CV represented with
  per-role **bullet lists**. If Epic 4's parsed schema is thinner (skills + flat fields), we must
  derive bullets from the base CV text or extend Epic 4. **Resolve the substrate first** (ticket 1).
- **LLM returning invalid change objects:** mitigated — every change is gated and malformed ones are
  rejected; the result is always well-formed. Worst case: few/no changes (surface "no safe edits
  found", not an error).
- **Reorder/add_skill salvage complexity:** the permutation-salvage logic is fiddly; ship
  `replace`+`append` first within the same graph, then enable `reorder`/`add_skill`.
- **Loop non-termination / cost:** bounded passes + plateau exit (FR-009); reuse cached Epic 6
  keywords to cut a call.
- **LangGraph state typing weight:** keep the graph state annotation small/flat to avoid heavy type
  inference (this lives in `src-electron`/esbuild, not `vue-tsc`, so the TAILOR-004-style blow-up
  risk is low — but keep state types lean).
- **Two-engines drift with Epic 7:** clear ownership — Epic 9 = structured-diff engine; Epic 7 = UI +
  cover letter + apply trigger — prevents overlap.

---

## 11. Dependencies

- **Epic 2 (OpenRouter Key & Model)** — required (LLM nodes).
- **Epic 3 (Agentic Job Extraction)** — JD text + the existing `@langchain/langgraph`/`ChatOpenAI`
  pattern this engine reuses.
- **Epic 4 (Add CV to Profile)** — the structured CV substrate (may need per-role bullets exposed).
- **Epic 5 (Job Match Scoring)** — its deterministic scorer is reused for rescore (read-only of the
  scorer, not the score store).
- **Epic 6 (AI Match Review)** — optional input: cached requirement/keyword analysis feeds
  extract-JD-signals.
- **Epic 7 (Tailoring)** — consumes this engine (delegation); owns the diff/accept UI, cover letter,
  intensity, disclosure, export.

---

## 12. References

- source_skill (conceptual inspiration; **Apache-2.0 © srbhr/Resume-Matcher**,
  https://github.com/srbhr/Resume-Matcher; C:\dev\build\references\Resume-Matcher) —
  `apps/backend/app/services/improver.py` (apply_diffs four gates, `_ALLOWED_PATH_PATTERNS` /
  `_BLOCKED_PATH_PREFIXES` / `_BLOCKED_FIELD_NAMES`, `_verify_original_matches`, `_METRIC_RE`
  invented-metric check, `verify_skill_target_plan` 3-tier), `services/refiner.py` (multi-pass
  refine, `validate_master_alignment`, injectable/non-injectable), `prompts/templates.py`
  (`DIFF_IMPROVE_PROMPT` rules), `schemas/models.py` (`ResumeChange`). We adapt the **structure and
  rules**, copy **no** code, and emit **no number**. **Apache-2.0:** verbatim/substantial reuse would
  require preserving its LICENSE + NOTICE, **stating the changes made**, and a project
  `NOTICE`/`THIRD-PARTY-LICENSES` entry + borrowed-file headers.
- prd: docs/Product Requirements Document/PRD.md (Epic D — Tailoring; §5.6 FR-LLM-001/005 grounding +
  accept→deterministic rescore)
- architecture: docs/Architecture/Architecture.md (LangGraph for multi-step; scores stay
  deterministic)
- related_epics: docs/Epics/epic_07_TAILORING.md (consumer/UI), docs/Epics/epic_05_JOB_MATCH_SCORING.md
  (rescore), docs/Epics/epic_06_AI_MATCH_REVIEW.md (keyword input), docs/Epics/epic_03_AGENTIC_JOB_EXTRACTION.md
  (LangGraph pattern)

---

## 13. Implementation Notes (For Planning Agent)

Backend-first; serialise the scaffolding files (`electron-main.ts` / `electron-preload.ts` /
`env.d.ts`).

1. (Backend) **Structured tailoring-document model + addressable paths** over the Epic 4 parsed CV
   (+ base CV text); resolve the per-role **bullet-list** substrate question (derive from text or
   extend Epic 4). Define the editable allowlist and frozen fields. Pure + tested.
2. (Backend) **`tailorGates.ts`** — the four gates + action-specific safety + apply-to-working-copy
   (replace/append first; reorder/add_skill with salvage). Pure, exhaustively unit-tested.
3. (Backend) **`skillVerifier.ts`** — the 3-tier verifier; **`refine.ts`** — injectable/non-injectable
   gap analysis, local AI-phrase remover (JD-protected blacklist), master-alignment with critical/
   info severities; invented-metric + word-count warnings. Pure + tested.
4. (Backend) **Prompts** — `generate-diffs` (our wording, §4 rules) + `skill-target`; the shared
   deterministic **injection sanitizer**.
5. (Backend) **`tailorEngine.ts`** — the **LangGraph**: extract-signals → plan/verify-skills →
   generate-diffs → gate-filter → refine loop (bounded) → rescore; per-node progress; pure-TS nodes;
   `ChatOpenAI`→OpenRouter (Epic 2); structured-output capability guard. Injectable LLM for tests.
6. (Backend) **IPC + preload + types** — `tailor:propose` (→ `TailorEngineResult`) and `tailor:apply`
   (accepted subset → tailored doc + **Epic 5 rescore**); `window.starTailorEngine`; progress events;
   stable error codes.
7. (Frontend/Epic 7) **Delegate** Epic 7's CV tailoring to `tailor:propose`; render the diff/accept +
   high-risk + before→after match% UI; call `tailor:apply`.
8. (Tests) Gate/verifier/refine/rescore unit tests; a graph test with a stubbed structured LLM (no
   number; frozen-field edits rejected; original-mismatch rejected; unsupported skill rejected;
   injection-laden JD handled as data; bounded loop terminates).
9. (Docs) Help + architecture/data-model: what the engine is, the grounding guarantees, the
   delegation from Epic 7, and the Apache-2.0 attribution.

Expected complexity: High — the pure gates/verifiers are moderate but must be airtight; the care is in
the structured substrate, the bounded refine loop, the LangGraph wiring + progress, the strict
Epic 5 rescore separation, and graceful no-key/model handling.
Estimated total effort: ~9–10 tickets (1–4 hours each).

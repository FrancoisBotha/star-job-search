# Epic 13: CV Enrichment — strengthen the uploaded CV (grounded, Q&A-driven)

Status: TICKETS
Owner: human
Created: 2026-06-20
Last Updated: 2026-06-20

---

## 1. Purpose

A **"CV Enrichment"** menu item that proactively makes the user's **uploaded CV stronger** — *before*
and *independent of* any specific job. It finds weak material (generic verbs, missing metrics, unclear
scope), asks the user a few **targeted questions** to surface **real** numbers and context, then proposes
**grounded, gated** improvements (sharper, quantified bullets built from the user's own answers) that the
user reviews and applies — producing a better master CV that lifts **every** downstream score, AI review,
and tailoring.

It is **job-agnostic** (no JD) and **reuses Epic 9's grounded diff-edit engine** (structured changes +
deterministic gates + diff preview) — the same anti-fabrication machinery, driven by an enrichment
analysis + user Q&A instead of a job description.

> **Hard rule — grounded, never invented.** New content may come ONLY from (a) existing CV material
> reworded, or (b) the **user's own answers** to the enrichment questions. The system **never invents or
> estimates** metrics, skills, or experience. (We deliberately adopt the *metric-discovery questioning*
> from the reference skills but **reject their "estimate when unknown" techniques** — a number the user
> can't supply stays absent.) Identity, employers, dates, institutions and degrees are frozen.

> **Attribution / IP note.** The proactive enrichment Q&A loop draws conceptual inspiration from the
> **Apache-2.0 Resume-Matcher** (© srbhr) enrichment flow; the weak-bullet signals, metric-discovery
> questions, and X-Y-Z / condensed-STAR bullet formulas from the **MIT Resume Skills** library
> (© 2026 Resume Skills, `resume-quantifier` / `resume-bullet-writer`); and the never-invent rule from the
> **MIT career-ops** skill. All are **re-expressed as our own** prompts/checks — no code or prose copied.
> If any code/text is later reused verbatim, carry the respective LICENSE/NOTICE (and, for Apache-2.0,
> state changes).

---

## 2. User Story

As a job seeker whose CV is a bit flat,
I want the app to spot weak bullets and ask me for the real numbers behind them, then rewrite them stronger using my answers,
So that my base CV improves once — honestly — and every match and tailored draft gets better, without me inventing anything.

---

## 3. Scope

### In Scope

- A **"CV Enrichment"** sidebar menu item / route operating on the **uploaded CV** (Epic 4 `currentCv`);
  requires a CV present + an OpenRouter key + default model (Epic 2), disabled/explained otherwise.
- **Analyze** — detect weak material on the CV: generic verbs ("responsible for", "worked on", "helped
  with"), **missing metrics**, unclear scope (no team size / scale / outcome), passive voice. Deterministic
  signals + an LLM pass → a **prioritized list** of improvable bullets.
- **Question** — generate a small set (**2–6**, capped) of **targeted clarifying questions** to elicit the
  user's **real** numbers/context (scale, before/after, team size, throughput, outcome) for the weakest
  items; the user answers or skips each.
- **Enrich** — generate improved bullets as **structured, gated diffs** (reuse the Epic 9 engine): X-Y-Z
  ("accomplished X measured by Y by doing Z") / condensed-STAR formulas, woven with the user's answers,
  through the four gates (identity/dates/employers frozen, original-match, etc.).
- **Grounding gate (enrichment variant)** — a new number/metric is accepted **only if it traces to a
  user-provided answer** (or already exists in the CV); otherwise the change is **rejected**. Never
  estimated/invented.
- **Review & apply** — the user reviews proposed enrichments in a **diff preview** (accept/reject per
  bullet, reuse the Epic 9 UI pattern); applying writes a **new enriched CV version** (Epic 4 versioning),
  re-derives the structured profile, and **marks downstream scores/reviews stale**.

### Out of Scope (deferred / boundaries)

- **JD-specific tailoring** — that's Epic 7/9; enrichment is **job-agnostic**.
- **Estimating / inventing metrics** — explicit non-goal; absent numbers stay absent.
- **Cover letters, interview prep, PDF/Word export** — other epics.
- **Editing identity / employers / dates / institutions / degrees** — frozen, by the Epic 9 gates.
- **A full résumé editor** — enrichment proposes gated bullet improvements; it is not a free-form editor.

---

## 4. Functional Requirements

1. FR-001 — A **"CV Enrichment"** menu item/route operates on the uploaded CV; it requires a CV + key +
   default model and is disabled with a clear reason otherwise.
2. FR-002 — The **analyze** step flags weak bullets via deterministic signals (generic verbs, no metric,
   passive voice, no scope) plus an LLM pass, returning a prioritized improvable-item list.
3. FR-003 — The **question** step generates 2–6 targeted, specific clarifying questions (metric-discovery)
   for the weakest items; the user answers or skips; total questions are capped.
4. FR-004 — The **enrich** step produces improved bullets as **Epic 9 structured gated diffs** grounded in
   existing CV content + the user's answers; identity/dates/employers are unreachable.
5. FR-005 — A new metric/number is accepted **only if it traces to a user answer** (or existing CV text);
   otherwise it is rejected — **never estimated or invented** (the Epic 9 invented-metric check is adapted
   to allow user-answer-sourced numbers and reject all others).
6. FR-006 — The user reviews proposed enrichments (diff preview, accept/reject per bullet); applying the
   accepted set writes a **new enriched CV version**, re-derives the profile, and marks downstream
   scores/reviews **stale**.
7. FR-007 — Requires Epic 2 key/model; CV text is untrusted (injection-safe); the one-time "what is sent"
   disclosure is reused; no new egress beyond OpenRouter.

---

## 5. Non-Functional Requirements

- NFR-001 (Grounding) — The defining property: nothing is invented or estimated; every added word traces to
  existing CV content or a user answer, enforced by the gates (in code, not just prompt).
- NFR-002 (Reuse & auditability) — Built on the Epic 9 pure-TS gates/apply; every proposed change carries a
  path + reason + provenance + gate verdict.
- NFR-003 (Determinism of apply) — Versioning, profile re-derivation, and stale-marking are deterministic
  and reproducible.
- NFR-004 (Prompt-injection resistance) — CV text handled as data; the analysis/question/enrich calls can't
  be steered to fabricate or change behaviour.
- NFR-005 (Cross-platform) — Works on macOS/Windows/Linux from one codebase.

---

## 6. UI/UX Notes

- **Menu item:** "CV Enrichment" in the sidebar (SETUP group near Profile/Help), route e.g. `/enrich`.
- **Three-step screen:**
  1. **Analyze** — shows the weak items found ("3 bullets could be stronger") with the reason per item.
  2. **Questions** — 2–6 targeted questions with answer inputs ("How many users? Team size? Before/after?");
     the user answers or skips; a "I don't have that number" option leaves the bullet minimally reworded,
     never invented.
  3. **Review** — proposed enriched bullets as an accept/reject **diff** vs the current CV (reuse Epic 9's
     diff preview), with the provenance ("from your answer: 250k users"); **Apply** → "CV updated (v{n})".
- Empty/disabled states for no-CV / no-key. Reuse the Studio visual system.

---

## 7. Data Model Impact

- **Reuses Epic 4 CV versioning** (applying enrichment creates a new CV version + re-derives the profile)
  and the **Epic 9 structured-CV model + `ProposedChange`/gate verdict**. No new content table.
- The enrichment **session** (the questions + the user's answers) is transient input to generation; persist
  only the resulting CV version. (Optional later: keep answers as reusable "profile facts".)

---

## 8. Integration Impact

- **New screen + route + sidebar item** (Epic 1 shell / router).
- **Reuse Epic 9 engine:** the structured-CV model, the four gates + `apply`, and the diff-preview UI —
  with an **enrichment-flavoured `generate`** (analysis + Q&A driven, no JD, no rescore) and the
  **answer-provenance metric gate**.
- **Backend:** a weak-bullet **analyzer** (deterministic signals + LLM), a **question generator**, and the
  enrichment **generate** call (reusing Epic 9 gates); an **apply** path that writes a new CV version
  (Epic 4), re-derives the profile, and triggers Epic 5/6 stale hooks.
- **IPC + preload + types:** `enrich:analyze` / `enrich:questions` / `enrich:propose` / `enrich:apply`
  (tagged-union results, stable error codes); `window.starEnrich` bridge.
- **Reuse:** Epic 2 key/model, Epic 4 CV + versioning + disclosure, Epic 9 gates/apply/diff UI, Epic 5/6
  stale hooks.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] A "CV Enrichment" menu item opens a screen that analyzes the uploaded CV and lists weak bullets with
      reasons (requires a CV + key/model; clear message otherwise).
- [ ] It asks 2–6 targeted metric-discovery questions; the user answers or skips, and "no number" leaves the
      bullet minimally reworded rather than invented.
- [ ] Proposed enriched bullets are gated Epic 9 diffs grounded in existing content + the user's answers;
      identity/employers/dates are never edited; a number that doesn't trace to an answer or the CV is
      rejected (no estimation/fabrication).
- [ ] The user accepts/rejects per bullet; applying writes a new enriched CV version, re-derives the profile,
      and marks downstream scores/reviews stale.
- [ ] Injection-laden CV text can't fabricate content or change behaviour; the feature needs a key and opens
      no new egress (one-time disclosure on first send).

---

## 10. Risks & Unknowns

- **The fabrication line is the whole point** — enrichment *adds* content, so the answer-provenance gate
  must be airtight (a metric not present in the CV and not in a user answer is rejected). This is the
  central risk; mitigate by reusing/extending the Epic 9 invented-metric gate with provenance.
- **Depends on the Epic 9 structured-CV model** — enrichment needs per-role bullet addressing (the same
  substrate as TDE-001); sequence after that lands, or derive bullets from CV text.
- **Question fatigue** — cap at 2–6, prioritise the weakest items, always allow skip.
- **Weak-signal precision** — generic-verb/no-metric detection should be deterministic + conservative to
  avoid nagging on already-good bullets.
- **Version sprawl** — each apply makes a CV version; keep the latest as current and let prior tailored
  drafts retain their source version (Epic 4 FR-CV-006).

---

## 11. Dependencies

- **Epic 4 (Add CV to Profile)** — the uploaded CV, its versioning, the structured fields, and the
  disclosure pattern.
- **Epic 9 (Diff-Edit Engine)** — REUSED: the structured-CV model (TDE-001), the gates + apply (TDE-002),
  and the diff-preview UI; enrichment adds an analysis + Q&A + enrichment-generate on top.
- **Epic 2 (OpenRouter Key & Model)** — the LLM analysis/question/enrich calls.
- **Epic 5 / Epic 6** — mark scores/reviews stale when the enriched CV is applied.

---

## 12. References

- source_skill (conceptual inspiration; re-expressed, no code/prose copied):
  - **Resume-Matcher** (Apache-2.0 © srbhr; C:\dev\build\references\Resume-Matcher) — the proactive
    enrichment Q&A loop (`routers/enrichment.py`, analyse weak items → questions → grounded new bullets).
  - **Resume Skills** (MIT © 2026 Resume Skills; C:\dev\build\references\ResumeSkills) —
    `skills/resume-quantifier` (metric categories, "no numbers" → ask, not estimate) and
    `skills/resume-bullet-writer` (X-Y-Z + condensed-STAR formulas, power verbs). We adopt the *questioning*,
    **reject the "estimate when unknown"** technique.
  - **career-ops** (MIT © 2026 Santiago Fernández de Valderrama) — the never-invent rule.
  - Apache-2.0 reuse of code would additionally require preserving LICENSE/NOTICE + stating changes.
- prd: docs/Product Requirements Document/PRD.md (Profile/CV; grounding/never-fabricate principle)
- related_epics: docs/Epics/epic_09_TAILORING_DIFF_ENGINE.md (engine reused),
  docs/Epics/epic_04_ADD_CV_TO_PROFILE.md (CV + versioning), docs/Epics/epic_06_AI_MATCH_REVIEW.md (stale)

---

## 13. Implementation Notes (For Planning Agent)

Backend-first; reuse Epic 9 heavily; serialise scaffolding (`electron-main` / `electron-preload` /
`env.d.ts`).

1. (Backend) **Weak-bullet analyzer** — deterministic signals (generic-verb list, no-metric regex, passive
   voice, no-scope) + an LLM pass → prioritized improvable items with reasons. Pure signals unit-tested.
2. (Backend) **Question generator** — 2–6 targeted metric-discovery questions for the weakest items (capped,
   skippable), via a structured LLM call.
3. (Backend) **Enrichment generate + answer-provenance gate** — reuse the Epic 9 gates/apply; the
   `generate` prompt produces gated bullet diffs from existing content + answers; extend the invented-metric
   gate to **accept user-answer-sourced numbers, reject all others**. Pure gate logic tested.
4. (Backend) **Apply** — write a new CV version (Epic 4), re-derive the profile, trigger Epic 5/6 stale
   hooks; deterministic + dedup-safe.
5. (Backend) **IPC + preload + types** — `enrich:analyze|questions|propose|apply` + `window.starEnrich`.
6. (Frontend) **CV Enrichment screen + sidebar menu item + route** — the 3-step Analyze → Questions → Review
   (diff) flow, reusing the Epic 9 diff-preview component; provenance labels; apply → "CV updated (v{n})".
7. (Tests) Analyzer signals, the answer-provenance gate (number-from-answer accepted, invented number
   rejected), apply→new-version+stale, and a screen wiring test (skip leaves bullet minimally reworded).

Expected complexity: Medium–High — much is reused from Epic 9; the new care is the weak-bullet analyzer, the
Q&A step, and the airtight **answer-provenance** grounding gate.
Estimated total effort: ~7 tickets (1–4 hours each).

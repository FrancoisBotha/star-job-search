# Epic 10: Dealbreaker Rules (deterministic soft flags)

Status: TICKETS
Owner: human
Created: 2026-06-20
Last Updated: 2026-06-20

---

## 1. Purpose

Let the user define a small set of **dealbreakers** — things that make a job a non-starter for
them (a banned keyword in the posting, a company they won't work for, pay below a floor) — and have
the Job Board **flag** matching jobs so the user can spot and skip them fast.

v1 is deliberately **lightweight, deterministic, and soft**: a couple of rules on the Profile page,
evaluated by pure offline logic (no LLM), surfaced as a **⚠ chip** on the board tile. Matched jobs
are **not hidden** — they stay visible, flagged, and optionally sorted below clean matches — so a
false positive never silently buries a good job.

> **Orthogonal to the score.** Dealbreakers never touch the Epic 5 deterministic score. A job can be
> ★5 *and* flagged; the stars stay a pure fit measure, the dealbreaker chip is a separate
> acceptability signal (mirrors how `not_interested` is orthogonal to the score).

> **Soft by design (v1).** No hard-hide in v1 — flag only. Keyword rules false-positive easily
> (e.g. "no security clearance required" matching a "security clearance" rule), so v1 keeps the user
> in control: show the match + the matched term, don't suppress. Hard-hide is a deliberate future
> option, out of scope here.

---

## 2. User Story

As a job seeker scanning my board,
I want jobs that hit my known dealbreakers (a banned phrase, a company I avoid, pay too low) to be visibly flagged,
So that I can skip them at a glance without reading every posting, while never having a good match hidden from me by a clumsy keyword rule.

---

## 3. Scope

### In Scope (v1)

- **2–3 dealbreaker rules**, configured in a **Dealbreakers** section on the **Profile page**,
  persisted on the Profile (Epic 4):
  1. **Keyword dealbreakers** — a list of words/phrases; a job is flagged if its **title or
     description** contains any (case-insensitive, **word-boundary** matching so "java" ≠
     "javascript").
  2. **Company dealbreakers** — a list of company names/substrings; flagged if the job's **company**
     matches.
  3. **Minimum salary** *(depends on EXTR-013 salary extraction)* — flagged if the job's **stated**
     salary is below the floor; **no-ops when salary is absent** (never flags "not stated").
- A **pure, deterministic evaluator** (`job × rules → verdict`) producing, per job, whether it is
  flagged and **which rule(s) matched and on what term/field** (for an explainable tooltip).
- **Soft surfacing only:** a **⚠ dealbreaker chip** on each flagged **Job Board** tile (with a
  tooltip naming the matched rule/term); flagged jobs remain on the board, and may be **sorted below
  clean matches** (after the existing score ordering).
- Rules are evaluated **reactively** in the store against the visible jobs — editing a rule
  re-flags instantly (like the `scoresStale` pattern); only the **rule values** are persisted, never
  per-job verdicts.

### Out of Scope (deferred)

- **Hard-hide / auto-suppress** ("N hidden by rules — review") — v1 is flag-only.
- **A full dynamic rule builder** (arbitrary field/op/value rows) — v1 is a fixed 2–3 rule set.
- **LLM-assisted / fuzzy rules** (e.g. inferring "requires relocation") — v1 is deterministic only.
- **The "turn a dismissal into a rule" bridge** (PRD FR-STAR-004) — a natural follow-up, not v1.
- **Structured knockouts needing new extraction** (work-mode, employment-type, required-experience)
  — follow once their EXTR fields exist.
- **Flagging on Starred / Dashboard tiles** — v1 targets the Job Board; the shared evaluator makes
  mirroring it later trivial.

---

## 4. Functional Requirements

1. FR-001 — The Profile page has a **Dealbreakers** section with inputs for **keyword** dealbreakers,
   **company** dealbreakers, and a **minimum salary** floor; values persist on the Profile and
   survive a reload/restart (reuses Epic 4 persistence + the CVPROF-015 boot-hydration fix).
2. FR-002 — A **pure deterministic evaluator** flags a job when: its title/description contains a
   keyword rule value (case-insensitive, word-boundary), **or** its company matches a company rule
   value, **or** (when a stated salary is present) its salary is below the minimum-salary floor.
3. FR-003 — The evaluator returns, per flagged job, the **matched rule(s)** and the **field + term**
   that triggered it, so the UI can explain the flag.
4. FR-004 — The **Job Board** renders a **⚠ dealbreaker chip** on each flagged tile, with a tooltip
   naming the matched rule/term; flagged jobs **stay visible** (no hiding).
5. FR-005 — Flagged jobs may be **ordered below clean matches** within the existing score-based board
   ordering (clean-first, then flagged), without disturbing the score itself.
6. FR-006 — Rule evaluation is **reactive**: editing/clearing a rule re-flags the board immediately;
   no per-job verdicts are persisted.
7. FR-007 — The minimum-salary rule **no-ops on jobs with no stated salary** (never flags "not
   stated"); empty rule lists flag nothing.

---

## 5. Non-Functional Requirements

- NFR-001 (Determinism) — Evaluation is pure, offline, reproducible, and unit-tested; no LLM, no
  network.
- NFR-002 (Separation) — Dealbreakers never read or write the Epic 5 score store; the stars remain
  the sole fit rating.
- NFR-003 (No silent loss) — v1 never hides a job; a false-positive rule can only add a removable
  chip, never bury a match.
- NFR-004 (Explainability) — Every flag names the rule + matched term.
- NFR-005 (Cross-platform) — Works on macOS/Windows/Linux from one codebase.

---

## 6. UI/UX Notes

- **Profile page — "Dealbreakers" section:** a keyword list input (chips or comma/newline list), a
  company list input, and a minimum-salary number field; reuse existing field styling; each persists
  on edit like the other Profile fields.
- **Job Board tile:** a small **⚠ chip** (muted/warning token) on flagged tiles; hover/tooltip =
  "Dealbreaker: description contains 'security clearance'". Clean tiles are unchanged.
- **Ordering:** clean matches first (by score), flagged matches after — a gentle nudge, not a hide.
- Reuse the Studio visual system; no new tokens.

---

## 7. Data Model Impact

- **No new table.** Extend the Profile (Epic 4) with dealbreaker fields:

```ts
interface StarProfileDealbreakers {
  dealbreakerKeywords: string[];   // matched against title + description (word-boundary, ci)
  dealbreakerCompanies: string[];  // matched against company (ci, substring/word-boundary)
  dealbreakerSalaryMin: number | null;  // floor; needs EXTR-013 stated salary to fire
}
```

- Additive, guarded migration if Profile is persisted column-wise; otherwise these live in the
  Profile JSON. Renderer types mirror the main contract.
- The evaluator's **verdict is computed, never stored**:

```ts
interface DealbreakerHit { rule: 'keyword' | 'company' | 'salary'; field: 'title' | 'description' | 'company' | 'salary'; term: string; }
interface DealbreakerVerdict { flagged: boolean; hits: DealbreakerHit[]; }
```

---

## 8. Integration Impact

- **New pure module** `app/src/utils/dealbreakers.ts` (renderer-side, deterministic): the rule model
  + `evaluateDealbreakers(job, rules) → DealbreakerVerdict` (word-boundary keyword match shared with
  any future keyword features). Unit-tested.
- **Profile (Epic 4):** add the dealbreaker fields to `profile.ts` persistence + `profile:get/save` +
  `env.d.ts` types; the Profile page gains the Dealbreakers section + `saveProfile` wiring.
- **Store + Board:** an `app-store` selector applies the evaluator to `visibleJobs` to produce a
  `flaggedBySourceId` map + a clean-first ordering; `JobBoardPage` renders the chip.
- **No IPC beyond Profile save/get** — evaluation is renderer-side and deterministic.
- **Soft dependency on EXTR-013** for the salary rule (keyword + company rules ship without it).

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] The Profile page has a Dealbreakers section (keyword list, company list, minimum salary) that
      persists and survives reload/restart.
- [ ] A job whose title/description contains a keyword rule (word-boundary, case-insensitive), or
      whose company matches a company rule, or whose stated salary is below the floor, is **flagged**.
- [ ] Each flagged Job Board tile shows a **⚠ chip** with a tooltip naming the matched rule/term;
      flagged jobs **remain visible**.
- [ ] Flagged jobs sort **after** clean matches within the existing score ordering; the Epic 5 score
      is provably unchanged.
- [ ] Editing/clearing a rule re-flags the board reactively; no per-job verdicts are persisted; the
      salary rule no-ops on jobs with no stated salary.
- [ ] The evaluator has unit tests (word-boundary, case-insensitivity, company match, salary floor,
      empty rules, salary-absent).

---

## 10. Risks & Unknowns

- **Keyword false positives / negation** ("no clearance required") — accepted in v1; mitigated by
  soft-flag-only + showing the matched term so the user sees context.
- **Substring over-matching** — use word-boundary matching; allow phrases.
- **Salary comparison** depends on EXTR-013 + parsing a stated-salary string to a number; until then
  the salary rule simply never fires (documented, not an error).
- **Scope creep toward a rule builder** — v1 is a fixed 2–3 rule set on the Profile; resist
  generalising until there's demand.

---

## 11. Dependencies

- **Epic 3 (Agentic Job Extraction)** — provides `title`, `company`, `description`, `salary` to match
  on.
- **Epic 4 (Add CV to Profile)** — Profile persistence for the rule values (+ the CVPROF-015 boot
  hydration so rules survive reload).
- **Epic 5 (Job Match Scoring)** — the board's `visibleJobs` + score ordering this layers on top of
  (read-only; never writes the score store).
- **EXTR-013 (salary extraction)** — soft dependency for the minimum-salary rule only.

---

## 12. References

- prd: docs/Product Requirements Document/PRD.md (FR-STAR-002/004 dismissal + reason→future
  filtering; §non-goals — human decides, never auto-apply)
- related_epics: docs/Epics/epic_05_JOB_MATCH_SCORING.md (orthogonal score + board ordering),
  docs/Epics/epic_03_AGENTIC_JOB_EXTRACTION.md (job fields), docs/Epics/epic_04_ADD_CV_TO_PROFILE.md
  (Profile persistence)
- concept origin: the "dealbreaker / knockout filter" idea was observed in the AGPL-3.0
  `Auto_job_applier_linkedIn` project (bad_words / about_company_bad_words / experience gates) and is
  **re-expressed here as our own deterministic soft-flag design** — **no code or text from that
  GPL/AGPL project is used or referenced**; only the general idea (which is not copyrightable).

---

## 13. Implementation Notes (For Planning Agent)

1. (Shared) `app/src/utils/dealbreakers.ts` — rule model + pure `evaluateDealbreakers(job, rules)`
   (word-boundary/ci keyword match on title+description, company match, salary floor with
   absent-salary no-op) + verdict with matched rule/field/term. Unit-tested independently.
2. (Backend/Profile) Extend `app/src-electron/profile.ts` + `profile:get/save` + `app/src/env.d.ts`
   with `dealbreakerKeywords[]`, `dealbreakerCompanies[]`, `dealbreakerSalaryMin`; additive/guarded.
3. (Frontend/Profile) Add the **Dealbreakers** section to `ProfilePage.vue` (3 inputs) bound to the
   Profile via `saveProfile` (mirror the existing field pattern).
4. (Frontend/Board) **[the Job Board ticket]** an `app-store` selector flags `visibleJobs` via the
   evaluator (clean-first ordering) + `JobBoardPage.vue` renders the **⚠ dealbreaker chip** with a
   matched-rule tooltip.
5. (Tests) Evaluator unit tests + a board test (chip shows on flagged tile, clean-first order, score
   untouched, salary rule no-ops without salary).

Expected complexity: Low–Medium — the evaluator and chip are small; the care is word-boundary matching,
the Profile persistence/hydration, and keeping it strictly orthogonal to the Epic 5 score.
Estimated total effort: ~5 tickets (1–3 hours each).

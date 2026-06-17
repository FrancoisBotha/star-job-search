# Epic 5: Job Match Scoring (1–5 Stars)

Status: NEW
Owner: human
Created: 2026-06-17
Last Updated: 2026-06-17

---

## 1. Purpose

Deliver the product's **central motif**: the **1–5 star match score** and its
**explainable per-factor breakdown**. Every job on the Job Board (Epic 3) is
scored against the user's Profile (Epic 4) so the user can instantly see which
roles are worth their time and *why*.

Per the Architecture, the scorer is **deterministic and in-app — not LLM
scoring**. The same `(listing, profile, weights)` always yields the same stars,
the breakdown reconciles exactly with the global score, and scoring works
**offline** (it never calls OpenRouter). The LLM is reserved for tailoring in a
later epic; scores never depend on it, so they stay stable and explainable even
when the model provider is down.

This epic produces the score and its breakdown and surfaces them on the board,
the matches/Starred view, the Dashboard, and the Job-detail modal. It stops short
of **using** the score for anything generative (CV/cover-letter tailoring) and of
**scheduling** re-scores in the background — those are later epics.

> **Attribution / IP note.** The *factor dimensions and explainability approach*
> draw conceptual inspiration from the MIT-licensed **career-ops** skill
> (© 2026 Santiago Fernández de Valderrama). This epic re-expresses those ideas
> as an original **deterministic** in-app scorer in our own design and code — no
> text, prompts, rubric wording, or code are copied. (career-ops scores via an
> LLM; we deliberately score deterministically per our Architecture.)

---

## 2. User Story

As a job seeker reviewing my Job Board,
I want every listing scored 1–5 stars against my profile with a clear, factor-by-factor reason,
So that I can focus on the strongest matches and trust the score because I can see exactly how it was derived.

---

## 3. Scope

### In Scope
- A **deterministic scorer** `score(listing, profile, weights) → MatchScore` (pure function, in the main process): given a `JobRecord` and the `Profile`, compute a **0–100% match** mapped to **1–5 stars**, with a per-factor breakdown.
- **Four factors** (per the BDD), each a 0–100 sub-score with a weight:
  - **Skills** — coverage of the Profile's skills against the listing's title + description (normalised token matching with a small alias/synonym map).
  - **Experience** — the Profile's `yearsExperience` against the years the listing asks for (parsed from the description; seniority words as a fallback).
  - **Location** — the Profile's `location` + `workMode` (Remote/Hybrid/On-site) against the listing's location and detected workplace type.
  - **Salary** — the listing's parsed salary range against the Profile's `salaryMin` + currency.
- **Exact reconciliation**: the global score is the weighted average of the included factors; the displayed stars/percentage and the factor bars always add up.
- **Excluded-factor handling**: when a factor can't be evaluated (e.g. the listing states no salary, or the Profile has no salary target), it is **excluded and labelled** — the weights re-normalise over the remaining factors; an absent factor is **never scored as zero** (BDD Scenario 4).
- **Explainability**: each factor carries a short, deterministic **rationale** (matched skills, the gap, the compared values) so the breakdown reads as "why", not a black box.
- **Persistence**: `MatchScore` + `MatchFactor[]` stored in `star.db`, keyed by the job's `sourceId`, recording the **weights version** used so a score can be reproduced/audited.
- **(Re)scoring lifecycle**: score new/unscored jobs (after an extraction run and on demand); mark scores **stale** when the Profile changes (the Epic 4 "scores stale" hook) or a job is re-extracted; re-score stale jobs on demand. Scoring runs **off the UI thread** with progress, like extraction.
- **Configurable weights** with sensible defaults (a single default weight set for MVP; the structure supports user-tunable weights later).
- **Strong-match threshold** (e.g. ★4+) used to populate the Dashboard "STRONG" count and the matches view.
- **UI surfacing** (reusing existing components): `StarRating.vue` for stars + a percentage on board/match tiles; the **Job-detail modal** shows the per-factor breakdown with `ScoreBar.vue`, included/excluded labels, and the rationale (BDD UC `OPEN_JOB_DETAILS`); the Dashboard shows the strong-match count and top matches.
- **Multi-source collapse**: a listing found on more than one site is scored once as a single match and presented once, listing each source (BDD Scenario 3).

### Out of Scope (deferred to later epics)
- **LLM scoring of any kind** — scoring is deterministic by architectural decision; this is a permanent boundary, not a deferral.
- **CV / cover-letter tailoring** and any generative use of the score (the Tailoring epic; LLM-backed).
- **Ghost-job / posting-legitimacy assessment** and any **live web/market research** (e.g. comp benchmarking) — these need a new egress path beyond OpenRouter + job sites; deferred. The salary factor compares the listing's *stated* salary to the Profile only.
- **Background re-score scheduling / cadence** (the Scheduler epic) — this epic re-scores on extraction and on demand, not on a timer.
- **Multiple target roles / multiple weighting profiles** with independent scores (fast-follow).
- **Learning-to-rank / feedback-tuned weights** from user triage (a later refinement).

---

## 4. Functional Requirements

1. FR-001 — Given a `JobRecord` and the `Profile`, the scorer returns a **deterministic** result: the same inputs + weights always produce the same stars, percentage, and factor breakdown.
2. FR-002 — The result includes a **1–5 star** score, a **0–100% match**, and a **per-factor breakdown** for skills, experience, location, and salary; the global score equals the weighted average of the included factors (reconciles exactly).
3. FR-003 — A factor that cannot be evaluated is **excluded and labelled** in the breakdown, the remaining weights re-normalise, and it is never shown as a zero score.
4. FR-004 — Each factor exposes a concise **rationale** (matched skills, the specific gap, the compared values) suitable for display.
5. FR-005 — Scores **persist** in `star.db` keyed by `sourceId`, recording the weights version, and **survive an app restart**.
6. FR-006 — New/unscored jobs are scored (after extraction and on demand); editing a scoring-relevant Profile field marks affected scores **stale**; the user can **re-score** stale jobs; re-extracting a job re-scores it.
7. FR-007 — Scoring runs **off the UI thread** and never blocks the app; a batch over the board reports progress.
8. FR-008 — Scoring is **fully offline**: it makes **no network/OpenRouter call**, and a score is produced even with no AI key configured.
9. FR-009 — The Job Board / matches surfaces show **stars + percentage** per listing; the **Job-detail modal** shows the full per-factor breakdown (stars, percentage, factor bars, included/excluded labels, rationale) per BDD `OPEN_JOB_DETAILS`.
10. FR-010 — The Dashboard reflects scores: a **strong-match (★4+) count** and a **top-matches** list ordered by score.
11. FR-011 — A listing found on multiple sites is scored once and shown once, listing each source.

---

## 5. Non-Functional Requirements

- NFR-001 (Determinism) — The scorer is a pure function of `(listing, profile, weights)`; no randomness, no clock-dependence in the score itself; identical inputs → identical output; the breakdown sums to the global score.
- NFR-002 (Offline / resilience) — Scoring depends on no external service; it is unaffected by OpenRouter being down or unconfigured (contrast: extraction and tailoring need the model).
- NFR-003 (Explainability) — Every factor's contribution and rationale is inspectable; there is no hidden weighting the UI can't reconcile.
- NFR-004 (Performance) — Scoring the whole board runs off the UI thread and stays responsive; a re-score of the board completes quickly (target: hundreds of jobs in well under a second of main-thread-blocking work, batched).
- NFR-005 (Cross-platform) — Scoring + persistence work identically on macOS, Windows, and Linux from one codebase.
- NFR-006 (Privacy) — Scoring is entirely local; the Profile and listings never leave the device for scoring.

---

## 6. UI/UX Notes

- **Reuse the brand components:** `StarRating.vue` (the fractional 1–5 star motif) for the score, `ScoreBar.vue` (olive/terracotta labelled bars) for each factor.
- **Job Board / Starred / matches tiles:** show the star score + percentage on each tile; order strong matches first; the strong-match threshold drives which jobs read as "matches".
- **Job-detail modal (BDD `OPEN_JOB_DETAILS`, mockup `04`):** full details + the score as stars and a percentage + the four-factor breakdown (each with its bar, included/excluded label, and one-line rationale) + every source link. Salary with no stated value shows "not stated" and the salary factor reads **excluded**, not zero.
- **Dashboard (`01`):** the stat strip's **STRONG** number is the ★4+ count; **Top matches today** lists the highest-scoring jobs.
- **Settings (optional, MVP-lean):** a brief note that scoring is local and deterministic; user-tunable factor weights are a later addition (structure supports it).
- Studio visual system unchanged — no new tokens.

---

## 7. Data Model Impact

```ts
type FactorKey = 'skills' | 'experience' | 'location' | 'salary';

interface MatchFactor {
  key: FactorKey;
  included: boolean;     // false when the factor can't be evaluated (e.g. no salary)
  score: number;         // 0–100 sub-score (meaningless when included === false)
  weight: number;        // the (normalised) weight applied
  rationale: string;     // deterministic, human-readable "why"
}

interface MatchScore {
  sourceId: string;      // FK to the jobs board row (Epic 3)
  stars: number;         // 1–5 (fractional allowed for display)
  percent: number;       // 0–100 weighted match
  factors: MatchFactor[];
  weightsVersion: string;// which weight set produced this, for reproducibility
  stale: boolean;        // set when the Profile changes / job re-extracts
  scoredAt: number;      // ISO/epoch — provenance only, NOT an input to the score
}
```

- New `match_scores` table in the existing `star.db` (factors as a JSON column or a child table), keyed by `sourceId`, alongside `jobs`, `sites`, `preferred_models`, and `profile`.
- Renderer-side `MatchScore`/`MatchFactor` types mirror the main contract (the long-promised `MatchScore`/`MatchFactor` referenced since Epic 1 §7).
- The existing mock `Match` type in `app/src/types/models.ts` is superseded by real scored jobs (`JobRecord` + `MatchScore`).

---

## 8. Integration Impact

- **New main-process module** `src-electron/scorer.ts`: the pure `score()` function + the four factor evaluators + the default weights/version, plus a `match_scores` store (mirroring `sites.ts`/`jobs.ts`) and `registerScoringIpc`.
- **`electron-main.ts`:** open-once `star.db` reused; register the scoring IPC; score after an extraction run completes (hook into the Epic 3 flow) and expose on-demand (re)score.
- **Preload + types:** a `window.starScores` bridge (`get` / `list` / `rescore` / progress) and the `MatchScore`/`MatchFactor` `Window` types.
- **Renderer:** `app-store.ts` holds scores keyed by `sourceId` and the strong-match selectors; the Job Board / Starred tiles and the **Job-detail modal** render the score + breakdown; the Dashboard reads the strong-match count + top matches.
- **Profile-change hook (Epic 4):** when a scoring-relevant Profile field is edited, mark affected scores `stale` (the gate already exists in Epic 4); this epic adds the re-score path.
- **No new egress.** Scoring is local-only; it does not touch OpenRouter or the network — it does **not** depend on Epic 2.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] A job + profile produce a stable 1–5 star score and 0–100% that are identical across runs for the same inputs + weights.
- [ ] The four-factor breakdown is shown and the weighted average of included factors **equals** the global score (reconciles exactly).
- [ ] A listing with no stated salary shows "not stated" and the salary factor is **excluded** (labelled), not zeroed; the other factors re-normalise.
- [ ] Each factor displays a clear rationale (matched skills, the gap, the compared values).
- [ ] Scores persist in `star.db` and survive a restart; the weights version is recorded.
- [ ] Editing a scoring-relevant Profile field marks scores stale; re-scoring updates them; re-extracting a job re-scores it.
- [ ] Scoring produces results **with no AI key configured and with no network** (fully offline), and never blocks the UI thread.
- [ ] The Job-detail modal matches BDD `OPEN_JOB_DETAILS` (stars + %, per-factor bars, source links, excluded-salary case); the Dashboard shows the ★4+ count and top matches.
- [ ] A multi-site listing is scored once and presented once with all sources.
- [ ] No LLM call participates in scoring — confirms the architectural boundary.

---

## 10. Risks & Unknowns

- **Skills matching quality:** deterministic token matching can miss synonyms/abbreviations ("k8s" ↔ "Kubernetes"). Mitigation: a small, maintained alias/synonym map and normalised matching; keep it bounded and transparent rather than chasing NLP completeness.
- **Free-text parsing (salary, years):** salary ranges and "X years" are written many ways. Mitigation: conservative parsers that **exclude the factor** when confidence is low rather than guessing — never fabricate a number.
- **Weight calibration:** the default weights determine "feel". Mitigation: ship sensible defaults, expose the breakdown so the user sees the contribution, and keep weights swappable (versioned) for a later tuning pass.
- **Reconciliation exactness with fractional stars:** the star display must round consistently from the percentage so the bars and stars never visually disagree. Mitigation: a single mapping function from percent → stars used everywhere.
- **Multi-source identity:** collapsing the same job across sites depends on Epic 3's `sourceId`/dedup; if two sites yield different ids for one role, the match may appear twice. Mitigation: align with Epic 3's identity rules; treat cross-site collapse as best-effort for MVP.
- **Scope creep toward LLM scoring:** the temptation to "ask the model" for a score must be resisted — it would break determinism, offline behaviour, and reconciliation.

---

## 11. Dependencies

- **Epic 3 (Agentic Job Extraction)** — provides the `jobs` board (the listings to score) and the `sourceId` identity.
- **Epic 4 (Add CV to Profile)** — provides the `Profile` (the scoring input) and the "scores stale on profile change" gate this epic completes with a re-score path.
- **Independent of Epic 2 (OpenRouter)** — scoring makes no model call; it must work with no key configured.

---

## 12. References

- source_skill (conceptual inspiration only; MIT, © 2026 Santiago Fernández de Valderrama): C:\ai\skills_lab\career-ops — its A–F evaluation dimensions, explainable requirement→evidence mapping, gap framing, score bands, and excluded-signal handling informed our factor design. We implement deterministically and copy none of its text/prompts/code.
- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md (deterministic-scorer decision)
- data_model: docs/Data Model/Schema.ddl
- bdd: docs/BDD Use Cases/bdd_OPEN_JOB_DETAILS.md (score-breakdown UI + excluded-factor + multi-source)

---

## 13. Implementation Notes (For Planning Agent)

Suggested ticket breakdown (backend-first; serialise the shared scaffolding files
`electron-main.ts` / `electron-preload.ts` / `env.d.ts`, then `app-store.ts` /
the page files):

1. (Backend) `scorer.ts` core — the pure `score(listing, profile, weights)` function, factor framework (sub-score + weight + included + rationale), percent→stars mapping, default weights + version. Unit-test-first (deterministic, no DB/IPC).
2. (Backend) The four factor evaluators — skills (alias-map coverage), experience (years/seniority parse), location (location + work-mode fit), salary (range parse + excluded handling). Pure functions, heavily unit-tested.
3. (Backend) `match_scores` persistence in `star.db` (get/list/upsert/markStale) mirroring `sites.ts`; record `weightsVersion`.
4. (Backend) Scoring IPC + preload bridge + types: `scores:get|list|rescore`, progress; score-after-extraction hook; on-demand re-score; mark-stale on profile change.
5. (Frontend) `app-store.ts` scores state + strong-match selectors + types; rescore action + progress.
6. (Frontend) Board / Starred tiles show stars + percentage; order by score; strong-match threshold.
7. (Frontend) Job-detail modal (BDD `OPEN_JOB_DETAILS`): full details + breakdown (StarRating + ScoreBar + included/excluded + rationale + source links).
8. (Frontend) Dashboard: ★4+ STRONG count + top-matches list.
9. (Tests) Determinism + reconciliation + excluded-factor + parser edge-case tests; a golden-fixtures test pinning known job+profile → expected score.
10. (Docs) Help + architecture/data-model docs: how scoring works (deterministic, offline, the four factors, how to read the breakdown).

Expected complexity: Medium — the algorithm is bounded and deterministic; the real care is in transparent factor evaluators, exact reconciliation, conservative free-text parsing, and resisting LLM-scoring scope creep.
Estimated total effort: ~10 tickets (1–4 hours each).

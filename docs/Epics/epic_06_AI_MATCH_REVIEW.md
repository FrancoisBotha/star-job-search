# Epic 6: AI Match Review

Status: NEW
Owner: human
Created: 2026-06-17
Last Updated: 2026-06-17

---

## 1. Purpose

Give the user an **on-demand, LLM-powered qualitative review** of how their CV and
profile line up with a specific job — the "why and how" behind a listing — to sit
**alongside** Epic 5's deterministic star score.

Epic 5 answers *"how strong is this match?"* with a stable, offline, reconcilable
**number**. This epic answers *"how do I actually stack up, and what would I do about
it?"* in **words**: a requirement-by-requirement read of the JD against the CV, the
**gaps** and how to close them, the standout **strengths**, and the **keywords** to
mirror.

It is the natural front half of the later **Tailoring** epic (CV/cover-letter
drafting), but it stops at *analysis* — it generates no documents.

> **Hard boundary — narrative only, no number.** This review **never emits a score,
> star rating, or percentage**, and it **never reads, writes, or influences** the
> Epic 5 deterministic score. The only rating on screen remains Epic 5's stars. This
> keeps the canonical number deterministic, explainable, and offline (Architecture
> decision) while the LLM provides advisory colour the user can take or leave.

> **Attribution / IP note.** The review's *output structure and methodology* —
> requirement→evidence mapping, gap framing with mitigation, role-archetype focus,
> and ATS-keyword extraction — draw conceptual inspiration from the MIT-licensed
> **career-ops** skill (© 2026 Santiago Fernández de Valderrama), specifically its
> `oferta` "Match with CV" block and archetype detection. We re-express those ideas
> as our own structured prompt + schema, in our own words — no prompts, rubric text,
> or code are copied. (career-ops' review emits a 1–5 number; we deliberately do not.)

---

## 2. User Story

As a job seeker deciding whether and how to apply,
I want an AI read of a specific job description against my CV — what matches, what's missing, what to emphasise,
So that I understand my fit in depth and know my next move, while the trustworthy star rating stays a stable, separate number.

---

## 3. Scope

### In Scope
- An **on-demand "AI Match Review"** action on a single job (from the Job-detail modal / board). It requires a saved **OpenRouter key + selected default model** (Epic 2) and is unavailable without them.
- A **structured LLM call** (one, occasionally a follow-up) via `ChatOpenAI` pointed at OpenRouter with **structured output** (Zod schema) — reusing the Epic 3 structured-output pattern. **Not LangGraph** — there is no multi-step crawl to orchestrate.
- **Inputs:** the job's full extracted description (Epic 3 `JobRecord`) + the user's **CV text** and **Profile** (Epic 4).
- Optional **role-archetype detection** (e.g. platform / agentic / PM / solutions-architect / forward-deployed / transformation) to focus which proof points the review emphasises.
- **Structured, narrative output** (no number anywhere):
  - **Requirement mapping** — each key JD requirement paired with the matching CV/profile **evidence**, or flagged "not found".
  - **Gaps** — each gap classified **hard-blocker vs nice-to-have**, with a concrete **mitigation** suggestion.
  - **Strengths** — the candidate's strongest proof points for *this* role.
  - **Keywords to mirror** — ATS phrases lifted from the JD.
  - **Summary** — a short qualitative paragraph (fit in words, **no score**).
- **Honesty rule:** the model must cite only **real** CV/profile content; missing evidence is marked "not found", never invented (mirrors the deterministic-side principle and career-ops' "never invent").
- **Persistence + caching:** store the review per job (`sourceId`) in `star.db` so it isn't regenerated on every open; show provenance ("AI review · {model} · {date}"); mark it **stale** when the CV/Profile changes or the job is re-extracted, with a "regenerate" affordance.
- **One-time "what is sent" disclosure** before the JD + CV text are first sent to the model (reuse the Epic 4 disclosure pattern); the review is the second sanctioned use of the OpenRouter egress (after extraction).
- **UI:** an "AI Match Review" section/tab in the Job-detail modal — a **Generate** control when none is cached, then the structured narrative; clearly badged **AI / advisory**; loading / error states by code (NO_API_KEY, model/network error, model-not-capable).
- **Cost control:** on-demand per job only (no automatic whole-board review for MVP); cached; a single structured call by default.

### Out of Scope (deferred / boundaries)
- **Any number, score, star, or percentage from the LLM** — permanent boundary; the deterministic stars (Epic 5) are the only rating.
- **Reading or altering the Epic 5 deterministic score** in any way.
- **CV / cover-letter drafting, rewrites, STAR stories, interview prep** — the Tailoring / Interview epics (this epic is analysis, not generation).
- **Automatic / batch review of the whole board** — on-demand per job for MVP; bulk is a later option.
- **Web / market research** (company, comp, posting legitimacy) — no new egress; the review uses only the model on local JD + CV text.
- **LangGraph / agentic multi-step orchestration** — a single structured call, by design.

---

## 4. Functional Requirements

1. FR-001 — From the Job-detail view the user can request an **AI Match Review** for a job; it requires a saved OpenRouter key + default model and is disabled/explained when either is missing.
2. FR-002 — The review is produced by a **structured** LLM call against OpenRouter (Epic 2 key/model) over the job's description + the CV text + Profile, and returns: requirement→evidence mapping, classified gaps + mitigation, strengths, keywords, and a narrative summary — **and no numeric rating**.
3. FR-003 — Evidence is drawn only from real CV/profile content; absent evidence is marked "not found", never fabricated.
4. FR-004 — The review is **cached** per `sourceId` (with model + timestamp), **survives restart**, is marked **stale** when the CV/Profile changes or the job re-extracts, and can be **regenerated** on demand.
5. FR-005 — Before the first send, the user sees a **disclosure** of what is sent (JD + CV text) and to which provider; the review is unavailable until a key is present.
6. FR-006 — The review is surfaced in the **Job-detail modal**, clearly labelled **AI / advisory**, alongside (and visually distinct from) the Epic 5 stars, with loading and per-code error states.
7. FR-007 — The review **never** produces or modifies a score; the deterministic star rating is unaffected by whether a review exists.
8. FR-008 — JD text is treated as **untrusted input**: the review extracts/structures it but does not follow instructions embedded in it (no exfiltration, no behaviour change).

---

## 5. Non-Functional Requirements

- NFR-001 (Separation of concerns) — The review path never reads or writes the deterministic score store; exactly one rating (the stars) appears in the UI; the AI narrative carries no number.
- NFR-002 (Security / egress) — JD + CV text go only to OpenRouter via Epic 2's existing, sanctioned egress; a one-time disclosure precedes the first send; this epic opens **no new egress**.
- NFR-003 (Prompt-injection resistance) — Job descriptions are scraped, untrusted content; the call uses structured output and treats the JD as data, never as instructions; the review cannot be steered to leak the CV elsewhere or change app behaviour.
- NFR-004 (Resilience) — With no key, a model error, or a non-capable model, the feature degrades with a clear message; the deterministic score and the rest of the app are unaffected (the review is purely additive).
- NFR-005 (Non-determinism is contained) — LLM output is not reproducible, so it is **advisory, cached, and clearly dated** — never used anywhere stability is required (that's the deterministic score's job).
- NFR-006 (Cross-platform) — Review generation, caching, and display work on macOS, Windows, and Linux from one codebase.

---

## 6. UI/UX Notes

- **Job-detail modal:** add an **"AI Match Review"** section beneath / beside the deterministic breakdown. Empty state = a **Generate review** button (with the disclosure on first use). Generated state = the structured narrative:
  - a one-line **fit summary** (words only),
  - **requirement → evidence** list (met / not found),
  - **gaps** (blocker vs nice-to-have, each with a mitigation),
  - **strengths**, and **keywords to mirror**.
- **Badging:** an unmistakable **AI** tag + "advisory" + "AI review · {model} · {date}"; the deterministic stars stay clearly the authoritative rating. Never render an AI star/number.
- **Stale state:** when the CV/Profile changed since generation, show "may be out of date — regenerate".
- **States:** loading spinner during generation; specific messages for no-key / model error / rate-limited; "regenerate" always available.
- Studio visual system unchanged; reuse existing card / dialog / pill patterns.

---

## 7. Data Model Impact

```ts
type GapSeverity = 'blocker' | 'nice_to_have';

interface ReviewRequirement { requirement: string; evidence: string | null; met: boolean; }
interface ReviewGap { text: string; severity: GapSeverity; mitigation: string; }

interface MatchReview {
  sourceId: string;        // FK to the jobs board row (Epic 3)
  archetype?: string;      // optional role focus
  requirements: ReviewRequirement[];
  gaps: ReviewGap[];
  strengths: string[];
  keywords: string[];
  summary: string;         // narrative only — NO score field anywhere
  modelSlug: string;       // which OpenRouter model produced it (provenance)
  generatedAt: number;
  stale: boolean;
}
```

- New `match_reviews` table in the existing `star.db`, keyed by `sourceId` (narrative blob; **no score column** by construction).
- Renderer-side `MatchReview` types mirror the main contract.
- Note: this is **separate** from Epic 5's `match_scores` table — different store, different lifecycle, never joined into a single rating.

---

## 8. Integration Impact

- **New main-process module** `src-electron/matchReview.ts`: builds `ChatOpenAI` (OpenRouter, Epic 2 key + default model), defines the review Zod schema, runs the structured call over the JD + CV + Profile, persists to `match_reviews`, and exposes `review:generate` / `review:get`. Reuses the structured-output approach and the "model not function-calling capable" guard from Epic 3.
- **`electron-main.ts`:** register the review IPC; read the key (Epic 2 store) and default model; read CV text + Profile (Epic 4); read JD text (Epic 3 jobs).
- **Preload + types:** a `window.starReview` bridge (`generate` / `get`, tagged-union result with stable error codes) and `MatchReview` `Window` types.
- **Renderer:** `app-store.ts` holds reviews keyed by `sourceId` + a generate action with progress/error; the **Job-detail modal** renders the AI Review section; reuse the Epic 4 disclosure.
- **Depends on the model** (unlike Epic 5): this is an LLM feature — it requires Epic 2 and degrades gracefully without it.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] From a job's detail view, the user can generate an AI Match Review when a key + default model are configured (and sees a clear, actionable message when they're not).
- [ ] The review returns requirement→evidence mapping, classified gaps + mitigation, strengths, keywords, and a narrative summary — **with no number/score/star anywhere in it**.
- [ ] Evidence cites only real CV/profile content; missing items are "not found", not invented.
- [ ] The review is cached per job, survives restart, marks stale on CV/Profile change or re-extract, and can be regenerated.
- [ ] A one-time disclosure precedes the first send; the feature is unavailable without a key.
- [ ] The review appears in the Job-detail modal, badged AI/advisory and visually distinct from the deterministic stars; loading + per-code error states work.
- [ ] The deterministic Epic 5 score is provably unchanged whether or not a review exists (no read/write of the score store).
- [ ] A malicious/instruction-laden JD does not change behaviour or exfiltrate the CV (handled as untrusted data).
- [ ] The feature opens no new egress beyond OpenRouter.

---

## 10. Risks & Unknowns

- **Prompt injection from scraped JDs:** the JD is untrusted. Mitigation: structured output, system framing that treats the JD as data to analyse (not instructions to obey), and no tool/eval surface in this call.
- **Hallucinated evidence:** the model may "find" CV lines that aren't there. Mitigation: instruct strict grounding, mark "not found" liberally, and (optionally) post-validate cited evidence substrings against the CV text.
- **Two-ratings confusion:** users could read the narrative as a score. Mitigation: hard rule (no number emitted), explicit "advisory" badging, and the stars kept visually dominant.
- **Cost / latency:** on-demand + cached keeps it cheap; a whole-board "review all" is deliberately out of scope for MVP.
- **Model capability:** structured output needs a function-calling-capable model. Mitigation: reuse Epic 2/3's capability guard + clear message.
- **Non-reproducibility:** same inputs can yield different reviews. Accepted — it's advisory, dated, and cached; it never feeds anything that must be stable.

---

## 11. Dependencies

- **Epic 2 (OpenRouter Key & Model)** — required: the review is an LLM feature built on the saved key + default model.
- **Epic 3 (Agentic Job Extraction)** — provides the job description text and `sourceId`.
- **Epic 4 (Add CV to Profile)** — provides the CV text + Profile and the one-time disclosure pattern.
- **Complements Epic 5 (Job Match Scoring)** — shown alongside the stars, but reads/writes none of its state (strict separation).

---

## 12. References

- source_skill (conceptual inspiration only; MIT, © 2026 Santiago Fernández de Valderrama): C:\ai\skills_lab\career-ops — `modes/oferta.md` "Match with CV" (requirement→evidence + gaps/mitigation), `modes/_shared.md` archetype detection + "never invent" rule, ATS-keyword extraction. We adapt the *structure*, copy none of its text/prompts/code, and emit no number.
- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md (LLM-for-tailoring; scores stay deterministic)
- data_model: docs/Data Model/Schema.ddl
- related_epic: docs/Epics/epic_05_JOB_MATCH_SCORING.md (the deterministic score this sits beside)

---

## 13. Implementation Notes (For Planning Agent)

Suggested ticket breakdown (backend-first; serialise the shared scaffolding files
`electron-main.ts` / `electron-preload.ts` / `env.d.ts`, then `app-store.ts` /
the Job-detail modal):

1. (Backend) `matchReview.ts` — the review Zod schema + structured-output call builder (ChatOpenAI → OpenRouter from Epic 2 key/model), grounding/anti-injection framing, model-capability handling. Injectable LLM so it's testable without the network.
2. (Backend) `match_reviews` persistence in `star.db` (get/upsert/markStale, provenance) mirroring `sites.ts`; **no score column**.
3. (Backend) Review IPC + preload bridge + types: `review:generate|get` (tagged-union result with stable error codes), read JD (Epic 3) + CV/Profile (Epic 4); mark-stale hook on CV/Profile change + re-extract.
4. (Frontend) `app-store.ts` reviews state + generate action (loading/error) + stale selectors + types; reuse the Epic 4 "what is sent" disclosure.
5. (Frontend) Job-detail modal **AI Match Review** section — generate control, structured narrative render, AI/advisory badging distinct from the deterministic stars, stale/regenerate, per-code errors.
6. (Tests) Schema/grounding tests with a stubbed structured-output LLM (no number emitted; "not found" preserved; injection-laden JD handled as data); caching + stale lifecycle tests.
7. (Docs) Help + architecture/data-model docs: what the AI review is, that it's advisory and separate from the deterministic score, and the egress/disclosure.

Expected complexity: Medium — a single structured call is simple; the care is in grounding (no invented evidence), prompt-injection safety on untrusted JDs, the strict "no number / never touch the score" separation, and graceful no-key/model handling.
Estimated total effort: ~7 tickets (1–4 hours each).

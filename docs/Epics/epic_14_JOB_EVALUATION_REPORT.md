# Epic 14: Job Evaluation Report ("Eval")

Status: TICKETS
Owner: human
Created: 2026-06-20
Last Updated: 2026-06-20

---

## 1. Purpose

An **"Eval"** button on each **Starred** job that generates a comprehensive **evaluation report** —
modeled on career-ops' A–H evaluation — consolidating the analyses the app already produces **and** adding
**web-researched** context, so the user gets a single "should I apply, and how" briefing per job.

It **composes** where it can (the headline rating stays the **deterministic Epic 5 stars**; the match
analysis reuses the **Epic 6 AI Match Review**) and **adds**: a **Role Summary** (with researched employer
context), a **Level & Strategy** read, a **Comp & Demand** block backed by **web market research with cited
sources**, a **Customization** launch into Tailoring, an **Interview Plan** launch, and a **Posting
Legitimacy** assessment with **best-effort live verification**.

> **Egress posture (changed).** This epic introduces the app's first **opt-in web research** egress —
> company/market/comp lookups + best-effort posting verification — because the user has relaxed the
> "OpenRouter-only egress" restriction for this feature. Web research runs **behind a distinct disclosure**
> and a **setting to keep the app local-only** (research off → those blocks degrade to JD-stated-only).
> Research is **driven through the embedded browser** (Epic 1) / hidden crawler (Epic 3) — searches + page
> fetches in the partitioned session, no extra API key. This epic **owns** the relaxation (kept scoped here
> for now — **no PRD change**), but it's built as a **shared web-research capability** so Epic 6/7's deferred
> company research can reuse it later (see §10).

> **No anti-bot bypass (unchanged).** Live posting verification is **best-effort**: try the embedded
> browser across the posting's surfaces; if a board serves a CAPTCHA / anti-bot challenge (as Indeed did to
> career-ops), **do not bypass it** — fall back to other surfaces (official careers / ATS apply page) and
> report **"verification: uncertain"** with the reason. We never defeat anti-bot measures.

> **No competing number (unchanged).** Like Epic 6, the Eval **never emits an LLM score** — it shows the
> deterministic Epic 5 stars/% as the one rating. (career-ops emits a 1–5 LLM score; we deliberately do not.)

> **Attribution.** The A–H report structure draws conceptual inspiration from the **MIT career-ops**
> `oferta` evaluation (© 2026 Santiago Fernández de Valderrama) — Role Summary / Match / Level & Strategy /
> Comp & Demand / Customization / Interview Plan / Legitimacy / Draft Answers. Re-expressed as our own; no
> prompts/code/text copied (same pattern as Epic 6).

---

## 2. User Story

As a job seeker deciding whether and how to apply to a starred job,
I want one "Eval" action that gives me a full briefing — fit, my level/positioning, the real pay & demand picture, how legit the posting is, and my next moves —
So that I can make the call and act, without stitching together screens or doing the research by hand.

---

## 3. Scope

### In Scope

- An **"Eval"** button on each **Starred** job tile that **generates/opens** the evaluation report;
  requires an OpenRouter key + default model (Epic 2) and a scored job.
- A consolidated report with a header (the job; the **Epic 5 stars/%** as the rating; detected archetype;
  legitimacy verdict; a **verification line**; provenance "AI report · {model} · {date}") and blocks:
  - **A) Role Summary** — archetype, domain, function, seniority, work-mode, **stated** comp, **researched
    employer context** (who they are, funding/acquisition, named clients), TL;DR.
  - **B) Match with CV** — **reuse the Epic 6 AI Match Review** (requirement→evidence, classified gaps +
    mitigation, strengths, keywords).
  - **C) Level & Strategy** — JD level vs the user's profile level; how to position **honestly**; down-level
    considerations + questions to ask.
  - **D) Comp & Demand** — the JD's **stated** band vs the user's expectation (Epic 4), **plus web market
    research** (salary benchmarks, company comp reputation, demand trend) **with cited source links**, and a
    negotiation line. *(Web research; opt-in.)*
  - **E) Customization plan** — top suggested CV changes + a **"Tailor for this job"** launch (Epic 7/9).
  - **F) Interview plan** — a **STAR launch** into the Interview-Prep epic (placeholder/CTA until it ships).
  - **G) Posting Legitimacy** — a **signal table** (employer identity, apply-path surfaces, salary
    transparency, tech specificity, freshness) + a confidence verdict, combining a **text heuristic**, **web
    signals** (does the company/posting exist on official surfaces), and a **best-effort live-verification**
    line (no anti-bot bypass; report uncertainty on challenge). *(Web research; opt-in.)*
  - **H) Draft Application Answers** *(optional)* — gated (e.g. only for strong matches) and a **launch into
    cover-letter/apply** rather than inlined; can start as a stub.
- A **web-research disclosure** (first use) + a **setting** to disable web research (local-only mode), under
  which D/G degrade to JD-stated-only and verification is skipped.
- **Persist per job** (`sourceId`), cached with provenance + sources, **stale** on CV/Profile change or
  re-extract, **regenerate**; export the report (Markdown) — composes with Epic 12.

### Out of Scope (deferred / boundaries)

- **Bypassing logins / CAPTCHAs / anti-bot** for verification — best-effort only; report uncertainty.
- **Any LLM-emitted numeric score** — the Epic 5 stars are the rating.
- **Re-implementing the match analysis** (B reuses Epic 6), **tailoring** (E launches Epic 7/9), or
  **interview prep** (F launches the future epic).
- **Bulk "evaluate all"** — on-demand per job.
- **Auto-apply / submission** — H only drafts/launches; the human submits.

---

## 4. Functional Requirements

1. FR-001 — An **"Eval"** button on Starred tiles generates/opens the report; requires a key + default model
   + a scored job; disabled/explained otherwise.
2. FR-002 — The header shows the **deterministic Epic 5 stars/%** as the rating (no LLM number), the
   archetype, the legitimacy verdict, a verification line, and provenance.
3. FR-003 — **Block B reuses the cached Epic 6 review** (generating it if absent).
4. FR-004 — Blocks **A, C, D, G** are produced via structured LLM calls over JD + CV/Profile (reusing the
   Epic 6 grounding + injection-safe + capability-guard pattern); evidence is grounded, nothing invented.
5. FR-005 — **Block D** combines the JD's **stated** comp vs the user's expectation **with web market
   research** (salary benchmarks, demand, employer comp reputation), citing **source links**; with web
   research **off**, it falls back to stated-only and says so.
6. FR-006 — **Block G** produces a legitimacy signal table + confidence from a text heuristic + **web
   signals** + a **best-effort live-verification** attempt; on an anti-bot/CAPTCHA challenge it **does not
   bypass** — it records "verification: uncertain" with the reason and falls back to other surfaces.
7. FR-007 — A **web-research disclosure** precedes the first web call; a **local-only setting** disables web
   research (D/G degrade gracefully); OpenRouter + the configured research path are the only egress.
8. FR-008 — **Block E** offers top CV-change suggestions + a **Tailor** launch; **Block F** offers an
   **Interview-Prep** launch/placeholder; **Block H** (optional, gated) launches cover-letter/apply.
9. FR-009 — The report is **cached per `sourceId`** with provenance + sources, **marked stale** on
   CV/Profile change or re-extract, and **regeneratable**.

---

## 5. Non-Functional Requirements

- NFR-001 (Grounding) — Every block cites real JD/CV/Profile content or a **cited web source**; nothing
  fabricated; D/G label which findings came from the web.
- NFR-002 (Rating integrity) — Reads, never writes, the Epic 5 score; the stars stay the sole rating; no LLM
  number.
- NFR-003 (Egress & consent) — Web research is **opt-in** behind a disclosure + a local-only setting; the
  app states what is sent and to which services; no egress beyond OpenRouter + the configured research path.
- NFR-004 (No anti-bot bypass) — Verification never defeats CAPTCHA/anti-bot; it falls back and reports
  uncertainty.
- NFR-005 (Prompt-injection resistance) — JD + fetched web content are untrusted; structured output +
  data-not-instructions framing; fetched pages can't steer behaviour.
- NFR-006 (Non-determinism contained) — Narrative + research are advisory, dated, cached with sources.
- NFR-007 (Cross-platform) — Generation, research, caching, display, export work on macOS/Windows/Linux.

---

## 6. UI/UX Notes

- **Eval button** on each Starred tile (alongside Detail/Generate); disabled with a reason when no
  key/model/score.
- **Report view** (modal or route): header (stars/% + archetype + **legitimacy chip** + verification line +
  provenance), then collapsible **A–H**; **B** renders the Epic 6 review; **D** shows the comp table + a
  **sources list**; **G** shows the signal table + confidence; **E/F/H** are CTAs; a **stale** banner +
  **Regenerate**; an **Export** (Markdown).
- **Web-research consent:** a first-use disclosure ("Eval can look up company, salary, and posting details on
  the web — enable?") + a Settings toggle; clear "researching…" progress; sources always shown.
- AI/advisory badging stays distinct from the deterministic stars.

---

## 7. Data Model Impact

- New `eval_reports` table in `star.db`, keyed by `sourceId` (the A/C/D/G/H narrative + **researched
  sources** + legitimacy verdict + verification note + provenance + stale flag; **no score column**). Block B
  references the Epic 6 `match_reviews` store.

```ts
interface EvalSource { title: string; url: string; }            // cited web sources
interface EvalReport {
  sourceId: string; archetype?: string;
  roleSummary: RoleSummary;       // A (+ researched employer context)
  levelStrategy: LevelStrategy;   // C
  compDemand: CompDemand;         // D (stated + researched, with sources)
  legitimacy: LegitimacyRead;     // G (signals, verdict, verification note)
  sources: EvalSource[];
  modelSlug: string; generatedAt: number; stale: boolean;
  // B referenced from match_reviews; E/F/H are launch CTAs
}
```

---

## 8. Integration Impact

- **New main-process module** `evalReport.ts` — orchestrates: read Epic 5 score + Epic 6 review (generate if
  missing); structured LLM calls for A/C/D/G over JD (Epic 3) + CV/Profile (Epic 4); a **web-research step**
  (D/G) via a new shared research helper; best-effort verification via the embedded browser (Epic 1) / hidden
  crawler (Epic 3) with **no anti-bot bypass**; persist to `eval_reports`. Exposes `eval:generate` /
  `eval:get`.
- **New shared `webResearch.ts` capability** — a single, disclosed egress path that runs searches + fetches
  pages **via the embedded browser (Epic 1) / hidden crawler (Epic 3)** in the partitioned session (no extra
  API key), reusing the EXTR-014/018 readiness + no-anti-bot-bypass behaviour; reusable by future epics
  (salary negotiation, company research). Gated by the local-only setting.
- **IPC + preload + types + settings:** `window.starEval` (tagged-union, error codes); a `webResearchEnabled`
  setting + disclosure.
- **Renderer:** `app-store` eval state + generate; the **Starred** Eval button + the A–H report view (B reuses
  the Epic 6 component; E/F/H route out; sources list); optional Export (Epic 12).
- **Reuse:** Epic 5 score (rating), Epic 6 review (B) + pattern, Epic 4 profile (D) + disclosure, Epic 7/9 (E),
  Epic 1/3 (verification).

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] An "Eval" button on a Starred job generates a report whose header shows the **Epic 5 stars/%** (no LLM
      number) + archetype + legitimacy verdict + verification line + provenance.
- [ ] The report shows A (Role Summary + researched employer context), B (the reused Epic 6 review), C (Level
      & Strategy), D (stated comp + **web market research with cited sources**), E (CV changes + Tailor
      launch), F (Interview-Prep launch), G (legitimacy signals + **best-effort verification**), and H
      (optional gated draft-answers launch).
- [ ] With web research **enabled**, D/G include cited web findings; with it **disabled** (local-only), they
      degrade to JD-stated-only and say so; a disclosure precedes the first web call.
- [ ] Verification never bypasses anti-bot — on a CAPTCHA challenge it reports "uncertain" and falls back to
      other surfaces.
- [ ] Every block is grounded/cited; the Epic 5 score is provably unchanged; an injection-laden JD or fetched
      page can't change behaviour or exfiltrate.
- [ ] The report caches per job, marks stale on CV/Profile change or re-extract, regenerates, and exports
      (Markdown).

---

## 10. Risks & Unknowns

- **New egress is a product-posture shift:** introduces the app's first web research. Mitigation: opt-in +
  disclosure + a local-only setting; **kept scoped to this epic for now (no PRD change)**; built as a **shared
  `webResearch` capability** so Epic 6/7's deferred company research and a future salary-negotiation epic
  reuse one disclosed path.
- **Research via the embedded browser (chosen):** reuse the Epic 1 browser / Epic 3 crawler to run searches +
  fetch pages in the partitioned session — no extra API key, but subject to the same readiness/anti-bot
  realities as extraction (EXTR-014/018); fall back + report uncertainty on a challenge.
- **Anti-bot on verification:** boards (Indeed) challenge automated checks; never bypass — fall back + report
  uncertainty (exactly as the reference does).
- **Web content is untrusted:** fetched pages are injection vectors; treat as data, structured output only.
- **Research cost/latency/accuracy:** cache aggressively per job; cite sources; mark stale; let the user
  regenerate.
- **Overlap:** keep B = Epic 6 (reuse), E/F/H = launches; the new surface is A/C/D/G + research + the report
  shell.
- **Two-ratings confusion:** show the deterministic stars only; advisory badging on the narrative.

---

## 11. Dependencies

- **Epic 2 (Key & Model)** — the LLM calls.
- **Epic 3 (Extraction)** — JD text + sourceId; the crawler used for best-effort verification.
- **Epic 4 (CV/Profile)** — CV + salary expectation (D) + disclosure pattern.
- **Epic 5 (Scoring)** — the deterministic stars shown as the rating (read-only).
- **Epic 6 (AI Match Review)** — Block B reused; structured-output/grounding pattern reused.
- **Epic 7/9 (Tailoring)** — Block E launch target.
- **Epic 1 (Browser)** — best-effort live verification.
- **Future Interview-Prep epic** — Block F launch target (placeholder until it ships).

---

## 12. References

- source_skill (conceptual inspiration; MIT © 2026 Santiago Fernández de Valderrama;
  C:\ai\skills_lab\career-ops) — `modes/oferta.md` A–H evaluation + `reports/006-tomoro-2026-06-20.md` (the
  concrete A–H report: header with score/legitimacy/verification, Role Summary, Match, Level & Strategy, Comp
  & Demand **with WebSearch sources**, Customization, Interview STAR+R, Legitimacy **signal table +
  best-effort Playwright verification that fell back on a Cloudflare challenge**, Draft Answers, Keywords);
  `modes/_shared.md` (archetype + legitimacy framing). We adapt the **structure**, copy no prompts/text/code,
  **emit no number**, and **do not bypass anti-bot** (best-effort verification only).
- prd: docs/Product Requirements Document/PRD.md (§non-goals — web-research relaxation kept scoped to this
  epic for now, not a PRD change; the stars stay the deterministic rating; no anti-bot bypass remains)
- related_epics: docs/Epics/epic_06_AI_MATCH_REVIEW.md (Block B; deferred company research now enabled here),
  docs/Epics/epic_05_JOB_MATCH_SCORING.md (rating), docs/Epics/epic_07_TAILORING.md (Block E + its deferred
  company research), docs/Epics/epic_13_CV_ENRICHMENT.md (complements)

---

## 13. Implementation Notes (For Planning Agent)

Backend-first; serialise scaffolding (`electron-main` / `electron-preload` / `env.d.ts`).

1. (Backend) **Shared `webResearch.ts` capability** — drive searches + page fetches via the **embedded
   browser (Epic 1) / hidden crawler (Epic 3)** in the partitioned session, behind a **disclosure +
   local-only setting**; reuse the EXTR-014/018 readiness + no-anti-bot-bypass behaviour; treat fetched
   content as untrusted. Gate the research-dependent blocks on this.
2. (Backend) `evalReport.ts` — structured LLM calls for **A/C/D/G** over JD + CV/Profile (reuse Epic 6
   grounding/injection/capability guard); call `webResearch` for D/G; **best-effort verification** via the
   embedded browser/crawler (no anti-bot bypass → "uncertain" on challenge). Injectable LLM + stubbed research
   for tests.
3. (Backend) `eval_reports` persistence (get/upsert/markStale, provenance + sources) mirroring `match_reviews`;
   **no score column**; reference the Epic 6 review for B and read the Epic 5 score for the rating.
4. (Backend) IPC + preload + types + the `webResearchEnabled` setting + disclosure.
5. (Frontend) `app-store` eval state + generate; the **Starred** Eval button.
6. (Frontend) The **report view** — header (Epic 5 stars/% + archetype + legitimacy + verification +
   provenance), collapsible A–H, B = Epic 6 review component, D sources list, G signal table, E/F/H CTAs,
   stale/regenerate, Export (Epic 12).
7. (Tests) Grounding/injection (incl. malicious fetched page); web-on vs local-only D/G; verification reports
   "uncertain" on a simulated anti-bot challenge (no bypass); Epic 5 score unchanged; caching/stale.
8. (Docs) Document (within this epic + Help) the opt-in web-research egress, the shared `webResearch`
   capability, and the anti-bot-no-bypass rule. **No PRD change for now** — the relaxation stays scoped here.

Expected complexity: Medium–High — heavy reuse (Epic 5 score, Epic 6 review, Epic 7/9 launch), but the new
care is the **shared web-research capability + disclosure/consent**, best-effort verification without anti-bot
bypass, untrusted-web-content safety, and the strict "stars-not-LLM-number" rating.
Estimated total effort: ~7–8 tickets (1–4 hours each).

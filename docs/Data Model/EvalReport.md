# Data Model — Job Evaluation Report (Epic 14)

This document records the data shapes the Job Evaluation Report subsystem
(Epic 14) produces and consumes. It is the contract between the
orchestrator in main (`evalReport.ts`), the shared web-research capability
(`webResearch.ts`), the `eval_reports` SQLite store (`evalReports.ts`),
the renderer (`EvalReportPage.vue`), and the existing Epic 5 / Epic 6
surfaces the report reuses.

The report emits a fixed **eight-block (A–H) narrative** about a single
posting — never a number. The shapes below are closed: there is no
escape hatch through which the LLM could surface a score, star,
percentage, or rating.

For the conceptual lineage and the MIT attribution that governs reuse,
see `NOTICE.md` §1 (career-ops). The eight-block structure is
**conceptually inspired** by the career-ops "Match with CV / Compensation
/ Legitimacy" idea; **no career-ops prompt, rubric text, template text,
or source code is incorporated** into Star Job Search, and **no number is
emitted** from the Eval report by construction.

---

## 1. The eight blocks (A–H)

| Block | Title | Producer | Cached in |
| --- | --- | --- | --- |
| **Block A** | Role Summary & Employer Context | LLM narrative (optionally enriched by web research) | `eval_reports.block_a` |
| **Block B** | Match with CV (AI Match Review) | Epic 6 (`matchReview.ts`) — read or generated on demand | `match_reviews` (NOT `eval_reports`) |
| **Block C** | Level & Strategy | LLM narrative | `eval_reports.block_c` |
| **Block D** | Compensation | LLM narrative — JD-stated vs. user expectation; market-band sentence with cited sources when web research is on | `eval_reports.block_d` + `eval_reports.sources` |
| **Block E** | Tailored CV (CTA) | Static CTA into Epic 7 Tailor view | — |
| **Block F** | Interview Prep (CTA) | Static CTA into Epic 7 Tailor view (`focus=interview-prep`) | — |
| **Block G** | Legitimacy Signals | LLM narrative + `legitimacyVerdict ∈ {legitimate, suspicious, unknown}` + `verificationNote` | `eval_reports.block_g` + `eval_reports.legitimacy_verdict` + `eval_reports.verification_note` |
| **Block H** | Cover Letter & Apply | CTA into Epic 7 Tailor view (`focus=cover-letter`) + optional narrative | `eval_reports.block_h` |

**Why Block B lives elsewhere.** Block B is the Epic 6 AI Match Review,
unchanged. The orchestrator reads it from `match_reviews` and forwards
it; if absent it delegates back to Epic 6 to generate one, which writes
it to `match_reviews`. Keeping Block B in its own table preserves Epic
6's hard boundary (it is the only writer of `match_reviews`) and keeps
the AI Match Review usable on its own from the Job-detail dialog.

---

## 2. `eval_reports` SQLite table

The persisted shape lives in `star.db` (better-sqlite3, main process).
The table holds the multi-block evaluation narrative for a job, with
provenance and cited sources. **There is no score / number / rating /
percentage column** — the data model cannot accidentally surface a
number even if a future LLM call tried to emit one. The authoritative
rating remains the Epic 5 deterministic stars in `match_scores`.

```
CREATE TABLE eval_reports (
    source_id           TEXT PRIMARY KEY REFERENCES jobs(source_id) ON DELETE CASCADE,
    block_a             TEXT NOT NULL,
    block_c             TEXT NOT NULL,
    block_d             TEXT NOT NULL,
    block_g             TEXT NOT NULL,
    block_h             TEXT NOT NULL,
    sources             TEXT NOT NULL,           -- JSON: EvalSource[]
    legitimacy_verdict  TEXT NOT NULL,           -- 'legitimate' | 'suspicious' | 'unknown'
    verification_note   TEXT NOT NULL,
    model_slug          TEXT NOT NULL,           -- provenance: which OpenRouter model
    generated_at        INTEGER NOT NULL,        -- epoch ms
    stale               INTEGER NOT NULL         -- 0 | 1
);
```

The `EvalReport` TypeScript shape mirrors this layout:

```
interface EvalReport {
  sourceId: string;
  blockA: string;
  blockC: string;
  blockD: string;
  blockG: string;
  blockH: string;
  sources: EvalSource[];                 // { url, title? }
  legitimacyVerdict: 'legitimate' | 'suspicious' | 'unknown';
  verificationNote: string;
  modelSlug: string;
  generatedAt: number;
  stale: boolean;
}
```

**Stale hooks.** `markAllEvalReportsStale()` flips every cached row to
`stale = 1` when scoring-relevant Profile fields change; `markStale(id)`
flips a single row when a posting is re-extracted. Stale rows are kept,
not deleted — the renderer surfaces "may be out of date" and offers
Regenerate, exactly mirroring Epic 6 behaviour.

---

## 3. Deterministic stars carry the rating

The rating displayed in the Eval report header is the **Epic 5
deterministic 1–5 stars + 0–100 % match**. The orchestrator reads it
from `match_scores` and forwards it to the renderer; it never produces
or overrides it. The rule is enforced at three layers:

1. **Schema-level.** The Zod schemas for Blocks A/C/D/G have no numeric
   field. `BlockNarrativeSchema = { narrative: string }`;
   `BlockGSchema = { narrative, legitimacyVerdict, verificationNote }`.
   A model that tried to emit `{ score: 0.85 }` would fail validation.
2. **Prompt-level.** Every block's system framing opens with the hard
   rule: *"NEVER emit a number, score, star rating, percentage, or any
   quantitative fit signal. Words only."* Block D specifically forbids
   numeric comparisons: gaps are described qualitatively ("below
   expectation", "in line"), not numerically.
3. **Storage-level.** `eval_reports` has no score column.
   `evalReports.ts` never writes a number to `match_scores` and never
   reads one from the LLM. The only path that writes stars / % is the
   pure Epic 5 scorer.

This keeps the property that scoring is reproducible and survives
OpenRouter being down: the rating comes from a pure function over
`(listing, profile, weights)`, never from the LLM.

---

## 4. Shared `webResearch` capability

A single shared module — `app/src-electron/webResearch.ts` — exposes the
web-research surface used by Blocks A/D/G. The public contract is two
functions:

```
search(query: string): Promise<WebResearchSearchResult>
fetchUrl(url: string): Promise<WebResearchFetchResult>
```

Both return a discriminated `{ ok }` union. Callers receive **`text`
(innerText) + `sources` (the URLs visited / extracted from)** — never
raw page HTML — so a downstream LLM can cite them. Extracted text is
run through the existing prompt-injection sanitizer
(`promptSanitizer.ts`) because fetched web content is UNTRUSTED data,
not instructions.

**One module, one egress surface.** `webResearch` drives the same
browser surface that already powers Epic 1 (Discover) and Epic 3 (the
hidden crawler), in the same partitioned `persist:job-browser` session.
**There is no external HTTP API and no extra API key**; cookies,
storage, and partitioned isolation live in one place. The two-egress
boundary documented in `docs/Architecture/Architecture.md` §3 is
unchanged.

---

## 5. Opt-in, default-OFF, local-only setting + one-time disclosure

Web research is **opt-in and off by default**. Two gates run BEFORE any
browser navigation:

1. **`webResearchEnabled` (default OFF, local-only).** The setting
   lives in `settings` in `star.db` and never leaves the device — no
   telemetry, no sync, no backup-as-key. When OFF, every call returns
   `{ ok: false, code: 'research_disabled' }` and no browser navigation
   happens.
2. **One-time "what is sent" disclosure.** The first call after the
   setting is turned ON returns
   `{ ok: false, code: 'disclosure_required' }`. The renderer surfaces
   the disclosure copy — what is sent (the search query and the URLs
   visited), to which destinations (the search engine and employer
   pages reached through the embedded browser) — and only after the
   user acknowledges it does `acknowledgeDisclosure()` flip the gate
   for future calls.

**Degraded behaviour.** With research OFF or unacknowledged, the
orchestrator still produces a report: Blocks D & G degrade to
JD-stated-only and say so verbatim in their narrative. The report is
never silently incomplete.

---

## 6. Anti-bot-no-bypass rule

Logins, paywalls, CAPTCHAs, and anti-bot interstitials are **detected
and stopped, never bypassed**. This is the same permanent product
non-goal that governs Epic 1 scanning (PRD FR-SCAN-010) and Epic 3
extraction; Epic 14 inherits it unchanged.

When `webResearch` matches a challenge marker on page text or HTML the
call resolves with:

```
{ ok: true, uncertain: true, reason: '…' }
```

— and an empty result set. The caller MUST treat `uncertain` as a
fall-through, not an error:

- Block G surfaces `legitimacyVerdict: 'unknown'` and carries the
  `uncertain` reason into `verificationNote`, so the persisted report
  is honest about what could not be verified.
- Block D drops the market-band sentence and falls back to JD-stated
  comp only, noting that market verification was uncertain.
- No retry-with-different-headers, no header spoofing, no captcha
  solver, no proxy rotation. Detect and stop is the only policy.

---

## 7. Egress posture — scoped to this epic, not the PRD

The shared `webResearch` capability reaches search engines and
arbitrary employer pages, which is broader than the PRD §7.3 / NFR-S5
two-egress boundary ("user-configured job sites" + "OpenRouter"). The
relaxation is **scoped to this epic** and documented here, deliberately
not promoted into the PRD:

- The PRD's two-egress posture remains the product-level posture and
  the contract that future epics inherit.
- The relaxation is opt-in (default OFF), gated by a one-time
  disclosure, local-only, and reuses the existing partitioned browser
  session — it does not introduce a new outbound transport, key, or
  identifier.
- The relaxation is auditable in the same way as the two existing
  paths: every research call flows through the single `webResearch`
  module, which is the only place that calls `search()` / `fetchUrl()`
  against the browser surface.

If Star Job Search ever needed `webResearch` outside the Eval-report
flow, that change would belong in the PRD, not in this document.

---

## 8. Attribution

The A–H structural concept is conceptually inspired by `career-ops`
(MIT-licensed). **No career-ops prompt, rubric text, template text, or
source code is incorporated.** The "emit no number" rule is enforced
independently here (schemas + prompts + data model), not borrowed from
career-ops. The full MIT licence text, the conceptual-scope statement,
and the obligation to upgrade the attribution if any code is ever
ported live in `NOTICE.md` §1 (career-ops).

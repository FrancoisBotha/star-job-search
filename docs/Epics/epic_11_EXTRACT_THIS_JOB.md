# Epic 11: Extract This Job — user-driven single-job capture (best-effort text)

Status: TICKETS
Owner: human
Created: 2026-06-20
Last Updated: 2026-06-20

---

## 1. Purpose

Give the user a **manual fallback to the agentic crawl**: when automated list-enumeration can't
handle a board (heavy virtualized SPAs, login-gated / anti-bot boards like LinkedIn), the user
**opens a single job's detail in the embedded browser and clicks "Extract this job"** — the app reads
the **rendered text** of what they're looking at and an LLM structures that **one** posting onto the
Job Board.

This is the **best-effort text** path (Option A): no learned selectors, no enumeration, no pagination,
no auto-navigation. It captures **only the single job the user is actively viewing**, on demand.

> **Why this is in scope where bulk crawl is not.** Automated scanning of authenticated/gated/anti-bot
> boards is a PRD non-goal (§non-goals; FR-SCAN-010). This feature is **not** automated scanning — it
> is the user manually viewing one job in their own session and explicitly choosing to capture it. No
> enumeration, no crawling, no login/anti-bot bypass — just structuring the one posting on screen. So
> it works on hard/gated boards *because* it's user-driven and single-job.

> **Grounded by the page.** The LLM extracts only what is present in the captured text; it never
> invents a job, company, or field. If the page has no recognisable posting, it says so.

---

## 2. User Story

As a job seeker on a board the auto-scan can't handle,
I want to open a job I care about and click one button to add it to my board,
So that I still get scoring, review, and tailoring for it without fighting the scraper or leaving the app.

---

## 3. Scope

### In Scope

- An **"Extract this job"** action in the Discover browser chrome (complementary to the bulk "AI
  Extract"), available when a board is open.
- Captures the **rendered text** (`innerText`) of the **currently visible** embedded-browser view (the
  foreground tab the user navigated — NOT the hidden crawler), preferring a main/detail content region
  and falling back to the page body, plus the **current URL**.
- A **single structured LLM call** (reuse the Epic 3 `JobSchema` + the Epic-013 salary field) extracts
  **one** job — title, company, location, description, salary, and the posting/apply URL — from that
  text. On a left-list/right-detail layout it targets the **open detail** (the posting with a full
  description), not the list items.
- **Persists** the job to the board (Epic 3 `jobs`) with a derived **sourceId** (from the posting URL
  when present — e.g. the selected-job id in the URL — else a stable hash of hostname+title+company),
  **dedupes** against existing jobs, and triggers the **Epic 5 score-after-extract** hook like the
  bulk path.
- Clear feedback: an extracting state, success ("Added: {title} — {company}"), and a distinct
  "couldn't find a job on this page" when the text has no recognisable posting.
- **Composes with EXTR-018**: when the bulk auto-scan stops on a gated/hard board, the message points
  the user here ("open a job and use Extract this job").

### Out of Scope (deferred / boundaries)

- **Bulk / automated enumeration** of the whole list — that is the Epic 3 agentic crawl; this epic is
  single-job, user-initiated.
- **Screenshot / vision extraction (Option B)** — a later epic; this one is text-only.
- **Auto-detecting or auto-clicking list items / auto-navigation** — the **user** navigates and opens
  the detail; we only structure what is shown.
- **Any login / paywall / anti-bot bypass** — it reads only the already-rendered page the user is
  viewing; one job at a time.

---

## 4. Functional Requirements

1. FR-001 — The Discover browser chrome has an **"Extract this job"** action (distinct from bulk "AI
   Extract"), enabled when a board page is open and a key+model are configured.
2. FR-002 — On click, the app captures the **rendered `innerText`** of the **visible** embedded-browser
   view (prefer a main/detail region; fall back to body) and the **current URL** — reading the
   foreground tab the user is looking at, not a hidden crawler.
3. FR-003 — A **single structured LLM call** (Epic 3 `JobSchema` + salary) extracts **one** job
   (title, company, location, description, salary, posting/apply URL) from the captured text; on
   list+detail layouts it returns the **open detail** posting, not list rows.
4. FR-004 — The captured text is treated as **untrusted** input (prompt-injection safe); the model
   extracts only content present in the text and **never invents** a posting or fields (returns a
   clear "no posting found" when absent).
5. FR-005 — The extracted job is **persisted** to the board with a derived **sourceId** (posting URL
   when present, else a stable hostname+title+company hash), **deduped** against existing jobs, and the
   **Epic 5 score-after-extract** hook runs.
6. FR-006 — The user sees clear states: extracting, success ("Added: {title} — {company}", with the
   job appearing on the board), and "couldn't find a job on this page".
7. FR-007 — The feature requires an OpenRouter key + default model (Epic 2) and degrades with a clear
   message when absent; it opens no new egress beyond the existing OpenRouter path (reuse the Epic 4/6
   "what is sent" disclosure on first use).

---

## 5. Non-Functional Requirements

- NFR-001 (Grounding) — Extract only what's in the captured text; never fabricate a job or field.
- NFR-002 (Security / egress) — Only the captured page text + URL go to OpenRouter via the existing
  sanctioned egress; one-time disclosure precedes the first send; no new egress.
- NFR-003 (Prompt-injection resistance) — Page text is untrusted scraped content; structured output +
  data-not-instructions framing; cannot be steered to change behaviour or exfiltrate.
- NFR-004 (User-initiated, single-job) — No enumeration, crawling, or auto-navigation; the user drives
  the browser and explicitly triggers capture of the one visible job.
- NFR-005 (Determinism of persistence) — sourceId derivation + dedup are deterministic and reproducible;
  re-extracting the same job does not create a duplicate.
- NFR-006 (Cross-platform) — Works on macOS/Windows/Linux from one codebase.

---

## 6. UI/UX Notes

- **Action:** an "Extract this job" control in the Discover chrome, near "AI Extract" (or a small split
  on the AI Extract control). Disabled with a clear reason when no key/model.
- **Flow (list+detail boards):** user clicks a job card → its detail renders on the right → user clicks
  "Extract this job" → toast "Added: {title} — {company}" and the job appears on the Job Board.
- **Single-posting pages:** works directly (no detail-pane step needed).
- **No-posting state:** a clear, non-alarming "Couldn't find a job posting on this page — open a job's
  detail and try again."
- **Discoverability:** EXTR-018's graceful-stop message links here. Reuse the Studio visual system.

---

## 7. Data Model Impact

- **Reuses the Epic 3 `jobs` table** — no new table. Optionally add a provenance field
  `source: 'crawl' | 'manual'` (default 'crawl') so the board/analytics can tell manually-captured jobs
  apart; additive/guarded if added.
- The structured single-job result mirrors the bulk `JobRecord` (title, company, location, description,
  salary, url, sourceId, hostname, fetchedAt, status).

---

## 8. Integration Impact

- **Discover (Epic 1) chrome:** add the "Extract this job" control; it reads the **active/foreground**
  embedded `BrowserView`/webContents (the tab the user navigated) — NOT the Epic 3 hidden crawler.
- **Capture:** `executeJavaScript` for `document.body.innerText` (or a main/detail region) + the current
  URL on the visible webContents.
- **Main process:** a new module/handler (e.g. `extractVisibleJob.ts`) that takes captured text+URL,
  runs a **single structured LLM call** reusing the Epic 3 `JobSchema` (+ salary) and the
  injection-safe framing, derives sourceId, upserts to `jobs`, and triggers the Epic 5 score hook.
- **IPC + preload + types:** `ai:extractVisible` (or `board:extractOne`) → tagged-union result
  ({ ok, job } | { ok:false, code }); `window` bridge; progress/result events.
- **Renderer:** Discover wires the button + result toast; the board updates reactively (reuse the
  existing post-extract refresh).
- **Reuse:** Epic 2 key/model, Epic 3 JobSchema + jobs persistence + sourceId derivation, Epic 5
  score-after-extract, Epic 4/6 disclosure. **Composes with EXTR-018** (graceful stop → suggest this).

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] With a board open and a key+model configured, "Extract this job" captures the visible page's
      rendered text + URL and adds the single shown posting to the board.
- [ ] On a left-list/right-detail board, opening a job's detail and clicking the action extracts that
      **detail** posting (title/company/location/description/salary/url), not the list rows.
- [ ] The job persists with a deterministic sourceId, dedupes against existing jobs (re-extract = no
      duplicate), and gets scored via the Epic 5 hook.
- [ ] Nothing is fabricated; a page with no posting yields a clear "couldn't find a job" message.
- [ ] Page text is handled as untrusted (injection-laden content can't change behaviour or exfiltrate);
      the feature needs a key and opens no new egress (one-time disclosure on first send).
- [ ] No enumeration/crawl/auto-navigation occurs — it captures only the one visible job, on user click.

---

## 10. Risks & Unknowns

- **sourceId when the detail has no clean URL:** SPAs may not expose a per-job URL. Mitigation: read the
  selected-job id from the URL (e.g. `currentJobId`/`/jobs/view/{id}`) when present; else a stable
  hostname+title+company hash; dedup on that.
- **List vs detail ambiguity:** the captured body text includes both the list and the open detail.
  Mitigation: prompt the LLM to return the single posting that has a full description (the open detail);
  optionally try a heuristic main/detail region first.
- **Capturing the wrong view:** must read the **foreground** webContents, not the hidden crawler.
- **Partial detail (lazy "see more"):** some boards truncate the description until expanded. Mitigation:
  capture what's rendered; note it may be partial (acceptable for a manual single capture; user can
  expand "see more" before extracting).
- **Scope drift toward auto-clicking the list** — explicitly out of scope; keep it user-driven.

---

## 11. Dependencies

- **Epic 1 (Embedded Job-Site Browser)** — provides the foreground browser view to read.
- **Epic 2 (OpenRouter Key & Model)** — the LLM call.
- **Epic 3 (Agentic Job Extraction)** — reuse `JobSchema`, the `jobs` persistence, and sourceId
  derivation.
- **Epic 5 (Job Match Scoring)** — the score-after-extract hook.
- **EXTR-013 (salary extraction)** — the salary field on `JobSchema`/jobs.
- **Composes with EXTR-018** (graceful stop) — which points users to this fallback.

---

## 12. References

- prd: docs/Product Requirements Document/PRD.md (§non-goals — no automated scanning of gated/anti-bot
  boards; FR-SCAN-010 detect-and-stop). This epic is the **user-initiated, single-job** path, which is
  distinct from automated scanning and therefore in scope.
- related_epics: docs/Epics/epic_03_AGENTIC_JOB_EXTRACTION.md (bulk crawl + JobSchema/jobs this reuses),
  docs/Epics/epic_05_JOB_MATCH_SCORING.md (score hook), docs/Epics/epic_01_EMBEDDED_JOB_SITE_BROWSER.md
  (the browser view)
- deferred: a later **screenshot/vision** extraction epic (Option B) — explicitly out of scope here.

---

## 13. Implementation Notes (For Planning Agent)

Backend-first; serialise the scaffolding files (`electron-main.ts` / `electron-preload.ts` /
`env.d.ts`).

1. (Backend) Capture helper — read the **foreground** embedded-browser webContents:
   `executeJavaScript` for `document.body.innerText` (prefer a main/detail region, fall back to body) +
   the current URL. Pure-ish, handles missing view gracefully.
2. (Backend) `extractVisibleJob.ts` — single structured LLM call reusing the Epic 3 `JobSchema` (+
   salary) + injection-safe framing over the captured text; returns one job or "no posting found";
   derive sourceId (URL id else hostname+title+company hash); dedup + upsert to `jobs`; trigger the
   Epic 5 score hook.
3. (Backend) IPC + preload + types — `ai:extractVisible` (tagged-union result) + progress/result; the
   optional `source: 'manual'` provenance field on jobs (additive).
4. (Frontend) Discover chrome — the "Extract this job" control + extracting/success/no-posting states;
   board refresh; first-use disclosure reuse.
5. (Tests) Capture + structuring unit tests with stubbed text (list+detail returns the detail; no-posting
   path; injection-laden text handled as data; dedup on re-extract); a Discover wiring test.

Expected complexity: Low–Medium — one structured call + capture + persistence reuse; the care is reading
the foreground view, the list-vs-detail prompt, sourceId/dedup, and the untrusted-text framing.
Estimated total effort: ~5 tickets (1–3 hours each).

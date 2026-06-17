# Epic 3: Agentic Job Extraction (AI Extract)

Status: TICKETS
Owner: human
Created: 2026-06-16
Last Updated: 2026-06-16

---

## 1. Purpose

Turn the embedded browser from a place to *look* at jobs into a one-click
**importer**. After the user logs in and applies filters on a job site in the
Discover browser, a single **AI Extract** action crawls the full filtered result
set, imports every posting in detail into a persistent **job board**, and on every
subsequent run brings in **only postings not seen before**. Imported jobs can be
opened back in the embedded browser or flagged **Not interested**, and dismissed
jobs never return.

This epic ports the reference design in
`docs/References/Agentic Job Extraction/` onto Star's stack (Electron + Quasar +
`better-sqlite3` + Pinia), adapting the reference's local JSON store to Star's
`star.db`. It deliberately stops short of **scoring** the imported jobs (the 1–5
star match score and breakdown) — that consumes the board and belongs to a later
epic, exactly as Epic 1 delivered the browser and Epic 2 the model connection
without any scoring.

The defining design choice (kept verbatim from the reference): **the crawl is
deterministic; the LLM does only two narrow jobs** — (1) discover the page's CSS
selectors once per host (cached), and (2) structure each new job's detail text
into a typed record. Enumeration, pagination, and de-duplication are plain code.
This bounds error and cost and keeps the system general across sites.

---

## 2. User Story

As a job seeker (Sam),
I want to import every job from my filtered search into the app with one click — and on re-runs import only the new ones,
So that I can review and triage roles inside Star instead of across browser tabs, without ever re-reviewing the same posting.

(See `docs/References/Agentic Job Extraction/user-story.md` for the full BDD scenarios.)

---

## 3. Scope

### In Scope
- An in-process **MCP server** (Streamable HTTP, bound to `127.0.0.1`, session-per-connection) exposing browser tools (navigate, get-text, click, type, query, scroll, screenshot, outer-html) plus the extraction tools (`browser_query_all`, `browser_outer_html`, `browser_scroll`).
- An **active-target seam**: the MCP tools drive whatever `webContents` the main process points them at — normally Discover's visible browser, swapped to a **hidden crawler** during a run.
- A **hidden crawler** window that **shares the Discover browser's logged-in session**, so the user's login carries over and their visible view is never disturbed.
- A **LangGraph extraction graph**: `init → discover → enumerate → (paginate loop) → dedup → extractDetails → persist`, with the LLM confined to selector-discovery and job-structuring, reached via **OpenRouter using the key + default model from Epic 2**.
- A **job board** persisted in `star.db` (`jobs` + `site_profiles`), keyed by a stable **`sourceId`** derived from the posting URL, with insert-if-absent semantics and cached per-host layout profiles.
- **Incremental import / de-duplication** at the listing level (before any detail fetch), so re-runs import only new postings and cost scales with *new* jobs.
- **Triage**: mark a job **Not interested** (hidden + never re-imported), **Restore** it, and **Open** it in the embedded browser.
- **Live progress** streamed to the renderer ("Found 30 jobs", "Extracted 12/18", "Imported 7 of 42 listed"); the AI Extract button is disabled during a run.
- **Safety boundaries**: throttled requests, a configured **page cap**, **CAPTCHA/anti-bot detection that stops the run** (never bypasses), and graceful partial-failure (already-saved jobs stay intact; the board is never left corrupt).

### Out of Scope (deferred to later epics)
- **Scoring**: the 1–5 star match score, the explainable breakdown, and any CV/profile comparison (a later epic consumes the imported board).
- CV / cover-letter tailoring and any LLM *use* beyond selector-discovery and job-structuring.
- Credential handling — the user logs in themselves in the embedded browser; the app never captures, stores, or enters credentials.
- Any CAPTCHA/anti-bot **bypass** (a permanent product non-goal).
- Resumable/checkpointed crawls and human-in-the-loop mid-crawl gating (reference roadmap).
- A pool of parallel crawler windows (detail extraction stays sequential — one crawler).
- Per-site pagination strategies for infinite-scroll / virtualized lists beyond the basic next-control + scroll tools (note per-site handling as future work).
- Multi-user / hosted operation — state is local to the machine.

---

## 4. Functional Requirements

1. FR-001 — Clicking **AI Extract** crawls the full filtered result set of the listing currently open in the Discover browser and imports every posting into the job board.
2. FR-002 — Each imported job captures at least a title and company, plus location, salary, employment type, workplace type, posted date, full description, and apply URL where the posting provides them.
3. FR-003 — Extraction advances through result pages until none remain or a configured page cap is reached, importing jobs from every visited page.
4. FR-004 — Each posting has a stable `sourceId` derived from its URL (LinkedIn `currentJobId`, Indeed `jk`, Greenhouse `gh_jid`, generic `id`, numeric path fallback); re-running imports only postings not already on the board and never duplicates one.
5. FR-005 — A job can be flagged **Not interested** (hidden from the default board view, retained so it is never re-imported) and later **Restored**; **Open** navigates the embedded browser to the job's page.
6. FR-006 — The crawl runs in a **hidden** window sharing the user's session; the visible view is not hijacked and the user is not asked to log in again.
7. FR-007 — The renderer shows **live progress** during a run and a final summary; the AI Extract button is disabled until the run finishes.
8. FR-008 — The first time a host is seen, the app **learns its layout** (selectors) once and reuses the cached profile on later runs; hand-authored profiles are supported.
9. FR-009 — On CAPTCHA/anti-bot challenge, extraction **stops and informs the user** without attempting a bypass; on any failure, already-saved jobs remain intact and the board is not left partial.

---

## 5. Non-Functional Requirements

- NFR-001 (Security / localhost) — The MCP server binds to `127.0.0.1` only and is not reachable off the machine; DNS-rebinding protection is a hardening option. The general `browser_eval` tool is trusted-pages-only.
- NFR-002 (Security / credentials) — The app never captures, stores, or enters credentials; the hidden crawler reuses the session the user established by logging in themselves.
- NFR-003 (Security / session isolation) — The crawler shares the *browsing* session/partition (so login carries over) while remaining isolated from Star's own app data, consistent with Epic 1's isolation intent.
- NFR-004 (Responsible use) — Requests are throttled and capped; page content is untrusted input handled by a read-mostly, deterministic crawl that limits prompt-injection surface.
- NFR-005 (Performance / cost) — Re-run cost scales with the number of *new* postings (dedup happens before any detail fetch); the visible UI thread is never blocked during a run.
- NFR-006 (Cross-platform) — Extraction, the hidden crawler, and the board persist and work on macOS, Windows, and Linux from one codebase.

---

## 6. UI/UX Notes

- **Discover (`02`):** add an **AI Extract** control to the existing browser chrome, plus a **live progress line** ("Found N jobs", "Extracted x/y", summary). The button is disabled while a run is in flight. Reuse Epic 1's embedded browser as the visible listing view; AI Extract reads its current URL as the crawl start (filters live in the query string).
- **Job board / triage:** surface the imported board reusing the existing **Starred** page pattern (match-tile grid with **Not interested** dismiss + **Restore N hidden**) — but backed by the real `jobs` store instead of the mock `MATCHES`/`dismissed` state. Each row offers **Open** (→ embedded browser) and **Not interested / Restore**. (Final placement — extend Starred vs a dedicated "Imported" view — is a planning decision; the Starred dismiss/restore UX is the natural home.)
- Studio visual system is unchanged — no new tokens or colours; reuse existing components and the `q-dialog`/progress patterns.

---

## 7. Data Model Impact

Ported from the reference (`job-board-store.ts`) into `star.db`:

```ts
type JobStatus = 'new' | 'seen' | 'not_interested';
interface JobRecord { sourceId; url; title; company; location?; workplaceType?;
  employmentType?; salary?; postedDate?; description?; applyUrl?; status; importedAt; }
interface SiteProfile { hostname; cardSelector; linkSelector?; nextSelector?; idFromUrl?; }
```

- New `jobs` table keyed by `sourceId` (insert-if-absent; user-set `status` never overwritten by a re-import).
- New `site_profiles` table keyed by `hostname` (cached discovered selectors; hand-authorable).
- Both live in the existing `star.db` alongside `sites` (Epic 1) and `preferred_models` (Epic 2), via a module mirroring `sites.ts`.
- The reference's JSON store maps 1:1 onto this SQLite store (the reference explicitly notes SQLite as the drop-in upgrade behind the same interface).

---

## 8. Integration Impact

- **New main-process modules (mirroring `sites.ts` / `browser-surface.ts`):** `mcp-browser-server.ts` (MCP server + base browser tools + active-target seam), `extraction-tools.ts` (enumeration tools), `extraction-graph.ts` (LangGraph crawl), `jobBoard.ts` (`jobs` + `site_profiles` store + `deriveSourceId`), `jobAgent.ts` (app-integration: IPC + MCP client + OpenRouter model + hidden crawler + retargeting).
- **`electron-main.ts` (scaffolding):** start the MCP server on app-ready, hold the active-target seam (default = Discover's visible browser), create/own the hidden crawler, and register the job-agent + board IPC — reusing the single `star.db` handle.
- **`electron-preload.ts` + `env.d.ts` (scaffolding):** new bridges (e.g. `window.starExtract`, `window.starBoard`) and their `Window` types, extending the existing `starWindow`/`starBrowser`/`starSites` surfaces.
- **Renderer:** `app-store.ts` gains board state/actions + a progress subscription; `DiscoverPage.vue` gets the AI Extract button + progress; `StarredPage.vue` (or a new board view) is backed by the real board; `routes`/`MainLayout` if a new view is added.
- **Cross-epic dependencies:** the embedded browser + session (Epic 1) and the **OpenRouter key + default model** (Epic 2) are prerequisites — the extractor builds its `ChatOpenAI` from Epic 2's saved key and selected model.
- **New dependencies (frameworks — flagged for approval):** `@langchain/langgraph`, `@langchain/openai`, `@langchain/mcp-adapters`, `@langchain/core`, `@modelcontextprotocol/sdk`, `zod`. All JS/main-process; no native build step.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] AI Extract imports every job across all result pages of the current filtered listing into the board, with a summary like "Imported 42 of 42 listed".
- [ ] Each imported job has at least title + company, and the optional fields where present.
- [ ] Re-running imports only postings not already on the board; none are duplicated; the summary reports how many were skipped as already imported.
- [ ] `sourceId` is derived per the documented patterns (LinkedIn/Indeed/Greenhouse/generic/numeric); the user-story Scenario Outline examples hold.
- [ ] Not-interested jobs are hidden, retained, and never re-imported; Restore returns them; Open navigates the embedded browser to the job.
- [ ] The crawl runs in a hidden window sharing the login; the visible view is not disturbed and no re-login is required.
- [ ] Live progress is shown during a run and the AI Extract button is disabled until it finishes.
- [ ] A new host's layout is learned once and reused from cache on later runs.
- [ ] On CAPTCHA/anti-bot challenge the run stops and informs the user without bypassing; on failure, saved jobs remain intact and the board is not corrupted.
- [ ] The MCP server is reachable only on `127.0.0.1`; the app never handles credentials.
- [ ] No scoring/star breakdown is present — confirms the scope boundary.

---

## 10. Risks & Unknowns

- **New framework footprint:** LangGraph + LangChain + MCP SDK are a significant addition; bundle size, ESM/CJS interop under Quasar's electron build, and main-process startup cost need validation early.
- **Session sharing vs Epic 1 isolation:** the crawler must reuse the Discover browser's *logged-in* partition for the login to carry over, while staying isolated from app data — reconcile with Epic 1's partitioned-session choice during planning.
- **Surface choice:** Epic 1's embedded browser surface (BrowserView/`<webview>`/`WebContentsView`) determines how the active-target seam and the hidden crawler attach; the reference uses `WebContentsView` + a hidden `BrowserWindow`.
- **Pagination generality:** the reference clicks a discovered "next" control and waits a fixed interval — fine for classic paged results, but infinite-scroll/virtualized lists need per-site handling (deferred).
- **Structured-output model requirement:** field-structuring uses function-calling; the Epic 2 default model must be tool/function-calling capable (Claude 3.5+/GPT-4o-class/Gemini) — surface a clear message if not.
- **LLM cost/latency on first-seen hosts:** selector discovery + per-new-job structuring incur model calls; caching profiles and dedup-before-detail are the mitigations.

---

## 11. Dependencies

- **Epic 1 (Embedded Job-Site Browser)** — provides the visible browser surface, the session the crawler reuses, and `Open`-in-browser navigation. (In `review` = met for execution.)
- **Epic 2 (OpenRouter API Key & Model Selection)** — provides the saved key and selected default model the extractor's `ChatOpenAI` is built from. The integration ticket declares explicit `depends_on` links to the Epic 2 key-storage and default-model tickets.

---

## 12. References

- source_reference: docs/References/Agentic Job Extraction/ (architecture.md, user-story.md, and the reference TS modules — `main.ts`, `extraction-graph.ts`, `extraction-tools.ts`, `job-board-store.ts`, `app-integration.ts`, `preload.cjs`, `board.html`)
- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md
- data_model: docs/Data Model/Schema.ddl

### Reference → Star mapping
- `main.ts` (window, embedded browser, hidden crawler, target seam, MCP start) → Star `electron-main.ts` + new `mcp-browser-server.ts`
- `extraction-tools.ts` (query_all, outer_html, scroll) → Star `src-electron/extraction-tools.ts`
- `extraction-graph.ts` (LangGraph crawl, two LLM nodes) → Star `src-electron/extraction-graph.ts`
- `job-board-store.ts` (JSON store) → Star `src-electron/jobBoard.ts` (better-sqlite3, mirroring `sites.ts`)
- `app-integration.ts` (IPC, MCP client, OpenRouter model, crawler mgmt) → Star `src-electron/jobAgent.ts` + `electron-main.ts` wiring
- `preload.cjs` (`window.jobAgent`) → Star `electron-preload.ts` (`window.starExtract` / `window.starBoard`) + `env.d.ts`
- `board.html` (UI panel) → Star `DiscoverPage.vue` (AI Extract + progress) + `StarredPage.vue`/board view (triage)

---

## 13. Implementation Notes (For Planning Agent)

Suggested ticket breakdown (backend first; serialise the shared scaffolding files
`package.json` / `electron-main.ts` / `electron-preload.ts` / `env.d.ts`, then
`app-store.ts` / the page files; the job-board store is independent and can run in
parallel with the MCP work):

1. (Backend) Dependencies + in-process MCP server (Streamable HTTP, `127.0.0.1`) + active-target seam.
2. (Backend) Browser + extraction MCP tools acting on the active target. *(after 1)*
3. (Backend) `jobBoard.ts` — `jobs` + `site_profiles` in `star.db`, `deriveSourceId`, dedup/status/profile ops. *(independent)*
4. (Backend) LangGraph extraction graph (init→discover→enumerate→paginate→dedup→extractDetails→persist). *(after 2 + 3)*
5. (Backend) Safety boundaries — CAPTCHA/anti-bot stop, throttle, page cap, graceful partial-failure. *(after 4)*
6. (Backend) `jobAgent.ts` — `ai:extract` / `board:list` / `board:setStatus` / `view:open` IPC, MCP client, OpenRouter model from Epic 2's key+model, hidden crawler + retargeting; preload bridge + types. *(after 5; depends on Epic 2 key + default-model tickets)*
7. (Frontend) `app-store.ts` board state/actions + progress subscription + types. *(after 6)*
8. (Frontend) Discover AI Extract button + live progress + disabled-during-run. *(after 7)*
9. (Frontend) Board view + triage (Open / Not interested / Restore) backed by the real store. *(after 7)*
10. (Tests) `deriveSourceId` patterns, board dedup/status invariants, graph dedup/incremental + CAPTCHA-stop (mocked tools + LLM). *(after 6)*
11. (Docs) Help + architecture doc update for AI Extract. *(after 9)*

Expected complexity: High — this introduces a whole agentic subsystem (MCP + LangGraph + hidden crawler) and three new persistence/tool surfaces. The reference maps closely onto Star's stack, but the framework footprint, session-sharing, and active-target seam are the real care points.
Estimated total effort: ~11 tickets (1–4 hours each).

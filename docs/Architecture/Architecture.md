# Architecture: Star Job Search

## 1. What We're Building

Star Job Search is a cross-platform Electron desktop application (Vue 3 + Quasar
renderer, Node main process) that automates the job-search loop locally. It drives
an embedded browser to scrape public job listings, scores each one 1–5 stars
against the user's profile with a deterministic, explainable algorithm, and uses
the user's own OpenRouter key to draft tailored CVs and cover letters. The
defining architectural property is **local-first, single-user privacy**: all
personal data (CV, profile, API key, listings, applications) stays on the device,
with exactly two outbound network paths — user-configured job-site scrapes and
opted-in OpenRouter LLM calls. See PRD at
`docs/Product Requirements Document/PRD.md`.

**Current state.** A working prototype exists, but it is a **UI shell with sample
data** — the entire main-process backend is greenfield. What's marked *built* vs.
*to build* below reflects that line honestly.

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Shell | Electron 42 | Cross-platform desktop (mac/Win/Linux) from one codebase; gives an embedded browser for scanning. |
| Renderer | Vue 3 + Quasar 2 + Pinia | *Built.* Quasar supplies the component set and the Electron build mode. |
| Language | TypeScript (strict) | Per scaffold; enables the unit-tested deterministic scorer. |
| Persistence | SQLite via `better-sqlite3` (main process) | *To build.* Transactional, fast local queries, single-file backup. |
| Secret storage | Electron `safeStorage` (Keychain/DPAPI/libsecret) | *To build.* OS-native secure store for the OpenRouter key only. |
| Scanning | Electron `BrowserView`/`<webview>`, partitioned session, per-site adapters | *To build.* Loads public listings; adapters isolate per-site breakage. |
| LLM | OpenRouter via the user's own key | *To build.* No bundled model; the user controls cost and what data is sent. |

Transitive dev dependencies (autoprefixer, vue-tsc, eslint, etc.) are omitted —
only the choices that shape the architecture are listed.

## 3. How It's Put Together

Star is a two-process Electron app with a hard security boundary between them. The
split *is* the architecture: the **renderer** is untrusted with secrets and
touches no network or disk directly; the **main** process owns all data, secrets,
network, and the embedded scan browser. They talk over IPC through a vetted
preload bridge.

**Renderer (Vue 3 + Quasar) — *built.*** All UI: the eight pages, the
`StarRating` / `ScoreBar` / `StatusPill` components, the custom frameless title
bar in `MainLayout`, the Studio theme, and a Pinia store. Today the store hydrates
from `src/data/sample.ts` (`MATCHES`, `SAMPLE_API_KEY`); in the target it hydrates
from main over IPC and holds no secrets.

**Main (Node) — *greenfield, to build.*** Five components, each a clear
responsibility:

- **Scan Orchestrator + Scheduler** — opens the embedded browser per enabled site,
  runs the per-site adapter, enforces robots.txt and rate limits, streams
  `ScanSource` progress over IPC, and persists listings. The scheduler fires
  cadence-based scans and catches missed windows on wake/launch.
- **Scoring Engine** — pure and deterministic:
  `(listing, profile, weights) → factor sub-scores + composite + stars/%`. No LLM
  involvement. Unit-tested against fixtures.
- **CV Parser** — runs off-thread (worker / utility process) so parsing never
  blocks the UI.
- **LLM Gateway** — the *only* path to OpenRouter; injects the key from secure
  storage at call time so the key never reaches the renderer; handles timeouts and
  retries.
- **Backup Writer** — serialises state (minus the key) to the user-chosen folder
  on triggers, with coalescing of rapid triggers.

**Where data lives.** The source of truth is a local SQLite database
(`better-sqlite3`) in main, holding listings, scores, applications, suggestions,
sites, settings, and profile metadata. CV binaries are files on disk referenced by
path from SQLite. The OpenRouter key lives *only* in OS-secure storage and is never
written to SQLite, backups, logs, or renderer state. (Full table-level model: PRD §8.)

**The boundary that defines the app — exactly two egress paths, both auditable:**

```
RENDERER (Vue/Quasar, no secrets)
   │  IPC via preload bridge (CV picker · backup folder · key store · scan progress)
   ▼
MAIN (Node) ── owns SQLite + OS-secure key store
   ├─ Embedded browser  ──HTTPS──▶  user-listed job sites   (robots + rate-limited)
   └─ LLM Gateway       ──HTTPS──▶  OpenRouter               (user's key, opted-in)
```

This single diagram earns its place: the two-egress trust boundary is the one
non-obvious, load-bearing flow in the system. Everything else is prose.

Note the **preload bridge is the current gap**: today it exposes only `starWindow`
(title-bar controls). The CV-picker, backup-folder, and key-store channels are the
first real backend work — the preload file itself flags them as future bridges.

## 3a. Agentic Extraction Subsystem (Epic 3)

The agentic extraction subsystem turns the embedded browser into an importer for
the user's local **job board**. It sits entirely in main and reuses, rather than
forks, the two prior egress paths — it never opens a new one.

- **MCP browser server (in-process).** A Model Context Protocol server hosted
  inside main exposes browser and extraction tools (navigate, query DOM,
  enumerate listing cards, follow detail links) against the *active target* — a
  seam that points the tools at either the visible Discover `BrowserView` or a
  hidden crawler window. Tools are the only way the LLM agent reaches the page;
  there is no direct fetcher.
- **Hidden crawler.** A second partitioned `BrowserView`, never shown to the
  user, that the MCP tools retarget onto when a run needs to paginate or open
  detail pages without disturbing the Discover view. It inherits the same
  session-isolation guarantee as the visible browser (NFR-001).
- **LangGraph extraction graph.** A deterministic graph
  (`discover → enumerate → paginate → dedup → extract → persist`) drives the
  agent. The LLM proposes tool calls; the graph enforces ordering, throttles
  page loads, caps pagination, and stops on CAPTCHA detection rather than
  attempting to bypass it (a permanent product non-goal).
- **Job board.** SQLite tables `jobs` and `site_profiles` in `star.db`, with
  per-posting `sourceId` dedup so re-runs over the same listing don't import
  duplicates. The Starred matches page is the board view; `board:setStatus`
  flips a row between `new` / `not_interested` / restored.
- **Progress + IPC.** `ai:extract` triggers a run and streams `extract:progress`
  events (phase, message, current/total) to the renderer; `board:list` and
  `board:setStatus` back the Starred matches view; `view:open` returns a job
  URL to the embedded browser.

**Dependencies on earlier epics — load-bearing, not optional:**

- **Epic 1 (Embedded Job-Site Browser).** The visible `BrowserView` and the
  persisted `Site` list are the entry point: the user signs in and filters
  inside that browser before AI Extract runs. The hidden crawler is the same
  surface in a second partition. Without Epic 1's preload bridge, partitioned
  session, and sites persistence, the extraction subsystem has nothing to drive.
- **Epic 2 (OpenRouter LLM integration).** The agent uses the user's stored
  OpenRouter key and their selected preferred model — extraction is gated on a
  saved key and a chosen default model. The LLM Gateway from Epic 2 is the only
  caller; the extraction subsystem never opens a third egress path.

## 3b. CV → Profile Flow (Epic 4)

Epic 4 (Add CV to profile) turns the Profile from a UI shell over `Alex_Morgan_CV.pdf` /
`PARSED_SKILLS` sample data into the real, persisted source of truth the later scoring
epic will read. Like §3a, it lives entirely in main and reuses — rather than forks — the
two existing egress paths.

- **CV upload & on-disk versioning (`cv.ts`).** PDF and DOCX uploads (drag-drop or
  native picker, max 10MB) are written under `userData`; metadata, extracted text and
  parsed fields land in `star.db` as a versioned `CV` row keyed to the singleton
  `Profile`. Re-uploading via Replace creates a new version and re-derives the
  Profile, so prior data is not silently lost.
- **Off-thread text extractor.** PDF/DOCX → text runs in a worker / utility process
  (`pdfjs-dist` for PDF, `mammoth` for DOCX) so the renderer never blocks during
  upload. The file itself never leaves the device for text extraction (NFR-001).
- **First real OpenRouter completion call.** Epic 2 built key storage, the model
  catalogue and default-model selection but stopped short of any chat/completion
  call. Epic 4 adds the **first** OpenRouter completion / structured-output call on
  top of that surface: the extracted text is sent to the user's selected default
  model and returned as a typed `parsedFields` object plus per-field `confidence`
  scores. The call goes through the existing LLM Gateway — **no new egress path** is
  opened, and the two-egress boundary in §3 is unchanged.
- **No-key / parse-failure fallback.** Onboarding lets the user skip the OpenRouter
  key, so structuring is unavailable on that path; the renderer offers retry, a
  different file, or manual entry into the same Profile fields. Parse failures
  degrade the same way (NFR-004).
- **One-time disclosure.** Before CV text is sent to the model for the first time
  the renderer surfaces a "what is sent, to which provider" disclosure; structuring
  proceeds only after acceptance, and is disabled until an Epic 2 key is present.
- **`profile.ts` singleton.** A single `Profile` row holds target role, skills,
  years experience, location, work mode, minimum salary + currency, LinkedIn URL
  and portfolio links. The renderer reads/writes it over `profile:get` /
  `profile:save` IPC; edits to scoring-relevant fields mark future scores stale
  (the re-score itself is the scoring epic's job, per §3 and Epic 4 §3).
- **Profile-strength + minimum-scorable gate (renderer).** Computed deterministically
  from field completeness; the rubric is exposed in the UI rather than baked into a
  fixed "85/100". The minimum-scorable set (target role + ≥1 skill + location +
  work mode) is enforced and the renderer names what is missing.

**Dependencies on earlier epics — load-bearing, not optional:**

- **Epic 2 (OpenRouter LLM integration).** Structuring uses the user's stored key
  and selected default model. With no key the structuring path is disabled and the
  renderer falls back to manual entry.
- **Shared foundation.** Reuses the single `star.db` handle and the preload-bridge
  pattern from Epics 1–3 (`sites.ts` / `apiKey.ts` as the module template); new
  bridges `window.starProfile` and `window.starCv` extend the existing surface.

## 3c. Tailoring Diff Engine (Epic 9)

The Tailoring Diff Engine produces a job-specific CV by emitting **structured,
grounded diffs** against the user's master CV — never a regenerated document —
so every change is path-addressable, reviewable, and reversible. The engine lives
entirely in main; the renderer (Epic 7) sees only proposed and applied diffs
through the `tailor:propose` / `tailor:apply` IPC. There is no parallel LLM-only
tailoring path.

**Pipeline.** LangGraph orchestrates a five-node `StateGraph` whose edges only
route — every gate, verifier, refine helper, and rescore call is a pure
TypeScript function imported from TDE-001 .. TDE-004 and Epic 5:

```
extract-JD-signals  (or reuse cached Epic 6 keywords)
  → plan/verify-skills      (3-tier verifier — existing / jd_added / supported / rejected)
  → generate-diffs          (LLM, structured ProposedChange[])
  → gate-filter             (four gates, see below)
  → refine loop (bounded)   (inject keywords → strip AI phrases → master-alignment)
  → rescore                 (Epic 5 deterministic scorer — never an LLM number)
```

**Structured grounded diffs.** The LLM emits a list of `ProposedChange` records
typed as `{ action, path, original?, value, reason }`. The action vocabulary —
`replace`, `append`, `reorder`, `add_skill` — is closed; arbitrary edits are
not expressible. Every `replace` carries an `original` snapshot of the current
text at that path, which Gate 4 uses to reject hallucinated diffs. The model is
told (and the gates enforce) that diffs **reframe existing content into JD
vocabulary** — they never invent facts, metrics, employers, or dates.

**Four gate guarantees.** Every ProposedChange runs through four pure gates
before it can mutate the working document:

1. **Editable-path allowlist** — the target path is in the document's editable
   set (`summary`, `experience[i].bullets[j]`, `projects[i].bullets[j]`,
   `education[i].description`, `skills[i]`); leaf vs list shape is checked per
   action.
2. **Frozen-field block** — identity, contact, locations, dates, employers,
   schools, qualifications and project names are blocked at the path level, not
   policed in the prompt.
3. **Path resolution** — the path must resolve on the current document state.
4. **Original-text match** — for `replace`, the supplied `original` must match
   the actual text at that path (case- and whitespace-insensitive). This is the
   anti-hallucination gate that keeps the diff grounded.

`add_skill` carries an additional gate against a 3-tier skill verifier
(`skillVerifier.ts`): only skills already in the master CV, present in the JD,
or supported by the master CV's prose are admissible. Anything else is rejected.

**Epic 7 delegation.** The renderer **delegates** all engine work over IPC and
does no validation of its own. `tailor:propose` returns the full set of gated
diffs (plus refine warnings and the projected match-% delta) and `tailor:apply`
applies a user-selected subset against the working document, returns the new
document, and re-invokes Epic 5's deterministic scorer. The Epic 7 UI is the
*only* place that decides which diffs ship — there is no auto-apply path inside
the engine.

**Strict Epic 5 rescore separation.** Match scores never flow out of the LLM.
The engine never writes a number into the score store, and never asks the model
for one. The rescore step calls the same deterministic Epic 5 scorer that
backs the Job Board's star rating, against the post-apply document. This keeps
the property that scoring is reproducible and survives OpenRouter being down.

**Data model.** The engine's data shapes (TailoringDocument's editable + frozen
path sets, the ProposedChange union, the SkillVerdict classifications, refine
warnings) are documented in `docs/Data Model/TailoringEngine.md`.

**Attribution.** Resume-Matcher (Apache-2.0 © srbhr) influenced the high-level
idea of a gated, grounded tailoring pipeline that emits a deterministic match
score separately from the LLM step. No Resume-Matcher source is incorporated.
The conceptual-inspiration entry, the Apache-2.0 attribution boilerplate, and
the rule for upgrading the entry if any code is ever ported live in `NOTICE.md`
§4 (Resume-Matcher).

## 3d. Job Evaluation Report Subsystem (Epic 14)

Epic 14 (Job Evaluation Report) turns the Job-detail surface into a full
qualitative read of a single posting — eight collapsible blocks (A–H) that sit
**alongside** the deterministic Epic 5 rating and the Epic 6 narrative review,
never replacing them. Like §3a–§3c, it lives entirely in main and reuses —
rather than forks — the two existing egress paths.

- **A–H block composition.** The report is a fixed eight-block layout:
  **Block A** — *Role Summary & Employer Context* (LLM narrative, optionally
  enriched by web research);
  **Block B** — *Match with CV* (the Epic 6 AI Match Review, read from
  `match_reviews` or generated on demand and cached there — Epic 14 does
  not store Block B inside `eval_reports`);
  **Block C** — *Level & Strategy* (LLM narrative);
  **Block D** — *Compensation* (LLM narrative comparing the JD-stated band
  against the user's expectation, plus a market-band sentence with cited
  sources when web research is on);
  **Block E** — *Tailored CV* CTA that deep-links into the Epic 7 Tailor view;
  **Block F** — *Interview Prep* CTA that deep-links into the Tailor view
  with `focus=interview-prep`;
  **Block G** — *Legitimacy Signals* (LLM narrative + `legitimacyVerdict ∈
  {legitimate, suspicious, unknown}` + best-effort `verificationNote`);
  **Block H** — *Cover Letter & Apply* (CTA + optional narrative).
- **Deterministic-stars-as-rating rule.** The Eval report **emits no
  number, score, star, percentage, or any quantitative fit signal**. The
  authoritative rating remains the Epic 5 deterministic 1–5 stars + 0–100 %
  match — the orchestrator reads them from `match_scores` and forwards them
  to the header for display, never produces them. Block B reuses Epic 6's
  no-number guarantee verbatim; Blocks A/C/D/G are independently constrained
  by their Zod schemas (no numeric fields by construction) and by a
  hard-rule system framing on every LLM call. `eval_reports` has no score
  column for the same reason — the data model cannot accidentally surface a
  number even if a future block tried to emit one. This keeps the property
  that scoring is reproducible and survives OpenRouter being down: the rating
  comes from a pure function over `(listing, profile, weights)`, never from
  the LLM.
- **Shared `webResearch` capability (EVAL-001).** Blocks A/D/G optionally
  enrich their narrative with researched web text. Research goes through a
  single shared `webResearch` module in main exposing `search(query)` and
  `fetchUrl(url)`, driving the existing embedded `BrowserView` (Epic 1) or
  the Epic 3 hidden crawler in the same partitioned `persist:job-browser`
  session. **No external HTTP API and no extra API key.** Extracted text is
  passed through the existing prompt-injection sanitizer — fetched web
  content is UNTRUSTED data, never instructions. Sources travel through
  `eval_reports.sources` so the UI can cite them.
- **Opt-in, default-OFF, local-only `webResearchEnabled` setting +
  one-time disclosure.** Web research is **off by default** and gated by a
  local-only `webResearchEnabled` setting that lives in `settings` and
  never leaves the device. Two gates run before any browser navigation:
  (1) when the setting is OFF, `webResearch` returns
  `{ ok: false, code: 'research_disabled' }` and nothing is fetched; (2) the
  first call after enabling shows a one-time "what is sent" disclosure and
  returns `{ ok: false, code: 'disclosure_required' }` until the user
  acknowledges it. With research off, Blocks D & G degrade to JD-stated-only
  and say so verbatim in their narrative; the report is still produced.
- **Anti-bot-no-bypass rule.** Logins, paywalls, CAPTCHAs, and anti-bot
  interstitials are **detected and stopped, never bypassed** — the same
  permanent product non-goal that governs Epic 1 (FR-SCAN-010) and Epic 3
  applies here unchanged. When `webResearch` matches a challenge marker on
  page text or HTML it returns `{ ok: true, uncertain: true, reason: '…' }`
  with an empty result set; Block G's `verificationNote` carries that
  `unknown` verdict through to the persisted report, and Block D falls back
  to JD-stated comp without a market sentence.
- **No new egress path — the two-egress boundary in §3 is unchanged.**
  The egress relaxation that lets the Eval report reach search engines and
  employer pages is **scoped to this epic**: it stays within the same
  embedded browser surface (the Epic 1 visible view + the Epic 3 hidden
  crawler), in the same partitioned `persist:job-browser` session, behind
  the opt-in setting + one-time disclosure described above. The PRD's
  egress posture (NFR-S5) is not relaxed; the relaxation is documented
  here and in `docs/Data Model/EvalReport.md` rather than in the PRD.

**Dependencies on earlier epics — load-bearing, not optional:**

- **Epic 1 (Embedded Job-Site Browser).** Supplies the `BrowserView`, the
  partitioned session, and the preload bridge `webResearch` drives.
- **Epic 3 (Agentic Job Extraction).** Supplies the hidden crawler the
  shared `webResearch` module retargets onto when a research run needs to
  navigate without disturbing the Discover view; supplies the prompt
  sanitizer applied to all extracted text.
- **Epic 5 (Job Match Scoring).** Provides the deterministic rating
  surfaced in the report header — the Eval report never recomputes or
  overrides the stars.
- **Epic 6 (AI Match Review).** Provides Block B and the "no number,
  grounding, JD-as-untrusted-data" framing reused by Blocks A/C/D/G.
- **Epic 7 (Tailoring) + Epic 8 (PDF Export) + Epic 12 (Unified Export).**
  Blocks E, F, H are CTAs into those flows; the Eval report itself does
  not draft, tailor, or export.

**Data model.** Full table shape, the A–H persistence layout,
`legitimacyVerdict`, the `sources` array, and the no-score-column
guarantee live in `docs/Data Model/EvalReport.md`. The conceptual
attribution for the A–H structural idea — career-ops (MIT), no text or
code copied, no number emitted — lives in `NOTICE.md` §1 (career-ops).

## 4. Key Decisions

- **Electron, not Tauri/native:** the product *needs* an embedded browser to scan
  public listings — Electron's `BrowserView`/`<webview>` is the cleanest way to
  drive one. Tauri's webview is harder to partition for scraping.
- **SQLite (`better-sqlite3`) in main, not IndexedDB in the renderer:** secrets and
  compute belong on the trusted side of the boundary; SQLite also gives
  transactional integrity and trivial single-file backup. IndexedDB would put the
  data store in the untrusted renderer.
- **Deterministic in-app scorer, not LLM scoring:** the same
  `(listing, profile, weights)` must always yield the same star score, and the
  breakdown must reconcile exactly. The LLM is for tailoring only — scores never
  depend on it, so they stay explainable and stable even when OpenRouter is down.
- **Per-site adapters behind one interface, not a generic scraper:** each site
  declares its own URL template, selectors, and pagination; one site breaking or
  changing layout can't crash the scan or affect others. Adding a site is config +
  adapter, not a core change.
- **Embedded browser in a partitioned session, isolated from the app renderer:**
  site cookies and JS can't touch app state — the scrape sandbox stays separate
  from the trusted UI.
- **OpenRouter key in OS-secure storage only, never in SQLite/backups/state:** it's
  the one secret in the system; isolating it there makes the "key never leaks"
  guarantee structural rather than a convention.
- **No auto-apply, human-in-the-loop:** Star drafts and tracks but never submits —
  a deliberate product *and* risk boundary (ToS / accuracy), so the architecture
  has no employer-submission path at all.
- **Tailoring engine: LangGraph orchestrates, gates pure, apply UI-driven (Epic 9):**
  the engine's `StateGraph` only routes between nodes — every validation, skill
  verification, refine helper, and the Epic 5 rescore is a pure TypeScript
  function imported from TDE-001 .. TDE-004 and Epic 5, with no validation logic
  hiding in prompts or graph edges. The four gates and the `apply` operation are
  pure (no side effects, no LLM call). The accept / dismiss decision and the
  actual application of diffs to the working document live in the Epic 7 UI —
  the engine never auto-applies. This keeps the LLM untrusted, the gates
  unit-testable in isolation, and the human in the loop on every change that
  ships into a draft.
- **Scheduler in main, no external daemon:** background scans run inside the app's
  main process on a cadence; nothing extra to install, and missed windows are
  caught on wake/launch.

Obvious choices (TypeScript strict, Pinia for Vue state) are left out — they aren't
decisions anyone would second-guess.

## 5. Security & Data

**Trust boundary.** The user's own machine. The renderer is treated as untrusted
with secrets: `contextIsolation: true`, `nodeIntegration: false`, and native
capability reaches it *only* through vetted preload channels (CV picker, backup
folder, key store, scan progress). The scan browser runs in a separate partitioned
session so a job site's cookies or JS can never reach app state.

**The one secret.** The OpenRouter API key lives *only* in OS-secure storage
(`safeStorage` → Keychain / DPAPI / libsecret). It is never written to SQLite,
never included in backups, never logged, and never present in renderer state — the
LLM Gateway injects it at call time.

**Data at rest.** Everything else (profile, parsed CV text, listings, scores,
applications, suggestions, sites, settings) is stored in cleartext in the local
SQLite database at standard user permissions; CV source files sit on disk
referenced by path. There is no remote store and no sync. Whether backups are
encrypted with a user passphrase is an open decision (PRD §13 Q2 / NFR-S6) — until
decided, backups are plaintext local files and exclude the key.

**Egress.** Exactly two outbound paths exist, both user-driven and auditable: the
embedded browser to user-configured job sites (robots.txt-respecting,
rate-limited), and the LLM Gateway to OpenRouter (user's key, opted-in, after a
one-time "here's what's sent" disclosure). No telemetry or analytics endpoint ships
in v1; any analytics is computed locally.

**Compliance.** None mandated for a single-user local tool. The live risk is the
*legal/ToS posture on scraping*, not data-protection compliance — handled by the
public-listing-only + human-in-the-loop + user-configurable-sites design
(PRD §13 R1/Q3), not by anything in the storage layer.

## 6. Open Questions

The PRD's §13 carries the full register of eight open questions (Q1–Q8) with owners
and deadlines. Only three are *architectural* — they change how the code is built;
the rest are product/legal/tuning calls and stay in the PRD:

- **Backup encryption (PRD Q2 / NFR-S6):** plaintext local files, or encrypted with
  a user passphrase? Changes the Backup Writer and restore flow. *Owner: Eng + PM.*
- **Default OpenRouter model + deprecation handling (PRD Q6):** affects how the LLM
  Gateway abstracts model selection and fallback. *Owner: Eng.*
- **Tailored-CV output fidelity (PRD Q8):** preserve original PDF/DOCX layout, or
  emit plain/markdown the user re-formats? Determines whether the tailoring path
  needs a document-rendering stage at all. *Owner: PM + Eng.*

# Product Requirements Document — Star Job Search

**Status:** Draft v1.0 · **Owner:** Francois Botha · **Last updated:** 2026-06-16
**Product:** Star Job Search — cross-platform desktop app (Electron + Vue 3 + Quasar) that automates job hunting around a transparent **1–5 star** match score.

> **How to read this document.** Sections 1–4 are product framing; 5–10 are engineering-ready
> specification; 11–13 are go-to-market and governance. UI/UX is **not** re-specified here — it is
> owned by the design handoff (the runnable Quasar scaffold under `Star Job Search (1)/` and the
> mockups in `docs/Mockups/`). This PRD references those artifacts and adds behaviour, data, and
> system requirements. Every assumption is tagged **[A#]** and collected in §13.4.

### Design handoff — source of truth for UI/UX
| Artifact | Location | Owns |
|---|---|---|
| Runnable scaffold | `Star Job Search (1)/star-job-search-quasar/` | Screens, components, routes, store shape |
| Visual system ("Studio") | `src/css/app.scss`, `src/css/quasar.variables.scss` | Tokens, colour, type |
| Domain types | `src/types/models.ts` | `Application`, `Match`, `ScanSource`, `Suggestion`, `STATUS_PILL` |
| Mockups | `docs/Mockups/01..10-*.png`, `Star-Style-Guide.png` | Approved per-screen layouts |

**Studio design system (do not re-invent):** accent terracotta `#c2683a` (primary action + star score, used sparingly); positive olive `#7a8b5a`; surfaces `#fdfcf9`/`#faf8f2`/`#ffffff`/`#f3f1ea`; type Instrument Serif (display/large numbers), Hanken Grotesk (UI/body), JetBrains Mono (labels/numbers/URLs). **The five-point star is the brand motif** — it is the primary expression of match quality everywhere a job appears.

---

## 1. Summary

Active job-seekers waste hours every week doing the same manual loop: open several job boards, run the same searches, skim listings, guess how well each fits, and hand-edit a CV and cover letter per application — with no consistent way to judge fit or track what they have sent. **Star Job Search** is a desktop app that automates that loop locally. The user uploads a CV and fills in a short profile; the app drives an **embedded browser** to scan a configurable list of job sites, scrapes public listings, and scores each one **1–5 stars** against the profile with a transparent, per-factor breakdown. Strong matches are starred; weak or unwanted ones can be dismissed as *Not interested*. For any chosen job, the app uses an LLM (via the user's own **OpenRouter** key) to draft a tailored CV and cover letter and surfaces accept/dismiss suggestions that visibly raise the match score. Every application is tracked end-to-end (**Saved → Applied → Interviewing → Offer / Rejected**) with history and funnel stats. **All personal data — CV, profile, API key — stays on the device**; nothing leaves it except the listing scrapes the user initiates and the LLM calls the user opts into, plus backups written to a folder the user chooses.

**The problem it solves:** it collapses the search-score-tailor-track loop into one local, transparent tool, replacing gut-feel fit assessment with an explainable star score and eliminating per-application copy-paste — without surrendering the user's CV or search history to a cloud service.

---

## 2. Goals & non-goals

### 2.1 Goals (measurable)
| # | Goal | Target (MVP) |
|---|---|---|
| G1 | Cut time from "open app" to "reviewing scored matches" | First scan surfaces scored matches in **< 5 min** on a 3-site list **[A1]** |
| G2 | Make fit assessment explainable, not a black box | 100% of scores show a per-factor breakdown (skills/experience/location/salary) that sums to the displayed score |
| G3 | Reduce per-application tailoring effort | Tailored CV + cover-letter draft produced in **< 60 s** p50 / **< 120 s** p95 per job **[A2]** |
| G4 | Keep the user in control of their data | Zero personal data leaves device except user-initiated scrapes, opted-in LLM calls, and user-chosen backups — verifiable in an egress audit |
| G5 | Track the funnel end-to-end | 100% of applications created in-app carry a status and timestamped history; dashboard shows applied→interview→offer counts |
| G6 | Run on the three desktop OSes | Signed, launchable builds for **macOS, Windows, Linux** from one codebase |

### 2.2 Non-goals (explicit, v1)
- **No accounts, no login, no cloud backend, no sync.** The app is single-user, single-device, offline-first. Multi-device sync is out of scope. (The existing `Schema.ddl`/`DomainModel.mmd` auth-and-roles boilerplate does **not** apply to this product and is superseded by §8.) **[A3]**
- **No auto-apply / auto-submit.** Star drafts and tracks; the human reviews and submits every application. (Reduces ToS and accuracy risk — see §13.)
- **No bypassing of logins, paywalls, CAPTCHAs, or anti-bot measures.** Star scans **public** listings only; authenticated/gated boards are out of scope for automated scanning in v1.
- **No mobile or web build.** Desktop (Electron) only.
- **No in-app job posting, recruiter, or messaging features.** Star does not contact employers.
- **No hosting of the LLM.** Inference is the user's OpenRouter account; Star ships no bundled model and no Star-operated inference endpoint.
- **No interview prep, salary negotiation, or networking tooling** in v1 (candidate fast-follows, §12).
- **No team/multi-profile management.** One profile per installation. **[A4]**

---

## 3. Target users & key personas

### 3.1 Primary persona — "The Active Seeker"
- **Profile:** Mid-career knowledge worker (e.g. software, marketing, ops), currently employed or recently exited, running a focused 2–8 week search.
- **Context:** Checks 3–6 boards repeatedly; maintains a CV they tweak per role; tracks applications in a spreadsheet or not at all.
- **Jobs-to-be-done:**
  - *When* I sit down to job-hunt, *I want* fresh, relevant listings already gathered and ranked, *so I can* spend my time deciding, not searching.
  - *When* I find a promising role, *I want* a CV and cover letter already tailored to it, *so I can* apply quickly without starting from scratch.
  - *When* I have applied to many roles, *I want* to see what's where in the pipeline, *so I can* follow up and not double-apply.
- **Tech comfort:** Medium-high. Comfortable installing a desktop app and pasting an API key when told why.

### 3.2 Secondary persona — "The Privacy-Conscious Switcher"
- **Profile:** Senior/confidential job-seeker who will **not** upload their CV to a SaaS career site while still employed.
- **JTBD:** *When* I explore the market quietly, *I want* tooling that keeps my CV and searches on my own machine, *so I can* avoid exposure to my current employer or third parties.
- **Why they pick Star:** local-only storage and bring-your-own LLM key are the deciding features.

### 3.3 Secondary persona — "The Returning / Career-Changer"
- **Profile:** Re-entering work or changing fields; unsure how well their CV maps to target roles.
- **JTBD:** *When* I look at a role outside my obvious lane, *I want* to see exactly which factors help or hurt my fit, *so I can* decide whether to apply and what to emphasise. The **explainable star breakdown** is the hook.

### 3.4 Anti-personas (who this is **not** for)
- Recruiters / sourcers (Star represents one candidate, not a pipeline of others).
- Users wanting fully automated mass-apply / spray-and-pray (explicit non-goal).
- Users on boards that require login/anti-bot to view listings (out of scope for automated scan).

---

## 4. User stories (by epic, with acceptance criteria)

> Stories use `As a seeker, I want …, so that …`. Acceptance criteria (AC) are objectively testable. IDs map to functional requirements in §5.

### Epic A — Onboarding *(screen: `docs/Mockups/10-onboarding.png`, route `/onboarding`)*
- **A1 — Upload CV.** *I want to upload my CV on first run so the app can score jobs against it.*
  - AC: Drag-drop or file-picker accepts PDF/DOCX; on success the parsed profile preview is shown; failure shows an actionable error and lets me retry or enter details manually.
- **A2 — Review parsed profile.** *I want to confirm/correct what was parsed so scoring uses accurate data.*
  - AC: Editable fields for name, target role, skills, experience, location, work mode, salary; changes persist; I can proceed only after the minimum required fields (§5.2 FR-PROF-002) are set.
- **A3 — Connect AI.** *I want to paste my OpenRouter key and pick a model so tailoring works.*
  - AC: Key field with Show/Hide and **Test connection**; a successful test enables Continue; I can skip and add it later (tailoring stays disabled until provided).
- **A4 — Set preferences.** *I want to set scan sites, cadence, and backup folder before first scan.*
  - AC: Onboarding completes only when required prefs are set; finishing lands me on the Dashboard and a first scan can be triggered. The 4-step stepper matches the scaffold (`onbStep` 1–4).

### Epic B — Scanning & scoring *(screens: Dashboard `01`, Discover `02`)*
- **B1 — Run a scan.** *I want to scan my job sites so I get fresh listings.*
  - AC: Scan visits each enabled site; per-site progress shows state `queued|running|done` with a count (matches `ScanSource`); partial failure of one site does not abort the others.
- **B2 — See scored results.** *I want each listing scored 1–5 stars so I can prioritise.*
  - AC: Every scraped listing receives a star score (1–5, fractional rendering via `StarRating.vue`) and a one-line `why`; results are sortable by score.
- **B3 — Understand a score.** *I want a breakdown so I trust the score.*
  - AC: Job detail (`04`) shows per-factor contributions (skills, experience, location, salary) using `ScoreBar.vue`; the factors reconcile to the displayed star score and % (§5.4).
- **B4 — Scheduled scans.** *I want scans to run on a cadence so matches stay fresh.*
  - AC: A configured cadence triggers background scans; the Dashboard shows an "overnight scan summary"; a notification (if enabled) reports new strong matches.

### Epic C — Matches / Starred *(screen: Starred `03`)*
- **C1 — Browse strong matches.** AC: Starred grid shows match tiles (role, company, location, salary, score, tag, why) for visible matches; layout per mockup `03`.
- **C2 — Dismiss a match.** *I want to mark a job Not interested so it stops cluttering my list.*
  - AC: Dismiss removes the tile immediately; dismissed jobs are suppressed from future surfacing; a **Restore N hidden** affordance reverses it (mirrors store `dismissed`/`resetDismissed`).
- **C3 — Open a job.** AC: Selecting a tile opens Job detail (`04`) with the full posting and score breakdown.

### Epic D — Tailoring *(screens: Tailoring CV `05`, Cover letter `06`, route `/tailor`)*
- **D1 — Generate tailored CV.** *I want an LLM-tailored CV for a specific job.*
  - AC: From a job, "Tailor" produces a CV draft with AI-highlighted edits diffed against my base CV; requires a valid OpenRouter key.
- **D2 — Generate cover letter.** AC: A cover-letter tab produces a draft referencing the role/company; editable in-app.
- **D3 — Accept/dismiss suggestions.** *I want to apply suggestions that raise my score.*
  - AC: Each suggestion card (`Suggestion`: `Keyword|Reword|Surface gap`, with a `gain`) can be accepted or dismissed; accepting updates the draft and **recomputes the match score**, which is reflected live.
- **D4 — Export/use the draft.** AC: I can copy or export the tailored CV and letter to use in the employer's own application flow (Star never submits for me).

### Epic E — Applications *(screen: Applications `07`)*
- **E1 — Save/track an application.** AC: From a job I can create an application; it appears in the history table with status, score, applied date, updated date (matches `Application` type).
- **E2 — Advance status.** *I want to move an application through the pipeline.*
  - AC: Status transitions Saved→Applied→Interviewing→Offer/Rejected; each change stamps `updated`; status pills use `STATUS_PILL` colours.
- **E3 — Filter & review funnel.** AC: Working filter (All/Applied/Interviewing/Offer per scaffold) filters the table; basic funnel counts shown on Dashboard.

### Epic F — Profile *(screen: Profile `08`)*
- **F1 — Maintain CV & links.** AC: Re-upload CV; edit LinkedIn URL and personal/portfolio links; a profile-strength rail reflects completeness.
- **F2 — Edit preferences.** AC: Target role, salary, location, work mode (Remote/Hybrid/On-site toggle, store `workMode`) editable; changes re-score future scans.

### Epic G — Settings / LLM *(screen: Settings `09`)*
- **G1 — Manage OpenRouter key & model.** AC: Show/Hide + Test connection; select model from a list; key stored securely (§6, §7).
- **G2 — Manage job sites.** AC: Add/remove sites (URL normalised, store `addSite`/`removeSite`); the list is the source of truth for scanning.
- **G3 — Manage scan cadence & notifications.** AC: Set frequency and toggle notifications.
- **G4 — Configure backup.** AC: Choose backup folder; toggle auto-backup (store `backupFolder`/`autoBackup`).

### Epic H — Backup
- **H1 — Auto-backup.** AC: When enabled, app writes a backup after defined triggers (§5.9) to the chosen folder.
- **H2 — Restore.** AC: User can restore app state from a backup file; restore is confirmed and non-destructive until confirmed.

---

## 5. Functional requirements

> Numbered, testable. **Priority:** M = MVP must-have, F = fast-follow, L = later. Each FR is verifiable by a single observable behaviour.

### 5.1 CV parsing
| ID | Pri | Requirement |
|---|---|---|
| FR-CV-001 | M | Accept CV uploads in **PDF and DOCX**; reject other types with a clear message. **[A5]** |
| FR-CV-002 | M | Extract text and derive structured fields: name, contact, target/most-recent role, skills (list), employment history (title, org, dates), education, total years experience, location. |
| FR-CV-003 | M | Parsing runs **locally** (no upload). Parser executes off the UI thread (§7). |
| FR-CV-004 | M | On low-confidence or partial parse, surface every uncertain field flagged for user confirmation rather than silently guessing. |
| FR-CV-005 | M | On parse failure, allow the user to (a) retry, (b) re-upload a different file, or (c) enter the profile manually. No dead-ends. |
| FR-CV-006 | F | Re-uploading a CV creates a new `CV` record (versioned) and re-derives the profile; prior tailored drafts retain the CV version they were built from. |
| FR-CV-007 | L | Optional LLM-assisted parse (uses OpenRouter) to improve extraction quality, **off by default** and clearly labelled as sending CV text to the model. |

### 5.2 Profile model
| ID | Pri | Requirement |
|---|---|---|
| FR-PROF-001 | M | Maintain a single editable Profile: target role(s), skills, years experience, location, work mode (Remote/Hybrid/On-site), salary expectation (min, currency), LinkedIn URL, personal/portfolio URLs. |
| FR-PROF-002 | M | **Minimum scorable profile** = target role + ≥1 skill + location + work mode. Scanning/scoring is blocked until met; the UI states what's missing. **[A6]** |
| FR-PROF-003 | M | Editing any scoring-relevant field marks existing scores **stale** and re-scores on next scan (or offers immediate re-score). |
| FR-PROF-004 | M | Profile-strength indicator (Profile screen rail) computed from field completeness; expose the rubric. |
| FR-PROF-005 | F | Support multiple target roles with independent scoring weights. |

### 5.3 Embedded-browser scanning
| ID | Pri | Requirement |
|---|---|---|
| FR-SCAN-001 | M | Scan an editable list of job sites (store `sites`; default `rolehub.com`, `workscout.io`, `talentstream.com` are **placeholders** — real defaults TBD §13). Each site is the source of truth for what the embedded browser opens. **[A7]** |
| FR-SCAN-002 | M | Scanning uses an embedded browser surface (Electron `BrowserView`/`<webview>`, §7) to load **public** listing pages and extract listings via a **per-site adapter**. |
| FR-SCAN-003 | M | Each adapter declares: search-URL template (role/location/work-mode params), listing-selector map, and pagination strategy. Adapters are isolated so one site's breakage cannot crash the scan (FR-SCAN-008). |
| FR-SCAN-004 | M | Per listing, capture: title, company, location, work mode, salary (if present), posting URL, source site, scraped-at timestamp, and a content hash for dedup. |
| FR-SCAN-005 | M | **Deduplicate** listings across sites by `(normalised title + company + location)` and by content hash; the same role from two boards collapses to one match with both source links. |
| FR-SCAN-006 | M | Respect each site's **`robots.txt`** and apply **rate limiting / polite delays** between requests; expose per-site request pacing in config. **ToS-sensitive — see §13 risk R1.** **[A8]** |
| FR-SCAN-007 | M | Surface live progress per site as `ScanSource { name, count, progress 0–100, state: queued|running|done }` (Dashboard/Discover). |
| FR-SCAN-008 | M | If a site fails (timeout, layout change, block), mark that source `error` and continue others; record a per-site failure reason for diagnostics (§10). |
| FR-SCAN-009 | M | **Scheduling:** support manual scan and a configurable cadence (e.g. off / hourly / daily / on-app-launch). Scheduled scans run in the background and produce the Dashboard "overnight scan summary". **[A9]** |
| FR-SCAN-010 | M | Detect login walls / CAPTCHAs / anti-bot interstitials and **stop** for that site, reporting a clear state — never attempt to bypass (non-goal). |
| FR-SCAN-011 | F | Incremental scans: only surface listings not seen in prior scans ("new since last scan"). |
| FR-SCAN-012 | F | Allow the user to scan from the Discover screen with ad-hoc role/location/site controls (per mockup `02`). |

### 5.4 Scoring algorithm (the 1–5 star motif)
| ID | Pri | Requirement |
|---|---|---|
| FR-SCORE-001 | M | Every listing receives a composite match score derived from four factors: **Skills, Experience, Location/Type, Salary**. |
| FR-SCORE-002 | M | Each factor yields a normalised sub-score in `[0,1]`. Composite `S = Σ(wᵢ · factorᵢ)`, with weights summing to 1. **Default weights:** Skills **0.45**, Experience **0.25**, Location/Type **0.20**, Salary **0.10**. **[A10]** |
| FR-SCORE-003 | M | **Star derivation:** percentage `P = round(S · 100)`; stars `= clamp(round(S · 5 · 2) / 2, 1, 5)` (half-star granularity for `StarRating.vue`). Both the star value and `P%` are displayed. **[A11]** |
| FR-SCORE-004 | M | **Skills factor:** proportion of the job's required/desired skills matched by the profile (synonym/alias-aware), weighting required > desired. |
| FR-SCORE-005 | M | **Experience factor:** fit of profile years/seniority to the role's stated level (penalise both under- and over-qualification, asymmetrically). |
| FR-SCORE-006 | M | **Location/Type factor:** alignment of work mode (Remote/Hybrid/On-site) and geography to the profile's preference; remote-eligible roles score location-neutral. |
| FR-SCORE-007 | M | **Salary factor:** fit of advertised salary (when present) to profile expectation. When salary is **absent**, the factor is marked *unknown* and excluded from the weighted sum with weights renormalised — never silently scored 0. **[A12]** |
| FR-SCORE-008 | M | **Explainability:** Job detail shows each factor's sub-score and weighted contribution (via `ScoreBar.vue`) plus a one-line `why`; the contributions reconcile to the displayed star/%. No hidden factors. |
| FR-SCORE-009 | M | Scoring is **deterministic** for a given (listing, profile, weights) — i.e. computed in-app, not by the LLM — so the same inputs always yield the same score. **[A13]** |
| FR-SCORE-010 | M | A `tag` label (e.g. "Strong skills match", "Salary below target") is generated from the dominant/weakest factor for the match tile (`Match.tag`). |
| FR-SCORE-011 | F | User-adjustable factor weights in Settings, with live re-score and a "reset to defaults" control. |

### 5.5 Starring & "Not interested" suppression
| ID | Pri | Requirement |
|---|---|---|
| FR-STAR-001 | M | Listings at/above a **starred threshold** (default ≥ 4 stars **[A14]**) appear on the Starred screen as match tiles. |
| FR-STAR-002 | M | "Not interested" dismiss hides a match immediately and **persists** the dismissal (store `dismissed`); dismissed jobs are excluded from Starred and future surfacing. |
| FR-STAR-003 | M | A **Restore N hidden** action un-dismisses (mirrors `resetDismissed`); dismissals survive app restart. |
| FR-STAR-004 | F | Dismissing offers an optional reason (e.g. wrong location, salary, seniority) to feed future filtering. |

### 5.6 LLM tailoring (OpenRouter)
| ID | Pri | Requirement |
|---|---|---|
| FR-LLM-001 | M | Generate a **tailored CV** for a chosen job: prompt composed of base CV text + job description + profile; output is an edited CV with changes **diff-highlighted** against the base (mockup `05`). |
| FR-LLM-002 | M | Generate a **cover letter** referencing the specific role and company (mockup `06`), editable in-app. |
| FR-LLM-003 | M | Produce discrete **suggestions** typed `Keyword | Reword | Surface gap`, each with an estimated `gain` and target text (`Suggestion`). |
| FR-LLM-004 | M | **Accept** applies a suggestion to the working draft; **Dismiss** discards it. Both are reversible within the session. |
| FR-LLM-005 | M | Accepting a suggestion **recomputes the match score** (via §5.4, since accepted keywords/skills change the Skills factor inputs) and reflects the new star/% live. The recompute uses the deterministic scorer, not the LLM. **[A15]** |
| FR-LLM-006 | M | All LLM calls go through **OpenRouter** using the user's key and selected model; requests time out with a retry affordance; failures degrade gracefully (§10) and never block non-LLM features. |
| FR-LLM-007 | M | Before the first LLM call, the user is told **what data is sent** (CV text + job description) and to which provider; tailoring is disabled until a key is present and tested. |
| FR-LLM-008 | F | Show per-request token/cost estimate (from OpenRouter usage) so the user can manage spend. |
| FR-LLM-009 | F | Let the user choose tailoring "intensity" (light touch vs aggressive rewrite). |

### 5.7 Applications tracking
| ID | Pri | Requirement |
|---|---|---|
| FR-APP-001 | M | Create an application from a job; record role, company, location, match score, applied date, status, updated date (`Application`). |
| FR-APP-002 | M | Status lifecycle: **Saved → Applied → Interviewing → Offer / Rejected**; any forward/backward transition allowed, each stamps `updated` and appends to a status history. **[A16]** |
| FR-APP-003 | M | Status rendered as pills using `STATUS_PILL` colours; Applications screen filter (All/Applied/Interviewing/Offer) works as in the scaffold. |
| FR-APP-004 | M | Prevent duplicate applications for the same listing; if one exists, deep-link to it instead of creating a second. |
| FR-APP-005 | M | Dashboard shows basic **funnel stats** (counts per status; applied→interview→offer conversion). |
| FR-APP-006 | F | Per-application notes and follow-up reminder date. |

### 5.8 Settings
| ID | Pri | Requirement |
|---|---|---|
| FR-SET-001 | M | **OpenRouter key:** masked field with Show/Hide and **Test connection**; key stored via OS-secure storage (§7), never in plaintext renderer state or backups (§6). |
| FR-SET-002 | M | **Model selector:** choose the OpenRouter model used for tailoring; persist the choice. **[A17]** |
| FR-SET-003 | M | **Job sites CRUD:** add (URL normalised — strip scheme/trailing slash per store `addSite`) and remove sites; list persists and drives scanning. |
| FR-SET-004 | M | **Scan cadence:** off / on-launch / hourly / daily (or custom); persists and schedules background scans. |
| FR-SET-005 | M | **Notifications:** toggle OS notifications for completed scans / new strong matches. |
| FR-SET-006 | M | **Backup folder:** choose a folder (native picker); toggle auto-backup (`backupFolder`, `autoBackup`). |
| FR-SET-007 | M | All settings persist locally and survive restart; provide a "reset to defaults" per group. |

### 5.9 Backup
| ID | Pri | Requirement |
|---|---|---|
| FR-BAK-001 | M | A backup bundles: profile, CV file(s), job listings, match scores, applications + history, suggestions, sites, and settings — **excluding the OpenRouter key** (which lives only in OS-secure storage). **[A18]** |
| FR-BAK-002 | M | Backups are written to the user-chosen folder as a single portable file (e.g. timestamped archive). |
| FR-BAK-003 | M | **Auto-backup triggers (when enabled):** after each completed scan and after any application status change. Coalesce rapid triggers to avoid churn. **[A19]** |
| FR-BAK-004 | M | **Restore** reads a backup file, previews its contents/date, and on confirmation replaces current state; current state is itself backed up immediately before restore (safe, reversible). |
| FR-BAK-005 | M | If the backup folder is missing/unwritable, surface a non-blocking warning and keep the app fully functional (§10). |
| FR-BAK-006 | F | Optional backup **encryption** with a user passphrase (see §6 open decision). |

---

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance — scan throughput** | NFR-P1: A 3-site scan completes within **5 min** under normal network conditions **[A1]**. NFR-P2: Scoring throughput ≥ **50 listings/sec** (deterministic, local). NFR-P3: UI stays responsive (no main-thread block > 100 ms) during scan/parse — heavy work off-thread (§7). |
| **Performance — tailoring** | NFR-P4: LLM tailoring p50 < 60 s, p95 < 120 s **[A2]** (network/model dependent; show progress, never freeze UI). |
| **Reliability** | NFR-R1: A single site's failure never aborts a scan (FR-SCAN-008). NFR-R2: App state is persisted transactionally; a crash mid-scan loses at most the in-flight scan, not stored data. NFR-R3: Scheduled scans recover after sleep/wake and missed windows. |
| **Offline behaviour** | NFR-O1: All non-network features (browse stored matches, view breakdowns, edit profile, manage applications, restore backup) work fully **offline**. NFR-O2: Scanning and tailoring require network and fail gracefully when absent (clear state, no crash). |
| **Security & privacy** | NFR-S1: **Local-only** storage of CV, profile, listings, applications. NFR-S2: OpenRouter key stored via OS-secure storage (Electron `safeStorage`/Keychain/DPAPI/libsecret), **never** in renderer state, logs, or backups. NFR-S3: No telemetry by default; any analytics is **local-only** (§11) unless the user explicitly opts into sharing. NFR-S4: Renderer runs with `contextIsolation: true`, `nodeIntegration: false`; native capabilities exposed only via a vetted preload bridge (CV picker, backup folder, key store — per scaffold `electron-preload`). NFR-S5: The only outbound network is (a) user-configured job sites during scans and (b) OpenRouter during tailoring; document and make auditable. NFR-S6 *(decision, §13)*: whether backups are encrypted at rest. |
| **Accessibility** | NFR-A1: Keyboard-navigable across all screens; visible focus. NFR-A2: Star score and status are **not conveyed by colour alone** — always paired with the numeric score/% and a text label (critical: the star motif and `STATUS_PILL` are colour-coded). NFR-A3: Target WCAG 2.1 **AA** contrast; verify Studio palette (terracotta on cream) meets AA for text. **[A20]** NFR-A4: Respect OS reduced-motion for scan-bar animations. |
| **Cross-platform** | NFR-X1: One codebase builds signed apps for **macOS, Windows, Linux**. NFR-X2: Native integrations (file picker, secure storage, notifications, folder access) work on all three. NFR-X3: Layout targets the design's native **1280-wide** window (per scaffold) and degrades gracefully when resized. |
| **Maintainability** | NFR-M1: Per-site scrapers are pluggable adapters conforming to one interface; adding a site is a config + adapter change, not a core change. NFR-M2: TypeScript strict mode (per scaffold); deterministic scorer is unit-tested against fixtures. |

---

## 7. System architecture

> Electron desktop app. Two-process model with a strict security boundary; all personal data and compute local; only scrapes and LLM calls leave the device.

```
┌──────────────────────────── Electron MAIN process (Node) ────────────────────────────┐
│  App lifecycle · window mgmt (1320×880, hiddenInset titlebar — per scaffold)          │
│  ┌─────────────┐ ┌──────────────┐ ┌─────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │ Scan         │ │ Scoring      │ │ CV Parser   │ │ LLM Gateway  │ │ Backup Writer │  │
│  │ Orchestrator │ │ Engine       │ │ (off-thread │ │ (OpenRouter  │ │ (fs to chosen │  │
│  │ + Scheduler  │ │ (determ.)    │ │  worker)    │ │  client)     │ │  folder)      │  │
│  └─────┬───────┘ └──────┬───────┘ └─────┬───────┘ └──────┬───────┘ └───────┬───────┘  │
│        │ drives         │ reads/writes  │               │ HTTPS            │           │
│  ┌─────▼────────────────▼───────────────▼───────────────▼──────────────────▼───────┐  │
│  │ Local data store — SQLite (better-sqlite3) [A21]  ·  OS-secure store (key)       │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
│        │ owns the embedded browser surface                                             │
│  ┌─────▼───────────────────────────────────────────┐                                   │
│  │ Embedded scan browser — BrowserView / <webview>  │── HTTPS ──▶ public job sites      │
│  │ partitioned session, per-site adapter injects    │            (robots/rate-limited)  │
│  │ extraction; isolated from app renderer            │                                   │
│  └───────────────────────────────────────────────────┘                                   │
└────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ IPC (contextBridge preload — vetted channels only: CV picker, backup folder, key store)
┌───────┴──────────────────── Electron RENDERER (Vue 3 + Quasar) ───────────────────────┐
│  Pinia store (app-store.ts) · Vue Router (hash history) · pages/ components/            │
│  StarRating · ScoreBar · StatusPill · MainLayout (Studio theme)                         │
│  contextIsolation:true · nodeIntegration:false                                          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Process responsibilities
- **Renderer (Vue 3 + Quasar):** all UI per the design handoff. Holds **no secrets** and performs **no direct network/file access** — it calls main via the preload bridge. Pinia store mirrors current scaffold state and is hydrated from the data store.
- **Main (Node):** owns data, secrets, network, scheduling, and the embedded scan browser.
  - **Scan Orchestrator + Scheduler:** opens the embedded browser per enabled site, runs the adapter, enforces robots/rate limits, emits `ScanSource` progress over IPC, persists listings. Scheduler triggers cadence-based scans (FR-SCAN-009).
  - **Scoring Engine:** pure, deterministic; consumes (listing, profile, weights) → factor sub-scores + composite + star/% (§5.4). Unit-tested.
  - **CV Parser:** runs in a worker thread / utility process so parsing never blocks UI (FR-CV-003).
  - **LLM Gateway:** the **only** path to OpenRouter; injects key from secure store at call time (key never reaches renderer); handles timeouts/retries; returns drafts + suggestions.
  - **Backup Writer:** serialises state (minus key) to the chosen folder; honours triggers and coalescing.
- **Embedded scan browser:** Electron `BrowserView` or `<webview>` in a **partitioned session** isolated from the app UI, so site cookies/JS cannot touch app state. Adapters run extraction in that context and return structured listings to the orchestrator. **[A22]**

### 7.2 Data store
- **SQLite via `better-sqlite3` in the main process** for structured data (listings, scores, applications, suggestions, sites, settings, profile metadata), chosen for transactional integrity, fast local queries, and easy single-file backup. **[A21]** CV binaries stored as files in app data with paths referenced from SQLite. IndexedDB is a renderer-only alternative considered and rejected (secrets/compute belong in main).
- **OS-secure store** (`safeStorage` → Keychain / DPAPI / libsecret) holds **only** the OpenRouter key.

### 7.3 Trust & egress boundary
The renderer is untrusted with secrets; main mediates everything. **Exactly two egress paths** exist and are auditable (NFR-S5): the embedded browser → user-listed job sites, and the LLM Gateway → OpenRouter. No analytics/telemetry endpoint in v1.

---

## 8. Data model

> Local SQLite. The scaffold's `src/types/models.ts` are **view models** (UI-shaped, abbreviated: `mono`, `co`, `loc`). The persistence model below is the normalised source; view models are projections. Keys are app-generated UUIDs unless noted. (Supersedes the generic `Schema.ddl`/`DomainModel.mmd`.)

### 8.1 Entities & relationships
```
Profile (1) ──< CV (versions)
Profile (1) ──< TargetRole            Site (1) ──< JobListing
JobListing (1) ── (1) MatchScore ──< MatchFactor (4: skills/exp/loc/salary)
JobListing (1) ──< Application ──< ApplicationEvent (status history)
Application (1) ──< TailorDraft (cv|letter) ──< Suggestion
Settings (singleton)
```

### 8.2 Tables (fields → notes)
| Entity | Key fields | Notes |
|---|---|---|
| **Profile** *(singleton)* | id, name, targetRole, yearsExperience, location, workMode(`Remote\|Hybrid\|On-site`), salaryMin, salaryCurrency, linkedinUrl, links[], skills[], strengthScore, updatedAt | One per install (non-goal: multi-profile). `workMode` mirrors store. |
| **CV** | id, profileId→Profile, fileName, mime(`pdf\|docx`), storagePath, parsedText, parsedFields(JSON), version, confidence, uploadedAt | Versioned (FR-CV-006); binary on disk, metadata here. |
| **TargetRole** *(F)* | id, profileId→Profile, title, weightOverrides(JSON) | Multi-role (fast-follow). |
| **Site** | id, host, searchUrlTemplate, adapterId, enabled, ratePolicy(JSON), addedAt | Source of truth for scanning (store `sites`). |
| **JobListing** | id, siteId→Site, sourceUrl, title, company, location, workMode, salaryRaw, salaryParsed(min/max/currency), descriptionText, contentHash, scrapedAt, dedupKey | `dedupKey`=norm(title+company+location) (FR-SCAN-005). May reference multiple source URLs after dedup merge. |
| **MatchScore** | id, listingId→JobListing(1:1), profileId, composite(0–1), percent, stars(1–5, .5 step), tag, why, weightsUsed(JSON), stale(bool), computedAt | Deterministic; `stale` set on profile change (FR-PROF-003). |
| **MatchFactor** | id, scoreId→MatchScore, kind(`skills\|experience\|location\|salary`), subScore(0–1\|null), weight, contribution, detail(JSON) | `subScore` null = unknown/excluded (FR-SCORE-007). Powers `ScoreBar`. |
| **Application** | id, listingId→JobListing, role, company, location, score, status(`AppStatus`), appliedAt, updatedAt | Mirrors `Application` view model. One per listing (FR-APP-004). |
| **ApplicationEvent** | id, applicationId→Application, fromStatus, toStatus, note, at | Status history (FR-APP-002). |
| **TailorDraft** | id, applicationId→Application, cvVersion→CV, type(`cv\|letter`), modelUsed, baseText, draftText, createdAt | One per type per application; pins CV version. |
| **Suggestion** | id, draftId→TailorDraft, kind(`Keyword\|Reword\|Surface gap`), gain, text, status(`proposed\|accepted\|dismissed`) | Mirrors `Suggestion` view model. |
| **Settings** *(singleton)* | id, modelId, scanCadence, notificationsEnabled, backupFolder, autoBackup, starredThreshold, factorWeights(JSON) | OpenRouter **key NOT here** — OS-secure store only. Mirrors store prefs. |
| **DismissedMatch** | id, listingId→JobListing, reason?, at | "Not interested" suppression (store `dismissed`); survives restart. |

### 8.3 Notes
- **The OpenRouter key is not an entity** in this model — it lives solely in OS-secure storage and is excluded from backups (FR-BAK-001, NFR-S2).
- `MatchScore` + `MatchFactor` are the persisted form of the explainable breakdown; the four `MatchFactor` rows reconcile to `composite`/`percent`/`stars`.

---

## 9. Key flows

### 9.1 Onboarding (first run) — `/onboarding`, mockup `10`
1. Launch → no profile detected → onboarding stepper (`onbStep` 1).
2. **Upload CV** (FR-CV-001) → parse off-thread → preview parsed fields.
3. **Review profile** (FR-PROF-001/002) → correct fields → minimum-scorable check passes.
4. **Connect AI** → paste OpenRouter key → **Test connection** (FR-SET-001) → success enables Continue (skippable).
5. **Preferences** → sites, cadence, backup folder → Finish → land on Dashboard; offer "Run first scan".

### 9.2 Scan-to-star cycle — Dashboard `01` / Discover `02` / Starred `03`
1. User (or scheduler, FR-SCAN-009) triggers scan.
2. Orchestrator opens embedded browser per enabled site; adapters extract listings, respecting robots/rate limits; progress streams as `ScanSource` (FR-SCAN-007).
3. Listings deduped (FR-SCAN-005) and persisted.
4. Scoring Engine scores each (§5.4): factors → composite → stars/% → `tag`/`why`.
5. Matches ≥ threshold appear on Starred as tiles (FR-STAR-001); Dashboard shows summary + funnel.

### 9.3 Tailor-and-apply — Job detail `04` → Tailor `05`/`06` → Applications `07`
1. Open a match → Job detail shows posting + breakdown (`ScoreBar`, FR-SCORE-008).
2. "Tailor" → LLM Gateway drafts CV (`05`) + cover letter (`06`) with highlighted edits + suggestion cards.
3. User **accepts** suggestions → draft updates → **match score recomputes live** (FR-LLM-005).
4. User exports/copies the tailored docs and applies **on the employer's site** (Star never submits).
5. User creates an Application (FR-APP-001) → status Saved/Applied; appears in Applications history.

### 9.4 Dismiss a match — Starred `03`
1. User clicks "Not interested" on a tile → tile removed immediately, `DismissedMatch` persisted (FR-STAR-002).
2. "Restore N hidden" reverses all dismissals (FR-STAR-003).

### 9.5 Change job sites — Settings `09`
1. Add site → URL normalised, persisted (FR-SET-003) → included in next scan.
2. Remove site → excluded from future scans; its existing listings retained unless purged.

### 9.6 Restore a backup — Settings `09`
1. Choose "Restore" → pick backup file → preview contents/date (FR-BAK-004).
2. Confirm → current state auto-backed-up first → state replaced → app reloads from restored data. (Key is untouched — it never leaves OS-secure storage.)

---

## 10. Edge cases & error states

| Scenario | Behaviour |
|---|---|
| **Site layout changed / selectors break** | Adapter yields 0/garbage → mark source `error` with reason "layout changed"; continue other sites; flag adapter for update; never crash scan (FR-SCAN-008). |
| **CAPTCHA / login wall / anti-bot** | Detect and **stop** that site; report "requires sign-in / blocked"; do not attempt bypass (non-goal, FR-SCAN-010). |
| **Rate-limited / 429 / IP block** | Back off per `ratePolicy`; if persistent, pause that site and surface "slowing down to respect the site"; recommend longer cadence. |
| **No / invalid OpenRouter key** | Tailoring entry points disabled with inline "Add an AI key in Settings"; Test connection returns a clear invalid-key message; scanning/scoring unaffected (they don't need the LLM). |
| **OpenRouter error / timeout / quota** | Show retriable error with the provider message; preserve any partial draft; never freeze UI (FR-LLM-006). |
| **CV parse failure / unsupported file** | Reject unsupported types with reason; on partial parse, flag uncertain fields; offer retry/different file/manual entry (FR-CV-004/005). |
| **Empty match list** | Starred shows an empty state explaining why (no listings ≥ threshold / profile too narrow / sites returned nothing) with next actions (lower threshold, broaden profile, add sites) — not a blank screen. |
| **Salary absent on listing** | Salary factor = *unknown*, excluded with weight renormalised; breakdown labels it "not stated" (FR-SCORE-007) — never penalised silently. |
| **Backup folder missing/unwritable/full** | Non-blocking warning; auto-backup paused; app stays fully functional; prompt to re-choose folder (FR-BAK-005). |
| **Duplicate application** | Block second creation; deep-link to existing (FR-APP-004). |
| **Profile changed after scoring** | Scores marked `stale`; UI badges "scores out of date"; re-score on next scan or on demand (FR-PROF-003). |
| **Network offline** | Stored data fully usable; scan/tailor show "you're offline" and disable cleanly (NFR-O1/O2). |
| **Scheduled scan during sleep / app closed** | On wake/launch, run missed scan per policy; don't stack duplicates (NFR-R3). |
| **Same job on multiple boards** | Collapsed to one match with multiple source links (FR-SCAN-005). |

---

## 11. Analytics & success metrics

> **Privacy stance:** analytics are **local-only** by default (NFR-S3) — computed on-device to drive the Dashboard funnel and the user's own insight. No event leaves the device unless the user explicitly opts into anonymous product analytics (decision, §13). Targets below are product north-stars regardless of where measured.

### 11.1 Activation & funnel metrics
| Stage | Metric | MVP target |
|---|---|---|
| Activation | % of installs that complete onboarding (CV uploaded **and** profile minimum met) | ≥ 70% **[A23]** |
| Activation | % that connect a valid OpenRouter key | ≥ 50% |
| First value | % that complete a first scan with ≥1 scored match | ≥ 65% |
| Engagement | % that review (open detail on) ≥1 match | ≥ 60% |
| Engagement | Matches reviewed per active week | ≥ 10 |
| Conversion | % that create ≥1 application in-app | ≥ 40% |
| Conversion | % that use LLM tailoring on ≥1 job | ≥ 35% |
| Outcome | Applications → interview rate (per user funnel) | tracked (no fixed target v1) **[A24]** |
| Outcome | Interview → offer rate | tracked |
| Quality | Match false-positive rate (user dismisses a ≥4-star match) | < 15% **[A25]** |
| Reliability | Scan success rate (sites returning listings without error) | ≥ 90% |

### 11.2 North star
**Applications created from in-app strong matches per active user per week** — captures the full search→score→tailor→apply loop working as intended.

---

## 12. Milestones / phased rollout

| Phase | Theme | Scope |
|---|---|---|
| **MVP** | The core loop, local & transparent | Onboarding (CV upload + parse, profile, key + test, prefs); embedded-browser scan of configurable sites with per-site adapters, robots/rate limits, dedup; deterministic 1–5 star scoring with explainable breakdown; Starred + Not-interested suppression; LLM tailoring (CV + cover letter, suggestions, live score recompute); Applications tracking + funnel; Settings (key/model, sites CRUD, cadence, notifications, backup folder); auto-backup + restore; macOS/Windows/Linux signed builds. *(All FRs marked **M**.)* |
| **Fast-follow (V1.1)** | Sharper & cheaper | Incremental "new since last scan" (FR-SCAN-011); Discover ad-hoc controls (FR-SCAN-012); user-adjustable factor weights (FR-SCORE-011); dismiss reasons (FR-STAR-004); token/cost estimate + tailoring intensity (FR-LLM-008/009); multi target-role (FR-PROF-005); application notes/reminders (FR-APP-006); backup encryption (FR-BAK-006); LLM-assisted CV parse, opt-in (FR-CV-007). |
| **Later (V2)** | Beyond the core | Additional curated site adapters; interview-prep and follow-up tooling; richer outcome analytics; optional anonymous product analytics (opt-in); deeper diff/version history for CVs. *(All explicit non-goals in §2.2 remain out of scope unless re-scoped.)* |

> Dependencies: scoring (§5.4) gates Starred and tailoring's live recompute; LLM Gateway gates all of Epic D; backup writer gates restore. Per-site adapter framework (FR-SCAN-003) is the long pole and should start first.

---

## 13. Open questions & risks

### 13.1 Open questions (need a decision before/at build)
| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Which **real** job sites ship as default adapters? (`rolehub/workscout/talentstream` are placeholders.) Depends on Q3 ToS review. | PM + Legal | Before MVP scan build |
| Q2 | Are backups **encrypted at rest** (passphrase), or plaintext local files? (NFR-S6 / FR-BAK-006) | Eng + PM | Before FR-BAK-001 |
| Q3 | What is the legal posture on **scraping public listings** per target board's ToS, and does human-in-the-loop (no auto-apply) sufficiently de-risk it? | Legal | Before Q1 |
| Q4 | Default **scan cadence** and whether background scanning runs when the app is closed (vs only when open). | PM | Onboarding design freeze |
| Q5 | Exact **default factor weights** and **starred threshold** — validate 0.45/0.25/0.20/0.10 and ≥4★ against a labelled sample. | PM + DS | Scoring build |
| Q6 | Default **OpenRouter model** and handling of model deprecation. | Eng | Settings build |
| Q7 | Do we ship **opt-in anonymous analytics**, or stay strictly local-only? | PM | V2 |
| Q8 | **CV output fidelity** — does tailored CV preserve original formatting (PDF/DOCX layout) or emit plain/markdown the user re-formats? | PM + Eng | Tailoring build |

### 13.2 Risks & mitigations
| # | Risk | Impact | Mitigation |
|---|---|---|---|
| **R1** | **Scraping violates a board's ToS** / legal exposure | Brand/legal | Public-listing-only; respect robots.txt; rate-limit; **no auto-apply** (human in loop); Legal review (Q3); make sites user-configurable so Star isn't hardcoded to any one board; clear user-responsibility messaging. |
| **R2** | **Anti-bot measures** (CAPTCHA, fingerprinting, IP blocks) break scans | High (core value) | Detect-and-stop (never bypass); polite pacing; pluggable adapters for fast repair; graceful per-site failure; set expectations that some boards won't be scannable. |
| **R3** | **Site layout changes** silently break extraction | High | Adapter health checks (0-result/anomaly detection → `error` state, §10); adapters isolated; quick-update path; surface staleness to user. |
| **R4** | **LLM cost / latency / variability** frustrates users | Medium | User's own key (cost transparency to them); show progress; timeouts/retries; cost estimate (V1.1); deterministic scorer means **scores never depend on the LLM** (FR-SCORE-009). |
| **R5** | **Mis-scoring erodes trust** (good jobs hidden / bad jobs starred) | High | Full explainability (§5.8); user-tunable weights (V1.1); track false-positive rate (§11); never hide a factor. |
| **R6** | **Secret/data leakage** (key in logs/backups, renderer exposure) | Severe | OS-secure storage only; key excluded from backups/state/logs; contextIsolation; two-egress audit (NFR-S2/S5). |
| **R7** | **Cross-platform native gaps** (secure storage, notifications, pickers differ) | Medium | Abstract native ops behind preload bridge; CI build+smoke on all three OSes; per-OS test matrix. |
| **R8** | **OpenRouter dependency** (model removed, API change, outage) | Medium | Gateway abstraction; model selector with fallbacks; degrade gracefully — non-LLM features keep working. |

### 13.3 Worth designing for (failure modes)
- A scan that returns **nothing** must teach the user *why* and how to widen — empty states are first-class (§10).
- A board that **starts blocking** mid-rollout must fail soft and isolated, not take the product down.
- A user who **never adds an LLM key** must still get full search/score/track value (tailoring is additive, not load-bearing).

### 13.4 Assumptions register
> Every assumption made in drafting this PRD. Each should be confirmed or corrected by the product owner; corrections may change linked FRs.

| ID | Assumption |
|---|---|
| A1 | "First scan < 5 min" on a 3-site list is an acceptable performance bar. |
| A2 | Tailoring latency p50<60s/p95<120s is acceptable given external model dependency. |
| A3 | No accounts/cloud/sync in v1; the repo's auth/roles boilerplate (`Schema.ddl`, `DomainModel.mmd`, `UC-001 Login`) is **not** part of this product. |
| A4 | One profile per installation in v1. |
| A5 | PDF + DOCX cover the needed CV formats for MVP (not RTF/TXT/Pages). |
| A6 | Minimum-scorable profile = target role + ≥1 skill + location + work mode. |
| A7 | Default site list (`rolehub/workscout/talentstream`) is placeholder; real defaults TBD (Q1). |
| A8 | robots.txt + polite rate-limiting is the agreed scanning etiquette baseline. |
| A9 | Cadence options off/on-launch/hourly/daily are the right granularity. |
| A10 | Default weights Skills .45 / Exp .25 / Loc .20 / Salary .10. |
| A11 | Star formula: half-star granularity, both stars and % shown. |
| A12 | Missing salary → factor excluded with renormalised weights (not scored 0). |
| A13 | Scoring is deterministic and in-app (LLM never sets the score). |
| A14 | Starred threshold defaults to ≥ 4 stars. |
| A15 | Accepted tailoring suggestions feed the deterministic scorer to recompute. |
| A16 | Status transitions may move both forward and backward; full history kept. |
| A17 | A single model choice applies to all tailoring (no per-task model). |
| A18 | Backup excludes the OpenRouter key; includes everything else. |
| A19 | Auto-backup triggers = after each scan + after each application status change (coalesced). |
| A20 | Studio palette can meet WCAG AA for text/contrast (to verify, NFR-A3). |
| A21 | SQLite (`better-sqlite3`) in main is the persistence choice over IndexedDB. |
| A22 | Embedded scanning uses `BrowserView`/`<webview>` in a partitioned session. |
| A23 | Activation/engagement targets in §11 are reasonable starting goals. |
| A24 | Interview/offer outcome rates are tracked but not targeted in v1. |
| A25 | <15% dismiss-rate on ≥4★ matches is an acceptable quality bar. |

---

*This PRD references the design handoff for all UI/UX. It does not redefine screens, components, or the Studio visual system — those are owned by `Star Job Search (1)/star-job-search-quasar/` and `docs/Mockups/`. The 1–5 star match score is the product's central motif and the contract between scanning, scoring, tailoring, and tracking.*

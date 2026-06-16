# Epic 1: Embedded Job-Site Browser

Status: TICKETS
Owner: human
Created: 2026-06-16
Last Updated: 2026-06-16

---

## 1. Purpose

Deliver the **embedded browser** that lets a user view public job sites *inside*
Star. The user stores job sites on the Settings page, then picks one from a
dropdown on the Discover page to open it in an in-app browser surface. This is the
MVP1 foundation that the later automated-scan, per-site adapter, and 1–5 star
scoring epics build on. It deliberately stops short of any automated scraping,
extraction, scoring, dedup, or scheduling — those are explicitly later epics.

---

## 2. User Story

As an active job-seeker,
I want to save my job sites and open a chosen one in an embedded browser inside Star,
So that I can browse listings in one place without leaving the app — laying the groundwork for automated scanning later.

---

## 3. Scope

### In Scope
- Embedded browser surface (Electron `BrowserView`/`<webview>`) in a **partitioned session isolated** from the app renderer.
- Basic browser navigation: back/forward and current-URL display.
- Add / remove job sites on the Settings page; URL normalised; persists locally and survives restart.
- A **site dropdown** on the Discover page, sourced from the same persisted sites list shown in Settings.
- Selecting a site from the dropdown loads it in the embedded browser and reflects the active URL.

### Out of Scope (deferred to later epics)
- Per-site adapters and automated listing extraction / scraping.
- Deduplication of listings.
- 1–5 star scoring and the explainable breakdown.
- `ScanSource` live progress streaming.
- Scan scheduling / cadence and background scans.
- Notifications.
- `robots.txt` handling and automated rate-limiting / polite pacing (these accompany automated scraping, not manual browsing).
- Role/location/salary search-steering controls that compose site search URLs.
- Any bypass of logins, paywalls, or CAPTCHAs (a permanent product non-goal — pages render as-is for the human).

---

## 4. Functional Requirements

1. FR-001 — An embedded browser surface renders within the Discover page and can load an external job-site URL.
2. FR-002 — The user can add a job site on the Settings page; the URL is normalised and the entry persists locally across app restarts.
3. FR-003 — The user can remove a stored job site on the Settings page.
4. FR-004 — The Discover page presents a dropdown of stored job sites, sourced from the same persisted sites list shown in Settings.
5. FR-005 — Selecting a site from the Discover dropdown loads that site in the embedded browser and reflects the active URL.
6. FR-006 — The embedded browser supports back/forward navigation within the loaded site.

---

## 5. Non-Functional Requirements

- NFR-001 (Security) — The embedded browser runs in a partitioned session isolated from app state; renderer keeps `contextIsolation: true` and `nodeIntegration: false`, so site cookies/JS cannot reach app data.
- NFR-002 (Security / egress) — Only user-selected sites are loaded; this is one of the app's two sanctioned, auditable egress paths.
- NFR-003 (Performance) — Loading a site and persisting the sites list never block the main UI thread; the app stays responsive.
- NFR-004 (Cross-platform) — The embedded browser and sites persistence work on macOS, Windows, and Linux from one codebase.

---

## 6. UI/UX Notes

- **Discover (`02`):** reuse the existing browser chrome already mocked in `DiscoverPage.vue` (back/forward chevrons, the URL pill, the "Star browsing" tag) but back it with a real embedded browser. Replace the hardcoded `siteToggles` in the dock with a **site dropdown** populated from the persisted sites list. Show an empty state when no sites are configured ("Add a site in Settings to start browsing").
- **Settings (`09`):** keep the existing Job sites card (`store.sites`, `store.siteDraft`, `store.addSite()`, `store.removeSite()`) but wire it to real local persistence and URL normalisation.
- Studio visual system is unchanged — no new tokens, colours, or components introduced.

---

## 7. Data Model Impact

- New `Site` entity: `id`, `url`/`host`, `label`, `enabled`, `addedAt`.
- The PRD §8 `Site` fields `searchUrlTemplate`, `adapterId`, and `ratePolicy` are **deferred** to the adapter/scan epic — not needed for manual browsing.
- No `JobListing`, `MatchScore`, or `MatchFactor` work in this epic (no extraction or scoring yet).

---

## 8. Integration Impact

- **Electron main:** new preload-bridge channels for the embedded browser (create / navigate / back / forward / show / set-bounds) and for sites persistence (list / add / remove). The preload bridge today exposes only `starWindow` (title-bar controls) — this epic extends it.
- **Renderer:** `DiscoverPage.vue` (replace the mock chrome + results with the real browser + dropdown), `SettingsPage.vue` (wire Job sites to persistence), `app-store.ts` (sites state hydrated from main).
- No external services beyond the user-selected job sites themselves.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] A site added on Settings is normalised, persists, and survives an app restart.
- [ ] A removed site disappears from both Settings and the Discover dropdown.
- [ ] The Discover dropdown lists exactly the persisted sites.
- [ ] Selecting a site loads the live site in the embedded browser and the URL bar reflects it.
- [ ] Back/forward navigation works within the loaded site.
- [ ] The embedded browser runs in a session isolated from app state (verified: site cookies/JS cannot reach app data).
- [ ] Discover shows a clear empty state when no sites are configured.
- [ ] The feature works on macOS, Windows, and Linux.
- [ ] No automated scraping, extraction, scoring, or scheduling is present (confirms scope boundary).

---

## 10. Risks & Unknowns

- **Embedded-browser surface choice:** `BrowserView` is a native overlay (not in the DOM flow → positioning/resizing it over the Vue layout is fiddly) versus `<webview>` (in-DOM and easier to lay out, but a heavier security surface). The choice needs to be made early and is the main unknown.
- **Gated content:** sites behind a login, paywall, or CAPTCHA will render but cannot be progressed automatically — acceptable for MVP1 (the human handles auth), but set expectations in the UI.
- **Persistence mechanism:** SQLite-via-main (per the Architecture) versus a lightweight persisted renderer/store for MVP1 — needs a decision; the Architecture prefers SQLite in main, which is greenfield.

---

## 11. Dependencies

- Foundational epic — no prerequisite epics exist yet, so no `Depends On:` line.
- Requires the Electron main process and preload bridge to be extended beyond the current `starWindow`-only surface (the Architecture flags this preload bridge as the current gap). If an "App Shell / preload foundation" epic is later created, this epic should declare a dependency on it.

---

## 12. References

- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md
- data_model: docs/Data Model/Schema.ddl

---

## 13. Implementation Notes (For Planning Agent)

Suggested ticket breakdown:

1. (Backend) Electron embedded-browser surface via `BrowserView`/`<webview>` in a partitioned session, with preload-bridge channels (create / navigate / back / forward / show / set-bounds).
2. (Backend) `Site` persistence + IPC (list / add / remove), with URL normalisation.
3. (Frontend) Settings: wire the Job sites card to persisted sites (normalise on add, persist on remove).
4. (Frontend) Discover: replace the mock chrome with the real embedded browser; add the site dropdown sourced from persisted sites; wire back/forward and the URL display.
5. (Frontend) Discover: load/error/empty states (loading indicator, failed-to-load message, "no sites configured" empty state).

Expected complexity: Medium — native Electron embedded-browser positioning/isolation is the primary unknown; the Settings/Discover wiring is straightforward.
Estimated total effort: ~5 tickets (1–4 hours each).

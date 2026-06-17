# Epic: Add CV to profile

Status: NEW
Owner: human
Created: 2026-06-17
Last Updated: 2026-06-17

---

## 1. Purpose

Make the **Profile real**. Today the Profile screen (`ProfilePage.vue`) and the
first two onboarding steps (`OnboardingPage.vue`) are a UI shell over hardcoded
sample data — `Alex_Morgan_CV.pdf`, `PARSED_SKILLS`, a fixed "85/100" strength
rail — and the only profile state the store actually holds is `workMode`. This
epic delivers the real thing: the user **uploads a CV** (PDF/DOCX), the app
**extracts its text locally** and uses the **LLM to structure that text** into
profile fields, and the result populates a single **editable, persisted Profile**
(target role, skills, experience, location, work mode, salary, links). That
Profile is the source of truth the later scoring epic will read.

This epic deliberately stops short of **scoring** — the 1–5 star match score, the
explainable breakdown, and any job/profile comparison consume the Profile and
belong to a later epic, exactly as Epic 1 delivered the embedded browser, Epic 2
the model connection, and Epic 3 the job board without any scoring.

**Parsing approach (decided):** field structuring is **LLM-assisted as the primary
path**, reusing **Epic 2's stored OpenRouter key and selected default model**.
Raw text extraction from the CV file still runs **locally and off the UI thread**;
only the structuring step calls the model. This is a deliberate deviation from the
PRD, which marks the LLM-assisted parse a fast-follow (FR-CV-007, off by default)
and the MVP parse local-only (FR-CV-003) — recorded in §10 so the PRD can be
reconciled.

---

## 2. User Story

As an active job-seeker setting up Star,
I want to upload my CV and have Star turn it into an accurate, editable profile,
So that the app scores jobs against my real experience instead of details I have to type from scratch.

---

## 3. Scope

### In Scope
- **CV upload** via drag-drop or native file picker; accept **PDF and DOCX**, reject other types with a clear message; enforce the scaffold's size hint (max 10MB).
- **Local text extraction** from the uploaded file, run **off the UI thread** — the file itself is never uploaded for text extraction.
- **LLM-assisted field structuring**: the extracted text is structured into profile fields (name, contact, target/most-recent role, skills, employment history, education, total years experience, location) using **Epic 2's saved key + selected default model**.
- A **parsed-preview review step** (Onboarding step 2): editable fields with **low-confidence / uncertain fields flagged** for confirmation rather than silently guessed.
- **Parse-failure & no-key fallbacks**: retry, upload a different file, or **enter the profile manually** — no dead-ends (covers the onboarding "skip the AI key" path, where structuring is unavailable).
- **CV versioning**: re-uploading ("Replace") creates a new versioned `CV` record and re-derives the profile; the binary lives on disk, metadata + parsed text in `star.db`.
- A single **editable, persisted Profile**: target role, skills, years experience, location, work mode (Remote/Hybrid/On-site), salary expectation (min + currency), LinkedIn URL, portfolio/personal links — persists locally and survives restart.
- **Profile-strength indicator** computed from field completeness, with the rubric exposed (what raises it).
- **Minimum-scorable gate**: target role + ≥1 skill + location + work mode; the UI states what is missing. Editing scoring-relevant fields marks future scores **stale** (the re-score itself is the later scoring epic's job).
- A **one-time "what is sent" disclosure** before CV text is first sent to the model.
- Wiring **Onboarding steps 1–2** and the **Profile screen** to this real state, replacing the `Alex_Morgan_CV.pdf` / `PARSED_SKILLS` mocks.

### Out of Scope (deferred to later epics)
- **Scoring**: the 1–5 star match score, the explainable factor breakdown, and any CV/profile-vs-job comparison (a later epic consumes the Profile).
- **CV / cover-letter tailoring** and any LLM use beyond CV-text structuring.
- **Multiple target roles** with independent scoring weights (PRD FR-PROF-005, fast-follow).
- **Backup / restore** of the profile and CV (the Backup epic).
- **Re-scan / re-score on profile change** — this epic marks scores stale; the actual re-score belongs to the scoring epic.
- A **purely local heuristic structurer** (no-LLM field parsing) as a built-out fallback — manual entry is the MVP no-key path; a local structurer can be a later addition.

---

## 4. Functional Requirements

1. FR-001 — The user can upload a CV by drag-drop or native file picker on Onboarding step 1 and on the Profile screen; **PDF and DOCX** are accepted and other types are rejected with a clear message.
2. FR-002 — The uploaded file's **raw text is extracted locally, off the UI thread**; the file is never uploaded for text extraction.
3. FR-003 — The extracted text is **structured into profile fields** (name, contact, target/most-recent role, skills, employment history, education, total years experience, location) using **Epic 2's saved OpenRouter key and selected default model**.
4. FR-004 — The parsed result is shown for **review and edit** with **low-confidence/uncertain fields flagged**; the user proceeds only after confirming.
5. FR-005 — On parse failure, an unsupported file, or **no AI key present**, the user can **retry, upload a different file, or enter the profile manually** — there is no dead-end.
6. FR-006 — Re-uploading a CV ("Replace") creates a **new versioned `CV` record** and re-derives the profile; prior data is not silently lost.
7. FR-007 — The app maintains a single **editable Profile** (target role, skills, years experience, location, work mode, salary min + currency, LinkedIn URL, portfolio/personal links) that **persists locally and survives restart**.
8. FR-008 — Editing any Profile field persists it; the Profile is the **single source of truth** the later scoring epic reads, replacing the current mock store state.
9. FR-009 — A **profile-strength indicator** is computed from field completeness and displayed, exposing the rubric (which fields raise it and by how much).
10. FR-010 — A **minimum-scorable profile** (target role + ≥1 skill + location + work mode) is enforced; the UI states what is missing, and editing a scoring-relevant field marks existing scores **stale**.
11. FR-011 — Before CV text is sent to the model for the first time, the app **discloses what is sent and to which provider**; structuring is unavailable until an Epic 2 key is present.
12. FR-012 — **Onboarding steps 1–2** and the **Profile screen** are backed by this real CV/Profile state, replacing the `Alex_Morgan_CV.pdf` / `PARSED_SKILLS` / fixed-strength mocks.

---

## 5. Non-Functional Requirements

- NFR-001 (Privacy / local) — The CV **binary** and its **parsed text** are stored locally only (file on disk in `userData`; metadata + text in `star.db`); nothing leaves the device except the opted-in LLM structuring call.
- NFR-002 (Security / egress) — The structuring call is the **only** outbound path and goes through **Epic 2's existing OpenRouter egress** — a sanctioned, auditable path; this epic opens **no new egress**.
- NFR-003 (Performance) — Text extraction runs **off the UI thread**; no main-thread block > 100 ms; the UI stays responsive during upload, extraction, and structuring (show progress, never freeze).
- NFR-004 (Resilience) — Parse / LLM / file failures **degrade gracefully** (retry, different file, manual entry); never an unhandled crash or dead-end.
- NFR-005 (Cross-platform) — CV picker, file storage, and Profile/CV persistence work on **macOS, Windows, and Linux** from one codebase, including graceful behaviour when no AI key is configured.

---

## 6. UI/UX Notes

- **Onboarding (`10`, route `/onboarding`):**
  - **Step 1 — Upload CV:** wire the existing dropzone to a real picker + upload; show progress while extracting/structuring; keep the "stays on this device" privacy line and add the **one-time "what is sent" disclosure** before the first model call.
  - **Step 2 — Review parsed profile:** replace the hardcoded `f` fields and `PARSED_SKILLS` with the **real parsed result**; flag low-confidence fields; allow edit and removal of skill chips; offer **manual entry** when the key was skipped on step 3 / structuring failed.
- **Profile screen (`08`):** wire the existing layout to real state — the **CV card** (real file name + uploaded-at + parse status), **Replace** dropzone (re-upload → new version), editable **links**, **target & preferences** (target role, min salary, work-mode toggle already bound to `store.workMode`), and the **profile-strength rail** computed from real completeness instead of the fixed "85/100". The "Re-scan with new profile" button stays present but is owned by the later scoring epic (marks scores stale here).
- **Studio visual system is unchanged** — no new tokens, colours, or components; reuse the existing dropzone, chips, field, and rail styling already in `ProfilePage.vue` / `OnboardingPage.vue`.

---

## 7. Data Model Impact

Adds the PRD §8 `Profile` and `CV` entities to the existing `star.db` (alongside
`sites` from Epic 1, `preferred_models` from Epic 2, and `jobs` / `site_profiles`
from Epic 3):

- **`Profile`** *(singleton)* — `id, name, targetRole, yearsExperience, location, workMode('Remote'|'Hybrid'|'On-site'), salaryMin, salaryCurrency, linkedinUrl, links(JSON), skills(JSON), strengthScore, updatedAt`. One row per install (non-goal: multi-profile).
- **`CV`** — `id, profileId→Profile, fileName, mime('pdf'|'docx'), storagePath, parsedText, parsedFields(JSON), version, confidence, uploadedAt`. **Versioned** (FR-006); binary stored as a file under `userData`, metadata + extracted text in `star.db`.
- No `JobListing` / `MatchScore` / `MatchFactor` work — this epic does not score (scope boundary). `MatchScore.stale` is *set* by profile edits but the table and re-score are the scoring epic's.

---

## 8. Integration Impact

- **New main-process modules (mirroring `sites.ts` / `apiKey.ts`):**
  - `profile.ts` — `Profile` singleton store + `profile:get` / `profile:save` IPC.
  - `cv.ts` — CV upload, on-disk file storage under `userData`, versioning, and `cv:*` IPC.
  - An **off-thread text extractor** (worker / utility process) turning PDF/DOCX into text.
  - **First real LLM use:** structuring reuses **Epic 2's saved key + selected default model**. Epic 2 explicitly stopped short of any chat/completion call, so this epic adds the **first OpenRouter completion / structured-output call** on top of Epic 2's key + model selection.
- **`electron-main.ts` (scaffolding):** register the new profile/CV IPC inside `createWindow()` as `registerSitesIpc` does, reusing the single `star.db` handle.
- **`electron-preload.ts` + `env.d.ts` (scaffolding):** new bridges (e.g. `window.starProfile`, `window.starCv`) and their `Window` types, extending the existing `starWindow` / `starBrowser` / `starSites` / Epic-2/3 surfaces.
- **Renderer:** `app-store.ts` gains profile + CV state/actions (replacing the lone `workMode` + the `PARSED_SKILLS` mock); `ProfilePage.vue` and `OnboardingPage.vue` wired to the real flows.
- **Scaffolding files (must be serialised across tickets):** `electron-main.ts`, `electron-preload.ts`, `env.d.ts` (backend); `app-store.ts`, `ProfilePage.vue`, `OnboardingPage.vue` (frontend).
- **New dependencies (flagged for approval):** a PDF text extractor (e.g. `pdfjs-dist` / `pdf-parse`) and a DOCX extractor (e.g. `mammoth`) — JS, main-process; confirm bundle size and Electron-main compatibility before adopting.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] A PDF or DOCX CV can be uploaded (drag-drop or picker) on onboarding and on the Profile screen; other file types are rejected with a clear message.
- [ ] The CV's text is extracted locally and off the UI thread; the UI stays responsive throughout.
- [ ] The extracted text is structured into profile fields using Epic 2's saved key + default model, and the parsed result is shown for review with low-confidence fields flagged.
- [ ] When no key is present or parsing fails, the user can retry, upload a different file, or enter the profile manually — with no dead-end.
- [ ] Re-uploading a CV creates a new version and re-derives the profile without silently losing data.
- [ ] The Profile (target role, skills, experience, location, work mode, salary, links) persists and survives an app restart.
- [ ] The profile-strength indicator reflects real completeness and exposes its rubric; the minimum-scorable gate states what is missing.
- [ ] The "what is sent" disclosure appears before the first model call; structuring is disabled until a key is present.
- [ ] Onboarding steps 1–2 and the Profile screen show real data — the `Alex_Morgan_CV.pdf` / `PARSED_SKILLS` / fixed-strength mocks are gone.
- [ ] The feature works on macOS, Windows, and Linux.
- [ ] No scoring / star breakdown is present — confirms the scope boundary.

---

## 10. Risks & Unknowns

- **Deviation from the PRD's local-parse MVP:** the PRD marks LLM-assisted parse a fast-follow (FR-CV-007, off by default) and MVP parse local-only (FR-CV-003). This epic makes LLM structuring the **primary** path. Text extraction stays local; only structuring uses the model. **Reconcile the PRD** (FR-CV-003/FR-CV-007 wording) to match.
- **LLM dependency during onboarding:** onboarding lets the user skip the AI key (step 3). With LLM structuring as primary, parsing can't run without a key — the **manual-entry fallback (FR-005)** must be clean and obvious, not an afterthought.
- **First real OpenRouter completion call:** Epic 2 built key + catalogue + model selection but **no completion call**. This epic adds the first one; it needs a **structured-output (function-calling / JSON) path**, and the chosen default model must support it — surface a clear message if it does not.
- **Parse accuracy / variability:** structuring quality varies by CV layout and model. Mitigations: the review-and-edit step, confidence flags on uncertain fields, and manual override.
- **New parsing libraries:** PDF/DOCX text extractors add bundle size and may have Electron-main / ESM-CJS quirks — validate early (ties to the §8 approval flag).
- **CV binary storage & cleanup:** where versions live under `userData`, and whether old versions are retained or pruned on re-upload (TailorDraft pins a CV version in a later epic — retain by default).
- **Cost / latency:** sending full CV text to the model on every (re)upload — keep the call single-shot and show progress.

---

## 11. Dependencies

- **Epic 2 (OpenRouter API Key & Model Selection)** — **required.** LLM structuring is built on Epic 2's saved key and selected default model; the structuring ticket declares explicit `depends_on` links to the Epic 2 key-storage and default-model tickets. (Epic 2 is in `TICKETS`.)
- **Shared foundation** — reuses the single `star.db` handle and the preload-bridge pattern extended by Epics 1–3 (`sites.ts` / `apiKey.ts` as the module template). No functional dependency on Epic 1's embedded browser or Epic 3's job board.

---

## 12. References

- prd: docs/Product Requirements Document/PRD.md (§4 Epic A/F, §5.1 CV parsing, §5.2 Profile model, §8 data model)
- architecture: docs/Architecture/Architecture.md (CV Parser component; two-egress boundary)
- data_model: docs/Data Model/Schema.ddl
- scaffold: `app/` — `src/pages/ProfilePage.vue`, `src/pages/OnboardingPage.vue`, `src/stores/app-store.ts`, `src/data/sample.ts` (`PARSED_SKILLS`)
- depends-on: docs/Epics/epic_02_OPENROUTER_KEY_AND_MODEL_SELECTION.md

---

## 13. Implementation Notes (For Planning Agent)

Suggested ticket breakdown (backend first; serialise the shared scaffolding files
`electron-main.ts` / `electron-preload.ts` / `env.d.ts`, then `app-store.ts` /
`ProfilePage.vue` / `OnboardingPage.vue`; the text extractor and the Profile store
are independent and can run in parallel):

1. (Backend) `profile.ts` — `Profile` singleton table in `star.db` + `profile:get|save` IPC + preload bridge + types. *(independent)*
2. (Backend) Off-thread **text extractor** (PDF/DOCX → text) + the new extraction deps. *(independent)*
3. (Backend) `cv.ts` — CV upload, on-disk versioned storage under `userData`, `cv:*` IPC + bridge + types. *(after 2)*
4. (Backend) **LLM structuring** — first OpenRouter completion / structured-output call using Epic 2's key + default model; map extracted text → `parsedFields` + `confidence`. *(after 2; depends on Epic 2 key + default-model tickets)*
5. (Frontend) `app-store.ts` profile + CV state/actions, replacing the `workMode`-only state and the `PARSED_SKILLS` mock. *(after 1, 3, 4)*
6. (Frontend) **Profile screen** wired to real state — CV card/Replace, links, target & preferences, profile-strength rail, minimum-scorable gate. *(after 5)*
7. (Frontend) **Onboarding steps 1–2** wired to real upload + parsed-review, with the manual-entry fallback when no key is present and the "what is sent" disclosure. *(after 5)*
8. (Tests) Profile persistence + minimum-scorable + strength rubric; CV versioning; structuring-mapping with a mocked LLM; failure / no-key / manual-entry paths. *(after 4)*
9. (Docs) Update `HelpPage.vue` and the architecture doc for CV→Profile and the first LLM use. *(after 6, 7)*

Expected complexity: **Medium-High** — the Profile/CV persistence and Onboarding/Profile wiring are straightforward, but the off-thread extractor, the new parsing libraries, and the **first OpenRouter completion (structured-output) call** on top of Epic 2 are the real care points.
Estimated total effort: ~9 tickets (1–4 hours each).

# Epic 2: OpenRouter API Key & Model Selection

Status: TICKETS
Owner: human
Created: 2026-06-16
Last Updated: 2026-06-16

---

## 1. Purpose

Make the **AI provider connection real**. Today the Settings page only *mocks*
the OpenRouter integration — a sample API key, a no-op "Test connection", and a
hardcoded four-item model dropdown (`app-store.ts` / `SettingsPage.vue`). This
epic replaces that mock with the real functionality, **ported from
`C:\dev\build\ombuto-binder`** (same stack: Electron + `better-sqlite3` + Pinia +
Vue 3):

1. Securely **save / read / clear an OpenRouter API key** using Electron
   `safeStorage` (OS-keychain-backed), with the raw key never reaching the
   renderer or the database.
2. **Fetch the live catalogue** of available models from the OpenRouter API.
3. A **model-picker dialog** that lets the user browse/search/filter the
   available models, curate a small **preferred list**, and **select the default
   model**, persisted in SQLite.

It deliberately stops short of *using* the model — no job scoring, CV/cover-letter
drafting, or any chat/completion calls. Those consume the selected model and
belong to later epics, exactly as Epic 1 delivered the embedded browser without
any scraping or scoring.

---

## 2. User Story

As a job-seeker setting up Star,
I want to securely save my OpenRouter API key and pick which model Star should use by default,
So that the app is connected to a working AI provider and ready for the scoring and tailoring features that build on it.

---

## 3. Scope

### In Scope
- Secure OpenRouter **API key** storage via Electron `safeStorage` (encrypted blob in `userData`); save / get-status / clear.
- Renderer only ever sees a **masked status** (`{ present, masked }`) — never the raw key.
- **Key validation / "Test connection"**: a connection check that confirms the saved key works (backed by a real OpenRouter call), surfacing stable error codes (no key / auth error / rate-limited / network error).
- **Model catalogue fetch** from `GET https://openrouter.ai/api/v1/models` in the main process, authorised with the saved key, returning a typed `ModelInfo[]` with stable error codes.
- Renderer-side **model enrichment** (vendor, formatted context window, formatted price, SOTA/free flags) for display and sorting.
- **Preferred models** persistence in `better-sqlite3` (`preferred_models` table): curate up to **5** models with exactly **one default**; add / remove / set-default with deterministic default-promotion when the default is removed.
- A **preferred-models picker dialog** (adapted from binder's `PreferredModelsPickerDialog.vue`) with search, filter pills, sort, and multi-select up to the limit.
- **Settings integration**: replace the mock key field and mock model `q-select` with the real key flow + preferred-models list (set-default / remove) + a button to open the picker dialog, styled in the existing Studio system.

### Out of Scope (deferred to later epics)
- Any *use* of the selected model: job scoring, the 1–5 star breakdown, CV/cover-letter drafting, chat/completions, streaming, or tool calls.
- Per-conversation / per-entity model overrides (binder's `ModelPickerDialog` "fixed/cycle" modes) — Star has no "binder"/chat concept, so only an **account-level default** is imported.
- Token accounting, cost tracking, or usage limits.
- Provider abstraction beyond OpenRouter (no multi-provider switching).
- Backup/restore of the key (the key stays in the OS keychain and is never exported); a post-restore "re-enter key" prompt is deferred to the Backup epic.

---

## 4. Functional Requirements

1. FR-001 — The user can save an OpenRouter API key on the Settings page; it is stored encrypted via `safeStorage` and survives app restarts.
2. FR-002 — The renderer can read the key **status** (present + masked preview) and **clear** the key, but can never read the raw key value.
3. FR-003 — The app can validate the saved key ("Test connection") against OpenRouter and report success or a specific failure reason.
4. FR-004 — The app fetches the live list of available OpenRouter models, authorised with the saved key, and surfaces stable error codes on failure.
5. FR-005 — The user can browse/search/filter/sort the available models in a picker dialog and add models to a preferred list (max 5).
6. FR-006 — The user can mark exactly one preferred model as the **default**; removing the default deterministically promotes another preferred model.
7. FR-007 — The preferred list and default selection persist locally across app restarts.
8. FR-008 — The Settings page shows the current key status, the preferred list with default/remove controls, and a control to open the picker dialog; the picker is disabled until a key is present.

---

## 5. Non-Functional Requirements

- NFR-001 (Security) — The raw API key never crosses the IPC boundary to the renderer and is never written to SQLite or plaintext; only an encrypted `safeStorage` blob and a masked status leave the main process.
- NFR-002 (Security / egress) — Outbound calls go only to the OpenRouter API; this is one of the app's sanctioned, auditable egress paths.
- NFR-003 (Performance) — Key access, the catalogue fetch, and preferred-list writes never block the main UI thread; the catalogue fetch is de-duplicated/cached so reopening the picker doesn't refetch needlessly.
- NFR-004 (Cross-platform) — Key storage (`safeStorage`) and model selection work on macOS, Windows, and Linux from one codebase; behaviour is graceful when OS encryption is unavailable.
- NFR-005 (Resilience) — Catalogue/validation failures degrade gracefully with clear, specific messages (no key / auth / rate-limited / network), never an unhandled crash.

---

## 6. UI/UX Notes

- **Settings (`09`) — LLM integration card:** keep the existing card layout but make it real:
  - The **OpenRouter API key** row becomes a real save/clear flow; show the masked status when a key is present; "Show/Hide" maps to the masked preview; **Test connection** performs a real validation and shows the connected/failed state.
  - Replace the single hardcoded **Model** `q-select` with a **preferred-models list** (each row: model name, set-default, remove) plus a **"Select models…"** button that opens the picker dialog. The button and list are disabled/empty-stated until a key is saved.
- **Preferred-models picker dialog:** adapt binder's `PreferredModelsPickerDialog.vue` to the Studio visual system (terracotta accent, hairlines, serif headings) — search box, filter pills (All / Preferred / SOTA / Free), sort (Featured / Newest / A→Z / Cost / Context), multi-select checkboxes, and a "Limit of 5 reached" hint. Loading / error (per error code) / empty states included.
- No new design tokens or colours — reuse the existing Studio system and the `q-dialog` pattern already used by the About dialog.

---

## 7. Data Model Impact

- New `preferred_models` table in the existing `star.db`: `slug TEXT PRIMARY KEY`, `is_default INTEGER NOT NULL DEFAULT 0`, `position INTEGER NOT NULL`. Invariants (enforced in the main-process model layer): at most 5 rows; exactly one `is_default = 1` when non-empty; `position` gives stable ordering for deterministic default promotion.
- The **API key is not** a DB row — it lives in an encrypted `safeStorage` blob under `userData` (e.g. `openrouter-key.bin`).
- `ModelInfo` is a transient, fetched-and-enriched type (not persisted); only the chosen **slugs** are stored in `preferred_models`.

---

## 8. Integration Impact

- **Electron main:** three new modules mirroring `sites.ts` — `apiKey.ts` (safeStorage secret store + `apiKey:*` IPC), `llmCatalogue.ts` (OpenRouter `/models` fetch + `llm:listModels` IPC), `preferredModels.ts` (`preferred_models` store + `preferredModels:*` IPC, reusing the same `star.db` handle opened in `electron-main.ts`). Each registers its IPC inside `createWindow()` like `registerSitesIpc` does.
- **Preload (`electron-preload.ts`) + types (`env.d.ts`):** new context-bridge surfaces (e.g. `window.starApiKey`, `window.starModels`, `window.starPreferredModels`) and their `Window` interface declarations, extending the existing `starWindow` / `starBrowser` / `starSites` bridges.
- **Renderer:** `app-store.ts` gains key-status, catalogue, and preferred-models state/actions (preserving the single-store pattern); a new `src/data/orModels.ts` for the `deriveCatalogue` enrichment; a new `PreferredModelsPickerDialog.vue`; `SettingsPage.vue` wired to the real flows (removing the mock `apiKey`/`SAMPLE_API_KEY` state and the hardcoded model list).
- **Scaffolding files (must be serialised across tickets):** `electron-main.ts`, `electron-preload.ts`, `env.d.ts` (backend); `app-store.ts`, `SettingsPage.vue` (frontend).
- No external services beyond the OpenRouter API.

---

## 9. Acceptance Criteria

Epic is complete when:

- [ ] A saved OpenRouter key persists (encrypted via `safeStorage`) across an app restart, and the raw key is never exposed to the renderer or written to SQLite.
- [ ] The renderer can read key status (present + masked) and clear the key.
- [ ] "Test connection" reports success for a valid key and a specific reason for failure (no key / auth / rate-limited / network).
- [ ] The available-models list is fetched live from OpenRouter and rendered with vendor / context / price / flags; failures show the correct error state.
- [ ] The user can browse/search/filter/sort models and add up to 5 to a preferred list; exceeding the limit is prevented with a clear hint.
- [ ] Exactly one preferred model is the default at all times when the list is non-empty; removing the default promotes another deterministically.
- [ ] The preferred list and default survive an app restart.
- [ ] Settings shows the real key status, the preferred list, and a picker that is disabled until a key is saved; the previous mock key/model UI is gone.
- [ ] The feature works on macOS, Windows, and Linux.
- [ ] No model *usage* (scoring, drafting, chat) is present — confirms the scope boundary.

---

## 10. Risks & Unknowns

- **`safeStorage` availability:** on Linux, OS encryption may be unavailable depending on the keyring/session; the app must degrade gracefully (clear message; do not crash; do not silently store plaintext).
- **OpenRouter catalogue shape/size:** the `/models` payload is large and its fields evolve; enrichment must tolerate missing fields (pricing/context/created) without breaking sort/filter.
- **Key validation endpoint:** decide whether "Test connection" reuses the `/models` fetch (a successful list == valid key) or a dedicated auth-check call — binder reuses the catalogue fetch and its error codes; that is the suggested default.
- **Store shape decision:** binder uses three separate Pinia stores; Star uses a single `app-store.ts`. This epic folds the state into `app-store.ts` to preserve the existing pattern — confirm during planning.

---

## 11. Dependencies

- Builds on the Electron main + preload-bridge foundation extended by Epic 1 (the `sites.ts` pattern and the shared `star.db` are reused). No blocking prerequisite tickets remain (Epic 1 is in review).

---

## 12. References

- source_project: C:\dev\build\ombuto-binder (faithful port; see file inventory below)
- prd: docs/Product Requirements Document/PRD.md
- architecture: docs/Architecture/Architecture.md
- data_model: docs/Data Model/Schema.ddl

### Source inventory in `ombuto-binder` (map onto Star)
- Main: `src/main/ipc/apiKey.ts`, `src/main/models/apiKey.ts` (safeStorage + masking) → Star `src-electron/apiKey.ts`
- Main: `src/main/models/llmCatalogue.ts`, `src/main/ipc/llm.ts` (`listModels`, `/api/v1/models`, error codes) → Star `src-electron/llmCatalogue.ts`
- Main: `src/main/models/preferredModels.ts`, `src/main/ipc/preferredModels.ts`, `src/main/db/schema.ts` (`preferred_models`) → Star `src-electron/preferredModels.ts`
- Shared: `src/shared/channels.ts`, `src/shared/ipc.ts` (channel constants + types) → Star inline channels + `env.d.ts`
- Renderer: `src/renderer/components/PreferredModelsPickerDialog.vue`, `src/renderer/data/models.ts` (`deriveCatalogue`) → Star `components/` + `src/data/orModels.ts`
- Renderer: `src/renderer/stores/apiKey.ts`, `stores/preferredModels.ts`, `stores/modelCatalogue.ts` → folded into Star `app-store.ts`
- Renderer: `src/renderer/views/Settings.vue` (OpenRouter tab) → Star `SettingsPage.vue` LLM-integration card
- Excluded: `ModelPickerDialog.vue` (per-binder fixed/cycle), `usePostRestoreKeyPrompt.ts` (Backup epic)

---

## 13. Implementation Notes (For Planning Agent)

Suggested ticket breakdown (backend first; serialise the shared scaffolding files
`electron-main.ts` / `electron-preload.ts` / `env.d.ts`, then `app-store.ts` /
`SettingsPage.vue`):

1. (Backend) `apiKey.ts` — `safeStorage` secret store + validation/masking + `apiKey:save|getStatus|clear` IPC + preload bridge + types.
2. (Backend) `llmCatalogue.ts` — OpenRouter `/models` fetch authorised by the saved key, stable error codes, `llm:listModels` IPC + preload bridge + types. *(depends on 1)*
3. (Backend) `preferredModels.ts` — `preferred_models` table + CRUD with the max-5 / one-default / promotion invariants + `preferredModels:list|add|remove|setDefault` IPC + preload bridge + types. *(depends on 2)*
4. (Frontend) `app-store.ts` state/actions for key status, catalogue, preferred models, plus `src/data/orModels.ts` enrichment. *(depends on 3)*
5. (Frontend) Settings — real API-key save/clear/status + "Test connection" wired to the catalogue validation; remove the mock key state. *(depends on 4)*
6. (Frontend) Settings — `PreferredModelsPickerDialog.vue` (search/filter/sort/multi-select) + preferred-list display (set-default/remove) replacing the mock model dropdown. *(depends on 5)*
7. (Tests) Unit/regression tests: key store + masking, catalogue error codes, preferred-model invariants, dialog behaviour. *(depends on 6)*
8. (Docs) Update `HelpPage.vue` "Connect an AI provider" guidance for the real key + model selection. *(depends on 6)*

Expected complexity: Medium — the binder source maps almost 1:1 onto Star's stack; the main care points are `safeStorage` graceful-degradation, folding three binder stores into the single `app-store.ts`, and restyling the picker dialog into the Studio system.
Estimated total effort: ~8 tickets (1–4 hours each).

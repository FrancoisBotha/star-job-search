<!-- Authored by Initiate Stack (refresh mode) on 2026-06-17. -->
<!-- This file is the single source of truth for how every ticket's test phase -->
<!-- validates work. Test-phase agents read it first. -->

# Test Strategy

> **Working directory.** The application lives under `app/`, **not** the repo
> root. Every command below is run from `app/`:
>
> ```bash
> cd app
> ```
>
> The repo root holds only `docs/`, `.ombutocode/`, and project meta. There is no
> manifest at the root — `app/package.json` is the project manifest.

## 1. Stack and frameworks

- **Language / version:** TypeScript 5.5 (strict mode), targeting ES2022. Node ≥ 18 (developed on Node 22).
- **App framework:** Electron 42 + Vue 3 + Quasar 2 (Pinia store, Vue Router). Built via `@quasar/app-vite` in Electron mode (`bundler: packager`).
- **Test framework:** [Vitest 2](https://vitest.dev) — `npm test` → `vitest run`. Node test environment (`vitest.config.ts`).
- **Lint tool:** ESLint 9 (flat config, `app/eslint.config.js`) — `typescript-eslint` + `eslint-plugin-vue`. Run with `npm run lint`.
- **Type-check tool:** `vue-tsc --noEmit` — `npm run type-check`.
- **Code formatter:** None configured. Formatting is enforced via ESLint's `eslint-plugin-vue` stylistic rules (`--fix` available). There is no Prettier in this project.

## 2. Test directory layout

| Surface | Location | Notes |
|---|---|---|
| Electron main process | `app/src-electron/__tests__/*.test.ts` | Backend modules: sites, jobs, profile, apiKey, CV extraction, MCP browser server, LangGraph extraction. |
| Vue renderer | `app/src/**/*.test.ts` | Co-located beside the page/store/component under test (e.g. `src/pages/DiscoverPage.test.ts`, `src/stores/app-store.test.ts`). |

Vitest discovers tests via `include: ['src-electron/**/*.test.ts', 'src/**/*.test.ts']` (`app/vitest.config.ts`). There is no separate integration/e2e directory — see §8.

## 3. How to run tests for a specific file or test class

Run a **single file**:

```bash
cd app
npx vitest run src-electron/__tests__/sites.test.ts
npx vitest run src/pages/DiscoverPage.test.ts
```

Run by **test name** (substring of the `describe`/`it` title) — this is how a
per-ticket agent validates one acceptance criterion:

```bash
cd app
npx vitest run -t "AC1: add() persists"
npx vitest run src-electron/__tests__/sites.test.ts -t "restart durability"
```

Watch a single file while iterating:

```bash
cd app
npx vitest src-electron/__tests__/sites.test.ts
```

## 4. How to run the full project test suite

```bash
cd app
npm test          # vitest run — every test under src/ and src-electron/
```

Used by the regression-test closeout ticket and by epic-level evaluations. The
epic gates live in `src-electron/__tests__/epic-acceptance.test.ts`,
`epic-regression.test.ts`, and `llm-epic-acceptance.test.ts`.

## 5. Lint and type-check commands

```bash
cd app
npm run lint         # eslint (flat config: app/eslint.config.js)
npm run lint -- --fix    # auto-fix the fixable subset (stylistic warnings)
npm run type-check   # vue-tsc --noEmit -p tsconfig.json
```

- ESLint config: `app/eslint.config.js` (ESLint 9 flat config). It lints `src/**/*.{ts,vue}` and `src-electron/**/*.ts`; ignores `dist/`, `.quasar/`, `node_modules/`, `src-capacitor/`, `src-cordova/`. Intentionally-unused vars are marked with a leading `_` (honoured by the `no-unused-vars` rule).
- Type-check config: `app/tsconfig.json` (strict, `exactOptionalPropertyTypes: true`).

> **Known state (2026-06-17), flagged for follow-up tickets — do NOT treat as
> blocking for an unrelated ticket:**
> - `npm run lint` currently reports **6 real errors** (`no-useless-escape`,
>   `@typescript-eslint/no-this-alias`, one unused `ActiveTargetLog`) plus ~798
>   stylistic warnings. Lint was introduced in this refresh; the codebase has not
>   been cleaned against it yet.
> - `npm run type-check` currently reports errors in
>   `src-electron/mcp-browser-server.ts` (MCP SDK overloads vs
>   `exactOptionalPropertyTypes`) and `vitest.config.ts` (`module` not valid in
>   `tsconfigRaw.compilerOptions`).
> A ticket should drive each of these to zero. Until then, a per-ticket agent
> verifies only that **its own** changes introduce no *new* lint/type errors.

## 6. Coverage and reporting

Coverage is **not tracked** — no `@vitest/coverage-*` provider is installed and
no coverage thresholds are enforced. To produce an ad-hoc report, install a
provider and run with `--coverage`:

```bash
cd app
npm i -D @vitest/coverage-v8
npx vitest run --coverage
```

## 7. Conventions tests must follow

- **File naming:** `*.test.ts`, co-located with the unit under test (renderer) or under `src-electron/__tests__/` (main).
- **Per-ticket tests:** name the file after the ticket id so the trace from test → ticket is obvious — e.g. `DiscoverPage.brwsr005.test.ts`, `SettingsPage.llm005.test.ts`, `extr-010.test.ts`.
- **Epic-level tests:** `epic-acceptance.test.ts` (does the epic meet its ACs?), `epic-regression.test.ts` (do prior epics still pass?), and the LLM epic's `llm-epic-acceptance.test.ts`.
- **Structure:** arrange-act-assert; `describe` names the unit + AC reference (e.g. `"createSitesStore — persistence (AC1, AC5, AC7)"`), `it` states the observable behaviour. Reference the FR/AC id in the title so failures map back to the PRD.
- **Determinism:** the scoring engine and any `(input) → output` logic must be tested against fixtures with fixed inputs (FR-SCORE-009). No reliance on wall-clock, network, or random ordering.
- **Environment:** tests run in Vitest's `node` environment. Mock Electron (`BrowserWindow`, `ipcMain`, `safeStorage`, `BrowserView`) and the network — never reach a real job site or OpenRouter from a unit test.

## 8. What NOT to test in the per-ticket TDD cycle

Keep these out of the per-ticket loop (they belong to regression/manual passes so
the per-ticket agent doesn't blow its budget):

- **Real Electron launch / window rendering** — no spawning the actual app in a unit test. Assert against mocked Electron APIs instead.
- **Live scraping of real job sites** — the embedded `BrowserView` against a real board is manual/regression territory; unit tests drive mocked DOM/tool responses.
- **Real OpenRouter / LLM calls** — never hit the network or spend the user's key in a unit test. Mock the LLM Gateway; assert on prompt composition and graph wiring, not model output (which is non-deterministic).
- **Cross-platform native behaviour** (Keychain/DPAPI/libsecret via `safeStorage`, native file pickers, OS notifications) — verified per-OS in a manual/CI smoke matrix, not per-ticket.
- **Full visual/CSS rendering** — assert component wiring and emitted data, not pixel layout.

## 9. Known pitfalls on this project

- **A running Electron app locks `node_modules` → `npm install` fails with `EBUSY`.** A live `quasar dev -m electron` session (or a packaged build) holds `app/node_modules/electron/dist/...` open. **Stop the dev session before running `npm install`.** Find it with `npm run dev:electron`'s process tree; restart after installing.
- **Run commands from `app/`, not the repo root.** There is no root manifest; `cd app` first.
- **`better-sqlite3` is a native module.** It is rebuilt for the local Node ABI on install (`prebuild-install`). After a Node version change, run `npm rebuild better-sqlite3` (or reinstall) or `require('better-sqlite3')` will throw a NODE_MODULE_VERSION mismatch.
- **`vitest.config.ts` uses its own inline `tsconfigRaw`**, separate from `app/tsconfig.json`. Type errors reported by `npm run type-check` do **not** fail the Vitest run (esbuild transpiles without type-checking). Run `type-check` and `test` as independent gates.
- **The OpenRouter key must never appear in a test fixture, snapshot, log, or backup** (NFR-S2). Tests for the key store assert masking/secure-storage behaviour with dummy values only.
- **A partial/interrupted `npm install` can leave `node_modules` without its `.bin` shims** (so `vitest`/`vue-tsc` "is not recognized"). Re-run `npm install` to completion to restore them.

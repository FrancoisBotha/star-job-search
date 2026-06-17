# Star Job Search — Vue 3 + Quasar + TypeScript

A faithful, runnable scaffold of the **Star Job Search** desktop app in the **Studio** visual direction. Star runs automated job searches in an embedded browser, scores each job against your CV/profile with a **1–5 star** match score, helps tailor a CV & cover letter, and tracks applications.

Built with **Vue 3** (`<script setup>` + Composition API), **Quasar v2** (Vite), **TypeScript** (strict), **Pinia**, and **Vue Router**.

---

## Quick start

```bash
# 1. Install dependencies (npm, pnpm, or yarn)
npm install

# 2. Run in the browser (Vite dev server, opens at http://localhost:9100)
npm run dev

# 3. Run as a desktop Electron app (the app's real target)
npm run dev:electron

# Type-check
npm run type-check

# Production build
npm run build            # SPA
npm run build:electron   # packaged desktop app
```

> Requires Node ≥ 18 and the Quasar CLI for some commands: `npm i -g @quasar/cli`.
> `npm run dev` / `npm run build` also work without the global CLI via the local `@quasar/app-vite`.

If you don't already have a Quasar project to drop this into, the fastest path is to
`npm create quasar@latest` (choose **Vite, TypeScript, Pinia, SCSS**) and then copy this
`src/`, `quasar.config.ts`, and `index.html` over the generated ones — that guarantees the
`.quasar/` types directory exists for `tsconfig.json` to extend.

---

## What's implemented

All nine screens from the prototype, fully navigable:

| Route | Screen | Notes |
|---|---|---|
| `/` | **Dashboard** | Overnight scan summary, stat strip, top matches, live scan bars |
| `/discover` | **Discover** | Embedded-browser results + Search-controls dock (role/location/sites) |
| `/starred` | **Starred** | Match-tile grid; **Not interested** dismiss + **Restore N hidden** |
| `/job` | **Job detail** | Posting + Star score breakdown; → Tailor |
| `/tailor` | **Tailoring** | CV / Cover-letter tabs, AI-highlighted edits, suggestion cards |
| `/applications` | **Applications** | History table with working status filter (All/Applied/Interviewing/Offer) |
| `/profile` | **Profile** | CV upload, LinkedIn & site links, preferences, strength rail |
| `/settings` | **Settings** | OpenRouter key (Show/Hide + Test), scanning, **Job sites** (add/remove), **Backup folder** |
| `/onboarding` | **Onboarding** | Full-window 4-step first run (Upload → Review → Connect AI → Preferences) |

**Live interactions** (Pinia-backed): sidebar nav, Applications filter, Starred dismiss/restore, API-key reveal, Test connection, Job-sites add/remove, Tailor tabs, onboarding stepper, work-mode toggles.

---

## Project structure

```
app/
├── package.json
├── quasar.config.ts            # Quasar (Vite) config + brand colors + Electron target
├── tsconfig.json               # extends .quasar/tsconfig.json
├── index.html                  # loads Google Fonts (Instrument Serif / Hanken / JetBrains Mono)
├── postcss.config.js
├── src/
│   ├── App.vue
│   ├── env.d.ts
│   ├── css/
│   │   ├── app.scss            # design tokens (CSS vars) + utility classes + Quasar overrides
│   │   └── quasar.variables.scss   # SCSS brand variables ($primary terracotta, etc.)
│   ├── router/{index,routes}.ts
│   ├── stores/{index,app-store}.ts # Pinia store mirroring all prototype state
│   ├── types/models.ts         # Application, Match, ScanSource, Suggestion, status pill map
│   ├── data/sample.ts          # representative sample data (scan feed stand-in)
│   ├── components/
│   │   ├── StarRating.vue       # layered fractional star score (the brand motif)
│   │   ├── ScoreBar.vue         # labelled progress bar (olive / terracotta)
│   │   └── StatusPill.vue       # application status chip
│   ├── layouts/
│   │   └── MainLayout.vue       # window chrome + themed sidebar nav
│   └── pages/
│       ├── DashboardPage.vue   DiscoverPage.vue   StarredPage.vue
│       ├── JobDetailPage.vue   TailorPage.vue     ApplicationsPage.vue
│       ├── ProfilePage.vue     SettingsPage.vue   OnboardingPage.vue
└── src-electron/
    ├── electron-main.ts        # opens a 1320×880 window, hiddenInset title bar
    └── electron-preload.ts     # stub for safe bridges (CV picker, backup folder, key store)
```

---

## Design system (Studio)

Tokens live as CSS custom properties in `src/css/app.scss` and SCSS brand variables in
`src/css/quasar.variables.scss`.

- **Accent — terracotta** `#c2683a` (hover `#a8552d`, tint `#f3ede2`, highlight `#f6ebe0`). Marks the primary action and the star score — used sparingly.
- **Positive — olive** `#7a8b5a` (text `#5f6b3a`, tint `#eef0e3`).
- **Surfaces** `#fdfcf9` (app) · `#faf8f2` (rail/dock) · `#ffffff` (card) · `#f3f1ea` (canvas/titlebar).
- **Hairlines** `#ece8dd` / `#f0ece2`; input border `#e3ddd0`; strong border `#ddd5c4`.
- **Text** `#211f1d` → `#5a554a` → `#7d776a` → `#a39d8e` → `#bcb6a6`.
- **Type:** Instrument Serif (display/headings/large numbers), Hanken Grotesk (UI/body), JetBrains Mono (labels/numbers/URLs).
- **Status pills:** Saved/Applied/Interviewing/Offer/Rejected (see `types/models.ts`).

Principles: one accent used sparingly · hairlines over boxes (cards react on hover with a border shift, not shadow) · serif for moments, sans for work · the five-point star is the brand.

The Quasar theme is pointed at these colors via the `framework.config.brand` block in
`quasar.config.ts` and the SCSS variables, so `color="primary"` etc. render terracotta.

---

## Connecting it to real data

This scaffold ships with representative sample data so it runs immediately. To make it real:

- **Scan feed / matches / applications** — replace the arrays in `src/data/sample.ts` with results from the embedded-browser scraper + scoring service; the store getters (`visibleMatches`, etc.) and pages already consume them.
- **CV parsing** — wire the onboarding/Profile dropzones to a parser; populate the parsed-profile fields and skills.
- **OpenRouter** — store the key securely (Electron `safeStorage` via a preload bridge rather than in the renderer); use it for scoring and CV/letter drafting. The Settings key field + Test connection are the integration points.
- **Backup folder** — implement `chooseBackupFolder` / file writes in `src-electron` (see the preload stub) and trigger after each scan/application update.
- **Job sites** — the `sites` list in the store is the source of truth for which boards the embedded browser opens.

---

## Notes

- Router uses **hash history** so it works cleanly when loaded from `file://` inside Electron.
- The app is laid out at the design's native **1280-wide** window; the Starred grid is the one fluid area (`auto-fill, minmax(296px, 1fr)`).
- All names, companies, dates, and the sample API key are **placeholder data**.

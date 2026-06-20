# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

건강 다이어리 (Health Diary) is a **zero-dependency, single-page PWA** for tracking body weight, meals, and menstrual cycle around a calendar. There is no build step, no framework, and no backend — it is plain static HTML/CSS/vanilla JS served as files. All user data lives only in the browser's `localStorage` (key `health-diary-v1`); nothing is ever sent to a server. The UI language is Korean.

## Commands

This project has **no `package.json` and no build/lint tooling.** Everything runs directly.

```bash
# Run the app locally (any static server works; this one avoids file:// PWA limits)
python3 -m http.server 8000      # then open http://localhost:8000

# Run the end-to-end test suite (Playwright drives a real Chromium against file://index.html)
node selftest.mjs                # exits non-zero if any check fails

# Regenerate PWA icons + store screenshot from the inline SVG flower design
node make-icons.mjs              # rewrites icon-*.png, apple-touch-icon.png, screenshot-narrow.png
```

`selftest.mjs` and `make-icons.mjs` resolve `playwright` from the local `node_modules` first, then fall back to a global install at `/opt/node22/lib/node_modules/playwright`. There is no test runner — tests are a single imperative script. To run "one test", there is no filter flag; comment out or focus the relevant `check(...)`/section inside `selftest.mjs`. Test artifacts (`test-*.png`) are gitignored.

## Architecture

The entire application logic is one file, `app.js` (~970 lines), with no modules. Key structural facts that aren't obvious from a single read:

- **Single in-memory `db` object** mirrors the localStorage JSON. `loadDB()` merges stored data over `defaultData()` (so new fields added to the schema degrade safely); every mutation calls `saveDB()` immediately. The schema: `weights{ISO:number}`, `meals{ISO:{breakfast|lunch|dinner:{eaten,text}}}`, `periods[ISO...]` (cycle start dates), `periodLengths{startISO:days}` (per-cycle actual length), `relations{ISO:true}`, and `settings{cycleLength,periodLength,cycleManual}`.

- **`buildCycleMap()` is the heart of the cycle logic.** It returns an `ISO → "period"|"predicted"|"fertile"|"ovulation"` map driven from recorded `periods`, projecting ~18 future cycles forward at the average cycle length. Rules: ovulation = next period start − 14 days; fertile window = ovulation −5…+3 days; recorded periods use their stored `periodLengths`, projected ones use `averagePeriodLength()`. The calendar, the prediction summary, and the day-modal status text all derive from this one function — change it and all three update.

- **Dates are handled as local-time `YYYY-MM-DD` strings**, never as stored `Date` objects or UTC. Always go through the helpers `toISO` / `fromISO` / `addDays` / `daysBetween` / `todayISO` rather than constructing dates inline, to avoid timezone drift.

- **Cycle-length auto vs. manual:** with ≥2 recorded starts, `averageCycle()` auto-updates `settings.cycleLength`. Once the user edits the cycle field directly, `settings.cycleManual` latches true and auto-averaging stops overwriting it. Preserve this flag's semantics when touching settings.

- **Two UI surfaces, one render pipeline:** the three tabs (calendar / trends / settings) and a shared day-detail modal. `initAll()` is the full re-render entry point (also called after a backup restore). `renderCalendarView()` redraws calendar + prediction + notification state together. Trends and settings tabs re-render lazily on tab activation. The weight chart is hand-built SVG (polyline/area/dots) in `renderWeightChart()` — there is no charting library.

- **Modal accessibility is intentional:** the day modal implements a focus trap, Escape-to-close, and focus restoration to the originating calendar cell. Preserve these when editing modal markup/handlers.

## PWA wiring (cross-file contract)

Offline support and OS integration span `manifest.json`, `sw.js`, and `app.js` together:

- **Bump `CACHE_NAME` in `sw.js`** (currently `health-diary-v16`) whenever you change cached assets (`index.html`, `styles.css`, `app.js`, icons) — otherwise the old cache-first service worker serves stale files. The `activate` handler deletes all caches except the current name.
- **Backup file sharing has two inbound paths**, both ultimately calling `restoreFromText()` in `app.js`: the `file_handlers` path (opening a `.json` via `launchQueue`/`LaunchParams`) and the `share_target` path (another app POSTs a file → `sw.js` stashes it in the `shared-backup` cache → app reads it on `?shared=1`). The `manifest.json` `share_target.action` and `sw.js`'s `?share-target` check must stay in sync.
- Backup files are versioned (`{app:"health-diary", version:1, data:{...}}`); `normalizeBackup()` validates and sanitizes both this shape and the legacy bare-`db` shape, clamping all settings — keep it strict so a bad import never corrupts existing data (restore is confirm-gated and only overwrites after success).

## Conventions

- Comments, UI strings, and commit-relevant context are in **Korean**; match the existing voice when adding strings.
- The visual theme is a single red/black/white scale defined as CSS custom properties at the top of `styles.css` (`--accent`, `--period`, `--fertile`, etc.). Use these variables rather than hardcoding colors.
- After any user-facing change, run `node selftest.mjs` — it covers weight/meal/relation entry, cycle prediction math, period start/end editing, backup export/import (valid + rejected), persistence across reload, and asserts zero console errors.

# AGENTS: Control Centre Full App

Use this file as the baseline brief for AI coding agents to understand and extend the project end-to-end.

## Project Summary

- Product: Windows-only Electron tray app to control SteelSeries Arctis (headset/base + Sonar) and DDC/CI monitors.
- Stack: Electron main/preload processes + React/Vite renderer + native Node integrations (`node-hid`, vendored `@hensm/ddcci`).
- Runtime model: long-running background process (tray + services), UI windows are shown/hidden on demand.
- Entry points:
  - `electron/main.ts`
  - `electron/preload.ts`
  - `renderer/src/main.tsx` → `renderer/src/App.tsx`
- Shared contracts are in `shared/types.ts` and `shared/settings.ts`.

## Environment Setup (Windows)

- OS: Windows 10/11 (hard requirements for `node-hid`/DDC integration and process enumeration).
- Node.js: 20+.
- SteelSeries GG installed for Sonar API discovery.
- Build tools for native dependencies (C++ build tooling).

## Commands

- Install: `npm install`
- Dev: `npm run dev`
  - runs Vite (renderer), Electron TS watch, and Electron bootstrap (`scripts/dev-electron.cjs`).
- Typecheck: `npm run typecheck`
- Build renderer: `npm run build:renderer`
- Build electron TS: `npm run build:electron`
- Full package: `npm run build`

## Core Architecture

### 1) Main process (`electron/main.ts`)

- Owns lifecycle, tray, windows, persistence, service orchestration, IPC, and notification windows.
- Boot sequence:
  - load persisted snapshot (`electron/main.ts:342+`)
  - instantiate `ArctisApiService`, `DdcApiService`, `PresetSwitcherService`
  - wire backend + IPC
  - create flyout window and tray
  - preload settings window
- Background behavior:
  - closing main UI hides to tray; app continues running unless quit.
  - backend services continue refreshing state.
- Main state cache:
  - `cachedState`, `cachedPresets`, `settings`, logs, ddc cache, mixer state, etc.

### 2) Flyout/settings window management

- Main flyout window: `createFlyoutWindow` in `electron/window.ts`
- Settings window: `createCenteredWindow` in `electron/main.ts`
- Tray icon and menu: `electron/tray.ts`
- Window IPC control:
  - `window:open-settings`
  - `window:close-current`
  - `window:fit-content`
  - `window:set-pinned`
- `Esc` closes/hides main window.

### 3) Preload bridge (`electron/preload.ts`)

- Exposes a strict bridge at `window.arctisBridge` (no raw Node objects).
- Must stay in sync with:
  - `renderer/src/vite-env.d.ts` (types)
  - all call sites in renderer.

### 4) Renderer

- `renderer/src/App.tsx`: chooses dashboard/settings route by URL query.
- `renderer/src/state/store.ts`: central state/event hub (initial payload, subscriptions, settings/mixer actions).
- Pages/components:
  - Dashboard: `renderer/src/pages/DashboardPage.tsx`
  - Settings: `renderer/src/pages/SettingsPage.tsx`
  - Sonar widgets: `renderer/src/components/*`
  - Styles: `renderer/src/styles/*`

### 5) Services

- `electron/services/apis/arctis/service.ts`
  - Sonar endpoint discovery (`coreProps.json`)
  - Polling + state/preset refresh
  - channel operations (volume/mute/preset)
  - emits `state`, `presets`, `status`, `error`
- `electron/services/apis/arctis/baseStationEvents.ts`
  - HID polling of headset/basestation events (`node-hid`)
  - emits snapshot patch for battery/volume/connection-related metrics
- `electron/services/apis/ddc/service.ts`
  - wraps native ddcci backend into `DdcApiService`
  - list/set brightness/input source
- `electron/services/presetSwitcher/service.ts`
  - active-window preset switching via PowerShell process inspection
  - exposes active/open apps for settings UI
- `electron/services/shortcuts/service.ts`
  - global shortcut registration/unregister logic

## Shared Data Contracts

- `AppState` drives live UI/state sync (headset status + Sonar channel data + mixer-like values). See `shared/types.ts`.
- `UiSettings` includes:
  - visual settings, feature toggles, notification toggles, DDC settings, shortcuts, automatic preset rules.
- `Predefined defaults and sanitization` are in `shared/settings.ts`.
- `ChannelKey` channels: `master`, `game`, `chatRender`, `media`, `aux`, `chatCapture`.

## IPC Surface (reference)

- Render → Main handles in `electron/main.ts` and mirrored by `electron/preload.ts`:
  - app/status: `app:get-initial`, `services:get-status`, `app:open-gg`, `app:notify-*`
  - commands: `backend:command`, `window:open-settings`, `window:close-current`, `window:fit-content`, `window:set-pinned`, `settings:set`
  - mixer: `mixer:get-data`, `mixer:set-output`, `mixer:set-app-volume`, `mixer:set-app-mute`
  - ddc: `ddc:get-monitors`, `ddc:set-brightness`, `ddc:set-input-source`
- Main → Render events:
  - `backend:state`, `backend:presets`, `backend:status`, `backend:error`
  - `theme:update`, `settings:update`, `app:log`, `open-apps:update`, `ddc:update`

## Persistence

- State file: `%APPDATA%/....../app-state.json` (`electron/main.ts` via `app.getPath("userData")`).
- Includes merged state, presets, settings, logs, mixer state, DDC cache + timestamp, flyout bounds info.
- Auto-save is debounced in `persistNow()` / `schedulePersist()`.

## Native Assets and Build

- Assets:
  - app icon / tray icon files in `electron/assets/`
- Vendor native package:
  - `vendor/node-ddcci`
- Build output folders:
  - `.electron-build/` (compiled Electron JS)
  - `dist/` (Vite renderer build)
- Electron Builder config is in `package.json` `"build"`.

## Recommended Working Rules for Agents

1. Preserve process boundaries
   - Do not import renderer-only code into Electron main and vice versa.
   - Prefer adding shared contracts in `shared/*`.
2. Keep UI non-blocking
   - If opening windows/menus, avoid await chains that delay first paint.
   - DDC/background refreshes should be scheduled asynchronously.
3. Keep bridge changes consistent
   - Update `electron/preload.ts`, `renderer/src/vite-env.d.ts`, and consuming renderer types together.
4. Validate with typecheck after each feature change.
   - `npm run typecheck` is required baseline check.
5. Keep behavior stable when missing hardware/services
   - Arctis/DDC should degrade gracefully and continue with cached data + status updates.
6. Preserve notifications
   - Main process owns notification windows (no renderer-driven notifications).

## Quick Replication Checklist (new agent)

1. Clone repo and install deps.
2. Run `npm run typecheck` (baseline).
3. Run `npm run dev` on a Windows machine with SteelSeries GG + headphones/base.
4. Validate:
   - tray icon + menu
   - main window open/hide behavior
   - dashboard + settings windows
   - Sonar controls, DDC controls, mixer controls
   - notification delivery and settings toggles
5. Implement changes under feature-specific files and confirm bridge/state propagation path remains consistent.


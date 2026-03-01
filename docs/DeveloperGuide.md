# Control Centre Developer Guide

## 1. Tech Stack

- Electron (`electron/main.ts`, `electron/preload.ts`, `electron/window.ts`, `electron/tray.ts`)
- React 18 + Vite (`renderer/src`)
- TypeScript
- SCSS
- Native integrations:
  - `node-hid` (Arctis/headset event integration)
  - `@hensm/ddcci` (DDC/CI monitor control)

## 2. Prerequisites

- Windows 10/11
- Node.js 20+
- Visual Studio Build Tools (Desktop C++) for native module build
- SteelSeries GG installed for Sonar endpoints

## 3. Scripts

```powershell
npm run dev
```
- Starts renderer dev server, Electron TS watch, and Electron app launcher.

```powershell
npm run typecheck
```
- Runs TypeScript checking without emit.

```powershell
npm run build:renderer
npm run build:electron
```
- Builds renderer and Electron artifacts.

```powershell
npm run build
```
- Full build + packaging (electron-builder).

## 4. Directory Layout

- `electron/main.ts`: app lifecycle, IPC wiring, backend orchestration, persistence
- `electron/preload.ts`: secure bridge (`window.arctisBridge`) for renderer
- `electron/window.ts`: main dashboard window creation/sizing/position helpers
- `electron/tray.ts`: tray icon/menu loading logic
- `electron/services/apis/arctis/service.ts`: Sonar + headset polling/commands
- `electron/services/apis/ddc/service.ts`: native DDC service and monitor commands
- `renderer/src/App.tsx`: root app window-mode routing (`dashboard`/`settings`)
- `renderer/src/state/store.ts`: frontend state sync and optimistic UI actions
- `renderer/src/pages/*`: dashboard/settings pages
- `shared/types.ts`, `shared/settings.ts`: shared contract defaults + merges

## 5. Window Model

- Main dashboard window:
  - frameless, hidden by default, shown from tray
  - close intercepted to hide (app keeps running)
  - `Esc` hides it
- Settings window:
  - separate centered window
- Notifications:
  - independent transient BrowserWindows rendered from inline HTML

## 6. IPC Surface (Renderer Bridge)

Defined in `electron/preload.ts` and typed in `renderer/src/vite-env.d.ts`:

- Initialization/state:
  - `getInitial()`
  - `onState`, `onPresets`, `onStatus`, `onError`, `onTheme`, `onSettings`, `onLog`, `onDdcUpdate`
- App/window:
  - `openSettingsWindow()`
  - `closeCurrentWindow()`
  - `setFlyoutPinned()`
  - `openGG()`
  - `notifyCustom()`
- Sonar/backend:
  - `sendCommand({ name, payload })`
- Mixer:
  - `getMixerData()`
  - `setMixerOutput()`
  - `setMixerAppVolume()`
  - `setMixerAppMute()`
- DDC:
  - `getDdcMonitors()`
  - `setDdcBrightness()`
  - `setDdcInputSource()`

## 7. Persistence

Main process persists a single snapshot file in `app.getPath("userData")`:
- `app-state.json`

Persisted content includes:
- latest merged app state
- preset map
- UI settings
- logs/status/error
- mixer selections
- DDC monitor cache + timestamp
- pinned state

## 8. Renderer State Strategy

`useBridgeState()` uses:
- initial snapshot from main process for instant render
- event subscriptions for live updates
- short per-channel lock after local edits to prevent backend echo jitter

## 9. Notes on DDC Integration

- Service class: `DdcApiService`
- Backend: `NativeDdcciBackend`
- Supports monitor list, brightness set, input-source set
- Exposes monitor payload with fields used directly in Settings DDC JSON panel

## 10. Contributing Tips

- Keep shared contracts in `shared/types.ts` authoritative.
- Any preload bridge change must update:
  - `electron/preload.ts`
  - `renderer/src/vite-env.d.ts`
  - call sites in renderer store/components
- Validate with `npm run typecheck` after changes.


# Architecture

## 1. High-Level Overview

Control Centre has three layers:

1. Electron main process
- owns app lifecycle, windows, tray, persistence, native backends

2. Preload bridge
- exposes a typed, minimal IPC API (`window.arctisBridge`)

3. React renderer
- dashboard/settings UI
- optimistic user interactions and live state rendering

## 2. Runtime Data Flow

1. `electron/main.ts` boots services:
- `ArctisApiService` (Sonar/headset)
- `DdcApiService` (DDC/CI)

2. Main process loads persisted snapshot (`app-state.json`) and serves it via `app:get-initial`.

3. Renderer loads immediately with snapshot data.

4. Services emit updates:
- Arctis -> `backend:state`, `backend:presets`, `backend:status`, `backend:error`
- DDC cache refresh -> `ddc:update`

5. Renderer actions send commands through IPC:
- Sonar commands: `backend:command`
- settings updates: `settings:set`
- mixer updates
- DDC write operations

6. Main process debounces persistence and rebroadcasts settings/theme/state updates.

## 3. Window Lifecycle

### Main Dashboard
- Created once at startup
- Hidden by default, shown from tray
- Close event intercepted and converted to hide-to-tray
- `Esc` key hides window

### Settings
- Created lazily when opened
- Reused while open

### Notifications
- Short-lived BrowserWindows
- Stacked in top-right work area
- Auto-close after configured timeout

## 4. Service Internals

### Arctis API Service
- Discovers Sonar endpoint from GG metadata
- Polls frequently for volume/mute/chat-mix/routed apps/presets
- Merges base-station event data into app state
- Emits normalized state and preset map

### DDC API Service
- Loads `@hensm/ddcci` backend
- Enumerates monitors and VCP capabilities
- Supports:
  - list monitors
  - set brightness (`0x10`)
  - set input source (`0x60`)

## 5. State Model

Shared state contracts live in:
- `shared/types.ts`
- `shared/settings.ts`

Key structures:
- `AppState`: telemetry + per-channel sonar values
- `UiSettings`: theme, layout, notifications, DDC config
- `PresetMap`: channel -> list of `[id, name]`

## 6. Theming

Main process sends:
- current dark/light mode (`nativeTheme`)
- accent color (Windows DWM registry)

Renderer applies CSS variables and `data-theme` at document root.


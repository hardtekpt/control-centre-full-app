# Control Centre — CLAUDE.md

## Project Overview

Windows-only Electron + React tray application for controlling SteelSeries Arctis Nova headsets and SteelSeries Sonar audio software. Features DDC/CI monitor control, automatic preset switching, global shortcuts, and custom notifications.

**Stack:** Electron 34, React 18, TypeScript 5 (strict), Vite 6, Tailwind CSS 4, SCSS, node-hid, @hensm/ddcci.

---

## Commands

```bash
# Development
npm run dev                # Start full dev environment (Vite HMR + tsc watch + Electron)
npm run dev:renderer       # Vite dev server only (port 5180)

# Build
npm run build              # Full production build → NSIS installer
npm run build:renderer     # Vite bundle → dist/
npm run build:electron     # tsc compile → .electron-build/

# Type checking
npm run typecheck          # tsc --noEmit (no output, just check)

# Utilities
npm run clean:electron-build   # Remove .electron-build/
npm run free:dev-port          # Free up port 5180
```

**Dev flow:** Vite serves renderer on `http://localhost:5180`. TypeScript watch compiles main/preload to `.electron-build/`. Electron loads the compiled main + dev renderer URL.

**Build output:** `dist/` (renderer), `.electron-build/` (main/preload), packaged installer via electron-builder.

---

## Architecture

```
src/
├── main/               # Electron main process (Node.js)
│   ├── index.ts        # App entry: window management, service orchestration, IPC routing
│   ├── ipc/            # IPC handler factories grouped by domain
│   └── services/       # Background services (APIs, notifications, persistence)
│       ├── apis/arctis/ # Sonar API polling + HID events (base station)
│       ├── apis/ddc/    # DDC/CI monitor control
│       ├── notifications/ # Notification window + timer services
│       ├── oled/        # Base station OLED display
│       ├── presetSwitcher/ # Active app detection + preset application
│       ├── shortcuts/   # Global keyboard shortcut registration
│       └── persistence/ # State/settings persistence to %APPDATA%
├── preload/
│   └── index.ts        # Context bridge: exposes window.arctisBridge to renderer
├── renderer/src/        # React application
│   ├── App.tsx          # Route based on ?window= query param
│   ├── components/      # Dashboard, settings tabs, monitor controls, icons
│   ├── pages/           # DashboardPage.tsx, SettingsPage.tsx
│   ├── stores/store.ts  # useBridgeState() — central IPC ↔ React state hook
│   ├── hooks/           # useIpc() for typed channel invocations
│   └── styles/          # SCSS component styles + Tailwind entry
└── shared/
    ├── types.ts         # AppState, UiSettings, BackendCommand, PresetMap interfaces
    ├── settings.ts      # DEFAULT_STATE, DEFAULT_SETTINGS, mergeState(), mergeSettings()
    └── ipc.ts           # IPC_INVOKE / IPC_SEND / IPC_EVENT channel maps + payload types
```

---

## Key Files

| File | Role |
|------|------|
| `src/main/index.ts` | Monolithic main process (~5K lines): lifecycle, windows, state, IPC wiring |
| `src/preload/index.ts` | Security boundary — exposes `window.arctisBridge: ArctisBridgeApi` |
| `src/shared/ipc.ts` | **Single source of truth** for all IPC channels and payload types |
| `src/shared/types.ts` | All domain types: AppState, UiSettings, BackendCommand, channels |
| `src/shared/settings.ts` | Defaults, deep merge, sanitisation, and field migration logic |
| `src/renderer/src/stores/store.ts` | `useBridgeState()` hook — all renderer state lives here |
| `src/main/ipc/registerCoreHandlers.ts` | Registers all IPC handler factories |

---

## App Behaviour (from agents/app_behaviour.md)

Background services run **independently** of UI windows:
- **Sonar (Arctis API):** polls on a configurable slow interval and after write commands
- **HID Events:** high-frequency polling for headset/base station hardware events
- **Notifications:** independent service, listens for events, triggers custom notification windows
- **Automatic Preset Switcher:** monitors active window, applies matching preset
- **Shortcuts:** global keyboard shortcut listener, runs configured actions
- **DDC:** polls monitor state on configurable interval and after write commands

The app state updates in the background. The renderer receives state via IPC events (`backend:state`, etc.) — the window reflects current state when it opens or when state changes while it is open.

**Do not merge Sonar API data with HID snapshot** — they are updated separately and must remain independent.

---

## Coding Conventions

### TypeScript
- Strict mode on in all `tsconfig` files — no `any`, no implicit `any`
- Path alias `@shared/*` → `src/shared/*` (available in both renderer and main)
- All IPC channels accessed through typed maps (`IPC_INVOKE`, `IPC_SEND`, `IPC_EVENT`) — never string literals

### Naming
- **IPC channels:** `domain:action` — e.g., `mixer:set-app-volume`, `window:open-settings`
- **Services:** `*Service` class suffix extending `EventEmitter`
- **IPC handler factories:** `create*IpcHandlers(deps)` — inject dependencies, return nothing
- **Components:** PascalCase — e.g., `ChannelRow`, `MonitorControlsCard`
- **Hooks:** `use*` — e.g., `useBridgeState`, `useIpc`
- **Constants:** UPPER_SNAKE_CASE — e.g., `CHANNELS`, `DEFAULT_SETTINGS`
- **Variables/functions:** camelCase

### Patterns
- **Services:** extend `EventEmitter`, expose `start()` / `stop()` / `configureRuntime()` / `getRuntimeStatus()`
- **IPC handlers:** factory functions with dependency injection; registered in `registerCoreHandlers.ts`
- **State updates:** always use `mergeState()` / `mergeSettings()` from `shared/settings.ts` — never assign partial objects directly
- **Write locks:** renderer uses per-channel `lockedUntilRef` to prevent UI flicker during Sonar acknowledgment lag
- **Persistence:** debounced via `schedulePersist()`, stored at `%APPDATA%/Control Centre/app-state.json`
- **Windows:** flyout (main) + settings window + transient notification windows — app hides to tray on close

### IPC
- **Renderer → Main (async):** `window.arctisBridge.invoke(IPC_INVOKE.xxx, payload)`
- **Renderer → Main (fire-and-forget):** `window.arctisBridge.send(IPC_SEND.xxx, payload)`
- **Main → Renderer (broadcast):** `webContents.send(IPC_EVENT.xxx, payload)` — sent to all open windows
- Adding a new channel: define in `shared/ipc.ts`, implement handler in appropriate `src/main/ipc/*Handlers.ts`, expose in `src/preload/index.ts`

---

## State & Settings

- `AppState` — live headset/mixer snapshot; never persisted as source of truth (rebuilt from services)
- `UiSettings` — user preferences; persisted; always pass through `mergeSettings()` before saving
- `PresetMap` — Sonar preset definitions per channel; separate from state
- `DEFAULT_STATE` and `DEFAULT_SETTINGS` in `shared/settings.ts` are the canonical empty values
- `mergeSettings()` clamps numeric fields, filters invalid entries, and handles legacy field migration

---

## Services Summary

| Service | Location | Trigger |
|---------|----------|---------|
| Arctis API (Sonar) | `services/apis/arctis/service.ts` | Poll + command |
| HID Events | `services/apis/arctis/baseStationEvents.ts` | Hardware events |
| DDC API | `services/apis/ddc/service.ts` | Poll + command |
| Notifications | `services/notifications/` | App events |
| OLED Display | `services/oled/service.ts` | Interval |
| Preset Switcher | `services/presetSwitcher/service.ts` | Active window change |
| Shortcuts | `services/shortcuts/service.ts` | Key press |
| Persistence | `services/persistence/service.ts` | Debounced writes |

---

## Platform Notes

- **Windows 10/11 only** — native deps (`node-hid`, `@hensm/ddcci`) are Windows-specific
- Vendored DDC module at `vendor/node-ddcci/` — not from npm, unpacked from ASAR at runtime
- `scripts/` and `vendor/` are ASAR-unpacked so native `.node` binaries are accessible
- Electron builder target: Windows NSIS installer (`com.control.centre`)

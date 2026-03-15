# Control Centre

Control Centre is a Windows Electron + React desktop app for SteelSeries Arctis devices and Sonar.

It runs in the tray, opens a compact dashboard window, and lets you:
- monitor headset/base status
- control Sonar channel volume/mute/presets
- manage per-app levels in a Windows mixer view
- inspect and control DDC/CI monitor values

## Documentation

- User guide: [docs/UserGuide.md](docs/UserGuide.md)
- Developer guide: [docs/DeveloperGuide.md](docs/DeveloperGuide.md)
- Architecture and data flow: [docs/Architecture.md](docs/Architecture.md)
- Troubleshooting: [docs/Troubleshooting.md](docs/Troubleshooting.md)

## System Requirements

- Windows 10/11
- Node.js 20+
- SteelSeries GG installed (for Sonar integration)
- Native build prerequisites for `node-hid` and `@hensm/ddcci`:
  - Visual Studio Build Tools (Desktop development with C++)

## Install

```powershell
npm install
```

## Run in Development

```powershell
npm run dev
```

This starts:
- Vite dev server (`renderer`)
- TypeScript watch for Electron main/preload
- Electron process launcher (`scripts/dev-electron.cjs`)

## Build

Renderer + Electron compile:

```powershell
npm run build:renderer
npm run build:electron
```

Create installer/exe package:

```powershell
npm run build
```

## Runtime Behavior (Current)

- App stays in tray while backend continues running.
- Closing the main dashboard hides it to tray instead of exiting.
- `Esc` closes (hides) the main dashboard window.
- Main dashboard is positioned bottom-right when created and when flyout size changes.
- Settings open in a separate window.
- Notifications use dedicated transient windows.

## Project Structure

- `src/main/`: main process, tray, windows, IPC, backend service wiring
- `src/preload/`: context bridge between renderer and main
- `src/renderer/`: React UI, pages/components, styles, Vite config
- `src/shared/`: shared types/settings schema + merge helpers
- `src/main/services/apis/arctis/`: Sonar + headset integration layer
- `src/main/services/apis/ddc/`: native DDC/CI integration layer
- `vendor/node-ddcci/`: vendored DDC native module source

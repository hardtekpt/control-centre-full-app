# Control Centre User Guide

## 1. What This App Does

Control Centre is a tray app for SteelSeries Arctis + Sonar on Windows.

It provides:
- live headset/base telemetry
- Sonar channel controls (volume, mute, preset)
- Windows mixer controls for per-app audio levels
- DDC monitor inspection and controls (brightness/input source)

## 2. Installation

### Prerequisites
- Windows 10/11
- SteelSeries GG installed and running
- Node.js 20+ (if you run from source)

### Install From Source
1. Open a terminal in the project folder.
2. Run:

```powershell
npm install
```

## 3. Launching

### Development

```powershell
npm run dev
```

### Packaged Build
Run the generated executable from the build output after `npm run build`.

## 4. Main Window Behavior

- The app lives in the system tray.
- Clicking the tray icon opens the main dashboard.
- Clicking the window close button hides the dashboard (app keeps running).
- Press `Esc` to close/hide the dashboard quickly.
- The dashboard opens near the bottom-right of the screen.

## 5. Dashboard Features

### Top Bar
- Connection indicators: connected, wireless, Bluetooth
- Battery indicators: headset and base battery
- Last update time
- Buttons:
  - Open SteelSeries GG
  - Pin/unpin window
  - Open Settings

### Status Card
- ANC mode
- OLED brightness
- Sidetone level
- Headset volume
- Chat mix
- Mic state

### Sonar Channels Tab
- Channels: Master, Game, Chat, Media, Aux, Mic
- Per-channel controls:
  - volume slider
  - mute toggle
  - preset dropdown (favorite presets)
  - routed apps list

### Windows Mixer Tab
- Output selection
- Per-app volume sliders
- Per-app mute toggles

## 6. Settings Window

### App Tab
- Theme mode (System/Light/Dark)
- Accent color (or use system accent)
- Text size
- Battery percent visibility
- Global toggle shortcut

### GG Sonar Tab
- Show/hide Sonar channels in the dashboard

### Notifications Tab
- Notification timeout
- Enable/disable notification groups
- Send a test notification

### DDC Tab
- Last monitor-data update timestamp
- Refresh button
- Full monitor payload as formatted JSON
- Scrollable JSON area for large payloads

### About Tab
- App + backend status summary
- Arctis and DDC service status cards
- Runtime logs

## 7. Data Persistence

The app keeps a local cache/settings snapshot in Windows user data so it can render quickly using last known values on startup.

## 8. Exit the App Fully

Use tray menu `Quit` to stop background services and close the app completely.


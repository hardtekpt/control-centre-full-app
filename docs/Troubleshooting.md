# Troubleshooting

## 1. App Runs But Windows Do Not Show (Notifications Still Work)

Checks:
1. Confirm renderer build exists (`dist/index.html`) for packaged mode.
2. Verify preload path in Electron build output (`.electron-build/electron/preload.js`).
3. Ensure `loadWindowPage()` query uses `dashboard` or `settings`.
4. Check logs in About tab for renderer crash/unresponsive messages.

## 2. Tray Icon Is Missing or Fallback Icon Is Used

Checks:
1. Confirm icon files exist:
   - `electron/assets/tray-icon.png`
   - `electron/assets/tray-icon.svg`
2. Keep PNG available; Windows tray rendering is most reliable with bitmap formats.
3. Rebuild Electron output after icon changes.

## 3. DDC Monitor Data Is Empty or Fails

Checks:
1. Ensure monitor supports DDC/CI and DDC/CI is enabled in monitor OSD.
2. Confirm native module was built successfully during `npm install`.
3. Open Settings > DDC and inspect:
   - last updated timestamp
   - JSON payload
   - backend status in About tab
4. If needed, reinstall deps with Visual Studio Build Tools installed.

## 4. Sonar Preset Appears Applied But UI Label Resets

The app preserves optimistic preset selection briefly, then reconciles with live Sonar state.

Checks:
1. Verify selected preset exists in Sonar favorites.
2. Confirm `backend:presets` data includes expected preset id/name.
3. Check About logs for Sonar endpoint errors.

## 5. Build Window Size Differs From Dev

Common causes:
1. Different persisted `flyoutWidth`/`flyoutHeight` in `app-state.json`.
2. Different Windows display scale/DPI context.
3. Missing CSS/build mismatch.

Mitigation:
1. Open Settings and set desired dimensions.
2. Rebuild renderer + electron.

## 6. Main Window Flicker on Open

Known mitigations already implemented:
- no blur/mica effects
- no open animations
- `paintWhenInitiallyHidden: true`
- avoid repositioning on every open

If it regresses:
1. Test with static placeholder content first.
2. Disable incremental reopen logic to isolate compositor behavior.
3. Re-enable features one by one (positioning, dynamic data binding, effects).


import { BrowserWindow, Rectangle, screen } from "electron";
import * as path from "node:path";
import type { UiSettings } from "@shared/types";

// Keep flyout size persistence bounded to sane desktop limits.
const MIN_W = 320;
const MAX_W = 4096;
const MIN_H = 260;
const MAX_H = 2160;

export function createFlyoutWindow(settings: UiSettings): BrowserWindow {
  const win = new BrowserWindow({
    width: clamp(settings.flyoutWidth, MIN_W, MAX_W),
    height: clamp(settings.flyoutHeight, MIN_H, MAX_H),
    minWidth: MIN_W,
    maxWidth: MAX_W,
    minHeight: MIN_H,
    maxHeight: MAX_H,
    show: false,
    // Allow the first show() to present an already-painted frame.
    paintWhenInitiallyHidden: true,
    center: true,
    frame: false,
    transparent: false,
    backgroundColor: "#1f1f1f",
    resizable: false,
    skipTaskbar: false,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  return win;
}

export function positionBottomRight(win: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const bounds = display.workArea;
  const windowBounds = win.getBounds();
  const margin = 8;
  const x = bounds.x + bounds.width - windowBounds.width - margin;
  const y = bounds.y + bounds.height - windowBounds.height - margin;
  win.setPosition(x, y, false);
}

export function saveWindowBounds(win: BrowserWindow, settings: UiSettings): UiSettings {
  const b: Rectangle = win.getBounds();
  return {
    ...settings,
    flyoutWidth: clamp(b.width, MIN_W, MAX_W),
    flyoutHeight: clamp(b.height, MIN_H, MAX_H),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

import { BrowserWindow, type Display } from "electron";
import type { UiSettings } from "../../../shared/types";

interface NotificationThemePayload {
  isDark: boolean;
  accent: string;
}

interface NotificationVisualTheme {
  accent: string;
  shellBg: string;
  textColor: string;
  subText: string;
  borderColor: string;
  cardBg: string;
}

export interface CreateNotificationWindowServiceDeps {
  getThemePayload: () => Promise<NotificationThemePayload>;
  resolveDisplay: () => Display;
  getThemeMode: () => UiSettings["themeMode"];
  getAccentColor: () => string;
  getTimeoutSeconds: () => number;
}

export interface NotificationWindowService {
  showNotification: (title: string, body: string) => Promise<void>;
  getWindows: () => BrowserWindow[];
  closeAll: () => void;
}

const MIN_TIMEOUT_SECONDS = 2;

/**
 * Manages ephemeral top-right stacked notification windows for app-level info/errors.
 */
export function createNotificationWindowService(deps: CreateNotificationWindowServiceDeps): NotificationWindowService {
  const { getThemePayload, resolveDisplay, getThemeMode, getAccentColor, getTimeoutSeconds } = deps;
  let windows: BrowserWindow[] = [];

  /**
   * Repositions active notification windows in a top-right stack for the current display.
   */
  function relayout(): void {
    const display = resolveDisplay();
    const workArea = display.workArea;
    const margin = 12;
    let y = workArea.y + margin;

    for (const win of windows.filter((candidate) => !candidate.isDestroyed())) {
      const bounds = win.getBounds();
      const x = workArea.x + workArea.width - bounds.width - margin;
      win.setPosition(x, y, false);
      y += bounds.height + 10;
    }

    windows = windows.filter((candidate) => !candidate.isDestroyed());
  }

  /**
   * Escapes untrusted text before embedding it in an HTML template.
   */
  function escapeHtml(value: string): string {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  /**
   * Resolves concrete colors for the notification template based on system/app theme settings.
   */
  function resolveVisualTheme(themePayload: NotificationThemePayload): NotificationVisualTheme {
    const themeMode = getThemeMode();
    const isDark = themeMode === "system" ? themePayload.isDark : themeMode === "dark";
    const accent = getAccentColor().trim() || themePayload.accent;

    return {
      accent,
      shellBg: isDark ? "rgba(24,24,24,0.86)" : "rgba(248,248,248,0.92)",
      textColor: isDark ? "#ffffff" : "#111111",
      subText: isDark ? "rgba(255,255,255,0.78)" : "rgba(0,0,0,0.72)",
      borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.28)",
      cardBg: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.45)",
    };
  }

  /**
   * Builds the data-URL HTML payload rendered in each transient notification window.
   */
  function buildNotificationHtml(title: string, body: string, theme: NotificationVisualTheme): string {
    return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        body {
          color: ${theme.textColor};
          padding: 0;
        }
        .shell {
          margin: 0;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 12px;
          background: ${theme.shellBg};
          border: 1px solid ${theme.borderColor};
          box-shadow: 0 10px 24px rgba(0,0,0,0.28), inset 0 0 0 0.5px ${theme.borderColor};
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 10px;
          align-items: start;
          padding: 10px 12px;
        }
        .mark {
          width: 30px;
          height: 30px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: color-mix(in srgb, ${theme.accent} 24%, transparent);
          color: ${theme.accent};
          font-size: 14px;
          font-weight: 700;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, ${theme.accent} 46%, transparent);
        }
        .copy {
          min-width: 0;
        }
        .title {
          font-size: 14px;
          font-weight: 700;
          line-height: 1.2;
          margin-bottom: 4px;
        }
        .body {
          font-size: 12px;
          line-height: 1.35;
          color: ${theme.subText};
          white-space: pre-wrap;
          word-break: break-word;
        }
        .body-card {
          background: ${theme.cardBg};
          border-radius: 8px;
          padding: 8px 9px;
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <div class="mark">A</div>
        <div class="copy">
          <div class="title">${escapeHtml(title)}</div>
          <div class="body-card">
            <div class="body">${escapeHtml(body)}</div>
          </div>
        </div>
      </div>
    </body>
  </html>`;
  }

  /**
   * Creates one browser window configured for non-interactive toast notifications.
   */
  function createNotificationWindow(): BrowserWindow {
    return new BrowserWindow({
      width: 340,
      height: 108,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      hasShadow: true,
    });
  }

  /**
   * Schedules automatic close for a notification window based on current settings.
   */
  function scheduleAutoClose(win: BrowserWindow): void {
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.close();
      }
    }, Math.max(MIN_TIMEOUT_SECONDS, getTimeoutSeconds()) * 1000);
  }

  async function showNotification(title: string, body: string): Promise<void> {
    if (!title.trim() && !body.trim()) {
      return;
    }

    const themePayload = await getThemePayload();
    const visualTheme = resolveVisualTheme(themePayload);
    const html = buildNotificationHtml(title, body, visualTheme);

    const win = createNotificationWindow();
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    windows.push(win);
    relayout();

    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const showPopup = () => {
      if (win.isDestroyed()) {
        return;
      }
      relayout();
      win.show();
      win.setFocusable(false);
      win.setIgnoreMouseEvents(true);
      scheduleAutoClose(win);
    };

    win.once("ready-to-show", showPopup);
    win.webContents.once("did-finish-load", () => {
      if (!win.isVisible()) {
        showPopup();
      }
    });
    win.on("closed", () => {
      windows = windows.filter((candidate) => candidate !== win);
      relayout();
    });
  }

  function getWindows(): BrowserWindow[] {
    return windows.filter((win) => !win.isDestroyed());
  }

  function closeAll(): void {
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.close();
      }
    }
    windows = [];
  }

  return {
    showNotification,
    getWindows,
    closeAll,
  };
}

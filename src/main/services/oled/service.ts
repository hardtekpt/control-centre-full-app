import { EventEmitter } from "node:events";
import type { AppState } from "../../../shared/types";

const STEELSERIES_VENDOR_ID = 0x1038;
const SUPPORTED_PRODUCT_IDS = new Set([0x12cb, 0x12cd, 0x12e0, 0x12e5, 0x225d]);
const INTERFACE_NUMBER = 4;

const SCREEN_WIDTH = 128;
const SCREEN_HEIGHT = 64;
const SCREEN_REPORT_SPLIT_WIDTH = 64;
const SCREEN_REPORT_SIZE = 1024;

const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT_SPACING = 1;
const REFRESH_THROTTLE_MS = 350;

type HidDeviceInfo = {
  vendorId?: number;
  productId?: number;
  interface?: number;
  path?: string;
};

type HidHandle = {
  sendFeatureReport: (data: number[] | Buffer) => number;
  write: (data: number[] | Buffer) => number;
  close: () => void;
};

type HidModule = {
  devices: () => HidDeviceInfo[];
  HID: new (path: string, options?: { nonExclusive?: boolean }) => HidHandle;
};

export interface OledServiceFrame {
  line1: string;
  line2: string;
  generatedAtIso: string;
}

export interface BaseStationOledConfig {
  enabled: boolean;
  refreshIntervalMs: number;
  showHeadsetVolume: boolean;
  showMicMuteStatus: boolean;
  showAncMode: boolean;
  showBatteryInfo: boolean;
  showChatMix: boolean;
  showCustomNotifications: boolean;
  customNotificationDurationMs: number;
}

interface CustomOledNotification {
  title: string;
  body: string;
  expiresAt: number;
}

/** Notification kind used by the typed OLED notification renderer. */
export type OledNotificationKind =
  | "connectivity"
  | "usbInput"
  | "ancMode"
  | "sidetone"
  | "micMute"
  | "headsetChatMix"
  | "headsetVolume"
  | "battery"
  | "presetChange"
  | "oled"
  | "appInfo"
  | "generic";

interface TypedOledNotification {
  kind: OledNotificationKind;
  /** Short uppercase label shown in the inverted header band. */
  header: string;
  /** Main label line below the icon. */
  title: string;
  /** Value string (e.g. "85%" or "MUTED"). */
  valueText: string;
  /** 0-100 for animated progress bar; null skips the bar. */
  valuePercent: number | null;
  expiresAt: number;
  /** Incremented each render frame — drives the progress bar grow-in animation. */
  animFrameIndex: number;
}

const DEFAULT_CONFIG: BaseStationOledConfig = {
  enabled: false,
  refreshIntervalMs: 15_000,
  showHeadsetVolume: true,
  showMicMuteStatus: true,
  showAncMode: true,
  showBatteryInfo: true,
  showChatMix: true,
  showCustomNotifications: false,
  customNotificationDurationMs: 5_000,
};

const EMPTY_APP_STATE: AppState = {
  headset_battery_percent: null,
  base_battery_percent: null,
  base_station_connected: null,
  current_usb_input: null,
  headset_volume_percent: null,
  anc_mode: null,
  mic_mute: null,
  sidetone_level: null,
  connected: null,
  wireless: null,
  bluetooth: null,
  chat_mix_balance: null,
  oled_brightness: null,
  channel_volume: {},
  channel_mute: {},
  channel_preset: {},
  channel_apps: {},
  updated_at: null,
};

export class BaseStationOledService extends EventEmitter {
  private config: BaseStationOledConfig = { ...DEFAULT_CONFIG };
  private appState: AppState = { ...EMPTY_APP_STATE };
  private timer: NodeJS.Timeout | null = null;
  private pendingRefreshTimer: NodeJS.Timeout | null = null;
  private running = false;
  /** True while a one-shot notification is being delivered with the display loop stopped. */
  private oneShotActive = false;
  private oneShotCleanupTimer: NodeJS.Timeout | null = null;
  private hid: HidModule | null = null;
  private lastFrame: OledServiceFrame | null = null;
  private lastError = "";
  private lastPublishAt = 0;
  private customNotification: CustomOledNotification | null = null;
  private typedNotification: TypedOledNotification | null = null;

  public configure(partial: Partial<BaseStationOledConfig>): void {
    const previousInterval = this.config.refreshIntervalMs;
    this.config = {
      ...this.config,
      ...partial,
      refreshIntervalMs: clampRefreshInterval(partial.refreshIntervalMs ?? this.config.refreshIntervalMs),
      showHeadsetVolume: partial.showHeadsetVolume ?? this.config.showHeadsetVolume,
      showMicMuteStatus: partial.showMicMuteStatus ?? this.config.showMicMuteStatus,
      showAncMode: partial.showAncMode ?? this.config.showAncMode,
      showBatteryInfo: partial.showBatteryInfo ?? this.config.showBatteryInfo,
      showChatMix: partial.showChatMix ?? this.config.showChatMix,
      showCustomNotifications: partial.showCustomNotifications ?? this.config.showCustomNotifications,
      customNotificationDurationMs: clampNotificationDuration(
        partial.customNotificationDurationMs ?? this.config.customNotificationDurationMs,
      ),
      enabled: partial.enabled ?? this.config.enabled,
    };
    if (!this.config.showCustomNotifications) {
      this.clearOneShotCleanup();
      this.customNotification = null;
      this.typedNotification = null;
    }
    if (this.running && previousInterval !== this.config.refreshIntervalMs) {
      this.restartTimer();
    }
    if (this.running) {
      this.requestRefresh(true);
    }
  }

  public updateState(state: AppState): void {
    this.appState = { ...this.appState, ...state };
    if (this.running) {
      this.requestRefresh(false);
    }
  }

  public showCustomNotification(title: string, body: string): void {
    if (!this.config.showCustomNotifications) {
      return;
    }
    const safeTitle = normalizeFrameLine(title, 20) || "CONTROL CENTRE";
    const safeBody = normalizeFrameLine(body, 20) || "NOTIFICATION";
    this.customNotification = {
      title: safeTitle,
      body: safeBody,
      expiresAt: Date.now() + this.config.customNotificationDurationMs,
    };
    if (this.running) {
      this.requestRefresh(true);
    } else {
      void this.startOneShot();
    }
  }

  /**
   * Shows a semantically typed OLED notification with a dedicated layout:
   * an inverted header band, an icon, label + value text, and an animated
   * progress bar that sweeps in over ~700 ms.
   *
   * Typed notifications take priority over legacy showCustomNotification calls.
   * The caller is responsible for checking that the notification type is enabled
   * in settings before calling this method.
   */
  public showTypedNotification(
    kind: OledNotificationKind,
    title: string,
    valueText: string,
    valuePercent?: number,
  ): void {
    if (!this.config.showCustomNotifications) {
      return;
    }
    this.typedNotification = {
      kind,
      header: normalizeFrameLine(headerForKind(kind), 20),
      title: normalizeFrameLine(title, 14),
      valueText: normalizeFrameLine(valueText, 10),
      valuePercent:
        typeof valuePercent === "number" && Number.isFinite(valuePercent) ? clampPercent(valuePercent) : null,
      expiresAt: Date.now() + this.config.customNotificationDurationMs,
      animFrameIndex: 0,
    };
    this.customNotification = null;
    if (this.running) {
      this.requestRefresh(true);
      // Drive 3 rapid re-renders so the progress bar animates on-screen.
      this.scheduleAnimFrame(180);
      this.scheduleAnimFrame(360);
      this.scheduleAnimFrame(540);
    } else {
      void this.startOneShot();
    }
  }

  private scheduleAnimFrame(delayMs: number): void {
    setTimeout(() => {
      if (!this.typedNotification || Date.now() >= this.typedNotification.expiresAt) {
        return;
      }
      if (this.running) {
        this.requestRefresh(true);
      } else if (this.oneShotActive) {
        void this.publishFrame(true);
      }
    }, delayMs);
  }

  /**
   * Delivers a notification frame directly to the device without the display
   * loop running, then returns the display to SteelSeries after it expires.
   */
  private async startOneShot(): Promise<void> {
    this.clearOneShotCleanup();
    this.oneShotActive = true;
    this.ensureHidLoaded();
    void this.publishFrame(true);
    // Drive 3 rapid re-renders for progress bar animation.
    this.scheduleAnimFrame(180);
    this.scheduleAnimFrame(360);
    this.scheduleAnimFrame(540);
    this.oneShotCleanupTimer = setTimeout(() => {
      this.oneShotCleanupTimer = null;
      this.oneShotActive = false;
      this.typedNotification = null;
      this.customNotification = null;
      if (!this.running) {
        this.returnToSteelSeriesUi();
      }
    }, this.config.customNotificationDurationMs + 100);
  }

  private clearOneShotCleanup(): void {
    if (this.oneShotCleanupTimer) {
      clearTimeout(this.oneShotCleanupTimer);
      this.oneShotCleanupTimer = null;
    }
    this.oneShotActive = false;
  }

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.ensureHidLoaded();
    this.emit("status", `Base Station OLED service started (${Math.round(this.config.refreshIntervalMs / 1000)}s interval).`);
    this.restartTimer();
    this.requestRefresh(true);
  }

  public stop(): void {
    if (!this.running && !this.timer && !this.pendingRefreshTimer && !this.oneShotActive) {
      return;
    }
    this.running = false;
    this.clearOneShotCleanup();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pendingRefreshTimer) {
      clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = null;
    }
    this.customNotification = null;
    this.typedNotification = null;
    this.returnToSteelSeriesUi();
    this.emit("status", "Base Station OLED service stopped.");
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getLastFrame(): OledServiceFrame | null {
    return this.lastFrame ? { ...this.lastFrame } : null;
  }

  public getLastError(): string | null {
    return this.lastError || null;
  }

  private restartTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timer = setInterval(() => {
      this.requestRefresh(true);
    }, this.config.refreshIntervalMs);
  }

  private requestRefresh(force: boolean): void {
    if (!this.running) {
      return;
    }
    const now = Date.now();
    if (force || now - this.lastPublishAt >= REFRESH_THROTTLE_MS) {
      if (this.pendingRefreshTimer) {
        clearTimeout(this.pendingRefreshTimer);
        this.pendingRefreshTimer = null;
      }
      void this.publishFrame();
      return;
    }
    if (this.pendingRefreshTimer) {
      return;
    }
    const wait = Math.max(20, REFRESH_THROTTLE_MS - (now - this.lastPublishAt));
    this.pendingRefreshTimer = setTimeout(() => {
      this.pendingRefreshTimer = null;
      void this.publishFrame();
    }, wait);
  }

  private async publishFrame(forceOneShot = false): Promise<void> {
    if (!this.running && !forceOneShot) {
      return;
    }
    this.lastPublishAt = Date.now();
    const now = Date.now();

    let rendered: { frame: OledServiceFrame; bitmap: Uint8Array };
    const activeTyped =
      this.typedNotification && now < this.typedNotification.expiresAt ? this.typedNotification : null;

    if (activeTyped) {
      const bitmap = renderTypedNotificationBitmap(activeTyped);
      // Advance animation counter so the next frame shows more progress.
      activeTyped.animFrameIndex += 1;
      rendered = {
        frame: {
          line1: activeTyped.header,
          line2: activeTyped.title + (activeTyped.valueText ? ` ${activeTyped.valueText}` : ""),
          generatedAtIso: new Date().toISOString(),
        },
        bitmap,
      };
    } else {
      if (this.typedNotification) {
        this.typedNotification = null;
      }
      rendered = buildRenderedFrame(this.config, this.appState, this.customNotification);
    }

    this.lastFrame = rendered.frame;
    this.emit("frame", rendered.frame);

    if (this.typedNotification && Date.now() >= this.typedNotification.expiresAt) {
      this.typedNotification = null;
    }
    if (this.customNotification && Date.now() >= this.customNotification.expiresAt) {
      this.customNotification = null;
    }

    try {
      this.writeFrameToDevice(rendered.bitmap);
      if (this.lastError) {
        this.emit("status", "Base Station OLED connection restored.");
        this.lastError = "";
      }
    } catch (err) {
      const message = errorText(err);
      if (message !== this.lastError) {
        this.lastError = message;
        this.emit("error", message);
      }
    }
  }

  private writeFrameToDevice(bitmap: Uint8Array): void {
    const hid = this.ensureHidLoaded();
    if (!hid) {
      throw new Error("node-hid unavailable. Install/rebuild dependencies and restart the app.");
    }
    const candidates = this.listCandidates(hid);
    if (candidates.length === 0) {
      throw new Error("No compatible Arctis base station found on HID interface 4.");
    }

    const reports = createDrawReports(bitmap, SCREEN_WIDTH, SCREEN_HEIGHT);
    let lastWriteError = "";
    for (const info of candidates) {
      const devicePath = String(info.path ?? "").trim();
      if (!devicePath) {
        continue;
      }
      let device: HidHandle | null = null;
      try {
        device = new hid.HID(devicePath, { nonExclusive: true });
        for (const report of reports) {
          device.sendFeatureReport(report);
        }
        return;
      } catch (err) {
        lastWriteError = errorText(err);
      } finally {
        if (device) {
          try {
            device.close();
          } catch {
            // ignore close errors
          }
        }
      }
    }
    throw new Error(lastWriteError || "Unable to send OLED frame to any matching HID endpoint.");
  }

  private returnToSteelSeriesUi(): void {
    const hid = this.ensureHidLoaded();
    if (!hid) {
      return;
    }
    const payload = new Array<number>(64).fill(0);
    payload[0] = 0x06;
    payload[1] = 0x95;
    for (const info of this.listCandidates(hid)) {
      const devicePath = String(info.path ?? "").trim();
      if (!devicePath) {
        continue;
      }
      let device: HidHandle | null = null;
      try {
        device = new hid.HID(devicePath, { nonExclusive: true });
        device.write(payload);
        break;
      } catch {
        // ignore shutdown failures
      } finally {
        if (device) {
          try {
            device.close();
          } catch {
            // ignore close errors
          }
        }
      }
    }
  }

  private ensureHidLoaded(): HidModule | null {
    if (this.hid) {
      return this.hid;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      this.hid = require("node-hid") as HidModule;
      return this.hid;
    } catch {
      return null;
    }
  }

  private listCandidates(hid: HidModule): HidDeviceInfo[] {
    const filtered = hid
      .devices()
      .filter(
        (row) =>
          row.vendorId === STEELSERIES_VENDOR_ID &&
          SUPPORTED_PRODUCT_IDS.has(Number(row.productId)) &&
          Number(row.interface) === INTERFACE_NUMBER &&
          typeof row.path === "string" &&
          row.path.trim().length > 0,
      );
    const deduped = new Map<string, HidDeviceInfo>();
    for (const row of filtered) {
      const key = String(row.path).trim();
      if (!deduped.has(key)) {
        deduped.set(key, row);
      }
    }
    return [...deduped.values()];
  }
}

type DashboardWidgetKind = "volume" | "mic" | "anc" | "battery" | "chatMix";

interface DashboardWidget {
  kind: DashboardWidgetKind;
  primary: number | null;
  secondary: number | null;
  active: boolean;
}

function buildRenderedFrame(
  config: BaseStationOledConfig,
  appState: AppState,
  customNotification: CustomOledNotification | null,
): { frame: OledServiceFrame; bitmap: Uint8Array } {
  const generatedAtIso = new Date().toISOString();
  const activeCustom = customNotification && Date.now() < customNotification.expiresAt ? customNotification : null;
  if (activeCustom) {
    return {
      frame: {
        line1: activeCustom.title,
        line2: activeCustom.body,
        generatedAtIso,
      },
      bitmap: renderCustomNotificationBitmap(activeCustom.title, activeCustom.body),
    };
  }
  const widgets = buildDashboardWidgets(config, appState);
  const summary = summarizeDashboard(widgets);
  return {
    frame: {
      line1: summary.line1,
      line2: summary.line2,
      generatedAtIso,
    },
    bitmap: renderDashboardBitmap(widgets),
  };
}

function buildDashboardWidgets(config: BaseStationOledConfig, state: AppState): DashboardWidget[] {
  const widgets: DashboardWidget[] = [];
  if (config.showHeadsetVolume) {
    const value =
      typeof state.headset_volume_percent === "number" && Number.isFinite(state.headset_volume_percent)
        ? clampPercent(state.headset_volume_percent)
        : null;
    widgets.push({
      kind: "volume",
      primary: value,
      secondary: null,
      active: value != null && value > 0,
    });
  }
  if (config.showMicMuteStatus) {
    const value = state.mic_mute == null ? null : state.mic_mute ? 0 : 100;
    widgets.push({
      kind: "mic",
      primary: value,
      secondary: null,
      active: state.mic_mute === false,
    });
  }
  if (config.showAncMode) {
    const mode = String(state.anc_mode ?? "").trim().toLowerCase();
    const value = mode === "anc" ? 100 : mode === "transparency" ? 60 : mode === "off" ? 0 : null;
    widgets.push({
      kind: "anc",
      primary: value,
      secondary: null,
      active: mode === "anc" || mode === "transparency",
    });
  }
  if (config.showBatteryInfo) {
    const headset =
      typeof state.headset_battery_percent === "number" && Number.isFinite(state.headset_battery_percent)
        ? clampPercent(state.headset_battery_percent)
        : null;
    const base =
      typeof state.base_battery_percent === "number" && Number.isFinite(state.base_battery_percent)
        ? clampPercent(state.base_battery_percent)
        : null;
    widgets.push({
      kind: "battery",
      primary: headset,
      secondary: base,
      active: (headset ?? 0) > 20 || (base ?? 0) > 20,
    });
  }
  if (config.showChatMix) {
    const value =
      typeof state.chat_mix_balance === "number" && Number.isFinite(state.chat_mix_balance)
        ? clampPercent(state.chat_mix_balance)
        : null;
    widgets.push({
      kind: "chatMix",
      primary: value,
      secondary: null,
      active: value != null,
    });
  }
  return widgets;
}

function summarizeDashboard(widgets: DashboardWidget[]): { line1: string; line2: string } {
  if (widgets.length === 0) {
    return {
      line1: "UI DASHBOARD",
      line2: "NO WIDGETS",
    };
  }
  const first = widgets[0];
  const primary = first.primary == null ? "N/A" : `${first.primary}%`;
  return {
    line1: normalizeFrameLine(`UI ${widgets.length} WIDGETS`, 20),
    line2: normalizeFrameLine(`${first.kind.toUpperCase()} ${primary}`, 20),
  };
}

function renderDashboardBitmap(widgets: DashboardWidget[]): Uint8Array {
  const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  drawRect(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, false);
  drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  if (widgets.length === 0) {
    drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 36, 20, 56, 24);
    drawLine(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 39, 23, 89, 41);
    drawLine(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 89, 23, 39, 41);
    return pixels;
  }

  const maxWidgets = Math.min(6, widgets.length);
  const widgetRows = Math.max(1, Math.ceil(maxWidgets / 2));
  const outerPadding = 3;
  const gapX = 4;
  const gapY = 3;
  const cardWidth = Math.floor((SCREEN_WIDTH - outerPadding * 2 - gapX) / 2);
  const cardHeight = Math.floor((SCREEN_HEIGHT - outerPadding * 2 - (widgetRows - 1) * gapY) / widgetRows);

  for (let index = 0; index < maxWidgets; index += 1) {
    const widget = widgets[index];
    const row = Math.floor(index / 2);
    const col = index % 2;
    const x = outerPadding + col * (cardWidth + gapX);
    const y = outerPadding + row * (cardHeight + gapY);
    drawWidgetCard(pixels, x, y, cardWidth, cardHeight, widget);
  }
  return pixels;
}

function drawWidgetCard(
  pixels: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  widget: DashboardWidget,
): void {
  drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x, y, width, height);

  const iconX = x + 3;
  const iconY = y + 2;
  drawIcon(pixels, iconX, iconY, widget.kind);
  drawStatusDot(pixels, x + width - 5, y + 3, widget.active, widget.primary == null);

  const barX = x + 20;
  const barWidth = Math.max(10, width - 24);

  if (widget.kind === "battery") {
    drawProgressBar(pixels, barX, y + height - 13, barWidth, 4, widget.primary);
    drawProgressBar(pixels, barX, y + height - 7, barWidth, 4, widget.secondary);
    return;
  }

  drawProgressBar(pixels, barX, y + height - 8, barWidth, 5, widget.primary);
}

function drawIcon(pixels: Uint8Array, x: number, y: number, kind: DashboardWidgetKind): void {
  const icon = ICON_BITMAPS[kind];
  for (let row = 0; row < icon.length; row += 1) {
    const line = icon[row];
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === "1") {
        setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x + col, y + row, 1);
      }
    }
  }
}

function drawStatusDot(
  pixels: Uint8Array,
  x: number,
  y: number,
  active: boolean,
  unknown: boolean,
): void {
  if (unknown) {
    setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x, y, 1);
    return;
  }
  if (active) {
    drawRect(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x - 1, y - 1, 3, 3, true);
    return;
  }
  drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x - 1, y - 1, 3, 3);
}

function drawProgressBar(
  pixels: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  value: number | null,
): void {
  drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x, y, width, height);
  if (value == null) {
    for (let px = x + 1; px < x + width - 1; px += 2) {
      const yy = y + 1 + ((px - x) % Math.max(1, height - 1));
      setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, px, Math.min(y + height - 2, yy), 1);
    }
    return;
  }
  const clamped = clampPercent(value);
  const fillWidth = Math.round(((width - 2) * clamped) / 100);
  if (fillWidth <= 0) {
    return;
  }
  drawRect(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x + 1, y + 1, fillWidth, Math.max(1, height - 2), true);
}

function renderCustomNotificationBitmap(title: string, body: string): Uint8Array {
  const pixels = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);
  drawRect(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, false);
  drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  drawCenteredText(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, "NOTIFICATION", 8);
  drawHorizontalLine(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, 10, SCREEN_WIDTH - 11, 20);
  drawCenteredText(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, title, 30);
  drawCenteredText(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, body, 44);
  return pixels;
}

/**
 * Renders a typed OLED notification with:
 *  - Inverted header band (white bg, black text) showing the event type.
 *  - 12×12 icon on the left.
 *  - Title + value text to the right of the icon.
 *  - Optional animated progress bar that sweeps from 0 → target over 4 frames.
 */
function renderTypedNotificationBitmap(notif: TypedOledNotification): Uint8Array {
  const W = SCREEN_WIDTH;
  const H = SCREEN_HEIGHT;
  const pixels = new Uint8Array(W * H);

  // Header band: rows 0–9 filled white, text rendered inverted (black on white).
  drawRect(pixels, W, H, 0, 0, W, 10, true);
  drawCenteredTextInverted(pixels, W, H, notif.header, 1);

  // Separator below the header.
  drawHorizontalLine(pixels, W, H, 0, W - 1, 10);

  // Icon at (3, 13).
  drawNotifIcon(pixels, 3, 13, notif.kind);

  // Label and value text to the right of the icon.
  const textX = 20;
  drawText(pixels, W, H, notif.title, textX, 13);
  if (notif.valueText) {
    drawText(pixels, W, H, notif.valueText, textX, 23);
  }

  // Animated progress bar (ease-out grow-in over ANIM_FRAMES frames).
  if (notif.valuePercent != null) {
    const ANIM_FRAMES = 4;
    const raw = notif.animFrameIndex >= ANIM_FRAMES ? 1 : notif.animFrameIndex / ANIM_FRAMES;
    // Ease-out: f(t) = t*(2-t)
    const eased = raw < 1 ? raw * (2 - raw) : 1;
    const animatedPercent = Math.round(notif.valuePercent * eased);
    drawProgressBar(pixels, textX, 36, W - textX - 4, 5, animatedPercent);
  }

  // Outer border.
  drawRectOutline(pixels, W, H, 0, 0, W, H);

  return pixels;
}

function headerForKind(kind: OledNotificationKind): string {
  const labels: Record<OledNotificationKind, string> = {
    connectivity: "CONNECTION",
    usbInput: "USB INPUT",
    ancMode: "ANC MODE",
    sidetone: "SIDETONE",
    micMute: "MIC MUTE",
    headsetChatMix: "CHAT MIX",
    headsetVolume: "VOLUME",
    battery: "BATTERY",
    presetChange: "PRESET",
    oled: "DISPLAY",
    appInfo: "INFO",
    generic: "NOTIFICATION",
  };
  return labels[kind] ?? "NOTIFICATION";
}

/** Draws text centered horizontally, clearing pixels (black on filled-white background). */
function drawCenteredTextInverted(
  pixels: Uint8Array,
  width: number,
  height: number,
  text: string,
  y: number,
): void {
  const normalized = normalizeFrameLine(text, 20);
  if (!normalized) {
    return;
  }
  const textWidth = normalized.length > 0 ? normalized.length * (FONT_WIDTH + FONT_SPACING) - FONT_SPACING : 0;
  const x = Math.max(2, Math.floor((width - textWidth) / 2));
  let cursorX = x;
  for (const char of normalized) {
    drawGlyphInverted(pixels, width, height, cursorX, y, char);
    cursorX += FONT_WIDTH + FONT_SPACING;
  }
}

/** Draws a single glyph by clearing pixels (for use on a white/filled background). */
function drawGlyphInverted(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  char: string,
): void {
  const glyph = FONT_5X7[char] ?? FONT_5X7["?"];
  for (let row = 0; row < FONT_HEIGHT; row += 1) {
    const pattern = glyph[row];
    for (let col = 0; col < FONT_WIDTH; col += 1) {
      if (pattern[col] === "1") {
        setPixel(pixels, width, height, x + col, y + row, 0);
      }
    }
  }
}

/** Draws the 12×12 icon for a notification kind at the given position. */
function drawNotifIcon(pixels: Uint8Array, x: number, y: number, kind: OledNotificationKind): void {
  const icon = NOTIF_ICON_BITMAPS[kind] ?? NOTIF_ICON_BITMAPS.generic;
  for (let row = 0; row < icon.length; row += 1) {
    const line = icon[row];
    for (let col = 0; col < line.length; col += 1) {
      if (line[col] === "1") {
        setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x + col, y + row, 1);
      }
    }
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampRefreshInterval(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CONFIG.refreshIntervalMs;
  }
  const ms = numeric <= 120 ? numeric * 1000 : numeric;
  return Math.max(5_000, Math.min(300_000, Math.round(ms)));
}

function clampNotificationDuration(value: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_CONFIG.customNotificationDurationMs;
  }
  const ms = numeric <= 120 ? numeric * 1000 : numeric;
  return Math.max(2_000, Math.min(30_000, Math.round(ms)));
}

function normalizeFrameLine(value: string, maxLength: number): string {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (!cleaned) {
    return "";
  }
  return cleaned
    .split("")
    .map((char) => (FONT_5X7[char] ? char : "?"))
    .join("")
    .slice(0, Math.max(1, maxLength));
}

function drawText(
  pixels: Uint8Array,
  width: number,
  height: number,
  text: string,
  x: number,
  y: number,
): void {
  const normalized = normalizeFrameLine(text, Math.max(1, Math.floor((width - x) / (FONT_WIDTH + FONT_SPACING))));
  if (!normalized) {
    return;
  }
  let cursorX = x;
  for (const char of normalized) {
    drawGlyph(pixels, width, height, cursorX, y, char);
    cursorX += FONT_WIDTH + FONT_SPACING;
  }
}

function drawCenteredText(
  pixels: Uint8Array,
  width: number,
  height: number,
  text: string,
  y: number,
): void {
  const normalized = normalizeFrameLine(text, 20);
  if (!normalized) {
    return;
  }
  const textWidth = normalized.length > 0 ? normalized.length * (FONT_WIDTH + FONT_SPACING) - FONT_SPACING : 0;
  const x = Math.max(0, Math.floor((width - textWidth) / 2));
  drawText(pixels, width, height, normalized, x, y);
}

function drawGlyph(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  char: string,
): void {
  const glyph = FONT_5X7[char] ?? FONT_5X7["?"];
  for (let row = 0; row < FONT_HEIGHT; row += 1) {
    const pattern = glyph[row];
    for (let col = 0; col < FONT_WIDTH; col += 1) {
      if (pattern[col] === "1") {
        setPixel(pixels, width, height, x + col, y + row, 1);
      }
    }
  }
}

function drawRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  on: boolean,
): void {
  const value = on ? 1 : 0;
  for (let yy = y; yy < y + rectHeight; yy += 1) {
    for (let xx = x; xx < x + rectWidth; xx += 1) {
      setPixel(pixels, width, height, xx, yy, value);
    }
  }
}

function drawRectOutline(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): void {
  drawHorizontalLine(pixels, width, height, x, x + rectWidth - 1, y);
  drawHorizontalLine(pixels, width, height, x, x + rectWidth - 1, y + rectHeight - 1);
  for (let yy = y; yy < y + rectHeight; yy += 1) {
    setPixel(pixels, width, height, x, yy, 1);
    setPixel(pixels, width, height, x + rectWidth - 1, yy, 1);
  }
}

function drawHorizontalLine(
  pixels: Uint8Array,
  width: number,
  height: number,
  fromX: number,
  toX: number,
  y: number,
): void {
  for (let xx = fromX; xx <= toX; xx += 1) {
    setPixel(pixels, width, height, xx, y, 1);
  }
}

function drawLine(
  pixels: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  let ax = x0;
  let ay = y0;
  const dx = Math.abs(x1 - ax);
  const sx = ax < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - ay);
  const sy = ay < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    setPixel(pixels, width, height, ax, ay, 1);
    if (ax === x1 && ay === y1) {
      break;
    }
    const e2 = err * 2;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

function setPixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  value: 0 | 1,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  pixels[y * width + x] = value;
}

function createDrawReports(bitmap: Uint8Array, width: number, height: number): number[][] {
  const reports: number[][] = [];
  for (let splitX = 0; splitX < width; splitX += SCREEN_REPORT_SPLIT_WIDTH) {
    const chunkWidth = Math.min(SCREEN_REPORT_SPLIT_WIDTH, width - splitX);
    const report = new Array<number>(SCREEN_REPORT_SIZE).fill(0);
    report[0] = 0x06;
    report[1] = 0x93;
    report[2] = splitX;
    report[3] = 0;
    const paddedHeight = Math.ceil(height / 8) * 8;
    report[4] = chunkWidth;
    report[5] = paddedHeight;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < chunkWidth; x += 1) {
        const sourceIndex = y * width + (splitX + x);
        if (bitmap[sourceIndex] === 0) {
          continue;
        }
        const reportIndex = x * paddedHeight + y;
        report[(reportIndex >> 3) + 6] |= 1 << (reportIndex & 7);
      }
    }
    reports.push(report);
  }
  return reports;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

const ICON_BITMAPS: Record<DashboardWidgetKind, string[]> = {
  volume: [
    "000000000000",
    "000110000000",
    "001111000100",
    "011111001110",
    "111111011111",
    "111111011111",
    "111111011111",
    "011111001110",
    "001111000100",
    "000110000000",
    "000000000000",
    "000000000000",
  ],
  mic: [
    "000111100000",
    "001111110000",
    "001100110000",
    "001100110000",
    "001100110000",
    "001111110000",
    "000111100000",
    "000011000000",
    "001111110000",
    "000011000000",
    "000111100000",
    "000000000000",
  ],
  anc: [
    "000011000000",
    "000111100000",
    "001100110000",
    "011000011000",
    "110001001100",
    "110011001100",
    "110001001100",
    "011000011000",
    "001100110000",
    "000111100000",
    "000011000000",
    "000000000000",
  ],
  battery: [
    "001111111100",
    "011000000110",
    "110111111011",
    "110111111011",
    "110111111011",
    "110111111011",
    "110111111011",
    "110111111011",
    "011000000110",
    "001111111100",
    "000001100000",
    "000001100000",
  ],
  chatMix: [
    "000110000110",
    "001111001111",
    "011001011001",
    "011001011001",
    "001111001111",
    "000110000110",
    "000000000000",
    "001111111100",
    "000001100000",
    "000001100000",
    "001111111100",
    "000000000000",
  ],
};

const FONT_5X7: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
  "%": ["11001", "11010", "00100", "01000", "10110", "00110", "00000"],
  "?": ["01110", "10001", "00010", "00100", "00100", "00000", "00100"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10000", "10011", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

/**
 * 12×12 pixel icon bitmaps for each typed OLED notification kind.
 * Each row is a 12-character string of "0"/"1" values.
 */
const NOTIF_ICON_BITMAPS: Record<OledNotificationKind, string[]> = {
  // Reuse dashboard widget icons where they match semantically.
  headsetVolume: [
    "000000000000",
    "000110000000",
    "001111000100",
    "011111001110",
    "111111011111",
    "111111011111",
    "111111011111",
    "011111001110",
    "001111000100",
    "000110000000",
    "000000000000",
    "000000000000",
  ],
  headsetChatMix: [
    "000110000110",
    "001111001111",
    "011001011001",
    "011001011001",
    "001111001111",
    "000110000110",
    "000000000000",
    "001111111100",
    "000001100000",
    "000001100000",
    "001111111100",
    "000000000000",
  ],
  micMute: [
    "000111100000",
    "001111110000",
    "001100110000",
    "001100110000",
    "001100110000",
    "001111110000",
    "000111100000",
    "000011000000",
    "001111110000",
    "000011000000",
    "000111100000",
    "000000000000",
  ],
  ancMode: [
    "000011000000",
    "000111100000",
    "001100110000",
    "011000011000",
    "110001001100",
    "110011001100",
    "110001001100",
    "011000011000",
    "001100110000",
    "000111100000",
    "000011000000",
    "000000000000",
  ],
  battery: [
    "001111111100",
    "011000000110",
    "110111111011",
    "110111111011",
    "110111111011",
    "110111111011",
    "110111111011",
    "110111111011",
    "011000000110",
    "001111111100",
    "000001100000",
    "000001100000",
  ],
  // Signal-strength bars icon (4 bars of increasing height, left to right).
  connectivity: [
    "000000000010",
    "000000000010",
    "000000000010",
    "000000000010",
    "000000010010",
    "000000010010",
    "000010010010",
    "000010010010",
    "010010010010",
    "010010010010",
    "010010010010",
    "000000000000",
  ],
  // USB trident: Y-shaped branches at top + rectangular connector at bottom.
  usbInput: [
    "000001100000",
    "000001100000",
    "100001100010",
    "110001100110",
    "100001100010",
    "000001100000",
    "000001100000",
    "000011110000",
    "000100001000",
    "000100001000",
    "000011110000",
    "000000000000",
  ],
  // Microphone + small outgoing-sound arc (sidetone feedback).
  sidetone: [
    "000111100000",
    "001111110000",
    "001100110000",
    "001100110000",
    "001100110000",
    "001111110000",
    "000111100000",
    "000011000000",
    "001111110010",
    "000011000110",
    "000111100010",
    "000000000000",
  ],
  // Eighth note: filled oval head + stem + flag.
  presetChange: [
    "000000001000",
    "000000001100",
    "000000001100",
    "000000001000",
    "000000001000",
    "000000001000",
    "000000001000",
    "000011111000",
    "000111111000",
    "000111111000",
    "000011110000",
    "000000000000",
  ],
  // Sun / brightness: solid circle + 4 directional rays.
  oled: [
    "000011000000",
    "000011000000",
    "100011000010",
    "011000001100",
    "001111110000",
    "001111110000",
    "001111110000",
    "011000001100",
    "100011000010",
    "000011000000",
    "000011000000",
    "000000000000",
  ],
  // Information circle: "i" inside a ring.
  appInfo: [
    "000111110000",
    "001000001000",
    "010001100100",
    "010001100100",
    "010011110100",
    "010011110100",
    "010011110100",
    "010001100100",
    "010001100100",
    "010000000100",
    "001000001000",
    "000111110000",
  ],
  // Generic fallback: exclamation mark in a diamond.
  generic: [
    "000011000000",
    "000111100000",
    "001111110000",
    "001110110000",
    "001110110000",
    "001111110000",
    "001110110000",
    "001110110000",
    "001111110000",
    "000111100000",
    "000011000000",
    "000000000000",
  ],
};

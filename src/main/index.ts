import { app, BrowserWindow, ipcMain, nativeTheme, screen as electronScreen, shell } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { ArctisApiService } from "./services/apis/arctis/service";
import { DdcApiService } from "./services/apis/ddc/service";
import { ShortcutService } from "./services/shortcuts/service";
import { createPersistenceService, type PersistedAppState } from "./services/persistence/service";
import { createNotificationTimerService, type NotificationTimerKey } from "./services/notifications/timerService";
import { createNotificationWindowService } from "./services/notifications/windowService";
import { BaseStationOledService } from "./services/oled/service";
import {
  PresetSwitcherService as PresetSwitcherServiceImpl,
  PresetSwitcherServiceConfig,
  PresetSwitcherService as PresetSwitcherServiceType,
} from "./services/presetSwitcher/service";
import { createFlyoutWindow, positionBottomRight, saveWindowBounds } from "./window";
import { buildTrayIcon, createTray } from "./tray";
import { DEFAULT_SETTINGS, mergeSettings, mergeState } from "../shared/settings.js";
import {
  CHANNELS,
  type AppState,
  type ChannelKey,
  type PresetMap,
  type ShortcutBinding,
  type UiSettings,
} from "../shared/types";
import {
  IPC_EVENT,
  type DdcMonitorPayload,
  type ServiceStatusPayload,
} from "../shared/ipc";
import { registerCoreIpcHandlers } from "./ipc/registerCoreHandlers";
import { createSettingsIpcHandler } from "./ipc/settingsHandlers";
import { createMixerIpcHandlers } from "./ipc/mixerHandlers";
import * as ddcHandlersModule from "./ipc/ddcHandlers";
import type { CreateDdcIpcHandlersDeps, DdcIpcHandlers } from "./ipc/ddcHandlers";
import { createAppIpcHandlers } from "./ipc/appHandlers";
import { createWindowIpcHandlers } from "./ipc/windowHandlers";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let headsetVolumeNotificationWindow: BrowserWindow | null = null;
let headsetVolumePendingValue: number | null = null;
let headsetChatMixPendingValue: number | null = null;
let micMuteNotificationWindow: BrowserWindow | null = null;
let micMutePendingValue: boolean | null = null;
let oledNotificationWindow: BrowserWindow | null = null;
let oledPendingValue: number | null = null;
let sidetoneNotificationWindow: BrowserWindow | null = null;
let sidetonePendingValue: number | null = null;
let presetChangeNotificationWindow: BrowserWindow | null = null;
let presetChangePendingValue: { channel: ChannelKey; presetName: string } | null = null;
let usbInputNotificationWindow: BrowserWindow | null = null;
let usbInputPendingValue: 1 | 2 | null = null;
let ancModeNotificationWindow: BrowserWindow | null = null;
let ancModePendingValue: AncNotificationMode | null = null;
let connectivityNotificationWindow: BrowserWindow | null = null;
let connectivityPendingValue: ConnectivityNotificationPayload | null = null;
let connectivityNotificationHideAt = 0;
let batteryLowNotificationWindow: BrowserWindow | null = null;
let batteryLowPendingValue: BatteryLowNotificationPayload | null = null;
let baseBatteryStatusNotificationWindow: BrowserWindow | null = null;
let baseBatteryStatusPendingValue: BaseBatteryStatusNotificationPayload | null = null;
let headsetBatterySwapNotificationWindow: BrowserWindow | null = null;
let headsetBatterySwapPendingValue: HeadsetBatterySwapNotificationPayload | null = null;
type AncNotificationMode = "off" | "anc" | "transparency";
interface ConnectivityNotificationPayload {
  connected: boolean;
  wireless: boolean;
  bluetooth: boolean;
  battery: number | null;
}
interface BatteryLowNotificationPayload {
  battery: number | null;
  threshold: number;
}
interface BaseBatteryStatusNotificationPayload {
  inserted: boolean;
  battery: number | null;
}
interface HeadsetBatterySwapNotificationPayload {
  headsetBattery: number | null;
}
type PresetSwitcherServiceCtor = new (
  config: PresetSwitcherServiceConfig,
) => PresetSwitcherServiceType;
type OsdLayout = { displayId: number; x: number; y: number; width: number; height: number; uiScale: number };
let headsetVolumeOsdLayout: OsdLayout | null = null;
let micMuteOsdLayout: OsdLayout | null = null;
let oledOsdLayout: OsdLayout | null = null;
let sidetoneOsdLayout: OsdLayout | null = null;
let presetChangeOsdLayout: OsdLayout | null = null;
let usbInputOsdLayout: OsdLayout | null = null;
let ancModeOsdLayout: OsdLayout | null = null;
let connectivityOsdLayout: OsdLayout | null = null;
let batteryLowOsdLayout: OsdLayout | null = null;
let baseBatteryStatusOsdLayout: OsdLayout | null = null;
let headsetBatterySwapOsdLayout: OsdLayout | null = null;
let tray: Electron.Tray | null = null;
let settings: UiSettings = DEFAULT_SETTINGS;
let cachedState: AppState = mergeState();
let cachedPresets: PresetMap = {};
let backend: ArctisApiService | null = null;
let ddcService: DdcApiService | null = null;
const shortcutService = new ShortcutService();
const presetSwitcherService = new (PresetSwitcherServiceImpl as PresetSwitcherServiceCtor)({
  getCurrentPreset: (channel) => {
    const current = cachedState.channel_preset?.[channel as keyof NonNullable<AppState["channel_preset"]>];
    return typeof current === "string" ? current : null;
  },
  getPresetMap: () => cachedPresets,
  applyPreset: (channel, presetId) => {
    if (!backend) {
      return;
    }
    backend.send({
      name: "set_preset",
      payload: {
        channel,
        preset_id: presetId,
      },
    });
    cachedState = mergeState({
      ...cachedState,
      channel_preset: {
        ...cachedState.channel_preset,
        [channel]: presetId,
      },
    });
    if (isNotifEnabled("presetChange")) {
      void showPresetChangeNotification(channel, getPresetDisplayName(channel, presetId));
    }
    schedulePersist();
    broadcastStateUpdate();
  },
  onAppsUpdate: (apps) => {
    for (const win of allWindows()) {
      win.webContents.send(IPC_EVENT.OPEN_APPS_UPDATE, apps);
    }
  },
  onActiveAppUpdate: (activeApp) => {
    if (activeApp) {
      pushServiceLog("presetSwitcher", `Active app: ${activeApp.name}`);
    }
  },
  onLog: (message) => {
    pushServiceLog("presetSwitcher", message);
  },
});
const baseStationOledService = new BaseStationOledService();
baseStationOledService.on("status", (text: string) => {
  pushServiceLog("oledDisplay", text);
});
baseStationOledService.on("frame", (frame: { line1: string; line2: string; generatedAtIso: string }) => {
  pushServiceLog("oledDisplay", `Frame -> ${frame.line1} | ${frame.line2}`);
  for (const win of allWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.OLED_SERVICE_FRAME, frame);
    }
  }
});
baseStationOledService.on("error", (text: string) => {
  pushServiceLog("oledDisplay", `ERROR: ${text}`);
});

let lastStatusText = "ready";
let lastErrorText: string | null = null;
let logBuffer: string[] = [];
let mixerOutputId: string | null = null;
let mixerAppVolume: Record<string, number> = {};
let mixerAppMuted: Record<string, boolean> = {};
let ddcMonitorRefreshTimer: NodeJS.Timeout | null = null;
let ddcMonitorRefreshInFlight = false;
let mainWindowLoaded = false;
let pendingFlyoutOpen = false;
let isQuitting = false;
let hasSeenLiveState = false;
let ddcLastFailure = "";
let ddcLastStatus: "unknown" | "ok" | "error" = "unknown";
let ddcMonitorsCache: DdcMonitor[] = [];
let ddcMonitorsCacheTs = 0;
let flyoutPinned = false;
let hideIntentUntil = 0;
let lastHideReason = "";
let lastToggleAt = 0;
const DEBUG_FLYOUT = false;
const DEBUG_DDC = false;
const HEADSET_VOLUME_OSD_BASE_WIDTH = 210;
const HEADSET_VOLUME_OSD_BASE_HEIGHT_SINGLE = 46;
const HEADSET_VOLUME_OSD_BASE_HEIGHT_DOUBLE = 70;
const MIC_MUTE_OSD_BASE_SIZE = 62;
const MIC_MUTE_LIVE_ACCENT = "#3fcf8e";
const MIC_MUTE_MUTED_ACCENT = "#ef5350";
const OLED_OSD_BASE_SIZE = 108;
const SIDETONE_OSD_BASE_SIZE = 108;
const PRESET_CHANGE_OSD_BASE_WIDTH = 256;
const PRESET_CHANGE_OSD_BASE_HEIGHT = 58;
const USB_INPUT_OSD_BASE_SIZE = 102;
const ANC_MODE_OSD_BASE_SIZE = 62;
const ANC_MODE_ON_ACCENT = "#3fcf8e";
const ANC_MODE_OFF_ACCENT = "#ef5350";
const ANC_MODE_TRANSPARENCY_ACCENT = "#6ab7ff";
const CONNECTIVITY_OSD_BASE_SIZE = 102;
const CONNECTIVITY_CONNECTED_ACCENT = "#3fcf8e";
const CONNECTIVITY_DISCONNECTED_ACCENT = "#ef5350";
const CONNECTIVITY_OSD_TIMEOUT_MS = 3000;
const BATTERY_LOW_OSD_BASE_SIZE = 104;
const BATTERY_LOW_OSD_ACCENT = "#ef5350";
const BASE_BATTERY_STATUS_OSD_BASE_SIZE = 98;
const BASE_BATTERY_INSERTED_ACCENT = "#3fcf8e";
const BASE_BATTERY_REMOVED_ACCENT = "#ef5350";
const HEADSET_BATTERY_SWAP_OSD_BASE_SIZE = 108;
const HEADSET_BATTERY_SWAP_ACCENT = "#3fcf8e";
const FLYOUT_MIN_WIDTH = 320;
const FLYOUT_MAX_WIDTH = 4096;
const FLYOUT_MIN_HEIGHT = 260;
const FLYOUT_MAX_HEIGHT = 2160;

const batterySwapTrack = {
  armed: false,
  sawDisconnect: false,
  sawReconnectWithHigherHeadset: false,
  headsetBeforeSwap: null as number | null,
  baseBeforeRemoval: null as number | null,
};


const APP_STATE_VERSION = 1;

if (!app.isPackaged) {
  const devSessionPath = path.join(os.tmpdir(), `arctis-centre-session-${process.pid}`);
  app.setPath("sessionData", devSessionPath);
}

const persistenceService = createPersistenceService({
  getUserDataPath: () => app.getPath("userData"),
  snapshotFileName: "app-state.json",
  persistDelayMs: 80,
});
const notificationTimerService = createNotificationTimerService();
const notificationWindowService = createNotificationWindowService({
  getThemePayload: () => getThemePayload(),
  resolveDisplay: () => resolveUiDisplay(),
  getThemeMode: () => settings.themeMode,
  getAccentColor: () => settings.accentColor,
  getTimeoutSeconds: () => settings.notificationTimeout,
});

interface MixerOutput {
  id: string;
  name: string;
}

interface MixerApp {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

type DdcMonitor = DdcMonitorPayload;

type RuntimeServiceKey =
  | "sonarApi"
  | "hidEvents"
  | "ddcApi"
  | "oledDisplay"
  | "notifications"
  | "presetSwitcher"
  | "shortcuts";

const SERVICE_LOG_LABELS: Record<RuntimeServiceKey, string> = {
  sonarApi: "Sonar GG",
  hidEvents: "HID Events",
  ddcApi: "DDC",
  oledDisplay: "Base Station OLED",
  notifications: "Notifications",
  presetSwitcher: "Auto Preset Switcher",
  shortcuts: "Shortcuts",
};

/**
 * Builds the full persisted snapshot payload from current in-memory state.
 */
function buildPersistedSnapshot(): PersistedAppState {
  return {
    version: APP_STATE_VERSION,
    state: cachedState,
    presets: cachedPresets,
    settings,
    statusText: lastStatusText,
    errorText: lastErrorText,
    logs: logBuffer,
    mixerOutputId,
    mixerAppVolume,
    mixerAppMuted,
    ddcMonitorsCache,
    ddcMonitorsCacheTs,
    flyoutPinned,
  };
}

/**
 * Persists the current snapshot immediately.
 */
function persistNow(): void {
  persistenceService.persistNow(buildPersistedSnapshot());
}

/**
 * Debounces persistence so bursty state updates do not cause excessive disk writes.
 */
function schedulePersist(): void {
  persistenceService.schedulePersist(() => buildPersistedSnapshot());
}

/**
 * Loads the persisted snapshot into all in-memory caches.
 */
function loadPersistedSnapshot(): void {
  const fallback: PersistedAppState = {
    version: APP_STATE_VERSION,
    state: mergeState(),
    presets: {},
    settings: DEFAULT_SETTINGS,
    statusText: "ready",
    errorText: null,
    logs: [],
    mixerOutputId: null,
    mixerAppVolume: {},
    mixerAppMuted: {},
    ddcMonitorsCache: [],
    ddcMonitorsCacheTs: 0,
    flyoutPinned: false,
  };
  const loaded = persistenceService.loadSnapshot(fallback);
  cachedState = mergeState(loaded.state);
  cachedPresets = loaded.presets ?? {};
  settings = mergeSettings(loaded.settings);
  lastStatusText = loaded.statusText ?? "ready";
  lastErrorText = loaded.errorText ?? null;
  logBuffer = Array.isArray(loaded.logs) ? loaded.logs.slice(0, 200) : [];
  mixerOutputId = loaded.mixerOutputId ?? null;
  mixerAppVolume = loaded.mixerAppVolume ?? {};
  mixerAppMuted = loaded.mixerAppMuted ?? {};
  ddcMonitorsCache = Array.isArray(loaded.ddcMonitorsCache)
    ? loaded.ddcMonitorsCache
        .filter((item): item is DdcMonitor => Boolean(item && Number.isFinite(item.monitor_id)))
        .sort((a, b) => a.monitor_id - b.monitor_id)
    : [];
  ddcMonitorsCacheTs = Number.isFinite(loaded.ddcMonitorsCacheTs) ? loaded.ddcMonitorsCacheTs : 0;
  flyoutPinned = Boolean(loaded.flyoutPinned);
}

/**
 * Broadcasts current DDC cache data to all renderer windows and schedules persistence.
 */
function broadcastDdcUpdate(): void {
  schedulePersist();
  for (const win of allWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.DDC_UPDATE, ddcMonitorsCache);
    }
  }
}

/**
 * Adds a timestamped log entry and forwards it to open renderer windows.
 */
function pushLog(text: string): void {
  const line = `${new Date().toLocaleTimeString()}  ${text}`;
  logBuffer = [line, ...logBuffer].slice(0, 200);
  for (const win of allWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_EVENT.APP_LOG, line);
    }
  }
}

function pushServiceLog(service: RuntimeServiceKey, text: string): void {
  const label = SERVICE_LOG_LABELS[service];
  pushLog(`[${label}] ${text}`);
}

function debugFlyout(text: string): void {
  if (!DEBUG_FLYOUT) {
    return;
  }
  pushLog(`[DEBUG][flyout] ${text}`);
}

function debugDdc(text: string): void {
  if (!DEBUG_DDC) {
    return;
  }
  pushLog(`[DEBUG][ddc] ${text}`);
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

type ToggleServiceSettingKey =
  | "sonarApiEnabled"
  | "hidEventsEnabled"
  | "ddcEnabled"
  | "oledDisplayEnabled"
  | "notificationsEnabled"
  | "automaticPresetSwitcherEnabled"
  | "shortcutsEnabled";

function isServiceEnabled(key: ToggleServiceSettingKey): boolean {
  return settings.services?.[key] !== false;
}

function sanitizeSonarPollIntervalMs(): number {
  const raw = Number(settings.services?.sonarPollIntervalMs ?? DEFAULT_SETTINGS.services.sonarPollIntervalMs);
  const rawSecondsMode = raw <= 120 ? raw * 1000 : raw;
  return Math.max(500, Math.min(60_000, Math.round(rawSecondsMode)));
}

function getServiceStatusPayload(): ServiceStatusPayload {
  const ddcStatus = ddcService?.getStatus() ?? {
    state: "stopped",
    detail: "DDC service not started.",
    endpoint: "native-ddc",
    managed: true,
    pid: null,
  };
  const backendStatus = backend?.getRuntimeStatus() ?? null;

  const sonarEnabled = isServiceEnabled("sonarApiEnabled");
  const hidEnabled = isServiceEnabled("hidEventsEnabled");
  const ddcEnabled = isServiceEnabled("ddcEnabled");
  const oledEnabled = isServiceEnabled("oledDisplayEnabled");
  const notificationsEnabled = isServiceEnabled("notificationsEnabled");
  const presetEnabled = isServiceEnabled("automaticPresetSwitcherEnabled");
  const shortcutsEnabled = isServiceEnabled("shortcutsEnabled");

  const sonarState: ServiceStatusPayload["sonarApi"]["state"] = !sonarEnabled
    ? "stopped"
    : backendStatus?.sonarPollingActive
      ? "running"
      : backendStatus?.lastError
        ? "error"
        : "starting";
  const sonarDetail = !sonarEnabled
    ? "Disabled in settings."
    : backendStatus?.lastError || lastErrorText || (backendStatus?.sonarPollingActive ? "Polling active." : "Starting Sonar poller...");

  const hidState: ServiceStatusPayload["hidEvents"]["state"] = !hidEnabled
    ? "stopped"
    : backendStatus?.hidListenerActive
      ? "running"
      : "starting";
  const hidDetail = !hidEnabled
    ? "Disabled in settings."
    : backendStatus?.hidListenerActive
      ? "Listening for base-station events."
      : "Starting HID listener...";

  const ddcState: ServiceStatusPayload["ddcApi"]["state"] = !ddcEnabled ? "stopped" : ddcStatus.state;
  const ddcDetail = !ddcEnabled ? "Disabled in settings." : ddcStatus.detail;

  const oledError = baseStationOledService.getLastError();
  const oledState: ServiceStatusPayload["baseStationOled"]["state"] = !oledEnabled
    ? "stopped"
    : oledError
      ? "error"
      : baseStationOledService.isRunning()
        ? "running"
        : "starting";
  const lastOledFrame = baseStationOledService.getLastFrame();
  const oledDetail = !oledEnabled
    ? "Disabled in settings."
    : oledError
      ? oledError
    : lastOledFrame
      ? `Last frame pushed at ${new Date(lastOledFrame.generatedAtIso).toLocaleTimeString()}.`
      : "Starting OLED writer...";

  const notificationsState: ServiceStatusPayload["notifications"]["state"] = notificationsEnabled ? "running" : "stopped";
  const notificationsDetail = notificationsEnabled
    ? "Notification subsystem active."
    : "Disabled in settings.";

  const presetState: ServiceStatusPayload["automaticPresetSwitcher"]["state"] = !presetEnabled
    ? "stopped"
    : presetSwitcherService.isRunning()
      ? "running"
      : "starting";
  const presetDetail = !presetEnabled
    ? "Disabled in settings."
    : presetSwitcherService.isRunning()
      ? "Watching active app and applying rules."
      : "Starting active app watcher...";

  const shortcutsState: ServiceStatusPayload["shortcuts"]["state"] = !shortcutsEnabled
    ? "stopped"
    : shortcutService.getRegisteredCount() > 0
      ? "running"
      : "starting";
  const shortcutsDetail = !shortcutsEnabled
    ? "Disabled in settings."
    : `Registered bindings: ${shortcutService.getRegisteredCount()}.`;

  return {
    sonarApi: {
      state: sonarState,
      detail: sonarDetail,
      endpoint: backendStatus?.sonarUrl ?? null,
      pollIntervalMs: sanitizeSonarPollIntervalMs(),
    },
    hidEvents: {
      state: hidState,
      detail: hidDetail,
    },
    ddcApi: {
      state: ddcState,
      detail: ddcDetail,
      endpoint: ddcStatus.endpoint,
      managed: ddcStatus.managed,
      pid: ddcStatus.pid,
    },
    baseStationOled: {
      state: oledState,
      detail: oledDetail,
    },
    notifications: {
      state: notificationsState,
      detail: notificationsDetail,
    },
    automaticPresetSwitcher: {
      state: presetState,
      detail: presetDetail,
    },
    shortcuts: {
      state: shortcutsState,
      detail: shortcutsDetail,
    },
  };
}

function ddcBaseUrl(): string {
  return ddcService?.getStatus().endpoint ?? "native-ddc";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isDdcApiHealthy(): Promise<boolean> {
  return Boolean(ddcService?.isHealthy());
}

async function ensureDdcApiRunning(): Promise<void> {
  if (!isServiceEnabled("ddcEnabled")) {
    return;
  }
  ddcService?.start();
  if (ddcService?.isHealthy()) {
    pushServiceLog("ddcApi", "Native DDC service ready.");
  } else {
    const detail = ddcService?.getStatus().detail ?? "DDC native service unavailable.";
    pushServiceLog("ddcApi", `ERROR: ${detail}`);
  }
}

async function warmupDdcCache(): Promise<void> {
  if (!isServiceEnabled("ddcEnabled")) {
    return;
  }
  await ensureDdcApiRunning();
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fetchDdcMonitorsIfStale(true);
      ddcLastStatus = "ok";
      ddcLastFailure = "";
      pushServiceLog("ddcApi", "Startup refresh completed.");
      return;
    } catch (err) {
      const detail = normalizeError(err);
      ddcLastStatus = "error";
      ddcLastFailure = detail;
      if (attempt === 1 || attempt % 3 === 0 || attempt === maxAttempts) {
        pushServiceLog("ddcApi", `Startup refresh retry ${attempt}/${maxAttempts}: ${detail}`);
      }
      await sleep(5000);
    }
  }
  pushServiceLog("ddcApi", "ERROR: Startup refresh failed after retries.");
}

async function stopManagedDdcApi(): Promise<void> {
  ddcService?.stop();
  await sleep(10);
}

function sanitizePollIntervalMs(): number {
  const raw = Number(settings.ddc?.pollIntervalMs ?? 300000);
  const rawMinutesMode = raw <= 120 ? raw * 60_000 : raw;
  return Math.max(60_000, Math.min(1_800_000, rawMinutesMode));
}

function sanitizeOpenStaleThresholdMs(): number {
  const raw = Number(settings.ddc?.openStaleThresholdMs ?? 60_000);
  const rawMinutesMode = raw <= 120 ? raw * 60_000 : raw;
  return Math.max(60_000, Math.min(3_600_000, rawMinutesMode));
}

function refreshDdcMonitorsOnOpen(): void {
  if (!isServiceEnabled("ddcEnabled")) {
    return;
  }
  const thresholdMs = sanitizeOpenStaleThresholdMs();
  const now = Date.now();
  const isStale = ddcMonitorsCache.length === 0 || now - ddcMonitorsCacheTs > thresholdMs;
  if (!isStale || ddcMonitorRefreshInFlight) {
    return;
  }
  if (!ddcService) {
    return;
  }
  ddcMonitorRefreshInFlight = true;
  debugDdc("refreshDdcMonitorsOnOpen starting stale refresh");
  void (async () => {
    try {
      await fetchDdcMonitorsIfStale(true);
    } catch (err) {
      debugDdc(`showFlyout DDC refresh failed: ${normalizeError(err)}`);
    } finally {
      ddcMonitorRefreshInFlight = false;
    }
  })();
}

function stopDdcMonitorRefresh(): void {
  if (ddcMonitorRefreshTimer) {
    clearInterval(ddcMonitorRefreshTimer);
    ddcMonitorRefreshTimer = null;
  }
  ddcMonitorRefreshInFlight = false;
}

function restartDdcMonitorRefresh(forceNow = false): void {
  stopDdcMonitorRefresh();
  if (!isServiceEnabled("ddcEnabled")) {
    return;
  }
  const intervalMs = sanitizePollIntervalMs();
  if (intervalMs <= 0) {
    return;
  }
  ddcMonitorRefreshTimer = setInterval(() => {
    void (async () => {
      if (ddcMonitorRefreshInFlight) {
        return;
      }
      ddcMonitorRefreshInFlight = true;
      try {
        await fetchDdcMonitorsIfStale(true);
        if (ddcLastStatus !== "ok") {
          ddcLastStatus = "ok";
          ddcLastFailure = "";
          pushServiceLog("ddcApi", `Monitor polling active (${Math.round(intervalMs / 60_000)} min).`);
        }
      } catch (err) {
        const detail = normalizeError(err);
        if (ddcLastFailure !== detail || ddcLastStatus !== "error") {
          pushServiceLog("ddcApi", `ERROR: Poll failed: ${detail}`);
        }
        ddcLastStatus = "error";
        ddcLastFailure = detail;
      } finally {
        ddcMonitorRefreshInFlight = false;
      }
    })();
  }, intervalMs);
  if (forceNow) {
    void fetchDdcMonitorsIfStale(true).catch(() => undefined);
  }
}

async function fetchDdcMonitorsIfStale(force = false): Promise<DdcMonitor[]> {
  if (!isServiceEnabled("ddcEnabled")) {
    throw new Error("DDC service disabled in settings.");
  }
  const now = Date.now();
  if (!force && ddcMonitorsCache.length > 0 && now - ddcMonitorsCacheTs < sanitizePollIntervalMs()) {
    return ddcMonitorsCache;
  }
  if (!ddcService) {
    throw new Error("DDC native service is not initialized.");
  }
  const monitors = ddcService.listMonitors();
  if (!Array.isArray(monitors)) {
    throw new Error("DDC monitors payload is not an array.");
  }
  ddcMonitorsCache = [...monitors].sort((a, b) => a.monitor_id - b.monitor_id);
  ddcMonitorsCacheTs = now;
  broadcastDdcUpdate();
  return ddcMonitorsCache;
}

function isNotifEnabled(key: keyof UiSettings["notifications"]): boolean {
  return isServiceEnabled("notificationsEnabled") && settings.notifications?.[key] !== false;
}

function isHeadsetChatMixEnabled(): boolean {
  return settings.notifications?.headsetChatMix !== false;
}

function showSystemNotification(title: string, body: string): void {
  if (!isServiceEnabled("notificationsEnabled")) {
    return;
  }
  pushServiceLog("notifications", `${title}: ${body}`);
  void notificationWindowService.showNotification(title, body);
}

function scheduleNotificationClose(timerKey: NotificationTimerKey, win: BrowserWindow, timeoutMs: number): void {
  notificationTimerService.schedule(timerKey, timeoutMs, () => {
    if (!win.isDestroyed()) {
      win.close();
    }
  });
}

/**
 * Notification timer clear helpers.
 * These keep call sites explicit about which UI surface is being controlled.
 */
function clearHeadsetVolumeNotificationTimer(): void {
  notificationTimerService.clear("headsetVolume");
}

function clearMicMuteNotificationTimer(): void {
  notificationTimerService.clear("micMute");
}

function clearOledNotificationTimer(): void {
  notificationTimerService.clear("oled");
}

function clearSidetoneNotificationTimer(): void {
  notificationTimerService.clear("sidetone");
}

function clearPresetChangeNotificationTimer(): void {
  notificationTimerService.clear("presetChange");
}

function clearUsbInputNotificationTimer(): void {
  notificationTimerService.clear("usbInput");
}

function clearAncModeNotificationTimer(): void {
  notificationTimerService.clear("ancMode");
}

function clearConnectivityNotificationTimer(): void {
  notificationTimerService.clear("connectivity");
  connectivityNotificationHideAt = 0;
}

function clearBatteryLowNotificationTimer(): void {
  notificationTimerService.clear("batteryLow");
}

function clearBaseBatteryStatusNotificationTimer(): void {
  notificationTimerService.clear("baseBatteryStatus");
}

function clearHeadsetBatterySwapNotificationTimer(): void {
  notificationTimerService.clear("headsetBatterySwap");
}

function clearHeadsetBatterySwapDelayTimer(): void {
  notificationTimerService.clear("headsetBatterySwapDelay");
}

/**
 * Notification close scheduling helpers.
 * All notifications except connectivity use the user-configured timeout.
 */
function scheduleHeadsetVolumeNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("headsetVolume", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleMicMuteNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("micMute", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleOledNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("oled", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleSidetoneNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("sidetone", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function schedulePresetChangeNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("presetChange", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleUsbInputNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("usbInput", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleAncModeNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("ancMode", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleConnectivityNotificationClose(win: BrowserWindow): void {
  clearConnectivityNotificationTimer();
  connectivityNotificationHideAt = Date.now() + CONNECTIVITY_OSD_TIMEOUT_MS;
  notificationTimerService.schedule("connectivity", CONNECTIVITY_OSD_TIMEOUT_MS, () => {
    connectivityNotificationHideAt = 0;
    if (!win.isDestroyed()) {
      win.close();
    }
  });
}

function scheduleBatteryLowNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("batteryLow", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleBaseBatteryStatusNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("baseBatteryStatus", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function scheduleHeadsetBatterySwapNotificationClose(win: BrowserWindow): void {
  scheduleNotificationClose("headsetBatterySwap", win, Math.max(2, settings.notificationTimeout) * 1000);
}

function clampNumber(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function resolveFlyoutFitLimits(): { maxWidth: number; maxHeight: number } {
  const workArea = resolveUiDisplay().workArea;
  return {
    maxWidth: clampNumber(workArea.width - 16, FLYOUT_MIN_WIDTH, FLYOUT_MAX_WIDTH),
    maxHeight: clampNumber(workArea.height - 16, FLYOUT_MIN_HEIGHT, FLYOUT_MAX_HEIGHT),
  };
}

function resolveUiDisplay(): Electron.Display {
  if (settings.useActiveDisplay !== true) {
    return electronScreen.getPrimaryDisplay();
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return electronScreen.getDisplayMatching(focused.getBounds());
  }
  const cursorPoint = electronScreen.getCursorScreenPoint();
  return electronScreen.getDisplayNearestPoint(cursorPoint);
}

function resolveConfiguredPcUsbInput(): 1 | 2 {
  return settings.pcUsbInput === 2 ? 2 : 1;
}

function inferCurrentUsbInput(baseStationConnected: boolean | null): 1 | 2 | null {
  if (baseStationConnected == null) {
    return null;
  }
  const pcUsb = resolveConfiguredPcUsbInput();
  if (baseStationConnected) {
    return pcUsb;
  }
  return pcUsb === 1 ? 2 : 1;
}

function resolveHeadsetVolumeOsdLayout(showChatMix: boolean): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const width = Math.max(188, Math.round(HEADSET_VOLUME_OSD_BASE_WIDTH * resolutionScale));
  const baseHeight = showChatMix ? HEADSET_VOLUME_OSD_BASE_HEIGHT_DOUBLE : HEADSET_VOLUME_OSD_BASE_HEIGHT_SINGLE;
  const height = Math.max(42, Math.round(baseHeight * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = workArea.y + workArea.height - height - margin;
  return {
    displayId: display.id,
    x,
    y,
    width,
    height,
    uiScale: resolutionScale,
  };
}

function resolveMicMuteOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(52, Math.round(MIC_MUTE_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveAncModeOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(52, Math.round(ANC_MODE_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveConnectivityOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(86, Math.round(CONNECTIVITY_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveBatteryLowOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(88, Math.round(BATTERY_LOW_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveOledOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(92, Math.round(OLED_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveSidetoneOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(92, Math.round(SIDETONE_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolvePresetChangeOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const width = Math.max(216, Math.round(PRESET_CHANGE_OSD_BASE_WIDTH * resolutionScale));
  const height = Math.max(50, Math.round(PRESET_CHANGE_OSD_BASE_HEIGHT * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = workArea.y + workArea.height - height - margin;
  return {
    displayId: display.id,
    x,
    y,
    width,
    height,
    uiScale: resolutionScale,
  };
}

function resolveUsbInputOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(86, Math.round(USB_INPUT_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveBaseBatteryStatusOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(82, Math.round(BASE_BATTERY_STATUS_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function resolveHeadsetBatterySwapOsdLayout(): OsdLayout {
  const display = resolveUiDisplay();
  const workArea = display.workArea;
  const resolutionScale = clampNumber(Math.min(workArea.width / 1920, workArea.height / 1080), 0.82, 1.18);
  const size = Math.max(90, Math.round(HEADSET_BATTERY_SWAP_OSD_BASE_SIZE * resolutionScale));
  const margin = Math.max(10, Math.round(12 * resolutionScale));
  const x = Math.round(workArea.x + (workArea.width - size) / 2);
  const y = workArea.y + workArea.height - size - margin;
  return {
    displayId: display.id,
    x,
    y,
    width: size,
    height: size,
    uiScale: resolutionScale,
  };
}

function updateHeadsetVolumeNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setHeadsetVolumeScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateHeadsetVolumeNotificationAccent(win: BrowserWindow, accent: string): void {
  const safeAccent = String(accent || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeAccent) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setHeadsetAccent?.('${safeAccent}');`, true)
    .catch(() => undefined);
}

function resolveHeadsetVolumeNotificationPalette(theme: { isDark: boolean; accent: string }): { panelBg: string; textColor: string } {
  const isDark = settings.themeMode === "system" ? theme.isDark : settings.themeMode === "dark";
  return {
    // Match main renderer background tokens.
    panelBg: isDark ? "#242424" : "#f2f2f2",
    textColor: isDark ? "rgba(255,255,255,0.94)" : "rgba(17,17,17,0.94)",
  };
}

function updateHeadsetVolumeNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  win.setBackgroundColor(safeBg);
  void win.webContents
    .executeJavaScript(`window.__setHeadsetPalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function applyHeadsetVolumeOsdLayout(
  win: BrowserWindow,
  layout: OsdLayout,
): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateHeadsetVolumeNotificationScale(win, layout.uiScale);
}

function toNullablePercent(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return clampPercent(value);
}

function applyUsbInputInference(state: AppState): AppState {
  const inferred = inferCurrentUsbInput(state.base_station_connected);
  if (state.current_usb_input === inferred) {
    return state;
  }
  return {
    ...state,
    current_usb_input: inferred,
  };
}

function toOsdValueLabel(value: number | null): string {
  return value == null ? "--" : String(value);
}

function toNumericNotificationLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  return String(Math.round(value));
}

function updateHeadsetVolumeNotificationUi(
  win: BrowserWindow,
  volume: number | null,
  chatMix: number | null,
  showChatMix: boolean,
): void {
  const jsVolume = volume == null ? "null" : String(clampPercent(volume));
  const jsChatMix = !showChatMix || chatMix == null ? "null" : String(clampPercent(chatMix));
  const jsShowChatMix = showChatMix ? "true" : "false";
  void win.webContents
    .executeJavaScript(`window.__setHeadsetShowChatMix?.(${jsShowChatMix});window.__setHeadsetAudio?.(${jsVolume}, ${jsChatMix});`, true)
    .catch(() => undefined);
}

interface HeadsetAudioNotificationUpdate {
  volume?: number | null;
  chatMix?: number | null;
}

async function showHeadsetVolumeNotification(update: HeadsetAudioNotificationUpdate): Promise<void> {
  const showChatMix = isHeadsetChatMixEnabled();
  if ("volume" in update) {
    headsetVolumePendingValue = toNullablePercent(update.volume);
  }
  if ("chatMix" in update) {
    headsetChatMixPendingValue = toNullablePercent(update.chatMix);
  }
  if (headsetVolumePendingValue == null) {
    headsetVolumePendingValue = toNullablePercent(cachedState.headset_volume_percent);
  }
  if (headsetChatMixPendingValue == null) {
    headsetChatMixPendingValue = toNullablePercent(cachedState.chat_mix_balance);
  }
  const volume = headsetVolumePendingValue;
  const chatMix = headsetChatMixPendingValue;
  if (volume == null && chatMix == null) {
    return;
  }
  const nextLayout = resolveHeadsetVolumeOsdLayout(showChatMix);
  const theme = await getThemePayload();
  const accent = settings.accentColor.trim() || theme.accent;
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  if (headsetVolumeNotificationWindow && !headsetVolumeNotificationWindow.isDestroyed()) {
    const win = headsetVolumeNotificationWindow;
    if (!win.isVisible()) {
      applyHeadsetVolumeOsdLayout(win, nextLayout);
      headsetVolumeOsdLayout = nextLayout;
      win.showInactive();
    }
    updateHeadsetVolumeNotificationPalette(win, palette);
    updateHeadsetVolumeNotificationAccent(win, accent);
    updateHeadsetVolumeNotificationUi(win, headsetVolumePendingValue, headsetChatMixPendingValue, showChatMix);
    scheduleHeadsetVolumeNotificationClose(win);
    return;
  }

  const volumeFill = volume ?? 0;
  const chatMixFill = showChatMix ? chatMix ?? 0 : 0;
  const volumeValue = toOsdValueLabel(volume);
  const chatMixValue = showChatMix ? toOsdValueLabel(chatMix) : "--";
  const shellClass = showChatMix ? "shell" : "shell single";
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --accent: ${accent};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: var(--panel-bg);
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: calc(10px * var(--s));
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          grid-template-rows: 1fr 1fr;
          row-gap: calc(3px * var(--s));
          padding: calc(4px * var(--s));
        }
        .shell.single {
          grid-template-rows: 1fr;
          row-gap: 0;
        }
        .row {
          display: grid;
          grid-template-columns: calc(14px * var(--s)) minmax(0, 1fr) calc(28px * var(--s));
          column-gap: calc(5px * var(--s));
          align-items: center;
          height: 100%;
          min-width: 0;
        }
        .icon {
          width: calc(14px * var(--s));
          height: calc(14px * var(--s));
          color: var(--text-color);
          display: grid;
          place-items: center;
          line-height: 0;
        }
        .icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .bar {
          position: relative;
          height: calc(4px * var(--s));
          border-radius: 999px;
          overflow: hidden;
          background: rgba(255,255,255,0.28);
        }
        .fill {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 0%;
          background: var(--accent);
          transition: width 80ms linear;
        }
        .value {
          width: 2ch;
          min-width: 2ch;
          text-align: center;
          justify-self: center;
          color: var(--text-color);
          font-size: calc(13px * var(--s));
          font-weight: 600;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          font-feature-settings: "tnum";
        }
      </style>
    </head>
    <body>
      <div id="shell" class="${shellClass}">
        <div class="row">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
            </svg>
          </div>
          <div class="bar" aria-hidden="true"><div id="volFill" class="fill" style="width: ${volumeFill}%"></div></div>
          <div id="volValue" class="value">${volumeValue}</div>
        </div>
        <div id="mixRow" class="row">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M5 5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="currentColor" />
              <path d="M8 10h8M8 13h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </div>
          <div class="bar" aria-hidden="true"><div id="mixFill" class="fill" style="width: ${chatMixFill}%"></div></div>
          <div id="mixValue" class="value">${chatMixValue}</div>
        </div>
      </div>
      <script>
        (function () {
          const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
          const volFillEl = document.getElementById("volFill");
          const volValueEl = document.getElementById("volValue");
          const shellEl = document.getElementById("shell");
          const mixRowEl = document.getElementById("mixRow");
          const mixFillEl = document.getElementById("mixFill");
          const mixValueEl = document.getElementById("mixValue");
          const applyValue = (fillEl, valueEl, next) => {
            if (!fillEl || !valueEl) {
              return;
            }
            if (next == null || Number.isNaN(Number(next))) {
              fillEl.style.width = "0%";
              valueEl.textContent = "--";
              return;
            }
            const value = clamp(next);
            fillEl.style.width = value + "%";
            valueEl.textContent = String(value);
          };
          window.__setHeadsetPalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) document.documentElement.style.setProperty("--panel-bg", nextBg);
            if (nextText) document.documentElement.style.setProperty("--text-color", nextText);
          };
          window.__setHeadsetVolumeScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            document.documentElement.style.setProperty("--s", String(nextScale));
          };
          window.__setHeadsetAccent = (value) => {
            const next = String(value || "").trim();
            if (!next) return;
            document.documentElement.style.setProperty("--accent", next);
          };
          window.__setHeadsetShowChatMix = (enabled) => {
            const show = Boolean(enabled);
            if (shellEl) shellEl.classList.toggle("single", !show);
            if (mixRowEl) mixRowEl.style.display = show ? "grid" : "none";
          };
          window.__setHeadsetAudio = (nextVolume, nextChatMix) => {
            if (nextVolume !== undefined) applyValue(volFillEl, volValueEl, nextVolume);
            if (nextChatMix !== undefined) applyValue(mixFillEl, mixValueEl, nextChatMix);
          };
          window.__setHeadsetVolume = (next) => window.__setHeadsetAudio(next, undefined);
          window.__setHeadsetChatMix = (next) => window.__setHeadsetAudio(undefined, next);
          window.__setHeadsetShowChatMix(${showChatMix ? "true" : "false"});
        })();
      </script>
    </body>
  </html>`;

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: palette.panelBg,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: true,
  });

  headsetVolumeNotificationWindow = win;
  headsetVolumeOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showVolumeNotification = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = headsetVolumeOsdLayout ?? nextLayout;
    applyHeadsetVolumeOsdLayout(win, layout);
    updateHeadsetVolumeNotificationPalette(win, palette);
    win.showInactive();
    updateHeadsetVolumeNotificationAccent(win, accent);
    updateHeadsetVolumeNotificationUi(win, headsetVolumePendingValue, headsetChatMixPendingValue, showChatMix);
    scheduleHeadsetVolumeNotificationClose(win);
  };

  win.once("ready-to-show", showVolumeNotification);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showVolumeNotification();
    }
  });
  win.on("closed", () => {
    if (headsetVolumeNotificationWindow === win) {
      headsetVolumeNotificationWindow = null;
    }
    headsetVolumePendingValue = null;
    headsetChatMixPendingValue = null;
    headsetVolumeOsdLayout = null;
    clearHeadsetVolumeNotificationTimer();
  });
}

function updateMicMuteNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setMicMuteScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateMicMuteNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setMicMutePalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function updateMicMuteNotificationUi(win: BrowserWindow, muted: boolean): void {
  void win.webContents
    .executeJavaScript(`window.__setMicMuteState?.(${muted ? "true" : "false"});`, true)
    .catch(() => undefined);
}

function applyMicMuteOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateMicMuteNotificationScale(win, layout.uiScale);
}

async function showMicMuteNotification(muted: boolean): Promise<void> {
  micMutePendingValue = muted;
  const nextLayout = resolveMicMuteOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const accent = muted ? MIC_MUTE_MUTED_ACCENT : MIC_MUTE_LIVE_ACCENT;

  if (micMuteNotificationWindow && !micMuteNotificationWindow.isDestroyed()) {
    const win = micMuteNotificationWindow;
    if (!win.isVisible()) {
      applyMicMuteOsdLayout(win, nextLayout);
      micMuteOsdLayout = nextLayout;
      win.showInactive();
    }
    updateMicMuteNotificationPalette(win, palette);
    updateMicMuteNotificationUi(win, micMutePendingValue ?? muted);
    scheduleMicMuteNotificationClose(win);
    return;
  }

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${accent};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
        }
        .icon {
          width: calc(30px * var(--s));
          height: calc(30px * var(--s));
          color: var(--accent);
          display: grid;
          place-items: center;
          line-height: 0;
        }
        .icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Microphone mute status">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30">
            <path id="mic-on" d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3zm5-3a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-3.1A5 5 0 0 0 17 11z" fill="currentColor" />
            <path id="mic-off" d="M5.7 4.3a1 1 0 0 0-1.4 1.4l4.9 4.9V11a3 3 0 0 0 4.4 2.7l1.6 1.6a3 3 0 0 1-2.2.8 3 3 0 0 1-3-3 1 1 0 0 0-2 0 5 5 0 0 0 4 4.9V19H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-1.1c1-.2 1.8-.6 2.6-1.2l2.7 2.7a1 1 0 0 0 1.4-1.4L5.7 4.3zM14 11a2 2 0 0 1-.2.8L11.2 9.2V7a1.8 1.8 0 1 1 3.6 0V11z" fill="currentColor" />
          </svg>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const micOn = document.getElementById("mic-on");
          const micOff = document.getElementById("mic-off");
          const liveAccent = "${MIC_MUTE_LIVE_ACCENT}";
          const mutedAccent = "${MIC_MUTE_MUTED_ACCENT}";
          const applyState = (muted) => {
            const isMuted = Boolean(muted);
            root.style.setProperty("--accent", isMuted ? mutedAccent : liveAccent);
            if (micOn) micOn.style.display = isMuted ? "none" : "block";
            if (micOff) micOff.style.display = isMuted ? "block" : "none";
          };
          window.__setMicMutePalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
          };
          window.__setMicMuteScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setMicMuteState = (next) => applyState(next);
          applyState(${muted ? "true" : "false"});
        })();
      </script>
    </body>
  </html>`;

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  micMuteNotificationWindow = win;
  micMuteOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showMicNotification = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = micMuteOsdLayout ?? nextLayout;
    applyMicMuteOsdLayout(win, layout);
    updateMicMuteNotificationPalette(win, palette);
    win.showInactive();
    updateMicMuteNotificationUi(win, micMutePendingValue ?? muted);
    scheduleMicMuteNotificationClose(win);
  };

  win.once("ready-to-show", showMicNotification);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showMicNotification();
    }
  });
  win.on("closed", () => {
    if (micMuteNotificationWindow === win) {
      micMuteNotificationWindow = null;
    }
    micMutePendingValue = null;
    micMuteOsdLayout = null;
    clearMicMuteNotificationTimer();
  });
}

function updateOledNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setOledScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateOledNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }, accent: string): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeAccent = String(accent || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText || !safeAccent) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setOledPalette?.('${safeBg}','${safeText}','${safeAccent}');`, true)
    .catch(() => undefined);
}

function updateOledNotificationUi(win: BrowserWindow, value: number | null): void {
  void win.webContents
    .executeJavaScript(`window.__setOledValue?.(${JSON.stringify(toNumericNotificationLabel(value))});`, true)
    .catch(() => undefined);
}

function applyOledOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateOledNotificationScale(win, layout.uiScale);
}

async function showOledNotification(value: number): Promise<void> {
  oledPendingValue = Number.isFinite(value) ? Number(value) : null;
  if (oledPendingValue == null) {
    return;
  }
  const nextLayout = resolveOledOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const accent = settings.accentColor.trim() || theme.accent;

  if (oledNotificationWindow && !oledNotificationWindow.isDestroyed()) {
    const win = oledNotificationWindow;
    if (!win.isVisible()) {
      applyOledOsdLayout(win, nextLayout);
      oledOsdLayout = nextLayout;
      win.showInactive();
    }
    updateOledNotificationPalette(win, palette, accent);
    updateOledNotificationUi(win, oledPendingValue);
    scheduleOledNotificationClose(win);
    return;
  }

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${accent};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
          padding: calc(9px * var(--s));
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(4px * var(--s));
          line-height: 1;
        }
        .headset {
          width: calc(18px * var(--s));
          height: calc(18px * var(--s));
          color: var(--text-color);
        }
        .headset svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .label {
          color: var(--text-color);
          font-size: calc(7.2px * var(--s));
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          opacity: 0.9;
        }
        .value {
          color: var(--accent);
          font-size: calc(28px * var(--s));
          font-weight: 800;
          letter-spacing: 0.01em;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="OLED brightness">
        <div class="stack">
          <div class="headset" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
            </svg>
          </div>
          <div class="label">OLED BRIGHTNESS</div>
          <div id="value" class="value">${toNumericNotificationLabel(oledPendingValue)}</div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const valueEl = document.getElementById("value");
          window.__setOledPalette = (bg, text, accent) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            const nextAccent = String(accent || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
            if (nextAccent) root.style.setProperty("--accent", nextAccent);
          };
          window.__setOledScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setOledValue = (next) => {
            const text = String(next ?? "--").trim() || "--";
            if (valueEl) valueEl.textContent = text;
          };
          window.__setOledValue(${JSON.stringify(toNumericNotificationLabel(oledPendingValue))});
        })();
      </script>
    </body>
  </html>`;

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  oledNotificationWindow = win;
  oledOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showOledOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = oledOsdLayout ?? nextLayout;
    applyOledOsdLayout(win, layout);
    updateOledNotificationPalette(win, palette, accent);
    win.showInactive();
    updateOledNotificationUi(win, oledPendingValue);
    scheduleOledNotificationClose(win);
  };

  win.once("ready-to-show", showOledOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showOledOsd();
    }
  });
  win.on("closed", () => {
    if (oledNotificationWindow === win) {
      oledNotificationWindow = null;
    }
    oledPendingValue = null;
    oledOsdLayout = null;
    clearOledNotificationTimer();
  });
}

function updateSidetoneNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setSidetoneScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateSidetoneNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }, accent: string): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeAccent = String(accent || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText || !safeAccent) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setSidetonePalette?.('${safeBg}','${safeText}','${safeAccent}');`, true)
    .catch(() => undefined);
}

function updateSidetoneNotificationUi(win: BrowserWindow, value: number | null): void {
  void win.webContents
    .executeJavaScript(`window.__setSidetoneValue?.(${JSON.stringify(toNumericNotificationLabel(value))});`, true)
    .catch(() => undefined);
}

function applySidetoneOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateSidetoneNotificationScale(win, layout.uiScale);
}

async function showSidetoneNotification(value: number): Promise<void> {
  sidetonePendingValue = Number.isFinite(value) ? Number(value) : null;
  if (sidetonePendingValue == null) {
    return;
  }
  const nextLayout = resolveSidetoneOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const accent = settings.accentColor.trim() || theme.accent;

  if (sidetoneNotificationWindow && !sidetoneNotificationWindow.isDestroyed()) {
    const win = sidetoneNotificationWindow;
    if (!win.isVisible()) {
      applySidetoneOsdLayout(win, nextLayout);
      sidetoneOsdLayout = nextLayout;
      win.showInactive();
    }
    updateSidetoneNotificationPalette(win, palette, accent);
    updateSidetoneNotificationUi(win, sidetonePendingValue);
    scheduleSidetoneNotificationClose(win);
    return;
  }

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${accent};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
          padding: calc(9px * var(--s));
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(4px * var(--s));
          line-height: 1;
        }
        .headset {
          width: calc(18px * var(--s));
          height: calc(18px * var(--s));
          color: var(--text-color);
        }
        .headset svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .label {
          color: var(--text-color);
          font-size: calc(7.2px * var(--s));
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          opacity: 0.9;
        }
        .value {
          color: var(--accent);
          font-size: calc(28px * var(--s));
          font-weight: 800;
          letter-spacing: 0.01em;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Sidetone level">
        <div class="stack">
          <div class="headset" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
            </svg>
          </div>
          <div class="label">SIDETONE</div>
          <div id="value" class="value">${toNumericNotificationLabel(sidetonePendingValue)}</div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const valueEl = document.getElementById("value");
          window.__setSidetonePalette = (bg, text, accent) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            const nextAccent = String(accent || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
            if (nextAccent) root.style.setProperty("--accent", nextAccent);
          };
          window.__setSidetoneScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setSidetoneValue = (next) => {
            const text = String(next ?? "--").trim() || "--";
            if (valueEl) valueEl.textContent = text;
          };
          window.__setSidetoneValue(${JSON.stringify(toNumericNotificationLabel(sidetonePendingValue))});
        })();
      </script>
    </body>
  </html>`;

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  sidetoneNotificationWindow = win;
  sidetoneOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showSidetoneOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = sidetoneOsdLayout ?? nextLayout;
    applySidetoneOsdLayout(win, layout);
    updateSidetoneNotificationPalette(win, palette, accent);
    win.showInactive();
    updateSidetoneNotificationUi(win, sidetonePendingValue);
    scheduleSidetoneNotificationClose(win);
  };

  win.once("ready-to-show", showSidetoneOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showSidetoneOsd();
    }
  });
  win.on("closed", () => {
    if (sidetoneNotificationWindow === win) {
      sidetoneNotificationWindow = null;
    }
    sidetonePendingValue = null;
    sidetoneOsdLayout = null;
    clearSidetoneNotificationTimer();
  });
}

function updatePresetChangeNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setPresetChangeScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updatePresetChangeNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }, accent: string): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeAccent = String(accent || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText || !safeAccent) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setPresetChangePalette?.('${safeBg}','${safeText}','${safeAccent}');`, true)
    .catch(() => undefined);
}

function updatePresetChangeNotificationUi(win: BrowserWindow, payload: { channel: ChannelKey; presetName: string }): void {
  const channel = channelDisplayName(payload.channel);
  const presetName = String(payload.presetName || "").trim() || "Preset";
  void win.webContents
    .executeJavaScript(`window.__setPresetChangeState?.(${JSON.stringify(channel)}, ${JSON.stringify(presetName)});`, true)
    .catch(() => undefined);
}

function applyPresetChangeOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updatePresetChangeNotificationScale(win, layout.uiScale);
}

async function showPresetChangeNotification(channel: ChannelKey, presetName: string): Promise<void> {
  presetChangePendingValue = { channel, presetName: String(presetName || "").trim() || "Preset" };
  const nextLayout = resolvePresetChangeOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const accent = settings.accentColor.trim() || theme.accent;

  if (presetChangeNotificationWindow && !presetChangeNotificationWindow.isDestroyed()) {
    const win = presetChangeNotificationWindow;
    if (!win.isVisible()) {
      applyPresetChangeOsdLayout(win, nextLayout);
      presetChangeOsdLayout = nextLayout;
      win.showInactive();
    }
    updatePresetChangeNotificationPalette(win, palette, accent);
    updatePresetChangeNotificationUi(win, presetChangePendingValue);
    schedulePresetChangeNotificationClose(win);
    return;
  }

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${accent};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: calc(12px * var(--s));
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          grid-template-columns: calc(34px * var(--s)) 1fr;
          column-gap: calc(8px * var(--s));
          align-items: center;
          padding: calc(8px * var(--s));
        }
        .icon {
          width: calc(34px * var(--s));
          height: calc(34px * var(--s));
          border-radius: 999px;
          display: grid;
          place-items: center;
          background: color-mix(in srgb, var(--accent) 20%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 44%, transparent);
          color: var(--accent);
          line-height: 0;
        }
        .icon svg {
          width: calc(20px * var(--s));
          height: calc(20px * var(--s));
          display: block;
        }
        .copy {
          min-width: 0;
          display: grid;
          row-gap: calc(1px * var(--s));
        }
        .title {
          font-size: calc(10px * var(--s));
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.74;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text-color);
        }
        .value {
          font-size: calc(14px * var(--s));
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text-color);
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Preset change">
        <div class="icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 4a2 2 0 0 0-2 2v12l4-3 4 3V6a2 2 0 0 0-2-2H6zm9 1h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2zm0 4h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2zm0 4h4a1 1 0 1 1 0 2h-4a1 1 0 1 1 0-2z" fill="currentColor"/>
          </svg>
        </div>
        <div class="copy">
          <div class="title" id="channel">CHANNEL PRESET</div>
          <div class="value" id="preset">Preset</div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const channelEl = document.getElementById("channel");
          const presetEl = document.getElementById("preset");
          window.__setPresetChangePalette = (bg, text, accent) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            const nextAccent = String(accent || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
            if (nextAccent) root.style.setProperty("--accent", nextAccent);
          };
          window.__setPresetChangeScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setPresetChangeState = (channel, preset) => {
            const channelText = String(channel || "CHANNEL").trim() || "CHANNEL";
            const presetText = String(preset || "Preset").trim() || "Preset";
            if (channelEl) channelEl.textContent = channelText + " PRESET";
            if (presetEl) presetEl.textContent = presetText;
          };
          window.__setPresetChangeState(${JSON.stringify(channelDisplayName(channel))}, ${JSON.stringify(presetChangePendingValue.presetName)});
        })();
      </script>
    </body>
  </html>`;

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  presetChangeNotificationWindow = win;
  presetChangeOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showPresetNotification = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = presetChangeOsdLayout ?? nextLayout;
    applyPresetChangeOsdLayout(win, layout);
    updatePresetChangeNotificationPalette(win, palette, accent);
    win.showInactive();
    updatePresetChangeNotificationUi(win, presetChangePendingValue ?? { channel, presetName });
    schedulePresetChangeNotificationClose(win);
  };

  win.once("ready-to-show", showPresetNotification);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showPresetNotification();
    }
  });
  win.on("closed", () => {
    if (presetChangeNotificationWindow === win) {
      presetChangeNotificationWindow = null;
    }
    presetChangePendingValue = null;
    presetChangeOsdLayout = null;
    clearPresetChangeNotificationTimer();
  });
}

function updateUsbInputNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setUsbInputScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateUsbInputNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }, accent: string): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeAccent = String(accent || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText || !safeAccent) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setUsbInputPalette?.('${safeBg}','${safeText}','${safeAccent}');`, true)
    .catch(() => undefined);
}

function updateUsbInputNotificationUi(win: BrowserWindow, input: 1 | 2): void {
  const safeInput = input === 2 ? 2 : 1;
  void win.webContents
    .executeJavaScript(`window.__setUsbInputState?.(${safeInput});`, true)
    .catch(() => undefined);
}

function applyUsbInputOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateUsbInputNotificationScale(win, layout.uiScale);
}

async function showUsbInputNotification(input: 1 | 2): Promise<void> {
  const selected = input === 2 ? 2 : 1;
  usbInputPendingValue = selected;
  const nextLayout = resolveUsbInputOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const accent = settings.accentColor.trim() || theme.accent;
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${accent};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
          padding: calc(8px * var(--s));
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(2px * var(--s));
          text-align: center;
          line-height: 1;
        }
        .icon {
          width: calc(17px * var(--s));
          height: calc(17px * var(--s));
          color: var(--accent);
        }
        .icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .label {
          color: var(--text-color);
          font-size: calc(6.5px * var(--s));
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .value {
          color: var(--accent);
          font-size: calc(10px * var(--s));
          font-weight: 700;
          letter-spacing: 0.03em;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="USB input selected">
        <div class="stack">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17">
              <path d="M7 2a1 1 0 0 1 1 1v3h2V3a1 1 0 1 1 2 0v3h2V3a1 1 0 1 1 2 0v3h1a1 1 0 1 1 0 2h-1v2a5 5 0 0 1-4 4.9V20a1 1 0 1 1-2 0v-5.1A5 5 0 0 1 6 10V8H5a1 1 0 1 1 0-2h2V3a1 1 0 0 1 1-1z" fill="currentColor" />
            </svg>
          </div>
          <div class="label">USB INPUT SELECTED</div>
          <div id="value" class="value">INPUT 1</div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const valueEl = document.getElementById("value");
          const applyState = (next) => {
            const value = Number(next) === 2 ? 2 : 1;
            if (valueEl) valueEl.textContent = "INPUT " + String(value);
          };
          window.__setUsbInputPalette = (bg, text, accent) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            const nextAccent = String(accent || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
            if (nextAccent) root.style.setProperty("--accent", nextAccent);
          };
          window.__setUsbInputScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setUsbInputState = (next) => applyState(next);
          applyState(${selected});
        })();
      </script>
    </body>
  </html>`;

  if (usbInputNotificationWindow && !usbInputNotificationWindow.isDestroyed()) {
    const win = usbInputNotificationWindow;
    if (!win.isVisible()) {
      applyUsbInputOsdLayout(win, nextLayout);
      usbInputOsdLayout = nextLayout;
      win.showInactive();
    }
    updateUsbInputNotificationPalette(win, palette, accent);
    updateUsbInputNotificationUi(win, usbInputPendingValue ?? selected);
    scheduleUsbInputNotificationClose(win);
    return;
  }

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  usbInputNotificationWindow = win;
  usbInputOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showUsbInputOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = usbInputOsdLayout ?? nextLayout;
    applyUsbInputOsdLayout(win, layout);
    updateUsbInputNotificationPalette(win, palette, accent);
    win.showInactive();
    updateUsbInputNotificationUi(win, usbInputPendingValue ?? selected);
    scheduleUsbInputNotificationClose(win);
  };

  win.once("ready-to-show", showUsbInputOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showUsbInputOsd();
    }
  });
  win.on("closed", () => {
    if (usbInputNotificationWindow === win) {
      usbInputNotificationWindow = null;
    }
    usbInputPendingValue = null;
    usbInputOsdLayout = null;
    clearUsbInputNotificationTimer();
  });
}

function normalizeAncNotificationMode(rawValue: string | null | undefined): AncNotificationMode | null {
  const value = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }
  if (value === "off") {
    return "off";
  }
  if (value === "anc" || value === "on") {
    return "anc";
  }
  if (value === "transparency" || value === "transparent" || value === "passthrough" || value === "pass-through") {
    return "transparency";
  }
  return null;
}

function updateAncModeNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setAncModeScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateAncModeNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setAncModePalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function updateAncModeNotificationUi(win: BrowserWindow, mode: AncNotificationMode): void {
  const safeMode = mode === "off" || mode === "anc" || mode === "transparency" ? mode : "off";
  void win.webContents
    .executeJavaScript(`window.__setAncModeState?.('${safeMode}');`, true)
    .catch(() => undefined);
}

function applyAncModeOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateAncModeNotificationScale(win, layout.uiScale);
}

async function showAncModeNotification(rawMode: string): Promise<void> {
  const mode = normalizeAncNotificationMode(rawMode);
  if (!mode) {
    return;
  }
  ancModePendingValue = mode;
  const nextLayout = resolveAncModeOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --anc-off: ${ANC_MODE_OFF_ACCENT};
          --anc-on: ${ANC_MODE_ON_ACCENT};
          --anc-pass: ${ANC_MODE_TRANSPARENCY_ACCENT};
          --accent: var(--anc-off);
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
        }
        .content {
          color: var(--accent);
          display: grid;
          place-items: center;
          row-gap: calc(2px * var(--s));
          line-height: 1;
        }
        .label {
          font-size: calc(16px * var(--s));
          font-weight: 700;
          letter-spacing: 0.03em;
        }
        .icon {
          width: calc(20px * var(--s));
          height: calc(20px * var(--s));
          display: none;
        }
        .icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="ANC status">
        <div id="content" class="content">
          <div id="label" class="label">ANC</div>
          <div id="icon" class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26">
              <path d="M4 9h11l-2.2-2.2a1 1 0 0 1 1.4-1.4l3.9 3.9a1 1 0 0 1 0 1.4l-3.9 3.9a1 1 0 0 1-1.4-1.4L15 11H4a1 1 0 1 1 0-2zm16 6H9l2.2 2.2a1 1 0 1 1-1.4 1.4l-3.9-3.9a1 1 0 0 1 0-1.4l3.9-3.9a1 1 0 1 1 1.4 1.4L9 13h11a1 1 0 1 1 0 2z" fill="currentColor" />
            </svg>
          </div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const label = document.getElementById("label");
          const icon = document.getElementById("icon");
          const applyState = (mode) => {
            const next = String(mode || "").trim().toLowerCase();
            if (next === "anc") {
              root.style.setProperty("--accent", "var(--anc-on)");
              if (label) label.style.display = "block";
              if (icon) icon.style.display = "none";
              if (label) label.textContent = "ANC";
              return;
            }
            if (next === "transparency") {
              root.style.setProperty("--accent", "var(--anc-pass)");
              if (label) label.style.display = "none";
              if (icon) icon.style.display = "block";
              return;
            }
            root.style.setProperty("--accent", "var(--anc-off)");
            if (label) label.style.display = "block";
            if (icon) icon.style.display = "none";
            if (label) label.textContent = "ANC";
          };
          window.__setAncModePalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
          };
          window.__setAncModeScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setAncModeState = (nextMode) => applyState(nextMode);
          applyState("${mode}");
        })();
      </script>
    </body>
  </html>`;

  if (ancModeNotificationWindow && !ancModeNotificationWindow.isDestroyed()) {
    const win = ancModeNotificationWindow;
    if (!win.isVisible()) {
      applyAncModeOsdLayout(win, nextLayout);
      ancModeOsdLayout = nextLayout;
      win.showInactive();
    }
    updateAncModeNotificationPalette(win, palette);
    updateAncModeNotificationUi(win, ancModePendingValue ?? mode);
    scheduleAncModeNotificationClose(win);
    return;
  }

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  ancModeNotificationWindow = win;
  ancModeOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showAncNotification = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = ancModeOsdLayout ?? nextLayout;
    applyAncModeOsdLayout(win, layout);
    updateAncModeNotificationPalette(win, palette);
    win.showInactive();
    updateAncModeNotificationUi(win, ancModePendingValue ?? mode);
    scheduleAncModeNotificationClose(win);
  };

  win.once("ready-to-show", showAncNotification);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showAncNotification();
    }
  });
  win.on("closed", () => {
    if (ancModeNotificationWindow === win) {
      ancModeNotificationWindow = null;
    }
    ancModePendingValue = null;
    ancModeOsdLayout = null;
    clearAncModeNotificationTimer();
  });
}

function updateConnectivityNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setConnectivityScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateConnectivityNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setConnectivityPalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function updateConnectivityNotificationUi(win: BrowserWindow, payload: ConnectivityNotificationPayload): void {
  const safePayload = JSON.stringify({
    connected: Boolean(payload.connected),
    wireless: Boolean(payload.wireless),
    bluetooth: Boolean(payload.bluetooth),
    battery: toNullablePercent(payload.battery),
  });
  void win.webContents
    .executeJavaScript(`window.__setConnectivityState?.(${safePayload});`, true)
    .catch(() => undefined);
}

function applyConnectivityOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateConnectivityNotificationScale(win, layout.uiScale);
}

async function showConnectivityNotification(payload: ConnectivityNotificationPayload): Promise<void> {
  const normalized: ConnectivityNotificationPayload = {
    connected: Boolean(payload.connected),
    wireless: Boolean(payload.wireless),
    bluetooth: Boolean(payload.bluetooth),
    battery: toNullablePercent(payload.battery),
  };
  connectivityPendingValue = normalized;
  const nextLayout = resolveConnectivityOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --ok: ${CONNECTIVITY_CONNECTED_ACCENT};
          --bad: ${CONNECTIVITY_DISCONNECTED_ACCENT};
          --accent: var(--ok);
          --bar-off: rgba(145,145,145,0.92);
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(3px * var(--s));
          line-height: 1;
        }
        .headset {
          width: calc(17px * var(--s));
          height: calc(17px * var(--s));
          color: var(--text-color);
        }
        .headset svg,
        .transport svg,
        .battery svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .status {
          color: var(--accent);
          font-size: calc(9px * var(--s));
          font-weight: 700;
          letter-spacing: 0.06em;
        }
        .transport {
          color: var(--accent);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: calc(4px * var(--s));
          min-height: calc(12px * var(--s));
        }
        .transport-icon {
          width: calc(12px * var(--s));
          height: calc(12px * var(--s));
          display: none;
        }
        .battery {
          width: calc(28px * var(--s));
          height: calc(14px * var(--s));
          color: var(--text-color);
        }
        .battery .body {
          stroke: currentColor;
        }
        .battery .cap {
          fill: currentColor;
        }
        .battery .bar {
          fill: var(--bar-off);
          opacity: 1;
          stroke: rgba(0,0,0,0.22);
          stroke-width: 0.3;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Connectivity status">
        <div class="stack">
          <div class="headset" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17">
              <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
            </svg>
          </div>
          <div id="status" class="status">CONNECTED</div>
          <div id="transport" class="transport">
            <div id="wifi" class="transport-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="12" height="12">
                <path d="M2 9a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a6 6 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <circle cx="12" cy="19" r="1.7" fill="currentColor" />
              </svg>
            </div>
            <div id="bt" class="transport-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="12" height="12">
                <path d="M11 4l6 5-6 5V4zm0 10l6 6-6-3v-3zm0-10v16M5 7l12 10M5 17L17 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
          <div id="battery" class="battery" aria-hidden="true">
            <svg viewBox="0 0 24 14" width="24" height="12">
              <rect class="body" x="1" y="2" width="19" height="10" rx="2" fill="none" stroke-width="1.8" />
              <rect class="cap" x="21" y="5" width="2" height="4" rx="1" />
              <rect id="bar1" class="bar" x="3" y="4" width="3" height="6" rx="0.8" />
              <rect id="bar2" class="bar" x="7" y="4" width="3" height="6" rx="0.8" />
              <rect id="bar3" class="bar" x="11" y="4" width="3" height="6" rx="0.8" />
              <rect id="bar4" class="bar" x="15" y="4" width="3" height="6" rx="0.8" />
            </svg>
          </div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const statusEl = document.getElementById("status");
          const transportEl = document.getElementById("transport");
          const batteryEl = document.getElementById("battery");
          const wifiEl = document.getElementById("wifi");
          const btEl = document.getElementById("bt");
          const bars = [1, 2, 3, 4].map((n) => document.getElementById("bar" + n));
          let activeBarColor = "${CONNECTIVITY_CONNECTED_ACCENT}";
          const paintBars = (activeBars) => {
            const count = Math.max(0, Math.min(4, Math.round(Number(activeBars) || 0)));
            bars.forEach((bar, idx) => {
              if (!bar) return;
              bar.style.fill = idx < count ? activeBarColor : "var(--bar-off)";
              bar.style.opacity = idx < count ? "1" : "0.96";
            });
          };
          const applyBattery = (value) => {
            const next = Number(value);
            if (!Number.isFinite(next)) {
              paintBars(0);
              return;
            }
            const clamped = Math.max(0, Math.min(100, Math.round(next)));
            const activeBars = clamped <= 0 ? 0 : Math.ceil(clamped / 25);
            paintBars(activeBars);
          };
          const applyState = (next) => {
            const state = next && typeof next === "object" ? next : {};
            const connected = Boolean(state.connected);
            const wireless = Boolean(state.wireless);
            const bluetooth = Boolean(state.bluetooth);
            activeBarColor = connected ? "${CONNECTIVITY_CONNECTED_ACCENT}" : "${CONNECTIVITY_DISCONNECTED_ACCENT}";
            root.style.setProperty("--accent", activeBarColor);
            if (statusEl) statusEl.textContent = connected ? "CONNECTED" : "DISCONNECTED";
            const showTransport = connected && (wireless || bluetooth);
            if (transportEl) transportEl.style.display = showTransport ? "flex" : "none";
            if (batteryEl) batteryEl.style.display = connected ? "block" : "none";
            if (wifiEl) wifiEl.style.display = connected && wireless ? "block" : "none";
            if (btEl) btEl.style.display = connected && bluetooth ? "block" : "none";
            if (connected) {
              applyBattery(state.battery);
            }
          };
          window.__setConnectivityPalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
          };
          window.__setConnectivityScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setConnectivityState = (next) => applyState(next);
          applyState(${JSON.stringify(normalized)});
        })();
      </script>
    </body>
  </html>`;

  if (connectivityNotificationWindow && !connectivityNotificationWindow.isDestroyed()) {
    const win = connectivityNotificationWindow;
    if (!win.isVisible()) {
      applyConnectivityOsdLayout(win, nextLayout);
      connectivityOsdLayout = nextLayout;
      win.showInactive();
    }
    updateConnectivityNotificationPalette(win, palette);
    updateConnectivityNotificationUi(win, connectivityPendingValue ?? normalized);
    scheduleConnectivityNotificationClose(win);
    return;
  }

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  connectivityNotificationWindow = win;
  connectivityOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showConnectivityOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = connectivityOsdLayout ?? nextLayout;
    applyConnectivityOsdLayout(win, layout);
    updateConnectivityNotificationPalette(win, palette);
    win.showInactive();
    updateConnectivityNotificationUi(win, connectivityPendingValue ?? normalized);
    scheduleConnectivityNotificationClose(win);
  };

  win.once("ready-to-show", showConnectivityOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showConnectivityOsd();
    }
  });
  win.on("closed", () => {
    if (connectivityNotificationWindow === win) {
      connectivityNotificationWindow = null;
    }
    connectivityPendingValue = null;
    connectivityOsdLayout = null;
    clearConnectivityNotificationTimer();
  });
}

function playBatteryLowAlertTone(): void {
  shell.beep();
}

function updateBatteryLowNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setBatteryLowScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateBatteryLowNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setBatteryLowPalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function updateBatteryLowNotificationUi(win: BrowserWindow, payload: BatteryLowNotificationPayload): void {
  const safePayload = JSON.stringify({
    battery: toNullablePercent(payload.battery),
    threshold: clampPercent(payload.threshold),
  });
  void win.webContents
    .executeJavaScript(`window.__setBatteryLowState?.(${safePayload});`, true)
    .catch(() => undefined);
}

function applyBatteryLowOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateBatteryLowNotificationScale(win, layout.uiScale);
}

async function showBatteryLowNotification(payload: BatteryLowNotificationPayload): Promise<void> {
  const normalized: BatteryLowNotificationPayload = {
    battery: toNullablePercent(payload.battery),
    threshold: clampPercent(payload.threshold),
  };
  batteryLowPendingValue = normalized;
  const nextLayout = resolveBatteryLowOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${BATTERY_LOW_OSD_ACCENT};
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
          padding: calc(8px * var(--s));
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(3px * var(--s));
          text-align: center;
          line-height: 1;
        }
        .headset {
          width: calc(18px * var(--s));
          height: calc(18px * var(--s));
          color: var(--text-color);
        }
        .headset svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .warning {
          color: var(--accent);
          font-size: calc(10px * var(--s));
          font-weight: 700;
          letter-spacing: 0.06em;
        }
        .detail {
          color: var(--text-color);
          opacity: 0.9;
          font-size: calc(8px * var(--s));
          font-weight: 600;
        }
        .level {
          color: var(--accent);
          font-size: calc(8px * var(--s));
          font-weight: 700;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Low headset battery warning">
        <div class="stack">
          <div class="headset" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
            </svg>
          </div>
          <div class="warning">LOW BATTERY</div>
          <div class="detail">Replace headset battery</div>
          <div id="level" class="level"></div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const levelEl = document.getElementById("level");
          const applyState = (next) => {
            const state = next && typeof next === "object" ? next : {};
            const level = Number(state.battery);
            if (!Number.isFinite(level)) {
              if (levelEl) levelEl.textContent = "";
              return;
            }
            const pct = Math.max(0, Math.min(100, Math.round(level)));
            if (levelEl) levelEl.textContent = pct + "%";
          };
          window.__setBatteryLowPalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
          };
          window.__setBatteryLowScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setBatteryLowState = (next) => applyState(next);
          applyState(${JSON.stringify(normalized)});
        })();
      </script>
    </body>
  </html>`;

  if (batteryLowNotificationWindow && !batteryLowNotificationWindow.isDestroyed()) {
    const win = batteryLowNotificationWindow;
    const wasVisible = win.isVisible();
    if (!wasVisible) {
      applyBatteryLowOsdLayout(win, nextLayout);
      batteryLowOsdLayout = nextLayout;
      win.showInactive();
    }
    updateBatteryLowNotificationPalette(win, palette);
    updateBatteryLowNotificationUi(win, batteryLowPendingValue ?? normalized);
    scheduleBatteryLowNotificationClose(win);
    if (!wasVisible) {
      playBatteryLowAlertTone();
    }
    return;
  }

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  batteryLowNotificationWindow = win;
  batteryLowOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showBatteryLowOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = batteryLowOsdLayout ?? nextLayout;
    applyBatteryLowOsdLayout(win, layout);
    updateBatteryLowNotificationPalette(win, palette);
    win.showInactive();
    updateBatteryLowNotificationUi(win, batteryLowPendingValue ?? normalized);
    scheduleBatteryLowNotificationClose(win);
    playBatteryLowAlertTone();
  };

  win.once("ready-to-show", showBatteryLowOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showBatteryLowOsd();
    }
  });
  win.on("closed", () => {
    if (batteryLowNotificationWindow === win) {
      batteryLowNotificationWindow = null;
    }
    batteryLowPendingValue = null;
    batteryLowOsdLayout = null;
    clearBatteryLowNotificationTimer();
  });
}

function updateBaseBatteryStatusNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setBaseBatteryScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateBaseBatteryStatusNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setBaseBatteryPalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function updateBaseBatteryStatusNotificationUi(win: BrowserWindow, payload: BaseBatteryStatusNotificationPayload): void {
  const safePayload = JSON.stringify({
    inserted: Boolean(payload.inserted),
    battery: toNullablePercent(payload.battery),
  });
  void win.webContents
    .executeJavaScript(`window.__setBaseBatteryState?.(${safePayload});`, true)
    .catch(() => undefined);
}

function applyBaseBatteryStatusOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateBaseBatteryStatusNotificationScale(win, layout.uiScale);
}

async function showBaseBatteryStatusNotification(payload: BaseBatteryStatusNotificationPayload): Promise<void> {
  const normalized: BaseBatteryStatusNotificationPayload = {
    inserted: Boolean(payload.inserted),
    battery: toNullablePercent(payload.battery),
  };
  baseBatteryStatusPendingValue = normalized;
  const nextLayout = resolveBaseBatteryStatusOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --inserted: ${BASE_BATTERY_INSERTED_ACCENT};
          --removed: ${BASE_BATTERY_REMOVED_ACCENT};
          --accent: var(--inserted);
          --bar-off: rgba(255,255,255,0.34);
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
          padding: calc(8px * var(--s));
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(3px * var(--s));
          text-align: center;
          line-height: 1;
        }
        .icon {
          width: calc(18px * var(--s));
          height: calc(18px * var(--s));
          color: var(--text-color);
        }
        .icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .icon .body {
          stroke: currentColor;
        }
        .icon .cap {
          fill: currentColor;
        }
        .icon .bar {
          fill: var(--bar-off);
          opacity: 1;
        }
        .status {
          color: var(--accent);
          font-size: calc(9px * var(--s));
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .level {
          color: var(--text-color);
          opacity: 0.9;
          font-size: calc(8px * var(--s));
          font-weight: 600;
          min-height: 1em;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Base station battery state">
        <div class="stack">
          <div class="icon" aria-hidden="true">
            <svg viewBox="0 0 24 14" width="24" height="14">
              <rect class="body" x="1" y="2" width="19" height="10" rx="2" fill="none" stroke-width="1.8" />
              <rect class="cap" x="21" y="5" width="2" height="4" rx="1" />
              <rect id="bb1" class="bar" x="3" y="4" width="3" height="6" rx="0.8" />
              <rect id="bb2" class="bar" x="7" y="4" width="3" height="6" rx="0.8" />
              <rect id="bb3" class="bar" x="11" y="4" width="3" height="6" rx="0.8" />
              <rect id="bb4" class="bar" x="15" y="4" width="3" height="6" rx="0.8" />
            </svg>
          </div>
          <div id="status" class="status">BATTERY INSERTED</div>
          <div id="level" class="level"></div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const statusEl = document.getElementById("status");
          const levelEl = document.getElementById("level");
          const bars = [1, 2, 3, 4].map((n) => document.getElementById("bb" + n));
          const paintBars = (activeBars) => {
            const count = Math.max(0, Math.min(4, Math.round(Number(activeBars) || 0)));
            bars.forEach((bar, idx) => {
              if (!bar) return;
              bar.style.fill = idx < count ? "var(--accent)" : "var(--bar-off)";
            });
          };
          const applyBars = (inserted, level) => {
            if (!inserted) {
              paintBars(0);
              return;
            }
            if (!Number.isFinite(level)) {
              paintBars(0);
              return;
            }
            const clamped = Math.max(0, Math.min(100, Math.round(level)));
            const activeBars = clamped <= 0 ? 0 : Math.ceil(clamped / 25);
            paintBars(activeBars);
          };
          const applyState = (next) => {
            const state = next && typeof next === "object" ? next : {};
            const inserted = Boolean(state.inserted);
            const level = Number(state.battery);
            root.style.setProperty("--accent", inserted ? "var(--inserted)" : "var(--removed)");
            if (statusEl) statusEl.textContent = inserted ? "BATTERY INSERTED" : "BATTERY REMOVED";
            applyBars(inserted, level);
            if (levelEl) {
              if (inserted && Number.isFinite(level)) {
                const pct = Math.max(0, Math.min(100, Math.round(level)));
                levelEl.textContent = "Charge " + pct + "%";
                levelEl.style.display = "block";
              } else {
                levelEl.textContent = "";
                levelEl.style.display = "none";
              }
            }
          };
          window.__setBaseBatteryPalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
          };
          window.__setBaseBatteryScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setBaseBatteryState = (next) => applyState(next);
          applyState(${JSON.stringify(normalized)});
        })();
      </script>
    </body>
  </html>`;

  if (baseBatteryStatusNotificationWindow && !baseBatteryStatusNotificationWindow.isDestroyed()) {
    const win = baseBatteryStatusNotificationWindow;
    if (!win.isVisible()) {
      applyBaseBatteryStatusOsdLayout(win, nextLayout);
      baseBatteryStatusOsdLayout = nextLayout;
      win.showInactive();
    }
    updateBaseBatteryStatusNotificationPalette(win, palette);
    updateBaseBatteryStatusNotificationUi(win, baseBatteryStatusPendingValue ?? normalized);
    scheduleBaseBatteryStatusNotificationClose(win);
    return;
  }

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  baseBatteryStatusNotificationWindow = win;
  baseBatteryStatusOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showBaseBatteryStatusOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = baseBatteryStatusOsdLayout ?? nextLayout;
    applyBaseBatteryStatusOsdLayout(win, layout);
    updateBaseBatteryStatusNotificationPalette(win, palette);
    win.showInactive();
    updateBaseBatteryStatusNotificationUi(win, baseBatteryStatusPendingValue ?? normalized);
    scheduleBaseBatteryStatusNotificationClose(win);
  };

  win.once("ready-to-show", showBaseBatteryStatusOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showBaseBatteryStatusOsd();
    }
  });
  win.on("closed", () => {
    if (baseBatteryStatusNotificationWindow === win) {
      baseBatteryStatusNotificationWindow = null;
    }
    baseBatteryStatusPendingValue = null;
    baseBatteryStatusOsdLayout = null;
    clearBaseBatteryStatusNotificationTimer();
  });
}

function resetBatterySwapTrack(): void {
  batterySwapTrack.armed = false;
  batterySwapTrack.sawDisconnect = false;
  batterySwapTrack.sawReconnectWithHigherHeadset = false;
  batterySwapTrack.headsetBeforeSwap = null;
  batterySwapTrack.baseBeforeRemoval = null;
}

function scheduleHeadsetBatterySwapNotification(payload: HeadsetBatterySwapNotificationPayload, delayMs: number): void {
  clearHeadsetBatterySwapDelayTimer();
  const wait = Math.max(0, Math.round(delayMs));
  notificationTimerService.schedule("headsetBatterySwapDelay", wait, () => {
    if (!isNotifEnabled("battery")) {
      return;
    }
    void showHeadsetBatterySwapNotification(payload);
  });
}

function updateHeadsetBatterySwapNotificationScale(win: BrowserWindow, uiScale: number): void {
  const scale = clampNumber(uiScale, 0.75, 1.5).toFixed(4);
  void win.webContents
    .executeJavaScript(`window.__setHeadsetBatterySwapScale?.(${scale});`, true)
    .catch(() => undefined);
}

function updateHeadsetBatterySwapNotificationPalette(win: BrowserWindow, palette: { panelBg: string; textColor: string }): void {
  const safeBg = String(palette.panelBg || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeText = String(palette.textColor || "").trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (!safeBg || !safeText) {
    return;
  }
  void win.webContents
    .executeJavaScript(`window.__setHeadsetBatterySwapPalette?.('${safeBg}','${safeText}');`, true)
    .catch(() => undefined);
}

function updateHeadsetBatterySwapNotificationUi(win: BrowserWindow, payload: HeadsetBatterySwapNotificationPayload): void {
  const safePayload = JSON.stringify({
    headsetBattery: toNullablePercent(payload.headsetBattery),
  });
  void win.webContents
    .executeJavaScript(`window.__setHeadsetBatterySwapState?.(${safePayload});`, true)
    .catch(() => undefined);
}

function applyHeadsetBatterySwapOsdLayout(win: BrowserWindow, layout: OsdLayout): void {
  win.setMinimumSize(layout.width, layout.height);
  win.setMaximumSize(layout.width, layout.height);
  const bounds = win.getBounds();
  if (bounds.x !== layout.x || bounds.y !== layout.y || bounds.width !== layout.width || bounds.height !== layout.height) {
    win.setBounds(
      {
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
      },
      false,
    );
  }
  updateHeadsetBatterySwapNotificationScale(win, layout.uiScale);
}

async function showHeadsetBatterySwapNotification(payload: HeadsetBatterySwapNotificationPayload): Promise<void> {
  const normalized: HeadsetBatterySwapNotificationPayload = {
    headsetBattery: toNullablePercent(payload.headsetBattery),
  };
  headsetBatterySwapPendingValue = normalized;
  const nextLayout = resolveHeadsetBatterySwapOsdLayout();
  const theme = await getThemePayload();
  const palette = resolveHeadsetVolumeNotificationPalette(theme);
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' data:;" />
      <style>
        :root {
          color-scheme: dark;
          --s: ${nextLayout.uiScale.toFixed(4)};
          --panel-bg: ${palette.panelBg};
          --text-color: ${palette.textColor};
          --accent: ${HEADSET_BATTERY_SWAP_ACCENT};
          --bar-off: rgba(255,255,255,0.34);
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          overflow: hidden;
          font-family: "Segoe UI Variable Text", "Segoe UI", sans-serif;
        }
        .shell {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.14);
          background: var(--panel-bg);
          box-shadow: 0 8px 18px rgba(0,0,0,0.38);
          display: grid;
          place-items: center;
          padding: calc(8px * var(--s));
        }
        .stack {
          display: grid;
          justify-items: center;
          align-content: center;
          row-gap: calc(3px * var(--s));
          text-align: center;
          line-height: 1;
        }
        .headset {
          width: calc(17px * var(--s));
          height: calc(17px * var(--s));
          color: var(--text-color);
        }
        .headset svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .status {
          color: var(--accent);
          font-size: calc(8px * var(--s));
          font-weight: 700;
          letter-spacing: 0.05em;
        }
        .battery-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: calc(3px * var(--s));
          color: var(--text-color);
        }
        .battery {
          width: calc(26px * var(--s));
          height: calc(13px * var(--s));
        }
        .battery svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .battery .body {
          stroke: currentColor;
        }
        .battery .cap {
          fill: currentColor;
        }
        .battery .bar {
          fill: var(--bar-off);
        }
        .value {
          color: var(--accent);
          font-size: calc(8px * var(--s));
          font-weight: 700;
          min-width: 3ch;
          text-align: right;
        }
      </style>
    </head>
    <body>
      <div class="shell" aria-label="Headset battery swapped">
        <div class="stack">
          <div class="headset" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="17" height="17">
              <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
            </svg>
          </div>
          <div class="status">BATTERY SWAPPED</div>
          <div class="battery-row">
            <div class="battery" aria-hidden="true">
              <svg viewBox="0 0 24 14" width="24" height="12">
                <rect class="body" x="1" y="2" width="19" height="10" rx="2" fill="none" stroke-width="1.8" />
                <rect class="cap" x="21" y="5" width="2" height="4" rx="1" />
                <rect id="hs1" class="bar" x="3" y="4" width="3" height="6" rx="0.8" />
                <rect id="hs2" class="bar" x="7" y="4" width="3" height="6" rx="0.8" />
                <rect id="hs3" class="bar" x="11" y="4" width="3" height="6" rx="0.8" />
                <rect id="hs4" class="bar" x="15" y="4" width="3" height="6" rx="0.8" />
              </svg>
            </div>
            <div id="level" class="value">--%</div>
          </div>
        </div>
      </div>
      <script>
        (function () {
          const root = document.documentElement;
          const levelEl = document.getElementById("level");
          const bars = [1, 2, 3, 4].map((n) => document.getElementById("hs" + n));
          const paintBars = (activeBars) => {
            const count = Math.max(0, Math.min(4, Math.round(Number(activeBars) || 0)));
            bars.forEach((bar, idx) => {
              if (!bar) return;
              bar.style.fill = idx < count ? "var(--accent)" : "var(--bar-off)";
            });
          };
          const applyState = (next) => {
            const state = next && typeof next === "object" ? next : {};
            const level = Number(state.headsetBattery);
            if (!Number.isFinite(level)) {
              paintBars(0);
              if (levelEl) levelEl.textContent = "--%";
              return;
            }
            const pct = Math.max(0, Math.min(100, Math.round(level)));
            const activeBars = pct <= 0 ? 0 : Math.ceil(pct / 25);
            paintBars(activeBars);
            if (levelEl) levelEl.textContent = pct + "%";
          };
          window.__setHeadsetBatterySwapPalette = (bg, text) => {
            const nextBg = String(bg || "").trim();
            const nextText = String(text || "").trim();
            if (nextBg) root.style.setProperty("--panel-bg", nextBg);
            if (nextText) root.style.setProperty("--text-color", nextText);
          };
          window.__setHeadsetBatterySwapScale = (s) => {
            const nextScale = Math.max(0.75, Math.min(1.5, Number(s) || 1));
            root.style.setProperty("--s", String(nextScale));
          };
          window.__setHeadsetBatterySwapState = (next) => applyState(next);
          applyState(${JSON.stringify(normalized)});
        })();
      </script>
    </body>
  </html>`;

  if (headsetBatterySwapNotificationWindow && !headsetBatterySwapNotificationWindow.isDestroyed()) {
    const win = headsetBatterySwapNotificationWindow;
    if (!win.isVisible()) {
      applyHeadsetBatterySwapOsdLayout(win, nextLayout);
      headsetBatterySwapOsdLayout = nextLayout;
      win.showInactive();
    }
    updateHeadsetBatterySwapNotificationPalette(win, palette);
    updateHeadsetBatterySwapNotificationUi(win, headsetBatterySwapPendingValue ?? normalized);
    scheduleHeadsetBatterySwapNotificationClose(win);
    return;
  }

  const win = new BrowserWindow({
    width: nextLayout.width,
    height: nextLayout.height,
    minWidth: nextLayout.width,
    maxWidth: nextLayout.width,
    minHeight: nextLayout.height,
    maxHeight: nextLayout.height,
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
    focusable: false,
    hasShadow: false,
  });

  headsetBatterySwapNotificationWindow = win;
  headsetBatterySwapOsdLayout = nextLayout;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const showHeadsetBatterySwapOsd = () => {
    if (win.isDestroyed()) {
      return;
    }
    const layout = headsetBatterySwapOsdLayout ?? nextLayout;
    applyHeadsetBatterySwapOsdLayout(win, layout);
    updateHeadsetBatterySwapNotificationPalette(win, palette);
    win.showInactive();
    updateHeadsetBatterySwapNotificationUi(win, headsetBatterySwapPendingValue ?? normalized);
    scheduleHeadsetBatterySwapNotificationClose(win);
  };

  win.once("ready-to-show", showHeadsetBatterySwapOsd);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showHeadsetBatterySwapOsd();
    }
  });
  win.on("closed", () => {
    if (headsetBatterySwapNotificationWindow === win) {
      headsetBatterySwapNotificationWindow = null;
    }
    headsetBatterySwapPendingValue = null;
    headsetBatterySwapOsdLayout = null;
    clearHeadsetBatterySwapNotificationTimer();
  });
}

function channelDisplayName(channel: string): string {
  if (channel === "chatRender") return "CHAT";
  if (channel === "chatCapture") return "MIC";
  return String(channel || "").toUpperCase();
}

function getPresetDisplayName(channel: ChannelKey, presetId: string): string {
  const presets = cachedPresets[channel] ?? [];
  const match = presets.find(([id]) => id === presetId);
  return match?.[1] ?? presetId;
}

function notifyStateChanges(previous: AppState, next: AppState): void {
  if (isNotifEnabled("connectivity")) {
    if (previous.connected !== next.connected && next.connected != null) {
      void showConnectivityNotification({
        connected: next.connected,
        wireless: Boolean(next.wireless),
        bluetooth: Boolean(next.bluetooth),
        battery: next.headset_battery_percent,
      });
    }
  }
  if (isNotifEnabled("ancMode") && previous.anc_mode !== next.anc_mode && next.anc_mode != null) {
    void showAncModeNotification(next.anc_mode);
  }
  if (isNotifEnabled("oled") && previous.oled_brightness !== next.oled_brightness && next.oled_brightness != null) {
    void showOledNotification(next.oled_brightness);
  }
  if (isNotifEnabled("sidetone") && previous.sidetone_level !== next.sidetone_level && next.sidetone_level != null) {
    void showSidetoneNotification(next.sidetone_level);
  }
  if (isNotifEnabled("micMute") && previous.mic_mute !== next.mic_mute && next.mic_mute != null) {
    void showMicMuteNotification(next.mic_mute);
  }
  if (isNotifEnabled("usbInput") && previous.current_usb_input !== next.current_usb_input && next.current_usb_input != null) {
    void showUsbInputNotification(next.current_usb_input);
  }
  const volumeChanged = previous.headset_volume_percent !== next.headset_volume_percent;
  const chatMixChanged = previous.chat_mix_balance !== next.chat_mix_balance;
  const chatMixOsdEnabled = isHeadsetChatMixEnabled();
  const shouldTriggerHeadsetOsd = volumeChanged || (chatMixOsdEnabled && chatMixChanged);
  if (isNotifEnabled("headsetVolume") && shouldTriggerHeadsetOsd) {
    void showHeadsetVolumeNotification({
      volume: volumeChanged ? next.headset_volume_percent : undefined,
      chatMix: chatMixOsdEnabled && chatMixChanged ? next.chat_mix_balance : undefined,
    });
  }
  if (isNotifEnabled("battery")) {
    const prevHeadset = previous.headset_battery_percent;
    const nextHeadset = next.headset_battery_percent;
    const threshold = clampPercent(settings.batteryLowThreshold);
    const remainedConnected = previous.connected === true && next.connected === true;
    if (remainedConnected && prevHeadset != null && nextHeadset != null && prevHeadset >= threshold && nextHeadset < threshold) {
      void showBatteryLowNotification({
        battery: nextHeadset,
        threshold,
      });
    }
    const prevBase = toNullablePercent(previous.base_battery_percent);
    const nextBase = toNullablePercent(next.base_battery_percent);
    // Base station charging slot reports 0 when no battery is inserted.
    const hadBattery = prevBase != null && prevBase > 0;
    const hasBattery = nextBase != null && nextBase > 0;
    if (hadBattery !== hasBattery) {
      void showBaseBatteryStatusNotification({
        inserted: hasBattery,
        battery: nextBase,
      });
    }

    // Headset battery swap detection sequence:
    // 1) headset battery below 50%
    // 2) base battery removed
    // 3) headset disconnects and reconnects with higher headset battery
    // 4) base battery returns with lower level than before removal
    if (!batterySwapTrack.armed) {
      const baselineHeadset = toNullablePercent(prevHeadset);
      if (baselineHeadset != null && baselineHeadset < 50 && hadBattery && !hasBattery && prevBase != null) {
        batterySwapTrack.armed = true;
        batterySwapTrack.sawDisconnect = false;
        batterySwapTrack.sawReconnectWithHigherHeadset = false;
        batterySwapTrack.headsetBeforeSwap = baselineHeadset;
        batterySwapTrack.baseBeforeRemoval = prevBase;
      }
    } else {
      const prevConnected = previous.connected === true;
      const nextConnected = next.connected === true;
      if (prevConnected && !nextConnected) {
        batterySwapTrack.sawDisconnect = true;
      }
      if (batterySwapTrack.sawDisconnect && !prevConnected && nextConnected) {
        const beforeSwap = batterySwapTrack.headsetBeforeSwap;
        const currentHeadset = toNullablePercent(nextHeadset);
        batterySwapTrack.sawReconnectWithHigherHeadset =
          beforeSwap != null && currentHeadset != null && currentHeadset > beforeSwap;
      }
      if (batterySwapTrack.sawReconnectWithHigherHeadset) {
        const baseBeforeRemoval = batterySwapTrack.baseBeforeRemoval;
        if (baseBeforeRemoval != null && hasBattery && nextBase != null && nextBase < baseBeforeRemoval) {
          const currentHeadset = toNullablePercent(nextHeadset);
          const waitForConnectivityMs = Math.max(0, connectivityNotificationHideAt - Date.now()) + 40;
          scheduleHeadsetBatterySwapNotification({ headsetBattery: currentHeadset }, waitForConnectivityMs);
          resetBatterySwapTrack();
        }
      }
      const sequenceInvalidated =
        (hasBattery && !batterySwapTrack.sawDisconnect) ||
        (batterySwapTrack.sawDisconnect && previous.connected === false && next.connected === true && !batterySwapTrack.sawReconnectWithHigherHeadset);
      if (sequenceInvalidated) {
        resetBatterySwapTrack();
      }
    }
  } else {
    resetBatterySwapTrack();
    clearHeadsetBatterySwapDelayTimer();
  }
  if (isNotifEnabled("presetChange")) {
    const prevPreset = previous.channel_preset ?? {};
    const nextPreset = next.channel_preset ?? {};
    for (const [channel, nextValue] of Object.entries(nextPreset) as Array<[ChannelKey, string | null | undefined]>) {
      const prevValue = prevPreset[channel];
      if (nextValue !== prevValue && nextValue != null && String(nextValue).trim()) {
        void showPresetChangeNotification(channel, getPresetDisplayName(channel, String(nextValue)));
      }
    }
  }
}

function migrateLegacyState(): void {
  if (persistenceService.hasPersistedSnapshot()) {
    return;
  }
  cachedState = mergeState(persistenceService.readLegacyStateCache());
  settings = mergeSettings(persistenceService.readLegacySettings());
  cachedState = applyUsbInputInference(cachedState);
  persistNow();
}

let cachedAccentColor: string | null = null;
let cachedAccentColorTs = 0;

/**
 * Reads Windows accent color from the registry, caching the result for 60 s.
 */
async function getWindowsAccentColor(): Promise<string> {
  const now = Date.now();
  if (cachedAccentColor !== null && now - cachedAccentColorTs < 60_000) {
    return cachedAccentColor;
  }
  if (process.platform !== "win32") {
    cachedAccentColor = "#6ab7ff";
    cachedAccentColorTs = now;
    return cachedAccentColor;
  }
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\DWM", "/v", "ColorizationColor"],
      { windowsHide: true },
      (err, stdout) => {
        let color = "#6ab7ff";
        if (!err && stdout) {
          const match = stdout.match(/0x([0-9A-Fa-f]{8})/);
          if (match) {
            color = `#${match[1].slice(2)}`;
          }
        }
        cachedAccentColor = color;
        cachedAccentColorTs = Date.now();
        resolve(color);
      },
    );
  });
}

/**
 * Returns theme payload consumed by renderer and OSD windows.
 */
async function getThemePayload(): Promise<{ isDark: boolean; accent: string }> {
  return {
    isDark: nativeTheme.shouldUseDarkColors,
    accent: await getWindowsAccentColor(),
  };
}

/**
 * Displays the flyout window and refreshes stale monitor data if needed.
 */
function showFlyout(): void {
  if (!mainWindow) {
    debugFlyout("showFlyout ignored: no mainWindow");
    return;
  }
  if (!mainWindowLoaded) {
    pendingFlyoutOpen = true;
    debugFlyout("showFlyout deferred: mainWindow not loaded");
    return;
  }
  if (mainWindow.isVisible()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    debugFlyout("showFlyout focus only: already visible");
    mainWindow.focus();
    return;
  }
  hideIntentUntil = 0;
  lastHideReason = "";
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (settings.useActiveDisplay) {
    positionBottomRight(mainWindow, resolveUiDisplay());
  }
  // Show the window immediately — UI renders with cached state.
  mainWindow.show();
  mainWindow.focus();
  debugFlyout("showFlyout completed");
  // Refresh data in the background after the window is visible.
  refreshDdcMonitorsOnOpen();
  if (backend && isServiceEnabled("sonarApiEnabled")) {
    void backend.refreshNow();
  }
}

/**
 * Hides the flyout window for explicit app-driven reasons only.
 */
function hideFlyout(reason = "unspecified"): void {
  if (!mainWindow) {
    debugFlyout("hideFlyout ignored: no mainWindow");
    return;
  }
  // Restrict hide triggers to explicit app-driven actions.
  const allowed = reason === "toggle" || reason === "ipc-close-current" || reason === "open-settings" || reason === "escape-key" || reason === "window-close" || reason === "blur";
  if (!allowed) {
    debugFlyout(`hideFlyout blocked reason=${reason}`);
    return;
  }
  if (reason === "blur" && flyoutPinned) {
    debugFlyout("hideFlyout blur blocked: flyout is pinned");
    return;
  }
  hideIntentUntil = Date.now() + 1200;
  lastHideReason = reason;
  debugFlyout(`hideFlyout called reason=${reason}`);
  mainWindow.hide();
}

/**
 * Toggles flyout visibility with debounce and stuck-open protection.
 */
function toggleFlyout(): void {
  if (!mainWindow) {
    debugFlyout("toggleFlyout ignored: no mainWindow");
    return;
  }
  const now = Date.now();
  if (now - lastToggleAt < 500) {
    debugFlyout("toggleFlyout ignored: debounce");
    return;
  }
  lastToggleAt = now;
  debugFlyout(`toggleFlyout visible=${mainWindow.isVisible()}`);
  if (mainWindow.isVisible()) {
    hideFlyout("toggle");
  } else {
    showFlyout();
  }
}

function applyRuntimeServiceSettings(previousSettings: UiSettings | null = null): void {
  if (backend) {
    backend.configureRuntime({
      sonarEnabled: isServiceEnabled("sonarApiEnabled"),
      hidEventsEnabled: isServiceEnabled("hidEventsEnabled"),
      sonarPollIntervalMs: sanitizeSonarPollIntervalMs(),
    });
    if (isServiceEnabled("sonarApiEnabled") || isServiceEnabled("hidEventsEnabled")) {
      backend.start();
      if (isServiceEnabled("sonarApiEnabled")) {
        void backend.refreshNow();
      }
    } else {
      backend.stop();
    }
  }

  if (ddcService) {
    if (isServiceEnabled("ddcEnabled")) {
      ddcService.start();
      restartDdcMonitorRefresh(true);
      void warmupDdcCache();
    } else {
      stopDdcMonitorRefresh();
      ddcService.stop();
      ddcLastStatus = "unknown";
      ddcLastFailure = "";
    }
  }

  baseStationOledService.updateState(cachedState);
  baseStationOledService.configure({
    enabled: isServiceEnabled("oledDisplayEnabled"),
    refreshIntervalMs: settings.baseStationOled.refreshIntervalMs,
    showHeadsetVolume: settings.baseStationOled.showHeadsetVolume,
    showMicMuteStatus: settings.baseStationOled.showMicMuteStatus,
    showAncMode: settings.baseStationOled.showAncMode,
    showBatteryInfo: settings.baseStationOled.showBatteryInfo,
    showChatMix: settings.baseStationOled.showChatMix,
    showCustomNotifications: settings.baseStationOled.showCustomNotifications,
    customNotificationDurationMs: Math.max(2, settings.notificationTimeout) * 1000,
  });
  if (isServiceEnabled("oledDisplayEnabled")) {
    if (!baseStationOledService.isRunning()) {
      baseStationOledService.start();
    }
  } else if (baseStationOledService.isRunning()) {
    baseStationOledService.stop();
  }

  if (isServiceEnabled("automaticPresetSwitcherEnabled")) {
    presetSwitcherService.start();
  } else {
    presetSwitcherService.stop();
  }

  if (isServiceEnabled("shortcutsEnabled")) {
    registerConfiguredShortcuts();
  } else {
    shortcutService.unregisterAll();
  }

  if (!isServiceEnabled("notificationsEnabled")) {
    notificationWindowService.closeAll();
    closeWindowIfOpen(headsetVolumeNotificationWindow);
    closeWindowIfOpen(micMuteNotificationWindow);
    closeWindowIfOpen(oledNotificationWindow);
    closeWindowIfOpen(sidetoneNotificationWindow);
    closeWindowIfOpen(presetChangeNotificationWindow);
    closeWindowIfOpen(usbInputNotificationWindow);
    closeWindowIfOpen(ancModeNotificationWindow);
    closeWindowIfOpen(connectivityNotificationWindow);
    closeWindowIfOpen(batteryLowNotificationWindow);
    closeWindowIfOpen(baseBatteryStatusNotificationWindow);
    closeWindowIfOpen(headsetBatterySwapNotificationWindow);
    clearNotificationTimers();
    resetNotificationTransientState();
  }

  if (!previousSettings) {
    pushServiceLog(
      "sonarApi",
      isServiceEnabled("sonarApiEnabled")
        ? `started (poll: ${Math.round(sanitizeSonarPollIntervalMs() / 100) / 10}s).`
        : "stopped.",
    );
    pushServiceLog("hidEvents", isServiceEnabled("hidEventsEnabled") ? "started." : "stopped.");
    pushServiceLog("ddcApi", isServiceEnabled("ddcEnabled") ? "started." : "stopped.");
    pushServiceLog("oledDisplay", isServiceEnabled("oledDisplayEnabled") ? "started." : "stopped.");
    pushServiceLog("notifications", isServiceEnabled("notificationsEnabled") ? "started." : "stopped.");
    pushServiceLog(
      "presetSwitcher",
      isServiceEnabled("automaticPresetSwitcherEnabled") ? "started." : "stopped.",
    );
    pushServiceLog("shortcuts", isServiceEnabled("shortcutsEnabled") ? "started." : "stopped.");
    return;
  }

  const prev = previousSettings.services;
  const next = settings.services;
  if (prev.sonarApiEnabled !== next.sonarApiEnabled || prev.sonarPollIntervalMs !== next.sonarPollIntervalMs) {
    const status = next.sonarApiEnabled ? "started" : "stopped";
    const period = `${Math.round(sanitizeSonarPollIntervalMs() / 100) / 10}s`;
    pushServiceLog("sonarApi", `${status} (poll: ${period}).`);
  }
  if (prev.hidEventsEnabled !== next.hidEventsEnabled) {
    pushServiceLog("hidEvents", next.hidEventsEnabled ? "started." : "stopped.");
  }
  if (prev.ddcEnabled !== next.ddcEnabled) {
    pushServiceLog("ddcApi", next.ddcEnabled ? "started." : "stopped.");
  }
  if (prev.oledDisplayEnabled !== next.oledDisplayEnabled) {
    pushServiceLog("oledDisplay", next.oledDisplayEnabled ? "started." : "stopped.");
  }
  if (
    previousSettings.baseStationOled.refreshIntervalMs !== settings.baseStationOled.refreshIntervalMs ||
    previousSettings.baseStationOled.showHeadsetVolume !== settings.baseStationOled.showHeadsetVolume ||
    previousSettings.baseStationOled.showMicMuteStatus !== settings.baseStationOled.showMicMuteStatus ||
    previousSettings.baseStationOled.showAncMode !== settings.baseStationOled.showAncMode ||
    previousSettings.baseStationOled.showBatteryInfo !== settings.baseStationOled.showBatteryInfo ||
    previousSettings.baseStationOled.showChatMix !== settings.baseStationOled.showChatMix ||
    previousSettings.baseStationOled.showCustomNotifications !== settings.baseStationOled.showCustomNotifications
  ) {
    pushServiceLog(
      "oledDisplay",
      `Config updated (interval=${Math.round(settings.baseStationOled.refreshIntervalMs / 1000)}s).`,
    );
  }
  if (prev.notificationsEnabled !== next.notificationsEnabled) {
    pushServiceLog("notifications", next.notificationsEnabled ? "started." : "stopped.");
  }
  if (prev.automaticPresetSwitcherEnabled !== next.automaticPresetSwitcherEnabled) {
    pushServiceLog("presetSwitcher", next.automaticPresetSwitcherEnabled ? "started." : "stopped.");
  }
  if (prev.shortcutsEnabled !== next.shortcutsEnabled) {
    pushServiceLog("shortcuts", next.shortcutsEnabled ? "started." : "stopped.");
  }
}

/**
 * Loads persisted settings and applies state-level normalization.
 */
function loadSettings(): void {
  loadPersistedSnapshot();
  cachedState = applyUsbInputInference(cachedState);
}

/**
 * Persists new settings and returns the sanitized merged version.
 */
function persistSettings(next: UiSettings): UiSettings {
  settings = mergeSettings(next);
  schedulePersist();
  return settings;
}

function harmonizeLiveState(previous: AppState, incoming: AppState): AppState {
  const next = mergeState(incoming);
  const keep = <T>(newValue: T | null | undefined, oldValue: T | null): T | null =>
    newValue === null || newValue === undefined ? oldValue : newValue;
  return {
    ...previous,
    ...next,
    headset_battery_percent: keep(next.headset_battery_percent, previous.headset_battery_percent),
    base_battery_percent: keep(next.base_battery_percent, previous.base_battery_percent),
    base_station_connected: keep(next.base_station_connected, previous.base_station_connected),
    current_usb_input: keep(next.current_usb_input, previous.current_usb_input),
    headset_volume_percent: keep(next.headset_volume_percent, previous.headset_volume_percent),
    anc_mode: keep(next.anc_mode, previous.anc_mode),
    mic_mute: keep(next.mic_mute, previous.mic_mute),
    sidetone_level: keep(next.sidetone_level, previous.sidetone_level),
    connected: keep(next.connected, previous.connected),
    wireless: keep(next.wireless, previous.wireless),
    bluetooth: keep(next.bluetooth, previous.bluetooth),
    chat_mix_balance: keep(next.chat_mix_balance, previous.chat_mix_balance),
    oled_brightness: keep(next.oled_brightness, previous.oled_brightness),
    updated_at: keep(next.updated_at, previous.updated_at),
    channel_volume: { ...previous.channel_volume, ...next.channel_volume },
    channel_mute: { ...previous.channel_mute, ...next.channel_mute },
    channel_preset: { ...previous.channel_preset, ...next.channel_preset },
    channel_apps: { ...previous.channel_apps, ...next.channel_apps },
  };
}

/**
 * Returns all currently alive application windows (dashboard, settings, notifications).
 */
function allWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = [];
  for (const win of [mainWindow, settingsWindow, ...notificationWindowService.getWindows()]) {
    if (win && !win.isDestroyed()) {
      wins.push(win);
    }
  }
  return wins;
}

function applyFlyoutSizeFromSettings(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const limits = resolveFlyoutFitLimits();
  const width = clampNumber(Number(settings.flyoutWidth) || 760, FLYOUT_MIN_WIDTH, limits.maxWidth);
  const height = clampNumber(Number(settings.flyoutHeight) || 520, FLYOUT_MIN_HEIGHT, limits.maxHeight);
  const [currentWidth, currentHeight] = mainWindow.getContentSize();
  if (currentWidth !== width || currentHeight !== height) {
    mainWindow.setContentSize(width, height, false);
  }
}

function fitFlyoutToContent(width: number, _height: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const limits = resolveFlyoutFitLimits();
  const nextWidth = clampNumber(Math.round(width), FLYOUT_MIN_WIDTH, limits.maxWidth);
  // Keep flyout height fixed to configured value; content-fit only adjusts width.
  const nextHeight = clampNumber(Number(settings.flyoutHeight) || 520, FLYOUT_MIN_HEIGHT, limits.maxHeight);
  const [currentWidth, currentHeight] = mainWindow.getContentSize();
  if (currentWidth === nextWidth && currentHeight === nextHeight) {
    return;
  }
  mainWindow.setContentSize(nextWidth, nextHeight, false);
  positionBottomRight(mainWindow, resolveUiDisplay());
  if (settings.flyoutWidth !== nextWidth) {
    settings = mergeSettings({
      ...settings,
      flyoutWidth: nextWidth,
    });
    schedulePersist();
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function broadcastStateUpdate(): void {
  for (const win of allWindows()) {
    win.webContents.send(IPC_EVENT.BACKEND_STATE, cachedState);
  }
}

function resolveShortcutChannel(binding: ShortcutBinding): ChannelKey {
  const channel = binding.channel;
  if (channel && CHANNELS.includes(channel)) {
    return channel;
  }
  return "master";
}

function resolveShortcutMonitorId(binding: ShortcutBinding): number | null {
  if (Number.isFinite(binding.monitorId) && Number(binding.monitorId) > 0) {
    return Number(binding.monitorId);
  }
  if (ddcMonitorsCache.length > 0) {
    return ddcMonitorsCache[0].monitor_id;
  }
  if (!ddcService) {
    return null;
  }
  try {
    const monitors = ddcService.listMonitors();
    if (monitors.length === 0) {
      return null;
    }
    ddcMonitorsCache = [...monitors].sort((a, b) => a.monitor_id - b.monitor_id);
    ddcMonitorsCacheTs = Date.now();
    broadcastDdcUpdate();
    return ddcMonitorsCache[0].monitor_id;
  } catch {
    return null;
  }
}

function patchDdcMonitorCache(monitor: DdcMonitor): void {
  ddcMonitorsCache = [...ddcMonitorsCache.filter((item) => item.monitor_id !== monitor.monitor_id), monitor].sort((a, b) => a.monitor_id - b.monitor_id);
  ddcMonitorsCacheTs = Date.now();
  broadcastDdcUpdate();
}

function executeShortcutBinding(binding: ShortcutBinding): void {
  const action = binding.action;
  if (action === "sonar_volume_up" || action === "sonar_volume_down") {
    if (!isServiceEnabled("sonarApiEnabled")) {
      pushServiceLog("shortcuts", `Ignored (${binding.accelerator}): Sonar service disabled.`);
      return;
    }
    const channel = resolveShortcutChannel(binding);
    const step = Math.max(1, Math.min(50, Number(binding.step) || 5));
    const delta = action === "sonar_volume_up" ? step : -step;
    const current = clampPercent(Number(cachedState.channel_volume?.[channel] ?? 0));
    const next = clampPercent(current + delta);
    backend?.send({
      name: "set_channel_volume",
      payload: { channel, value: next },
    });
    cachedState = mergeState({
      ...cachedState,
      channel_volume: { ...cachedState.channel_volume, [channel]: next },
    });
    schedulePersist();
    broadcastStateUpdate();
    return;
  }
  if (action === "sonar_mute_toggle" || action === "sonar_mute_on" || action === "sonar_mute_off") {
    if (!isServiceEnabled("sonarApiEnabled")) {
      pushServiceLog("shortcuts", `Ignored (${binding.accelerator}): Sonar service disabled.`);
      return;
    }
    const channel = resolveShortcutChannel(binding);
    const current = Boolean(cachedState.channel_mute?.[channel]);
    const nextMuted = action === "sonar_mute_toggle" ? !current : action === "sonar_mute_on";
    backend?.send({
      name: "set_channel_mute",
      payload: { channel, value: nextMuted },
    });
    cachedState = mergeState({
      ...cachedState,
      channel_mute: { ...cachedState.channel_mute, [channel]: nextMuted },
    });
    schedulePersist();
    broadcastStateUpdate();
    return;
  }
  if (action === "sonar_set_preset") {
    if (!isServiceEnabled("sonarApiEnabled")) {
      pushServiceLog("shortcuts", `Ignored (${binding.accelerator}): Sonar service disabled.`);
      return;
    }
    const channel = resolveShortcutChannel(binding);
    const presetId = String(binding.presetId ?? "").trim();
    if (!presetId) {
      pushServiceLog("shortcuts", `Ignored (${binding.accelerator}): missing preset.`);
      return;
    }
    backend?.send({
      name: "set_preset",
      payload: { channel, preset_id: presetId },
    });
    cachedState = mergeState({
      ...cachedState,
      channel_preset: { ...cachedState.channel_preset, [channel]: presetId },
    });
    if (isNotifEnabled("presetChange")) {
      void showPresetChangeNotification(channel, getPresetDisplayName(channel, presetId));
    }
    schedulePersist();
    broadcastStateUpdate();
    return;
  }
  if (action === "ddc_brightness_up" || action === "ddc_brightness_down" || action === "ddc_brightness_set") {
    if (!isServiceEnabled("ddcEnabled") || !ddcService) {
      pushServiceLog("shortcuts", "Ignored: DDC service unavailable.");
      return;
    }
    const monitorId = resolveShortcutMonitorId(binding);
    if (!monitorId) {
      pushServiceLog("shortcuts", "Ignored: no DDC monitor available.");
      return;
    }
    const current = ddcMonitorsCache.find((item) => item.monitor_id === monitorId)?.brightness;
    const step = Math.max(1, Math.min(50, Number(binding.step) || 5));
    const next =
      action === "ddc_brightness_set"
        ? clampPercent(Number(binding.brightness))
        : clampPercent((Number.isFinite(current) ? Number(current) : 50) + (action === "ddc_brightness_up" ? step : -step));
    try {
      const monitor = ddcService.setBrightness(monitorId, next) as DdcMonitor;
      patchDdcMonitorCache(monitor);
      pushServiceLog("shortcuts", `Monitor ${monitorId} brightness ${next}%.`);
    } catch (err) {
      pushServiceLog("shortcuts", `ERROR: Brightness failed for monitor ${monitorId}: ${normalizeError(err)}`);
    }
    return;
  }
  if (action === "ddc_input_set") {
    if (!isServiceEnabled("ddcEnabled") || !ddcService) {
      pushServiceLog("shortcuts", "Ignored: DDC service unavailable.");
      return;
    }
    const monitorId = resolveShortcutMonitorId(binding);
    const inputSource = String(binding.inputSource ?? "").trim();
    if (!monitorId || !inputSource) {
      pushServiceLog("shortcuts", `Ignored (${binding.accelerator}): missing monitor or input source.`);
      return;
    }
    try {
      const monitor = ddcService.setInputSource(monitorId, inputSource) as DdcMonitor;
      patchDdcMonitorCache(monitor);
      pushServiceLog("shortcuts", `Monitor ${monitorId} input ${inputSource}.`);
    } catch (err) {
      pushServiceLog("shortcuts", `ERROR: Input change failed for monitor ${monitorId}: ${normalizeError(err)}`);
    }
  }
}

function getMixerApps(): MixerApp[] {
  const controls = new Map<string, string>([
    ["__device_volume__", "Device Volume"],
    ["__main_system__", "Main System Volume"],
    ["__system_sounds__", "System Sounds"],
  ]);

  const appNames = new Set<string>();
  for (const list of Object.values(cachedState.channel_apps ?? {})) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const app of list) {
      const trimmed = String(app || "").trim();
      if (trimmed) {
        appNames.add(trimmed);
      }
    }
  }
  for (const app of appNames) {
    controls.set(app, app);
  }
  for (const app of Object.keys(mixerAppVolume)) {
    const trimmed = String(app || "").trim();
    if (trimmed) {
      controls.set(trimmed, trimmed);
    }
  }
  for (const app of Object.keys(mixerAppMuted)) {
    const trimmed = String(app || "").trim();
    if (trimmed) {
      controls.set(trimmed, trimmed);
    }
  }

  return Array.from(controls.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => ({
      id,
      name,
      volume: clampPercent(mixerAppVolume[id] ?? 100),
      muted: Boolean(mixerAppMuted[id]),
    }));
}

async function getMixerOutputs(): Promise<MixerOutput[]> {
  if (process.platform !== "win32") {
    return [{ id: "default", name: "System Default Output" }];
  }
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_SoundDevice | Select-Object -ExpandProperty Name",
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve([{ id: "default", name: "System Default Output" }]);
          return;
        }
        const names = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const unique = Array.from(new Set(names));
        const outputs = unique.map((name) => ({ id: name, name }));
        resolve(outputs.length ? outputs : [{ id: "default", name: "System Default Output" }]);
      },
    );
  });
}

function wireBackend(): void {
  if (!backend) {
    return;
  }
  backend.on("hid-status", (text: string) => {
    pushServiceLog("hidEvents", text);
  });
  backend.on("state", (state: AppState) => {
    const previous = cachedState;
    cachedState = applyUsbInputInference(harmonizeLiveState(cachedState, state));
    baseStationOledService.updateState(cachedState);
    if (hasSeenLiveState) {
      notifyStateChanges(previous, cachedState);
    } else {
      hasSeenLiveState = true;
    }
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send(IPC_EVENT.BACKEND_STATE, cachedState);
    }
  });
  backend.on("presets", (presets: PresetMap) => {
    cachedPresets = presets;
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send(IPC_EVENT.BACKEND_PRESETS, presets);
    }
  });
  backend.on("status", (text: string) => {
    lastStatusText = text;
    lastErrorText = null;
    pushServiceLog("sonarApi", text);
    if (isNotifEnabled("appInfo")) {
      const lower = text.toLowerCase();
      if (lower.includes("starting backend") || lower.includes("backend exited") || lower.includes("ready")) {
        showSystemNotification("Control Centre", text);
      }
    }
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send(IPC_EVENT.BACKEND_STATUS, text);
    }
  });
  backend.on("error", (text: string) => {
    lastErrorText = text;
    lastStatusText = text;
    pushServiceLog("sonarApi", `ERROR: ${text}`);
    if (isNotifEnabled("appInfo")) {
      showSystemNotification("Control Centre Error", text);
    }
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send(IPC_EVENT.BACKEND_ERROR, text);
    }
  });
}

function closeWindowIfOpen(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    win.close();
  }
}

function syncHeadsetVolumeNotificationFromSettings(next: UiSettings, state: AppState): void {
  if (
    next.notifications.headsetVolume === false ||
    !headsetVolumeNotificationWindow ||
    headsetVolumeNotificationWindow.isDestroyed()
  ) {
    return;
  }
  const showChatMix = next.notifications.headsetChatMix !== false;
  const layout = resolveHeadsetVolumeOsdLayout(showChatMix);
  headsetVolumeOsdLayout = layout;
  applyHeadsetVolumeOsdLayout(headsetVolumeNotificationWindow, layout);
  updateHeadsetVolumeNotificationUi(
    headsetVolumeNotificationWindow,
    headsetVolumePendingValue ?? toNullablePercent(state.headset_volume_percent),
    headsetChatMixPendingValue ?? toNullablePercent(state.chat_mix_balance),
    showChatMix,
  );
}

/**
 * Resolves the DDC IPC handler factory from the compiled module.
 * This prevents startup crashes if the dev watcher momentarily serves a mixed CJS/ESM export shape.
 */
function resolveCreateDdcIpcHandlers(): (deps: CreateDdcIpcHandlersDeps) => DdcIpcHandlers {
  const maybeModule = ddcHandlersModule as unknown as {
    createDdcIpcHandlers?: unknown;
    default?: unknown;
  };

  if (typeof maybeModule.createDdcIpcHandlers === "function") {
    return maybeModule.createDdcIpcHandlers as (deps: CreateDdcIpcHandlersDeps) => DdcIpcHandlers;
  }

  if (typeof maybeModule.default === "function") {
    return maybeModule.default as (deps: CreateDdcIpcHandlersDeps) => DdcIpcHandlers;
  }

  if (
    maybeModule.default &&
    typeof maybeModule.default === "object" &&
    typeof (maybeModule.default as { createDdcIpcHandlers?: unknown }).createDdcIpcHandlers === "function"
  ) {
    return (maybeModule.default as { createDdcIpcHandlers: (deps: CreateDdcIpcHandlersDeps) => DdcIpcHandlers })
      .createDdcIpcHandlers;
  }

  const keys = Object.keys(maybeModule).join(", ") || "none";
  throw new Error(`Invalid ddcHandlers export shape. Expected createDdcIpcHandlers function, found keys: ${keys}`);
}

function wireIpc(): void {
  if (!backend) {
    return;
  }

  const setSettingsHandler = createSettingsIpcHandler({
    getSettings: () => settings,
    persistSettings: (next) => persistSettings(next),
    applyRuntimeServiceSettings: (previous, _next) => applyRuntimeServiceSettings(previous),
    setPresetRules: (rules) => presetSwitcherService.setRules(rules),
    restartDdcMonitorRefresh: () => restartDdcMonitorRefresh(),
    onFlyoutSettingsChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        applyFlyoutSizeFromSettings();
        positionBottomRight(mainWindow, resolveUiDisplay());
      }
    },
    getNotificationWindows: () => ({
      headsetVolume: headsetVolumeNotificationWindow,
      micMute: micMuteNotificationWindow,
      oled: oledNotificationWindow,
      sidetone: sidetoneNotificationWindow,
      presetChange: presetChangeNotificationWindow,
      usbInput: usbInputNotificationWindow,
      ancMode: ancModeNotificationWindow,
      connectivity: connectivityNotificationWindow,
      batteryLow: batteryLowNotificationWindow,
      baseBatteryStatus: baseBatteryStatusNotificationWindow,
      headsetBatterySwap: headsetBatterySwapNotificationWindow,
    }),
    closeWindowIfOpen,
    syncHeadsetVolumeNotification: syncHeadsetVolumeNotificationFromSettings,
    clearHeadsetBatterySwapDelayTimer: () => clearHeadsetBatterySwapDelayTimer(),
    resetBatterySwapTrack: () => resetBatterySwapTrack(),
    getCachedState: () => cachedState,
    setCachedState: (state) => {
      cachedState = state;
    },
    applyUsbInputInference: (state) => applyUsbInputInference(state),
    schedulePersist: () => schedulePersist(),
    broadcastState: (state) => {
      for (const win of allWindows()) {
        win.webContents.send(IPC_EVENT.BACKEND_STATE, state);
      }
    },
    broadcastSettings: (next) => {
      for (const win of allWindows()) {
        win.webContents.send(IPC_EVENT.SETTINGS_UPDATE, next);
      }
    },
  });

  const mixerHandlers = createMixerIpcHandlers({
    getMixerOutputs: () => getMixerOutputs(),
    getMixerApps: () => getMixerApps(),
    getSelectedOutputId: () => mixerOutputId,
    setSelectedOutputId: (outputId) => {
      mixerOutputId = outputId;
    },
    setAppVolume: (appId, volume) => {
      mixerAppVolume[appId] = volume;
    },
    setAppMuted: (appId, muted) => {
      mixerAppMuted[appId] = muted;
    },
    clampPercent: (value) => clampPercent(value),
    schedulePersist: () => schedulePersist(),
  });

  const ddcHandlers = resolveCreateDdcIpcHandlers()({
    fetchDdcMonitorsIfStale: (force) => fetchDdcMonitorsIfStale(force),
    getDdcService: () => ddcService,
    getMonitorsCache: () => ddcMonitorsCache,
    setMonitorsCache: (monitors) => {
      ddcMonitorsCache = monitors;
    },
    getMonitorsCacheTs: () => ddcMonitorsCacheTs,
    setMonitorsCacheTs: (timestamp) => {
      ddcMonitorsCacheTs = timestamp;
    },
    getLastStatus: () => ddcLastStatus,
    setLastStatus: (status) => {
      ddcLastStatus = status;
    },
    getLastFailure: () => ddcLastFailure,
    setLastFailure: (detail) => {
      ddcLastFailure = detail;
    },
    clampPercent: (value) => clampPercent(value),
    broadcastDdcUpdate: () => broadcastDdcUpdate(),
    pushLog: (text) => pushLog(text),
    normalizeError: (error) => normalizeError(error),
    debugDdc: (text) => debugDdc(text),
    ddcBaseUrl: () => ddcBaseUrl(),
  });

  const appHandlers = createAppIpcHandlers({
    toNullablePercent: (value) => toNullablePercent(value),
    isHeadsetVolumeNotificationEnabled: () => isNotifEnabled("headsetVolume"),
    showHeadsetVolumeNotification: (payload) => showHeadsetVolumeNotification(payload),
    fileExists: (filePath) => fs.existsSync(filePath),
    openPath: (filePath) => shell.openPath(filePath),
    openExternal: (url) => shell.openExternal(url, { activate: true }),
    normalizeError: (error) => normalizeError(error),
    showSystemNotification: (title, body) => showSystemNotification(title, body),
    showCustomNotificationOnOled: (title, body) => baseStationOledService.showCustomNotification(title, body),
    getBatteryLowTestPayload: () => {
      const threshold = clampPercent(settings.batteryLowThreshold);
      const level = toNullablePercent(cachedState.headset_battery_percent) ?? Math.max(0, threshold - 1);
      return { battery: level, threshold };
    },
    showBatteryLowNotification: (payload) => showBatteryLowNotification(payload),
    getBatterySwapTestPayload: () => {
      const level = toNullablePercent(cachedState.headset_battery_percent) ?? 74;
      return { headsetBattery: level };
    },
    showHeadsetBatterySwapNotification: (payload) => showHeadsetBatterySwapNotification(payload),
  });

  const windowHandlers = createWindowIpcHandlers({
    getMainWindow: () => mainWindow,
    hideFlyout: (reason) => hideFlyout(reason),
    fitFlyoutToContent: (width, height) => fitFlyoutToContent(width, height),
  });

  registerCoreIpcHandlers({
    ipcMain,
    getInitialPayload: async () => ({
      state: cachedState,
      presets: cachedPresets,
      settings,
      openApps: presetSwitcherService.getState().apps,
      theme: await getThemePayload(),
      status: lastStatusText,
      error: lastErrorText,
      logs: logBuffer,
      ddcMonitors: ddcMonitorsCache,
      ddcMonitorsUpdatedAt: ddcMonitorsCacheTs || null,
      baseStationOledFrame: baseStationOledService.getLastFrame(),
      flyoutPinned,
      serviceStatus: getServiceStatusPayload(),
    }),
    setFlyoutPinned: (pinned: boolean) => {
      flyoutPinned = Boolean(pinned);
      schedulePersist();
      return { ok: true, pinned: flyoutPinned };
    },
    getServiceStatus: () => getServiceStatusPayload(),
    sendBackendCommand: (command) => backend!.send(command),
    previewHeadsetVolume: appHandlers.previewHeadsetVolume,
    openSettingsWindow: () => {
      void showSettingsWindow();
    },
    closeCurrentWindow: windowHandlers.closeCurrentWindow,
    fitFlyoutToContent: windowHandlers.fitFlyoutToContent,
    setSettings: (partial) => setSettingsHandler(partial),
    openGg: appHandlers.openGg,
    notifyCustom: appHandlers.notifyCustom,
    notifyBatteryLowTest: appHandlers.notifyBatteryLowTest,
    notifyBatterySwapTest: appHandlers.notifyBatterySwapTest,
    getMixerData: mixerHandlers.getMixerData,
    setMixerOutput: mixerHandlers.setMixerOutput,
    setMixerAppVolume: mixerHandlers.setMixerAppVolume,
    setMixerAppMute: mixerHandlers.setMixerAppMute,
    getDdcMonitors: ddcHandlers.getDdcMonitors,
    setDdcBrightness: ddcHandlers.setDdcBrightness,
    setDdcInputSource: ddcHandlers.setDdcInputSource,
  });
}

async function loadWindowPage(win: BrowserWindow, page: "dashboard" | "settings"): Promise<void> {
  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(`${process.env.VITE_DEV_SERVER_URL}?window=${page}`);
  } else {
    await win.loadFile(path.join(app.getAppPath(), "dist", "index.html"), { query: { window: page } });
  }
}

async function createCenteredWindow(page: "settings", width: number, height: number, title: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width,
    height,
    minWidth: width,
    minHeight: height,
    show: false,
    paintWhenInitiallyHidden: true,
    center: true,
    frame: false,
    transparent: false,
    hasShadow: true,
    resizable: false,
    skipTaskbar: false,
    title,
    backgroundColor: "#1f1f1f",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await loadWindowPage(win, page);
  return win;
}

async function ensureSettingsWindow(): Promise<BrowserWindow> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return settingsWindow;
  }
  settingsWindow = await createCenteredWindow("settings", 1120, 860, "Control Centre - Settings");
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

async function showSettingsWindow(): Promise<void> {
  const win = await ensureSettingsWindow();
  if (win.isMinimized()) {
    win.restore();
  }
  win.center();
  if (!win.isVisible()) {
    win.show();
  }
  win.focus();
}

function registerConfiguredShortcuts(): void {
  if (!isServiceEnabled("shortcutsEnabled")) {
    shortcutService.unregisterAll();
    return;
  }
  const entries = [
    {
      id: "app-toggle-flyout",
      accelerator: String(settings.toggleShortcut ?? "").trim(),
      enabled: true,
      trigger: () => toggleFlyout(),
    },
    ...(settings.shortcuts ?? []).map((shortcut) => ({
      id: shortcut.id,
      accelerator: shortcut.accelerator,
      enabled: shortcut.enabled !== false,
      trigger: () => executeShortcutBinding(shortcut),
    })),
  ];
  const result = shortcutService.register(entries);
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      pushServiceLog("shortcuts", `ERROR: ${error}`);
      mainWindow?.webContents.send(IPC_EVENT.BACKEND_ERROR, error);
    }
    return;
  }
  pushServiceLog("shortcuts", `Registered bindings: ${result.registered}.`);
  mainWindow?.webContents.send(IPC_EVENT.BACKEND_STATUS, `Shortcuts registered: ${result.registered}`);
}

/**
 * Boots all app services and creates primary windows/tray.
 */
async function createApp(): Promise<void> {
  loadSettings();
  migrateLegacyState();
  backend = new ArctisApiService();
  ddcService = new DdcApiService();
  wireIpc();
  wireBackend();
  presetSwitcherService.setRules(settings.automaticPresetRules);
  applyRuntimeServiceSettings(null);

  mainWindow = createFlyoutWindow(settings);
  mainWindow.on("close", (evt) => {
    if (isQuitting) {
      return;
    }
    // Keep backend/tray running; closing the UI hides it to tray.
    evt.preventDefault();
    hideFlyout("window-close");
    debugFlyout("mainWindow close intercepted (hidden-to-tray)");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await loadWindowPage(mainWindow, "dashboard");
  mainWindowLoaded = true;
  applyFlyoutSizeFromSettings();
  positionBottomRight(mainWindow, resolveUiDisplay());
  if (pendingFlyoutOpen) {
    pendingFlyoutOpen = false;
    showFlyout();
  }
  mainWindow.on("focus", () => {
    debugFlyout("mainWindow focus event");
  });
  mainWindow.on("blur", () => {
    debugFlyout("mainWindow blur event");
    // Never auto-close when the window is pinned.
    if (flyoutPinned) return;
    // Small delay so focus has time to settle before we read getFocusedWindow().
    // This handles cases where blur fires just before another of our own windows
    // (settings, a notification) takes focus — we must not close in that scenario.
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
      // A deliberate hide was already issued (e.g. toggle, escape) — skip.
      if (Date.now() < hideIntentUntil) return;
      // If focus moved to one of our own windows, keep the flyout open.
      const focused = BrowserWindow.getFocusedWindow();
      if (focused) return;
      hideFlyout("blur");
    }, 50);
  });
  mainWindow.webContents.on("before-input-event", (_evt, input) => {
    if (input.type !== "keyDown" || input.key !== "Escape" || input.isAutoRepeat) {
      return;
    }
    hideFlyout("escape-key");
  });
  mainWindow.on("hide", () => {
    const expected = Date.now() <= hideIntentUntil;
    debugFlyout(`mainWindow hide event expected=${expected} reason=${lastHideReason || "none"}`);
  });
  mainWindow.on("show", () => debugFlyout("mainWindow show event"));
  mainWindow.on("closed", () => debugFlyout("mainWindow closed event"));
  mainWindow.webContents.on("render-process-gone", (_evt, details) => {
    pushLog(`[ERROR][flyout] renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      void loadWindowPage(mainWindow, "dashboard");
      showFlyout();
    }
  });
  mainWindow.webContents.on("unresponsive", () => {
    pushLog("[ERROR][flyout] renderer became unresponsive");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });
  mainWindow.on("resized", () => {
    if (!mainWindow) {
      return;
    }
    persistSettings(saveWindowBounds(mainWindow, settings));
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  tray = createTray({
    onToggle: () => toggleFlyout(),
    onSettings: () => {
      void showSettingsWindow();
    },
    onQuit: () => app.quit(),
  });
  tray.setImage(buildTrayIcon());

  nativeTheme.on("updated", async () => {
    cachedAccentColor = null;
    tray?.setImage(buildTrayIcon());
    const payload = await getThemePayload();
    for (const win of allWindows()) {
      win.webContents.send(IPC_EVENT.THEME_UPDATE, payload);
    }
  });

  // Preload settings once so first open is instant and fully painted.
  void ensureSettingsWindow();
  if (isNotifEnabled("appInfo")) {
    showSystemNotification("Control Centre", "App started");
  }
}

/**
 * Clears all notification timers controlled by the main process.
 */
function clearNotificationTimers(): void {
  clearHeadsetVolumeNotificationTimer();
  clearMicMuteNotificationTimer();
  clearOledNotificationTimer();
  clearSidetoneNotificationTimer();
  clearPresetChangeNotificationTimer();
  clearUsbInputNotificationTimer();
  clearAncModeNotificationTimer();
  clearConnectivityNotificationTimer();
  clearBatteryLowNotificationTimer();
  clearBaseBatteryStatusNotificationTimer();
  clearHeadsetBatterySwapNotificationTimer();
  clearHeadsetBatterySwapDelayTimer();
}

/**
 * Resets transient notification payload/layout values that should not survive app shutdown.
 */
function resetNotificationTransientState(): void {
  headsetVolumePendingValue = null;
  headsetChatMixPendingValue = null;
  micMutePendingValue = null;
  oledPendingValue = null;
  sidetonePendingValue = null;
  oledOsdLayout = null;
  sidetoneOsdLayout = null;
  presetChangePendingValue = null;
  presetChangeOsdLayout = null;
  usbInputPendingValue = null;
  ancModePendingValue = null;
  connectivityPendingValue = null;
  batteryLowPendingValue = null;
  baseBatteryStatusPendingValue = null;
  headsetBatterySwapPendingValue = null;
  resetBatterySwapTrack();
}

/**
 * Destroys a BrowserWindow if it still exists and returns null for reassignment convenience.
 */
function destroyWindowRef(win: BrowserWindow | null): null {
  if (win && !win.isDestroyed()) {
    win.destroy();
  }
  return null;
}

/**
 * Destroys all OSD notification windows owned directly by this module.
 */
function destroyNotificationOsdWindows(): void {
  headsetVolumeNotificationWindow = destroyWindowRef(headsetVolumeNotificationWindow);
  micMuteNotificationWindow = destroyWindowRef(micMuteNotificationWindow);
  oledNotificationWindow = destroyWindowRef(oledNotificationWindow);
  sidetoneNotificationWindow = destroyWindowRef(sidetoneNotificationWindow);
  presetChangeNotificationWindow = destroyWindowRef(presetChangeNotificationWindow);
  usbInputNotificationWindow = destroyWindowRef(usbInputNotificationWindow);
  ancModeNotificationWindow = destroyWindowRef(ancModeNotificationWindow);
  connectivityNotificationWindow = destroyWindowRef(connectivityNotificationWindow);
  batteryLowNotificationWindow = destroyWindowRef(batteryLowNotificationWindow);
  baseBatteryStatusNotificationWindow = destroyWindowRef(baseBatteryStatusNotificationWindow);
  headsetBatterySwapNotificationWindow = destroyWindowRef(headsetBatterySwapNotificationWindow);
}

app
  .whenReady()
  .then(createApp)
  .catch((error: unknown) => {
    const detail = normalizeError(error);
    // Keep startup failures visible in both terminal logs and persisted app logs.
    console.error(`[startup] ${detail}`);
    pushLog(`ERROR: App startup failed: ${detail}`);
    app.exit(1);
  });
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  isQuitting = true;
  notificationWindowService.closeAll();
  stopDdcMonitorRefresh();
  presetSwitcherService.stop();
  baseStationOledService.stop();
  clearNotificationTimers();
  resetNotificationTransientState();
  destroyNotificationOsdWindows();
  persistenceService.flushPending(() => buildPersistedSnapshot());
  shortcutService.unregisterAll();
  void stopManagedDdcApi();
  backend?.stop();
});





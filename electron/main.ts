import { Notification, app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen as electronScreen, shell } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { ArctisApiService } from "./services/apis/arctis/service";
import { DdcApiService } from "./services/apis/ddc/service";
import { createFlyoutWindow, positionBottomRight, saveWindowBounds } from "./window";
import { buildTrayIcon, createTray } from "./tray";
import { DEFAULT_SETTINGS, mergeSettings, mergeState } from "../shared/settings.js";
import type { AppState, BackendCommand, ChannelKey, PresetMap, UiSettings } from "../shared/types";

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let notificationWindows: BrowserWindow[] = [];
let tray: Electron.Tray | null = null;
let settings: UiSettings = DEFAULT_SETTINGS;
let cachedState: AppState = mergeState();
let cachedPresets: PresetMap = {};
let backend: ArctisApiService | null = null;
let ddcService: DdcApiService | null = null;
let lastStatusText = "ready";
let lastErrorText: string | null = null;
let logBuffer: string[] = [];
let mixerOutputId: string | null = null;
let mixerAppVolume: Record<string, number> = {};
let mixerAppMuted: Record<string, boolean> = {};
let persistTimer: NodeJS.Timeout | null = null;
let mainWindowLoaded = false;
let pendingFlyoutOpen = false;
let isQuitting = false;
let isOpeningFlyout = false;
let flyoutOpeningSince = 0;
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


const APP_STATE_VERSION = 1;

if (!app.isPackaged) {
  const devSessionPath = path.join(os.tmpdir(), `arctis-centre-session-${process.pid}`);
  app.setPath("sessionData", devSessionPath);
}

interface PersistedAppState {
  version: number;
  state: AppState;
  presets: PresetMap;
  settings: UiSettings;
  statusText: string;
  errorText: string | null;
  logs: string[];
  mixerOutputId: string | null;
  mixerAppVolume: Record<string, number>;
  mixerAppMuted: Record<string, boolean>;
  ddcMonitorsCache: DdcMonitor[];
  ddcMonitorsCacheTs: number;
  flyoutPinned: boolean;
}

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

interface DdcMonitor {
  monitor_id: number;
  name: string;
  brightness: number | null;
  input_source: string | null;
  available_inputs: string[];
  contrast: number | null;
  power_mode: string | null;
  supports: string[];
}

interface ServiceStatusPayload {
  arctisApi: {
    state: "starting" | "running" | "error" | "stopped";
    detail: string;
  };
  ddcApi: {
    state: "starting" | "running" | "error" | "stopped";
    detail: string;
    endpoint: string;
    managed: boolean;
    pid: number | null;
  };
}

function getUserFile(name: string): string {
  return path.join(app.getPath("userData"), name);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
  fs.renameSync(tempPath, filePath);
}

function getPersistedStateFile(): string {
  return getUserFile("app-state.json");
}

function persistNow(): void {
  const snapshot: PersistedAppState = {
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
  writeJsonFile(getPersistedStateFile(), snapshot);
}

function schedulePersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, 80);
}

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
  const loaded = readJsonFile<PersistedAppState>(getPersistedStateFile(), fallback);
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

function broadcastDdcUpdate(): void {
  schedulePersist();
  for (const win of allWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("ddc:update", ddcMonitorsCache);
    }
  }
}

function pushLog(text: string): void {
  const line = `${new Date().toLocaleTimeString()}  ${text}`;
  logBuffer = [line, ...logBuffer].slice(0, 200);
  for (const win of allWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("app:log", line);
    }
  }
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

function getServiceStatusPayload(): ServiceStatusPayload {
  const ddcStatus = ddcService?.getStatus() ?? {
    state: "stopped",
    detail: "DDC service not started.",
    endpoint: "native-ddc",
    managed: true,
    pid: null,
  };
  let arctisState: ServiceStatusPayload["arctisApi"]["state"] = "starting";
  if (!backend) {
    arctisState = "stopped";
  } else if (lastErrorText) {
    arctisState = "error";
  } else if (hasSeenLiveState) {
    arctisState = "running";
  }
  const arctisDetail = lastErrorText || lastStatusText || (backend ? "Backend initialized." : "Backend not started.");

  let ddcState: ServiceStatusPayload["ddcApi"]["state"] = "starting";
  let ddcDetail = ddcStatus.detail;
  ddcState = ddcStatus.state;

  return {
    arctisApi: { state: arctisState, detail: arctisDetail },
    ddcApi: {
      state: ddcState,
      detail: ddcDetail,
      endpoint: ddcStatus.endpoint,
      managed: ddcStatus.managed,
      pid: ddcStatus.pid,
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
  ddcService?.start();
  if (ddcService?.isHealthy()) {
    pushLog("DDC native service ready.");
  } else {
    const detail = ddcService?.getStatus().detail ?? "DDC native service unavailable.";
    pushLog(`ERROR: ${detail}`);
  }
}

async function warmupDdcCache(): Promise<void> {
  await ensureDdcApiRunning();
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await fetchDdcMonitorsIfStale(true);
      ddcLastStatus = "ok";
      ddcLastFailure = "";
      pushLog("DDC startup refresh completed.");
      return;
    } catch (err) {
      const detail = normalizeError(err);
      ddcLastStatus = "error";
      ddcLastFailure = detail;
      if (attempt === 1 || attempt % 3 === 0 || attempt === maxAttempts) {
        pushLog(`DDC startup refresh retry ${attempt}/${maxAttempts}: ${detail}`);
      }
      await sleep(5000);
    }
  }
  pushLog("ERROR: DDC startup refresh failed after retries.");
}

async function stopManagedDdcApi(): Promise<void> {
  ddcService?.stop();
  await sleep(10);
}

function sanitizePollIntervalMs(): number {
  const raw = Number(settings.ddc?.pollIntervalMs ?? 300000);
  return Math.max(10000, Math.min(1_800_000, raw));
}

async function fetchDdcMonitorsIfStale(force = false): Promise<DdcMonitor[]> {
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
  return settings.notifications?.[key] !== false;
}

function showSystemNotification(title: string, body: string): void {
  if (!title.trim() && !body.trim()) {
    return;
  }
  void showNotificationWindow(title, body);
}

function toPercentLabel(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
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
      showSystemNotification("Control Centre", next.connected ? "Headset connected" : "Headset disconnected");
    }
  }
  if (isNotifEnabled("ancMode") && previous.anc_mode !== next.anc_mode && next.anc_mode != null) {
    showSystemNotification("Control Centre", `ANC mode: ${next.anc_mode}`);
  }
  if (isNotifEnabled("oled") && previous.oled_brightness !== next.oled_brightness && next.oled_brightness != null) {
    showSystemNotification("Control Centre", `OLED brightness: ${next.oled_brightness}`);
  }
  if (isNotifEnabled("sidetone") && previous.sidetone_level !== next.sidetone_level && next.sidetone_level != null) {
    showSystemNotification("Control Centre", `Sidetone: ${next.sidetone_level}`);
  }
  if (isNotifEnabled("micMute") && previous.mic_mute !== next.mic_mute && next.mic_mute != null) {
    showSystemNotification("Control Centre", `Mic ${next.mic_mute ? "muted" : "live"}`);
  }
  if (isNotifEnabled("chatMix") && previous.chat_mix_balance !== next.chat_mix_balance && next.chat_mix_balance != null) {
    showSystemNotification("Control Centre", `Chat mix: ${toPercentLabel(next.chat_mix_balance)}`);
  }
  if (isNotifEnabled("headsetVolume") && previous.headset_volume_percent !== next.headset_volume_percent && next.headset_volume_percent != null) {
    showSystemNotification("Control Centre", `Headset volume: ${toPercentLabel(next.headset_volume_percent)}`);
  }
  if (isNotifEnabled("battery")) {
    const prevHeadset = previous.headset_battery_percent;
    const nextHeadset = next.headset_battery_percent;
    if (prevHeadset != null && nextHeadset != null) {
      if (prevHeadset > 20 && nextHeadset <= 20) {
        showSystemNotification("Control Centre", `Headset battery low (${toPercentLabel(nextHeadset)})`);
      } else if (prevHeadset < 95 && nextHeadset >= 95) {
        showSystemNotification("Control Centre", `Headset battery charged (${toPercentLabel(nextHeadset)})`);
      }
    }
    const prevBase = previous.base_battery_percent;
    const nextBase = next.base_battery_percent;
    if (prevBase != null && nextBase != null) {
      if (prevBase > 20 && nextBase <= 20) {
        showSystemNotification("Control Centre", `Base battery low (${toPercentLabel(nextBase)})`);
      } else if (prevBase < 95 && nextBase >= 95) {
        showSystemNotification("Control Centre", `Base battery charged (${toPercentLabel(nextBase)})`);
      }
    }
  }
  if (isNotifEnabled("presetChange")) {
    const prevPreset = previous.channel_preset ?? {};
    const nextPreset = next.channel_preset ?? {};
    for (const [channel, nextValue] of Object.entries(nextPreset) as Array<[ChannelKey, string | null | undefined]>) {
      const prevValue = prevPreset[channel];
      if (nextValue !== prevValue && nextValue != null && String(nextValue).trim()) {
        showSystemNotification("Control Centre", `${channelDisplayName(channel)} preset: ${getPresetDisplayName(channel, String(nextValue))}`);
      }
    }
  }
}

function migrateLegacyState(): void {
  if (fs.existsSync(getPersistedStateFile())) {
    return;
  }
  const oldStateCache = getUserFile("state-cache.json");
  if (fs.existsSync(oldStateCache)) {
    cachedState = mergeState(readJsonFile<Partial<AppState>>(oldStateCache, {}));
  }
  const oldSettings = getUserFile("settings.json");
  if (fs.existsSync(oldSettings)) {
    settings = mergeSettings(readJsonFile<Partial<UiSettings>>(oldSettings, {}));
  }
  persistNow();
}

async function getWindowsAccentColor(): Promise<string> {
  if (process.platform !== "win32") {
    return "#6ab7ff";
  }
  return new Promise((resolve) => {
    execFile(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\DWM", "/v", "ColorizationColor"],
      { windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve("#6ab7ff");
          return;
        }
        const match = stdout.match(/0x([0-9A-Fa-f]{8})/);
        if (!match) {
          resolve("#6ab7ff");
          return;
        }
        const argb = match[1];
        const rrggbb = argb.slice(2);
        resolve(`#${rrggbb}`);
      },
    );
  });
}

async function getThemePayload(): Promise<{ isDark: boolean; accent: string }> {
  return {
    isDark: nativeTheme.shouldUseDarkColors,
    accent: await getWindowsAccentColor(),
  };
}

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
  if (mainWindow.isVisible() || isOpeningFlyout) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    debugFlyout(`showFlyout focus only: visible=${mainWindow.isVisible()} opening=${isOpeningFlyout}`);
    mainWindow.focus();
    return;
  }
  isOpeningFlyout = true;
  hideIntentUntil = 0;
  lastHideReason = "";
  flyoutOpeningSince = Date.now();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  debugFlyout("showFlyout completed");
  isOpeningFlyout = false;
  flyoutOpeningSince = 0;
}

function hideFlyout(reason = "unspecified"): void {
  if (!mainWindow) {
    debugFlyout("hideFlyout ignored: no mainWindow");
    return;
  }
  // Restrict hide triggers to explicit app-driven actions.
  const allowed = reason === "toggle" || reason === "ipc-close-current" || reason === "open-settings" || reason === "escape-key" || reason === "window-close";
  if (!allowed) {
    debugFlyout(`hideFlyout blocked reason=${reason}`);
    return;
  }
  hideIntentUntil = Date.now() + 1200;
  lastHideReason = reason;
  debugFlyout(`hideFlyout called reason=${reason}`);
  mainWindow.hide();
}

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
  if (isOpeningFlyout && flyoutOpeningSince > 0 && Date.now() - flyoutOpeningSince > 5000) {
    isOpeningFlyout = false;
    flyoutOpeningSince = 0;
  }
  if (isOpeningFlyout) {
    debugFlyout("toggleFlyout ignored: currently opening");
    return;
  }
  debugFlyout(`toggleFlyout visible=${mainWindow.isVisible()}`);
  if (mainWindow.isVisible()) {
    hideFlyout("toggle");
  } else {
    showFlyout();
  }
}

function loadSettings(): void {
  loadPersistedSnapshot();
}

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

function allWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = [];
  for (const win of [mainWindow, settingsWindow, ...notificationWindows]) {
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
  const width = Math.max(320, Math.min(1000, Number(settings.flyoutWidth) || 760));
  const height = Math.max(260, Math.min(1200, Number(settings.flyoutHeight) || 520));
  mainWindow.setContentSize(width, height, false);
}

function relayoutNotificationWindows(): void {
  const display = electronScreen.getPrimaryDisplay();
  const workArea = display.workArea;
  const margin = 12;
  let y = workArea.y + margin;
  for (const win of notificationWindows.filter((candidate) => !candidate.isDestroyed())) {
    const bounds = win.getBounds();
    const x = workArea.x + workArea.width - bounds.width - margin;
    win.setPosition(x, y, false);
    y += bounds.height + 10;
  }
  notificationWindows = notificationWindows.filter((candidate) => !candidate.isDestroyed());
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
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
  backend.on("state", (state: AppState) => {
    const previous = cachedState;
    cachedState = harmonizeLiveState(cachedState, state);
    if (hasSeenLiveState) {
      notifyStateChanges(previous, cachedState);
    } else {
      hasSeenLiveState = true;
    }
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send("backend:state", cachedState);
    }
  });
  backend.on("presets", (presets: PresetMap) => {
    cachedPresets = presets;
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send("backend:presets", presets);
    }
  });
  backend.on("status", (text: string) => {
    lastStatusText = text;
    lastErrorText = null;
    pushLog(text);
    if (isNotifEnabled("appInfo")) {
      const lower = text.toLowerCase();
      if (lower.includes("starting backend") || lower.includes("backend exited") || lower.includes("ready")) {
        showSystemNotification("Control Centre", text);
      }
    }
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send("backend:status", text);
    }
  });
  backend.on("error", (text: string) => {
    lastErrorText = text;
    lastStatusText = text;
    pushLog(`ERROR: ${text}`);
    if (isNotifEnabled("appInfo")) {
      showSystemNotification("Control Centre Error", text);
    }
    schedulePersist();
    for (const win of allWindows()) {
      win.webContents.send("backend:error", text);
    }
  });
  backend.start();
}

function wireIpc(): void {
  if (!backend) {
    return;
  }
  ipcMain.handle("app:get-initial", async () => {
    return {
      state: cachedState,
      presets: cachedPresets,
      settings,
      theme: await getThemePayload(),
      status: lastStatusText,
      error: lastErrorText,
      logs: logBuffer,
      ddcMonitors: ddcMonitorsCache,
      ddcMonitorsUpdatedAt: ddcMonitorsCacheTs || null,
      flyoutPinned,
      serviceStatus: getServiceStatusPayload(),
    };
  });
  ipcMain.handle("window:set-pinned", (_evt, pinned: boolean) => {
    flyoutPinned = Boolean(pinned);
    schedulePersist();
    return { ok: true, pinned: flyoutPinned };
  });
  ipcMain.handle("services:get-status", async () => getServiceStatusPayload());
  ipcMain.on("backend:command", (_evt, cmd: BackendCommand) => backend!.send(cmd));
  ipcMain.on("window:open-settings", () => {
    void showSettingsWindow();
  });
  ipcMain.on("window:close-current", (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (!win) {
      return;
    }
    if (win === mainWindow) {
      hideFlyout("ipc-close-current");
      return;
    }
    win.close();
  });
  ipcMain.handle("settings:set", (_evt, partial: Partial<UiSettings>) => {
    const next = persistSettings({
      ...settings,
      ...partial,
      notifications: {
        ...settings.notifications,
        ...(partial.notifications ?? {}),
      },
      ddc: {
        ...settings.ddc,
        ...(partial.ddc ?? {}),
        monitorPrefs: {
          ...settings.ddc.monitorPrefs,
          ...(partial.ddc?.monitorPrefs ?? {}),
        },
      },
    });
    registerToggleShortcut(next.toggleShortcut);
    if (mainWindow && !mainWindow.isDestroyed()) {
      applyFlyoutSizeFromSettings();
      positionBottomRight(mainWindow);
    }
    for (const win of allWindows()) {
      win.webContents.send("settings:update", next);
    }
    return next;
  });
  ipcMain.handle("app:open-gg", async () => {
    const candidates = [
      "C:\\Program Files\\SteelSeries\\GG\\SteelSeriesGGClient.exe",
      "C:\\Program Files\\SteelSeries\\GG\\SteelSeriesGG.exe",
      "C:\\Program Files (x86)\\SteelSeries\\GG\\SteelSeriesGG.exe",
    ];
    for (const exe of candidates) {
      if (fs.existsSync(exe)) {
        const result = await shell.openPath(exe);
        return { ok: result === "", detail: result || exe };
      }
    }
    const uriResult = await shell.openExternal("steelseriesgg://", { activate: true });
    return { ok: uriResult, detail: "steelseriesgg://" };
  });
  ipcMain.handle("app:notify-custom", async (_evt, payload: { title?: string; body?: string }) => {
    const title = String(payload?.title || "").trim() || "Control Centre";
    const body = String(payload?.body || "").trim() || "Notification";
    showSystemNotification(title, body);
    return { ok: true };
  });
  ipcMain.handle("mixer:get-data", async () => {
    const outputs = await getMixerOutputs();
    const selectedOutputId = mixerOutputId && outputs.some((o) => o.id === mixerOutputId) ? mixerOutputId : outputs[0]?.id ?? "default";
    if (selectedOutputId !== mixerOutputId) {
      mixerOutputId = selectedOutputId;
      schedulePersist();
    }
    return { outputs, selectedOutputId, apps: getMixerApps() };
  });
  ipcMain.handle("mixer:set-output", (_evt, outputId: string) => {
    mixerOutputId = String(outputId || "").trim() || null;
    schedulePersist();
    return { ok: true };
  });
  ipcMain.handle("mixer:set-app-volume", (_evt, payload: { appId: string; volume: number }) => {
    const appId = String(payload?.appId || "").trim();
    if (!appId) {
      return { ok: false };
    }
    mixerAppVolume[appId] = clampPercent(Number(payload.volume));
    schedulePersist();
    return { ok: true };
  });
  ipcMain.handle("mixer:set-app-mute", (_evt, payload: { appId: string; muted: boolean }) => {
    const appId = String(payload?.appId || "").trim();
    if (!appId) {
      return { ok: false };
    }
    mixerAppMuted[appId] = Boolean(payload.muted);
    schedulePersist();
    return { ok: true };
  });
  ipcMain.handle("ddc:get-monitors", async () => {
    debugDdc("ipc ddc:get-monitors begin");
    try {
      const monitors = await fetchDdcMonitorsIfStale(false);
      debugDdc(`ipc ddc:get-monitors ok count=${monitors.length}`);
      if (ddcLastStatus !== "ok") {
        pushLog(`DDC backend reachable (${ddcBaseUrl()}).`);
      }
      ddcLastStatus = "ok";
      ddcLastFailure = "";
      return { ok: true, monitors, updatedAt: ddcMonitorsCacheTs || null };
    } catch (err) {
      const detail = normalizeError(err);
      debugDdc(`ipc ddc:get-monitors error ${detail}`);
      if (ddcLastFailure !== detail || ddcLastStatus !== "error") {
        pushLog(`ERROR: DDC backend issue: ${detail}`);
      }
      ddcLastStatus = "error";
      ddcLastFailure = detail;
      return { ok: false, monitors: [], error: detail, updatedAt: ddcMonitorsCacheTs || null };
    }
  });
  ipcMain.handle("ddc:set-brightness", async (_evt, payload: { monitorId: number; value: number }) => {
    const monitorId = Number(payload?.monitorId);
    const value = clampPercent(Number(payload?.value));
    debugDdc(`ipc ddc:set-brightness begin monitor=${monitorId} value=${value}`);
    if (!Number.isFinite(monitorId) || monitorId < 1) {
      debugDdc("ipc ddc:set-brightness rejected invalid monitor id");
      return { ok: false, error: "Invalid monitor id." };
    }
    try {
      if (!ddcService) {
        throw new Error("DDC native service is not initialized.");
      }
      const monitor = ddcService.setBrightness(monitorId, value) as DdcMonitor;
      ddcMonitorsCache = [...ddcMonitorsCache.filter((item) => item.monitor_id !== monitorId), monitor].sort((a, b) => a.monitor_id - b.monitor_id);
      ddcMonitorsCacheTs = Date.now();
      broadcastDdcUpdate();
      pushLog(`DDC: monitor ${monitorId} brightness set to ${value}.`);
      debugDdc(`ipc ddc:set-brightness ok monitor=${monitorId}`);
      return { ok: true, monitor };
    } catch (err) {
      const detail = normalizeError(err);
      debugDdc(`ipc ddc:set-brightness error monitor=${monitorId} ${detail}`);
      pushLog(`ERROR: DDC set brightness failed for monitor ${monitorId}: ${detail}`);
      return { ok: false, error: detail };
    }
  });
  ipcMain.handle("ddc:set-input-source", async (_evt, payload: { monitorId: number; value: string }) => {
    const monitorId = Number(payload?.monitorId);
    const value = String(payload?.value ?? "").trim();
    debugDdc(`ipc ddc:set-input-source begin monitor=${monitorId} value=${value}`);
    if (!Number.isFinite(monitorId) || monitorId < 1 || !value) {
      debugDdc("ipc ddc:set-input-source rejected invalid payload");
      return { ok: false, error: "Invalid monitor id or input value." };
    }
    try {
      if (!ddcService) {
        throw new Error("DDC native service is not initialized.");
      }
      const monitor = ddcService.setInputSource(monitorId, value) as DdcMonitor;
      ddcMonitorsCache = [...ddcMonitorsCache.filter((item) => item.monitor_id !== monitorId), monitor].sort((a, b) => a.monitor_id - b.monitor_id);
      ddcMonitorsCacheTs = Date.now();
      broadcastDdcUpdate();
      pushLog(`DDC: monitor ${monitorId} input set to ${value}.`);
      debugDdc(`ipc ddc:set-input-source ok monitor=${monitorId}`);
      return { ok: true, monitor };
    } catch (err) {
      const detail = normalizeError(err);
      debugDdc(`ipc ddc:set-input-source error monitor=${monitorId} ${detail}`);
      pushLog(`ERROR: DDC set input failed for monitor ${monitorId}: ${detail}`);
      return { ok: false, error: detail };
    }
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
      preload: path.join(__dirname, "preload.js"),
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

async function showNotificationWindow(title: string, body: string): Promise<void> {
  const theme = await getThemePayload();
  const isDark = settings.themeMode === "system" ? theme.isDark : settings.themeMode === "dark";
  const accent = settings.accentColor.trim() || theme.accent;
  const shellBg = isDark ? "rgba(24,24,24,0.86)" : "rgba(248,248,248,0.92)";
  const textColor = isDark ? "#ffffff" : "#111111";
  const subText = isDark ? "rgba(255,255,255,0.78)" : "rgba(0,0,0,0.72)";
  const borderColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.28)";
  const cardBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.45)";
  const esc = (value: string) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  const html = `<!doctype html>
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
          color: ${textColor};
          padding: 0;
        }
        .shell {
          margin: 0;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          border-radius: 12px;
          background: ${shellBg};
          border: 1px solid ${borderColor};
          box-shadow: 0 10px 24px rgba(0,0,0,0.28), inset 0 0 0 0.5px ${borderColor};
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
          background: color-mix(in srgb, ${accent} 24%, transparent);
          color: ${accent};
          font-size: 14px;
          font-weight: 700;
          box-shadow: inset 0 0 0 1px color-mix(in srgb, ${accent} 46%, transparent);
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
          color: ${subText};
          white-space: pre-wrap;
          word-break: break-word;
        }
        .body-card {
          background: ${cardBg};
          border-radius: 8px;
          padding: 8px 9px;
        }
      </style>
    </head>
    <body>
      <div class="shell">
        <div class="mark">A</div>
        <div class="copy">
          <div class="title">${esc(title)}</div>
          <div class="body-card">
            <div class="body">${esc(body)}</div>
          </div>
        </div>
      </div>
    </body>
  </html>`;
  const win = new BrowserWindow({
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
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  notificationWindows.push(win);
  relayoutNotificationWindows();
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const showNotification = () => {
    if (win.isDestroyed()) {
      return;
    }
    relayoutNotificationWindows();
    win.show();
    win.setFocusable(false);
    win.setIgnoreMouseEvents(true);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.close();
      }
    }, Math.max(2, settings.notificationTimeout) * 1000);
  };
  win.once("ready-to-show", showNotification);
  win.webContents.once("did-finish-load", () => {
    if (!win.isVisible()) {
      showNotification();
    }
  });
  win.on("closed", () => {
    notificationWindows = notificationWindows.filter((candidate) => candidate !== win);
    relayoutNotificationWindows();
  });
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

function registerToggleShortcut(accelerator: string): void {
  globalShortcut.unregisterAll();
  if (!accelerator.trim()) {
    return;
  }
  try {
    const ok = globalShortcut.register(accelerator, () => toggleFlyout());
    if (!ok) {
      mainWindow?.webContents.send("backend:error", `Unable to register shortcut: ${accelerator}`);
      if (isNotifEnabled("appInfo")) {
        showSystemNotification("Control Centre Error", `Unable to register shortcut: ${accelerator}`);
      }
    } else {
      mainWindow?.webContents.send("backend:status", `Shortcut registered: ${accelerator}`);
      if (isNotifEnabled("appInfo")) {
        showSystemNotification("Control Centre", `Shortcut registered: ${accelerator}`);
      }
    }
  } catch (err) {
    mainWindow?.webContents.send("backend:error", `Invalid shortcut: ${accelerator} (${String(err)})`);
    if (isNotifEnabled("appInfo")) {
      showSystemNotification("Control Centre Error", `Invalid shortcut: ${accelerator}`);
    }
  }
}

async function createApp(): Promise<void> {
  loadSettings();
  migrateLegacyState();
  backend = new ArctisApiService();
  ddcService = new DdcApiService();
  ddcService.start();
  wireIpc();
  wireBackend();
  void backend.refreshNow();
  void warmupDdcCache();

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
  positionBottomRight(mainWindow);
  if (pendingFlyoutOpen) {
    pendingFlyoutOpen = false;
    showFlyout();
  }
  mainWindow.on("focus", () => {
    debugFlyout("mainWindow focus event");
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
    onToggle: () => showFlyout(),
    onSettings: () => {
      void showSettingsWindow();
    },
    onQuit: () => app.quit(),
  });
  tray.setImage(buildTrayIcon());

  nativeTheme.on("updated", async () => {
    tray?.setImage(buildTrayIcon());
    const payload = await getThemePayload();
    for (const win of allWindows()) {
      win.webContents.send("theme:update", payload);
    }
  });

  registerToggleShortcut(settings.toggleShortcut);
  // Preload settings once so first open is instant and fully painted.
  void ensureSettingsWindow();
  if (isNotifEnabled("appInfo")) {
    showSystemNotification("Control Centre", "App started");
  }
}

app.whenReady().then(createApp);
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  isQuitting = true;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistNow();
  globalShortcut.unregisterAll();
  void stopManagedDdcApi();
  backend?.stop();
});

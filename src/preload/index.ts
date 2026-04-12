import { contextBridge, ipcRenderer } from "electron";
import type {
  ArctisBridgeApi,
  EventChannel,
  EventPayload,
  InvokeArgs,
  InvokeChannel,
  InvokeResult,
} from "@shared/ipc";

// Keep preload runtime self-contained because sandboxed preload cannot require
// arbitrary local modules at runtime.
const IPC_INVOKE = {
  APP_GET_INITIAL: "app:get-initial",
  SERVICES_GET_STATUS: "services:get-status",
  APP_OPEN_GG: "app:open-gg",
  APP_NOTIFY_CUSTOM: "app:notify-custom",
  APP_NOTIFY_BATTERY_LOW_TEST: "app:notify-battery-low-test",
  APP_NOTIFY_BATTERY_SWAP_TEST: "app:notify-battery-swap-test",
  MIXER_GET_DATA: "mixer:get-data",
  MIXER_SET_OUTPUT: "mixer:set-output",
  MIXER_SET_APP_VOLUME: "mixer:set-app-volume",
  MIXER_SET_APP_MUTE: "mixer:set-app-mute",
  DDC_GET_MONITORS: "ddc:get-monitors",
  DDC_SET_BRIGHTNESS: "ddc:set-brightness",
  DDC_SET_INPUT_SOURCE: "ddc:set-input-source",
  WINDOW_SET_PINNED: "window:set-pinned",
  SETTINGS_SET: "settings:set",
} as const;

const IPC_SEND = {
  BACKEND_COMMAND: "backend:command",
  NOTIFICATION_HEADSET_VOLUME_PREVIEW: "notification:headset-volume-preview",
  WINDOW_OPEN_SETTINGS: "window:open-settings",
  WINDOW_CLOSE_CURRENT: "window:close-current",
  WINDOW_FIT_CONTENT: "window:fit-content",
} as const;

const IPC_EVENT = {
  BACKEND_STATE: "backend:state",
  BACKEND_PRESETS: "backend:presets",
  BACKEND_STATUS: "backend:status",
  BACKEND_ERROR: "backend:error",
  THEME_UPDATE: "theme:update",
  SETTINGS_UPDATE: "settings:update",
  APP_LOG: "app:log",
  DDC_UPDATE: "ddc:update",
  OPEN_APPS_UPDATE: "open-apps:update",
  OLED_SERVICE_FRAME: "oled-service:frame",
} as const;

function invoke<C extends InvokeChannel>(channel: C, ...params: InvokeArgs<C>): Promise<InvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...params) as Promise<InvokeResult<C>>;
}

function subscribe<C extends EventChannel>(channel: C, cb: (payload: EventPayload<C>) => void): () => void {
  const fn = (_: unknown, payload: EventPayload<C>) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: ArctisBridgeApi = {
  invoke,
  getInitial: () => invoke(IPC_INVOKE.APP_GET_INITIAL),
  getServiceStatus: () => invoke(IPC_INVOKE.SERVICES_GET_STATUS),
  openGG: () => invoke(IPC_INVOKE.APP_OPEN_GG),
  notifyCustom: (title, body) => invoke(IPC_INVOKE.APP_NOTIFY_CUSTOM, { title, body }),
  notifyBatteryLowTest: () => invoke(IPC_INVOKE.APP_NOTIFY_BATTERY_LOW_TEST),
  notifyBatterySwapTest: () => invoke(IPC_INVOKE.APP_NOTIFY_BATTERY_SWAP_TEST),
  notifyHeadsetVolumePreview: (value) => ipcRenderer.send(IPC_SEND.NOTIFICATION_HEADSET_VOLUME_PREVIEW, value),
  getMixerData: () => invoke(IPC_INVOKE.MIXER_GET_DATA),
  setMixerOutput: (outputId) => invoke(IPC_INVOKE.MIXER_SET_OUTPUT, outputId),
  setMixerAppVolume: (appId, volume) => invoke(IPC_INVOKE.MIXER_SET_APP_VOLUME, { appId, volume }),
  setMixerAppMute: (appId, muted) => invoke(IPC_INVOKE.MIXER_SET_APP_MUTE, { appId, muted }),
  getDdcMonitors: () => invoke(IPC_INVOKE.DDC_GET_MONITORS),
  setDdcBrightness: (monitorId, value) => invoke(IPC_INVOKE.DDC_SET_BRIGHTNESS, { monitorId, value }),
  setDdcInputSource: (monitorId, value) => invoke(IPC_INVOKE.DDC_SET_INPUT_SOURCE, { monitorId, value }),
  sendCommand: (cmd) => ipcRenderer.send(IPC_SEND.BACKEND_COMMAND, cmd),
  closeCurrentWindow: () => ipcRenderer.send(IPC_SEND.WINDOW_CLOSE_CURRENT),
  openSettingsWindow: () => ipcRenderer.send(IPC_SEND.WINDOW_OPEN_SETTINGS),
  setFlyoutPinned: (pinned) => invoke(IPC_INVOKE.WINDOW_SET_PINNED, pinned),
  reportFlyoutContentSize: (width, height) => ipcRenderer.send(IPC_SEND.WINDOW_FIT_CONTENT, { width, height }),
  setSettings: (settings) => invoke(IPC_INVOKE.SETTINGS_SET, settings),
  onState: (cb) => subscribe(IPC_EVENT.BACKEND_STATE, cb),
  onPresets: (cb) => subscribe(IPC_EVENT.BACKEND_PRESETS, cb),
  onStatus: (cb) => subscribe(IPC_EVENT.BACKEND_STATUS, cb),
  onError: (cb) => subscribe(IPC_EVENT.BACKEND_ERROR, cb),
  onTheme: (cb) => subscribe(IPC_EVENT.THEME_UPDATE, cb),
  onSettings: (cb) => subscribe(IPC_EVENT.SETTINGS_UPDATE, cb),
  onLog: (cb) => subscribe(IPC_EVENT.APP_LOG, cb),
  onDdcUpdate: (cb) => subscribe(IPC_EVENT.DDC_UPDATE, cb),
  onOpenApps: (cb) => subscribe(IPC_EVENT.OPEN_APPS_UPDATE, cb),
  onOledServiceFrame: (cb) => subscribe(IPC_EVENT.OLED_SERVICE_FRAME, cb),
};

contextBridge.exposeInMainWorld("arctisBridge", api);
contextBridge.exposeInMainWorld("api", api);

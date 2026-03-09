import { contextBridge, ipcRenderer } from "electron";
import type { AppState, BackendCommand, PresetMap, UiSettings } from "@shared/types";

interface InitialPayload {
  state: AppState;
  presets: PresetMap;
  settings: UiSettings;
  theme: { isDark: boolean; accent: string };
  status: string;
  error: string | null;
  logs: string[];
  ddcMonitors: DdcMonitorPayload[];
  ddcMonitorsUpdatedAt: number | null;
  flyoutPinned: boolean;
  serviceStatus: {
    arctisApi: { state: "starting" | "running" | "error" | "stopped"; detail: string };
    ddcApi: {
      state: "starting" | "running" | "error" | "stopped";
      detail: string;
      endpoint: string;
      managed: boolean;
      pid: number | null;
    };
  };
}

interface MixerDataPayload {
  outputs: Array<{ id: string; name: string }>;
  selectedOutputId: string;
  apps: Array<{ id: string; name: string; volume: number; muted: boolean }>;
}

interface DdcMonitorPayload {
  monitor_id: number;
  name: string;
  brightness: number | null;
  input_source: string | null;
  available_inputs: string[];
  contrast: number | null;
  power_mode: string | null;
  supports: string[];
}

const api = {
  getInitial: (): Promise<InitialPayload> => ipcRenderer.invoke("app:get-initial"),
  getServiceStatus: (): Promise<InitialPayload["serviceStatus"]> => ipcRenderer.invoke("services:get-status"),
  openGG: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke("app:open-gg"),
  notifyCustom: (title: string, body: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("app:notify-custom", { title, body }),
  notifyBatteryLowTest: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("app:notify-battery-low-test"),
  notifyBatterySwapTest: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("app:notify-battery-swap-test"),
  notifyHeadsetVolumePreview: (value: number): void => ipcRenderer.send("notification:headset-volume-preview", value),
  getMixerData: (): Promise<MixerDataPayload> => ipcRenderer.invoke("mixer:get-data"),
  setMixerOutput: (outputId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke("mixer:set-output", outputId),
  setMixerAppVolume: (appId: string, volume: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("mixer:set-app-volume", { appId, volume }),
  setMixerAppMute: (appId: string, muted: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("mixer:set-app-mute", { appId, muted }),
  getDdcMonitors: (): Promise<{ ok: boolean; monitors: DdcMonitorPayload[]; updatedAt?: number | null; error?: string }> =>
    ipcRenderer.invoke("ddc:get-monitors"),
  setDdcBrightness: (monitorId: number, value: number): Promise<{ ok: boolean; monitor?: DdcMonitorPayload; error?: string }> =>
    ipcRenderer.invoke("ddc:set-brightness", { monitorId, value }),
  setDdcInputSource: (monitorId: number, value: string): Promise<{ ok: boolean; monitor?: DdcMonitorPayload; error?: string }> =>
    ipcRenderer.invoke("ddc:set-input-source", { monitorId, value }),
  sendCommand: (cmd: BackendCommand): void => ipcRenderer.send("backend:command", cmd),
  closeCurrentWindow: (): void => ipcRenderer.send("window:close-current"),
  openSettingsWindow: (): void => ipcRenderer.send("window:open-settings"),
  setFlyoutPinned: (pinned: boolean): Promise<{ ok: boolean; pinned: boolean }> => ipcRenderer.invoke("window:set-pinned", pinned),
  reportFlyoutContentSize: (width: number, height: number): void => ipcRenderer.send("window:fit-content", { width, height }),
  setSettings: (settings: Partial<UiSettings>): Promise<UiSettings> => ipcRenderer.invoke("settings:set", settings),
  onState: (cb: (state: AppState) => void): (() => void) => {
    const fn = (_: unknown, payload: AppState) => cb(payload);
    ipcRenderer.on("backend:state", fn);
    return () => ipcRenderer.removeListener("backend:state", fn);
  },
  onPresets: (cb: (presets: PresetMap) => void): (() => void) => {
    const fn = (_: unknown, payload: PresetMap) => cb(payload);
    ipcRenderer.on("backend:presets", fn);
    return () => ipcRenderer.removeListener("backend:presets", fn);
  },
  onStatus: (cb: (text: string) => void): (() => void) => {
    const fn = (_: unknown, payload: string) => cb(payload);
    ipcRenderer.on("backend:status", fn);
    return () => ipcRenderer.removeListener("backend:status", fn);
  },
  onError: (cb: (text: string) => void): (() => void) => {
    const fn = (_: unknown, payload: string) => cb(payload);
    ipcRenderer.on("backend:error", fn);
    return () => ipcRenderer.removeListener("backend:error", fn);
  },
  onTheme: (cb: (payload: { isDark: boolean; accent: string }) => void): (() => void) => {
    const fn = (_: unknown, payload: { isDark: boolean; accent: string }) => cb(payload);
    ipcRenderer.on("theme:update", fn);
    return () => ipcRenderer.removeListener("theme:update", fn);
  },
  onSettings: (cb: (payload: UiSettings) => void): (() => void) => {
    const fn = (_: unknown, payload: UiSettings) => cb(payload);
    ipcRenderer.on("settings:update", fn);
    return () => ipcRenderer.removeListener("settings:update", fn);
  },
  onLog: (cb: (line: string) => void): (() => void) => {
    const fn = (_: unknown, payload: string) => cb(payload);
    ipcRenderer.on("app:log", fn);
    return () => ipcRenderer.removeListener("app:log", fn);
  },
  onDdcUpdate: (cb: (monitors: DdcMonitorPayload[]) => void): (() => void) => {
    const fn = (_: unknown, payload: DdcMonitorPayload[]) => cb(payload);
    ipcRenderer.on("ddc:update", fn);
    return () => ipcRenderer.removeListener("ddc:update", fn);
  },
};

contextBridge.exposeInMainWorld("arctisBridge", api);

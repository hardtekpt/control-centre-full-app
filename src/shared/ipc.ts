import type { AppState, BackendCommand, PresetMap, RunningAppInfo, UiSettings } from "./types";

export const IPC_INVOKE = {
  APP_GET_INITIAL: "app:get-initial",
  SERVICES_GET_STATUS: "services:get-status",
  APP_OPEN_GG: "app:open-gg",
  APP_NOTIFY_CUSTOM: "app:notify-custom",
  MIXER_GET_DATA: "mixer:get-data",
  MIXER_SET_OUTPUT: "mixer:set-output",
  MIXER_SET_APP_VOLUME: "mixer:set-app-volume",
  MIXER_SET_APP_MUTE: "mixer:set-app-mute",
  DDC_GET_MONITORS: "ddc:get-monitors",
  DDC_SET_BRIGHTNESS: "ddc:set-brightness",
  DDC_SET_INPUT_SOURCE: "ddc:set-input-source",
  WINDOW_SET_PINNED: "window:set-pinned",
  SETTINGS_SET: "settings:set",
  SETTINGS_EXPORT: "settings:export",
  SETTINGS_IMPORT: "settings:import",
} as const;

export const IPC_SEND = {
  BACKEND_COMMAND: "backend:command",
  NOTIFICATION_HEADSET_VOLUME_PREVIEW: "notification:headset-volume-preview",
  WINDOW_OPEN_SETTINGS: "window:open-settings",
  WINDOW_CLOSE_CURRENT: "window:close-current",
  WINDOW_FIT_CONTENT: "window:fit-content",
} as const;

export const IPC_EVENT = {
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

export type ServiceLifecycleState = "starting" | "running" | "error" | "stopped";

export interface ThemePayload {
  isDark: boolean;
  accent: string;
}

export interface ServiceStatusPayload {
  sonarApi: {
    state: ServiceLifecycleState;
    detail: string;
    endpoint: string | null;
    pollIntervalMs: number;
  };
  hidEvents: {
    state: ServiceLifecycleState;
    detail: string;
  };
  ddcApi: {
    state: ServiceLifecycleState;
    detail: string;
    endpoint: string;
    managed: boolean;
    pid: number | null;
  };
  baseStationOled: {
    state: ServiceLifecycleState;
    detail: string;
  };
  notifications: {
    state: ServiceLifecycleState;
    detail: string;
  };
  automaticPresetSwitcher: {
    state: ServiceLifecycleState;
    detail: string;
  };
  shortcuts: {
    state: ServiceLifecycleState;
    detail: string;
  };
}

export interface MixerOutputPayload {
  id: string;
  name: string;
}

export interface MixerAppPayload {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

export interface MixerDataPayload {
  outputs: MixerOutputPayload[];
  selectedOutputId: string;
  apps: MixerAppPayload[];
}

export interface DdcMonitorPayload {
  monitor_id: number;
  name: string;
  brightness: number | null;
  input_source: string | null;
  available_inputs: string[];
  contrast: number | null;
  power_mode: string | null;
  supports: string[];
}

export interface DdcGetMonitorsResponse {
  ok: boolean;
  monitors: DdcMonitorPayload[];
  updatedAt?: number | null;
  error?: string;
}

export interface DdcMutateMonitorResponse {
  ok: boolean;
  monitor?: DdcMonitorPayload;
  error?: string;
}

export interface OledServiceFramePayload {
  line1: string;
  line2: string;
  generatedAtIso: string;
}

export interface ExportSettingsResponse {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface ImportSettingsResponse {
  ok: boolean;
  settings?: UiSettings;
  cancelled?: boolean;
  error?: string;
}

export interface BooleanOkResponse {
  ok: boolean;
}

export interface OpenGgResponse {
  ok: boolean;
  detail: string;
}

export interface FlyoutPinnedResponse {
  ok: boolean;
  pinned: boolean;
}

export interface InitialPayload {
  state: AppState;
  presets: PresetMap;
  settings: UiSettings;
  openApps: RunningAppInfo[];
  theme: ThemePayload;
  status: string;
  error: string | null;
  logs: string[];
  ddcMonitors: DdcMonitorPayload[];
  ddcMonitorsUpdatedAt: number | null;
  baseStationOledFrame: OledServiceFramePayload | null;
  flyoutPinned: boolean;
  serviceStatus: ServiceStatusPayload;
}

export interface IpcInvokeMap {
  [IPC_INVOKE.APP_GET_INITIAL]: { params: []; result: InitialPayload };
  [IPC_INVOKE.SERVICES_GET_STATUS]: { params: []; result: ServiceStatusPayload };
  [IPC_INVOKE.APP_OPEN_GG]: { params: []; result: OpenGgResponse };
  [IPC_INVOKE.APP_NOTIFY_CUSTOM]: { params: [{ title: string; body: string }]; result: BooleanOkResponse };
  [IPC_INVOKE.MIXER_GET_DATA]: { params: []; result: MixerDataPayload };
  [IPC_INVOKE.MIXER_SET_OUTPUT]: { params: [outputId: string]; result: BooleanOkResponse };
  [IPC_INVOKE.MIXER_SET_APP_VOLUME]: { params: [{ appId: string; volume: number }]; result: BooleanOkResponse };
  [IPC_INVOKE.MIXER_SET_APP_MUTE]: { params: [{ appId: string; muted: boolean }]; result: BooleanOkResponse };
  [IPC_INVOKE.DDC_GET_MONITORS]: { params: []; result: DdcGetMonitorsResponse };
  [IPC_INVOKE.DDC_SET_BRIGHTNESS]: { params: [{ monitorId: number; value: number }]; result: DdcMutateMonitorResponse };
  [IPC_INVOKE.DDC_SET_INPUT_SOURCE]: { params: [{ monitorId: number; value: string }]; result: DdcMutateMonitorResponse };
  [IPC_INVOKE.WINDOW_SET_PINNED]: { params: [pinned: boolean]; result: FlyoutPinnedResponse };
  [IPC_INVOKE.SETTINGS_SET]: { params: [settings: Partial<UiSettings>]; result: UiSettings };
  [IPC_INVOKE.SETTINGS_EXPORT]: { params: []; result: ExportSettingsResponse };
  [IPC_INVOKE.SETTINGS_IMPORT]: { params: []; result: ImportSettingsResponse };
}

export type InvokeChannel = keyof IpcInvokeMap;
export type InvokeArgs<C extends InvokeChannel> = IpcInvokeMap[C]["params"];
export type InvokeResult<C extends InvokeChannel> = IpcInvokeMap[C]["result"];

export interface IpcEventPayloadMap {
  [IPC_EVENT.BACKEND_STATE]: AppState;
  [IPC_EVENT.BACKEND_PRESETS]: PresetMap;
  [IPC_EVENT.BACKEND_STATUS]: string;
  [IPC_EVENT.BACKEND_ERROR]: string;
  [IPC_EVENT.THEME_UPDATE]: ThemePayload;
  [IPC_EVENT.SETTINGS_UPDATE]: UiSettings;
  [IPC_EVENT.APP_LOG]: string;
  [IPC_EVENT.DDC_UPDATE]: DdcMonitorPayload[];
  [IPC_EVENT.OPEN_APPS_UPDATE]: RunningAppInfo[];
  [IPC_EVENT.OLED_SERVICE_FRAME]: OledServiceFramePayload;
}

export type EventChannel = keyof IpcEventPayloadMap;
export type EventPayload<C extends EventChannel> = IpcEventPayloadMap[C];

export interface ArctisBridgeApi {
  // Generic invoke powers hooks like useIpc while preserving strict channel typing.
  invoke<C extends InvokeChannel>(channel: C, ...params: InvokeArgs<C>): Promise<InvokeResult<C>>;
  getInitial(): Promise<InitialPayload>;
  getServiceStatus(): Promise<ServiceStatusPayload>;
  openGG(): Promise<OpenGgResponse>;
  notifyCustom(title: string, body: string): Promise<BooleanOkResponse>;
  notifyHeadsetVolumePreview(value: number): void;
  getMixerData(): Promise<MixerDataPayload>;
  setMixerOutput(outputId: string): Promise<BooleanOkResponse>;
  setMixerAppVolume(appId: string, volume: number): Promise<BooleanOkResponse>;
  setMixerAppMute(appId: string, muted: boolean): Promise<BooleanOkResponse>;
  getDdcMonitors(): Promise<DdcGetMonitorsResponse>;
  setDdcBrightness(monitorId: number, value: number): Promise<DdcMutateMonitorResponse>;
  setDdcInputSource(monitorId: number, value: string): Promise<DdcMutateMonitorResponse>;
  sendCommand(cmd: BackendCommand): void;
  closeCurrentWindow(): void;
  openSettingsWindow(): void;
  setFlyoutPinned(pinned: boolean): Promise<FlyoutPinnedResponse>;
  reportFlyoutContentSize(width: number, height: number): void;
  setSettings(settings: Partial<UiSettings>): Promise<UiSettings>;
  exportSettings(): Promise<ExportSettingsResponse>;
  importSettings(): Promise<ImportSettingsResponse>;
  onState(cb: (state: AppState) => void): () => void;
  onPresets(cb: (presets: PresetMap) => void): () => void;
  onStatus(cb: (text: string) => void): () => void;
  onError(cb: (text: string) => void): () => void;
  onTheme(cb: (payload: ThemePayload) => void): () => void;
  onSettings(cb: (payload: UiSettings) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
  onOpenApps(cb: (apps: RunningAppInfo[]) => void): () => void;
  onDdcUpdate(cb: (monitors: DdcMonitorPayload[]) => void): () => void;
  onOledServiceFrame(cb: (frame: OledServiceFramePayload) => void): () => void;
}

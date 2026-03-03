import type { AppState, ChannelKey, UiSettings } from "./types";

const DEFAULT_CHANNELS: ChannelKey[] = ["master", "game", "chatRender", "media", "aux", "chatCapture"];

export const DEFAULT_STATE: AppState = {
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

export const DEFAULT_SETTINGS: UiSettings = {
  themeMode: "system",
  accentColor: "",
  textScale: 100,
  useActiveDisplay: false,
  pcUsbInput: 1,
  showBatteryPercent: true,
  notificationTimeout: 5,
  batteryLowThreshold: 15,
  flyoutWidth: 760,
  flyoutHeight: 520,
  toggleShortcut: "CommandOrControl+Shift+A",
  visibleChannels: [...DEFAULT_CHANNELS],
  notifications: {
    connectivity: true,
    usbInput: true,
    ancMode: true,
    oled: true,
    sidetone: true,
    micMute: true,
    headsetChatMix: true,
    headsetVolume: true,
    battery: true,
    appInfo: true,
    presetChange: true,
  },
  ddc: {
    apiBaseUrl: "http://127.0.0.1:59321",
    pollIntervalMs: 300000,
    monitorPrefs: {},
  },
};

export function mergeState(partial?: Partial<AppState>): AppState {
  return {
    ...DEFAULT_STATE,
    ...(partial ?? {}),
    channel_volume: {
      ...DEFAULT_STATE.channel_volume,
      ...(partial?.channel_volume ?? {}),
    },
    channel_mute: {
      ...DEFAULT_STATE.channel_mute,
      ...(partial?.channel_mute ?? {}),
    },
    channel_preset: {
      ...DEFAULT_STATE.channel_preset,
      ...(partial?.channel_preset ?? {}),
    },
    channel_apps: {
      ...DEFAULT_STATE.channel_apps,
      ...(partial?.channel_apps ?? {}),
    },
  };
}

export function mergeSettings(partial?: Partial<UiSettings>): UiSettings {
  const { micaBlur: _legacyMicaBlur, closeOnBlur: _legacyCloseOnBlur, ...partialSanitized } = (partial ?? {}) as Partial<UiSettings> & {
    micaBlur?: boolean;
    closeOnBlur?: boolean;
  };
  const { chatMix: legacyChatMix, ...notificationsSanitized } = ((partialSanitized.notifications ?? {}) as Record<string, boolean> & {
    chatMix?: boolean;
  });
  const notificationsWithLegacy: Record<string, boolean> =
    notificationsSanitized.headsetChatMix == null && legacyChatMix != null
      ? { ...notificationsSanitized, headsetChatMix: legacyChatMix }
      : notificationsSanitized;
  const visibleChannels =
    partialSanitized.visibleChannels?.filter((channel): channel is ChannelKey => DEFAULT_CHANNELS.includes(channel)) ??
    DEFAULT_SETTINGS.visibleChannels;
  return {
    ...DEFAULT_SETTINGS,
    ...partialSanitized,
    pcUsbInput: partialSanitized.pcUsbInput === 2 ? 2 : 1,
    notificationTimeout: clamp((partialSanitized.notificationTimeout ?? DEFAULT_SETTINGS.notificationTimeout), 2, 30),
    batteryLowThreshold: clamp((partialSanitized.batteryLowThreshold ?? DEFAULT_SETTINGS.batteryLowThreshold), 1, 100),
    flyoutWidth: clamp((partialSanitized.flyoutWidth ?? DEFAULT_SETTINGS.flyoutWidth), 320, 1000),
    flyoutHeight: clamp((partialSanitized.flyoutHeight ?? DEFAULT_SETTINGS.flyoutHeight), 260, 1200),
    visibleChannels,
    notifications: {
      ...DEFAULT_SETTINGS.notifications,
      ...notificationsWithLegacy,
    },
    ddc: {
      ...DEFAULT_SETTINGS.ddc,
      ...(partialSanitized.ddc ?? {}),
      apiBaseUrl: String(partialSanitized.ddc?.apiBaseUrl ?? DEFAULT_SETTINGS.ddc.apiBaseUrl).trim() || DEFAULT_SETTINGS.ddc.apiBaseUrl,
      pollIntervalMs: clamp(partialSanitized.ddc?.pollIntervalMs ?? DEFAULT_SETTINGS.ddc.pollIntervalMs, 10000, 1800000),
      monitorPrefs: { ...DEFAULT_SETTINGS.ddc.monitorPrefs, ...(partialSanitized.ddc?.monitorPrefs ?? {}) },
    },
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

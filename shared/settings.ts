import type { AppState, ChannelKey, ShortcutAction, ShortcutBinding, UiSettings } from "./types";

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
  shortcuts: [],
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
    shortcuts: sanitizeShortcuts(partialSanitized.shortcuts),
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

const SHORTCUT_ACTIONS: ShortcutAction[] = [
  "sonar_volume_up",
  "sonar_volume_down",
  "sonar_mute_toggle",
  "sonar_mute_on",
  "sonar_mute_off",
  "sonar_set_preset",
  "ddc_brightness_up",
  "ddc_brightness_down",
  "ddc_brightness_set",
  "ddc_input_set",
];

const SHORTCUT_ACTION_SET = new Set<ShortcutAction>(SHORTCUT_ACTIONS);

function sanitizeShortcuts(value: unknown): ShortcutBinding[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SETTINGS.shortcuts];
  }
  const out: ShortcutBinding[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const action = sanitizeShortcutAction(row.action);
    const channel = sanitizeShortcutChannel(row.channel);
    const monitorIdRaw = Number(row.monitorId ?? row.monitor_id);
    const monitorId = Number.isFinite(monitorIdRaw) && monitorIdRaw > 0 ? Math.round(monitorIdRaw) : undefined;
    const presetId = String(row.presetId ?? row.preset_id ?? "").trim() || undefined;
    const inputSource = String(row.inputSource ?? row.input_source ?? "").trim() || undefined;
    const shortcut: ShortcutBinding = {
      id: sanitizeShortcutId(row.id, index),
      enabled: row.enabled !== false,
      accelerator: String(row.accelerator ?? "")
        .trim()
        .slice(0, 120),
      action,
    };
    if (channel) {
      shortcut.channel = channel;
    }
    if (presetId) {
      shortcut.presetId = presetId;
    }
    if (monitorId) {
      shortcut.monitorId = monitorId;
    }
    if (inputSource) {
      shortcut.inputSource = inputSource;
    }
    if (row.step != null && Number.isFinite(Number(row.step))) {
      shortcut.step = clamp(Math.round(Number(row.step)), 1, 50);
    }
    if (row.brightness != null && Number.isFinite(Number(row.brightness))) {
      shortcut.brightness = clamp(Math.round(Number(row.brightness)), 0, 100);
    }
    out.push(shortcut);
  }
  return out.slice(0, 100);
}

function sanitizeShortcutAction(value: unknown): ShortcutAction {
  const raw = String(value ?? "").trim() as ShortcutAction;
  if (SHORTCUT_ACTION_SET.has(raw)) {
    return raw;
  }
  return "sonar_volume_up";
}

function sanitizeShortcutChannel(value: unknown): ChannelKey | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return DEFAULT_CHANNELS.includes(value as ChannelKey) ? (value as ChannelKey) : undefined;
}

function sanitizeShortcutId(value: unknown, index: number): string {
  const raw = String(value ?? "").trim().slice(0, 80);
  if (raw) {
    return raw;
  }
  return `shortcut-${index + 1}`;
}

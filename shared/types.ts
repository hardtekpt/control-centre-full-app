export const CHANNELS = [
  "master",
  "game",
  "chatRender",
  "media",
  "aux",
  "chatCapture",
] as const;

export type ChannelKey = (typeof CHANNELS)[number];

export type NotificationKey =
  | "connectivity"
  | "usbInput"
  | "ancMode"
  | "oled"
  | "sidetone"
  | "micMute"
  | "headsetChatMix"
  | "headsetVolume"
  | "battery"
  | "appInfo"
  | "presetChange";

export interface AppState {
  headset_battery_percent: number | null;
  base_battery_percent: number | null;
  base_station_connected: boolean | null;
  current_usb_input: 1 | 2 | null;
  headset_volume_percent: number | null;
  anc_mode: string | null;
  mic_mute: boolean | null;
  sidetone_level: number | null;
  connected: boolean | null;
  wireless: boolean | null;
  bluetooth: boolean | null;
  chat_mix_balance: number | null;
  oled_brightness: number | null;
  channel_volume: Partial<Record<ChannelKey, number>>;
  channel_mute: Partial<Record<ChannelKey, boolean>>;
  channel_preset: Partial<Record<ChannelKey, string | null>>;
  channel_apps: Partial<Record<ChannelKey, string[]>>;
  updated_at: string | null;
}

export interface UiSettings {
  themeMode: "system" | "light" | "dark";
  accentColor: string;
  textScale: number;
  useActiveDisplay: boolean;
  pcUsbInput: 1 | 2;
  showBatteryPercent: boolean;
  notificationTimeout: number;
  batteryLowThreshold: number;
  flyoutWidth: number;
  flyoutHeight: number;
  toggleShortcut: string;
  shortcuts: ShortcutBinding[];
  visibleChannels: ChannelKey[];
  notifications: Record<NotificationKey, boolean>;
  ddc: {
    apiBaseUrl: string;
    pollIntervalMs: number;
    monitorPrefs: Record<
      string,
      {
        alias: string;
        enabled: boolean;
      }
    >;
  };
}

export type ShortcutAction =
  | "sonar_volume_up"
  | "sonar_volume_down"
  | "sonar_mute_toggle"
  | "sonar_mute_on"
  | "sonar_mute_off"
  | "sonar_set_preset"
  | "ddc_brightness_up"
  | "ddc_brightness_down"
  | "ddc_brightness_set"
  | "ddc_input_set";

export interface ShortcutBinding {
  id: string;
  enabled: boolean;
  accelerator: string;
  action: ShortcutAction;
  channel?: ChannelKey;
  step?: number;
  presetId?: string;
  monitorId?: number;
  brightness?: number;
  inputSource?: string;
}

export interface BackendCommand {
  name: "set_channel_volume" | "set_channel_mute" | "set_preset";
  payload: Record<string, unknown>;
}

export interface PresetMap {
  [channel: string]: Array<[string, string]>;
}

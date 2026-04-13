import type { NotificationKey, ShortcutAction } from "@shared/types";

export interface NotificationCategory {
  title: string;
  items: Array<{ key: NotificationKey; label: string }>;
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    title: "Headset",
    items: [
      { key: "headsetVolume", label: "Volume + Chat Mix OSD" },
      { key: "headsetChatMix", label: "Include Chat Mix in Headset OSD" },
      { key: "micMute", label: "MIC Mute OSD Indicator" },
      { key: "ancMode", label: "ANC OSD Indicator" },
      { key: "sidetone", label: "Sidetone OSD" },
    ],
  },
  {
    title: "Battery",
    items: [
      { key: "battery", label: "Battery Alerts (Low + Base Station Insert/Remove)" },
    ],
  },
  {
    title: "Connectivity",
    items: [
      { key: "connectivity", label: "Connectivity OSD Indicator" },
      { key: "usbInput", label: "USB Input Selected OSD" },
    ],
  },
  {
    title: "App / Sonar",
    items: [
      { key: "presetChange", label: "Preset Change" },
      { key: "appInfo", label: "App Info (Startup / Errors)" },
    ],
  },
  {
    title: "Display",
    items: [
      { key: "oled", label: "OLED Brightness OSD" },
    ],
  },
];

export const NOTIFICATION_LABELS: Array<{ key: NotificationKey; label: string }> =
  NOTIFICATION_CATEGORIES.flatMap((category) => category.items);

export const SHORTCUT_ACTION_OPTIONS: Array<{ value: ShortcutAction; label: string }> = [
  { value: "sonar_volume_up", label: "Sonar Volume Up" },
  { value: "sonar_volume_down", label: "Sonar Volume Down" },
  { value: "sonar_mute_toggle", label: "Sonar Toggle Mute" },
  { value: "sonar_mute_on", label: "Sonar Mute On" },
  { value: "sonar_mute_off", label: "Sonar Mute Off" },
  { value: "sonar_set_preset", label: "Sonar Set Preset" },
  { value: "ddc_brightness_up", label: "Monitor Brightness Up" },
  { value: "ddc_brightness_down", label: "Monitor Brightness Down" },
  { value: "ddc_brightness_set", label: "Monitor Brightness Set" },
  { value: "ddc_input_set", label: "Monitor Input Set" },
];

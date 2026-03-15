import type { NotificationKey, ShortcutAction } from "@shared/types";

export const NOTIFICATION_LABELS: Array<{ key: NotificationKey; label: string }> = [
  { key: "appInfo", label: "Main App Info (Startup/Errors)" },
  { key: "connectivity", label: "Connectivity OSD Indicator" },
  { key: "usbInput", label: "USB Input Selected OSD" },
  { key: "ancMode", label: "ANC OSD Indicator" },
  { key: "oled", label: "OLED Brightness OSD" },
  { key: "sidetone", label: "Sidetone OSD" },
  { key: "micMute", label: "MIC Mute OSD Indicator" },
  { key: "headsetChatMix", label: "Include Chat Mix In Headset OSD" },
  { key: "headsetVolume", label: "Headset Volume + Chat Mix OSD" },
  { key: "battery", label: "Battery OSD Alerts (Low + Base Station Insert/Remove)" },
  { key: "presetChange", label: "Sonar Preset Change" },
];

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

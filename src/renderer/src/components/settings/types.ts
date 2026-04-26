export type SettingsTab = "app" | "ggSonar" | "oledNotifications" | "oledDisplay" | "shortcuts" | "ddc" | "autoPreset" | "discord" | "hid" | "about";

export const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "app", label: "App" },
  { key: "ggSonar", label: "GG Sonar" },
  { key: "oledNotifications", label: "OSD Notifications" },
  { key: "oledDisplay", label: "OLED Display" },
  { key: "shortcuts", label: "Shortcuts" },
  { key: "autoPreset", label: "Automatic Presets" },
  { key: "ddc", label: "DDC" },
  { key: "discord", label: "Discord" },
  { key: "hid", label: "HID" },
  { key: "about", label: "About" },
];

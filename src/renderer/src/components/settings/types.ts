export type SettingsTab = "app" | "ggSonar" | "oledNotifications" | "shortcuts" | "notifications" | "ddc" | "autoPreset" | "discord" | "about";

export const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "app", label: "App" },
  { key: "ggSonar", label: "GG Sonar" },
  { key: "oledNotifications", label: "OSD Notifications" },
  { key: "shortcuts", label: "Shortcuts" },
  { key: "autoPreset", label: "Automatic Presets" },
  { key: "notifications", label: "Notifications" },
  { key: "ddc", label: "DDC" },
  { key: "discord", label: "Discord" },
  { key: "about", label: "About" },
];

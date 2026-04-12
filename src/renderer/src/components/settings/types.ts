export type SettingsTab = "app" | "ggSonar" | "oledService" | "shortcuts" | "notifications" | "ddc" | "autoPreset" | "about";

export const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "app", label: "App" },
  { key: "ggSonar", label: "GG Sonar" },
  { key: "oledService", label: "Base OLED" },
  { key: "shortcuts", label: "Shortcuts" },
  { key: "autoPreset", label: "Automatic Presets" },
  { key: "notifications", label: "Notifications" },
  { key: "ddc", label: "DDC" },
  { key: "about", label: "About" },
];

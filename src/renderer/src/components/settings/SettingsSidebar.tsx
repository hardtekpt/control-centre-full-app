import type { SettingsTab } from "./types";
import { SETTINGS_TABS } from "./types";

interface SettingsSidebarProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

/**
 * Sidebar navigation for the settings window.
 */
export default function SettingsSidebar({ activeTab, onTabChange }: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar">
      <h3>Settings</h3>
      {SETTINGS_TABS.map((tab) => (
        <button key={tab.key} className={`settings-nav-btn ${activeTab === tab.key ? "active" : ""}`} onClick={() => onTabChange(tab.key)}>
          {tab.label}
        </button>
      ))}
    </aside>
  );
}

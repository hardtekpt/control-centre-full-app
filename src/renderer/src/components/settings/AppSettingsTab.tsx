import type { UiSettings } from "@shared/types";
import type { ServiceStatus } from "../../stores/store";

interface AppSettingsTabProps {
  settings: UiSettings;
  shortcutDraft: string;
  serviceStatus: ServiceStatus;
  onShortcutDraftChange: (value: string) => void;
  onShortcutDraftCommit: () => void;
  onUpdate: (partial: Partial<UiSettings>) => void;
  onExportSettings: () => void;
  onImportSettings: () => void;
}

interface ServiceEntry {
  label: string;
  settingKey: keyof UiSettings["services"] & string;
  statusKey: keyof ServiceStatus;
}

const SERVICE_LIST: ServiceEntry[] = [
  { label: "Sonar GG API",      settingKey: "sonarApiEnabled",                  statusKey: "sonarApi" },
  { label: "HID Events",        settingKey: "hidEventsEnabled",                 statusKey: "hidEvents" },
  { label: "DDC",               settingKey: "ddcEnabled",                       statusKey: "ddcApi" },
  { label: "OSD Notifications", settingKey: "notificationsEnabled",             statusKey: "notifications" },
  { label: "Preset Switcher",   settingKey: "automaticPresetSwitcherEnabled",   statusKey: "automaticPresetSwitcher" },
  { label: "Shortcuts",         settingKey: "shortcutsEnabled",                 statusKey: "shortcuts" },
  { label: "Discord RPC",       settingKey: "discordEnabled",                   statusKey: "discordRpc" },
];

/**
 * Global app preferences shown in the Settings page.
 */
export default function AppSettingsTab({
  settings,
  shortcutDraft,
  serviceStatus,
  onShortcutDraftChange,
  onShortcutDraftCommit,
  onUpdate,
  onExportSettings,
  onImportSettings,
}: AppSettingsTabProps) {
  const serviceSettings = settings.services;

  const setServiceEnabled = (key: keyof UiSettings["services"], enabled: boolean) => {
    onUpdate({ services: { ...serviceSettings, [key]: enabled } });
  };

  const restartService = (key: keyof UiSettings["services"]) => {
    onUpdate({ services: { ...serviceSettings, [key]: false } });
    setTimeout(() => onUpdate({ services: { ...serviceSettings, [key]: true } }), 400);
  };

  const isEnabled = (key: keyof UiSettings["services"]): boolean => {
    if (key === "discordEnabled") return serviceSettings.discordEnabled === true;
    return (serviceSettings[key] as boolean | undefined) !== false;
  };

  return (
    <>
      <h3>App Settings</h3>

      <div className="settings-two-col">
        <div className="settings-col">
          <div className="settings-section">
            <div className="settings-section-title">Appearance</div>
            <label className="form-row">
              <span>Theme</span>
              <select value={settings.themeMode} onChange={(event) => onUpdate({ themeMode: event.currentTarget.value as UiSettings["themeMode"] })}>
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="form-row">
              <span>Accent color</span>
              <div className="accent-row">
                <input type="color" value={settings.accentColor || "#6ab7ff"} onChange={(event) => onUpdate({ accentColor: event.currentTarget.value })} />
                <button className="button" onClick={() => onUpdate({ accentColor: "" })}>System</button>
              </div>
            </label>
            <label className="form-row">
              <span>Text size</span>
              <input type="range" min={80} max={140} value={settings.textScale} onChange={(event) => onUpdate({ textScale: Number(event.currentTarget.value) })} />
            </label>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Display</div>
            <label className="form-row">
              <span>Use active screen</span>
              <input type="checkbox" checked={settings.useActiveDisplay} onChange={(event) => onUpdate({ useActiveDisplay: event.currentTarget.checked })} />
            </label>
            <label className="form-row">
              <span>Show battery %</span>
              <input type="checkbox" checked={settings.showBatteryPercent} onChange={(event) => onUpdate({ showBatteryPercent: event.currentTarget.checked })} />
            </label>
            <label className="form-row">
              <span>Windows Mixer tab</span>
              <input type="checkbox" checked={settings.showWindowsMixer !== false} onChange={(event) => onUpdate({ showWindowsMixer: event.currentTarget.checked })} />
            </label>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Controls</div>
            <label className="form-row">
              <span>Toggle shortcut</span>
              <input
                className="text-input"
                value={shortcutDraft}
                onChange={(event) => onShortcutDraftChange(event.currentTarget.value)}
                onBlur={onShortcutDraftCommit}
                placeholder="CommandOrControl+Shift+A"
              />
            </label>
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Configuration</div>
            <div className="settings-action-row">
              <button
                className="button"
                title="Save all current settings to a JSON file"
                onClick={onExportSettings}
              >
                Export settings
              </button>
              <button
                className="button"
                title="Load settings from a previously exported JSON file"
                onClick={onImportSettings}
              >
                Import settings
              </button>
            </div>
          </div>
        </div>

        <div className="settings-col">
          <div className="settings-section">
            <div className="settings-section-title">Background Services</div>
            {SERVICE_LIST.map(({ label, settingKey, statusKey }) => {
              const state = (serviceStatus[statusKey] as { state: string }).state;
              const enabled = isEnabled(settingKey);
              return (
                <div key={settingKey} className="service-ctrl-row">
                  <input
                    type="checkbox"
                    checked={enabled}
                    title={enabled ? "Disable service (persists across restarts)" : "Enable service (persists across restarts)"}
                    onChange={(event) => setServiceEnabled(settingKey, event.currentTarget.checked)}
                  />
                  <span className="service-ctrl-name">{label}</span>
                  <span className={`service-state ${state}`}>{state}</span>
                  <button
                    className="service-ctrl-btn service-ctrl-btn--start"
                    title="Start service"
                    disabled={enabled}
                    onClick={() => setServiceEnabled(settingKey, true)}
                  >▶</button>
                  <button
                    className="service-ctrl-btn service-ctrl-btn--stop"
                    title="Stop service"
                    disabled={!enabled}
                    onClick={() => setServiceEnabled(settingKey, false)}
                  >■</button>
                  <button
                    className="service-ctrl-btn service-ctrl-btn--restart"
                    title="Restart service"
                    disabled={!enabled}
                    onClick={() => restartService(settingKey)}
                  >↺</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

import type { UiSettings } from "@shared/types";

interface AppSettingsTabProps {
  settings: UiSettings;
  shortcutDraft: string;
  onShortcutDraftChange: (value: string) => void;
  onShortcutDraftCommit: () => void;
  onUpdate: (partial: Partial<UiSettings>) => void;
}

/**
 * Global app preferences shown in the Settings page.
 */
export default function AppSettingsTab({ settings, shortcutDraft, onShortcutDraftChange, onShortcutDraftCommit, onUpdate }: AppSettingsTabProps) {
  const serviceSettings = settings.services;
  const updateServiceSetting = <K extends keyof UiSettings["services"],>(key: K, value: UiSettings["services"][K]) => {
    onUpdate({
      services: {
        ...serviceSettings,
        [key]: value,
      },
    });
  };

  return (
    <>
      <h3>App Settings</h3>
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
          <button className="button" onClick={() => onUpdate({ accentColor: "" })}>
            System
          </button>
        </div>
      </label>
      <label className="form-row">
        <span>Text size</span>
        <input type="range" min={80} max={140} value={settings.textScale} onChange={(event) => onUpdate({ textScale: Number(event.currentTarget.value) })} />
      </label>
      <label className="form-row">
        <span>Use active screen for windows/notifications</span>
        <input type="checkbox" checked={settings.useActiveDisplay} onChange={(event) => onUpdate({ useActiveDisplay: event.currentTarget.checked })} />
      </label>
      <label className="form-row">
        <span>Show battery %</span>
        <input type="checkbox" checked={settings.showBatteryPercent} onChange={(event) => onUpdate({ showBatteryPercent: event.currentTarget.checked })} />
      </label>
      <label className="form-row">
        <span>Enable Windows Mixer tab</span>
        <input type="checkbox" checked={settings.showWindowsMixer !== false} onChange={(event) => onUpdate({ showWindowsMixer: event.currentTarget.checked })} />
      </label>
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

      <h4>Background Services</h4>
      <label className="form-row">
        <span>Sonar GG API service</span>
        <input type="checkbox" checked={serviceSettings.sonarApiEnabled !== false} onChange={(event) => updateServiceSetting("sonarApiEnabled", event.currentTarget.checked)} />
      </label>
      <label className="form-row">
        <span>Sonar poll interval (seconds)</span>
        <div className="accent-row">
          <input
            className="text-input"
            type="number"
            min={1}
            max={60}
            step={1}
            value={Math.max(1, Math.round((serviceSettings.sonarPollIntervalMs ?? 2000) / 1000))}
            onChange={(event) =>
              updateServiceSetting("sonarPollIntervalMs", Math.max(1, Math.round(Number(event.currentTarget.value) || 2)) * 1000)
            }
          />
          <span>s</span>
        </div>
      </label>
      <label className="form-row">
        <span>HID Events service</span>
        <input type="checkbox" checked={serviceSettings.hidEventsEnabled !== false} onChange={(event) => updateServiceSetting("hidEventsEnabled", event.currentTarget.checked)} />
      </label>
      <label className="form-row">
        <span>DDC service</span>
        <input type="checkbox" checked={serviceSettings.ddcEnabled !== false} onChange={(event) => updateServiceSetting("ddcEnabled", event.currentTarget.checked)} />
      </label>
      <label className="form-row">
        <span>Base Station OLED service</span>
        <input
          type="checkbox"
          checked={serviceSettings.oledDisplayEnabled === true}
          onChange={(event) => updateServiceSetting("oledDisplayEnabled", event.currentTarget.checked)}
        />
      </label>
      <label className="form-row">
        <span>Notifications service</span>
        <input
          type="checkbox"
          checked={serviceSettings.notificationsEnabled !== false}
          onChange={(event) => updateServiceSetting("notificationsEnabled", event.currentTarget.checked)}
        />
      </label>
      <label className="form-row">
        <span>Automatic Preset Switcher service</span>
        <input
          type="checkbox"
          checked={serviceSettings.automaticPresetSwitcherEnabled !== false}
          onChange={(event) => updateServiceSetting("automaticPresetSwitcherEnabled", event.currentTarget.checked)}
        />
      </label>
      <label className="form-row">
        <span>Shortcuts service</span>
        <input type="checkbox" checked={serviceSettings.shortcutsEnabled !== false} onChange={(event) => updateServiceSetting("shortcutsEnabled", event.currentTarget.checked)} />
      </label>
    </>
  );
}

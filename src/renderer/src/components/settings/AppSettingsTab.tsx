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
    </>
  );
}

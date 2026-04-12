import type { NotificationKey, UiSettings } from "@shared/types";
import { NOTIFICATION_LABELS } from "./constants";

interface NotificationSettingsTabProps {
  settings: UiSettings;
  onUpdate: (partial: Partial<UiSettings>) => void;
  onToggleNotification: (key: NotificationKey, enabled: boolean) => void;
  onTestNotification: () => void;
  onTestLowBatteryNotification: () => void;
  onTestBatterySwapNotification: () => void;
}

/**
 * Notification and OSD preferences.
 */
export default function NotificationSettingsTab({
  settings,
  onUpdate,
  onToggleNotification,
  onTestNotification,
  onTestLowBatteryNotification,
  onTestBatterySwapNotification,
}: NotificationSettingsTabProps) {
  return (
    <>
      <h3>Notification Settings</h3>

      <div className="settings-section">
        <div className="settings-section-title">Timing</div>
        <label className="form-row">
          <span>Notification timeout</span>
          <div className="accent-row">
            <input
              className="text-input"
              type="number"
              min={2}
              max={30}
              value={settings.notificationTimeout}
              onChange={(event) => onUpdate({ notificationTimeout: Number(event.currentTarget.value) || 5 })}
            />
            <span>s</span>
          </div>
        </label>
        <label className="form-row">
          <span>Low battery threshold</span>
          <div className="accent-row">
            <input
              className="text-input"
              type="number"
              min={1}
              max={100}
              value={settings.batteryLowThreshold}
              onChange={(event) => onUpdate({ batteryLowThreshold: Number(event.currentTarget.value) || 15 })}
            />
            <span>%</span>
          </div>
        </label>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Notification Types</div>
        <div className="visible-grid">
          {NOTIFICATION_LABELS.map((item) => (
            <label key={item.key} className="visible-item">
              <input type="checkbox" checked={settings.notifications[item.key]} onChange={(event) => onToggleNotification(item.key, event.currentTarget.checked)} />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Test</div>
        <div className="settings-action-row">
          <button className="button" onClick={onTestNotification}>
            Push Test
          </button>
          <button className="button" onClick={onTestLowBatteryNotification}>
            Low Battery
          </button>
          <button className="button" onClick={onTestBatterySwapNotification}>
            Battery Swap
          </button>
        </div>
      </div>
    </>
  );
}

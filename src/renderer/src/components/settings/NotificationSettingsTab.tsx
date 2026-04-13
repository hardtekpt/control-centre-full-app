import type { NotificationKey, UiSettings } from "@shared/types";
import { NOTIFICATION_CATEGORIES } from "./constants";

interface NotificationSettingsTabProps {
  settings: UiSettings;
  onUpdate: (partial: Partial<UiSettings>) => void;
  onToggleNotification: (key: NotificationKey, enabled: boolean) => void;
}

/**
 * Notification and OSD preferences.
 */
export default function NotificationSettingsTab({
  settings,
  onUpdate,
  onToggleNotification,
}: NotificationSettingsTabProps) {
  return (
    <>
      <h3>Notification Settings</h3>

      <div className="settings-section">
        <div className="settings-section-title">Timing</div>
        <div className="notif-timing-grid">
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
                title="How long each notification stays visible (seconds)"
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
                title="Battery level (%) at which a low battery alert is shown"
              />
              <span>%</span>
            </div>
          </label>
        </div>
      </div>

      {NOTIFICATION_CATEGORIES.map((category) => (
        <div key={category.title} className="settings-section">
          <div className="settings-section-title">{category.title}</div>
          <div className="visible-grid">
            {category.items.map((item) => (
              <label key={item.key} className="visible-item">
                <input
                  type="checkbox"
                  checked={settings.notifications[item.key]}
                  onChange={(event) => onToggleNotification(item.key, event.currentTarget.checked)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

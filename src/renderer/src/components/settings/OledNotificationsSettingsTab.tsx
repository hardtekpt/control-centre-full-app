import type { NotificationKey, UiSettings } from "@shared/types";
import { NOTIFICATION_CATEGORIES } from "./constants";

interface OledNotificationsSettingsTabProps {
  settings: UiSettings;
  onUpdate: (partial: Partial<UiSettings>) => void;
}

/**
 * OSD popup notification service settings — enable/disable, timing, and per-event toggles.
 */
export default function OledNotificationsSettingsTab({ settings, onUpdate }: OledNotificationsSettingsTabProps) {
  const serviceSettings = settings.services;

  const toggleNotification = (key: NotificationKey, enabled: boolean) => {
    onUpdate({
      notifications: {
        ...settings.notifications,
        [key]: enabled,
      },
    });
  };

  return (
    <>
      <h3>OSD Notifications</h3>

      <div className="settings-section">
        <div className="settings-section-title">Service</div>
        <label className="form-row">
          <span>Enable OSD notifications</span>
          <input
            type="checkbox"
            checked={serviceSettings.notificationsEnabled !== false}
            onChange={(event) => onUpdate({ services: { ...serviceSettings, notificationsEnabled: event.currentTarget.checked } })}
          />
        </label>
      </div>

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
                  onChange={(event) => toggleNotification(item.key, event.currentTarget.checked)}
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

import type { NotificationKey, UiSettings } from "@shared/types";
import { NOTIFICATION_CATEGORIES } from "./constants";

interface OledDisplaySettingsTabProps {
  settings: UiSettings;
  onUpdate: (partial: Partial<UiSettings>) => void;
}

/**
 * OLED headset display notification settings — timeout and per-event toggles.
 * The service enable/disable toggle is in the App Settings tab (Background Services).
 */
export default function OledDisplaySettingsTab({ settings, onUpdate }: OledDisplaySettingsTabProps) {
  const toggleNotification = (key: NotificationKey, enabled: boolean) => {
    onUpdate({
      oledNotifications: {
        ...settings.oledNotifications,
        [key]: enabled,
      },
    });
  };

  return (
    <>
      <h3>OLED Display Notifications</h3>

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
                value={Math.round(settings.oledNotificationTimeoutMs / 1000)}
                onChange={(event) => onUpdate({ oledNotificationTimeoutMs: (Number(event.currentTarget.value) || 5) * 1000 })}
                title="How long each notification stays on the OLED screen (seconds)"
              />
              <span>s</span>
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
                  checked={settings.oledNotifications[item.key]}
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

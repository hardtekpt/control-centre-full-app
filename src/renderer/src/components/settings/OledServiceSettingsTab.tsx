import type { UiSettings } from "@shared/types";
import type { OledServiceFrame } from "../../stores/store";

interface OledServiceSettingsTabProps {
  settings: UiSettings;
  oledServiceFrame: OledServiceFrame | null;
  onUpdate: (partial: Partial<UiSettings>) => void;
}

export default function OledServiceSettingsTab({ settings, oledServiceFrame, onUpdate }: OledServiceSettingsTabProps) {
  const oledSettings = settings.baseStationOled;

  const updateOled = (partial: Partial<UiSettings["baseStationOled"]>) =>
    onUpdate({
      baseStationOled: {
        ...oledSettings,
        ...partial,
      },
    });

  return (
    <>
      <h3>Base Station OLED</h3>

      <div className="settings-section">
        <div className="settings-section-title">Service</div>
        <label className="form-row">
          <span>Enable OLED service</span>
          <input
            type="checkbox"
            checked={settings.services.oledDisplayEnabled === true}
            onChange={(event) =>
              onUpdate({
                services: {
                  ...settings.services,
                  oledDisplayEnabled: event.currentTarget.checked,
                },
              })
            }
          />
        </label>
        <label className="form-row">
          <span>Refresh interval</span>
          <div className="accent-row">
            <input
              className="text-input"
              type="number"
              min={5}
              max={300}
              step={1}
              value={Math.max(5, Math.round((oledSettings.refreshIntervalMs ?? 15_000) / 1000))}
              onChange={(event) =>
                updateOled({
                  refreshIntervalMs: Math.max(5, Math.round(Number(event.currentTarget.value) || 15)) * 1000,
                })
              }
            />
            <span>s</span>
          </div>
        </label>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Dashboard Components</div>
        <div className="visible-grid">
          <label className="visible-item">
            <input
              type="checkbox"
              checked={oledSettings.showHeadsetVolume !== false}
              onChange={(event) => updateOled({ showHeadsetVolume: event.currentTarget.checked })}
            />
            <span>Headset Volume</span>
          </label>
          <label className="visible-item">
            <input
              type="checkbox"
              checked={oledSettings.showMicMuteStatus !== false}
              onChange={(event) => updateOled({ showMicMuteStatus: event.currentTarget.checked })}
            />
            <span>Mic Mute Status</span>
          </label>
          <label className="visible-item">
            <input
              type="checkbox"
              checked={oledSettings.showAncMode !== false}
              onChange={(event) => updateOled({ showAncMode: event.currentTarget.checked })}
            />
            <span>ANC Mode</span>
          </label>
          <label className="visible-item">
            <input
              type="checkbox"
              checked={oledSettings.showBatteryInfo !== false}
              onChange={(event) => updateOled({ showBatteryInfo: event.currentTarget.checked })}
            />
            <span>Battery Info</span>
          </label>
          <label className="visible-item">
            <input
              type="checkbox"
              checked={oledSettings.showChatMix !== false}
              onChange={(event) => updateOled({ showChatMix: event.currentTarget.checked })}
            />
            <span>Chat Mix</span>
          </label>
          <label className="visible-item">
            <input
              type="checkbox"
              checked={oledSettings.showCustomNotifications === true}
              onChange={(event) => updateOled({ showCustomNotifications: event.currentTarget.checked })}
            />
            <span>Custom Notifications</span>
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Last Payload</div>
        <div className="logs-list">
          {!oledServiceFrame && <div className="log-line">No payload yet. Enable the service to start dashboard updates.</div>}
          {oledServiceFrame && (
            <>
              <div className="log-line">Line 1: {oledServiceFrame.line1 || "(empty)"}</div>
              <div className="log-line">Line 2: {oledServiceFrame.line2 || "(empty)"}</div>
              <div className="log-line">Generated: {new Date(oledServiceFrame.generatedAtIso).toLocaleString()}</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

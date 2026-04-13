import { CHANNELS, type ChannelKey, type UiSettings } from "@shared/types";

interface GgSonarSettingsTabProps {
  settings: UiSettings;
  onUpdate: (partial: Partial<UiSettings>) => void;
  onToggleChannel: (channel: ChannelKey, enabled: boolean) => void;
}

/**
 * Sonar-related preferences and visible channel toggles.
 */
export default function GgSonarSettingsTab({ settings, onUpdate, onToggleChannel }: GgSonarSettingsTabProps) {
  return (
    <>
      <h3>GG Sonar Settings</h3>
      <label className="form-row">
        <span>Poll interval</span>
        <div className="accent-row">
          <input
            className="text-input"
            type="number"
            min={1}
            max={60}
            step={1}
            value={Math.max(1, Math.round((settings.services.sonarPollIntervalMs ?? 2000) / 1000))}
            onChange={(event) =>
              onUpdate({
                services: {
                  ...settings.services,
                  sonarPollIntervalMs: Math.max(1, Math.round(Number(event.currentTarget.value) || 2)) * 1000,
                },
              })
            }
          />
          <span>s</span>
        </div>
      </label>
      <label className="form-row">
        <span>PC USB input</span>
        <select value={settings.pcUsbInput} onChange={(event) => onUpdate({ pcUsbInput: event.currentTarget.value === "2" ? 2 : 1 })}>
          <option value="1">USB Input 1</option>
          <option value="2">USB Input 2</option>
        </select>
      </label>
      <div className="visible-channels">
        <div className="visible-title">Visible Sonar Channels</div>
        <div className="visible-grid">
          {CHANNELS.map((channel) => {
            const enabled = settings.visibleChannels.includes(channel);
            return (
              <label key={channel} className="visible-item">
                <input type="checkbox" checked={enabled} onChange={(event) => onToggleChannel(channel, event.currentTarget.checked)} />
                <span>{channel}</span>
              </label>
            );
          })}
        </div>
      </div>
    </>
  );
}

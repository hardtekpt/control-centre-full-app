import type { ServiceStatus } from "../../stores/store";

interface AboutSettingsTabProps {
  lastStatus: string;
  lastError: string | null;
  serviceStatus: ServiceStatus;
  logs: string[];
}

/**
 * Basic app info, service diagnostics, and runtime logs.
 */
export default function AboutSettingsTab({ lastStatus, lastError, serviceStatus, logs }: AboutSettingsTabProps) {
  const sonarLogs = logs.filter((line) => line.includes("[Sonar GG]"));
  const hidLogs = logs.filter((line) => line.includes("[HID Events]") || line.toLowerCase().includes("base-station"));
  const ddcLogs = logs.filter((line) => line.includes("[DDC]") || line.includes("DDC"));
  const oledServiceLogs = logs.filter((line) => line.includes("[Base Station OLED]"));
  const notificationLogs = logs.filter((line) => line.includes("[Notifications]"));
  const presetLogs = logs.filter((line) => line.includes("[Auto Preset Switcher]") || line.includes("AutomaticPresetSwitcher"));
  const shortcutLogs = logs.filter((line) => line.includes("[Shortcuts]") || line.includes("Shortcut"));

  return (
    <>
      <h3>About</h3>
      <p>Control Centre</p>
      <p>Electron + React flyout dashboard for Arctis Nova + Sonar control.</p>
      <p>Backend bridge status: {lastError ? `Error (${lastError})` : lastStatus}</p>

      <div className="service-status-grid">
        <div className="service-status-card">
          <div className="service-title">Sonar GG API</div>
          <div className={`service-state ${serviceStatus.sonarApi.state}`}>{serviceStatus.sonarApi.state}</div>
          <div className="service-detail">{serviceStatus.sonarApi.detail}</div>
          <div className="service-detail">Endpoint: {serviceStatus.sonarApi.endpoint ?? "n/a"}</div>
          <div className="service-detail">Poll: {Math.round(serviceStatus.sonarApi.pollIntervalMs / 100) / 10}s</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">HID Events</div>
          <div className={`service-state ${serviceStatus.hidEvents.state}`}>{serviceStatus.hidEvents.state}</div>
          <div className="service-detail">{serviceStatus.hidEvents.detail}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">DDC API</div>
          <div className={`service-state ${serviceStatus.ddcApi.state}`}>{serviceStatus.ddcApi.state}</div>
          <div className="service-detail">{serviceStatus.ddcApi.detail}</div>
          <div className="service-detail">Endpoint: {serviceStatus.ddcApi.endpoint}</div>
          <div className="service-detail">Managed: {serviceStatus.ddcApi.managed ? "yes" : "no"}</div>
          <div className="service-detail">PID: {serviceStatus.ddcApi.pid ?? "n/a"}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">Base Station OLED</div>
          <div className={`service-state ${serviceStatus.baseStationOled.state}`}>{serviceStatus.baseStationOled.state}</div>
          <div className="service-detail">{serviceStatus.baseStationOled.detail}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">Notifications</div>
          <div className={`service-state ${serviceStatus.notifications.state}`}>{serviceStatus.notifications.state}</div>
          <div className="service-detail">{serviceStatus.notifications.detail}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">Automatic Preset Switcher</div>
          <div className={`service-state ${serviceStatus.automaticPresetSwitcher.state}`}>{serviceStatus.automaticPresetSwitcher.state}</div>
          <div className="service-detail">{serviceStatus.automaticPresetSwitcher.detail}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">Shortcuts</div>
          <div className={`service-state ${serviceStatus.shortcuts.state}`}>{serviceStatus.shortcuts.state}</div>
          <div className="service-detail">{serviceStatus.shortcuts.detail}</div>
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: Sonar GG API</div>
        <div className="logs-list">
          {sonarLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {sonarLogs.map((line, index) => (
            <div className="log-line" key={`${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: HID Events</div>
        <div className="logs-list">
          {hidLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {hidLogs.map((line, index) => (
            <div className="log-line" key={`hid-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: DDC</div>
        <div className="logs-list">
          {ddcLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {ddcLogs.map((line, index) => (
            <div className="log-line" key={`ddc-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: Base Station OLED</div>
        <div className="logs-list">
          {oledServiceLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {oledServiceLogs.map((line, index) => (
            <div className="log-line" key={`oled-service-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: Notifications</div>
        <div className="logs-list">
          {notificationLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {notificationLogs.map((line, index) => (
            <div className="log-line" key={`notifications-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: Automatic Preset Switcher</div>
        <div className="logs-list">
          {presetLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {presetLogs.map((line, index) => (
            <div className="log-line" key={`preset-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs: Shortcuts</div>
        <div className="logs-list">
          {shortcutLogs.length === 0 && <div className="log-line">No logs yet.</div>}
          {shortcutLogs.map((line, index) => (
            <div className="log-line" key={`shortcuts-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

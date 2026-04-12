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
  return (
    <>
      <h3>About</h3>

      <div className="settings-section">
        <div className="settings-section-title">Control Centre</div>
        <div className="service-detail">Electron + React flyout dashboard for Arctis Nova + Sonar control.</div>
        <div className="service-detail" style={{ marginTop: 4 }}>
          Backend: {lastError ? <span style={{ color: "#ff9b9b" }}>Error — {lastError}</span> : lastStatus}
        </div>
      </div>

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
          <div className="service-detail">Managed: {serviceStatus.ddcApi.managed ? "yes" : "no"} &nbsp;·&nbsp; PID: {serviceStatus.ddcApi.pid ?? "n/a"}</div>
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
          <div className="service-title">Preset Switcher</div>
          <div className={`service-state ${serviceStatus.automaticPresetSwitcher.state}`}>{serviceStatus.automaticPresetSwitcher.state}</div>
          <div className="service-detail">{serviceStatus.automaticPresetSwitcher.detail}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">Shortcuts</div>
          <div className={`service-state ${serviceStatus.shortcuts.state}`}>{serviceStatus.shortcuts.state}</div>
          <div className="service-detail">{serviceStatus.shortcuts.detail}</div>
        </div>
      </div>

      <div className="logs-panel logs-panel--tall">
        <div className="logs-header">Logs</div>
        <div className="logs-list">
          {logs.length === 0 && <div className="log-line">No logs yet.</div>}
          {logs.map((line, index) => (
            <div className="log-line" key={`log-${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

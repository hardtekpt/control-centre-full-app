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
      <p>Control Centre</p>
      <p>Electron + React flyout dashboard for Arctis Nova + Sonar control.</p>
      <p>Backend bridge status: {lastError ? `Error (${lastError})` : lastStatus}</p>

      <div className="service-status-grid">
        <div className="service-status-card">
          <div className="service-title">Arctis API</div>
          <div className={`service-state ${serviceStatus.arctisApi.state}`}>{serviceStatus.arctisApi.state}</div>
          <div className="service-detail">{serviceStatus.arctisApi.detail}</div>
        </div>

        <div className="service-status-card">
          <div className="service-title">DDC API</div>
          <div className={`service-state ${serviceStatus.ddcApi.state}`}>{serviceStatus.ddcApi.state}</div>
          <div className="service-detail">{serviceStatus.ddcApi.detail}</div>
          <div className="service-detail">Endpoint: {serviceStatus.ddcApi.endpoint}</div>
          <div className="service-detail">Managed: {serviceStatus.ddcApi.managed ? "yes" : "no"}</div>
          <div className="service-detail">PID: {serviceStatus.ddcApi.pid ?? "n/a"}</div>
        </div>
      </div>

      <div className="logs-panel">
        <div className="logs-header">Logs</div>
        <div className="logs-list">
          {logs.length === 0 && <div className="log-line">No logs yet.</div>}
          {logs.map((line, index) => (
            <div className="log-line" key={`${index}-${line.slice(0, 12)}`}>
              {line}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

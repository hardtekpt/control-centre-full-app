import type { ServiceStatus } from "../../stores/store";

interface AboutSettingsTabProps {
  lastStatus: string;
  lastError: string | null;
  serviceStatus: ServiceStatus;
  logs: string[];
}

interface ServiceRowProps {
  name: string;
  state: string;
  detail: string;
  meta?: string;
}

function ServiceRow({ name, state, detail, meta }: ServiceRowProps) {
  return (
    <div className="service-row">
      <span className="service-row-name">{name}</span>
      <span className={`service-state ${state}`}>{state}</span>
      <span className="service-row-detail">{detail}</span>
      {meta && <span className="service-row-meta">{meta}</span>}
    </div>
  );
}

/**
 * Basic app info, service diagnostics, and runtime logs.
 */
export default function AboutSettingsTab({ lastStatus, lastError, serviceStatus, logs }: AboutSettingsTabProps) {
  return (
    <>
      <h3>About</h3>

      <div className="settings-section">
        <div className="settings-section-title">Services</div>
        <div className="service-list">
          <ServiceRow
            name="Sonar GG API"
            state={serviceStatus.sonarApi.state}
            detail={serviceStatus.sonarApi.detail}
            meta={`${serviceStatus.sonarApi.endpoint ?? "n/a"} · ${Math.round(serviceStatus.sonarApi.pollIntervalMs / 100) / 10}s`}
          />
          <ServiceRow
            name="HID Events"
            state={serviceStatus.hidEvents.state}
            detail={serviceStatus.hidEvents.detail}
          />
          <ServiceRow
            name="DDC API"
            state={serviceStatus.ddcApi.state}
            detail={serviceStatus.ddcApi.detail}
            meta={`${serviceStatus.ddcApi.endpoint ?? "n/a"} · PID ${serviceStatus.ddcApi.pid ?? "n/a"}`}
          />
          <ServiceRow
            name="Base Station OLED"
            state={serviceStatus.baseStationOled.state}
            detail={serviceStatus.baseStationOled.detail}
          />
          <ServiceRow
            name="OLED Notifications"
            state={serviceStatus.oledNotifications.state}
            detail={serviceStatus.oledNotifications.detail}
          />
          <ServiceRow
            name="Notifications"
            state={serviceStatus.notifications.state}
            detail={serviceStatus.notifications.detail}
          />
          <ServiceRow
            name="Preset Switcher"
            state={serviceStatus.automaticPresetSwitcher.state}
            detail={serviceStatus.automaticPresetSwitcher.detail}
          />
          <ServiceRow
            name="Shortcuts"
            state={serviceStatus.shortcuts.state}
            detail={serviceStatus.shortcuts.detail}
          />
          <ServiceRow
            name="Discord RPC"
            state={serviceStatus.discordRpc.state}
            detail={serviceStatus.discordRpc.detail}
            meta={serviceStatus.discordRpc.channelName ? `Channel: ${serviceStatus.discordRpc.channelName}` : undefined}
          />
        </div>
        <div className="service-row-backend">
          Backend: {lastError ? <span className="error-text">Error — {lastError}</span> : lastStatus}
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

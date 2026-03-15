import BrightnessIcon from "../icons/BrightnessIcon";

interface MonitorDisconnectedRowProps {
  monitorLabel: string;
}

/**
 * Read-only row shown when a configured monitor is not currently connected.
 */
export default function MonitorDisconnectedRow({ monitorLabel }: MonitorDisconnectedRowProps) {
  return (
    <div className="monitor-inline-row monitor-inline-row-disconnected">
      <div className="monitor-inline-name" title={monitorLabel}>
        {monitorLabel}
      </div>
      <span className="monitor-inline-icon" title="Monitor disconnected">
        <BrightnessIcon />
      </span>
      <div className="monitor-inline-disconnected-text">Disconnected</div>
      <button className="button monitor-input-icon-btn" disabled title="Monitor disconnected">
        <span className="monitor-input-index">-</span>
      </button>
    </div>
  );
}

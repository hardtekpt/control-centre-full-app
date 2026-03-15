import BatteryTypeIcon from "./icons/BatteryTypeIcon";

interface BatteryBadgeProps {
  kind: "headset" | "charging";
  percent: number;
  showPercent: boolean;
}

/**
 * Segmented battery badge used in the app title bar.
 */
export default function BatteryBadge({ kind, percent, showPercent }: BatteryBadgeProps) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className="battery-icon-row topbar-battery-row" title={`${kind} battery ${percent}%`}>
      <span className="status-icon topbar-battery-label">
        <BatteryTypeIcon kind={kind} />
      </span>
      <div className="battery-icon topbar-battery">
        <div className="battery-bars">
          {[0, 1, 2, 3].map((index) => {
            const segmentFill = Math.max(0, Math.min(1, (clamped - index * 25) / 25));
            return <span key={index} className={segmentFill > 0 ? "on" : ""} style={{ opacity: segmentFill > 0 ? 0.25 + segmentFill * 0.75 : 0.12 }} />;
          })}
        </div>
        <div className="battery-tip" />
      </div>
      {showPercent && <span className="topbar-battery-percent">{percent}%</span>}
    </div>
  );
}

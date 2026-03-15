interface BatteryTypeIconProps {
  kind: "headset" | "charging";
}

/**
 * Small icon variant for headset and base-station battery indicators.
 */
export default function BatteryTypeIcon({ kind }: BatteryTypeIconProps) {
  if (kind === "headset") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M13 2 6 13h5l-1 9 8-12h-5z" fill="currentColor" />
    </svg>
  );
}

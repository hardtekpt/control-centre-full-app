import { useMemo } from "react";
import type { UiSettings } from "@shared/types";
import type { DdcMonitor } from "../stores/store";
import MonitorDisconnectedRow from "./monitor/MonitorDisconnectedRow";
import MonitorInlineControl from "./monitor/MonitorInlineControl";

interface MonitorControlsCardProps {
  ddcMonitors: DdcMonitor[];
  ddcSettings: UiSettings["ddc"];
  onSetBrightness: (monitorId: number, value: number) => void;
  onSetInputSource: (monitorId: number, value: string) => void;
}

interface MonitorSlot {
  key: string;
  monitor: DdcMonitor | null;
  monitorLabel: string;
  inputSet: "primary" | "secondary";
}

/**
 * Converts settings monitor id into a valid positive integer or null.
 */
function normalizeMonitorId(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

/**
 * Resolves monitor display label using configured alias when available.
 */
function monitorDisplayName(monitor: DdcMonitor, prefs: UiSettings["ddc"]["monitorPrefs"]): string {
  const alias = String(prefs[String(monitor.monitor_id)]?.alias ?? "").trim();
  return alias || monitor.name;
}

/**
 * Displays quick DDC controls for up to two configured dashboard monitors.
 */
export default function MonitorControlsCard({ ddcMonitors, ddcSettings, onSetBrightness, onSetInputSource }: MonitorControlsCardProps) {
  const monitorSlots = useMemo(() => {
    const slots: MonitorSlot[] = [];
    const seen = new Set<number>();
    const monitorById = new Map(ddcMonitors.map((item) => [item.monitor_id, item] as const));
    const configuredPrimaryId = normalizeMonitorId(ddcSettings.dashboardMonitorId);
    const configuredSecondaryId = normalizeMonitorId(ddcSettings.dashboardSecondaryMonitorId);

    const pushConfigured = (id: number | null, inputSet: "primary" | "secondary", key: string) => {
      if (!id || seen.has(id)) {
        return;
      }
      const monitor = monitorById.get(id) ?? null;
      if (monitor) {
        seen.add(id);
      }
      const alias = String(ddcSettings.monitorPrefs[String(id)]?.alias ?? "").trim();
      const monitorLabel = alias || monitor?.name || `Monitor ${id}`;
      slots.push({ key, monitor, monitorLabel, inputSet });
    };

    pushConfigured(configuredPrimaryId, "primary", "primary");
    if (configuredSecondaryId && configuredSecondaryId !== configuredPrimaryId) {
      pushConfigured(configuredSecondaryId, "secondary", "secondary");
    }

    for (const monitor of ddcMonitors) {
      if (slots.length >= 2) {
        break;
      }
      if (seen.has(monitor.monitor_id)) {
        continue;
      }
      seen.add(monitor.monitor_id);
      slots.push({
        key: `monitor-${monitor.monitor_id}`,
        monitor,
        monitorLabel: monitorDisplayName(monitor, ddcSettings.monitorPrefs),
        inputSet: slots.length === 0 ? "primary" : "secondary",
      });
    }
    return slots.slice(0, 2);
  }, [ddcMonitors, ddcSettings.dashboardMonitorId, ddcSettings.dashboardSecondaryMonitorId, ddcSettings.monitorPrefs]);

  const primaryInputA = ddcSettings.dashboardPrimaryInputA.trim() || ddcSettings.dashboardInputA.trim();
  const primaryInputB = ddcSettings.dashboardPrimaryInputB.trim() || ddcSettings.dashboardInputB.trim();
  const secondaryInputA = ddcSettings.dashboardSecondaryInputA.trim() || primaryInputA;
  const secondaryInputB = ddcSettings.dashboardSecondaryInputB.trim() || primaryInputB;
  const inputNameMap = ddcSettings.inputNameMap ?? {};

  return (
    <section className="card monitor-card">
      <div className="monitor-card-title-row">
        <div className="status-block-title monitor-card-title">Monitor Controls</div>
      </div>
      {monitorSlots.length === 0 && <div className="monitor-empty">No monitor detected</div>}
      {monitorSlots.map((slot) =>
        slot.monitor ? (
          <MonitorInlineControl
            key={slot.key}
            monitor={slot.monitor}
            monitorLabel={slot.monitorLabel}
            configuredInputA={slot.inputSet === "primary" ? primaryInputA : secondaryInputA}
            configuredInputB={slot.inputSet === "primary" ? primaryInputB : secondaryInputB}
            inputNameMap={inputNameMap}
            onSetBrightness={onSetBrightness}
            onSetInputSource={onSetInputSource}
          />
        ) : (
          <MonitorDisconnectedRow key={slot.key} monitorLabel={slot.monitorLabel} />
        ),
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { UiSettings } from "@shared/types";
import type { DdcMonitor } from "../stores/store";

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

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function inputTokens(value: string | null | undefined): string[] {
  const raw = normalizeText(value);
  if (!raw) {
    return [];
  }
  const compact = raw.replace(/[\s_]+/g, "");
  const tokens = new Set<string>([raw, compact]);
  const hexPrefixed = compact.match(/^0x([0-9a-f]+)$/);
  if (hexPrefixed) {
    const hex = hexPrefixed[1].replace(/^0+/, "") || "0";
    tokens.add(`hex:${hex}`);
    tokens.add(`num:${parseInt(hex, 16)}`);
  }
  if (/^[0-9a-f]+$/.test(compact)) {
    const hex = compact.replace(/^0+/, "") || "0";
    tokens.add(`hex:${hex}`);
    tokens.add(`num:${parseInt(hex, 16)}`);
  }
  if (/^\d+$/.test(compact)) {
    tokens.add(`num:${parseInt(compact, 10)}`);
  }
  return [...tokens];
}

function sameInputSource(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = inputTokens(a);
  const tb = new Set(inputTokens(b));
  if (ta.length === 0 || tb.size === 0) {
    return false;
  }
  return ta.some((token) => tb.has(token));
}

function normalizeMonitorId(value: number | null | undefined): number | null {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

function resolveInputName(inputCode: string, inputNameMap: Record<string, string>): string {
  const target = normalizeText(inputCode);
  if (!target) {
    return "";
  }
  for (const [key, value] of Object.entries(inputNameMap ?? {})) {
    if (normalizeText(key) === target) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function monitorDisplayName(monitor: DdcMonitor, prefs: UiSettings["ddc"]["monitorPrefs"]): string {
  const alias = String(prefs[String(monitor.monitor_id)]?.alias ?? "").trim();
  return alias || monitor.name;
}

function BrightnessIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <path
        d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.9 1.9M17.5 17.5l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.6 19.4l1.9-1.9M17.5 6.5l1.9-1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MonitorDisconnectedRow({ monitorLabel }: { monitorLabel: string }) {
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

function MonitorInlineControl({
  monitor,
  monitorLabel,
  configuredInputA,
  configuredInputB,
  inputNameMap,
  onSetBrightness,
  onSetInputSource,
}: {
  monitor: DdcMonitor;
  monitorLabel: string;
  configuredInputA: string;
  configuredInputB: string;
  inputNameMap: Record<string, string>;
  onSetBrightness: (monitorId: number, value: number) => void;
  onSetInputSource: (monitorId: number, value: string) => void;
}) {
  const [draftBrightness, setDraftBrightness] = useState(monitor.brightness ?? 50);
  const [pendingInputSource, setPendingInputSource] = useState<string | null>(null);

  useEffect(() => {
    setDraftBrightness(monitor.brightness ?? 50);
  }, [monitor.monitor_id, monitor.brightness]);
  useEffect(() => {
    setPendingInputSource(null);
  }, [monitor.monitor_id]);

  const availableInputs = monitor.available_inputs ?? [];
  const inputA = configuredInputA || availableInputs[0] || "";
  const inputBBase = configuredInputB || availableInputs[1] || availableInputs[0] || "";
  const inputB =
    normalizeText(inputBBase) === normalizeText(inputA) && availableInputs.length > 1 ? availableInputs[1] : inputBBase;
  const currentInput = monitor.input_source ?? "";
  const currentMatchesA = sameInputSource(currentInput, inputA);
  const currentMatchesB = sameInputSource(currentInput, inputB);
  const pendingMatchesA = sameInputSource(pendingInputSource, inputA);
  const pendingMatchesB = sameInputSource(pendingInputSource, inputB);
  const activeInputIndex = currentMatchesA ? 1 : currentMatchesB ? 2 : pendingMatchesA ? 1 : pendingMatchesB ? 2 : 0;
  const toggleTarget = activeInputIndex === 1 ? inputB : inputA;
  const canToggleInput = Boolean(inputA && inputB && normalizeText(inputA) !== normalizeText(inputB));

  useEffect(() => {
    if (!pendingInputSource) {
      return;
    }
    if (sameInputSource(currentInput, pendingInputSource)) {
      setPendingInputSource(null);
    }
  }, [currentInput, pendingInputSource]);

  const formatInputLabel = (value: string): string => {
    const code = String(value ?? "").trim();
    if (!code) {
      return "--";
    }
    const custom = resolveInputName(code, inputNameMap);
    return custom ? `${custom} (${code})` : code;
  };

  const commitBrightness = () => {
    const next = Math.max(0, Math.min(100, Math.round(draftBrightness)));
    if (monitor.brightness === next) {
      return;
    }
    void onSetBrightness(monitor.monitor_id, next);
  };

  const toggleInput = () => {
    if (!canToggleInput || !toggleTarget) {
      return;
    }
    setPendingInputSource(toggleTarget);
    void onSetInputSource(monitor.monitor_id, toggleTarget);
  };

  const title = canToggleInput
    ? `Current: ${formatInputLabel(monitor.input_source ?? "")} | Switch to: ${formatInputLabel(toggleTarget)}`
    : "Configure input A/B in DDC settings";

  return (
    <div className="monitor-inline-row">
      <div className="monitor-inline-name" title={monitorLabel}>
        {monitorLabel}
      </div>
      <span className="monitor-inline-icon" title={`Brightness ${monitor.brightness ?? "--"}%`}>
        <BrightnessIcon />
      </span>
      <div className="horizontal-slider-wrap monitor-slider">
        <div className="horizontal-track">
          <div className="horizontal-progress" style={{ width: `${Math.max(0, Math.min(100, draftBrightness))}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.max(0, Math.min(100, draftBrightness))}
          onChange={(e) => setDraftBrightness(Number(e.currentTarget.value))}
          onMouseUp={commitBrightness}
          onTouchEnd={commitBrightness}
          onKeyUp={commitBrightness}
          className="horizontal-range"
        />
      </div>
      <button className="button monitor-input-icon-btn" onClick={toggleInput} disabled={!canToggleInput} title={title}>
        <span className="monitor-input-index">{activeInputIndex > 0 ? String(activeInputIndex) : "-"}</span>
      </button>
    </div>
  );
}

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

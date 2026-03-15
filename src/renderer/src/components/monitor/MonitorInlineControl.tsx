import { useEffect, useState } from "react";
import type { DdcMonitor } from "../../stores/store";
import BrightnessIcon from "../icons/BrightnessIcon";
import { resolveInputName, sameInputSource } from "./monitorHelpers";

interface MonitorInlineControlProps {
  monitor: DdcMonitor;
  monitorLabel: string;
  configuredInputA: string;
  configuredInputB: string;
  inputNameMap: Record<string, string>;
  onSetBrightness: (monitorId: number, value: number) => void;
  onSetInputSource: (monitorId: number, value: string) => void;
}

/**
 * Interactive brightness and input-toggle controls for a single monitor.
 */
export default function MonitorInlineControl({
  monitor,
  monitorLabel,
  configuredInputA,
  configuredInputB,
  inputNameMap,
  onSetBrightness,
  onSetInputSource,
}: MonitorInlineControlProps) {
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
  const inputB = inputBBase.toLowerCase().trim() === inputA.toLowerCase().trim() && availableInputs.length > 1 ? availableInputs[1] : inputBBase;

  const currentInput = monitor.input_source ?? "";
  const currentMatchesA = sameInputSource(currentInput, inputA);
  const currentMatchesB = sameInputSource(currentInput, inputB);
  const pendingMatchesA = sameInputSource(pendingInputSource, inputA);
  const pendingMatchesB = sameInputSource(pendingInputSource, inputB);
  const activeInputIndex = currentMatchesA ? 1 : currentMatchesB ? 2 : pendingMatchesA ? 1 : pendingMatchesB ? 2 : 0;
  const toggleTarget = activeInputIndex === 1 ? inputB : inputA;
  const canToggleInput = Boolean(inputA && inputB && inputA.toLowerCase().trim() !== inputB.toLowerCase().trim());

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
          onChange={(event) => setDraftBrightness(Number(event.currentTarget.value))}
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

import { useEffect, useRef, useState } from "react";
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
 *
 * Brightness UI is decoupled from the DDC write lifecycle:
 *  - Dragging: slider turns dimmer immediately so the user knows a write is pending.
 *  - Write in-flight: colour stays dim until the command returns.
 *  - After write: draft is re-synced to the confirmed hardware value and colour restores.
 *  - Background polls never overwrite the draft while dragging or writing.
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
  /** True while the user is dragging the slider OR while a DDC write is in-flight. */
  const [isActive, setIsActive] = useState(false);

  /**
   * Refs used inside async callbacks so closures always see the latest values
   * without creating extra effect dependencies.
   */
  const isDraggingRef = useRef(false);
  const isWritingRef = useRef(false);
  /** Always tracks the latest draft so onMouseUp captures the correct value. */
  const draftBrightnessRef = useRef(monitor.brightness ?? 50);
  /** Kept in sync with the monitor prop for use inside async write callbacks. */
  const latestMonitorBrightness = useRef(monitor.brightness ?? 50);

  /** Keep latestMonitorBrightness current so async callbacks can read confirmed values. */
  useEffect(() => {
    latestMonitorBrightness.current = monitor.brightness ?? 50;
  }, [monitor.brightness]);

  /** Reset all transient state when the user switches to a different monitor. */
  useEffect(() => {
    isDraggingRef.current = false;
    isWritingRef.current = false;
    setIsActive(false);
  }, [monitor.monitor_id]);

  /**
   * Sync the draft from props only when the slider is completely idle.
   * This prevents background polls from jumping the slider mid-drag or
   * mid-write.
   */
  useEffect(() => {
    if (!isDraggingRef.current && !isWritingRef.current) {
      const b = monitor.brightness ?? 50;
      draftBrightnessRef.current = b;
      setDraftBrightness(b);
    }
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

  const onRangeChange = (value: number) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    draftBrightnessRef.current = next;
    setDraftBrightness(next);
  };

  /** Called on pointerdown / keydown — marks the slider as actively being moved. */
  const onSliderInteractStart = () => {
    isDraggingRef.current = true;
    setIsActive(true);
  };

  /**
   * Fires the DDC write with the final draft value, then re-syncs to the
   * confirmed hardware brightness and restores the slider colour.
   * Safe to call while a previous write is still in-flight: the new value
   * overwrites the pending one and the previous write's finally-block is a
   * no-op because `isDraggingRef` will still be false after this call.
   */
  const fireWrite = (value: number) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    isWritingRef.current = true;
    // Advance the confirmed ref optimistically so the finally block restores
    // to the newly-written value rather than stale hardware state.
    latestMonitorBrightness.current = next;
    try {
      onSetBrightness(monitor.monitor_id, next);
    } finally {
      isWritingRef.current = false;
      // Only restore UI if the user hasn't started a new drag
      if (!isDraggingRef.current) {
        const confirmed = latestMonitorBrightness.current;
        draftBrightnessRef.current = confirmed;
        setDraftBrightness(confirmed);
        setIsActive(false);
      }
    }
  };

  /** Called on mouseup / touchend / keyup — ends drag and commits the value. */
  const commitBrightness = () => {
    isDraggingRef.current = false;
    fireWrite(draftBrightnessRef.current);
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
      <div className={`horizontal-slider-wrap monitor-slider${isActive ? " is-active" : ""}`}>
        <div className="horizontal-track">
          <div className="horizontal-progress" style={{ width: `${Math.max(0, Math.min(100, draftBrightness))}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.max(0, Math.min(100, draftBrightness))}
          onChange={(event) => onRangeChange(Number(event.currentTarget.value))}
          onPointerDown={onSliderInteractStart}
          onKeyDown={onSliderInteractStart}
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

import type { UiSettings } from "@shared/types";
import type { DdcMonitor } from "../../stores/store";

interface DdcSettingsTabProps {
  settings: UiSettings;
  ddcMonitors: DdcMonitor[];
  ddcMonitorsUpdatedAt: number | null;
  ddcError: string | null;
  dashboardMonitorId: number | null;
  dashboardSecondaryMonitorId: number | null;
  knownInputCodes: string[];
  primaryInputOptions: string[];
  secondaryInputOptions: string[];
  onUpdate: (partial: Partial<UiSettings>) => void;
  onRefreshDdcMonitors: () => void;
  monitorDisplayName: (monitor: DdcMonitor) => string;
  monitorAliasValue: (monitorId: number | null) => string;
  setMonitorAlias: (monitorId: number | null, alias: string) => void;
  selectedPrimaryMonitor: DdcMonitor | null;
  selectedSecondaryMonitor: DdcMonitor | null;
  inputLabel: (inputCode: string) => string;
  resolveInputName: (inputCode: string) => string;
  setInputName: (inputCode: string, value: string) => void;
}

/**
 * DDC monitor settings and raw monitor payload view.
 */
export default function DdcSettingsTab({
  settings,
  ddcMonitors,
  ddcMonitorsUpdatedAt,
  ddcError,
  dashboardMonitorId,
  dashboardSecondaryMonitorId,
  knownInputCodes,
  primaryInputOptions,
  secondaryInputOptions,
  onUpdate,
  onRefreshDdcMonitors,
  monitorDisplayName,
  monitorAliasValue,
  setMonitorAlias,
  selectedPrimaryMonitor,
  selectedSecondaryMonitor,
  inputLabel,
  resolveInputName,
  setInputName,
}: DdcSettingsTabProps) {
  return (
    <>
      <h3>DDC Monitor Data</h3>
      <label className="form-row">
        <span>DDC poll interval (minutes)</span>
        <div className="accent-row">
          <input
            className="text-input"
            type="number"
            min={1}
            max={30}
            step={1}
            value={Math.max(1, Math.round(settings.ddc.pollIntervalMs / 60000))}
            onChange={(event) =>
              onUpdate({
                ddc: {
                  ...settings.ddc,
                  pollIntervalMs: Math.max(1, Math.round(Number(event.currentTarget.value) || 5)) * 60_000,
                },
              })
            }
          />
          <span>min</span>
        </div>
      </label>

      <label className="form-row">
        <span>Refresh monitors when stale (minutes)</span>
        <div className="accent-row">
          <input
            className="text-input"
            type="number"
            min={1}
            max={60}
            step={1}
            value={Math.max(1, Math.round((settings.ddc.openStaleThresholdMs ?? 60_000) / 60_000))}
            onChange={(event) =>
              onUpdate({
                ddc: {
                  ...settings.ddc,
                  openStaleThresholdMs: Math.max(1, Math.round(Number(event.currentTarget.value) || 1)) * 60_000,
                },
              })
            }
          />
          <span>min</span>
        </div>
      </label>

      <label className="form-row">
        <span>Dashboard monitor</span>
        <select
          value={dashboardMonitorId ?? ""}
          onChange={(event) =>
            onUpdate({
              ddc: {
                ...settings.ddc,
                dashboardMonitorId: Number(event.currentTarget.value) || null,
              },
            })
          }
        >
          <option value="">Auto (first monitor)</option>
          {ddcMonitors.map((item) => (
            <option key={item.monitor_id} value={item.monitor_id}>
              {monitorDisplayName(item)}
            </option>
          ))}
        </select>
      </label>

      <label className="form-row">
        <span>Primary monitor name</span>
        <input
          className="text-input"
          value={monitorAliasValue(selectedPrimaryMonitor?.monitor_id ?? null)}
          onChange={(event) => setMonitorAlias(selectedPrimaryMonitor?.monitor_id ?? null, event.currentTarget.value)}
          placeholder={selectedPrimaryMonitor?.name ?? "Primary monitor"}
        />
      </label>

      <label className="form-row">
        <span>Dashboard monitor (secondary)</span>
        <select
          value={dashboardSecondaryMonitorId ?? ""}
          onChange={(event) =>
            onUpdate({
              ddc: {
                ...settings.ddc,
                dashboardSecondaryMonitorId: Number(event.currentTarget.value) || null,
              },
            })
          }
        >
          <option value="">Auto (second monitor)</option>
          {ddcMonitors.map((item) => (
            <option key={`secondary-${item.monitor_id}`} value={item.monitor_id}>
              {monitorDisplayName(item)}
            </option>
          ))}
        </select>
      </label>

      <label className="form-row">
        <span>Secondary monitor name</span>
        <input
          className="text-input"
          value={monitorAliasValue(selectedSecondaryMonitor?.monitor_id ?? null)}
          onChange={(event) => setMonitorAlias(selectedSecondaryMonitor?.monitor_id ?? null, event.currentTarget.value)}
          placeholder={selectedSecondaryMonitor?.name ?? "Secondary monitor"}
        />
      </label>

      <label className="form-row">
        <span>Primary input toggle A</span>
        <select
          value={settings.ddc.dashboardPrimaryInputA}
          onChange={(event) =>
            onUpdate({
              ddc: {
                ...settings.ddc,
                dashboardPrimaryInputA: event.currentTarget.value,
              },
            })
          }
        >
          <option value="">Auto (first input)</option>
          {primaryInputOptions.map((input) => (
            <option key={`ddc-a-${input}`} value={input}>
              {inputLabel(input)}
            </option>
          ))}
        </select>
      </label>

      <label className="form-row">
        <span>Primary input toggle B</span>
        <select
          value={settings.ddc.dashboardPrimaryInputB}
          onChange={(event) =>
            onUpdate({
              ddc: {
                ...settings.ddc,
                dashboardPrimaryInputB: event.currentTarget.value,
              },
            })
          }
        >
          <option value="">Auto (second input)</option>
          {primaryInputOptions.map((input) => (
            <option key={`ddc-b-${input}`} value={input}>
              {inputLabel(input)}
            </option>
          ))}
        </select>
      </label>

      <label className="form-row">
        <span>Secondary input toggle A</span>
        <select
          value={settings.ddc.dashboardSecondaryInputA}
          onChange={(event) =>
            onUpdate({
              ddc: {
                ...settings.ddc,
                dashboardSecondaryInputA: event.currentTarget.value,
              },
            })
          }
        >
          <option value="">Auto (first input)</option>
          {secondaryInputOptions.map((input) => (
            <option key={`ddc-secondary-a-${input}`} value={input}>
              {inputLabel(input)}
            </option>
          ))}
        </select>
      </label>

      <label className="form-row">
        <span>Secondary input toggle B</span>
        <select
          value={settings.ddc.dashboardSecondaryInputB}
          onChange={(event) =>
            onUpdate({
              ddc: {
                ...settings.ddc,
                dashboardSecondaryInputB: event.currentTarget.value,
              },
            })
          }
        >
          <option value="">Auto (second input)</option>
          {secondaryInputOptions.map((input) => (
            <option key={`ddc-secondary-b-${input}`} value={input}>
              {inputLabel(input)}
            </option>
          ))}
        </select>
      </label>

      <div className="visible-channels">
        <div className="visible-title">Input names by hex code</div>
        <div className="visible-grid">
          {knownInputCodes.map((inputCode) => (
            <label key={`input-name-${inputCode}`} className="form-row">
              <span>{inputCode}</span>
              <input className="text-input" value={resolveInputName(inputCode)} onChange={(event) => setInputName(inputCode, event.currentTarget.value)} placeholder="Custom input name" />
            </label>
          ))}
          {knownInputCodes.length === 0 && <div className="hint">No monitor input codes available yet.</div>}
        </div>
      </div>

      <div className="ddc-json-meta">
        <span>Last updated:</span>
        <span>{ddcMonitorsUpdatedAt ? new Date(ddcMonitorsUpdatedAt).toLocaleString() : "Never"}</span>
        <button className="button" onClick={onRefreshDdcMonitors}>
          Refresh
        </button>
      </div>
      {ddcError && <p className="hint error-text">{ddcError}</p>}
      <div className="ddc-json-wrap">
        <pre className="ddc-json">{JSON.stringify(ddcMonitors, null, 2)}</pre>
      </div>
    </>
  );
}

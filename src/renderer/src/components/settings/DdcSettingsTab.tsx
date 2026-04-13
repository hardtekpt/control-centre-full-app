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
      <h3>DDC Monitor Settings</h3>

      <div className="settings-section">
        <div className="settings-section-title">Polling</div>
        <div className="ddc-polling-inline">
          <label
            className="ddc-polling-field"
            title="How often DDC queries the monitors for their current state"
          >
            <span>Poll interval</span>
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
          </label>
          <span className="ddc-polling-sep">·</span>
          <label
            className="ddc-polling-field"
            title="If the settings window is opened and monitor data is older than this, a fresh poll is triggered automatically"
          >
            <span>Refresh when stale</span>
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
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Primary Monitor</div>
        <div
          className="ddc-monitor-row"
          title="Select the primary monitor and optionally set a custom display name"
        >
          <select
            title="Physical monitor used as the primary dashboard monitor"
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
          <input
            className="text-input"
            title="Custom label shown for this monitor in the dashboard"
            value={monitorAliasValue(selectedPrimaryMonitor?.monitor_id ?? null)}
            onChange={(event) => setMonitorAlias(selectedPrimaryMonitor?.monitor_id ?? null, event.currentTarget.value)}
            placeholder={selectedPrimaryMonitor?.name ?? "Display name…"}
          />
        </div>
        <div className="ddc-input-pair">
          <label className="ddc-input-pair-item" title="First input source assigned to the primary monitor toggle button">
            <span>A</span>
            <select
              value={settings.ddc.dashboardPrimaryInputA}
              onChange={(event) =>
                onUpdate({
                  ddc: { ...settings.ddc, dashboardPrimaryInputA: event.currentTarget.value },
                })
              }
            >
              <option value="">Auto (first)</option>
              {primaryInputOptions.map((input) => (
                <option key={`ddc-a-${input}`} value={input}>
                  {inputLabel(input)}
                </option>
              ))}
            </select>
          </label>
          <label className="ddc-input-pair-item" title="Second input source assigned to the primary monitor toggle button">
            <span>B</span>
            <select
              value={settings.ddc.dashboardPrimaryInputB}
              onChange={(event) =>
                onUpdate({
                  ddc: { ...settings.ddc, dashboardPrimaryInputB: event.currentTarget.value },
                })
              }
            >
              <option value="">Auto (second)</option>
              {primaryInputOptions.map((input) => (
                <option key={`ddc-b-${input}`} value={input}>
                  {inputLabel(input)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Secondary Monitor</div>
        <div
          className="ddc-monitor-row"
          title="Select the secondary monitor and optionally set a custom display name"
        >
          <select
            title="Physical monitor used as the secondary dashboard monitor"
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
          <input
            className="text-input"
            title="Custom label shown for this monitor in the dashboard"
            value={monitorAliasValue(selectedSecondaryMonitor?.monitor_id ?? null)}
            onChange={(event) => setMonitorAlias(selectedSecondaryMonitor?.monitor_id ?? null, event.currentTarget.value)}
            placeholder={selectedSecondaryMonitor?.name ?? "Display name…"}
          />
        </div>
        <div className="ddc-input-pair">
          <label className="ddc-input-pair-item" title="First input source assigned to the secondary monitor toggle button">
            <span>A</span>
            <select
              value={settings.ddc.dashboardSecondaryInputA}
              onChange={(event) =>
                onUpdate({
                  ddc: { ...settings.ddc, dashboardSecondaryInputA: event.currentTarget.value },
                })
              }
            >
              <option value="">Auto (first)</option>
              {secondaryInputOptions.map((input) => (
                <option key={`ddc-secondary-a-${input}`} value={input}>
                  {inputLabel(input)}
                </option>
              ))}
            </select>
          </label>
          <label className="ddc-input-pair-item" title="Second input source assigned to the secondary monitor toggle button">
            <span>B</span>
            <select
              value={settings.ddc.dashboardSecondaryInputB}
              onChange={(event) =>
                onUpdate({
                  ddc: { ...settings.ddc, dashboardSecondaryInputB: event.currentTarget.value },
                })
              }
            >
              <option value="">Auto (second)</option>
              {secondaryInputOptions.map((input) => (
                <option key={`ddc-secondary-b-${input}`} value={input}>
                  {inputLabel(input)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {knownInputCodes.length > 0 && (
        <div className="settings-section">
          <div className="settings-section-title">Input Labels</div>
          <div className="ddc-input-labels">
            {knownInputCodes.map((inputCode) => (
              <label
                key={`input-name-${inputCode}`}
                className="ddc-input-label-item"
                title={`Custom display name for input source ${inputCode}`}
              >
                <span>{inputCode}</span>
                <input
                  className="text-input"
                  value={resolveInputName(inputCode)}
                  onChange={(event) => setInputName(inputCode, event.currentTarget.value)}
                  placeholder="Name…"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="settings-section">
        <div className="settings-section-title">Monitor Data</div>
        <div className="ddc-json-meta">
          <span>Last updated:</span>
          <span>{ddcMonitorsUpdatedAt ? new Date(ddcMonitorsUpdatedAt).toLocaleString() : "Never"}</span>
          <button className="button" onClick={onRefreshDdcMonitors} title="Force an immediate DDC poll of all connected monitors">
            Refresh
          </button>
        </div>
        {ddcError && <p className="hint error-text">{ddcError}</p>}
        <div className="ddc-json-wrap">
          <pre className="ddc-json">{JSON.stringify(ddcMonitors, null, 2)}</pre>
        </div>
      </div>
    </>
  );
}

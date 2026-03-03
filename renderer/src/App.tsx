import { useMemo } from "react";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import { useBridgeState } from "./state/store";
import { DEFAULT_SETTINGS } from "@shared/settings";

function BatteryTypeIcon({ kind }: { kind: "headset" | "charging" }) {
  if (kind === "headset") {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path
          d="M4 13a8 8 0 1 1 16 0v5a2 2 0 0 1-2 2h-1v-6h1v-1a6 6 0 1 0-12 0v1h1v6H6a2 2 0 0 1-2-2z"
          fill="currentColor"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M13 2 6 13h5l-1 9 8-12h-5z" fill="currentColor" />
    </svg>
  );
}

function BatteryBadge({ kind, percent, showPercent }: { kind: "headset" | "charging"; percent: number; showPercent: boolean }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="battery-icon-row topbar-battery-row" title={`${kind} battery ${percent}%`}>
      <span className="status-icon topbar-battery-label">
        <BatteryTypeIcon kind={kind} />
      </span>
      <div className="battery-icon topbar-battery">
        <div className="battery-bars">
          {[0, 1, 2, 3].map((idx) => {
            const segmentFill = Math.max(0, Math.min(1, (clamped - idx * 25) / 25));
            return (
              <span
                key={idx}
                className={segmentFill > 0 ? "on" : ""}
                style={{ opacity: segmentFill > 0 ? 0.25 + segmentFill * 0.75 : 0.12 }}
              />
            );
          })}
        </div>
        <div className="battery-tip" />
      </div>
      {showPercent && <span className="topbar-battery-percent">{percent}%</span>}
    </div>
  );
}

function SteelSeriesIcon() {
  return (
    <span className="gg-mark" aria-hidden="true">
      GG
    </span>
  );
}

export default function App() {
  const windowMode = useMemo(() => {
    const mode = new URLSearchParams(window.location.search).get("window");
    if (mode === "settings") {
      return mode;
    }
    return "dashboard";
  }, []);

  return <LiveApp windowMode={windowMode} />;
}

function LiveApp({ windowMode }: { windowMode: "dashboard" | "settings" }) {
  const { state, presets, settings, status, error, logs, mixerData, ddcMonitors, ddcMonitorsUpdatedAt, ddcError, flyoutPinned, serviceStatus, actions } =
    useBridgeState();
  const resolvedSettings = settings ?? DEFAULT_SETTINGS;
  const visibleChannels = settings?.visibleChannels ?? [];

  if (windowMode === "settings") {
    return (
      <main className="window-base app-shell standalone-page">
        <SettingsPage
          settings={resolvedSettings}
          ddcMonitors={ddcMonitors}
          ddcMonitorsUpdatedAt={ddcMonitorsUpdatedAt}
          ddcError={ddcError}
          logs={logs}
          lastStatus={status}
          lastError={error}
          serviceStatus={serviceStatus}
          initialTab="app"
          onUpdate={(partial) => void actions.persistSettings(partial)}
          onRefreshDdcMonitors={() => void actions.refreshDdcMonitors()}
          onTestNotification={() => void actions.notifyCustom("Control Centre", "Test notification from settings")}
          onTestLowBatteryNotification={() => void actions.notifyBatteryLowTest()}
          onTestBatterySwapNotification={() => void actions.notifyBatterySwapTest()}
        />
        <div className="standalone-actions">
          <button className="button" onClick={() => actions.closeCurrentWindow()}>
            Close
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="window-base app-shell">
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="conn-row title-conn">
            <div className={`conn-badge ${state.connected === true ? "on" : state.connected === false ? "off" : "na"}`} title="Connected">
              <span className="status-icon">{"\uE839"}</span>
            </div>
            <div className={`conn-badge ${state.wireless === true ? "on" : state.wireless === false ? "off" : "na"}`} title="Wireless">
              <span className="status-icon">{"\uE701"}</span>
            </div>
            <div className={`conn-badge ${state.bluetooth === true ? "on" : state.bluetooth === false ? "off" : "na"}`} title="Bluetooth">
              <span className="status-icon">{"\uE702"}</span>
            </div>
          </div>
          <div className="topbar-battery-wrap">
            <BatteryBadge kind="headset" percent={state.headset_battery_percent ?? 0} showPercent={resolvedSettings.showBatteryPercent} />
            <BatteryBadge kind="charging" percent={state.base_battery_percent ?? 0} showPercent={resolvedSettings.showBatteryPercent} />
          </div>
        </div>
        <div className="titlebar-right">
          <div className="updated-inline">Updated: {state.updated_at ?? "--:--:--"}</div>
          <div className="icons">
            <div onClick={() => void actions.openGG()} title="Open SteelSeries GG">
              <SteelSeriesIcon />
            </div>
            <div onClick={() => void actions.setFlyoutPinned(!flyoutPinned)} data-active={flyoutPinned ? "true" : "false"} title={flyoutPinned ? "Unpin window" : "Pin window"}>
              &#xE718;
            </div>
            <div onClick={() => actions.openSettingsWindow()} title="Settings">
              &#xE713;
            </div>
          </div>
        </div>
      </header>

      <DashboardPage
        state={state}
        presets={presets}
        visibleChannels={visibleChannels}
        mixerData={mixerData}
        onSetVolume={actions.setChannelVolume}
        onSetMute={actions.setChannelMute}
        onSetPreset={actions.setPreset}
        onRefreshMixer={() => void actions.refreshMixer()}
        onSetMixerOutput={(outputId) => void actions.setMixerOutput(outputId)}
        onSetMixerAppVolume={(appId, value) => void actions.setMixerAppVolume(appId, value)}
        onSetMixerAppMute={(appId, muted) => void actions.setMixerAppMute(appId, muted)}
      />
    </main>
  );
}

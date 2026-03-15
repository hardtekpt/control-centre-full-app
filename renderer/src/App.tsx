import { useEffect, useMemo, useRef } from "react";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import { useBridgeState } from "./state/store";
import { DEFAULT_SETTINGS } from "@shared/settings";

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function intrinsicSize(el: HTMLElement): { width: number; height: number } {
  const width = Math.ceil(el.scrollWidth || el.clientWidth || el.offsetWidth || 0);
  const height = Math.ceil(el.scrollHeight || el.clientHeight || el.offsetHeight || 0);
  return { width, height };
}

function measureContainerChildren(container: HTMLElement): { width: number; height: number } {
  const style = window.getComputedStyle(container);
  const paddingLeft = parsePx(style.paddingLeft);
  const paddingRight = parsePx(style.paddingRight);
  const paddingTop = parsePx(style.paddingTop);
  const paddingBottom = parsePx(style.paddingBottom);
  const rowGap = parsePx(style.rowGap || style.gap || "0");
  const children = Array.from(container.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  let contentWidth = 0;
  let contentHeight = 0;
  for (let idx = 0; idx < children.length; idx += 1) {
    const child = children[idx];
    const childStyle = window.getComputedStyle(child);
    const marginLeft = parsePx(childStyle.marginLeft);
    const marginRight = parsePx(childStyle.marginRight);
    const marginTop = parsePx(childStyle.marginTop);
    const marginBottom = parsePx(childStyle.marginBottom);
    const measured = measureElementIntrinsic(child);
    const childWidth = measured.width + marginLeft + marginRight;
    const childHeight = measured.height + marginTop + marginBottom;
    contentWidth = Math.max(contentWidth, childWidth);
    contentHeight += childHeight;
    if (idx > 0) {
      contentHeight += rowGap;
    }
  }
  return {
    width: Math.ceil(contentWidth + paddingLeft + paddingRight),
    height: Math.ceil(contentHeight + paddingTop + paddingBottom),
  };
}

function measureElementIntrinsic(el: HTMLElement): { width: number; height: number } {
  if (el.classList.contains("dashboard-page")) {
    return measureContainerChildren(el);
  }
  return intrinsicSize(el);
}

function measureFlyoutShellContent(shell: HTMLElement): { width: number; height: number } {
  const shellStyle = window.getComputedStyle(shell);
  const paddingLeft = parsePx(shellStyle.paddingLeft);
  const paddingRight = parsePx(shellStyle.paddingRight);
  const paddingTop = parsePx(shellStyle.paddingTop);
  const paddingBottom = parsePx(shellStyle.paddingBottom);
  const rowGap = parsePx(shellStyle.rowGap || shellStyle.gap || "0");
  const children = Array.from(shell.children).filter((node): node is HTMLElement => node instanceof HTMLElement);
  let contentWidth = 0;
  let contentHeight = 0;
  for (let idx = 0; idx < children.length; idx += 1) {
    const child = children[idx];
    const childStyle = window.getComputedStyle(child);
    const marginLeft = parsePx(childStyle.marginLeft);
    const marginRight = parsePx(childStyle.marginRight);
    const marginTop = parsePx(childStyle.marginTop);
    const marginBottom = parsePx(childStyle.marginBottom);
    const measured = measureElementIntrinsic(child);
    const childWidth = measured.width + marginLeft + marginRight;
    const childHeight = measured.height + marginTop + marginBottom;
    contentWidth = Math.max(contentWidth, childWidth);
    contentHeight += childHeight;
    if (idx > 0) {
      contentHeight += rowGap;
    }
  }
  return {
    width: Math.ceil(contentWidth + paddingLeft + paddingRight),
    // Keep a small safety inset so bottom spacing is preserved after fit.
    height: Math.ceil(contentHeight + paddingTop + paddingBottom + 2),
  };
}

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
  const {
    state,
    presets,
    settings,
    openApps,
    status,
    error,
    logs,
    mixerData,
    ddcMonitors,
    ddcMonitorsUpdatedAt,
    ddcError,
    flyoutPinned,
    serviceStatus,
    actions,
  } = useBridgeState();
  const resolvedSettings = settings ?? DEFAULT_SETTINGS;
  const visibleChannels = settings?.visibleChannels ?? [];
  const lastReportedSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    if (windowMode !== "dashboard") {
      return;
    }
    const shell = document.querySelector("main.window-base.app-shell") as HTMLElement | null;
    if (!shell) {
      return;
    }
    let rafId = 0;
    const reportSize = () => {
      rafId = 0;
      const { width, height } = measureFlyoutShellContent(shell);
      const prev = lastReportedSizeRef.current;
      if (width === prev.width && height === prev.height) {
        return;
      }
      lastReportedSizeRef.current = { width, height };
      window.arctisBridge.reportFlyoutContentSize(width, height);
    };
    const scheduleReport = () => {
      if (rafId) {
        return;
      }
      rafId = window.requestAnimationFrame(reportSize);
    };
    scheduleReport();
    const resizeObserver = new ResizeObserver(() => scheduleReport());
    resizeObserver.observe(shell);
    const mutationObserver = new MutationObserver(() => scheduleReport());
    mutationObserver.observe(shell, { subtree: true, childList: true, characterData: true, attributes: true });
    window.addEventListener("resize", scheduleReport);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleReport);
    };
  }, [windowMode]);

  if (windowMode === "settings") {
    return (
      <main className="window-base app-shell standalone-page flex h-full w-full flex-col gap-2 overflow-hidden rounded-lg p-3.5">
        <SettingsPage
          settings={resolvedSettings}
          presets={presets}
          ddcMonitors={ddcMonitors}
          ddcMonitorsUpdatedAt={ddcMonitorsUpdatedAt}
          openApps={openApps}
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
        <div className="standalone-actions flex justify-end">
          <button className="button rounded-md px-2.5 py-1.5" onClick={() => actions.closeCurrentWindow()}>
            Close
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="window-base app-shell flex h-full w-full flex-col gap-2 overflow-hidden rounded-lg p-3.5">
      <header className="titlebar flex items-center justify-between">
        <div className="titlebar-left flex items-center gap-2.5">
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
        <div className="titlebar-right flex items-center gap-2.5">
          <div className="updated-inline text-xs opacity-70">Updated: {state.updated_at ?? "--:--:--"}</div>
          <div className="icons">
            <div className="cursor-pointer" onClick={() => void actions.openGG()} title="Open SteelSeries GG">
              <SteelSeriesIcon />
            </div>
            <div className="cursor-pointer" onClick={() => void actions.setFlyoutPinned(!flyoutPinned)} data-active={flyoutPinned ? "true" : "false"} title={flyoutPinned ? "Unpin window" : "Pin window"}>
              &#xE718;
            </div>
            <div className="cursor-pointer" onClick={() => actions.openSettingsWindow()} title="Settings">
              &#xE713;
            </div>
          </div>
        </div>
      </header>

      <DashboardPage
        state={state}
        presets={presets}
        visibleChannels={visibleChannels}
        windowsMixerEnabled={resolvedSettings.showWindowsMixer !== false}
        mixerData={mixerData}
        ddcMonitors={ddcMonitors}
        ddcSettings={resolvedSettings.ddc}
        onSetVolume={actions.setChannelVolume}
        onVolumePreview={actions.previewHeadsetVolume}
        onSetMute={actions.setChannelMute}
        onSetPreset={actions.setPreset}
        onRefreshMixer={() => void actions.refreshMixer()}
        onSetMixerOutput={(outputId) => void actions.setMixerOutput(outputId)}
        onSetMixerAppVolume={(appId, value) => void actions.setMixerAppVolume(appId, value)}
        onSetMixerAppMute={(appId, muted) => void actions.setMixerAppMute(appId, muted)}
        onSetDdcBrightness={(monitorId, value) => void actions.setDdcBrightness(monitorId, value)}
        onSetDdcInputSource={(monitorId, value) => void actions.setDdcInputSource(monitorId, value)}
      />
    </main>
  );
}

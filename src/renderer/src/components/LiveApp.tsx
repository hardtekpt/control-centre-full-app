import { useEffect, useRef } from "react";
import { DEFAULT_SETTINGS } from "@shared/settings";
import DashboardPage from "../pages/DashboardPage";
import SettingsPage from "../pages/SettingsPage";
import { useBridgeState } from "../stores/store";
import BatteryBadge from "./BatteryBadge";
import SteelSeriesIcon from "./icons/SteelSeriesIcon";

interface LiveAppProps {
  windowMode: "dashboard" | "settings";
}

/**
 * Parses CSS pixel values safely.
 */
function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Measures intrinsic element size with fallback order for browser layout APIs.
 */
function intrinsicSize(element: HTMLElement): { width: number; height: number } {
  const width = Math.ceil(element.scrollWidth || element.clientWidth || element.offsetWidth || 0);
  const height = Math.ceil(element.scrollHeight || element.clientHeight || element.offsetHeight || 0);
  return { width, height };
}

/**
 * Measures stacked children + margins for vertically laid out containers.
 */
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

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
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
    if (index > 0) {
      contentHeight += rowGap;
    }
  }

  return {
    width: Math.ceil(contentWidth + paddingLeft + paddingRight),
    height: Math.ceil(contentHeight + paddingTop + paddingBottom),
  };
}

/**
 * Uses custom dashboard measuring to avoid overly large flyout bounds.
 */
function measureElementIntrinsic(element: HTMLElement): { width: number; height: number } {
  if (element.classList.contains("dashboard-page")) {
    return measureContainerChildren(element);
  }
  return intrinsicSize(element);
}

/**
 * Measures the flyout shell content including paddings and inter-row gaps.
 */
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

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
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
    if (index > 0) {
      contentHeight += rowGap;
    }
  }

  return {
    width: Math.ceil(contentWidth + paddingLeft + paddingRight),
    // Keep a small safety inset so bottom spacing is preserved after fit.
    height: Math.ceil(contentHeight + paddingTop + paddingBottom + 2),
  };
}

/**
 * Chooses and renders the dashboard or settings view inside the Electron window.
 */
export default function LiveApp({ windowMode }: LiveAppProps) {
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
      const previous = lastReportedSizeRef.current;
      if (width === previous.width && height === previous.height) {
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
      <main className="window-base app-shell standalone-page app-shell-layout">
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
        <div className="standalone-actions">
          <button className="button button-compact" onClick={() => actions.closeCurrentWindow()}>
            Close
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="window-base app-shell app-shell-layout">
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
            <div className="icon-action" onClick={() => void actions.openGG()} title="Open SteelSeries GG">
              <SteelSeriesIcon />
            </div>
            <div
              className="icon-action"
              onClick={() => void actions.setFlyoutPinned(!flyoutPinned)}
              data-active={flyoutPinned ? "true" : "false"}
              title={flyoutPinned ? "Unpin window" : "Pin window"}
            >
              &#xE718;
            </div>
            <div className="icon-action" onClick={() => actions.openSettingsWindow()} title="Settings">
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

import { useEffect, useState } from "react";
import { CHANNELS, type ChannelKey, type NotificationKey, type UiSettings } from "@shared/types";
import type { DdcMonitor, ServiceStatus } from "../state/store";

interface SettingsProps {
  settings: UiSettings;
  ddcMonitors: DdcMonitor[];
  ddcMonitorsUpdatedAt: number | null;
  ddcError: string | null;
  logs: string[];
  lastStatus: string;
  lastError: string | null;
  serviceStatus: ServiceStatus;
  initialTab?: SettingsTab;
  onUpdate: (partial: Partial<UiSettings>) => void;
  onRefreshDdcMonitors: () => void;
  onTestNotification: () => void;
  onTestLowBatteryNotification: () => void;
  onTestBatterySwapNotification: () => void;
}

const NOTIFICATION_LABELS: Array<{ key: NotificationKey; label: string }> = [
  { key: "appInfo", label: "Main App Info (Startup/Errors)" },
  { key: "connectivity", label: "Connectivity OSD Indicator" },
  { key: "usbInput", label: "USB Input Selected OSD" },
  { key: "ancMode", label: "ANC OSD Indicator" },
  { key: "oled", label: "OLED Brightness" },
  { key: "sidetone", label: "Sidetone" },
  { key: "micMute", label: "MIC Mute OSD Indicator" },
  { key: "headsetChatMix", label: "Include Chat Mix In Headset OSD" },
  { key: "headsetVolume", label: "Headset Volume + Chat Mix OSD" },
  { key: "battery", label: "Battery OSD Alerts (Low + Base Station Insert/Remove)" },
  { key: "presetChange", label: "Sonar Preset Change" },
];

type SettingsTab = "app" | "ggSonar" | "notifications" | "ddc" | "about";

export default function SettingsPage({
  settings,
  ddcMonitors,
  ddcMonitorsUpdatedAt,
  ddcError,
  logs,
  lastStatus,
  lastError,
  serviceStatus,
  initialTab = "app",
  onUpdate,
  onRefreshDdcMonitors,
  onTestNotification,
  onTestLowBatteryNotification,
  onTestBatterySwapNotification,
}: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [shortcutDraft, setShortcutDraft] = useState(settings.toggleShortcut);

  useEffect(() => setShortcutDraft(settings.toggleShortcut), [settings.toggleShortcut]);
  useEffect(() => setTab(initialTab), [initialTab]);

  const toggleChannel = (channel: ChannelKey, enabled: boolean) => {
    const next = enabled
      ? Array.from(new Set([...settings.visibleChannels, channel]))
      : settings.visibleChannels.filter((value) => value !== channel);
    onUpdate({ visibleChannels: next });
  };

  const toggleNotification = (key: NotificationKey, enabled: boolean) => {
    onUpdate({
      notifications: {
        ...settings.notifications,
        [key]: enabled,
      },
    });
  };

  return (
    <section className="card settings-page settings-shell">
      <aside className="settings-sidebar">
        <h3>Settings</h3>
        <button className={`settings-nav-btn ${tab === "app" ? "active" : ""}`} onClick={() => setTab("app")}>
          App
        </button>
        <button className={`settings-nav-btn ${tab === "ggSonar" ? "active" : ""}`} onClick={() => setTab("ggSonar")}>
          GG Sonar
        </button>
        <button className={`settings-nav-btn ${tab === "notifications" ? "active" : ""}`} onClick={() => setTab("notifications")}>
          Notifications
        </button>
        <button className={`settings-nav-btn ${tab === "ddc" ? "active" : ""}`} onClick={() => setTab("ddc")}>
          DDC
        </button>
        <button className={`settings-nav-btn ${tab === "about" ? "active" : ""}`} onClick={() => setTab("about")}>
          About
        </button>
      </aside>
      <div className="settings-content">
        {tab === "app" && (
          <>
            <h3>App Settings</h3>
            <label className="form-row">
              <span>Theme</span>
              <select value={settings.themeMode} onChange={(e) => onUpdate({ themeMode: e.currentTarget.value as UiSettings["themeMode"] })}>
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <label className="form-row">
              <span>Accent color</span>
              <div className="accent-row">
                <input type="color" value={settings.accentColor || "#6ab7ff"} onChange={(e) => onUpdate({ accentColor: e.currentTarget.value })} />
                <button className="button" onClick={() => onUpdate({ accentColor: "" })}>
                  System
                </button>
              </div>
            </label>
            <label className="form-row">
              <span>Text size</span>
              <input type="range" min={80} max={140} value={settings.textScale} onChange={(e) => onUpdate({ textScale: Number(e.currentTarget.value) })} />
            </label>
            <label className="form-row">
              <span>Use active screen for windows/notifications</span>
              <input type="checkbox" checked={settings.useActiveDisplay} onChange={(e) => onUpdate({ useActiveDisplay: e.currentTarget.checked })} />
            </label>
            <label className="form-row">
              <span>Show battery %</span>
              <input type="checkbox" checked={settings.showBatteryPercent} onChange={(e) => onUpdate({ showBatteryPercent: e.currentTarget.checked })} />
            </label>
            <label className="form-row">
              <span>Toggle shortcut</span>
              <input
                className="text-input"
                value={shortcutDraft}
                onChange={(e) => setShortcutDraft(e.currentTarget.value)}
                onBlur={() => onUpdate({ toggleShortcut: shortcutDraft })}
                placeholder="CommandOrControl+Shift+A"
              />
            </label>
          </>
        )}
        {tab === "ggSonar" && (
          <>
            <h3>GG Sonar Settings</h3>
            <label className="form-row">
              <span>PC USB input</span>
              <select value={settings.pcUsbInput} onChange={(e) => onUpdate({ pcUsbInput: e.currentTarget.value === "2" ? 2 : 1 })}>
                <option value="1">USB Input 1</option>
                <option value="2">USB Input 2</option>
              </select>
            </label>
            <div className="visible-channels">
              <div className="visible-title">Visible Sonar Channels</div>
              <div className="visible-grid">
                {CHANNELS.map((channel) => {
                  const enabled = settings.visibleChannels.includes(channel);
                  return (
                    <label key={channel} className="visible-item">
                      <input type="checkbox" checked={enabled} onChange={(e) => toggleChannel(channel, e.currentTarget.checked)} />
                      <span>{channel}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}
        {tab === "notifications" && (
          <>
            <h3>Notification Settings</h3>
            <label className="form-row">
              <span>Notification timeout</span>
              <div className="accent-row">
                <input
                  className="text-input"
                  type="number"
                  min={2}
                  max={30}
                  value={settings.notificationTimeout}
                  onChange={(e) => onUpdate({ notificationTimeout: Number(e.currentTarget.value) || 5 })}
                />
                <span>seconds</span>
              </div>
            </label>
            <label className="form-row">
              <span>Low battery threshold</span>
              <div className="accent-row">
                <input
                  className="text-input"
                  type="number"
                  min={1}
                  max={100}
                  value={settings.batteryLowThreshold}
                  onChange={(e) => onUpdate({ batteryLowThreshold: Number(e.currentTarget.value) || 15 })}
                />
                <span>%</span>
              </div>
            </label>
            <div className="visible-channels">
              <div className="visible-grid">
                {NOTIFICATION_LABELS.map((item) => (
                  <label key={item.key} className="visible-item">
                    <input
                      type="checkbox"
                      checked={settings.notifications[item.key]}
                      onChange={(e) => toggleNotification(item.key, e.currentTarget.checked)}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
              <div style={{ marginTop: "8px" }}>
                <button className="button" onClick={onTestNotification}>
                  Push Test Notification
                </button>
                <button className="button" onClick={onTestLowBatteryNotification} style={{ marginLeft: "8px" }}>
                  Test Low Battery Notification
                </button>
                <button className="button" onClick={onTestBatterySwapNotification} style={{ marginLeft: "8px" }}>
                  Test Battery Swap Notification
                </button>
              </div>
            </div>
          </>
        )}
        {tab === "ddc" && (
          <>
            <h3>DDC Monitor Data</h3>
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
        )}
        {tab === "about" && (
          <>
            <h3>About</h3>
            <p>Control Centre</p>
            <p>Electron + React flyout dashboard for Arctis Nova + Sonar control.</p>
            <p>Backend bridge status: {lastError ? `Error (${lastError})` : lastStatus}</p>
            <div className="service-status-grid">
              <div className="service-status-card">
                <div className="service-title">Arctis API</div>
                <div className={`service-state ${serviceStatus.arctisApi.state}`}>{serviceStatus.arctisApi.state}</div>
                <div className="service-detail">{serviceStatus.arctisApi.detail}</div>
              </div>
              <div className="service-status-card">
                <div className="service-title">DDC API</div>
                <div className={`service-state ${serviceStatus.ddcApi.state}`}>{serviceStatus.ddcApi.state}</div>
                <div className="service-detail">{serviceStatus.ddcApi.detail}</div>
                <div className="service-detail">Endpoint: {serviceStatus.ddcApi.endpoint}</div>
                <div className="service-detail">Managed: {serviceStatus.ddcApi.managed ? "yes" : "no"}</div>
                <div className="service-detail">PID: {serviceStatus.ddcApi.pid ?? "n/a"}</div>
              </div>
            </div>
            <div className="logs-panel">
              <div className="logs-header">Logs</div>
              <div className="logs-list">
                {logs.length === 0 && <div className="log-line">No logs yet.</div>}
                {logs.map((line, idx) => (
                  <div className="log-line" key={`${idx}-${line.slice(0, 12)}`}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        <p className="hint">Settings are saved in %APPDATA% userData JSON.</p>
      </div>
    </section>
  );
}

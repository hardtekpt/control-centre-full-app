import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CHANNELS, type ChannelKey, type NotificationKey, type PresetMap, type RunningAppInfo, type ShortcutAction, type ShortcutBinding, type UiSettings } from "@shared/types";
import type { DdcMonitor, ServiceStatus } from "../state/store";

interface SettingsProps {
  settings: UiSettings;
  presets: PresetMap;
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
  openApps: RunningAppInfo[];
}

const NOTIFICATION_LABELS: Array<{ key: NotificationKey; label: string }> = [
  { key: "appInfo", label: "Main App Info (Startup/Errors)" },
  { key: "connectivity", label: "Connectivity OSD Indicator" },
  { key: "usbInput", label: "USB Input Selected OSD" },
  { key: "ancMode", label: "ANC OSD Indicator" },
  { key: "oled", label: "OLED Brightness OSD" },
  { key: "sidetone", label: "Sidetone OSD" },
  { key: "micMute", label: "MIC Mute OSD Indicator" },
  { key: "headsetChatMix", label: "Include Chat Mix In Headset OSD" },
  { key: "headsetVolume", label: "Headset Volume + Chat Mix OSD" },
  { key: "battery", label: "Battery OSD Alerts (Low + Base Station Insert/Remove)" },
  { key: "presetChange", label: "Sonar Preset Change" },
];

const SHORTCUT_ACTION_OPTIONS: Array<{ value: ShortcutAction; label: string }> = [
  { value: "sonar_volume_up", label: "Sonar Volume Up" },
  { value: "sonar_volume_down", label: "Sonar Volume Down" },
  { value: "sonar_mute_toggle", label: "Sonar Toggle Mute" },
  { value: "sonar_mute_on", label: "Sonar Mute On" },
  { value: "sonar_mute_off", label: "Sonar Mute Off" },
  { value: "sonar_set_preset", label: "Sonar Set Preset" },
  { value: "ddc_brightness_up", label: "Monitor Brightness Up" },
  { value: "ddc_brightness_down", label: "Monitor Brightness Down" },
  { value: "ddc_brightness_set", label: "Monitor Brightness Set" },
  { value: "ddc_input_set", label: "Monitor Input Set" },
];

type SettingsTab = "app" | "ggSonar" | "shortcuts" | "notifications" | "ddc" | "autoPreset" | "about";

function normalizeInputCode(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function createShortcutId(): string {
  return `shortcut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function defaultShortcutBinding(): ShortcutBinding {
  return {
    id: createShortcutId(),
    enabled: true,
    accelerator: "",
    action: "sonar_volume_up",
    channel: "master",
    step: 5,
  };
}

function normalizeAcceleratorKey(key: string): string | null {
  if (!key) {
    return null;
  }
  const lower = key.toLowerCase();
  if (lower.length === 1 && /[a-z0-9]/.test(lower)) {
    return lower.toUpperCase();
  }
  if (/^f\d{1,2}$/i.test(key)) {
    return key.toUpperCase();
  }
  const map: Record<string, string> = {
    " ": "Space",
    escape: "Esc",
    enter: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    insert: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
    plus: "Plus",
    minus: "-",
    comma: ",",
    period: ".",
    slash: "/",
    semicolon: ";",
    quote: "'",
    bracketleft: "[",
    bracketright: "]",
    backslash: "\\",
    backquote: "`",
  };
  return map[lower] ?? null;
}

function acceleratorFromEvent(event: ReactKeyboardEvent<HTMLInputElement>): string | null {
  const key = normalizeAcceleratorKey(event.key);
  if (!key) {
    return null;
  }
  if (["control", "shift", "alt", "meta"].includes(event.key.toLowerCase())) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("CommandOrControl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);
  return parts.join("+");
}

export default function SettingsPage({
  settings,
  presets,
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
  openApps,
}: SettingsProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [shortcutDraft, setShortcutDraft] = useState(settings.toggleShortcut);
  const [newShortcut, setNewShortcut] = useState<ShortcutBinding>(defaultShortcutBinding);
  const [newPresetRule, setNewPresetRule] = useState({ enabled: true, appId: "", channel: "master" as ChannelKey, presetId: "" });

  const sortedOpenApps = useMemo(
    () =>
      [...openApps]
        .filter((item) => String(item.id ?? "").trim())
        .sort((a, b) => {
          const aName = String(a.name || a.id).toLowerCase();
          const bName = String(b.name || b.id).toLowerCase();
          return aName.localeCompare(bName);
        }),
    [openApps],
  );
  const appLabel = (app: RunningAppInfo): string => {
    const name = String(app.name || app.id).trim();
    const executable = String(app.executable || app.id).trim();
    return executable && executable !== name ? `${name} (${executable})` : name;
  };
  const isKnownApp = (appId: string) => sortedOpenApps.some((app) => app.id === appId);
  const appSelectLabel = (appId: string): string => {
    const app = sortedOpenApps.find((item) => item.id === appId);
    if (app) {
      return appLabel(app);
    }
    return appId;
  };
  useEffect(() => setShortcutDraft(settings.toggleShortcut), [settings.toggleShortcut]);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    setNewPresetRule((prev) => {
      if (prev.appId && sortedOpenApps.some((app) => app.id === prev.appId)) {
        return prev;
      }
      const fallbackAppId = sortedOpenApps[0]?.id ?? "";
      if (prev.appId === fallbackAppId && prev.presetId === "") {
        return prev;
      }
      return { ...prev, appId: fallbackAppId, presetId: "" };
    });
  }, [sortedOpenApps]);
  const dashboardMonitorIdRaw = Number(settings.ddc.dashboardMonitorId);
  const dashboardMonitorId = Number.isFinite(dashboardMonitorIdRaw) && dashboardMonitorIdRaw > 0 ? Math.round(dashboardMonitorIdRaw) : null;
  const dashboardSecondaryMonitorIdRaw = Number(settings.ddc.dashboardSecondaryMonitorId);
  const dashboardSecondaryMonitorId =
    Number.isFinite(dashboardSecondaryMonitorIdRaw) && dashboardSecondaryMonitorIdRaw > 0 ? Math.round(dashboardSecondaryMonitorIdRaw) : null;
  const selectedPrimaryMonitor = ddcMonitors.find((item) => item.monitor_id === dashboardMonitorId) ?? ddcMonitors[0] ?? null;
  const selectedSecondaryMonitor =
    ddcMonitors.find((item) => item.monitor_id === dashboardSecondaryMonitorId) ??
    ddcMonitors.find((item) => item.monitor_id !== (selectedPrimaryMonitor?.monitor_id ?? -1)) ??
    null;
  const resolveInputName = (inputCode: string): string => {
    const target = normalizeInputCode(inputCode);
    if (!target) {
      return "";
    }
    for (const [key, value] of Object.entries(settings.ddc.inputNameMap ?? {})) {
      if (normalizeInputCode(key) === target) {
        return String(value ?? "").trim();
      }
    }
    return "";
  };
  const inputLabel = (inputCode: string): string => {
    const trimmed = String(inputCode ?? "").trim();
    if (!trimmed) {
      return "";
    }
    const name = resolveInputName(trimmed);
    return name ? `${name} (${trimmed})` : trimmed;
  };
  const dedupeInputCodes = (values: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const code = String(raw ?? "").trim();
      if (!code) {
        continue;
      }
      const key = normalizeInputCode(code);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(code);
    }
    return out;
  };
  const knownInputCodes = dedupeInputCodes([
    ...(selectedPrimaryMonitor?.available_inputs ?? []),
    ...(selectedSecondaryMonitor?.available_inputs ?? []),
    ...Object.keys(settings.ddc.inputNameMap ?? {}),
  ]);
  const primaryInputOptions = dedupeInputCodes([
    ...(selectedPrimaryMonitor?.available_inputs ?? []),
    settings.ddc.dashboardPrimaryInputA,
    settings.ddc.dashboardPrimaryInputB,
    ...knownInputCodes,
  ]);
  const secondaryInputOptions = dedupeInputCodes([
    ...(selectedSecondaryMonitor?.available_inputs ?? []),
    settings.ddc.dashboardSecondaryInputA,
    settings.ddc.dashboardSecondaryInputB,
    ...knownInputCodes,
  ]);
  const monitorDisplayName = (monitor: DdcMonitor): string => {
    const alias = String(settings.ddc.monitorPrefs[String(monitor.monitor_id)]?.alias ?? "").trim();
    return alias || monitor.name;
  };
  const monitorAliasValue = (monitorId: number | null): string => {
    if (!monitorId) {
      return "";
    }
    return String(settings.ddc.monitorPrefs[String(monitorId)]?.alias ?? "");
  };
  const setMonitorAlias = (monitorId: number | null, alias: string) => {
    if (!monitorId) {
      return;
    }
    const key = String(monitorId);
    const current = settings.ddc.monitorPrefs[key] ?? { alias: "", enabled: true };
    onUpdate({
      ddc: {
        ...settings.ddc,
        monitorPrefs: {
          ...settings.ddc.monitorPrefs,
          [key]: {
            ...current,
            alias,
            enabled: current.enabled !== false,
          },
        },
      },
    });
  };
  const setInputName = (inputCode: string, value: string) => {
    const code = String(inputCode ?? "").trim();
    if (!code) {
      return;
    }
    const nextMap = { ...(settings.ddc.inputNameMap ?? {}) };
    if (value.trim()) {
      nextMap[code] = value;
    } else {
      for (const key of Object.keys(nextMap)) {
        if (normalizeInputCode(key) === normalizeInputCode(code)) {
          delete nextMap[key];
        }
      }
    }
    onUpdate({
      ddc: {
        ...settings.ddc,
        inputNameMap: nextMap,
      },
    });
  };

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

  const updateShortcuts = (next: ShortcutBinding[]) => {
    onUpdate({ shortcuts: next });
  };

  const applyShortcutPatch = (id: string, patch: Partial<ShortcutBinding>) => {
    const next = settings.shortcuts.map((item) => (item.id === id ? { ...item, ...patch } : item));
    updateShortcuts(next);
  };

  const removeShortcut = (id: string) => {
    updateShortcuts(settings.shortcuts.filter((item) => item.id !== id));
  };

  const withActionDefaults = (binding: ShortcutBinding, action: ShortcutAction): ShortcutBinding => {
    const monitorId = ddcMonitors[0]?.monitor_id;
    if (action === "sonar_set_preset") {
      const channel = binding.channel ?? "master";
      const firstPreset = presets[channel]?.[0]?.[0];
      return { ...binding, action, channel, presetId: firstPreset ?? binding.presetId };
    }
    if (action === "sonar_volume_up" || action === "sonar_volume_down") {
      return { ...binding, action, channel: binding.channel ?? "master", step: binding.step ?? 5 };
    }
    if (action === "sonar_mute_toggle" || action === "sonar_mute_on" || action === "sonar_mute_off") {
      return { ...binding, action, channel: binding.channel ?? "master" };
    }
    if (action === "ddc_brightness_up" || action === "ddc_brightness_down") {
      return { ...binding, action, monitorId: binding.monitorId ?? monitorId, step: binding.step ?? 5 };
    }
    if (action === "ddc_brightness_set") {
      return { ...binding, action, monitorId: binding.monitorId ?? monitorId, brightness: binding.brightness ?? 50 };
    }
    if (action === "ddc_input_set") {
      const monitor = ddcMonitors.find((item) => item.monitor_id === binding.monitorId) ?? ddcMonitors[0];
      return {
        ...binding,
        action,
        monitorId: binding.monitorId ?? monitor?.monitor_id,
        inputSource: binding.inputSource ?? monitor?.available_inputs?.[0] ?? "",
      };
    }
    return { ...binding, action };
  };

  const onShortcutKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, apply: (value: string) => void) => {
    if (event.key === "Tab") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Backspace" || event.key === "Delete") {
      apply("");
      return;
    }
    const accelerator = acceleratorFromEvent(event);
    if (accelerator) {
      apply(accelerator);
    }
  };

  const renderShortcutActionControls = (binding: ShortcutBinding, onPatch: (patch: Partial<ShortcutBinding>) => void) => {
    const monitor = ddcMonitors.find((item) => item.monitor_id === binding.monitorId) ?? ddcMonitors[0];
    if (
      binding.action === "sonar_volume_up" ||
      binding.action === "sonar_volume_down" ||
      binding.action === "sonar_mute_toggle" ||
      binding.action === "sonar_mute_on" ||
      binding.action === "sonar_mute_off" ||
      binding.action === "sonar_set_preset"
    ) {
      const channel = binding.channel ?? "master";
      return (
        <>
          <select
            value={channel}
            onChange={(e) => onPatch({ channel: e.currentTarget.value as ChannelKey })}
            className="shortcut-field shortcut-field-channel"
          >
            {CHANNELS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {(binding.action === "sonar_volume_up" || binding.action === "sonar_volume_down") && (
            <input
              className="text-input shortcut-field shortcut-field-number"
              type="number"
              min={1}
              max={50}
              value={binding.step ?? 5}
              onChange={(e) => onPatch({ step: Number(e.currentTarget.value) || 5 })}
              title="Step (%)"
            />
          )}
          {binding.action === "sonar_set_preset" && (
            <select
              value={binding.presetId ?? ""}
              onChange={(e) => onPatch({ presetId: e.currentTarget.value })}
              className="shortcut-field shortcut-field-preset"
            >
              <option value="">Select preset</option>
              {(presets[channel] ?? []).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </>
      );
    }
    if (binding.action === "ddc_brightness_up" || binding.action === "ddc_brightness_down" || binding.action === "ddc_brightness_set" || binding.action === "ddc_input_set") {
      return (
        <>
          <select
            value={binding.monitorId ?? monitor?.monitor_id ?? ""}
            onChange={(e) => onPatch({ monitorId: Number(e.currentTarget.value) || undefined })}
            className="shortcut-field shortcut-field-monitor"
          >
            <option value="">Select monitor</option>
            {ddcMonitors.map((item) => (
              <option key={item.monitor_id} value={item.monitor_id}>
                {item.name}
              </option>
            ))}
          </select>
          {(binding.action === "ddc_brightness_up" || binding.action === "ddc_brightness_down") && (
            <input
              className="text-input shortcut-field shortcut-field-number"
              type="number"
              min={1}
              max={50}
              value={binding.step ?? 5}
              onChange={(e) => onPatch({ step: Number(e.currentTarget.value) || 5 })}
              title="Step (%)"
            />
          )}
          {binding.action === "ddc_brightness_set" && (
            <input
              className="text-input shortcut-field shortcut-field-number"
              type="number"
              min={0}
              max={100}
              value={binding.brightness ?? 50}
              onChange={(e) => onPatch({ brightness: Number(e.currentTarget.value) || 0 })}
              title="Brightness (%)"
            />
          )}
          {binding.action === "ddc_input_set" && (
            <select
              value={binding.inputSource ?? ""}
              onChange={(e) => onPatch({ inputSource: e.currentTarget.value })}
              className="shortcut-field shortcut-field-input"
            >
              <option value="">Select input</option>
              {(monitor?.available_inputs ?? []).map((input) => (
                <option key={input} value={input}>
                  {inputLabel(input)}
                </option>
              ))}
            </select>
          )}
        </>
      );
    }
    return null;
  };

  const addShortcut = () => {
    if (!newShortcut.accelerator.trim()) {
      return;
    }
    const next = [...settings.shortcuts, { ...newShortcut, id: createShortcutId() }];
    updateShortcuts(next);
    setNewShortcut(defaultShortcutBinding());
  };

  const availablePresetRows = (channel: ChannelKey): Array<[string, string]> => presets[channel] ?? [];
  const updateAutomaticPresetRules = (next: typeof settings.automaticPresetRules) => {
    onUpdate({ automaticPresetRules: next });
  };
  const patchAutomaticPresetRule = (id: string, patch: Partial<(typeof settings.automaticPresetRules)[number]>) => {
    const next = settings.automaticPresetRules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule));
    updateAutomaticPresetRules(next);
  };
  const removeAutomaticPresetRule = (id: string) => {
    updateAutomaticPresetRules(settings.automaticPresetRules.filter((rule) => rule.id !== id));
  };
  const addAutomaticPresetRule = () => {
    if (!newPresetRule.appId || !newPresetRule.presetId) {
      return;
    }
    const next = [...settings.automaticPresetRules, { ...newPresetRule, id: createShortcutId() }];
    updateAutomaticPresetRules(next);
    setNewPresetRule({
      enabled: true,
      appId: sortedOpenApps[0]?.id ?? "",
      channel: newPresetRule.channel,
      presetId: "",
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
        <button className={`settings-nav-btn ${tab === "shortcuts" ? "active" : ""}`} onClick={() => setTab("shortcuts")}>
          Shortcuts
        </button>
        <button className={`settings-nav-btn ${tab === "autoPreset" ? "active" : ""}`} onClick={() => setTab("autoPreset")}>
          Automatic Presets
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
              <span>Enable Windows Mixer tab</span>
              <input type="checkbox" checked={settings.showWindowsMixer !== false} onChange={(e) => onUpdate({ showWindowsMixer: e.currentTarget.checked })} />
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
        {tab === "autoPreset" && (
          <>
            <h3>Automatic Preset Switcher</h3>
            <p className="hint">Choose an open app and associated Sonar preset per channel. Rules are applied when the active window changes.</p>
            <div className="shortcut-list">
              {settings.automaticPresetRules.length === 0 && <div className="hint">No automatic preset rules configured.</div>}
              {settings.automaticPresetRules.map((rule) => {
                const presetOptions = availablePresetRows(rule.channel);
                return (
                  <div className="shortcut-row preset-rule-row" key={rule.id}>
                    <input
                      type="checkbox"
                      checked={rule.enabled !== false}
                      onChange={(e) => patchAutomaticPresetRule(rule.id, { enabled: e.currentTarget.checked })}
                      title="Enabled"
                    />
                    <select
                      className="shortcut-field shortcut-field-channel"
                      value={rule.appId}
                      onChange={(e) => patchAutomaticPresetRule(rule.id, { appId: e.currentTarget.value })}
                    >
                      {!isKnownApp(rule.appId) && rule.appId && <option value={rule.appId}>{appSelectLabel(rule.appId)}</option>}
                      {sortedOpenApps.length === 0 && (
                        <option value="">No running apps detected</option>
                      )}
                      {sortedOpenApps.map((app) => (
                        <option key={`${rule.id}-${app.id}`} value={app.id}>
                          {appLabel(app)}
                        </option>
                      ))}
                    </select>
                    <select
                      className="shortcut-field shortcut-field-channel"
                      value={rule.channel}
                      onChange={(e) => patchAutomaticPresetRule(rule.id, { channel: e.currentTarget.value as ChannelKey })}
                    >
                      {CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>
                          {channel}
                        </option>
                      ))}
                    </select>
                    <select
                      className="shortcut-field shortcut-field-preset"
                      value={rule.presetId}
                      onChange={(e) => patchAutomaticPresetRule(rule.id, { presetId: e.currentTarget.value })}
                    >
                      <option value="">Select preset</option>
                      {presetOptions.map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button className="button shortcut-delete" onClick={() => removeAutomaticPresetRule(rule.id)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="shortcut-add">
              <h3>Add Rule</h3>
              <div className="shortcut-row preset-rule-row">
                <input
                  type="checkbox"
                  checked={newPresetRule.enabled}
                  onChange={(e) => setNewPresetRule((prev) => ({ ...prev, enabled: e.currentTarget.checked }))}
                />
                <select
                  className="shortcut-field shortcut-field-channel"
                  value={newPresetRule.appId}
                  onChange={(e) => setNewPresetRule((prev) => ({ ...prev, appId: e.currentTarget.value }))}
                >
                  {!isKnownApp(newPresetRule.appId) && newPresetRule.appId && <option value={newPresetRule.appId}>{appSelectLabel(newPresetRule.appId)}</option>}
                  {sortedOpenApps.length === 0 && (
                    <option value="">No running apps detected</option>
                  )}
                  {sortedOpenApps.map((app) => (
                    <option key={`new-${app.id}`} value={app.id}>
                      {appLabel(app)}
                    </option>
                  ))}
                </select>
                <select
                  className="shortcut-field shortcut-field-channel"
                  value={newPresetRule.channel}
                  onChange={(e) =>
                    setNewPresetRule((prev) => {
                      const channel = e.currentTarget.value as ChannelKey;
                      return {
                        ...prev,
                        channel,
                        presetId: "",
                      };
                    })
                  }
                >
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel}
                    </option>
                  ))}
                </select>
                <select
                  className="shortcut-field shortcut-field-preset"
                  value={newPresetRule.presetId}
                  onChange={(e) => setNewPresetRule((prev) => ({ ...prev, presetId: e.currentTarget.value }))}
                >
                  <option value="">Select preset</option>
                  {(availablePresetRows(newPresetRule.channel) ?? []).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="button shortcut-add-btn" onClick={addAutomaticPresetRule}>
                  Add
                </button>
              </div>
            </div>
          </>
        )}
        {tab === "shortcuts" && (
          <>
            <h3>Shortcut Settings</h3>
            <p className="hint">Click a shortcut field and press the key combination to capture it.</p>
            <div className="shortcut-list">
              {settings.shortcuts.length === 0 && <div className="hint">No shortcuts configured.</div>}
              {settings.shortcuts.map((shortcut) => (
                <div className="shortcut-row" key={shortcut.id}>
                  <input
                    type="checkbox"
                    checked={shortcut.enabled !== false}
                    onChange={(e) => applyShortcutPatch(shortcut.id, { enabled: e.currentTarget.checked })}
                    title="Enabled"
                  />
                  <input
                    className="text-input shortcut-field shortcut-field-accelerator"
                    value={shortcut.accelerator}
                    placeholder="Press keys..."
                    onKeyDown={(e) => onShortcutKeyDown(e, (value) => applyShortcutPatch(shortcut.id, { accelerator: value }))}
                    readOnly
                  />
                  <select
                    className="shortcut-field shortcut-field-action"
                    value={shortcut.action}
                    onChange={(e) => applyShortcutPatch(shortcut.id, withActionDefaults(shortcut, e.currentTarget.value as ShortcutAction))}
                  >
                    {SHORTCUT_ACTION_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  {renderShortcutActionControls(shortcut, (patch) => applyShortcutPatch(shortcut.id, patch))}
                  <button className="button shortcut-delete" onClick={() => removeShortcut(shortcut.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="shortcut-add">
              <h3>Add Shortcut</h3>
              <div className="shortcut-row">
                <input type="checkbox" checked={newShortcut.enabled !== false} onChange={(e) => setNewShortcut((prev) => ({ ...prev, enabled: e.currentTarget.checked }))} />
                <input
                  className="text-input shortcut-field shortcut-field-accelerator"
                  value={newShortcut.accelerator}
                  placeholder="Press keys..."
                  onKeyDown={(e) => onShortcutKeyDown(e, (value) => setNewShortcut((prev) => ({ ...prev, accelerator: value })))}
                  readOnly
                />
                <select
                  className="shortcut-field shortcut-field-action"
                  value={newShortcut.action}
                  onChange={(e) => setNewShortcut((prev) => withActionDefaults(prev, e.currentTarget.value as ShortcutAction))}
                >
                  {SHORTCUT_ACTION_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {renderShortcutActionControls(newShortcut, (patch) => setNewShortcut((prev) => ({ ...prev, ...patch })))}
                <button className="button shortcut-add-btn" onClick={addShortcut}>
                  Add
                </button>
              </div>
            </div>
          </>
        )}
        {tab === "ddc" && (
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
                  onChange={(e) =>
                    onUpdate({
                      ddc: {
                        ...settings.ddc,
                        pollIntervalMs: Math.max(1, Math.round(Number(e.currentTarget.value) || 5)) * 60_000,
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
                  onChange={(e) =>
                    onUpdate({
                      ddc: {
                        ...settings.ddc,
                        openStaleThresholdMs: Math.max(1, Math.round(Number(e.currentTarget.value) || 1)) * 60_000,
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
                onChange={(e) =>
                  onUpdate({
                    ddc: {
                      ...settings.ddc,
                      dashboardMonitorId: Number(e.currentTarget.value) || null,
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
                onChange={(e) => setMonitorAlias(selectedPrimaryMonitor?.monitor_id ?? null, e.currentTarget.value)}
                placeholder={selectedPrimaryMonitor?.name ?? "Primary monitor"}
              />
            </label>
            <label className="form-row">
              <span>Dashboard monitor (secondary)</span>
              <select
                value={dashboardSecondaryMonitorId ?? ""}
                onChange={(e) =>
                  onUpdate({
                    ddc: {
                      ...settings.ddc,
                      dashboardSecondaryMonitorId: Number(e.currentTarget.value) || null,
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
                onChange={(e) => setMonitorAlias(selectedSecondaryMonitor?.monitor_id ?? null, e.currentTarget.value)}
                placeholder={selectedSecondaryMonitor?.name ?? "Secondary monitor"}
              />
            </label>
            <label className="form-row">
              <span>Primary input toggle A</span>
              <select
                value={settings.ddc.dashboardPrimaryInputA}
                onChange={(e) =>
                  onUpdate({
                    ddc: {
                      ...settings.ddc,
                      dashboardPrimaryInputA: e.currentTarget.value,
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
                onChange={(e) =>
                  onUpdate({
                    ddc: {
                      ...settings.ddc,
                      dashboardPrimaryInputB: e.currentTarget.value,
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
                onChange={(e) =>
                  onUpdate({
                    ddc: {
                      ...settings.ddc,
                      dashboardSecondaryInputA: e.currentTarget.value,
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
                onChange={(e) =>
                  onUpdate({
                    ddc: {
                      ...settings.ddc,
                      dashboardSecondaryInputB: e.currentTarget.value,
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
                    <input
                      className="text-input"
                      value={resolveInputName(inputCode)}
                      onChange={(e) => setInputName(inputCode, e.currentTarget.value)}
                      placeholder="Custom input name"
                    />
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

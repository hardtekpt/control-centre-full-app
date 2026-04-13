import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CHANNELS, type ChannelKey, type NotificationKey, type PresetMap, type RunningAppInfo, type ShortcutAction, type ShortcutBinding, type UiSettings } from "@shared/types";
import type { DdcMonitor, OledServiceFrame, ServiceStatus } from "../stores/store";
import AboutSettingsTab from "../components/settings/AboutSettingsTab";
import AppSettingsTab from "../components/settings/AppSettingsTab";
import AutomaticPresetsSettingsTab, { type NewPresetRuleDraft } from "../components/settings/AutomaticPresetsSettingsTab";
import DdcSettingsTab from "../components/settings/DdcSettingsTab";
import GgSonarSettingsTab from "../components/settings/GgSonarSettingsTab";
import NotificationSettingsTab from "../components/settings/NotificationSettingsTab";
import OledServiceSettingsTab from "../components/settings/OledServiceSettingsTab";
import SettingsSidebar from "../components/settings/SettingsSidebar";
import ShortcutsSettingsTab from "../components/settings/ShortcutsSettingsTab";
import type { SettingsTab } from "../components/settings/types";

interface SettingsProps {
  settings: UiSettings;
  presets: PresetMap;
  ddcMonitors: DdcMonitor[];
  ddcMonitorsUpdatedAt: number | null;
  ddcError: string | null;
  oledServiceFrame: OledServiceFrame | null;
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

/**
 * Settings window with tabbed controls for app, Sonar, DDC, notifications, and diagnostics.
 */
export default function SettingsPage({
  settings,
  presets,
  ddcMonitors,
  ddcMonitorsUpdatedAt,
  ddcError,
  oledServiceFrame,
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
  const [newPresetRule, setNewPresetRule] = useState<NewPresetRuleDraft>({ enabled: true, appId: "", channel: "master", presetId: "" });

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
    setNewPresetRule((previous) => {
      if (previous.appId && sortedOpenApps.some((app) => app.id === previous.appId)) {
        return previous;
      }
      const fallbackAppId = sortedOpenApps[0]?.id ?? "";
      if (previous.appId === fallbackAppId && previous.presetId === "") {
        return previous;
      }
      return { ...previous, appId: fallbackAppId, presetId: "" };
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
    const output: string[] = [];
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
      output.push(code);
    }
    return output;
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
    const next = enabled ? Array.from(new Set([...settings.visibleChannels, channel])) : settings.visibleChannels.filter((value) => value !== channel);
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

  const renderShortcutActionControls = (binding: ShortcutBinding, onPatch: (patch: Partial<ShortcutBinding>) => void): ReactNode => {
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
          <select value={channel} onChange={(event) => onPatch({ channel: event.currentTarget.value as ChannelKey })} className="shortcut-field shortcut-field-channel">
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
              onChange={(event) => onPatch({ step: Number(event.currentTarget.value) || 5 })}
              title="Step (%)"
            />
          )}
          {binding.action === "sonar_set_preset" && (
            <select value={binding.presetId ?? ""} onChange={(event) => onPatch({ presetId: event.currentTarget.value })} className="shortcut-field shortcut-field-preset">
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
            onChange={(event) => onPatch({ monitorId: Number(event.currentTarget.value) || undefined })}
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
              onChange={(event) => onPatch({ step: Number(event.currentTarget.value) || 5 })}
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
              onChange={(event) => onPatch({ brightness: Number(event.currentTarget.value) || 0 })}
              title="Brightness (%)"
            />
          )}
          {binding.action === "ddc_input_set" && (
            <select value={binding.inputSource ?? ""} onChange={(event) => onPatch({ inputSource: event.currentTarget.value })} className="shortcut-field shortcut-field-input">
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
      <SettingsSidebar activeTab={tab} onTabChange={setTab} />
      <div className="settings-content">
        {tab === "app" && (
          <AppSettingsTab
            settings={settings}
            shortcutDraft={shortcutDraft}
            serviceStatus={serviceStatus}
            onShortcutDraftChange={setShortcutDraft}
            onShortcutDraftCommit={() => onUpdate({ toggleShortcut: shortcutDraft })}
            onUpdate={onUpdate}
            onExportSettings={() => { void window.arctisBridge.exportSettings(); }}
            onImportSettings={() => { void window.arctisBridge.importSettings(); }}
          />
        )}

        {tab === "ggSonar" && <GgSonarSettingsTab settings={settings} onUpdate={onUpdate} onToggleChannel={toggleChannel} />}

        {tab === "oledService" && (
          <OledServiceSettingsTab settings={settings} oledServiceFrame={oledServiceFrame} onUpdate={onUpdate} />
        )}

        {tab === "notifications" && (
          <NotificationSettingsTab
            settings={settings}
            onUpdate={onUpdate}
            onToggleNotification={toggleNotification}
            onTestNotification={onTestNotification}
            onTestLowBatteryNotification={onTestLowBatteryNotification}
            onTestBatterySwapNotification={onTestBatterySwapNotification}
          />
        )}

        {tab === "autoPreset" && (
          <AutomaticPresetsSettingsTab
            settings={settings}
            sortedOpenApps={sortedOpenApps}
            appLabel={appLabel}
            appSelectLabel={appSelectLabel}
            isKnownApp={isKnownApp}
            availablePresetRows={availablePresetRows}
            onPatchRule={patchAutomaticPresetRule}
            onRemoveRule={removeAutomaticPresetRule}
            newPresetRule={newPresetRule}
            onNewPresetRuleChange={setNewPresetRule}
            onAddRule={addAutomaticPresetRule}
          />
        )}

        {tab === "shortcuts" && (
          <ShortcutsSettingsTab
            settings={settings}
            newShortcut={newShortcut}
            onNewShortcutChange={setNewShortcut}
            onAddShortcut={addShortcut}
            onShortcutKeyDown={onShortcutKeyDown}
            onApplyShortcutPatch={applyShortcutPatch}
            onRemoveShortcut={removeShortcut}
            withActionDefaults={withActionDefaults}
            renderShortcutActionControls={renderShortcutActionControls}
          />
        )}

        {tab === "ddc" && (
          <DdcSettingsTab
            settings={settings}
            ddcMonitors={ddcMonitors}
            ddcMonitorsUpdatedAt={ddcMonitorsUpdatedAt}
            ddcError={ddcError}
            dashboardMonitorId={dashboardMonitorId}
            dashboardSecondaryMonitorId={dashboardSecondaryMonitorId}
            knownInputCodes={knownInputCodes}
            primaryInputOptions={primaryInputOptions}
            secondaryInputOptions={secondaryInputOptions}
            onUpdate={onUpdate}
            onRefreshDdcMonitors={onRefreshDdcMonitors}
            monitorDisplayName={monitorDisplayName}
            monitorAliasValue={monitorAliasValue}
            setMonitorAlias={setMonitorAlias}
            selectedPrimaryMonitor={selectedPrimaryMonitor}
            selectedSecondaryMonitor={selectedSecondaryMonitor}
            inputLabel={inputLabel}
            resolveInputName={resolveInputName}
            setInputName={setInputName}
          />
        )}

        {tab === "about" && (
          <>
            <AboutSettingsTab lastStatus={lastStatus} lastError={lastError} serviceStatus={serviceStatus} logs={logs} />
            <p className="hint">Settings are saved in %APPDATA% userData JSON.</p>
          </>
        )}
      </div>
    </section>
  );
}

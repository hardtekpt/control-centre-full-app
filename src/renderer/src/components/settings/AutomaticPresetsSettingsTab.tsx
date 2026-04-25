import { CHANNELS, type AutomaticPresetRule, type ChannelKey, type RunningAppInfo, type UiSettings } from "@shared/types";

const MIN_POLL_MS = 100;
const MAX_POLL_MS = 5000;

export interface NewPresetRuleDraft {
  enabled: boolean;
  appId: string;
  channel: ChannelKey;
  presetId: string;
}

interface AutomaticPresetsSettingsTabProps {
  settings: UiSettings;
  sortedOpenApps: RunningAppInfo[];
  appLabel: (app: RunningAppInfo) => string;
  appSelectLabel: (appId: string) => string;
  isKnownApp: (appId: string) => boolean;
  availablePresetRows: (channel: ChannelKey) => Array<[string, string]>;
  onUpdate: (partial: Partial<UiSettings>) => void;
  onPatchRule: (id: string, patch: Partial<AutomaticPresetRule>) => void;
  onRemoveRule: (id: string) => void;
  newPresetRule: NewPresetRuleDraft;
  onNewPresetRuleChange: (next: NewPresetRuleDraft | ((previous: NewPresetRuleDraft) => NewPresetRuleDraft)) => void;
  onAddRule: () => void;
}

/**
 * App-to-preset automation rules for active-window preset switching.
 */
export default function AutomaticPresetsSettingsTab({
  settings,
  sortedOpenApps,
  appLabel,
  appSelectLabel,
  isKnownApp,
  availablePresetRows,
  onUpdate,
  onPatchRule,
  onRemoveRule,
  newPresetRule,
  onNewPresetRuleChange,
  onAddRule,
}: AutomaticPresetsSettingsTabProps) {
  return (
    <>
      <h3>Automatic Preset Switcher</h3>
      <p className="hint">Choose an open app and associated Sonar preset per channel. Rules are applied when the active window changes.</p>

      <div className="settings-section">
        <div className="settings-section-title">Detection</div>
        <label className="form-row" title="How often the active window is checked for preset rule matches">
          <span>Poll interval</span>
          <div className="accent-row">
            <input
              className="text-input"
              type="number"
              min={MIN_POLL_MS}
              max={MAX_POLL_MS}
              step={50}
              style={{ width: "65px" }}
              value={settings.services.presetSwitcherPollIntervalMs ?? 250}
              onChange={(event) => {
                const raw = Number(event.currentTarget.value);
                const clamped = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, raw || MIN_POLL_MS));
                onUpdate({ services: { ...settings.services, presetSwitcherPollIntervalMs: clamped } });
              }}
            />
            <span>ms</span>
          </div>
        </label>
      </div>
      <div className="shortcut-list">
        {settings.automaticPresetRules.length === 0 && <div className="hint">No automatic preset rules configured.</div>}
        {settings.automaticPresetRules.map((rule) => {
          const presetOptions = availablePresetRows(rule.channel);
          return (
            <div className="shortcut-row preset-rule-row" key={rule.id}>
              <input type="checkbox" checked={rule.enabled !== false} onChange={(event) => onPatchRule(rule.id, { enabled: event.currentTarget.checked })} title="Enabled" />
              <select className="shortcut-field shortcut-field-channel" value={rule.appId} onChange={(event) => onPatchRule(rule.id, { appId: event.currentTarget.value })}>
                {!isKnownApp(rule.appId) && rule.appId && <option value={rule.appId}>{appSelectLabel(rule.appId)}</option>}
                {sortedOpenApps.length === 0 && <option value="">No running apps detected</option>}
                {sortedOpenApps.map((app) => (
                  <option key={`${rule.id}-${app.id}`} value={app.id}>
                    {appLabel(app)}
                  </option>
                ))}
              </select>
              <select
                className="shortcut-field shortcut-field-channel"
                value={rule.channel}
                onChange={(event) => onPatchRule(rule.id, { channel: event.currentTarget.value as ChannelKey })}
              >
                {CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
              <select className="shortcut-field shortcut-field-preset" value={rule.presetId} onChange={(event) => onPatchRule(rule.id, { presetId: event.currentTarget.value })}>
                <option value="">Select preset</option>
                {presetOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              <button className="button shortcut-delete" onClick={() => onRemoveRule(rule.id)}>
                Remove
              </button>
            </div>
          );
        })}
      </div>

      <div className="shortcut-add">
        <h3>Add Rule</h3>
        <div className="shortcut-row preset-rule-row">
          <input type="checkbox" checked={newPresetRule.enabled} onChange={(event) => onNewPresetRuleChange((prev) => ({ ...prev, enabled: event.currentTarget.checked }))} />
          <select className="shortcut-field shortcut-field-channel" value={newPresetRule.appId} onChange={(event) => onNewPresetRuleChange((prev) => ({ ...prev, appId: event.currentTarget.value }))}>
            {!isKnownApp(newPresetRule.appId) && newPresetRule.appId && <option value={newPresetRule.appId}>{appSelectLabel(newPresetRule.appId)}</option>}
            {sortedOpenApps.length === 0 && <option value="">No running apps detected</option>}
            {sortedOpenApps.map((app) => (
              <option key={`new-${app.id}`} value={app.id}>
                {appLabel(app)}
              </option>
            ))}
          </select>
          <select
            className="shortcut-field shortcut-field-channel"
            value={newPresetRule.channel}
            onChange={(event) =>
              onNewPresetRuleChange((prev) => ({
                ...prev,
                channel: event.currentTarget.value as ChannelKey,
                presetId: "",
              }))
            }
          >
            {CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {channel}
              </option>
            ))}
          </select>
          <select className="shortcut-field shortcut-field-preset" value={newPresetRule.presetId} onChange={(event) => onNewPresetRuleChange((prev) => ({ ...prev, presetId: event.currentTarget.value }))}>
            <option value="">Select preset</option>
            {(availablePresetRows(newPresetRule.channel) ?? []).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <button className="button shortcut-add-btn" onClick={onAddRule}>
            Add
          </button>
        </div>
      </div>
    </>
  );
}

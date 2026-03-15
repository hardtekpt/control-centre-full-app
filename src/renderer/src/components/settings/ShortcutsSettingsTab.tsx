import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { ShortcutAction, ShortcutBinding, UiSettings } from "@shared/types";
import { SHORTCUT_ACTION_OPTIONS } from "./constants";

interface ShortcutsSettingsTabProps {
  settings: UiSettings;
  newShortcut: ShortcutBinding;
  onNewShortcutChange: (next: ShortcutBinding | ((previous: ShortcutBinding) => ShortcutBinding)) => void;
  onAddShortcut: () => void;
  onShortcutKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, apply: (value: string) => void) => void;
  onApplyShortcutPatch: (id: string, patch: Partial<ShortcutBinding>) => void;
  onRemoveShortcut: (id: string) => void;
  withActionDefaults: (binding: ShortcutBinding, action: ShortcutAction) => ShortcutBinding;
  renderShortcutActionControls: (binding: ShortcutBinding, onPatch: (patch: Partial<ShortcutBinding>) => void) => ReactNode;
}

/**
 * Keyboard shortcut bindings for Sonar and DDC actions.
 */
export default function ShortcutsSettingsTab({
  settings,
  newShortcut,
  onNewShortcutChange,
  onAddShortcut,
  onShortcutKeyDown,
  onApplyShortcutPatch,
  onRemoveShortcut,
  withActionDefaults,
  renderShortcutActionControls,
}: ShortcutsSettingsTabProps) {
  return (
    <>
      <h3>Shortcut Settings</h3>
      <p className="hint">Click a shortcut field and press the key combination to capture it.</p>

      <div className="shortcut-list">
        {settings.shortcuts.length === 0 && <div className="hint">No shortcuts configured.</div>}
        {settings.shortcuts.map((shortcut) => (
          <div className="shortcut-row" key={shortcut.id}>
            <input type="checkbox" checked={shortcut.enabled !== false} onChange={(event) => onApplyShortcutPatch(shortcut.id, { enabled: event.currentTarget.checked })} title="Enabled" />
            <input
              className="text-input shortcut-field shortcut-field-accelerator"
              value={shortcut.accelerator}
              placeholder="Press keys..."
              onKeyDown={(event) => onShortcutKeyDown(event, (value) => onApplyShortcutPatch(shortcut.id, { accelerator: value }))}
              readOnly
            />
            <select
              className="shortcut-field shortcut-field-action"
              value={shortcut.action}
              onChange={(event) => onApplyShortcutPatch(shortcut.id, withActionDefaults(shortcut, event.currentTarget.value as ShortcutAction))}
            >
              {SHORTCUT_ACTION_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {renderShortcutActionControls(shortcut, (patch) => onApplyShortcutPatch(shortcut.id, patch))}
            <button className="button shortcut-delete" onClick={() => onRemoveShortcut(shortcut.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="shortcut-add">
        <h3>Add Shortcut</h3>
        <div className="shortcut-row">
          <input type="checkbox" checked={newShortcut.enabled !== false} onChange={(event) => onNewShortcutChange((prev) => ({ ...prev, enabled: event.currentTarget.checked }))} />
          <input
            className="text-input shortcut-field shortcut-field-accelerator"
            value={newShortcut.accelerator}
            placeholder="Press keys..."
            onKeyDown={(event) => onShortcutKeyDown(event, (value) => onNewShortcutChange((prev) => ({ ...prev, accelerator: value })))}
            readOnly
          />
          <select
            className="shortcut-field shortcut-field-action"
            value={newShortcut.action}
            onChange={(event) => onNewShortcutChange((prev) => withActionDefaults(prev, event.currentTarget.value as ShortcutAction))}
          >
            {SHORTCUT_ACTION_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          {renderShortcutActionControls(newShortcut, (patch) => onNewShortcutChange((prev) => ({ ...prev, ...patch })))}
          <button className="button shortcut-add-btn" onClick={onAddShortcut}>
            Add
          </button>
        </div>
      </div>
    </>
  );
}

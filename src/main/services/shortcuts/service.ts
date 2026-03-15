import { globalShortcut } from "electron";

export interface ShortcutRegistration {
  id: string;
  accelerator: string;
  enabled?: boolean;
  trigger: () => void;
}

export interface ShortcutRegisterResult {
  registered: number;
  errors: string[];
}

export class ShortcutService {
  private readonly registered = new Set<string>();

  public register(entries: ShortcutRegistration[]): ShortcutRegisterResult {
    this.unregisterAll();
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const accelerator = String(entry.accelerator ?? "").trim();
      if (entry.enabled === false || !accelerator) {
        continue;
      }
      const dedupeKey = accelerator.toLowerCase();
      if (seen.has(dedupeKey)) {
        errors.push(`Duplicate shortcut ignored (${accelerator}).`);
        continue;
      }
      seen.add(dedupeKey);
      try {
        const ok = globalShortcut.register(accelerator, () => {
          try {
            entry.trigger();
          } catch {
            // Keep global shortcut callback resilient.
          }
        });
        if (!ok) {
          errors.push(`Unable to register shortcut (${accelerator}).`);
          continue;
        }
        this.registered.add(accelerator);
      } catch (err) {
        errors.push(`Invalid shortcut (${accelerator}): ${String(err)}`);
      }
    }
    return { registered: this.registered.size, errors };
  }

  public unregisterAll(): void {
    for (const accelerator of this.registered) {
      globalShortcut.unregister(accelerator);
    }
    this.registered.clear();
  }

  public getRegisteredCount(): number {
    return this.registered.size;
  }
}

export type NotificationTimerKey =
  | "headsetVolume"
  | "micMute"
  | "oled"
  | "sidetone"
  | "presetChange"
  | "usbInput"
  | "ancMode"
  | "connectivity"
  | "batteryLow"
  | "baseBatteryStatus";

export interface NotificationTimerService {
  clear: (key: NotificationTimerKey) => void;
  schedule: (key: NotificationTimerKey, delayMs: number, callback: () => void) => void;
  clearAll: () => void;
}

/**
 * Tracks notification timers by semantic key so main-process UI logic can stay declarative.
 */
export function createNotificationTimerService(): NotificationTimerService {
  const timers = new Map<NotificationTimerKey, NodeJS.Timeout>();

  /**
   * Clears a single timer and removes it from the map.
   */
  function clear(key: NotificationTimerKey): void {
    const existing = timers.get(key);
    if (!existing) {
      return;
    }
    clearTimeout(existing);
    timers.delete(key);
  }

  /**
   * Schedules a timer with a normalized delay and replaces any existing one for the same key.
   */
  function schedule(key: NotificationTimerKey, delayMs: number, callback: () => void): void {
    const existing = timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    const timeout = setTimeout(() => {
      timers.delete(key);
      callback();
    }, Math.max(0, Math.round(delayMs)));
    timers.set(key, timeout);
  }

  /**
   * Clears all active timers used by the notification subsystem.
   */
  function clearAll(): void {
    for (const timeout of timers.values()) {
      clearTimeout(timeout);
    }
    timers.clear();
  }

  return {
    clear,
    schedule,
    clearAll,
  };
}

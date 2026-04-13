import type { BrowserWindow } from "electron";
import type { AppState, UiSettings } from "../../shared/types";

interface NotificationWindows {
  headsetVolume: BrowserWindow | null;
  micMute: BrowserWindow | null;
  oled: BrowserWindow | null;
  sidetone: BrowserWindow | null;
  presetChange: BrowserWindow | null;
  usbInput: BrowserWindow | null;
  ancMode: BrowserWindow | null;
  connectivity: BrowserWindow | null;
  batteryLow: BrowserWindow | null;
  baseBatteryStatus: BrowserWindow | null;
}

export interface CreateSettingsIpcHandlerDeps {
  getSettings: () => UiSettings;
  persistSettings: (next: UiSettings) => UiSettings;
  applyRuntimeServiceSettings: (previous: UiSettings, next: UiSettings) => void;
  setPresetRules: (rules: UiSettings["automaticPresetRules"]) => void;
  restartDdcMonitorRefresh: () => void;
  onFlyoutSettingsChanged: () => void;
  getNotificationWindows: () => NotificationWindows;
  closeWindowIfOpen: (windowRef: BrowserWindow | null) => void;
  syncHeadsetVolumeNotification: (next: UiSettings, cachedState: AppState) => void;
  getCachedState: () => AppState;
  setCachedState: (state: AppState) => void;
  applyUsbInputInference: (state: AppState) => AppState;
  schedulePersist: () => void;
  broadcastState: (state: AppState) => void;
  broadcastSettings: (next: UiSettings) => void;
}

/**
 * Builds the settings IPC mutation handler with explicit dependencies.
 */
export function createSettingsIpcHandler(deps: CreateSettingsIpcHandlerDeps): (partial: Partial<UiSettings>) => UiSettings {
  const {
    getSettings,
    persistSettings,
    applyRuntimeServiceSettings,
    setPresetRules,
    restartDdcMonitorRefresh,
    onFlyoutSettingsChanged,
    getNotificationWindows,
    closeWindowIfOpen,
    syncHeadsetVolumeNotification,
    getCachedState,
    setCachedState,
    applyUsbInputInference,
    schedulePersist,
    broadcastState,
    broadcastSettings,
  } = deps;

  return (partial) => {
    const currentSettings = getSettings();
    const next = persistSettings({
      ...currentSettings,
      ...partial,
      notifications: {
        ...currentSettings.notifications,
        ...(partial.notifications ?? {}),
      },
      services: {
        ...currentSettings.services,
        ...(partial.services ?? {}),
      },
      baseStationOled: {
        ...currentSettings.baseStationOled,
        ...(partial.baseStationOled ?? {}),
      },
      ddc: {
        ...currentSettings.ddc,
        ...(partial.ddc ?? {}),
        monitorPrefs: {
          ...currentSettings.ddc.monitorPrefs,
          ...(partial.ddc?.monitorPrefs ?? {}),
        },
      },
    });

    if (next.automaticPresetRules !== currentSettings.automaticPresetRules) {
      setPresetRules(next.automaticPresetRules);
    }

    applyRuntimeServiceSettings(currentSettings, next);

    if (partial.ddc) {
      restartDdcMonitorRefresh();
    }

    onFlyoutSettingsChanged();

    const windows = getNotificationWindows();
    if (next.notifications.headsetVolume === false) {
      closeWindowIfOpen(windows.headsetVolume);
    } else {
      syncHeadsetVolumeNotification(next, getCachedState());
    }
    if (next.notifications.micMute === false) {
      closeWindowIfOpen(windows.micMute);
    }
    if (next.notifications.oled === false) {
      closeWindowIfOpen(windows.oled);
    }
    if (next.notifications.sidetone === false) {
      closeWindowIfOpen(windows.sidetone);
    }
    if (next.notifications.presetChange === false) {
      closeWindowIfOpen(windows.presetChange);
    }
    if (next.notifications.usbInput === false) {
      closeWindowIfOpen(windows.usbInput);
    }
    if (next.notifications.ancMode === false) {
      closeWindowIfOpen(windows.ancMode);
    }
    if (next.notifications.connectivity === false) {
      closeWindowIfOpen(windows.connectivity);
    }
    if (next.notifications.battery === false) {
      closeWindowIfOpen(windows.batteryLow);
      closeWindowIfOpen(windows.baseBatteryStatus);
    }

    const currentState = getCachedState();
    const inferredState = applyUsbInputInference(currentState);
    if (inferredState !== currentState) {
      setCachedState(inferredState);
      schedulePersist();
      broadcastState(inferredState);
    }

    broadcastSettings(next);
    return next;
  };
}

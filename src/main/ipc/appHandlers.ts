import type { BooleanOkResponse, OpenGgResponse } from "../../shared/ipc";

const GG_EXECUTABLE_PATHS = [
  "C:\\Program Files\\SteelSeries\\GG\\SteelSeriesGGClient.exe",
  "C:\\Program Files\\SteelSeries\\GG\\SteelSeriesGG.exe",
  "C:\\Program Files (x86)\\SteelSeries\\GG\\SteelSeriesGG.exe",
] as const;

export interface CreateAppIpcHandlersDeps {
  toNullablePercent: (value: number) => number | null;
  isHeadsetVolumeNotificationEnabled: () => boolean;
  showHeadsetVolumeNotification: (payload: { volume: number }) => Promise<void>;
  fileExists: (filePath: string) => boolean;
  openPath: (filePath: string) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  normalizeError: (error: unknown) => string;
  showSystemNotification: (title: string, body: string) => void;
  showCustomNotificationOnOled: (title: string, body: string) => void;
}

export interface AppIpcHandlers {
  previewHeadsetVolume: (payload: unknown) => void;
  openGg: () => Promise<OpenGgResponse>;
  notifyCustom: (payload: { title?: string; body?: string }) => Promise<BooleanOkResponse>;
}

/**
 * Creates app-focused IPC handlers that are independent from window lifecycle wiring.
 */
export function createAppIpcHandlers(deps: CreateAppIpcHandlersDeps): AppIpcHandlers {
  const {
    toNullablePercent,
    isHeadsetVolumeNotificationEnabled,
    showHeadsetVolumeNotification,
    fileExists,
    openPath,
    openExternal,
    normalizeError,
    showSystemNotification,
    showCustomNotificationOnOled,
  } = deps;

  /**
   * Opens SteelSeries GG from known install paths, then protocol fallback.
   */
  async function openGg(): Promise<OpenGgResponse> {
    for (const exePath of GG_EXECUTABLE_PATHS) {
      if (!fileExists(exePath)) {
        continue;
      }
      const openResult = await openPath(exePath);
      return { ok: openResult === "", detail: openResult || exePath };
    }

    try {
      await openExternal("steelseriesgg://");
      return { ok: true, detail: "steelseriesgg://" };
    } catch (error) {
      return { ok: false, detail: normalizeError(error) };
    }
  }

  return {
    previewHeadsetVolume: (payload) => {
      const volume = toNullablePercent(typeof payload === "number" ? payload : Number(payload));
      if (volume == null || !isHeadsetVolumeNotificationEnabled()) {
        return;
      }
      void showHeadsetVolumeNotification({ volume });
    },
    openGg,
    notifyCustom: async (payload) => {
      const title = String(payload?.title ?? "").trim() || "Control Centre";
      const body = String(payload?.body ?? "").trim() || "Notification";
      showSystemNotification(title, body);
      showCustomNotificationOnOled(title, body);
      return { ok: true };
    },
  };
}

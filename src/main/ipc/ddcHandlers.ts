import type { DdcGetMonitorsResponse, DdcMonitorPayload, DdcMutateMonitorResponse } from "../../shared/ipc";

interface DdcServiceLike {
  setBrightness(monitorId: number, value: number): unknown;
  setInputSource(monitorId: number, value: string): unknown;
}

export interface CreateDdcIpcHandlersDeps {
  fetchDdcMonitorsIfStale: (force?: boolean) => Promise<DdcMonitorPayload[]>;
  getDdcService: () => DdcServiceLike | null;
  getMonitorsCache: () => DdcMonitorPayload[];
  setMonitorsCache: (monitors: DdcMonitorPayload[]) => void;
  getMonitorsCacheTs: () => number;
  setMonitorsCacheTs: (timestamp: number) => void;
  getLastStatus: () => "unknown" | "ok" | "error";
  setLastStatus: (status: "unknown" | "ok" | "error") => void;
  getLastFailure: () => string;
  setLastFailure: (detail: string) => void;
  clampPercent: (value: number) => number;
  broadcastDdcUpdate: () => void;
  pushLog: (text: string) => void;
  normalizeError: (error: unknown) => string;
  debugDdc: (text: string) => void;
  ddcBaseUrl: () => string;
}

export interface DdcIpcHandlers {
  getDdcMonitors: () => Promise<DdcGetMonitorsResponse>;
  setDdcBrightness: (payload: { monitorId: number; value: number }) => Promise<DdcMutateMonitorResponse>;
  setDdcInputSource: (payload: { monitorId: number; value: string }) => Promise<DdcMutateMonitorResponse>;
}

/**
 * Creates DDC IPC handlers that coordinate cache updates and error/status tracking.
 */
export function createDdcIpcHandlers(deps: CreateDdcIpcHandlersDeps): DdcIpcHandlers {
  const {
    fetchDdcMonitorsIfStale,
    getDdcService,
    getMonitorsCache,
    setMonitorsCache,
    getMonitorsCacheTs,
    setMonitorsCacheTs,
    getLastStatus,
    setLastStatus,
    getLastFailure,
    setLastFailure,
    clampPercent,
    broadcastDdcUpdate,
    pushLog,
    normalizeError,
    debugDdc,
    ddcBaseUrl,
  } = deps;

  return {
    getDdcMonitors: async () => {
      debugDdc("ipc ddc:get-monitors begin");
      try {
        const monitors = await fetchDdcMonitorsIfStale(false);
        debugDdc(`ipc ddc:get-monitors ok count=${monitors.length}`);
        if (getLastStatus() !== "ok") {
          pushLog(`DDC backend reachable (${ddcBaseUrl()}).`);
        }
        setLastStatus("ok");
        setLastFailure("");
        return { ok: true, monitors, updatedAt: getMonitorsCacheTs() || null };
      } catch (error) {
        const detail = normalizeError(error);
        debugDdc(`ipc ddc:get-monitors error ${detail}`);
        if (getLastFailure() !== detail || getLastStatus() !== "error") {
          pushLog(`ERROR: DDC backend issue: ${detail}`);
        }
        setLastStatus("error");
        setLastFailure(detail);
        return { ok: false, monitors: [], error: detail, updatedAt: getMonitorsCacheTs() || null };
      }
    },
    setDdcBrightness: async (payload) => {
      const monitorId = Number(payload?.monitorId);
      const value = clampPercent(Number(payload?.value));
      debugDdc(`ipc ddc:set-brightness begin monitor=${monitorId} value=${value}`);
      if (!Number.isFinite(monitorId) || monitorId < 1) {
        debugDdc("ipc ddc:set-brightness rejected invalid monitor id");
        return { ok: false, error: "Invalid monitor id." };
      }
      try {
        const service = getDdcService();
        if (!service) {
          throw new Error("DDC native service is not initialized.");
        }
        const monitor = service.setBrightness(monitorId, value) as DdcMonitorPayload;
        const nextCache = [...getMonitorsCache().filter((item) => item.monitor_id !== monitorId), monitor].sort((a, b) => a.monitor_id - b.monitor_id);
        setMonitorsCache(nextCache);
        setMonitorsCacheTs(Date.now());
        broadcastDdcUpdate();
        pushLog(`DDC: monitor ${monitorId} brightness set to ${value}.`);
        debugDdc(`ipc ddc:set-brightness ok monitor=${monitorId}`);
        return { ok: true, monitor };
      } catch (error) {
        const detail = normalizeError(error);
        debugDdc(`ipc ddc:set-brightness error monitor=${monitorId} ${detail}`);
        pushLog(`ERROR: DDC set brightness failed for monitor ${monitorId}: ${detail}`);
        return { ok: false, error: detail };
      }
    },
    setDdcInputSource: async (payload) => {
      const monitorId = Number(payload?.monitorId);
      const value = String(payload?.value ?? "").trim();
      debugDdc(`ipc ddc:set-input-source begin monitor=${monitorId} value=${value}`);
      if (!Number.isFinite(monitorId) || monitorId < 1 || !value) {
        debugDdc("ipc ddc:set-input-source rejected invalid payload");
        return { ok: false, error: "Invalid monitor id or input value." };
      }
      try {
        const service = getDdcService();
        if (!service) {
          throw new Error("DDC native service is not initialized.");
        }
        const monitor = service.setInputSource(monitorId, value) as DdcMonitorPayload;
        const nextCache = [...getMonitorsCache().filter((item) => item.monitor_id !== monitorId), monitor].sort((a, b) => a.monitor_id - b.monitor_id);
        setMonitorsCache(nextCache);
        setMonitorsCacheTs(Date.now());
        broadcastDdcUpdate();
        pushLog(`DDC: monitor ${monitorId} input set to ${value}.`);
        debugDdc(`ipc ddc:set-input-source ok monitor=${monitorId}`);
        return { ok: true, monitor };
      } catch (error) {
        const detail = normalizeError(error);
        debugDdc(`ipc ddc:set-input-source error monitor=${monitorId} ${detail}`);
        pushLog(`ERROR: DDC set input failed for monitor ${monitorId}: ${detail}`);
        return { ok: false, error: detail };
      }
    },
  };
}

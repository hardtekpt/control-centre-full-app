import type { DdcGetMonitorsResponse, DdcMonitorPayload, DdcMutateMonitorResponse } from "../../shared/ipc";

interface DdcServiceLike {
  setBrightness(monitorId: number, value: number): unknown;
  setInputSource(monitorId: number, value: string): unknown;
}

type DdcQueueCommand =
  | { kind: "brightness"; monitorId: number; value: number }
  | { kind: "input"; monitorId: number; value: string };

/**
 * Serial command queue for DDC hardware writes.
 *
 * DDC/CI calls are synchronous and block the Node event loop for ~200–400 ms.
 * By deferring each command to the next event-loop iteration via setImmediate,
 * we allow other IPC messages to be processed before (and between) writes,
 * keeping the renderer responsive while commands drain in order.
 *
 * Brightness commands for the same monitor are coalesced: only the most-recent
 * value is kept in the queue, so a burst of rapid slider commits sends exactly
 * one hardware write per monitor.
 */
function createDdcQueue(execute: (cmd: DdcQueueCommand) => void): { enqueue(cmd: DdcQueueCommand): void } {
  const pending: DdcQueueCommand[] = [];
  let scheduled = false;

  function flush(): void {
    const cmd = pending.shift();
    if (!cmd) {
      scheduled = false;
      return;
    }
    try {
      execute(cmd);
    } catch {
      // errors are logged inside execute
    }
    if (pending.length > 0) {
      setImmediate(flush);
    } else {
      scheduled = false;
    }
  }

  return {
    enqueue(cmd: DdcQueueCommand): void {
      if (cmd.kind === "brightness") {
        for (let i = pending.length - 1; i >= 0; i--) {
          const item = pending[i];
          if (item.kind === "brightness" && item.monitorId === cmd.monitorId) {
            pending.splice(i, 1);
            break;
          }
        }
      }
      pending.push(cmd);
      if (!scheduled) {
        scheduled = true;
        setImmediate(flush);
      }
    },
  };
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

  /**
   * Inserts or replaces monitor in cache and keeps stable monitor id ordering.
   */
  function updateMonitorCache(monitorId: number, monitor: DdcMonitorPayload): void {
    const nextCache = [...getMonitorsCache().filter((item) => item.monitor_id !== monitorId), monitor].sort((a, b) => a.monitor_id - b.monitor_id);
    setMonitorsCache(nextCache);
    setMonitorsCacheTs(Date.now());
    broadcastDdcUpdate();
  }

  /**
   * Calls a DDC service method, updates the monitor cache, and returns a typed result.
   * Centralises the try/catch and log pattern shared by all mutating DDC handlers.
   */
  async function mutateDdcMonitor(
    monitorId: number,
    action: string,
    serviceCall: (service: DdcServiceLike) => unknown,
    successLog: string,
  ): Promise<DdcMutateMonitorResponse> {
    try {
      const service = getDdcService();
      if (!service) {
        throw new Error("DDC native service is not initialized.");
      }
      const monitor = serviceCall(service) as DdcMonitorPayload;
      updateMonitorCache(monitorId, monitor);
      pushLog(successLog);
      debugDdc(`ipc ${action} ok monitor=${monitorId}`);
      return { ok: true, monitor };
    } catch (error) {
      const detail = normalizeError(error);
      debugDdc(`ipc ${action} error monitor=${monitorId} ${detail}`);
      pushLog(`ERROR: DDC ${action} failed for monitor ${monitorId}: ${detail}`);
      return { ok: false, error: detail };
    }
  }

  const queue = createDdcQueue((cmd) => {
    if (cmd.kind === "brightness") {
      void mutateDdcMonitor(
        cmd.monitorId,
        "ddc:set-brightness",
        (svc) => svc.setBrightness(cmd.monitorId, cmd.value),
        `DDC: monitor ${cmd.monitorId} brightness set to ${cmd.value}.`,
      );
    } else {
      void mutateDdcMonitor(
        cmd.monitorId,
        "ddc:set-input-source",
        (svc) => svc.setInputSource(cmd.monitorId, cmd.value),
        `DDC: monitor ${cmd.monitorId} input set to ${cmd.value}.`,
      );
    }
  });

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
    setDdcBrightness: (payload): Promise<DdcMutateMonitorResponse> => {
      const monitorId = Number(payload?.monitorId);
      const value = clampPercent(Number(payload?.value));
      debugDdc(`ipc ddc:set-brightness enqueue monitor=${monitorId} value=${value}`);
      if (!Number.isFinite(monitorId) || monitorId < 1) {
        debugDdc("ipc ddc:set-brightness rejected invalid monitor id");
        return Promise.resolve({ ok: false, error: "Invalid monitor id." });
      }
      queue.enqueue({ kind: "brightness", monitorId, value });
      return Promise.resolve({ ok: true });
    },
    setDdcInputSource: (payload): Promise<DdcMutateMonitorResponse> => {
      const monitorId = Number(payload?.monitorId);
      const value = String(payload?.value ?? "").trim();
      debugDdc(`ipc ddc:set-input-source enqueue monitor=${monitorId} value=${value}`);
      if (!Number.isFinite(monitorId) || monitorId < 1 || !value) {
        debugDdc("ipc ddc:set-input-source rejected invalid payload");
        return Promise.resolve({ ok: false, error: "Invalid monitor id or input value." });
      }
      queue.enqueue({ kind: "input", monitorId, value });
      return Promise.resolve({ ok: true });
    },
  };
}

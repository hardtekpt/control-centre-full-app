import type { BooleanOkResponse, MixerDataPayload } from "../../shared/ipc";

interface MixerOutput {
  id: string;
  name: string;
}

interface MixerApp {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

export interface CreateMixerIpcHandlersDeps {
  getMixerOutputs: () => Promise<MixerOutput[]>;
  getMixerApps: () => MixerApp[];
  getSelectedOutputId: () => string | null;
  setSelectedOutputId: (outputId: string | null) => void;
  setAppVolume: (appId: string, volume: number) => void;
  setAppMuted: (appId: string, muted: boolean) => void;
  clampPercent: (value: number) => number;
  schedulePersist: () => void;
}

export interface MixerIpcHandlers {
  getMixerData: () => Promise<MixerDataPayload>;
  setMixerOutput: (outputId: string) => BooleanOkResponse;
  setMixerAppVolume: (payload: { appId: string; volume: number }) => BooleanOkResponse;
  setMixerAppMute: (payload: { appId: string; muted: boolean }) => BooleanOkResponse;
}

/**
 * Creates all mixer IPC handlers around a simple state access interface.
 */
export function createMixerIpcHandlers(deps: CreateMixerIpcHandlersDeps): MixerIpcHandlers {
  const {
    getMixerOutputs,
    getMixerApps,
    getSelectedOutputId,
    setSelectedOutputId,
    setAppVolume,
    setAppMuted,
    clampPercent,
    schedulePersist,
  } = deps;

  return {
    getMixerData: async () => {
      const outputs = await getMixerOutputs();
      const current = getSelectedOutputId();
      const selectedOutputId = current && outputs.some((output) => output.id === current) ? current : outputs[0]?.id ?? "default";
      if (selectedOutputId !== current) {
        setSelectedOutputId(selectedOutputId);
        schedulePersist();
      }
      return { outputs, selectedOutputId, apps: getMixerApps() };
    },
    setMixerOutput: (outputId) => {
      setSelectedOutputId(String(outputId || "").trim() || null);
      schedulePersist();
      return { ok: true };
    },
    setMixerAppVolume: (payload) => {
      const appId = String(payload?.appId || "").trim();
      if (!appId) {
        return { ok: false };
      }
      setAppVolume(appId, clampPercent(Number(payload.volume)));
      schedulePersist();
      return { ok: true };
    },
    setMixerAppMute: (payload) => {
      const appId = String(payload?.appId || "").trim();
      if (!appId) {
        return { ok: false };
      }
      setAppMuted(appId, Boolean(payload.muted));
      schedulePersist();
      return { ok: true };
    },
  };
}

/// <reference types="vite/client" />

import type { AppState, BackendCommand, PresetMap, UiSettings } from "@shared/types";

declare global {
  interface Window {
    arctisBridge: {
      getInitial: () => Promise<{
        state: AppState;
        presets: PresetMap;
        settings: UiSettings;
        theme: { isDark: boolean; accent: string };
        status: string;
        error: string | null;
        logs: string[];
        ddcMonitors: Array<{
          monitor_id: number;
          name: string;
          brightness: number | null;
          input_source: string | null;
          available_inputs: string[];
          contrast: number | null;
          power_mode: string | null;
          supports: string[];
        }>;
        ddcMonitorsUpdatedAt: number | null;
        flyoutPinned: boolean;
        serviceStatus: {
          arctisApi: { state: "starting" | "running" | "error" | "stopped"; detail: string };
          ddcApi: {
            state: "starting" | "running" | "error" | "stopped";
            detail: string;
            endpoint: string;
            managed: boolean;
            pid: number | null;
          };
        };
      }>;
      getServiceStatus: () => Promise<{
        arctisApi: { state: "starting" | "running" | "error" | "stopped"; detail: string };
        ddcApi: {
          state: "starting" | "running" | "error" | "stopped";
          detail: string;
          endpoint: string;
          managed: boolean;
          pid: number | null;
        };
      }>;
      openGG: () => Promise<{ ok: boolean; detail: string }>;
      notifyCustom: (title: string, body: string) => Promise<{ ok: boolean }>;
      getMixerData: () => Promise<{
        outputs: Array<{ id: string; name: string }>;
        selectedOutputId: string;
        apps: Array<{ id: string; name: string; volume: number; muted: boolean }>;
      }>;
      setMixerOutput: (outputId: string) => Promise<{ ok: boolean }>;
      setMixerAppVolume: (appId: string, volume: number) => Promise<{ ok: boolean }>;
      setMixerAppMute: (appId: string, muted: boolean) => Promise<{ ok: boolean }>;
      getDdcMonitors: () => Promise<{
        ok: boolean;
        monitors: Array<{
          monitor_id: number;
          name: string;
          brightness: number | null;
          input_source: string | null;
          available_inputs: string[];
          contrast: number | null;
          power_mode: string | null;
          supports: string[];
        }>;
        updatedAt?: number | null;
        error?: string;
      }>;
      setDdcBrightness: (
        monitorId: number,
        value: number,
      ) => Promise<{
        ok: boolean;
        monitor?: {
          monitor_id: number;
          name: string;
          brightness: number | null;
          input_source: string | null;
          available_inputs: string[];
          contrast: number | null;
          power_mode: string | null;
          supports: string[];
        };
        error?: string;
      }>;
      setDdcInputSource: (
        monitorId: number,
        value: string,
      ) => Promise<{
        ok: boolean;
        monitor?: {
          monitor_id: number;
          name: string;
          brightness: number | null;
          input_source: string | null;
          available_inputs: string[];
          contrast: number | null;
          power_mode: string | null;
          supports: string[];
        };
        error?: string;
      }>;
      sendCommand: (cmd: BackendCommand) => void;
      closeCurrentWindow: () => void;
      openSettingsWindow: () => void;
      setFlyoutPinned: (pinned: boolean) => Promise<{ ok: boolean; pinned: boolean }>;
      setSettings: (settings: Partial<UiSettings>) => Promise<UiSettings>;
      onState: (cb: (state: AppState) => void) => () => void;
      onPresets: (cb: (presets: PresetMap) => void) => () => void;
      onStatus: (cb: (text: string) => void) => () => void;
      onError: (cb: (text: string) => void) => () => void;
      onTheme: (cb: (payload: { isDark: boolean; accent: string }) => void) => () => void;
      onSettings: (cb: (payload: UiSettings) => void) => () => void;
      onLog: (cb: (line: string) => void) => () => void;
      onDdcUpdate: (
        cb: (monitors: Array<{
          monitor_id: number;
          name: string;
          brightness: number | null;
          input_source: string | null;
          available_inputs: string[];
          contrast: number | null;
          power_mode: string | null;
          supports: string[];
        }>) => void,
      ) => () => void;
    };
  }
}

export {};

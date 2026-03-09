import { useEffect, useMemo, useRef, useState } from "react";
import { CHANNELS, type AppState, type PresetMap, type RunningAppInfo, type UiSettings } from "@shared/types";
import { mergeState } from "@shared/settings";

export interface MixerApp {
  id: string;
  name: string;
  volume: number;
  muted: boolean;
}

export interface MixerData {
  outputs: Array<{ id: string; name: string }>;
  selectedOutputId: string;
  apps: MixerApp[];
}

function clampPercent(value: number): number {
  const numeric = Number(value);
  return Math.max(0, Math.min(100, Math.floor(Number.isFinite(numeric) ? numeric : 0)));
}

export interface DdcMonitor {
  monitor_id: number;
  name: string;
  brightness: number | null;
  input_source: string | null;
  available_inputs: string[];
  contrast: number | null;
  power_mode: string | null;
  supports: string[];
}

export interface ServiceStatus {
  arctisApi: { state: "starting" | "running" | "error" | "stopped"; detail: string };
  ddcApi: {
    state: "starting" | "running" | "error" | "stopped";
    detail: string;
    endpoint: string;
    managed: boolean;
    pid: number | null;
  };
}

export function useBridgeState() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<AppState>(mergeState());
  const [presets, setPresets] = useState<PresetMap>({});
  const [settings, setSettingsState] = useState<UiSettings | null>(null);
  const [status, setStatus] = useState("ready");
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState({ isDark: true, accent: "#6ab7ff" });
  const [openApps, setOpenApps] = useState<RunningAppInfo[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [mixerData, setMixerData] = useState<MixerData>({ outputs: [], selectedOutputId: "default", apps: [] });
  const [ddcMonitors, setDdcMonitors] = useState<DdcMonitor[]>([]);
  const [ddcMonitorsUpdatedAt, setDdcMonitorsUpdatedAt] = useState<number | null>(null);
  const [ddcError, setDdcError] = useState<string | null>(null);
  const [flyoutPinned, setFlyoutPinned] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>({
    arctisApi: { state: "starting", detail: "Initializing..." },
    ddcApi: { state: "starting", detail: "Initializing...", endpoint: "", managed: false, pid: null },
  });
  // Short per-channel write lock so backend echoes do not immediately overwrite
  // optimistic UI edits while Sonar applies the change.
  const lockedUntilRef = useRef<Record<string, number>>({});
  const addLog = (text: string) =>
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${text}`, ...prev].slice(0, 200));
  const upsertDdcMonitor = (nextMonitor: DdcMonitor) => {
    setDdcMonitors((prev) => {
      const next = [...prev.filter((item) => item.monitor_id !== nextMonitor.monitor_id), nextMonitor].sort((a, b) => a.monitor_id - b.monitor_id);
      return next;
    });
    setDdcMonitorsUpdatedAt(Date.now());
  };
  const windowMode = useMemo(() => {
    const mode = new URLSearchParams(window.location.search).get("window");
    if (mode === "settings") {
      return mode;
    }
    return "dashboard";
  }, []);

  useEffect(() => {
    let disposed = false;
    window.arctisBridge.getInitial().then(async (payload) => {
      if (disposed) return;
      setState(mergeState(payload.state));
      setPresets(payload.presets ?? {});
      setSettingsState(payload.settings);
      setOpenApps(Array.isArray(payload.openApps) ? payload.openApps : []);
      setTheme(payload.theme);
      setStatus(payload.status ?? "ready");
      setError(payload.error ?? null);
      setLogs(Array.isArray(payload.logs) ? payload.logs : []);
      setDdcMonitors(Array.isArray(payload.ddcMonitors) ? payload.ddcMonitors : []);
      setDdcMonitorsUpdatedAt(Number.isFinite(payload.ddcMonitorsUpdatedAt) ? Number(payload.ddcMonitorsUpdatedAt) : null);
      setDdcError(null);
      setFlyoutPinned(Boolean(payload.flyoutPinned));
      if (payload.serviceStatus) {
        setServiceStatus(payload.serviceStatus);
      }
      setReady(true);
      if (windowMode === "dashboard") {
        const mixer = await window.arctisBridge.getMixerData().catch(() => null);
        if (disposed) return;
        if (mixer) {
          setMixerData(mixer);
        }
      }
    });
    const offState = window.arctisBridge.onState((next) => {
      setState((prev) => {
        const merged = mergeState(next);
        const now = Date.now();
        const lockedUntil = lockedUntilRef.current;
        for (const ch of CHANNELS) {
          if ((lockedUntil[ch] ?? 0) > now) {
            merged.channel_volume[ch] = prev.channel_volume[ch];
            merged.channel_mute[ch] = prev.channel_mute[ch];
            merged.channel_preset[ch] = prev.channel_preset[ch];
          }
        }
        return merged;
      });
    });
    const offPresets = window.arctisBridge.onPresets((next) => setPresets(next));
    const offStatus = window.arctisBridge.onStatus((text) => {
      setError(null);
      setStatus(text);
      addLog(text);
    });
    const offError = window.arctisBridge.onError((text) => {
      setError(text);
      setStatus(text);
      addLog(`ERROR: ${text}`);
    });
    const offTheme = window.arctisBridge.onTheme((next) => setTheme(next));
    const offSettings = window.arctisBridge.onSettings((next) => setSettingsState(next));
    const offLog = window.arctisBridge.onLog((line) => {
      setLogs((prev) => [line, ...prev].slice(0, 200));
    });
    const offOpenApps = window.arctisBridge.onOpenApps((apps) => {
      setOpenApps(Array.isArray(apps) ? apps : []);
    });
    const offDdc = window.arctisBridge.onDdcUpdate((monitors) => {
      setDdcMonitors(Array.isArray(monitors) ? monitors : []);
      setDdcMonitorsUpdatedAt(Date.now());
      setDdcError(null);
    });
    return () => {
      disposed = true;
      offState();
      offPresets();
      offStatus();
      offError();
      offTheme();
      offSettings();
      offLog();
      offOpenApps();
      offDdc();
    };
  }, [windowMode]);

  useEffect(() => {
    if (!ready || windowMode === "dashboard") {
      return;
    }
    const timer = window.setInterval(() => {
      window.arctisBridge.getServiceStatus().then((next) => setServiceStatus(next)).catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [ready, windowMode]);

  useEffect(() => {
    if (!ready || windowMode === "dashboard") {
      return;
    }
    window.arctisBridge.getDdcMonitors().then((result) => {
      setDdcMonitors(Array.isArray(result.monitors) ? result.monitors : []);
      setDdcMonitorsUpdatedAt(Number.isFinite(result.updatedAt) ? Number(result.updatedAt) : null);
      setDdcError(result.ok ? null : (result.error ?? "Unable to fetch DDC monitor data."));
    }).catch((err) => {
      setDdcError(err instanceof Error ? err.message : String(err));
    });
  }, [ready, windowMode]);

  useEffect(() => {
    if (!settings) return;
    const isDark = settings.themeMode === "system" ? theme.isDark : settings.themeMode === "dark";
    const accent = settings.accentColor.trim() ? settings.accentColor : theme.accent;
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.style.setProperty("--system-accent-color", accent);
    document.documentElement.style.setProperty("--system-accent-medium", accent);
    document.documentElement.style.setProperty("--system-accent-dark1", accent);
    document.documentElement.style.setProperty("--ui-scale", `${Math.max(80, Math.min(140, settings.textScale)) / 100}`);
  }, [theme, settings]);

  const persistSettings = async (partial: Partial<UiSettings>) => {
    const next = await window.arctisBridge.setSettings(partial);
    setSettingsState(next);
    return next;
  };

  const lockChannel = (channel: string, ms = 1000) => {
    lockedUntilRef.current[channel] = Date.now() + ms;
  };

  const actions = useMemo(
    () => ({
      setChannelVolume: (channel: string, value: number) => {
        lockChannel(channel, 1200);
        setState((prev) => ({
          ...prev,
          channel_volume: { ...prev.channel_volume, [channel]: value },
        }));
        window.arctisBridge.sendCommand({
          name: "set_channel_volume",
          payload: { channel, value },
        });
      },
      previewHeadsetVolume: (channel: string, value: number) => {
        if (channel !== "master") {
          return;
        }
        window.arctisBridge.notifyHeadsetVolumePreview(clampPercent(value));
      },
      setChannelMute: (channel: string, value: boolean) => {
        lockChannel(channel, 1000);
        setState((prev) => ({
          ...prev,
          channel_mute: { ...prev.channel_mute, [channel]: value },
        }));
        window.arctisBridge.sendCommand({
          name: "set_channel_mute",
          payload: { channel, value },
        });
      },
      setPreset: (channel: string, preset_id: string) => {
        lockChannel(channel, 1200);
        setState((prev) => ({
          ...prev,
          channel_preset: { ...prev.channel_preset, [channel]: preset_id },
        }));
        window.arctisBridge.sendCommand({
          name: "set_preset",
          payload: { channel, preset_id },
        });
      },
      closeCurrentWindow: () => window.arctisBridge.closeCurrentWindow(),
      openSettingsWindow: () => window.arctisBridge.openSettingsWindow(),
      setFlyoutPinned: async (pinned: boolean) => {
        const result = await window.arctisBridge.setFlyoutPinned(Boolean(pinned));
        setFlyoutPinned(Boolean(result?.pinned));
      },
      openGG: async () => {
        const result = await window.arctisBridge.openGG();
        if (!result.ok) {
          addLog(`ERROR: Failed to open SteelSeries GG (${result.detail})`);
        }
      },
      notifyCustom: async (title: string, body: string) => {
        await window.arctisBridge.notifyCustom(title, body);
      },
      notifyBatteryLowTest: async () => {
        await window.arctisBridge.notifyBatteryLowTest();
      },
      notifyBatterySwapTest: async () => {
        await window.arctisBridge.notifyBatterySwapTest();
      },
      refreshDdcMonitors: async () => {
        const result = await window.arctisBridge.getDdcMonitors();
        setDdcMonitors(Array.isArray(result.monitors) ? result.monitors : []);
        setDdcMonitorsUpdatedAt(Number.isFinite(result.updatedAt) ? Number(result.updatedAt) : null);
        setDdcError(result.ok ? null : (result.error ?? "Unable to fetch DDC monitor data."));
      },
      refreshMixer: async () => {
        const mixer = await window.arctisBridge.getMixerData();
        setMixerData(mixer);
      },
      setMixerOutput: async (outputId: string) => {
        await window.arctisBridge.setMixerOutput(outputId);
        setMixerData((prev) => ({ ...prev, selectedOutputId: outputId }));
      },
      setMixerAppVolume: async (appId: string, volume: number) => {
        setMixerData((prev) => ({
          ...prev,
          apps: prev.apps.map((app) => (app.id === appId ? { ...app, volume } : app)),
        }));
        await window.arctisBridge.setMixerAppVolume(appId, volume);
      },
      setMixerAppMute: async (appId: string, muted: boolean) => {
        setMixerData((prev) => ({
          ...prev,
          apps: prev.apps.map((app) => (app.id === appId ? { ...app, muted } : app)),
        }));
        await window.arctisBridge.setMixerAppMute(appId, muted);
      },
      setDdcBrightness: async (monitorId: number, value: number) => {
        const result = await window.arctisBridge.setDdcBrightness(monitorId, value);
        if (result.ok && result.monitor) {
          upsertDdcMonitor(result.monitor);
          setDdcError(null);
          return;
        }
        setDdcError(result.error ?? "Unable to set monitor brightness.");
      },
      setDdcInputSource: async (monitorId: number, value: string) => {
        const result = await window.arctisBridge.setDdcInputSource(monitorId, value);
        if (result.ok && result.monitor) {
          upsertDdcMonitor(result.monitor);
          setDdcError(null);
          return;
        }
        setDdcError(result.error ?? "Unable to set monitor input source.");
      },
      persistSettings,
    }),
    [settings],
  );

  return {
    ready,
    state,
    presets,
    settings,
    status,
    error,
    logs,
    mixerData,
    ddcMonitors,
    ddcMonitorsUpdatedAt,
    ddcError,
    flyoutPinned,
    openApps,
    serviceStatus,
    actions,
    theme,
  };
}

import { execFile } from "node:child_process";
import type { AutomaticPresetRule, ChannelKey, PresetMap, RunningAppInfo } from "../../../shared/types";

export interface PresetSwitcherServiceConfig {
  getCurrentPreset: (channel: ChannelKey) => string | null | undefined;
  getPresetMap: () => PresetMap;
  applyPreset: (channel: ChannelKey, presetId: string) => void;
  onAppsUpdate?: (apps: RunningAppInfo[]) => void;
  onActiveAppUpdate?: (app: RunningAppInfo | null) => void;
  onLog?: (message: string) => void;
  pollIntervalMs?: number;
}

export interface PresetSwitcherState {
  activeApp: RunningAppInfo | null;
  apps: RunningAppInfo[];
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_COMMAND_TIMEOUT_MS = 2500;

export class PresetSwitcherService {
  private rules: AutomaticPresetRule[] = [];
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private openAppsRefreshAt = 0;
  private config: PresetSwitcherServiceConfig &
    Required<Pick<PresetSwitcherServiceConfig, "onLog" | "onAppsUpdate" | "onActiveAppUpdate" | "pollIntervalMs">>;
  private openApps: RunningAppInfo[] = [];
  private activeApp: RunningAppInfo | null = null;
  private activeAppsHash = "";
  private lastAppliedByChannel: Partial<Record<ChannelKey, string>> = {};
  private pollIntervalMs: number;
  private openAppsPollIntervalMs: number;

  public constructor(config: PresetSwitcherServiceConfig) {
    this.config = {
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      ...config,
      onLog: config.onLog ?? (() => undefined),
      onAppsUpdate: config.onAppsUpdate ?? (() => undefined),
      onActiveAppUpdate: config.onActiveAppUpdate ?? (() => undefined),
    };
    this.pollIntervalMs = this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.openAppsPollIntervalMs = Math.max(2_000, this.pollIntervalMs * 10);
  }

  public start(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollOnce();
    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public isRunning(): boolean {
    return Boolean(this.pollTimer);
  }

  public setRules(next: AutomaticPresetRule[]): void {
    this.rules = next ?? [];
    this.lastAppliedByChannel = {};
    this.emitOpenApps();
    if (this.activeApp) {
      void this.applyRulesForActiveApp(this.activeApp);
    }
  }

  public getState(): PresetSwitcherState {
    return {
      activeApp: this.activeApp,
      apps: [...this.openApps],
    };
  }

  private async pollOnce(): Promise<void> {
    if (this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    try {
      const nextActive = await this.queryActiveApp();
      const shouldRefreshOpenApps = Date.now() >= this.openAppsRefreshAt + this.openAppsPollIntervalMs;
      const nextApps = shouldRefreshOpenApps ? await this.queryOpenApps() : this.openApps;
      let changed = false;
      if (!sameApp(nextActive, this.activeApp)) {
        this.activeApp = nextActive;
        changed = true;
        this.config.onActiveAppUpdate(this.activeApp);
      }
      if (changed && nextActive) {
        this.lastAppliedByChannel = {};
        await this.applyRulesForActiveApp(nextActive);
      }
      if (shouldRefreshOpenApps) {
        const nextHash = hashApps(nextApps);
        if (nextHash !== this.activeAppsHash) {
          this.openApps = nextApps;
          this.activeAppsHash = nextHash;
          this.emitOpenApps();
        }
        this.openAppsRefreshAt = Date.now();
      }
    } catch (err) {
      this.config.onLog(`Automatic preset switcher poll failed: ${String(err)}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async queryActiveApp(): Promise<RunningAppInfo | null> {
    if (process.platform !== "win32") {
      return null;
    }
    const query = `
$ErrorActionPreference = "SilentlyContinue"
$resultScript = @"
using System;
using System.Runtime.InteropServices;
public static class NativeForegroundWindow {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@;
if (-not ("NativeForegroundWindow" -as [type])) {
  Add-Type -TypeDefinition $resultScript
}

$activePid = 0
$foregroundHandle = [NativeForegroundWindow]::GetForegroundWindow()
[void][NativeForegroundWindow]::GetWindowThreadProcessId($foregroundHandle, [ref]$activePid)

$active = @{ id = ""; name = ""; title = ""; executable = "" }
if ($activePid -gt 0) {
  $activeProcess = Get-Process -Id $activePid -ErrorAction SilentlyContinue
  if ($activeProcess) {
    $executable = ""
    try {
      if ($activeProcess.Path) {
        $exe = [System.IO.Path]::GetFileNameWithoutExtension($activeProcess.Path)
        if (![string]::IsNullOrWhiteSpace($exe)) {
          $executable = $exe
        }
      }
    } catch {}
    if ([string]::IsNullOrWhiteSpace($executable)) {
      $executable = [string]$activeProcess.ProcessName
    }
    $active = @{
      id = $executable.ToLowerInvariant()
      name = [string]$activeProcess.ProcessName
      title = [string]$activeProcess.MainWindowTitle
      executable = [string]$executable
    }
  }
}

[pscustomobject]@{
  active = $active
} | ConvertTo-Json -Depth 3 -Compress
`;
    const result = await runPowerShell(query, { timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS });
    if (!result) {
      return null;
    }
    const parsed = JSON.parse(result) as { active?: Record<string, unknown> };
    return sanitizeRunningApp(parsed?.active);
  }

  private async queryOpenApps(): Promise<RunningAppInfo[]> {
    if (process.platform !== "win32") {
      return [];
    }
    const query = `
$ErrorActionPreference = "SilentlyContinue"

$windowedProcesses = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Select-Object ProcessName, MainWindowTitle, Path

$seen = @{}
$apps = @()
foreach ($item in $windowedProcesses) {
  $exe = ""
  try {
    if ($item.Path) {
      $resolved = [System.IO.Path]::GetFileNameWithoutExtension($item.Path)
      if (![string]::IsNullOrWhiteSpace($resolved)) {
        $exe = $resolved
      }
    }
  } catch {}
  if ([string]::IsNullOrWhiteSpace($exe)) {
    $exe = [string]$item.ProcessName
  }
  $id = $exe.ToLowerInvariant()
  if (-not $seen.ContainsKey($id)) {
    $seen[$id] = $true
    $apps += @{
      id = $id
      name = [string]$item.ProcessName
      title = [string]$item.MainWindowTitle
      executable = [string]$exe
    }
  }
}

$apps = $apps |
  Sort-Object -Property name

$apps | ConvertTo-Json -Depth 3 -Compress
`;
    const result = await runPowerShell(query, { timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS });
    if (!result) {
      return this.openApps;
    }
    const parsed = JSON.parse(result) as Array<Record<string, unknown>>;
    const apps = Array.isArray(parsed) ? parsed.map((app) => sanitizeRunningApp(app)).filter((app): app is RunningAppInfo => Boolean(app)) : [];
    return dedupeOpenApps(apps);
  }

  private async applyRulesForActiveApp(activeApp: RunningAppInfo): Promise<void> {
    if (!activeApp.id) {
      return;
    }
    const presets = this.config.getPresetMap();
    const channelTargets: Partial<Record<ChannelKey, string>> = {};
    for (const rule of this.rules) {
      if (!rule.enabled || !rule.presetId || rule.appId !== activeApp.id) {
        continue;
      }
      if (!presets[rule.channel]?.some(([id]: [string, string]) => id === rule.presetId)) {
        continue;
      }
      channelTargets[rule.channel] = rule.presetId;
    }
    for (const [channel, presetId] of Object.entries(channelTargets) as Array<[ChannelKey, string]>) {
      const current = sanitizePreset(this.config.getCurrentPreset(channel));
      const signature = `${activeApp.id}:${channel}:${presetId}`;
      if (current === presetId && this.lastAppliedByChannel[channel] === signature) {
        continue;
      }
      if (current !== presetId) {
        this.config.applyPreset(channel, presetId);
        this.lastAppliedByChannel[channel] = signature;
      } else {
        this.lastAppliedByChannel[channel] = signature;
      }
    }
  }

  private emitOpenApps(): void {
    this.config.onAppsUpdate(this.openApps);
  }

  public async refreshNow(): Promise<void> {
    await this.pollOnce();
  }
}

function sanitizeRunningApp(value: Record<string, unknown> | undefined | null): RunningAppInfo | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const id = String(value.id ?? value.executable ?? value.name ?? "").trim().toLowerCase();
  if (!id) {
    return null;
  }
  const executable = String(value.executable ?? id).trim();
  const name = String(value.name ?? id).trim();
  const title = String(value.title ?? "").trim();
  return {
    id,
    name: name || id,
    title,
    executable: executable || id,
  };
}

function sameApp(a: RunningAppInfo | null, b: RunningAppInfo | null): boolean {
  if (!a || !b) {
    return a === b;
  }
  return a.id === b.id && a.title === b.title;
}

function dedupeOpenApps(apps: RunningAppInfo[]): RunningAppInfo[] {
  const seen = new Set<string>();
  const out: RunningAppInfo[] = [];
  for (const app of apps) {
    if (!app.id) {
      continue;
    }
    if (seen.has(app.id)) {
      continue;
    }
    seen.add(app.id);
    out.push(app);
  }
  return out;
}

function hashApps(apps: RunningAppInfo[]): string {
  return apps
    .map((item) => `${item.id}|||${item.name}|||${item.title}`)
    .sort()
    .join("|");
}

function sanitizePreset(value: string | null | undefined): string | null {
  const next = String(value ?? "").trim();
  return next || null;
}

function runPowerShell(script: string, options: { timeoutMs: number }): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: options.timeoutMs },
      (err, stdout) => {
        if (err || !stdout) {
          resolve(null);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export default PresetSwitcherService;

import * as path from "node:path";

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

export interface DdcStatus {
  state: "starting" | "running" | "error" | "stopped";
  detail: string;
  endpoint: string;
  managed: boolean;
  pid: number | null;
}

type DdcciModule = {
  vcp?: Record<string, number>;
  getAllMonitors: (method?: string, usePreviousResults?: boolean, checkHighLevel?: boolean) => any[];
  getVCP: (monitorId: string, code: number) => any;
  setVCP: (monitorId: string, code: number, value: number) => void;
  _getVCP?: (monitorId: string, code: number) => any;
  _setVCP?: (monitorId: string, code: number, value: number) => any;
  getBrightness: (monitorId: string) => number;
  setBrightness: (monitorId: string, level: number) => void;
  getContrast?: (monitorId: string) => number;
  setContrast?: (monitorId: string, level: number) => void;
  getMonitorInputs?: (monitorId: string) => any;
  getCapabilities?: (monitorId: string) => Record<string, number[]> | false;
};

interface DdcBackend {
  name: string;
  listMonitors(): DdcMonitor[];
  setBrightness(monitorId: number, value: number): DdcMonitor;
  setInputSource(monitorId: number, value: string): DdcMonitor;
}

class NativeDdcciBackend implements DdcBackend {
  public name = "native-ddcci";
  private readonly ddcci: DdcciModule;
  private monitorKeyById = new Map<number, string>();
  private monitorCandidatesById = new Map<number, string[]>();

  constructor(ddcci: DdcciModule) {
    this.ddcci = ddcci;
  }

  public listMonitors(): DdcMonitor[] {
    const rows = this.ddcci.getAllMonitors("accurate", false, true) ?? [];
    const out: DdcMonitor[] = [];
    this.monitorKeyById.clear();
    this.monitorCandidatesById.clear();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] ?? {};
      const monitorId = i + 1;
      const candidates = this.resolveMonitorCandidates(row);
      this.monitorCandidatesById.set(monitorId, candidates);

      let preferredKey = candidates[0] ?? String(monitorId);
      const brightnessRead = this.readVcpWithCandidates(candidates, 0x10);
      if (brightnessRead.key) {
        preferredKey = brightnessRead.key;
      }
      const contrastRead = this.readNumberWithCandidates(candidates, (key) => this.ddcci.getContrast?.(key) ?? this.ddcci.getVCP(key, 0x12));
      if (contrastRead.key) {
        preferredKey = contrastRead.key;
      }
      const inputRead = this.readVcpWithCandidates(candidates, 0x60);
      if (inputRead.key) {
        preferredKey = inputRead.key;
      }
      const powerRead = this.readVcpWithCandidates(candidates, 0xD6);
      if (powerRead.key) {
        preferredKey = powerRead.key;
      }
      this.monitorKeyById.set(monitorId, preferredKey);

      const brightness = brightnessRead.value;
      const contrast = contrastRead.value;
      const inputRaw = inputRead.value;
      const powerRaw = powerRead.value;
      const availableInputs = this.readAvailableInputs(candidates, row);

      const monitor: DdcMonitor = {
        monitor_id: monitorId,
        name: String(row.name || row.description || row.deviceKey || row.id || `Monitor ${monitorId}`),
        brightness,
        input_source: this.resolveInputSource(inputRaw, row),
        available_inputs: availableInputs,
        contrast,
        power_mode: powerRaw == null ? null : this.formatHex(powerRaw),
        supports: [
          ...(brightness != null ? ["brightness"] : []),
          ...(contrast != null ? ["contrast"] : []),
          ...(inputRaw != null ? ["input_source"] : []),
          ...(powerRaw != null ? ["power_mode"] : []),
        ],
      };
      out.push(monitor);
    }
    return out;
  }

  public setBrightness(monitorId: number, value: number): DdcMonitor {
    const level = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    this.runWithMonitorCandidates(monitorId, (key) => this.writeVcp(key, 0x10, level));
    return this.getMonitor(monitorId);
  }

  public setInputSource(monitorId: number, value: string): DdcMonitor {
    const inputCode = this.parseInputValue(value);
    this.runWithMonitorCandidates(monitorId, (key) => this.writeVcp(key, 0x60, inputCode));
    return this.getMonitor(monitorId);
  }

  private getMonitor(monitorId: number): DdcMonitor {
    const monitor = this.listMonitors().find((item) => item.monitor_id === monitorId);
    if (!monitor) {
      throw new Error(`Monitor ${monitorId} not found.`);
    }
    return monitor;
  }

  private resolveMonitorCandidates(row: any): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (value: unknown) => {
      const next = String(value ?? "").trim();
      if (!next || seen.has(next)) {
        return;
      }
      seen.add(next);
      out.push(next);
    };
    push(row?.id);
    push(row?.deviceKey);
    push(row?.path);
    push(row?.fullName);
    if (Array.isArray(row?.hwid) && row.hwid.length > 0) {
      push(row.hwid.map((part: unknown) => String(part)).join("#"));
    }
    push(row?.hwid);
    push(row?.key);
    push(row?.devicePath);
    if (Array.isArray(row?.monitorID)) {
      for (const idPart of row.monitorID) {
        push(idPart);
      }
    }
    if (typeof row?.monitorID === "string" || typeof row?.monitorID === "number") {
      push(row.monitorID);
    }
    if (typeof row?.num === "number") {
      push(row.num);
    }
    if (typeof row?.index === "number") {
      push(row.index);
    }
    if (typeof row?.order === "number") {
      push(row.order);
    }
    return out;
  }

  private readAvailableInputs(candidates: string[], row: any): string[] {
    const out = new Set<string>();
    for (const key of candidates) {
      const direct = this.safeAny(() => this.ddcci.getMonitorInputs?.(key));
      if (Array.isArray(direct)) {
        for (const item of direct) {
          const parsed = this.parseNumeric(item);
          if (parsed != null) {
            out.add(this.formatHex(parsed));
          }
        }
      } else if (direct && typeof direct === "object") {
        for (const k of Object.keys(direct)) {
          const parsed = this.parseNumeric(k);
          if (parsed != null) {
            out.add(this.formatHex(parsed));
          }
        }
      }
      const capabilities = this.safeAny(() => this.ddcci.getCapabilities?.(key) ?? row?.capabilities);
      if (capabilities && typeof capabilities === "object") {
        const vcp60 = (capabilities as Record<string, unknown>)["0x60"];
        if (Array.isArray(vcp60)) {
          for (const item of vcp60) {
            const parsed = this.parseNumeric(item);
            if (parsed != null) {
              out.add(this.formatHex(parsed));
            }
          }
        }
        const inputs = (capabilities as Record<string, unknown>).inputs;
        if (inputs && typeof inputs === "object") {
          for (const k of Object.keys(inputs as Record<string, unknown>)) {
            const parsed = this.parseNumeric(k);
            if (parsed != null) {
              out.add(this.formatHex(parsed));
            }
          }
        }
      }
    }

    return Array.from(out).sort();
  }

  private runWithMonitorCandidates(monitorId: number, run: (key: string) => void): void {
    const preferred = this.monitorKeyById.get(monitorId);
    if (preferred) {
      run(preferred);
      return;
    }
    const candidates = this.getMonitorCandidates(monitorId);
    if (candidates.length === 0) {
      throw new Error(`No stable DDC key available for monitor ${monitorId}.`);
    }
    let lastErr: unknown = null;
    for (const key of candidates) {
      try {
        run(key);
        this.monitorKeyById.set(monitorId, key);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) {
      throw lastErr;
    }
    throw new Error(`Monitor ${monitorId} not found.`);
  }

  private getMonitorCandidates(monitorId: number): string[] {
    if (!this.monitorCandidatesById.has(monitorId)) {
      this.listMonitors();
    }
    const preferred = this.monitorKeyById.get(monitorId);
    const existing = this.monitorCandidatesById.get(monitorId) ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (value: string | undefined) => {
      const next = String(value ?? "").trim();
      if (!next || seen.has(next)) {
        return;
      }
      seen.add(next);
      out.push(next);
    };
    push(preferred);
    for (const value of existing) {
      push(value);
    }
    return out;
  }

  private readVcpWithCandidates(candidates: string[], code: number): { key: string | null; value: number | null } {
    for (const key of candidates) {
      const value = this.safeVcpValue(() => this.readVcp(key, code));
      if (value != null) {
        return { key, value };
      }
    }
    return { key: null, value: null };
  }

  private readNumberWithCandidates(candidates: string[], read: (key: string) => any): { key: string | null; value: number | null } {
    for (const key of candidates) {
      const value = this.safeNumber(() => read(key));
      if (value != null) {
        return { key, value };
      }
    }
    return { key: null, value: null };
  }

  private parseInputValue(value: string): number {
    const raw = String(value || "").trim().toLowerCase();
    const named: Record<string, number> = {
      hdmi1: 0x11,
      hdmi2: 0x12,
      dp1: 0x0F,
      dp2: 0x10,
      displayport1: 0x0F,
      displayport2: 0x10,
      usb: 0x1B,
      usbc: 0x1B,
      dvi1: 0x03,
      dvi2: 0x04,
      vga1: 0x01,
      vga2: 0x02,
    };
    if (named[raw] != null) {
      return named[raw];
    }
    const parsed = this.parseNumeric(raw);
    if (parsed == null) {
      throw new Error(`Unsupported input source value: ${value}`);
    }
    return parsed;
  }

  private parseNumeric(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.min(255, Math.round(value)));
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      const hex = /^0x([0-9a-f]{1,2})$/i.exec(trimmed);
      if (hex) {
        return parseInt(hex[1], 16);
      }
      const num = Number(trimmed);
      if (Number.isFinite(num)) {
        return Math.max(0, Math.min(255, Math.round(num)));
      }
    }
    return null;
  }

  private resolveInputSource(inputRaw: number | null, row: any): string | null {
    if (inputRaw != null) {
      return this.formatHex(inputRaw);
    }
    const fromRow =
      row?.input ??
      row?.inputSource ??
      row?.activeInput ??
      row?.source;
    if (typeof fromRow === "string" && fromRow.trim()) {
      return fromRow.trim();
    }
    const parsed = this.parseNumeric(fromRow);
    if (parsed != null) {
      return this.formatHex(parsed);
    }
    return null;
  }

  private safeVcpValue(fn: () => any): number | null {
    try {
      const raw = fn();
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
        return raw[0];
      }
      if (typeof raw === "number") {
        return raw;
      }
      return null;
    } catch {
      return null;
    }
  }

  private safeNumber(fn: () => any): number | null {
    try {
      const raw = fn();
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
        return raw[0];
      }
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
      }
      return null;
    } catch {
      return null;
    }
  }

  private safeAny(fn: () => any): any {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  private formatHex(value: number): string {
    return `0x${Math.max(0, Math.min(255, value)).toString(16).toUpperCase().padStart(2, "0")}`;
  }

  private readVcp(key: string, code: number): any {
    if (typeof this.ddcci._getVCP === "function") {
      return this.ddcci._getVCP(key, code);
    }
    return this.ddcci.getVCP(key, code);
  }

  private writeVcp(key: string, code: number, value: number): void {
    if (typeof this.ddcci._setVCP === "function") {
      this.ddcci._setVCP(key, code, value);
      return;
    }
    this.ddcci.setVCP(key, code, value);
  }
}

function tryLoadDdcciModule(): DdcciModule | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "";
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("@hensm/ddcci") as DdcciModule;
  } catch {
    const candidates = [
      path.join(process.cwd(), "vendor", "node-ddcci"),
      path.join(__dirname, "..", "..", "..", "..", "..", "vendor", "node-ddcci"),
      path.join(resourcesPath, "app.asar.unpacked", "vendor", "node-ddcci"),
      path.join(resourcesPath, "vendor", "node-ddcci"),
    ];
    for (const vendorPath of candidates) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require(vendorPath) as DdcciModule;
      } catch {
        // continue
      }
    }
    return null;
  }
}

export class DdcApiService {
  private status: DdcStatus = {
    state: "starting",
    detail: "Initializing native DDC service...",
    endpoint: "native-ddc",
    managed: true,
    pid: null,
  };
  private backend: DdcBackend | null = null;

  public start(): void {
    try {
      const ddcci = tryLoadDdcciModule();
      if (ddcci) {
        const backend = new NativeDdcciBackend(ddcci);
        const monitors = backend.listMonitors();
        this.backend = backend;
        this.status = {
          state: "running",
          detail: monitors.length > 0 ? `Native DDC/CI active. Detected ${monitors.length} monitor(s).` : "Native DDC/CI active.",
          endpoint: backend.name,
          managed: true,
          pid: null,
        };
        return;
      }
      this.backend = null;
      this.status = {
        state: "error",
        detail: "Native DDC library (@hensm/ddcci) is unavailable. Install dependencies and ensure native build succeeds.",
        endpoint: "native-ddcci",
        managed: true,
        pid: null,
      };
    } catch (err) {
      this.backend = null;
      this.status = {
        state: "error",
        detail: this.errorText(err),
        endpoint: "native-ddc",
        managed: true,
        pid: null,
      };
    }
  }

  public stop(): void {
    this.backend = null;
    this.status = {
      state: "stopped",
      detail: "DDC service stopped.",
      endpoint: "native-ddc",
      managed: true,
      pid: null,
    };
  }

  public getStatus(): DdcStatus {
    return { ...this.status };
  }

  public isHealthy(): boolean {
    return this.status.state === "running";
  }

  public listMonitors(): DdcMonitor[] {
    return this.requireBackend().listMonitors();
  }

  public getBrightnessAll(): Array<{ monitor_id: number; brightness: number | null }> {
    return this.listMonitors().map((monitor) => ({ monitor_id: monitor.monitor_id, brightness: monitor.brightness }));
  }

  public setBrightness(monitorId: number, value: number): DdcMonitor {
    return this.requireBackend().setBrightness(monitorId, value);
  }

  public setInputSource(monitorId: number, value: string): DdcMonitor {
    return this.requireBackend().setInputSource(monitorId, value);
  }

  private requireBackend(): DdcBackend {
    if (!this.backend) {
      this.start();
    }
    if (!this.backend) {
      throw new Error(this.status.detail || "DDC backend unavailable.");
    }
    return this.backend;
  }

  private errorText(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
}

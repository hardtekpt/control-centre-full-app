import type { AppState } from "../../../../shared/types";

const STEELSERIES_VENDOR_ID = 0x1038;
const SUPPORTED_PRODUCT_IDS = new Set([0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D]);
const INTERFACE_NUMBER = 4;
const BATTERY_MAX_LEVEL = 8;
const VOLUME_MAX_LEVEL = 0x38;

type HidDeviceInfo = {
  vendorId?: number;
  productId?: number;
  interface?: number;
  path?: string;
};

type HidHandle = {
  readTimeout: (timeoutMs: number) => number[];
  close: () => void;
};

type HidModule = {
  devices: () => HidDeviceInfo[];
  HID: new (path: string) => HidHandle;
};

export type BaseStationSnapshot = Pick<
  AppState,
  | "headset_battery_percent"
  | "base_battery_percent"
  | "headset_volume_percent"
  | "anc_mode"
  | "mic_mute"
  | "sidetone_level"
  | "connected"
  | "wireless"
  | "bluetooth"
  | "oled_brightness"
>;

export class BaseStationEventListener {
  private hid: HidModule | null = null;
  private devices: HidHandle[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastDiscoverAt = 0;
  private onPatch: (patch: Partial<BaseStationSnapshot>) => void;
  private onError: (detail: string) => void;
  private snapshot: BaseStationSnapshot = {
    headset_battery_percent: null,
    base_battery_percent: null,
    headset_volume_percent: null,
    anc_mode: null,
    mic_mute: null,
    sidetone_level: null,
    connected: null,
    wireless: null,
    bluetooth: null,
    oled_brightness: null,
  };

  constructor(onPatch: (patch: Partial<BaseStationSnapshot>) => void, onError: (detail: string) => void) {
    this.onPatch = onPatch;
    this.onError = onError;
  }

  public start(): void {
    if (this.timer) {
      return;
    }
    this.hid = this.tryLoadHid();
    if (!this.hid) {
      this.onError("HID backend unavailable (node-hid not installed).");
      return;
    }
    this.discoverDevices();
    this.pollOnce();
    this.timer = setInterval(() => this.pollOnce(), 120);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.closeDevices();
  }

  public getSnapshot(): BaseStationSnapshot {
    return { ...this.snapshot };
  }

  private pollOnce(): void {
    if (!this.hid) {
      return;
    }
    if (this.devices.length === 0) {
      const now = Date.now();
      if (now - this.lastDiscoverAt > 1500) {
        this.discoverDevices();
      }
      return;
    }
    const mergedPatch: Partial<BaseStationSnapshot> = {};
    for (const device of this.devices) {
      while (true) {
        const report = this.safeRead(device, 1);
        if (!report || report.length === 0) {
          break;
        }
        const patch = this.parseEvent(report);
        if (!patch) {
          continue;
        }
        Object.assign(mergedPatch, patch);
      }
    }
    if (Object.keys(mergedPatch).length > 0) {
      Object.assign(this.snapshot, mergedPatch);
      this.onPatch(mergedPatch);
    }
  }

  private discoverDevices(): void {
    this.lastDiscoverAt = Date.now();
    if (!this.hid) {
      return;
    }
    try {
      const candidates = this.hid
        .devices()
        .filter(
          (row) =>
            row.vendorId === STEELSERIES_VENDOR_ID &&
            SUPPORTED_PRODUCT_IDS.has(Number(row.productId)) &&
            Number(row.interface) === INTERFACE_NUMBER &&
            typeof row.path === "string" &&
            row.path.trim().length > 0,
        )
        .sort((a, b) => String(a.path).localeCompare(String(b.path)));
      if (candidates.length === 0) {
        this.closeDevices();
        return;
      }
      const pathA = String(candidates[0].path);
      const pathB = String((candidates[1] ?? candidates[0]).path);
      const ordered = [pathB, pathA];
      this.closeDevices();
      const opened = new Set<string>();
      for (const p of ordered) {
        if (opened.has(p)) {
          continue;
        }
        this.devices.push(new this.hid.HID(p));
        opened.add(p);
      }
    } catch (err) {
      this.closeDevices();
      this.onError(this.errorText(err));
    }
  }

  private closeDevices(): void {
    for (const device of this.devices) {
      try {
        device.close();
      } catch {
        // ignore
      }
    }
    this.devices = [];
  }

  private safeRead(device: HidHandle, timeoutMs: number): number[] {
    try {
      const data = device.readTimeout(timeoutMs);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.onError(this.errorText(err));
      this.closeDevices();
      return [];
    }
  }

  private parseEvent(data: number[]): Partial<BaseStationSnapshot> | null {
    if (data.length < 5) {
      return null;
    }
    const reportId = data[0];
    if (reportId !== 0x06 && reportId !== 0x07) {
      return null;
    }
    const command = data[1];

    if (command === 0x25) {
      const rawVolume = Math.max(0, VOLUME_MAX_LEVEL - Number(data[2] ?? 0));
      const percent = Math.round(Math.max(0, Math.min(100, (rawVolume / VOLUME_MAX_LEVEL) * 100)));
      return { headset_volume_percent: percent };
    }
    if (command === 0xB5) {
      const wireless = Number(data[4] ?? 0) === 8;
      const bluetooth = Number(data[3] ?? 0) === 1;
      const patch: Partial<BaseStationSnapshot> = {
        connected: wireless,
        wireless,
        bluetooth,
      };
      if (wireless) {
        patch.anc_mode = "off";
      }
      return patch;
    }
    if (command === 0xB7) {
      const headsetLevel = Number(data[2] ?? 0);
      const chargingLevel = Number(data[3] ?? 0);
      const headsetPercent = Math.round(Math.max(0, Math.min(100, (headsetLevel / BATTERY_MAX_LEVEL) * 100)));
      const chargingPercent = Math.round(Math.max(0, Math.min(100, (chargingLevel / BATTERY_MAX_LEVEL) * 100)));
      return {
        headset_battery_percent: headsetPercent,
        base_battery_percent: chargingPercent,
      };
    }
    if (command === 0x85) {
      const level = Number(data[2] ?? 0);
      if (level >= 1 && level <= 10) {
        return { oled_brightness: level };
      }
      return null;
    }
    if (command === 0x39) {
      return { sidetone_level: Number(data[2] ?? 0) };
    }
    if (command === 0xBD) {
      const value = Number(data[2] ?? 0);
      if (value === 0) return { anc_mode: "off" };
      if (value === 1) return { anc_mode: "transparency" };
      if (value === 2) return { anc_mode: "anc" };
      return null;
    }
    if (command === 0xBB) {
      const muted = Number(data[2] ?? 0) === 1;
      return { mic_mute: muted };
    }
    return null;
  }

  private tryLoadHid(): HidModule | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("node-hid") as HidModule;
    } catch {
      return null;
    }
  }

  private errorText(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
}

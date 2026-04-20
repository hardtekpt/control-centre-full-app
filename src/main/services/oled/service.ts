import { EventEmitter } from "node:events";

const STEELSERIES_VENDOR_ID = 0x1038;
const SUPPORTED_PRODUCT_IDS = new Set([0x12cb, 0x12cd, 0x12e0, 0x12e5, 0x225d]);
const INTERFACE_NUMBER = 4;

const SCREEN_WIDTH = 128;
const SCREEN_HEIGHT = 64;
const SCREEN_REPORT_SPLIT_WIDTH = 64;
const SCREEN_REPORT_SIZE = 1024;

const FONT_WIDTH = 5;
const FONT_HEIGHT = 7;
const FONT_SPACING = 1;

const DEFAULT_TIMEOUT_MS = 5000;

type HidDeviceInfo = {
  vendorId?: number;
  productId?: number;
  interface?: number;
  path?: string;
};

type HidHandle = {
  sendFeatureReport: (data: number[] | Buffer) => number;
  write: (data: number[] | Buffer) => number;
  close: () => void;
};

type HidModule = {
  devices: () => HidDeviceInfo[];
  HID: new (path: string, options?: { nonExclusive?: boolean }) => HidHandle;
};

export type OledNotifKind =
  | "connectivity"
  | "usbInput"
  | "ancMode"
  | "sidetone"
  | "micMute"
  | "headsetChatMix"
  | "headsetVolume"
  | "battery"
  | "presetChange"
  | "oled"
  | "appInfo"
  | "generic";

interface ActiveNotification {
  kind: OledNotifKind;
  header: string;
  title: string;
  valueText: string;
  valuePercent: number | null;
  animFrameIndex: number;
  expiresAt: number;
}

export interface OledNotifServiceStatus {
  state: "stopped" | "running";
  detail: string;
}

export class OledNotificationService extends EventEmitter {
  private running = false;
  private hid: HidModule | null = null;
  private timeoutMs = DEFAULT_TIMEOUT_MS;
  private active: ActiveNotification | null = null;
  private closeTimer: NodeJS.Timeout | null = null;
  private lastError = "";

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.emit("status", "OLED notification service started.");
  }

  public stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.cancelClose();
    this.active = null;
    this.returnToSteelSeriesUi();
    this.emit("status", "OLED notification service stopped.");
  }

  public configureRuntime(config: { enabled?: boolean; timeoutMs?: number }): void {
    if (config.timeoutMs != null) {
      const clamped = Math.max(2000, Math.min(30_000, Math.round(Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS)));
      this.timeoutMs = clamped;
    }
    if (config.enabled === true && !this.running) {
      this.start();
    } else if (config.enabled === false && this.running) {
      this.stop();
    }
  }

  public getRuntimeStatus(): OledNotifServiceStatus {
    return {
      state: this.running ? "running" : "stopped",
      detail: this.running
        ? this.lastError
          ? `Error: ${this.lastError}`
          : "Active — waiting for events."
        : "Disabled in settings.",
    };
  }

  public showTypedNotification(
    kind: OledNotifKind,
    title: string,
    valueText: string,
    valuePercent?: number,
  ): void {
    if (!this.running) {
      return;
    }
    this.active = {
      kind,
      header: normalizeText(headerForKind(kind), 20),
      title: normalizeText(title, 14),
      valueText: normalizeText(valueText, 10),
      valuePercent:
        typeof valuePercent === "number" && Number.isFinite(valuePercent)
          ? clampPercent(valuePercent)
          : null,
      animFrameIndex: 0,
      expiresAt: Date.now() + this.timeoutMs,
    };
    this.sendFrame();
    this.scheduleAnimFrames();
    this.scheduleClose();
  }

  private scheduleAnimFrames(): void {
    for (const delay of [180, 360, 540]) {
      setTimeout(() => {
        if (!this.active || !this.running || Date.now() >= this.active.expiresAt) {
          return;
        }
        this.sendFrame();
      }, delay);
    }
  }

  private scheduleClose(): void {
    this.cancelClose();
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null;
      this.active = null;
      this.returnToSteelSeriesUi();
    }, this.timeoutMs);
  }

  private cancelClose(): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private sendFrame(): void {
    if (!this.active) {
      return;
    }
    const bitmap = renderTypedNotificationBitmap(this.active);
    this.active.animFrameIndex += 1;
    try {
      this.writeToDevice(bitmap);
      if (this.lastError) {
        this.lastError = "";
        this.emit("status", "OLED connection restored.");
      }
    } catch (err) {
      const msg = errorText(err);
      if (msg !== this.lastError) {
        this.lastError = msg;
        this.emit("error", msg);
      }
    }
  }

  private writeToDevice(bitmap: Uint8Array): void {
    const hid = this.ensureHid();
    if (!hid) {
      throw new Error("node-hid unavailable.");
    }
    const candidates = this.listCandidates(hid);
    if (candidates.length === 0) {
      throw new Error("No Arctis base station found on HID interface 4.");
    }
    const reports = createDrawReports(bitmap, SCREEN_WIDTH, SCREEN_HEIGHT);
    let lastErr = "";
    for (const info of candidates) {
      const path = String(info.path ?? "").trim();
      if (!path) {
        continue;
      }
      let device: HidHandle | null = null;
      try {
        device = new hid.HID(path, { nonExclusive: true });
        for (const report of reports) {
          device.sendFeatureReport(report);
        }
        return;
      } catch (err) {
        lastErr = errorText(err);
      } finally {
        try {
          device?.close();
        } catch {
          // ignore close errors
        }
      }
    }
    throw new Error(lastErr || "Unable to send OLED frame to any HID endpoint.");
  }

  private returnToSteelSeriesUi(): void {
    const hid = this.ensureHid();
    if (!hid) {
      return;
    }
    const payload = new Array<number>(64).fill(0);
    payload[0] = 0x06;
    payload[1] = 0x95;
    for (const info of this.listCandidates(hid)) {
      const path = String(info.path ?? "").trim();
      if (!path) {
        continue;
      }
      let device: HidHandle | null = null;
      try {
        device = new hid.HID(path, { nonExclusive: true });
        device.write(payload);
        break;
      } catch {
        // ignore shutdown failures
      } finally {
        try {
          device?.close();
        } catch {
          // ignore
        }
      }
    }
  }

  private ensureHid(): HidModule | null {
    if (!this.hid) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        this.hid = require("node-hid") as HidModule;
      } catch {
        return null;
      }
    }
    return this.hid;
  }

  private listCandidates(hid: HidModule): HidDeviceInfo[] {
    const seen = new Map<string, HidDeviceInfo>();
    for (const row of hid.devices()) {
      if (
        row.vendorId === STEELSERIES_VENDOR_ID &&
        SUPPORTED_PRODUCT_IDS.has(Number(row.productId)) &&
        Number(row.interface) === INTERFACE_NUMBER &&
        typeof row.path === "string" &&
        row.path.trim()
      ) {
        const key = row.path.trim();
        if (!seen.has(key)) {
          seen.set(key, row);
        }
      }
    }
    return [...seen.values()];
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function headerForKind(kind: OledNotifKind): string {
  const labels: Record<OledNotifKind, string> = {
    connectivity: "CONNECTION",
    usbInput: "USB INPUT",
    ancMode: "ANC MODE",
    sidetone: "SIDETONE",
    micMute: "MIC MUTE",
    headsetChatMix: "CHAT MIX",
    headsetVolume: "VOLUME",
    battery: "BATTERY",
    presetChange: "PRESET",
    oled: "DISPLAY",
    appInfo: "INFO",
    generic: "NOTIFICATION",
  };
  return labels[kind] ?? "NOTIFICATION";
}

function renderTypedNotificationBitmap(notif: ActiveNotification): Uint8Array {
  const W = SCREEN_WIDTH;
  const H = SCREEN_HEIGHT;
  const pixels = new Uint8Array(W * H);

  // Inverted header band (rows 0–9): white fill, black text.
  drawRect(pixels, W, H, 0, 0, W, 10, true);
  drawCenteredTextInverted(pixels, W, H, notif.header, 1);

  drawHorizontalLine(pixels, W, H, 0, W - 1, 10);

  // Icon at (3, 13).
  drawNotifIcon(pixels, 3, 13, notif.kind);

  // Label + value to the right of the icon.
  const textX = 20;
  drawText(pixels, W, H, notif.title, textX, 13);
  if (notif.valueText) {
    drawText(pixels, W, H, notif.valueText, textX, 23);
  }

  // Animated progress bar (ease-out over 4 frames).
  if (notif.valuePercent != null) {
    const FRAMES = 4;
    const raw = notif.animFrameIndex >= FRAMES ? 1 : notif.animFrameIndex / FRAMES;
    const eased = raw < 1 ? raw * (2 - raw) : 1;
    drawProgressBar(pixels, textX, 36, W - textX - 4, 5, Math.round(notif.valuePercent * eased));
  }

  drawRectOutline(pixels, W, H, 0, 0, W, H);
  return pixels;
}

// ─── Drawing primitives ──────────────────────────────────────────────────────

function setPixel(pixels: Uint8Array, w: number, h: number, x: number, y: number, v: 0 | 1): void {
  if (x >= 0 && y >= 0 && x < w && y < h) {
    pixels[y * w + x] = v;
  }
}

function drawRect(pixels: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number, on: boolean): void {
  const v = on ? 1 : 0;
  for (let yy = y; yy < y + rh; yy++) {
    for (let xx = x; xx < x + rw; xx++) {
      setPixel(pixels, w, h, xx, yy, v as 0 | 1);
    }
  }
}

function drawRectOutline(pixels: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number): void {
  drawHorizontalLine(pixels, w, h, x, x + rw - 1, y);
  drawHorizontalLine(pixels, w, h, x, x + rw - 1, y + rh - 1);
  for (let yy = y; yy < y + rh; yy++) {
    setPixel(pixels, w, h, x, yy, 1);
    setPixel(pixels, w, h, x + rw - 1, yy, 1);
  }
}

function drawHorizontalLine(pixels: Uint8Array, w: number, h: number, x0: number, x1: number, y: number): void {
  for (let xx = x0; xx <= x1; xx++) {
    setPixel(pixels, w, h, xx, y, 1);
  }
}

function drawProgressBar(pixels: Uint8Array, x: number, y: number, bw: number, bh: number, value: number | null): void {
  drawRectOutline(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x, y, bw, bh);
  if (value == null) {
    for (let px = x + 1; px < x + bw - 1; px += 2) {
      const py = y + 1 + ((px - x) % Math.max(1, bh - 1));
      setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, px, Math.min(y + bh - 2, py), 1);
    }
    return;
  }
  const fill = Math.round(((bw - 2) * clampPercent(value)) / 100);
  if (fill > 0) {
    drawRect(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x + 1, y + 1, fill, Math.max(1, bh - 2), true);
  }
}

function drawGlyph(pixels: Uint8Array, w: number, h: number, x: number, y: number, char: string, invert: boolean): void {
  const glyph = FONT_5X7[char] ?? FONT_5X7["?"];
  for (let row = 0; row < FONT_HEIGHT; row++) {
    const pattern = glyph[row];
    for (let col = 0; col < FONT_WIDTH; col++) {
      if (pattern[col] === "1") {
        setPixel(pixels, w, h, x + col, y + row, invert ? 0 : 1);
      }
    }
  }
}

function drawText(pixels: Uint8Array, w: number, h: number, text: string, x: number, y: number): void {
  const normalized = normalizeText(text, Math.max(1, Math.floor((w - x) / (FONT_WIDTH + FONT_SPACING))));
  let cursorX = x;
  for (const char of normalized) {
    drawGlyph(pixels, w, h, cursorX, y, char, false);
    cursorX += FONT_WIDTH + FONT_SPACING;
  }
}

function drawCenteredTextInverted(pixels: Uint8Array, w: number, h: number, text: string, y: number): void {
  const normalized = normalizeText(text, 20);
  if (!normalized) {
    return;
  }
  const textW = normalized.length * (FONT_WIDTH + FONT_SPACING) - FONT_SPACING;
  const x = Math.max(2, Math.floor((w - textW) / 2));
  let cursorX = x;
  for (const char of normalized) {
    drawGlyph(pixels, w, h, cursorX, y, char, true);
    cursorX += FONT_WIDTH + FONT_SPACING;
  }
}

function drawNotifIcon(pixels: Uint8Array, x: number, y: number, kind: OledNotifKind): void {
  const icon = NOTIF_ICONS[kind] ?? NOTIF_ICONS.generic;
  for (let row = 0; row < icon.length; row++) {
    const line = icon[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] === "1") {
        setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x + col, y + row, 1);
      }
    }
  }
}

// ─── HID report packing ──────────────────────────────────────────────────────

function createDrawReports(bitmap: Uint8Array, width: number, height: number): number[][] {
  const reports: number[][] = [];
  for (let splitX = 0; splitX < width; splitX += SCREEN_REPORT_SPLIT_WIDTH) {
    const chunkW = Math.min(SCREEN_REPORT_SPLIT_WIDTH, width - splitX);
    const report = new Array<number>(SCREEN_REPORT_SIZE).fill(0);
    report[0] = 0x06;
    report[1] = 0x93;
    report[2] = splitX;
    report[3] = 0;
    const paddedH = Math.ceil(height / 8) * 8;
    report[4] = chunkW;
    report[5] = paddedH;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < chunkW; x++) {
        if (bitmap[y * width + splitX + x] === 0) {
          continue;
        }
        const idx = x * paddedH + y;
        report[(idx >> 3) + 6] |= 1 << (idx & 7);
      }
    }
    reports.push(report);
  }
  return reports;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeText(value: string, maxLen: number): string {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return cleaned
    .split("")
    .map((c) => (FONT_5X7[c] ? c : "?"))
    .join("")
    .slice(0, Math.max(1, maxLen));
}

function clampPercent(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Font ────────────────────────────────────────────────────────────────────

const FONT_5X7: Record<string, string[]> = {
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  "-": ["00000","00000","00000","11111","00000","00000","00000"],
  "_": ["00000","00000","00000","00000","00000","00000","11111"],
  ".": ["00000","00000","00000","00000","00000","01100","01100"],
  ":": ["00000","01100","01100","00000","01100","01100","00000"],
  "/": ["00001","00010","00100","01000","10000","00000","00000"],
  "%": ["11001","11010","00100","01000","10110","00110","00000"],
  "?": ["01110","10001","00010","00100","00100","00000","00100"],
  "0": ["01110","10001","10011","10101","11001","10001","01110"],
  "1": ["00100","01100","00100","00100","00100","00100","01110"],
  "2": ["01110","10001","00001","00010","00100","01000","11111"],
  "3": ["11110","00001","00001","01110","00001","00001","11110"],
  "4": ["00010","00110","01010","10010","11111","00010","00010"],
  "5": ["11111","10000","10000","11110","00001","00001","11110"],
  "6": ["01110","10000","10000","11110","10001","10001","01110"],
  "7": ["11111","00001","00010","00100","01000","01000","01000"],
  "8": ["01110","10001","10001","01110","10001","10001","01110"],
  "9": ["01110","10001","10001","01111","00001","00001","01110"],
  A: ["01110","10001","10001","11111","10001","10001","10001"],
  B: ["11110","10001","10001","11110","10001","10001","11110"],
  C: ["01110","10001","10000","10000","10000","10001","01110"],
  D: ["11100","10010","10001","10001","10001","10010","11100"],
  E: ["11111","10000","10000","11110","10000","10000","11111"],
  F: ["11111","10000","10000","11110","10000","10000","10000"],
  G: ["01110","10001","10000","10000","10011","10001","01110"],
  H: ["10001","10001","10001","11111","10001","10001","10001"],
  I: ["01110","00100","00100","00100","00100","00100","01110"],
  J: ["00111","00010","00010","00010","00010","10010","01100"],
  K: ["10001","10010","10100","11000","10100","10010","10001"],
  L: ["10000","10000","10000","10000","10000","10000","11111"],
  M: ["10001","11011","10101","10101","10001","10001","10001"],
  N: ["10001","11001","10101","10011","10001","10001","10001"],
  O: ["01110","10001","10001","10001","10001","10001","01110"],
  P: ["11110","10001","10001","11110","10000","10000","10000"],
  Q: ["01110","10001","10001","10001","10101","10010","01101"],
  R: ["11110","10001","10001","11110","10100","10010","10001"],
  S: ["01111","10000","10000","01110","00001","00001","11110"],
  T: ["11111","00100","00100","00100","00100","00100","00100"],
  U: ["10001","10001","10001","10001","10001","10001","01110"],
  V: ["10001","10001","10001","10001","10001","01010","00100"],
  W: ["10001","10001","10001","10101","10101","10101","01010"],
  X: ["10001","10001","01010","00100","01010","10001","10001"],
  Y: ["10001","10001","01010","00100","00100","00100","00100"],
  Z: ["11111","00001","00010","00100","01000","10000","11111"],
};

// ─── 12×12 notification icons ────────────────────────────────────────────────

const NOTIF_ICONS: Record<OledNotifKind, string[]> = {
  headsetVolume: [
    "000000000000","000110000000","001111000100","011111001110",
    "111111011111","111111011111","111111011111","011111001110",
    "001111000100","000110000000","000000000000","000000000000",
  ],
  headsetChatMix: [
    "000110000110","001111001111","011001011001","011001011001",
    "001111001111","000110000110","000000000000","001111111100",
    "000001100000","000001100000","001111111100","000000000000",
  ],
  micMute: [
    "000111100000","001111110000","001100110000","001100110000",
    "001100110000","001111110000","000111100000","000011000000",
    "001111110000","000011000000","000111100000","000000000000",
  ],
  ancMode: [
    "000011000000","000111100000","001100110000","011000011000",
    "110001001100","110011001100","110001001100","011000011000",
    "001100110000","000111100000","000011000000","000000000000",
  ],
  battery: [
    "001111111100","011000000110","110111111011","110111111011",
    "110111111011","110111111011","110111111011","110111111011",
    "011000000110","001111111100","000001100000","000001100000",
  ],
  connectivity: [
    "000000000010","000000000010","000000000010","000000000010",
    "000000010010","000000010010","000010010010","000010010010",
    "010010010010","010010010010","010010010010","000000000000",
  ],
  usbInput: [
    "000001100000","000001100000","100001100010","110001100110",
    "100001100010","000001100000","000001100000","000011110000",
    "000100001000","000100001000","000011110000","000000000000",
  ],
  sidetone: [
    "000111100000","001111110000","001100110000","001100110000",
    "001100110000","001111110000","000111100000","000011000000",
    "001111110010","000011000110","000111100010","000000000000",
  ],
  presetChange: [
    "000000001000","000000001100","000000001100","000000001000",
    "000000001000","000000001000","000000001000","000011111000",
    "000111111000","000111111000","000011110000","000000000000",
  ],
  oled: [
    "000011000000","000011000000","100011000010","011000001100",
    "001111110000","001111110000","001111110000","011000001100",
    "100011000010","000011000000","000011000000","000000000000",
  ],
  appInfo: [
    "000111110000","001000001000","010001100100","010001100100",
    "010011110100","010011110100","010011110100","010001100100",
    "010001100100","010000000100","001000001000","000111110000",
  ],
  generic: [
    "000011000000","000111100000","001111110000","001110110000",
    "001110110000","001111110000","001110110000","001110110000",
    "001111110000","000111100000","000011000000","000000000000",
  ],
};

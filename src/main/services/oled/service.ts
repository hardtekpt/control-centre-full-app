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
  valueText: string;
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
    _valuePercent?: number,
  ): void {
    if (!this.running) {
      return;
    }
    this.emit("status", `[${kind}] "${title}" — OLED notification sent (value="${valueText}")`);
    this.active = {
      kind,
      valueText: normalizeText(valueText, 16),
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

/**
 * Full-screen notification: large 3× scaled icon centred on the 128×64 OLED,
 * value text centred below it — no border, no header band.
 *
 * Layout (all pixel values for 128×64):
 *   icon  36×36 px  (12×12 source × 3)  top of content block
 *   gap   6 px
 *   text  7 px tall (5×7 font)
 *   total 49 px  →  top margin = ⌊(64−49)/2⌋ = 7 px
 */
function renderTypedNotificationBitmap(notif: ActiveNotification): Uint8Array {
  const W = SCREEN_WIDTH;   // 128
  const H = SCREEN_HEIGHT;  // 64
  const pixels = new Uint8Array(W * H);

  const ICON_SCALE = 3;
  const ICON_SRC   = 12;                       // source icon size (px)
  const ICON_SIZE  = ICON_SRC * ICON_SCALE;    // 36
  const GAP        = 6;
  const TEXT_H     = FONT_HEIGHT;              // 7
  const totalH     = ICON_SIZE + GAP + TEXT_H; // 49

  const iconY  = Math.floor((H - totalH) / 2);        // 7
  const iconX  = Math.floor((W - ICON_SIZE) / 2);     // 46
  const textY  = iconY + ICON_SIZE + GAP;              // 49

  drawIconScaled(pixels, iconX, iconY, selectIcon(notif.kind, notif.valueText), ICON_SCALE);

  if (notif.valueText) {
    drawCenteredText(pixels, W, H, notif.valueText, textY);
  }

  return pixels;
}

// ─── Drawing primitives ──────────────────────────────────────────────────────

function setPixel(pixels: Uint8Array, w: number, h: number, x: number, y: number, v: 0 | 1): void {
  if (x >= 0 && y >= 0 && x < w && y < h) {
    pixels[y * w + x] = v;
  }
}

function drawGlyph(pixels: Uint8Array, w: number, h: number, x: number, y: number, char: string): void {
  const glyph = FONT_5X7[char] ?? FONT_5X7["?"];
  for (let row = 0; row < FONT_HEIGHT; row++) {
    const pattern = glyph[row];
    for (let col = 0; col < FONT_WIDTH; col++) {
      if (pattern[col] === "1") {
        setPixel(pixels, w, h, x + col, y + row, 1);
      }
    }
  }
}

/** Renders text centred horizontally at the given y coordinate. */
function drawCenteredText(pixels: Uint8Array, w: number, h: number, text: string, y: number): void {
  const maxChars = Math.max(1, Math.floor(w / (FONT_WIDTH + FONT_SPACING)));
  const normalized = normalizeText(text, maxChars);
  if (!normalized) {
    return;
  }
  const textW = normalized.length * (FONT_WIDTH + FONT_SPACING) - FONT_SPACING;
  let cursorX = Math.max(0, Math.floor((w - textW) / 2));
  for (const char of normalized) {
    drawGlyph(pixels, w, h, cursorX, y, char);
    cursorX += FONT_WIDTH + FONT_SPACING;
  }
}

/**
 * Picks the correct icon variant for a notification, allowing state-dependent
 * icons (e.g. mic muted vs live, ANC on vs off).
 */
function selectIcon(kind: OledNotifKind, valueText: string): string[] {
  if (kind === "micMute") {
    return valueText === "MUTED" ? ICON_MIC_MUTED : ICON_MIC_LIVE;
  }
  if (kind === "ancMode") {
    return valueText === "OFF" ? ICON_ANC_OFF : ICON_ANC_ON;
  }
  return NOTIF_ICONS[kind] ?? NOTIF_ICONS.generic;
}

/** Draws a source icon bitmap scaled up by `scale` (nearest-neighbour). */
function drawIconScaled(pixels: Uint8Array, x: number, y: number, icon: string[], scale: number): void {
  for (let row = 0; row < icon.length; row++) {
    const line = icon[row];
    for (let col = 0; col < line.length; col++) {
      if (line[col] !== "1") {
        continue;
      }
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          setPixel(pixels, SCREEN_WIDTH, SCREEN_HEIGHT, x + col * scale + sx, y + row * scale + sy, 1);
        }
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

// Mic (live / unmuted) — clean microphone silhouette.
const ICON_MIC_LIVE: string[] = [
  "000111100000","001111110000","001100110000","001100110000",
  "001100110000","001111110000","000111100000","000011000000",
  "001111110000","000011000000","000111100000","000000000000",
];

// Mic (muted) — same silhouette with a top-right→bottom-left diagonal slash OR'd over it.
// The slash is clearly visible at the icon corners where it doesn't overlap the mic body.
const ICON_MIC_MUTED: string[] = [
  "000111100011",  // mic top    + slash cols 10,11
  "001111110110",  // mic body   + slash cols 9,10
  "001100111100",  // mic body   + slash cols 8,9
  "001100111000",  // mic body   + slash cols 7,8
  "001100110000",  // (slash overlaps mic body — no visual change)
  "001111110000",  // (slash overlaps mic body — no visual change)
  "000111100000",  // (slash overlaps mic body — no visual change)
  "000111000000",  // neck       + slash col 3
  "001111110000",  // (slash overlaps mic base — no visual change)
  "011011000000",  // mic leg    + slash cols 1,2
  "110111100000",  // mic feet   + slash cols 0,1
  "110000000000",  // slash tail cols 0,1
];

// ANC active (ANC on or Transparency mode) — "ANC" in a compact 3×5 pixel font.
// Layout: A at cols 0-2, gap at 3, N at cols 4-6, gap at 7, C at cols 8-10.
// Letters are vertically centred at rows 3-7.
const ICON_ANC_ON: string[] = [
  "000000000000",
  "000000000000",
  "000000000000",
  "010010100110",  // A row0=010  N row0=101  C row0=011
  "101011101000",  // A row1=101  N row1=111  C row1=100
  "111010101000",  // A row2=111  N row2=101  C row2=100
  "101010101000",  // A row3=101  N row3=101  C row3=100
  "101010100110",  // A row4=101  N row4=101  C row4=011
  "000000000000",
  "000000000000",
  "000000000000",
  "000000000000",
];

// ANC off — same "ANC" text with a full-width horizontal strikethrough at the mid-row.
const ICON_ANC_OFF: string[] = [
  "000000000000",
  "000000000000",
  "000000000000",
  "010010100110",
  "101011101000",
  "111111111111",  // strikethrough (all 12 columns lit)
  "101010101000",
  "101010100110",
  "000000000000",
  "000000000000",
  "000000000000",
  "000000000000",
];

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
  micMute: ICON_MIC_LIVE,
  ancMode: ICON_ANC_ON,
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

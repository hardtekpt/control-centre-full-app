import * as fs from "node:fs";
import * as path from "node:path";
import { Menu, Tray, app, nativeImage } from "electron";

const DEFAULT_TRAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect x="2.5" y="2.5" width="27" height="27" rx="7.5" fill="#1e1e1e" fill-opacity="0.9" stroke="#ff7a2f" stroke-opacity="0.9" />
  <path d="M8 12h4.5l5.5-4.5v17l-5.5-4.5H8z" fill="#ff7a2f"/>
  <path d="M21 11.2c1.8 1.5 2.7 3.1 2.7 4.8s-.9 3.3-2.7 4.8" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M23.8 8.8c2.4 2 3.6 4.4 3.6 7.2s-1.2 5.2-3.6 7.2" fill="none" stroke="#ffb380" stroke-width="2.1" stroke-linecap="round"/>
</svg>`;
const PROJECT_TRAY_ICON_ICO_PATH = path.resolve(process.cwd(), "src", "main", "assets", "tray-icon.ico");
const PROJECT_TRAY_ICON_PNG_PATH = path.resolve(process.cwd(), "src", "main", "assets", "tray-icon.png");
const PROJECT_TRAY_ICON_SVG_PATH = path.resolve(process.cwd(), "src", "main", "assets", "tray-icon.svg");

interface TrayOptions {
  onToggle: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

export function createTray(options: TrayOptions): Tray {
  const { image: icon } = resolveTrayIcon();
  const tray = new Tray(icon);
  tray.setToolTip("Control Centre");
  tray.on("click", options.onToggle);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open", click: options.onToggle },
      { label: "Settings", click: options.onSettings },
      { type: "separator" },
      { label: "Quit", click: options.onQuit },
    ]),
  );
  return tray;
}

export function buildTrayIcon() {
  return resolveTrayIcon().image;
}

function resolveTrayIcon() {
  // Prefer concrete image assets first because Windows tray icon rendering can
  // fail for SVG sources depending on runtime/environment.
  const fromProjectPng = loadSvgAtPath(PROJECT_TRAY_ICON_PNG_PATH);
  if (!fromProjectPng.isEmpty()) {
    return { image: fromProjectPng.resize({ width: 16, height: 16 }), source: PROJECT_TRAY_ICON_PNG_PATH };
  }

  const fromProjectSvg = loadSvgAtPath(PROJECT_TRAY_ICON_SVG_PATH);
  if (!fromProjectSvg.isEmpty()) {
    return { image: fromProjectSvg.resize({ width: 16, height: 16 }), source: PROJECT_TRAY_ICON_SVG_PATH };
  }

  const fromFile = loadTrayIconFromFile();
  if (!fromFile.isEmpty()) {
    return { image: fromFile.resize({ width: 16, height: 16 }), source: "resolved-file-candidate" };
  }

  const inlineSvg = svgToImage(DEFAULT_TRAY_SVG);
  if (!inlineSvg.isEmpty()) {
    return { image: inlineSvg.resize({ width: 16, height: 16 }), source: "inline-svg-fallback" };
  }

  return { image: createBitmapFallbackIcon(), source: "bitmap-fallback" };
}

function loadTrayIconFromFile() {
  const appPath = safeAppPath();
  // Ordered from most likely locations in dev to packaged resource locations.
  const candidates = [
    // Dev workspace root.
    PROJECT_TRAY_ICON_ICO_PATH,
    PROJECT_TRAY_ICON_PNG_PATH,
    PROJECT_TRAY_ICON_SVG_PATH,
    // Generic app-root candidate.
    appPath ? path.join(appPath, "src", "main", "assets", "tray-icon.ico") : "",
    appPath ? path.join(appPath, "src", "main", "assets", "tray-icon.png") : "",
    appPath ? path.join(appPath, "src", "main", "assets", "tray-icon.svg") : "",
    // Packaged fallbacks.
    path.join(process.resourcesPath, "app.asar", "src", "main", "assets", "tray-icon.ico"),
    path.join(process.resourcesPath, "app.asar", "src", "main", "assets", "tray-icon.png"),
    path.join(process.resourcesPath, "app.asar", "src", "main", "assets", "tray-icon.svg"),
    path.join(process.resourcesPath, "app", "src", "main", "assets", "tray-icon.ico"),
    path.join(process.resourcesPath, "app", "src", "main", "assets", "tray-icon.png"),
    path.join(process.resourcesPath, "app", "src", "main", "assets", "tray-icon.svg"),
    path.join(process.resourcesPath, "src", "main", "assets", "tray-icon.ico"),
    path.join(process.resourcesPath, "src", "main", "assets", "tray-icon.png"),
    path.join(process.resourcesPath, "src", "main", "assets", "tray-icon.svg"),
  ].filter((p) => p.length > 0);
  for (const iconPath of candidates) {
    try {
      if (!fs.existsSync(iconPath)) {
        continue;
      }
      const image = loadSvgAtPath(iconPath);
      if (!image.isEmpty()) {
        return image;
      }
    } catch {
      // Continue to the next candidate.
    }
  }
  return nativeImage.createEmpty();
}

function svgToImage(svg: string) {
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function loadSvgAtPath(iconPath: string) {
  try {
    if (!fs.existsSync(iconPath)) {
      return nativeImage.createEmpty();
    }
    if (iconPath.toLowerCase().endsWith(".svg")) {
      const svg = fs.readFileSync(iconPath, "utf-8");
      return svgToImage(svg);
    }
    return nativeImage.createFromPath(iconPath);
  } catch {
    return nativeImage.createEmpty();
  }
}

function safeAppPath(): string {
  try {
    return app.getAppPath();
  } catch {
    return "";
  }
}

function createBitmapFallbackIcon() {
  const width = 16;
  const height = 16;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const edge = x <= 0 || x >= width - 1 || y <= 0 || y >= height - 1;
      const accent = x >= 3 && x <= 8 && y >= 4 && y <= 11;
      if (edge) {
        rgba[i + 0] = 255;
        rgba[i + 1] = 122;
        rgba[i + 2] = 47;
        rgba[i + 3] = 255;
      } else if (accent) {
        rgba[i + 0] = 255;
        rgba[i + 1] = 186;
        rgba[i + 2] = 117;
        rgba[i + 3] = 255;
      } else {
        rgba[i + 0] = 24;
        rgba[i + 1] = 24;
        rgba[i + 2] = 24;
        rgba[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(rgba, { width, height, scaleFactor: 1 });
}

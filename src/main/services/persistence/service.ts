import * as fs from "node:fs";
import * as path from "node:path";
import type { DdcMonitorPayload } from "../../../shared/ipc";
import type { AppState, PresetMap, UiSettings } from "../../../shared/types";

type DdcMonitor = DdcMonitorPayload;
const DEFAULT_SNAPSHOT_FILE_NAME = "app-state.json";
const DEFAULT_PERSIST_DELAY_MS = 80;

export interface PersistedAppState {
  version: number;
  state: AppState;
  presets: PresetMap;
  settings: UiSettings;
  statusText: string;
  errorText: string | null;
  logs: string[];
  mixerOutputId: string | null;
  mixerAppVolume: Record<string, number>;
  mixerAppMuted: Record<string, boolean>;
  ddcMonitorsCache: DdcMonitor[];
  ddcMonitorsCacheTs: number;
  flyoutPinned: boolean;
}

export interface CreatePersistenceServiceDeps {
  getUserDataPath: () => string;
  snapshotFileName?: string;
  persistDelayMs?: number;
}

export interface PersistenceService {
  getPersistedStateFile: () => string;
  hasPersistedSnapshot: () => boolean;
  loadSnapshot: (fallback: PersistedAppState) => PersistedAppState;
  persistNow: (snapshot: PersistedAppState) => void;
  schedulePersist: (buildSnapshot: () => PersistedAppState) => void;
  flushPending: (buildSnapshot: () => PersistedAppState) => void;
  readLegacyStateCache: () => Partial<AppState>;
  readLegacySettings: () => Partial<UiSettings>;
}

/**
 * Creates a persistence service that owns snapshot file I/O and debounced writes.
 */
export function createPersistenceService(deps: CreatePersistenceServiceDeps): PersistenceService {
  const { getUserDataPath, snapshotFileName = DEFAULT_SNAPSHOT_FILE_NAME, persistDelayMs = DEFAULT_PERSIST_DELAY_MS } = deps;
  let persistTimer: NodeJS.Timeout | null = null;

  /**
   * Resolves a file inside Electron's userData folder.
   */
  function getUserFilePath(name: string): string {
    return path.join(getUserDataPath(), name);
  }

  /**
   * Reads JSON from disk and returns a fallback value if anything fails.
   */
  function readJsonFileSafely<T>(filePath: string, fallback: T): T {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Writes JSON using a temp-file rename step to reduce partial-write risk.
   */
  function writeJsonFileAtomically(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf-8");
    fs.renameSync(tempPath, filePath);
  }

  function getPersistedStateFile(): string {
    return getUserFilePath(snapshotFileName);
  }

  function hasPersistedSnapshot(): boolean {
    return fs.existsSync(getPersistedStateFile());
  }

  function loadSnapshot(fallback: PersistedAppState): PersistedAppState {
    return readJsonFileSafely<PersistedAppState>(getPersistedStateFile(), fallback);
  }

  function persistNow(snapshot: PersistedAppState): void {
    writeJsonFileAtomically(getPersistedStateFile(), snapshot);
  }

  function schedulePersist(buildSnapshot: () => PersistedAppState): void {
    if (persistTimer) {
      clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeJsonFileAtomically(getPersistedStateFile(), buildSnapshot());
    }, persistDelayMs);
  }

  function flushPending(buildSnapshot: () => PersistedAppState): void {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    writeJsonFileAtomically(getPersistedStateFile(), buildSnapshot());
  }

  function readLegacyStateCache(): Partial<AppState> {
    return readJsonFileSafely<Partial<AppState>>(getUserFilePath("state-cache.json"), {});
  }

  function readLegacySettings(): Partial<UiSettings> {
    return readJsonFileSafely<Partial<UiSettings>>(getUserFilePath("settings.json"), {});
  }

  return {
    getPersistedStateFile,
    hasPersistedSnapshot,
    loadSnapshot,
    persistNow,
    schedulePersist,
    flushPending,
    readLegacyStateCache,
    readLegacySettings,
  };
}

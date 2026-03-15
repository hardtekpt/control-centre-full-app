import { ipcMain } from "electron";
import * as fs from "node:fs/promises";

export interface FileReadPayload {
  path: string;
  encoding?: BufferEncoding;
}

export interface FileWritePayload {
  path: string;
  content: string;
  encoding?: BufferEncoding;
}

/**
 * Registers simple file read/write IPC handlers.
 * This is intentionally opt-in so the app can expose only the operations it needs.
 */
export function registerFileIpcHandlers(channels: { read: string; write: string }): void {
  ipcMain.handle(channels.read, async (_event, payload: FileReadPayload) => {
    const filePath = String(payload?.path ?? "").trim();
    const encoding = payload?.encoding ?? "utf-8";
    if (!filePath) {
      throw new Error("A valid file path is required.");
    }
    return fs.readFile(filePath, { encoding });
  });

  ipcMain.handle(channels.write, async (_event, payload: FileWritePayload) => {
    const filePath = String(payload?.path ?? "").trim();
    const content = String(payload?.content ?? "");
    const encoding = payload?.encoding ?? "utf-8";
    if (!filePath) {
      throw new Error("A valid file path is required.");
    }
    await fs.writeFile(filePath, content, { encoding });
    return { ok: true };
  });
}

import { BrowserWindow, type IpcMainEvent } from "electron";

export interface CreateWindowIpcHandlersDeps {
  getMainWindow: () => BrowserWindow | null;
  hideFlyout: (reason: string) => void;
  fitFlyoutToContent: (width: number, height: number) => void;
}

export interface WindowIpcHandlers {
  closeCurrentWindow: (event: IpcMainEvent) => void;
  fitFlyoutToContent: (event: IpcMainEvent, payload: { width?: number; height?: number }) => void;
}

/**
 * Creates window-scoped IPC handlers for close/resize behavior.
 */
export function createWindowIpcHandlers(deps: CreateWindowIpcHandlersDeps): WindowIpcHandlers {
  const { getMainWindow, hideFlyout, fitFlyoutToContent } = deps;

  /**
   * Closes the sender window, or hides flyout when sender is the flyout itself.
   */
  function closeCurrentWindow(event: IpcMainEvent): void {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!currentWindow) {
      return;
    }
    if (currentWindow === getMainWindow()) {
      hideFlyout("ipc-close-current");
      return;
    }
    currentWindow.close();
  }

  /**
   * Applies flyout content-fit sizing only when requested by the main flyout renderer.
   */
  function handleFitFlyoutToContent(event: IpcMainEvent, payload: { width?: number; height?: number }): void {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (event.sender !== mainWindow.webContents) {
      return;
    }

    const width = Number(payload?.width);
    const height = Number(payload?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }
    fitFlyoutToContent(width, height);
  }

  return {
    closeCurrentWindow,
    fitFlyoutToContent: handleFitFlyoutToContent,
  };
}

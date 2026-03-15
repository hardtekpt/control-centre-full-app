export interface UpdaterLogger {
  info: (message: string) => void;
  error: (message: string) => void;
}

/**
 * Placeholder auto-updater bootstrap.
 * This module exists to keep updater concerns isolated from the main entry file.
 */
export function initializeAutoUpdater(logger: UpdaterLogger): void {
  logger.info("Auto-updater initialization skipped (not configured).");
}

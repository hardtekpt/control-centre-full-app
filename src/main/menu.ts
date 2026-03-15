import { Menu, type MenuItemConstructorOptions } from "electron";

export interface BuildApplicationMenuOptions {
  onOpenDashboard: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

/**
 * Builds the application menu template used by the main process.
 * Keep this in the main process so renderer code never controls native menus directly.
 */
export function buildApplicationMenuTemplate(options: BuildApplicationMenuOptions): MenuItemConstructorOptions[] {
  return [
    {
      label: "Control Centre",
      submenu: [
        { label: "Open Dashboard", click: () => options.onOpenDashboard() },
        { label: "Open Settings", click: () => options.onOpenSettings() },
        { type: "separator" },
        { label: "Quit", click: () => options.onQuit() },
      ],
    },
  ];
}

/**
 * Applies the app menu globally.
 */
export function setApplicationMenu(options: BuildApplicationMenuOptions): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(options)));
}

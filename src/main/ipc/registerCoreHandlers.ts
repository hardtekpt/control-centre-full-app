import type { IpcMain, IpcMainEvent } from "electron";
import { IPC_INVOKE, IPC_SEND } from "../../shared/ipc";
import type {
  BooleanOkResponse,
  DdcGetMonitorsResponse,
  DdcMutateMonitorResponse,
  DiscordVoiceStatePayload,
  ExportSettingsResponse,
  FlyoutPinnedResponse,
  ImportSettingsResponse,
  InitialPayload,
  MixerDataPayload,
  OpenGgResponse,
  ServiceStatusPayload,
} from "../../shared/ipc";
import type { BackendCommand, UiSettings } from "../../shared/types";

export interface RegisterCoreIpcHandlersDeps {
  ipcMain: IpcMain;
  getInitialPayload: () => Promise<InitialPayload>;
  setFlyoutPinned: (pinned: boolean) => FlyoutPinnedResponse;
  getServiceStatus: () => ServiceStatusPayload;
  sendBackendCommand: (command: BackendCommand) => void;
  previewHeadsetVolume: (payload: unknown) => void;
  openSettingsWindow: () => void;
  closeCurrentWindow: (event: IpcMainEvent) => void;
  fitFlyoutToContent: (event: IpcMainEvent, payload: { width?: number; height?: number }) => void;
  setSettings: (partial: Partial<UiSettings>) => UiSettings;
  openGg: () => Promise<OpenGgResponse>;
  notifyCustom: (payload: { title?: string; body?: string }) => Promise<BooleanOkResponse>;
  getMixerData: () => Promise<MixerDataPayload>;
  setMixerOutput: (outputId: string) => BooleanOkResponse;
  setMixerAppVolume: (payload: { appId: string; volume: number }) => BooleanOkResponse;
  setMixerAppMute: (payload: { appId: string; muted: boolean }) => BooleanOkResponse;
  getDdcMonitors: () => Promise<DdcGetMonitorsResponse>;
  setDdcBrightness: (payload: { monitorId: number; value: number }) => Promise<DdcMutateMonitorResponse>;
  setDdcInputSource: (payload: { monitorId: number; value: string }) => Promise<DdcMutateMonitorResponse>;
  exportSettings: () => Promise<ExportSettingsResponse>;
  importSettings: () => Promise<ImportSettingsResponse>;
  discordConnect: () => Promise<BooleanOkResponse>;
  discordDisconnect: () => Promise<BooleanOkResponse>;
  getDiscordVoiceUsers: () => DiscordVoiceStatePayload;
  setDiscordUserVolume: (payload: { userId: string; volume: number }) => Promise<BooleanOkResponse>;
  setDiscordUserMute: (payload: { userId: string; muted: boolean }) => Promise<BooleanOkResponse>;
}

/**
 * Registers all renderer-facing IPC endpoints that power dashboard/settings.
 * Main process supplies concrete handlers so this module stays framework-agnostic.
 */
export function registerCoreIpcHandlers(deps: RegisterCoreIpcHandlersDeps): void {
  const {
    ipcMain,
    getInitialPayload,
    setFlyoutPinned,
    getServiceStatus,
    sendBackendCommand,
    previewHeadsetVolume,
    openSettingsWindow,
    closeCurrentWindow,
    fitFlyoutToContent,
    setSettings,
    openGg,
    notifyCustom,
    getMixerData,
    setMixerOutput,
    setMixerAppVolume,
    setMixerAppMute,
    getDdcMonitors,
    setDdcBrightness,
    setDdcInputSource,
    exportSettings,
    importSettings,
    discordConnect,
    discordDisconnect,
    getDiscordVoiceUsers,
    setDiscordUserVolume,
    setDiscordUserMute,
  } = deps;

  ipcMain.handle(IPC_INVOKE.APP_GET_INITIAL, getInitialPayload);
  ipcMain.handle(IPC_INVOKE.WINDOW_SET_PINNED, (_event, pinned: boolean) => setFlyoutPinned(pinned));
  ipcMain.handle(IPC_INVOKE.SERVICES_GET_STATUS, () => getServiceStatus());

  ipcMain.on(IPC_SEND.BACKEND_COMMAND, (_event, command: BackendCommand) => sendBackendCommand(command));
  ipcMain.on(IPC_SEND.NOTIFICATION_HEADSET_VOLUME_PREVIEW, (_event, payload: unknown) => previewHeadsetVolume(payload));
  ipcMain.on(IPC_SEND.WINDOW_OPEN_SETTINGS, () => openSettingsWindow());
  ipcMain.on(IPC_SEND.WINDOW_CLOSE_CURRENT, (event) => closeCurrentWindow(event));
  ipcMain.on(IPC_SEND.WINDOW_FIT_CONTENT, (event, payload: { width?: number; height?: number }) => fitFlyoutToContent(event, payload));

  ipcMain.handle(IPC_INVOKE.SETTINGS_SET, (_event, partial: Partial<UiSettings>) => setSettings(partial));
  ipcMain.handle(IPC_INVOKE.APP_OPEN_GG, openGg);
  ipcMain.handle(IPC_INVOKE.APP_NOTIFY_CUSTOM, (_event, payload: { title?: string; body?: string }) => notifyCustom(payload));

  ipcMain.handle(IPC_INVOKE.MIXER_GET_DATA, getMixerData);
  ipcMain.handle(IPC_INVOKE.MIXER_SET_OUTPUT, (_event, outputId: string) => setMixerOutput(outputId));
  ipcMain.handle(IPC_INVOKE.MIXER_SET_APP_VOLUME, (_event, payload: { appId: string; volume: number }) => setMixerAppVolume(payload));
  ipcMain.handle(IPC_INVOKE.MIXER_SET_APP_MUTE, (_event, payload: { appId: string; muted: boolean }) => setMixerAppMute(payload));

  ipcMain.handle(IPC_INVOKE.DDC_GET_MONITORS, getDdcMonitors);
  ipcMain.handle(IPC_INVOKE.DDC_SET_BRIGHTNESS, (_event, payload: { monitorId: number; value: number }) => setDdcBrightness(payload));
  ipcMain.handle(IPC_INVOKE.DDC_SET_INPUT_SOURCE, (_event, payload: { monitorId: number; value: string }) => setDdcInputSource(payload));

  ipcMain.handle(IPC_INVOKE.SETTINGS_EXPORT, exportSettings);
  ipcMain.handle(IPC_INVOKE.SETTINGS_IMPORT, importSettings);

  ipcMain.handle(IPC_INVOKE.DISCORD_CONNECT, discordConnect);
  ipcMain.handle(IPC_INVOKE.DISCORD_DISCONNECT, discordDisconnect);
  ipcMain.handle(IPC_INVOKE.DISCORD_GET_VOICE_USERS, () => getDiscordVoiceUsers());
  ipcMain.handle(IPC_INVOKE.DISCORD_SET_USER_VOLUME, (_event, payload: { userId: string; volume: number }) => setDiscordUserVolume(payload));
  ipcMain.handle(IPC_INVOKE.DISCORD_SET_USER_MUTE, (_event, payload: { userId: string; muted: boolean }) => setDiscordUserMute(payload));
}

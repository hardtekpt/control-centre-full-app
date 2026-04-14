import { useEffect, useState } from "react";
import { CHANNELS, type AppState, type ChannelKey, type PresetMap, type UiSettings } from "@shared/types";
import ChannelRow from "../components/ChannelRow";
import StatusCard from "../components/StatusCard";
import AppMixerRow from "../components/AppMixerRow";
import DiscordVoicePanel from "../components/DiscordVoicePanel";
import type { DdcMonitor, MixerData } from "../stores/store";
import MonitorControlsCard from "../components/MonitorControlsCard";
import type { DiscordVoiceStatePayload } from "@shared/ipc";

interface DashboardPageProps {
  state: AppState;
  presets: PresetMap;
  visibleChannels: ChannelKey[];
  windowsMixerEnabled: boolean;
  mixerData: MixerData;
  ddcMonitors: DdcMonitor[];
  ddcSettings: UiSettings["ddc"];
  onSetVolume: (channel: string, value: number) => void;
  onVolumePreview: (channel: string, value: number) => void;
  onSetMute: (channel: string, value: boolean) => void;
  onSetPreset: (channel: string, presetId: string) => void;
  onRefreshMixer: () => void;
  onSetMixerOutput: (outputId: string) => void;
  onSetMixerAppVolume: (appId: string, value: number) => void;
  onSetMixerAppMute: (appId: string, muted: boolean) => void;
  onSetDdcBrightness: (monitorId: number, value: number) => void;
  onSetDdcInputSource: (monitorId: number, value: string) => void;
  discordEnabled: boolean;
  discordVoiceState: DiscordVoiceStatePayload;
  onSetDiscordUserVolume: (userId: string, volume: number) => void;
  onSetDiscordUserMute: (userId: string, muted: boolean) => void;
}

/**
 * Main dashboard layout: status cards, Sonar channels, and optional Windows mixer.
 */
export default function DashboardPage(props: DashboardPageProps) {
  const [tab, setTab] = useState<"sonar" | "windows" | "discord">("sonar");
  const visible = CHANNELS.filter((channel) => props.visibleChannels.includes(channel));
  const windowsMixerEnabled = props.windowsMixerEnabled !== false;
  const discordEnabled = props.discordEnabled === true;

  /**
   * Refreshes mixer data only when the user enters the Windows mixer tab.
   */
  useEffect(() => {
    if (tab === "windows" && windowsMixerEnabled) {
      props.onRefreshMixer();
    }
  }, [tab, windowsMixerEnabled]);

  /**
   * Ensures hidden feature tabs cannot remain selected after settings changes.
   */
  useEffect(() => {
    if (!windowsMixerEnabled && tab === "windows") {
      setTab("sonar");
    }
  }, [tab, windowsMixerEnabled]);

  useEffect(() => {
    if (!discordEnabled && tab === "discord") {
      setTab("sonar");
    }
  }, [tab, discordEnabled]);

  return (
    <div className="dashboard-page">
      <div className="dashboard-main-row">
        <StatusCard state={props.state} />
        <MonitorControlsCard
          ddcMonitors={props.ddcMonitors}
          ddcSettings={props.ddcSettings}
          onSetBrightness={props.onSetDdcBrightness}
          onSetInputSource={props.onSetDdcInputSource}
        />
      </div>
      <section className="card channels">
        <div className="channels-topbar">
          <div className="tab-selector">
            <button className={`tab-btn ${tab === "sonar" ? "active" : ""}`} onClick={() => setTab("sonar")}>
              Sonar Channels
            </button>
            {windowsMixerEnabled && (
              <button className={`tab-btn ${tab === "windows" ? "active" : ""}`} onClick={() => setTab("windows")}>
                Windows Mixer
              </button>
            )}
            {discordEnabled && (
              <button className={`tab-btn ${tab === "discord" ? "active" : ""}`} onClick={() => setTab("discord")}>
                Discord
              </button>
            )}
          </div>
        </div>
        {tab === "sonar" && (
          <div className="channel-list">
            {visible.map((channel) => (
              <ChannelRow
                key={channel}
                channel={channel}
                volume={Math.max(0, Math.min(100, props.state.channel_volume[channel] ?? 0))}
                muted={Boolean(props.state.channel_mute[channel])}
                selectedPreset={props.state.channel_preset[channel] ?? null}
                presets={props.presets[channel] ?? []}
                apps={props.state.channel_apps[channel] ?? []}
                onVolumeCommit={(value) => props.onSetVolume(channel, value)}
                onVolumePreview={(rowChannel, value: number) => props.onVolumePreview(rowChannel, value)}
                onMuteChange={(value) => props.onSetMute(channel, value)}
                onPresetChange={(presetId) => props.onSetPreset(channel, presetId)}
              />
            ))}
          </div>
        )}
        {discordEnabled && tab === "discord" && (
          <DiscordVoicePanel
            voiceState={props.discordVoiceState}
            onSetUserVolume={props.onSetDiscordUserVolume}
            onSetUserMute={props.onSetDiscordUserMute}
          />
        )}
        {windowsMixerEnabled && tab === "windows" && (
          <div className="windows-mixer">
            <label className="mixer-output">
              <span>Output</span>
              <select value={props.mixerData.selectedOutputId} onChange={(e) => props.onSetMixerOutput(e.currentTarget.value)}>
                {props.mixerData.outputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="mixer-list">
              {props.mixerData.apps.length === 0 && <div className="mixer-empty">No routed apps currently detected.</div>}
              {props.mixerData.apps.map((app) => (
                <AppMixerRow
                  key={app.id}
                  label={app.name}
                  volume={app.volume}
                  muted={app.muted}
                  onVolumeCommit={(value) => props.onSetMixerAppVolume(app.id, value)}
                  onMuteChange={(value) => props.onSetMixerAppMute(app.id, value)}
                />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

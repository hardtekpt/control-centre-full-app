import { useEffect, useState } from "react";
import { CHANNELS, type AppState, type ChannelKey, type PresetMap } from "@shared/types";
import ChannelRow from "../components/ChannelRow";
import StatusCard from "../components/StatusCard";
import AppMixerRow from "../components/AppMixerRow";
import type { MixerData } from "../state/store";

interface DashboardPageProps {
  state: AppState;
  presets: PresetMap;
  visibleChannels: ChannelKey[];
  mixerData: MixerData;
  onSetVolume: (channel: string, value: number) => void;
  onSetMute: (channel: string, value: boolean) => void;
  onSetPreset: (channel: string, presetId: string) => void;
  onRefreshMixer: () => void;
  onSetMixerOutput: (outputId: string) => void;
  onSetMixerAppVolume: (appId: string, value: number) => void;
  onSetMixerAppMute: (appId: string, muted: boolean) => void;
}

export default function DashboardPage(props: DashboardPageProps) {
  const [tab, setTab] = useState<"sonar" | "windows">("sonar");
  const visible = CHANNELS.filter((channel) => props.visibleChannels.includes(channel));

  useEffect(() => {
    if (tab === "windows") {
      props.onRefreshMixer();
    }
  }, [tab]);

  return (
    <div className="dashboard-page">
      <StatusCard state={props.state} />
      <section className="card channels">
        <div className="channels-topbar">
          <div className="tab-selector">
            <button className={`tab-btn ${tab === "sonar" ? "active" : ""}`} onClick={() => setTab("sonar")}>
              Sonar Channels
            </button>
            <button className={`tab-btn ${tab === "windows" ? "active" : ""}`} onClick={() => setTab("windows")}>
              Windows Mixer
            </button>
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
                onMuteChange={(value) => props.onSetMute(channel, value)}
                onPresetChange={(presetId) => props.onSetPreset(channel, presetId)}
              />
            ))}
          </div>
        )}
        {tab === "windows" && (
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

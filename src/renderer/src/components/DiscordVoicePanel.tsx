import { type WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DiscordVoiceStatePayload, DiscordVoiceUserPayload } from "@shared/ipc";
import VolumeIcon from "./icons/VolumeIcon";

interface DiscordVoicePanelProps {
  voiceState: DiscordVoiceStatePayload;
  onSetUserVolume: (userId: string, volume: number) => void;
  onSetUserMute: (userId: string, muted: boolean) => void;
}

export default function DiscordVoicePanel({ voiceState, onSetUserVolume, onSetUserMute }: DiscordVoicePanelProps) {
  const headerText = (() => {
    switch (voiceState.rpcState) {
      case "connected":
        return voiceState.channelName ?? "Voice channel";
      case "reconnecting":
        return "Reconnecting…";
      case "starting":
        return "Connecting…";
      case "stopped":
        return "Discord not enabled";
      default:
        return "Discord not running";
    }
  })();

  const showUsers = voiceState.rpcState === "connected" && voiceState.users.length > 0;
  const showEmpty = voiceState.rpcState === "connected" && voiceState.users.length === 0;

  return (
    <div className="discord-voice-panel">
      <div className="discord-channel-header">{headerText}</div>
      {showEmpty && <div className="discord-channel-header">Not in a voice channel</div>}
      {showUsers && (
        <div className="discord-user-list">
          {voiceState.users.map((user) => (
            <DiscordUserRow
              key={user.userId}
              user={user}
              onVolumeCommit={(vol) => onSetUserVolume(user.userId, vol)}
              onMuteChange={(muted) => onSetUserMute(user.userId, muted)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DiscordUserRowProps {
  user: DiscordVoiceUserPayload;
  onVolumeCommit: (volume: number) => void;
  onMuteChange: (muted: boolean) => void;
}

function DiscordUserRow({ user, onVolumeCommit, onMuteChange }: DiscordUserRowProps) {
  const [draftVolume, setDraftVolume] = useState(user.volume);
  const wheelCommitTimer = useRef<number | null>(null);
  const pendingWheelVolume = useRef<number>(user.volume);
  const isMuted = user.muted || user.selfMuted;

  useEffect(() => setDraftVolume(user.volume), [user.volume]);
  useEffect(() => {
    pendingWheelVolume.current = user.volume;
  }, [user.volume]);
  useEffect(
    () => () => {
      if (wheelCommitTimer.current !== null) {
        window.clearTimeout(wheelCommitTimer.current);
      }
    },
    [],
  );

  const progressStyle = useMemo(
    () => ({ width: `${Math.max(0, Math.min(100, draftVolume / 2))}%` }),
    [draftVolume],
  );

  const commitVolume = () => {
    const next = Math.max(0, Math.min(200, draftVolume));
    if (next !== user.volume) onVolumeCommit(next);
  };

  const onWheelSlider = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1;
    setDraftVolume((prev) => {
      const next = Math.max(0, Math.min(200, prev + delta));
      pendingWheelVolume.current = next;
      return next;
    });
    if (wheelCommitTimer.current !== null) {
      window.clearTimeout(wheelCommitTimer.current);
    }
    wheelCommitTimer.current = window.setTimeout(() => {
      onVolumeCommit(pendingWheelVolume.current);
      wheelCommitTimer.current = null;
    }, 85);
  };

  return (
    <div className={`channel-row app-mixer-row discord-user-row${user.speaking ? " is-speaking" : ""}`}>
      <div className="app-inline-label" title={user.username}>
        {user.username}
      </div>
      <div className="horizontal-slider-wrap app-inline-slider" onWheel={onWheelSlider}>
        <div className="horizontal-track">
          <div className="horizontal-progress" style={progressStyle} />
        </div>
        <input
          type="range"
          min={0}
          max={200}
          value={draftVolume}
          onChange={(e) => setDraftVolume(Number(e.currentTarget.value))}
          onMouseUp={commitVolume}
          onTouchEnd={commitVolume}
          onKeyUp={commitVolume}
          className="horizontal-range"
        />
      </div>
      <div className="app-inline-value">{draftVolume}</div>
      <button
        className={`mute-toggle app-inline-mute ${isMuted ? "is-muted" : ""}`}
        onClick={() => onMuteChange(!user.muted)}
        title={user.selfMuted ? "Self-muted" : "Toggle mute"}
        disabled={user.selfMuted && !user.muted}
      >
        <VolumeIcon muted={isMuted} />
      </button>
    </div>
  );
}

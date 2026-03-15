import { type WheelEvent, useEffect, useMemo, useRef, useState } from "react";

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.floor(Number(value) || 0)));
}

interface ChannelRowProps {
  channel: string;
  volume: number;
  muted: boolean;
  selectedPreset: string | null;
  presets: Array<[string, string]>;
  apps: string[];
  onVolumeCommit: (value: number) => void;
  onVolumePreview?: (channel: string, value: number) => void;
  onMuteChange: (value: boolean) => void;
  onPresetChange: (presetId: string) => void;
}

function VolumeIcon({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" />
        <path d="M16 9l5 5M21 9l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" />
      <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 7a8 8 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function ChannelRow(props: ChannelRowProps) {
  const [draftVolume, setDraftVolume] = useState(props.volume);
  const wheelCommitTimer = useRef<number | null>(null);
  const volumePreviewTimer = useRef<number | null>(null);
  const lastPreviewVolume = useRef<number | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const pendingWheelVolume = useRef<number>(props.volume);
  useEffect(() => setDraftVolume(props.volume), [props.volume]);
  useEffect(() => {
    lastPreviewVolume.current = null;
  }, [props.volume]);
  useEffect(() => {
    pendingWheelVolume.current = props.volume;
  }, [props.volume]);
  useEffect(
    () => () => {
      if (wheelCommitTimer.current !== null) {
        window.clearTimeout(wheelCommitTimer.current);
      }
      if (volumePreviewTimer.current !== null) {
        window.clearTimeout(volumePreviewTimer.current);
      }
    },
    [],
  );
  const appText = useMemo(() => (props.apps.length ? props.apps.join(", ") : "-"), [props.apps]);
  const verticalProgressStyle = useMemo(
    () => ({ height: `${Math.max(0, Math.min(100, draftVolume))}%` }),
    [draftVolume],
  );

  const scheduleVolumePreview = (value: number) => {
    const next = clampPercent(value);
    if (volumePreviewTimer.current !== null) {
      window.clearTimeout(volumePreviewTimer.current);
    }
    volumePreviewTimer.current = window.setTimeout(() => {
      volumePreviewTimer.current = null;
      if (lastPreviewVolume.current === next) {
        return;
      }
      lastPreviewVolume.current = next;
      props.onVolumePreview?.(props.channel, next);
    }, 25);
  };

  const onRangeChange = (value: number) => {
    const next = clampPercent(value);
    setDraftVolume(next);
    scheduleVolumePreview(next);
  };

  const commitVolume = () => {
    const next = Math.max(0, Math.min(100, draftVolume));
    if (next !== props.volume) props.onVolumeCommit(next);
  };

  const onWheelSlider = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 1 : -1;
    setDraftVolume((prev) => {
      const next = Math.max(0, Math.min(100, prev + delta));
      pendingWheelVolume.current = next;
      scheduleVolumePreview(next);
      return next;
    });
    if (wheelCommitTimer.current !== null) {
      window.clearTimeout(wheelCommitTimer.current);
    }
    wheelCommitTimer.current = window.setTimeout(() => {
      props.onVolumeCommit(pendingWheelVolume.current);
      wheelCommitTimer.current = null;
    }, 85);
  };

  const channelLabel = useMemo(() => {
    if (props.channel === "chatRender") return "CHAT";
    if (props.channel === "chatCapture") return "MIC";
    if (props.channel === "master") return "MASTER";
    return props.channel.toUpperCase();
  }, [props.channel]);

  const selectedPreset = useMemo(() => {
    const raw = props.selectedPreset?.trim() ?? "";
    if (!raw) {
      return { value: "", label: "", missing: false };
    }

    const byId = props.presets.find(([id]) => id === raw);
    if (byId) {
      return { value: byId[0], label: byId[1], missing: false };
    }

    const byName = props.presets.find(([, name]) => name.trim().toLowerCase() === raw.toLowerCase());
    if (byName) {
      return { value: byName[0], label: byName[1], missing: false };
    }

    // Keep showing the active preset even when Sonar returns an id/name not present in favorites.
    return { value: raw, label: raw, missing: true };
  }, [props.presets, props.selectedPreset]);

  useEffect(() => {
    const el = selectRef.current;
    if (!el || !selectedPreset.label) return;
    el.scrollLeft = 0;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 4) return;
    let dir = 1;
    const tick = window.setInterval(() => {
      const next = el.scrollLeft + dir;
      if (next >= overflow) dir = -1;
      if (next <= 0) dir = 1;
      el.scrollLeft = Math.max(0, Math.min(overflow, next));
    }, 40);
    return () => window.clearInterval(tick);
  }, [selectedPreset.label]);

  return (
    <div className="channel-row">
      <div className="channel-card-title">{channelLabel}</div>
      <div className="vertical-slider-wrap" onWheel={onWheelSlider}>
        <div className="vertical-track">
          <div className="vertical-progress" style={verticalProgressStyle} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={draftVolume}
          onChange={(e) => onRangeChange(Number(e.currentTarget.value))}
          onMouseUp={commitVolume}
          onTouchEnd={commitVolume}
          onKeyUp={commitVolume}
          className="vertical-range"
        />
      </div>
      <div className="channel-value">{draftVolume}%</div>
      <button className={`mute-toggle ${props.muted ? "is-muted" : ""}`} onClick={() => props.onMuteChange(!props.muted)} title="Toggle mute">
        <VolumeIcon muted={props.muted} />
      </button>
      {props.channel !== "master" && (
        <select
          ref={selectRef}
          title={selectedPreset.label}
          value={selectedPreset.value}
          onChange={(e) => {
            if (e.currentTarget.value) props.onPresetChange(e.currentTarget.value);
          }}
        >
          <option value="">Preset</option>
          {selectedPreset.missing && selectedPreset.value && (
            <option value={selectedPreset.value}>{selectedPreset.label}</option>
          )}
          {props.presets.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      )}
      {props.channel === "master" && <div className="preset-placeholder" />}
      <div className="apps" title={appText}>
        {appText}
      </div>
    </div>
  );
}

import { type WheelEvent, useEffect, useMemo, useRef, useState } from "react";

interface AppMixerRowProps {
  label: string;
  volume: number;
  muted: boolean;
  onVolumeCommit: (value: number) => void;
  onMuteChange: (value: boolean) => void;
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

export default function AppMixerRow(props: AppMixerRowProps) {
  const [draftVolume, setDraftVolume] = useState(props.volume);
  const wheelCommitTimer = useRef<number | null>(null);
  const pendingWheelVolume = useRef<number>(props.volume);

  useEffect(() => setDraftVolume(props.volume), [props.volume]);
  useEffect(() => {
    pendingWheelVolume.current = props.volume;
  }, [props.volume]);
  useEffect(
    () => () => {
      if (wheelCommitTimer.current !== null) {
        window.clearTimeout(wheelCommitTimer.current);
      }
    },
    [],
  );

  const verticalProgressStyle = useMemo(
    () => ({ width: `${Math.max(0, Math.min(100, draftVolume))}%` }),
    [draftVolume],
  );

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

  return (
    <div className="channel-row app-mixer-row">
      <div className="app-inline-label" title={props.label}>
        {props.label}
      </div>

      <div className="horizontal-slider-wrap app-inline-slider" onWheel={onWheelSlider}>
        <div className="horizontal-track">
          <div className="horizontal-progress" style={verticalProgressStyle} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={draftVolume}
          onChange={(e) => setDraftVolume(Number(e.currentTarget.value))}
          onMouseUp={commitVolume}
          onTouchEnd={commitVolume}
          onKeyUp={commitVolume}
          className="horizontal-range"
        />
      </div>

      <div className="app-inline-value">{draftVolume}%</div>
      <button className={`mute-toggle app-inline-mute ${props.muted ? "is-muted" : ""}`} onClick={() => props.onMuteChange(!props.muted)} title="Toggle mute">
        <VolumeIcon muted={props.muted} />
      </button>
    </div>
  );
}

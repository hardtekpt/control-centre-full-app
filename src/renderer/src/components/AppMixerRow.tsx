import { type WheelEvent, useEffect, useMemo, useRef, useState } from "react";
import VolumeIcon from "./icons/VolumeIcon";

interface AppMixerRowProps {
  label: string;
  volume: number;
  muted: boolean;
  onVolumeCommit: (value: number) => void;
  onMuteChange: (value: boolean) => void;
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

  /**
   * Commits the local slider draft to backend if it differs from current value.
   */
  const commitVolume = () => {
    const next = Math.max(0, Math.min(100, draftVolume));
    if (next !== props.volume) props.onVolumeCommit(next);
  };

  /**
   * Mouse wheel volume bump with short debounce for smooth UX.
   */
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

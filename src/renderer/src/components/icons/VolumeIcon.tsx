interface VolumeIconProps {
  muted: boolean;
}

/**
 * Speaker icon used by channel and mixer mute controls.
 */
export default function VolumeIcon({ muted }: VolumeIconProps) {
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

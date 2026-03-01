import type { AppState } from "@shared/types";

const SIDETONE_LABELS: Record<number, string> = { 0: "off", 1: "low", 2: "med", 3: "high" };

function IconVolume() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor" />
      <path d="M16 9a4.5 4.5 0 0 1 0 6M18.5 7a8 8 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconSidetone() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor" />
      <path d="M7 10a5 5 0 1 0 10 0M12 17v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function StatusCard({ state }: { state: AppState }) {
  const sidetone = state.sidetone_level == null ? "N/A" : SIDETONE_LABELS[state.sidetone_level] ?? String(state.sidetone_level);
  return (
    <section className="card status-card">
      <div className="status-compact-grid">
        <div className="status-block">
          <div className="status-block-title">Headset</div>
          <div className="status-item">
            <span className="status-icon">&#xE995;</span> ANC: {state.anc_mode ?? "N/A"}
          </div>
          <div className="status-item">
            <span className="status-icon">&#xE706;</span> OLED: {state.oled_brightness ?? "N/A"}
          </div>
          <div className="status-item">
            <IconSidetone /> Sidetone: {sidetone}
          </div>
        </div>
        <div className="status-block">
          <div className="status-block-title">Audio</div>
          <div className="status-item">
            <IconVolume /> Vol: {state.headset_volume_percent ?? "N/A"}%
          </div>
          <div className="status-item">
            <span className="status-icon">&#xE93C;</span> Mix: {state.chat_mix_balance ?? "N/A"}%
          </div>
          <div className="status-item">
            <span className="status-icon">&#xE720;</span> Mic: {state.mic_mute === null ? "N/A" : state.mic_mute ? "Muted" : "Live"}
          </div>
        </div>
      </div>
    </section>
  );
}

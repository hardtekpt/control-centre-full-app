import type { AppState } from "@shared/types";
import StatusSidetoneIcon from "./icons/StatusSidetoneIcon";
import StatusVolumeIcon from "./icons/StatusVolumeIcon";

const SIDETONE_LABELS: Record<number, string> = { 0: "off", 1: "low", 2: "med", 3: "high" };

interface StatusCardProps {
  state: AppState;
}

/**
 * Converts sidetone raw value into a short user-facing label.
 */
function formatSidetone(value: number | null): string {
  if (value == null) {
    return "N/A";
  }
  return SIDETONE_LABELS[value] ?? String(value);
}

/**
 * Converts base-station connectivity state into readable text.
 */
function formatBaseStationConnection(value: boolean | null): string {
  if (value == null) {
    return "N/A";
  }
  return value ? "Connected" : "Disconnected";
}

/**
 * Converts current USB input value into readable text.
 */
function formatUsbInput(value: number | null): string {
  if (value == null) {
    return "N/A";
  }
  return String(value);
}

/**
 * Displays compact headset + audio status blocks in the dashboard.
 */
export default function StatusCard({ state }: StatusCardProps) {
  const sidetone = formatSidetone(state.sidetone_level);
  const baseStation = formatBaseStationConnection(state.base_station_connected);
  const usbInput = formatUsbInput(state.current_usb_input);
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
            <StatusSidetoneIcon /> Sidetone: {sidetone}
          </div>
          <div className="status-item">
            <span className="status-icon">&#xE7F4;</span> Base: {baseStation}
          </div>
          <div className="status-item">
            <span className="status-icon">&#xEC4E;</span> USB Input: {usbInput}
          </div>
        </div>
        <div className="status-block">
          <div className="status-block-title">Audio</div>
          <div className="status-item">
            <StatusVolumeIcon /> Vol: {state.headset_volume_percent ?? "N/A"}%
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

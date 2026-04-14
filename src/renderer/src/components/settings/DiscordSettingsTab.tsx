import type { ServiceStatus } from "../../stores/store";
import type { UiSettings } from "@shared/types";

interface DiscordSettingsTabProps {
  settings: UiSettings;
  serviceStatus: ServiceStatus;
  onUpdate: (partial: Partial<UiSettings>) => void;
}

const STATE_LABELS: Record<string, string> = {
  running: "Connected",
  starting: "Connecting",
  stopped: "Stopped",
  error: "Error",
};

export default function DiscordSettingsTab({ settings, serviceStatus, onUpdate }: DiscordSettingsTabProps) {
  const discordStatus = serviceStatus.discordRpc;
  const stateLabel = STATE_LABELS[discordStatus.state] ?? discordStatus.state;
  const hasClientId = settings.discord.clientId.trim().length > 0;
  const hasToken = settings.discord.accessToken.trim().length > 0;

  return (
    <>
      <h3>Discord Settings</h3>

      <div className="settings-section">
        <div className="settings-section-title">Service</div>
        <div className="form-row">
          <label>Enable Discord RPC</label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={settings.services.discordEnabled === true}
              onChange={(event) =>
                onUpdate({
                  services: { ...settings.services, discordEnabled: event.currentTarget.checked },
                })
              }
            />
            <span style={{ fontSize: "0.86em", opacity: 0.75 }}>Allow the app to connect to Discord</span>
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Connection</div>
        <div className="settings-two-col" style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: "0.84em", opacity: 0.75 }}>Application ID</label>
            <input
              className="text-input"
              type="text"
              placeholder="e.g. 1234567890123456789"
              value={settings.discord.clientId}
              onChange={(event) =>
                onUpdate({
                  discord: { ...settings.discord, clientId: event.currentTarget.value },
                })
              }
              style={{ width: "100%" }}
            />
            <span style={{ fontSize: "0.78em", opacity: 0.5 }}>
              Create a free application at discord.com/developers/applications
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, justifyContent: "flex-start" }}>
            <button
              className="btn"
              disabled={!hasClientId}
              onClick={() => void window.arctisBridge.discordConnect()}
              title={hasClientId ? "Authorize with Discord" : "Enter an Application ID first"}
            >
              Connect
            </button>
            <button
              className="btn"
              onClick={() => void window.arctisBridge.discordDisconnect()}
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Status</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className={`service-state ${discordStatus.state === "running" ? "running" : discordStatus.state === "error" ? "error" : discordStatus.state === "starting" ? "starting" : "stopped"}`}>
            {stateLabel}
          </span>
          <span style={{ fontSize: "0.84em", opacity: 0.75 }}>{discordStatus.detail}</span>
        </div>
        {discordStatus.channelName && (
          <div style={{ fontSize: "0.84em", opacity: 0.65, marginBottom: 4 }}>
            Channel: {discordStatus.channelName}
          </div>
        )}
        <p style={{ fontSize: "0.80em", opacity: 0.55, margin: "6px 0 0" }}>
          Only one application can modify Discord voice settings at a time. Settings reset when Discord restarts.
        </p>
      </div>

      {hasToken && (
        <div className="settings-section">
          <div className="settings-section-title">Token</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "0.84em", opacity: 0.65, flex: 1 }}>Saved access token is present.</span>
            <button
              className="btn"
              onClick={() =>
                onUpdate({
                  discord: { ...settings.discord, accessToken: "" },
                })
              }
            >
              Clear saved token
            </button>
          </div>
        </div>
      )}
    </>
  );
}

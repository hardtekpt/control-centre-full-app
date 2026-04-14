import { EventEmitter } from "events";
import type { DiscordVoiceUserPayload, DiscordVoiceStatePayload } from "@shared/ipc";

export type DiscordRpcState = "stopped" | "starting" | "connected" | "disconnected" | "reconnecting";

export interface DiscordRpcRuntimeStatus {
  state: DiscordRpcState;
  detail: string;
  channelId: string | null;
  channelName: string | null;
}

interface VoiceStateUser {
  id: string;
  username: string;
  nick?: string;
}

interface VoiceStateData {
  user: VoiceStateUser;
  volume?: number;
  mute?: boolean;
  self_mute?: boolean;
  self_deaf?: boolean;
  nick?: string;
}

interface SpeakingData {
  user_id: string;
}

interface DiscordVoiceUser {
  userId: string;
  username: string;
  volume: number;
  muted: boolean;
  selfMuted: boolean;
  selfDeafened: boolean;
  speaking: boolean;
}

const SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write"];
const BASE_RETRY_MS = 3000;
const MAX_RETRY_MS = 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DiscordClient = any;

export class DiscordRpcService extends EventEmitter {
  private state: DiscordRpcState = "stopped";
  private client: DiscordClient = null;
  private voiceUsers = new Map<string, DiscordVoiceUser>();
  private channelId: string | null = null;
  private channelName: string | null = null;
  private clientId = "";
  private savedAccessToken = "";
  private retryTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private enabled = false;
  private voiceSubscriptions: Array<{ unsubscribe: () => Promise<unknown> }> = [];

  public start(): void {
    if (this.state !== "stopped") {
      return;
    }
    this.setState("starting", "Connecting…");
    void this.connect();
  }

  public stop(): void {
    this.clearRetry();
    this.enabled = false;
    void this.destroyClient();
    this.voiceUsers.clear();
    this.channelId = null;
    this.channelName = null;
    this.setState("stopped", "Stopped");
    this.emit("voice-update", this.buildVoiceUserPayloads());
  }

  public configureRuntime(config: { enabled?: boolean; clientId?: string; accessToken?: string }): void {
    if (config.clientId != null) {
      this.clientId = config.clientId;
    }
    if (config.accessToken != null) {
      this.savedAccessToken = config.accessToken;
    }
    if (config.enabled != null) {
      const wasEnabled = this.enabled;
      this.enabled = config.enabled;
      if (this.enabled && !wasEnabled && this.state === "stopped") {
        this.start();
      } else if (!this.enabled && wasEnabled) {
        this.stop();
      }
    }
  }

  public getRuntimeStatus(): DiscordRpcRuntimeStatus {
    return {
      state: this.state,
      detail: this.stateDetail,
      channelId: this.channelId,
      channelName: this.channelName,
    };
  }

  public getVoiceUsers(): DiscordVoiceUserPayload[] {
    return this.buildVoiceUserPayloads();
  }

  public buildStatePayload(): DiscordVoiceStatePayload {
    return {
      rpcState: this.state,
      detail: this.stateDetail,
      channelId: this.channelId,
      channelName: this.channelName,
      users: this.buildVoiceUserPayloads(),
    };
  }

  public async connect(): Promise<void> {
    if (!this.clientId) {
      this.setState("disconnected", "No Application ID configured");
      return;
    }
    try {
      const discordRpc = await import("discord-rpc") as { Client: new (opts: { transport: string }) => DiscordClient };
      const client: DiscordClient = new discordRpc.Client({ transport: "ipc" });
      this.client = client;

      client.on("disconnected", () => {
        if (this.client !== client) {
          return;
        }
        this.emit("status", "Discord disconnected");
        void this.destroyClient();
        if (this.enabled && this.state !== "stopped") {
          this.setState("reconnecting", "Reconnecting…");
          this.scheduleRetry();
        }
      });

      const loginOpts: { clientId: string; scopes: string[]; accessToken?: string } = {
        clientId: this.clientId,
        scopes: SCOPES,
      };
      if (this.savedAccessToken) {
        loginOpts.accessToken = this.savedAccessToken;
      }

      await client.login(loginOpts);

      if (this.client !== client) {
        // Was stopped while connecting.
        return;
      }

      const token: string = client.accessToken as string;
      if (token && token !== this.savedAccessToken) {
        this.savedAccessToken = token;
        this.emit("token-refreshed", token);
      }

      this.retryCount = 0;
      this.setState("connected", "Connected");
      this.emit("status", "Discord RPC connected");

      // Subscribe to voice channel select (no channel_id needed)
      await client.subscribe("VOICE_CHANNEL_SELECT", {});
      client.on("VOICE_CHANNEL_SELECT", (data: { channel_id: string | null; guild_id?: string }) => {
        void this.handleVoiceChannelSelect(data.channel_id);
      });

      // Fetch current voice channel
      try {
        const current: { id: string; name: string; voice_states?: VoiceStateData[] } | null =
          await (client as DiscordClient).request("GET_SELECTED_VOICE_CHANNEL");
        if (current) {
          await this.handleVoiceChannelSelect(current.id, current);
        }
      } catch {
        // Not in a voice channel
      }
    } catch (err) {
      if (this.client) {
        void this.destroyClient();
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (this.enabled && this.state !== "stopped") {
        this.setState("disconnected", `Disconnected: ${msg}`);
        this.scheduleRetry();
      }
      this.emit("error", `Discord connect failed: ${msg}`);
    }
  }

  public async disconnect(): Promise<void> {
    this.clearRetry();
    await this.destroyClient();
    this.voiceUsers.clear();
    this.channelId = null;
    this.channelName = null;
    this.setState("disconnected", "Disconnected by user");
    this.emit("voice-update", this.buildVoiceUserPayloads());
  }

  public async setUserVolume(userId: string, volume: number): Promise<void> {
    if (!this.client) {
      return;
    }
    const clamped = Math.max(0, Math.min(200, Math.round(volume)));
    await (this.client as DiscordClient).setUserVoiceSettings(userId, { volume: clamped });
    const user = this.voiceUsers.get(userId);
    if (user) {
      user.volume = clamped;
      this.emit("voice-update", this.buildVoiceUserPayloads());
    }
  }

  public async setUserMute(userId: string, muted: boolean): Promise<void> {
    if (!this.client) {
      return;
    }
    await (this.client as DiscordClient).setUserVoiceSettings(userId, { mute: muted });
    const user = this.voiceUsers.get(userId);
    if (user) {
      user.muted = muted;
      this.emit("voice-update", this.buildVoiceUserPayloads());
    }
  }

  // --- Private helpers ---

  private stateDetail = "";

  private setState(state: DiscordRpcState, detail: string): void {
    this.state = state;
    this.stateDetail = detail;
    this.emit("state-change", this.getRuntimeStatus());
  }

  private async destroyClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.voiceSubscriptions = [];
    if (!client) {
      return;
    }
    try {
      await (client as DiscordClient).destroy();
    } catch {
      // Ignore destroy errors
    }
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = Math.min(BASE_RETRY_MS * Math.pow(2, this.retryCount), MAX_RETRY_MS);
    this.retryCount += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.enabled && this.state !== "stopped" && this.state !== "connected") {
        void this.connect();
      }
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private async handleVoiceChannelSelect(channelId: string | null, initialData?: { id: string; name: string; voice_states?: VoiceStateData[] }): Promise<void> {
    // Unsubscribe previous voice-state subs
    for (const sub of this.voiceSubscriptions) {
      try {
        await sub.unsubscribe();
      } catch {
        // Ignore
      }
    }
    this.voiceSubscriptions = [];
    this.voiceUsers.clear();

    if (!channelId) {
      this.channelId = null;
      this.channelName = null;
      this.emit("voice-update", this.buildVoiceUserPayloads());
      return;
    }

    this.channelId = channelId;

    try {
      const channelData: { id: string; name: string; voice_states?: VoiceStateData[] } =
        initialData ?? await (this.client as DiscordClient).request("GET_SELECTED_VOICE_CHANNEL");
      this.channelName = channelData.name;

      // Populate initial users from voice_states
      for (const vs of channelData.voice_states ?? []) {
        this.upsertVoiceUser(vs);
      }

      // Subscribe to voice state events for this channel
      const args = { channel_id: channelId };

      const subCreate = await (this.client as DiscordClient).subscribe("VOICE_STATE_CREATE", args);
      this.voiceSubscriptions.push(subCreate);
      (this.client as DiscordClient).on("VOICE_STATE_CREATE", (data: VoiceStateData) => {
        if (this.channelId !== channelId) return;
        this.upsertVoiceUser(data);
        this.emit("voice-update", this.buildVoiceUserPayloads());
      });

      const subUpdate = await (this.client as DiscordClient).subscribe("VOICE_STATE_UPDATE", args);
      this.voiceSubscriptions.push(subUpdate);
      (this.client as DiscordClient).on("VOICE_STATE_UPDATE", (data: VoiceStateData) => {
        if (this.channelId !== channelId) return;
        this.upsertVoiceUser(data);
        this.emit("voice-update", this.buildVoiceUserPayloads());
      });

      const subDelete = await (this.client as DiscordClient).subscribe("VOICE_STATE_DELETE", args);
      this.voiceSubscriptions.push(subDelete);
      (this.client as DiscordClient).on("VOICE_STATE_DELETE", (data: VoiceStateData) => {
        if (this.channelId !== channelId) return;
        this.voiceUsers.delete(data.user?.id ?? "");
        this.emit("voice-update", this.buildVoiceUserPayloads());
      });

      const subSpeakStart = await (this.client as DiscordClient).subscribe("SPEAKING_START", args);
      this.voiceSubscriptions.push(subSpeakStart);
      (this.client as DiscordClient).on("SPEAKING_START", (data: SpeakingData) => {
        if (this.channelId !== channelId) return;
        const user = this.voiceUsers.get(data.user_id);
        if (user) {
          user.speaking = true;
          this.emit("voice-update", this.buildVoiceUserPayloads());
        }
      });

      const subSpeakStop = await (this.client as DiscordClient).subscribe("SPEAKING_STOP", args);
      this.voiceSubscriptions.push(subSpeakStop);
      (this.client as DiscordClient).on("SPEAKING_STOP", (data: SpeakingData) => {
        if (this.channelId !== channelId) return;
        const user = this.voiceUsers.get(data.user_id);
        if (user) {
          user.speaking = false;
          this.emit("voice-update", this.buildVoiceUserPayloads());
        }
      });
    } catch (err) {
      this.emit("error", `Failed to subscribe to voice events: ${String(err)}`);
    }

    this.emit("state-change", this.getRuntimeStatus());
    this.emit("voice-update", this.buildVoiceUserPayloads());
  }

  private upsertVoiceUser(data: VoiceStateData): void {
    const id = data.user?.id;
    if (!id) return;
    const existing = this.voiceUsers.get(id);
    this.voiceUsers.set(id, {
      userId: id,
      username: data.nick ?? data.user?.nick ?? data.user?.username ?? id,
      volume: data.volume ?? existing?.volume ?? 100,
      muted: data.mute ?? existing?.muted ?? false,
      selfMuted: data.self_mute ?? existing?.selfMuted ?? false,
      selfDeafened: data.self_deaf ?? existing?.selfDeafened ?? false,
      speaking: existing?.speaking ?? false,
    });
  }

  private buildVoiceUserPayloads(): DiscordVoiceUserPayload[] {
    return Array.from(this.voiceUsers.values()).map((u) => ({
      userId: u.userId,
      username: u.username,
      volume: u.volume,
      muted: u.muted,
      selfMuted: u.selfMuted,
      selfDeafened: u.selfDeafened,
      speaking: u.speaking,
    }));
  }
}

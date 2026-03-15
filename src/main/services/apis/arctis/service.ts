import * as fs from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import type { AppState, BackendCommand, PresetMap } from "../../../../shared/types";
import { mergeState } from "../../../../shared/settings.js";
import { BaseStationEventListener } from "./baseStationEvents";

const CHANNELS = ["master", "game", "chatRender", "media", "aux", "chatCapture"] as const;
type ChannelName = (typeof CHANNELS)[number];

type PresetCandidate = {
  id: string;
  name: string;
  channel?: string | number | null;
  favorite?: boolean;
};

function nowLabel(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export class ArctisApiService extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private sonarUrl = "";
  private state: AppState = mergeState();
  private presets: PresetMap = {};
  private lastError = "";
  private lastPresetRefresh = 0;
  private baseStationEvents: BaseStationEventListener | null = null;
  private running = false;
  private sonarEnabled = true;
  private hidEventsEnabled = true;
  private sonarPollIntervalMs = 2000;

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.emit("status", "Arctis background service started.");
    this.applyRuntimeConfig(true);
  }

  public stop(): void {
    if (!this.running && !this.timer && !this.baseStationEvents) {
      return;
    }
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.stopHidListener();
    this.emit("status", "Arctis background service stopped.");
  }

  public send(cmd: BackendCommand): void {
    void this.applyCommand(cmd);
  }

  public getState(): AppState {
    return this.state;
  }

  public getPresets(): PresetMap {
    return this.presets;
  }

  public async refreshNow(): Promise<void> {
    await this.refresh(true);
  }

  public configureRuntime(config: {
    sonarEnabled?: boolean;
    hidEventsEnabled?: boolean;
    sonarPollIntervalMs?: number;
  }): void {
    if (config.sonarEnabled != null) {
      this.sonarEnabled = Boolean(config.sonarEnabled);
    }
    if (config.hidEventsEnabled != null) {
      this.hidEventsEnabled = Boolean(config.hidEventsEnabled);
    }
    if (config.sonarPollIntervalMs != null) {
      this.sonarPollIntervalMs = this.normalizePollIntervalMs(config.sonarPollIntervalMs);
    }
    this.applyRuntimeConfig(false);
  }

  public getRuntimeStatus(): {
    running: boolean;
    sonarEnabled: boolean;
    hidEventsEnabled: boolean;
    sonarPollingActive: boolean;
    hidListenerActive: boolean;
    sonarUrl: string | null;
    lastError: string | null;
    sonarPollIntervalMs: number;
  } {
    return {
      running: this.running,
      sonarEnabled: this.sonarEnabled,
      hidEventsEnabled: this.hidEventsEnabled,
      sonarPollingActive: Boolean(this.timer),
      hidListenerActive: Boolean(this.baseStationEvents),
      sonarUrl: this.sonarUrl || null,
      lastError: this.lastError || null,
      sonarPollIntervalMs: this.sonarPollIntervalMs,
    };
  }

  private async applyCommand(cmd: BackendCommand): Promise<void> {
    try {
      if (!this.running || !this.sonarEnabled) {
        throw new Error("Sonar API service is disabled.");
      }
      await this.ensureDiscovered();
      if (!this.sonarUrl) {
        throw new Error("Sonar endpoint unavailable.");
      }
      const channel = String(cmd.payload.channel ?? "") as ChannelName;
      if (!CHANNELS.includes(channel)) {
        throw new Error(`Unsupported channel: ${channel}`);
      }
      if (cmd.name === "set_channel_volume") {
        const value = Math.max(0, Math.min(100, Number(cmd.payload.value) || 0));
        await this.setChannelVolume(channel, value / 100);
        this.emit("status", `${channel} volume ${value}%`);
      } else if (cmd.name === "set_channel_mute") {
        const muted = Boolean(cmd.payload.value);
        await this.setChannelMute(channel, muted);
        this.emit("status", `${channel} ${muted ? "muted" : "unmuted"}`);
      } else if (cmd.name === "set_preset") {
        const presetId = String(cmd.payload.preset_id || "").trim();
        if (!presetId) {
          throw new Error("Missing preset id.");
        }
        await this.selectPreset(channel, presetId);
        this.state = mergeState({
          ...this.state,
          channel_preset: {
            ...this.state.channel_preset,
            [channel]: presetId,
          },
          updated_at: nowLabel(),
        });
        this.emit("state", this.state);
        this.emit("status", `${channel} preset set`);
      }
      await this.refresh(true);
    } catch (err) {
      this.emit("error", this.errorText(err));
    }
  }

  private async refresh(forceEmit: boolean): Promise<void> {
    if (!this.running) {
      return;
    }
    if (!this.sonarEnabled) {
      if (forceEmit) {
        this.emit("state", this.state);
      }
      return;
    }
    try {
      await this.ensureDiscovered();
      if (!this.sonarUrl) {
        if (forceEmit) {
          this.emit("state", this.state);
        }
        return;
      }

      const volumePayload = await this.getVolumePayload();
      const routedPayload = await this.getRoutedApps();
      const chatMixPayload = await this.getJson(`${this.sonarUrl}/chatMix`).catch(() => ({}));
      const channelVolume = this.extractVolumes(volumePayload);
      const channelMute = this.extractMutes(volumePayload);

      const selectedPresets = await this.extractSelectedPresets();
      const resolvedSelectedPresets = this.resolveSelectedPresetState(selectedPresets, forceEmit);

      const next = mergeState({
        ...this.state,
        channel_volume: channelVolume,
        channel_mute: channelMute,
        channel_apps: this.extractRoutedApps(routedPayload),
        channel_preset: resolvedSelectedPresets,
        chat_mix_balance: this.extractChatMix(chatMixPayload),
        updated_at: nowLabel(),
      });

      if (forceEmit || JSON.stringify(next) !== JSON.stringify(this.state)) {
        this.state = next;
        this.emit("state", this.state);
      }

      const now = Date.now();
      if (forceEmit || now - this.lastPresetRefresh > 8000) {
        this.lastPresetRefresh = now;
        const nextPresets = await this.fetchPresetMap().catch(() => this.presets);
        if (JSON.stringify(nextPresets) !== JSON.stringify(this.presets)) {
          this.presets = nextPresets;
          this.emit("presets", this.presets);
        } else if (forceEmit) {
          this.emit("presets", this.presets);
        }
      }

      this.lastError = "";
    } catch (err) {
      const detail = this.errorText(err);
      if (detail !== this.lastError) {
        this.emit("error", detail);
        this.lastError = detail;
      }
      this.sonarUrl = "";
    }
  }

  private resolveSelectedPresetState(
    selectedPresets: Partial<Record<ChannelName, string | null>>,
    forceCompleteRefresh: boolean,
  ): Partial<Record<ChannelName, string | null>> {
    void forceCompleteRefresh;
    const resolved: Partial<Record<ChannelName, string | null>> = {
      ...this.state.channel_preset,
    };
    for (const channel of CHANNELS) {
      const raw = selectedPresets[channel];
      if (raw == null) {
        continue;
      }
      const value = String(raw).trim();
      if (value) {
        resolved[channel] = value;
      }
    }
    return resolved;
  }

  private async getVolumePayload(): Promise<any> {
    const modePayload = await this.getJsonCandidate([
      `${this.sonarUrl}/mode/`,
      `${this.sonarUrl}/mode`,
    ]).catch(() => null);
    const mode = typeof modePayload === "string" ? modePayload.toLowerCase() : null;
    if (mode === "classic") {
      return this.getJsonCandidate([
        `${this.sonarUrl}/volumeSettings/classic`,
        `${this.sonarUrl}/VolumeSettings/classic`,
        `${this.sonarUrl}/volumeSettings`,
        `${this.sonarUrl}/VolumeSettings`,
        `${this.sonarUrl}/volumeSettings/streamer`,
        `${this.sonarUrl}/VolumeSettings/streamer`,
      ]);
    }
    if (mode === "stream") {
      return this.getJsonCandidate([
        `${this.sonarUrl}/volumeSettings/streamer`,
        `${this.sonarUrl}/VolumeSettings/streamer`,
        `${this.sonarUrl}/volumeSettings`,
        `${this.sonarUrl}/VolumeSettings`,
        `${this.sonarUrl}/volumeSettings/classic`,
        `${this.sonarUrl}/VolumeSettings/classic`,
      ]);
    }
    return this.getJsonCandidate([
      `${this.sonarUrl}/volumeSettings`,
      `${this.sonarUrl}/VolumeSettings`,
      `${this.sonarUrl}/volumeSettings/classic`,
      `${this.sonarUrl}/VolumeSettings/classic`,
      `${this.sonarUrl}/volumeSettings/streamer`,
      `${this.sonarUrl}/VolumeSettings/streamer`,
    ]);
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.sonarUrl) {
      return;
    }
    const corePropsPath = path.join(process.env.PROGRAMDATA || "C:/ProgramData", "SteelSeries", "SteelSeries Engine 3", "coreProps.json");
    if (!fs.existsSync(corePropsPath)) {
      throw new Error(`SteelSeries coreProps.json not found: ${corePropsPath}`);
    }
    const core = JSON.parse(fs.readFileSync(corePropsPath, "utf-8")) as { ggEncryptedAddress?: string };
    const ggAddress = String(core.ggEncryptedAddress || "").trim();
    if (!ggAddress) {
      throw new Error("ggEncryptedAddress missing in coreProps.json");
    }
    const ggBaseUrl = `https://${ggAddress}`;
    const subApps = await this.getJson(`${ggBaseUrl}/subApps`);
    const sonar = subApps?.subApps?.sonar;
    if (!sonar?.metadata?.webServerAddress) {
      throw new Error("Sonar metadata not found in GG /subApps response");
    }
    this.sonarUrl = String(sonar.metadata.webServerAddress).replace(/\/$/, "");
    this.emit("status", `Connected to Sonar at ${this.sonarUrl}`);
  }

  private async setChannelVolume(channel: ChannelName, value: number): Promise<void> {
    const errors: string[] = [];
    for (const paths of [
      this.volumeSetPaths(channel, "volume", value, "classic"),
      this.volumeSetPaths(channel, "volume", value, "stream", "streaming"),
      this.volumeSetPaths(channel, "volume", value, "stream", "monitoring"),
    ]) {
      try {
        await this.putFirst(paths);
      } catch (err) {
        errors.push(this.errorText(err));
      }
    }
    if (errors.length >= 3) {
      throw new Error(errors[0]);
    }
  }

  private async setChannelMute(channel: ChannelName, muted: boolean): Promise<void> {
    const value = muted ? "true" : "false";
    const errors: string[] = [];
    for (const paths of [
      this.volumeSetPaths(channel, "muted", value, "classic"),
      this.volumeSetPaths(channel, "muted", value, "stream", "streaming"),
      this.volumeSetPaths(channel, "muted", value, "stream", "monitoring"),
    ]) {
      try {
        await this.putFirst(paths);
      } catch (err) {
        errors.push(this.errorText(err));
      }
    }
    if (errors.length >= 3) {
      throw new Error(errors[0]);
    }
  }

  private async selectPreset(channel: ChannelName, presetId: string): Promise<void> {
    void channel;
    const normalizedPresetId = presetId.trim();
    const directCandidates = [
      `/configs/${encodeURIComponent(normalizedPresetId)}/select`,
      `/Configs/${encodeURIComponent(normalizedPresetId)}/select`,
      `/presets/${encodeURIComponent(normalizedPresetId)}/select`,
      `/Presets/${encodeURIComponent(normalizedPresetId)}/select`,
    ];
    await this.putFirst(directCandidates);
  }

  private async extractSelectedPresets(): Promise<Partial<Record<ChannelName, string | null>>> {
    const selected: Partial<Record<ChannelName, string | null>> = {};

    const selectedPayload = await this.getJsonCandidate([
      `${this.sonarUrl}/selectedConfig`,
      `${this.sonarUrl}/selectedConfigs`,
      `${this.sonarUrl}/SelectedConfig`,
      `${this.sonarUrl}/SelectedConfigs`,
    ]).catch(() => null);

    if (selectedPayload && typeof selectedPayload === "object") {
      for (const channel of CHANNELS) {
        const item = this.pickSelectedPresetForChannel(selectedPayload, channel);
        if (item) {
          selected[channel] = item;
        }
      }
    }

    for (const channel of CHANNELS) {
      if (selected[channel]) {
        continue;
      }
      const channelName = this.toSonarPresetChannel(channel);
      const payload = await this.getJsonCandidate([
        `${this.sonarUrl}/presets/${channelName}/selected`,
        `${this.sonarUrl}/Presets/${channelName}/selected`,
      ]).catch(() => null);
      const id = this.extractPresetId(payload);
      if (id) {
        selected[channel] = id;
      }
    }

    return selected;
  }

  private async fetchPresetMap(): Promise<PresetMap> {
    const payload = await this.getJsonCandidate([
      `${this.sonarUrl}/configs`,
      `${this.sonarUrl}/Configs`,
      `${this.sonarUrl}/presets`,
      `${this.sonarUrl}/Presets`,
    ]);
    const fromConfigPayload = this.buildFavoritePresetMapFromConfigPayload(payload);
    if (fromConfigPayload) {
      return fromConfigPayload;
    }

    const channels: PresetMap = {};
    for (const channel of CHANNELS) {
      channels[channel] = [];
    }

    const flattened = this.flattenPresetCandidates(payload);
    for (const row of flattened) {
      if (!row.favorite) {
        continue;
      }
      const id = row.id.trim();
      const name = row.name.trim();
      if (!id || !name) {
        continue;
      }
      const mappedChannel = this.toUiChannel(row.channel);
      const targetChannels = mappedChannel ? [mappedChannel] : [...CHANNELS];
      for (const channel of targetChannels) {
        if (!channels[channel].some((existing) => existing[0] === id)) {
          channels[channel].push([id, name]);
        }
      }
    }

    for (const channel of CHANNELS) {
      channels[channel] = channels[channel]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .slice(0, 200);
    }

    return channels;
  }

  private buildFavoritePresetMapFromConfigPayload(payload: any): PresetMap | null {
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.configs)
        ? payload.configs
        : null;
    if (!rows || rows.length === 0) {
      return null;
    }
    const channels: PresetMap = {};
    for (const channel of CHANNELS) {
      channels[channel] = [];
    }
    let added = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const favorite = Boolean(row.isFavorite ?? row.favorite ?? row.starred ?? row.is_starred ?? row.is_favorite ?? row.isfavorite);
      if (!favorite) {
        continue;
      }
      const id = String(row.id ?? row.preset_id ?? row.presetId ?? row.uuid ?? "").trim();
      const name = String(row.name ?? row.displayName ?? row.label ?? "").trim();
      const mappedChannel = this.toUiChannel(row.virtualAudioDevice ?? row.channel ?? row.vad ?? row.role ?? row.audioRole ?? null);
      if (!id || !name || !mappedChannel) {
        continue;
      }
      if (!channels[mappedChannel].some((existing) => existing[0] === id)) {
        channels[mappedChannel].push([id, name]);
        added += 1;
      }
    }
    if (added === 0) {
      return null;
    }
    for (const channel of CHANNELS) {
      channels[channel] = channels[channel]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .slice(0, 200);
    }
    return channels;
  }

  private flattenPresetCandidates(payload: any): PresetCandidate[] {
    const out: PresetCandidate[] = [];

    const consumeCandidate = (item: any, forcedChannel?: string | number | null, forcedFavorite = false): void => {
      if (!item || typeof item !== "object") {
        return;
      }
      const id = String(item.preset_id ?? item.presetId ?? item.id ?? item.uuid ?? "").trim();
      const name = String(item.name ?? item.displayName ?? item.label ?? "").trim();
      const channel =
        forcedChannel ??
        item.virtualAudioDevice ??
        item.channel ??
        item.vad ??
        item.role ??
        item.audioRole ??
        item.device ??
        item.output ??
        null;
      const favorite = forcedFavorite || Boolean(item.favorite ?? item.isFavorite ?? item.starred ?? item.is_starred ?? item.is_favorite ?? item.isfavorite);
      if (id && name) {
        out.push({ id, name, channel, favorite });
      }
    };

    const walk = (node: any, forcedChannel?: string | number | null, forcedFavorite = false): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item, forcedChannel, forcedFavorite);
        }
        return;
      }
      if (!node || typeof node !== "object") {
        return;
      }

      consumeCandidate(node, forcedChannel, forcedFavorite);

      for (const key of ["presets", "items", "configs", "favorites", "favoritePresets", "list"]) {
        if (node[key] != null) {
          const keyLower = key.toLowerCase();
          const forceFav = forcedFavorite || keyLower.includes("favorite");
          walk(node[key], forcedChannel, forceFav);
        }
      }

      for (const [k, v] of Object.entries(node)) {
        const mapped = this.toUiChannel(k);
        if (mapped) {
          walk(v, this.toSonarPresetChannel(mapped), forcedFavorite);
          continue;
        }
        if (v && typeof v === "object") {
          const keyLower = String(k).toLowerCase();
          const forceFav = forcedFavorite || keyLower.includes("favorite");
          walk(v, forcedChannel, forceFav);
        }
      }
    };

    walk(payload, null, false);

    const seen = new Set<string>();
    return out.filter((item) => {
      const key = `${String(item.channel ?? "*")}|${item.id}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private pickSelectedPresetForChannel(payload: any, channel: ChannelName): string | null {
    const variants = [channel, this.toSonarPresetChannel(channel), channel.toLowerCase()];
    for (const key of variants) {
      const value = payload?.[key];
      const id = this.extractPresetId(value);
      if (id) {
        return id;
      }
    }
    return null;
  }

  private extractPresetId(value: any): string | null {
    if (!value) {
      return null;
    }
    if (typeof value === "string") {
      return value.trim() || null;
    }
    if (typeof value === "object") {
      const id = String(value.preset_id ?? value.presetId ?? value.id ?? value.uuid ?? "").trim();
      return id || null;
    }
    return null;
  }

  private toUiChannel(value: string | number | null | undefined): ChannelName | null {
    if (value == null) {
      return null;
    }
    if (typeof value === "number") {
      const map: Record<number, ChannelName> = {
        1: "game",
        2: "chatRender",
        3: "chatCapture",
        4: "media",
        5: "aux",
        6: "master",
      };
      return map[value] ?? null;
    }
    const normalized = String(value).trim().toLowerCase().replace(/[-_\s]/g, "");
    if (["master", "main"].includes(normalized)) return "master";
    if (["game", "gaming"].includes(normalized)) return "game";
    if (["chatrender", "chat"].includes(normalized)) return "chatRender";
    if (["chatcapture", "mic", "microphone", "capture"].includes(normalized)) return "chatCapture";
    if (["media", "music"].includes(normalized)) return "media";
    if (["aux", "auxiliary"].includes(normalized)) return "aux";
    return null;
  }

  private toSonarPresetChannel(channel: ChannelName): string {
    const map: Record<ChannelName, string> = {
      master: "master",
      game: "gaming",
      chatRender: "chat",
      media: "media",
      aux: "aux",
      chatCapture: "mic",
    };
    return map[channel];
  }

  private volumeSetPaths(
    channel: ChannelName,
    key: "volume" | "muted",
    value: number | string,
    mode: "classic" | "stream",
    slider: "streaming" | "monitoring" = "streaming",
  ): string[] {
    const section = channel === "master" ? "masters" : `devices/${channel}`;
    const out: string[] = [];
    out.push(`/volumeSettings/${section}/${mode}/${key}/${value}`);
    out.push(`/VolumeSettings/${section}/${mode}/${key}/${value}`);
    if (key === "volume") {
      if (mode === "classic") {
        out.push(`/volumeSettings/classic/${channel}/Volume/${value}`);
        out.push(`/VolumeSettings/classic/${channel}/Volume/${value}`);
      } else {
        out.push(`/volumeSettings/streamer/${slider}/${channel}/Volume/${value}`);
        out.push(`/VolumeSettings/streamer/${slider}/${channel}/Volume/${value}`);
      }
    } else {
      if (mode === "classic") {
        out.push(`/volumeSettings/classic/${channel}/Mute/${value}`);
        out.push(`/VolumeSettings/classic/${channel}/Mute/${value}`);
      } else {
        out.push(`/volumeSettings/streamer/${slider}/${channel}/isMuted/${value}`);
        out.push(`/VolumeSettings/streamer/${slider}/${channel}/isMuted/${value}`);
      }
    }
    return out;
  }

  private async putFirst(paths: string[]): Promise<void> {
    let lastError = "";
    for (const p of paths) {
      try {
        await this.requestJson("PUT", `${this.sonarUrl}${p}`);
        return;
      } catch (err) {
        lastError = this.errorText(err);
      }
    }
    throw new Error(lastError || "No supported Sonar endpoint for command.");
  }

  private extractVolumes(payload: any): Partial<Record<ChannelName, number>> {
    const out: Partial<Record<ChannelName, number>> = {};
    for (const channel of CHANNELS) {
      const value = this.pickChannelVolume(payload, channel);
      if (value != null) {
        out[channel] = Math.round(Math.max(0, Math.min(1, value)) * 100);
      }
    }
    return out;
  }

  private extractMutes(payload: any): Partial<Record<ChannelName, boolean>> {
    const out: Partial<Record<ChannelName, boolean>> = {};
    for (const channel of CHANNELS) {
      const value = this.pickChannelMute(payload, channel);
      if (value != null) {
        out[channel] = value;
      }
    }
    return out;
  }

  private pickChannelVolume(payload: any, channel: ChannelName): number | null {
    if (payload?.masters || payload?.devices) {
      const root = channel === "master" ? payload?.masters : payload?.devices?.[channel];
      const streamCandidate = root?.stream?.streaming ?? root?.stream?.monitoring ?? root?.stream;
      const streamEntry = this.hasAnyKey(streamCandidate, ["volume", "Volume"]) ? streamCandidate : null;
      const classicEntry = root?.classic;
      const entry = streamEntry ?? classicEntry ?? root;
      const raw = this.getNumber(entry?.volume ?? entry?.Volume ?? root?.volume ?? root?.Volume);
      if (raw != null) {
        return raw > 1 ? raw / 100 : raw;
      }
    }
    const direct = payload?.[channel];
    const raw = this.getNumber(direct?.volume ?? direct?.Volume);
    if (raw != null) {
      return raw > 1 ? raw / 100 : raw;
    }
    return null;
  }

  private pickChannelMute(payload: any, channel: ChannelName): boolean | null {
    const root = channel === "master" ? payload?.masters : payload?.devices?.[channel];
    const streamCandidate = root?.stream?.streaming ?? root?.stream?.monitoring ?? root?.stream;
    const streamEntry = this.hasAnyKey(streamCandidate, ["muted", "isMuted", "Mute"]) ? streamCandidate : null;
    const classicEntry = root?.classic;
    const fromMode = streamEntry ?? classicEntry ?? root;
    const value = this.getBool(fromMode?.muted ?? fromMode?.isMuted ?? fromMode?.Mute ?? root?.muted ?? root?.isMuted ?? root?.Mute);
    if (value != null) {
      return value;
    }
    const direct = payload?.[channel];
    return this.getBool(direct?.muted ?? direct?.isMuted ?? direct?.Mute);
  }

  private hasAnyKey(value: any, keys: string[]): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }
    return keys.some((key) => key in value);
  }

  private extractRoutedApps(payload: any): Partial<Record<ChannelName, string[]>> {
    const out: Partial<Record<ChannelName, string[]>> = {};
    const aliases: Record<ChannelName, string[]> = {
      master: ["master", "main"],
      game: ["game", "gaming"],
      chatRender: ["chatrender", "chat", "render"],
      media: ["media", "music"],
      aux: ["aux", "auxiliary"],
      chatCapture: ["chatcapture", "mic", "microphone", "capture"],
    };

    for (const channel of CHANNELS) {
      out[channel] = [];
    }

    const add = (channel: ChannelName, name: string): void => {
      if (!name.trim()) {
        return;
      }
      if (!out[channel]!.includes(name.trim())) {
        out[channel]!.push(name.trim());
      }
    };

    const inferChannel = (value: any): ChannelName | null => {
      const text = String(value ?? "").toLowerCase().replace(/[-_\s]/g, "");
      for (const channel of CHANNELS) {
        if (aliases[channel].some((token) => text.includes(token))) {
          return channel;
        }
      }
      return null;
    };

    const isAudibleSession = (item: any): boolean => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const state = item.state;
      if (typeof state === "string" && !["active", "running"].includes(state.trim().toLowerCase())) {
        return false;
      }
      if (item.isSystemSound === true) {
        return false;
      }
      const processId = item.processId ?? item.pid;
      if (typeof processId === "number" && processId <= 0) {
        return false;
      }
      const muted = item.muted ?? item.isMuted ?? item.Mute;
      if (muted === true || muted === 1 || String(muted).toLowerCase() === "true") {
        return false;
      }
      const levelKeys = ["peak", "peakValue", "level", "rms", "volume", "volumeCurrent", "meter", "amplitude"];
      for (const key of levelKeys) {
        const value = item[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          return value > 0;
        }
      }
      return true;
    };

    const appNameFrom = (item: any): string | null => {
      if (!item || typeof item !== "object") {
        return null;
      }
      for (const key of ["name", "appName", "processName", "displayName", "title", "application", "exe", "executable"]) {
        const value = item[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      return null;
    };

    const walk = (node: any, forced?: ChannelName | null): void => {
      if (Array.isArray(node)) {
        for (const item of node) {
          walk(item, forced ?? null);
        }
        return;
      }
      if (!node || typeof node !== "object") {
        return;
      }

      const inferred = forced ?? inferChannel(node.role ?? node.channel ?? node.deviceRole ?? node.output ?? node.route ?? node.routedTo ?? node.destination);
      const appName = appNameFrom(node);
      if (inferred && appName && isAudibleSession(node)) {
        add(inferred, appName);
      }

      const audioSessions = node.audioSessions;
      if (inferred && Array.isArray(audioSessions)) {
        for (const session of audioSessions) {
          if (!isAudibleSession(session)) {
            continue;
          }
          const sessionName = appNameFrom(session);
          if (sessionName) {
            add(inferred, sessionName);
          }
        }
      }

      for (const [key, value] of Object.entries(node)) {
        const byKey = inferChannel(key);
        if (Array.isArray(value) || (value && typeof value === "object")) {
          walk(value, byKey ?? inferred ?? null);
        }
      }
    };

    walk(payload, null);
    return out;
  }

  private extractChatMix(payload: any): number | null {
    const raw = this.getNumber(payload?.balance ?? payload?.chatMix ?? payload?.value);
    if (raw == null) {
      return null;
    }
    const normalized = Math.max(-1, Math.min(1, raw));
    return Math.round((normalized + 1) * 50);
  }

  private applyHeadsetEventPatch(patch: Partial<AppState>): void {
    if (!this.running || !this.hidEventsEnabled) {
      return;
    }
    if (!patch || Object.keys(patch).length === 0) {
      return;
    }
    const next = mergeState({
      ...this.state,
      ...patch,
      updated_at: nowLabel(),
    });
    if (JSON.stringify(next) !== JSON.stringify(this.state)) {
      this.state = next;
      this.emit("state", this.state);
    }
  }

  private async getRoutedApps(): Promise<any> {
    const candidates = [
      "/AudioDeviceRouting",
      "/audioDeviceRouting",
      "/Applications",
      "/applications",
      "/routing",
      "/appRouting",
      "/audioRouting",
      "/sessions",
      "/audioSessions",
    ];
    for (const pathName of candidates) {
      try {
        return await this.getJson(`${this.sonarUrl}${pathName}`);
      } catch {
        // continue
      }
    }
    return {};
  }

  private async getJsonCandidate(urls: string[]): Promise<any> {
    let lastError = "";
    for (const url of urls) {
      try {
        return await this.getJson(url);
      } catch (err) {
        lastError = this.errorText(err);
      }
    }
    throw new Error(lastError || "No successful endpoint response.");
  }

  private async getJson(url: string): Promise<any> {
    return this.requestJson("GET", url);
  }

  private async requestJson(method: "GET" | "PUT", url: string): Promise<any> {
    const target = new URL(url);
    const isHttps = target.protocol === "https:";
    const options: https.RequestOptions = {
      method,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      timeout: 5000,
      headers: {
        "Content-Type": "application/json",
      },
    };
    if (isHttps) {
      options.rejectUnauthorized = false;
    }
    return new Promise((resolve, reject) => {
      const client = isHttps ? https : http;
      const req = client.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`${method} ${url} failed (${res.statusCode}) ${raw}`));
            return;
          }
          if (!raw.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve({});
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error(`timeout: ${method} ${url}`)));
      req.end();
    });
  }

  private getNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return null;
  }

  private getBool(value: unknown): boolean | null {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
    }
    return null;
  }

  private errorText(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  private applyRuntimeConfig(forceRefresh: boolean): void {
    if (!this.running) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.stopHidListener();
      return;
    }

    if (this.hidEventsEnabled) {
      this.startHidListener();
    } else {
      this.stopHidListener();
      this.emit("hid-status", "HID event listener disabled in settings.");
    }

    if (!this.sonarEnabled) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.emit("status", "Sonar polling disabled in settings.");
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit("status", `Sonar polling active (${Math.round(this.sonarPollIntervalMs / 100) / 10}s).`);
    this.timer = setInterval(() => {
      void this.refresh(false);
    }, this.sonarPollIntervalMs);
    if (forceRefresh) {
      void this.refresh(true);
    }
  }

  private startHidListener(): void {
    if (this.baseStationEvents) {
      return;
    }
    this.baseStationEvents = new BaseStationEventListener(
      (patch) => this.applyHeadsetEventPatch(patch),
      (detail) => this.emit("hid-status", detail),
    );
    this.baseStationEvents.start();
    this.emit("hid-status", "HID event listener active.");
  }

  private stopHidListener(): void {
    if (!this.baseStationEvents) {
      return;
    }
    this.baseStationEvents.stop();
    this.baseStationEvents = null;
    this.emit("hid-status", "HID event listener stopped.");
  }

  private normalizePollIntervalMs(value: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return 2000;
    }
    const ms = numeric <= 120 ? numeric * 1000 : numeric;
    return Math.max(500, Math.min(60_000, Math.round(ms)));
  }
}

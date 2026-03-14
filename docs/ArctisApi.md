# Arctis API Reference (Current App)

_Last verified: `2026-03-14`_

This document describes the interfaces used by this application, based on the current repository implementation. It is written so another agent can re-implement compatible API behavior.

## 1) Scope

The app uses three integration layers:

- `SteelSeries GG` metadata discovery (local web endpoint)
- `Sonar` REST endpoints (discovered through GG)
- `node-hid` polling (local headset/base event stream)

No official public Arctis SDK is used for these paths; behavior is derived from runtime payload discovery and observed compatibility variants.

## 2) Core discovery flow

1. Read `coreProps.json`:
   - `%PROGRAMDATA%\SteelSeries\SteelSeries Engine 3\coreProps.json`
2. Extract `ggEncryptedAddress`.
3. Build `ggBaseUrl = https://{ggEncryptedAddress}`.
4. Request:

```http
GET {ggBaseUrl}/subApps
```

5. Read `subApps.sonar.metadata.webServerAddress`, trim trailing `/`, and set it as `sonarUrl`.

The app keeps `sonarUrl` in memory for the process lifetime.

### 2.1 Live discovery sample (current environment, 2026-03-14)

- GG base URL: `https://127.0.0.1:6327`
- `GET /subApps` working endpoint: `https://127.0.0.1:6327/subApps`
- Sonar URL resolved from payload: `http://127.0.0.1:52329`
- `GET ggBaseUrl + "/"` returns non-JSON in this environment (`Unexpected non-whitespace character after JSON`), so the parser falls back to `/subApps` and ignores root body parsing errors.
- `arctis-endpoint-discovery.json` was generated from this run and contains the full raw probe output used for replication.

`/subApps` includes:

- `engine` (no `metadata.webServerAddress`, encrypted address available)
- `moments` (no `metadata.webServerAddress`, encrypted address available)
- `sonar` (`metadata.webServerAddress = http://127.0.0.1:52329`)
- `threeDAT` (`metadata.offlineFrontendAddress` points to local file path)

### 2.2 Discovered sub-app structure (this run)

- `engine`
  - `encryptedWebServerAddress`: `127.0.0.1:52197`
  - `isEnabled`: `true`, `isReady`: `true`, `isRunning`: `true`
- `moments`
  - `encryptedWebServerAddress`: `127.0.0.1:52198`
  - `isEnabled`: `true`, `isReady`: `true`, `isRunning`: `true`
- `sonar`
  - `metadata.webServerAddress`: `http://127.0.0.1:52329`
  - `isEnabled`: `true`, `isReady`: `true`, `isRunning`: `true`
- `threeDAT`
  - `metadata.offlineFrontendAddress`: `file://C:\Program Files\SteelSeries\GG\apps\threeDAT\frontend\offline\index.html`
  - `isEnabled`: `true`, `isReady`: `false`, `isRunning`: `false`

## 3) Transport behavior

- Protocol: HTTP(S)
- Methods used by implementation: `GET`, `PUT`
- Request timeout: `5000ms`
- Header: `Content-Type: application/json`
- HTTPS behavior: `rejectUnauthorized = false`
- Parsing:
  - Non-empty responses are parsed as JSON
  - Empty responses become `{}`
  - Invalid JSON responses become `{}`
- Error handling:
  - non-`2xx` is treated as error
  - discovery output is preferred over broad probing during runtime; fallback candidates are secondary

## 4) Polling lifecycle

- `ArctisApiService.start()` creates HID listener and starts polling.
- Poll loop interval: `700ms`
- Preset catalog refresh throttle: at most once every `8000ms`
- On each poll, API data is merged with HID snapshot and emitted as state.

## 5) GG / Engine endpoints in use

### 5.1 Mandatory

| Purpose | Method | Path |
|---|---|---|
| Discover Sonar address | `GET` | `/subApps` |

### 5.2 Note

These are the only GG-level endpoints currently consumed by the app.

## 6) Sonar endpoints in use

The following matrix was produced by `inspect:arctis-api --check-write --json --dump` on `2026-03-14T14:32:55.985Z`.
The app should use the **working** entries first and treat the fails as compatibility observations only.

### 6.1 Read endpoints

| Purpose | Method | Working URL(s) | Fails in this run |
|---|---|---|---|
| mode | `GET` | `/mode/`, `/mode` | none |
| chat mix | `GET` | `/chatMix` | none |
| selected preset aggregate | `GET` | none | `/selectedConfig`, `/selectedConfigs`, `/SelectedConfig`, `/SelectedConfigs` (all 404) |
| preset catalog | `GET` | `/configs`, `/Configs` | `/presets`, `/Presets` (404) |
| routed app sessions | `GET` | `/AudioDeviceRouting`, `/audioDeviceRouting` | `/Applications`, `/applications`, `/routing`, `/appRouting`, `/audioRouting`, `/sessions`, `/audioSessions` (all 404) |
| volume payload (classic mode) | `GET` | `/volumeSettings/classic`, `/VolumeSettings/classic`, `/volumeSettings/streamer`, `/VolumeSettings/streamer` | `/volumeSettings`, `/VolumeSettings` (404) |
| volume payload (stream mode) | `GET` | `/volumeSettings/streamer`, `/VolumeSettings/streamer`, `/volumeSettings/classic`, `/VolumeSettings/classic` | `/volumeSettings`, `/VolumeSettings` (404) |
| volume payload fallback | `GET` | `/volumeSettings/classic`, `/VolumeSettings/classic`, `/volumeSettings/streamer`, `/VolumeSettings/streamer` | `/volumeSettings`, `/VolumeSettings` (404) |
| selected preset fallback: master | `GET` | none | `/presets/master/selected`, `/Presets/master/selected` (404) |
| selected preset fallback: game | `GET` | none | `/presets/gaming/selected`, `/Presets/gaming/selected` (404) |
| selected preset fallback: chatRender | `GET` | none | `/presets/chat/selected`, `/Presets/chat/selected` (404) |
| selected preset fallback: media | `GET` | none | `/presets/media/selected`, `/Presets/media/selected` (404) |
| selected preset fallback: aux | `GET` | none | `/presets/aux/selected`, `/Presets/aux/selected` (404) |
| selected preset fallback: chatCapture | `GET` | none | `/presets/mic/selected`, `/Presets/mic/selected` (404) |

The mode value is normalized to `classic` or `stream` (case-insensitive).

### 6.2 Write endpoints

The probe uses non-mutating `GET` requests only to discover reachable write routes; runtime calls are `PUT` with no JSON body.

Payload values are normalized as follows:

- `channel`: `master | game | chatRender | media | aux | chatCapture`
- `slider`: `streaming | monitoring`
- `mode`: `classic | stream`
- `value`: `0..1` for `volume`, `"true"` / `"false"` for mute

| Purpose | Method | Working URL(s) | Fails in this run |
|---|---|---|---|
| set volume (classic channel) | `PUT` | `/volumeSettings/classic/{channel}/Volume/{volume}`, `/VolumeSettings/classic/{channel}/Volume/{volume}` | `/volumeSettings/masters/classic/volume/{volume}`, `/VolumeSettings/masters/classic/volume/{volume}` (404) |
| set volume (streaming/monitoring channel) | `PUT` | `/volumeSettings/streamer/{slider}/{channel}/Volume/{volume}`, `/VolumeSettings/streamer/{slider}/{channel}/Volume/{volume}` | `/volumeSettings/devices/{channel}/stream/{mode}/{volume}`, `/VolumeSettings/devices/{channel}/stream/{mode}/{volume}` (404) |
| set mute (classic channel) | `PUT` | `/volumeSettings/classic/{channel}/Mute/{muted}`, `/VolumeSettings/classic/{channel}/Mute/{muted}` | `/volumeSettings/masters/classic/muted/{muted}`, `/VolumeSettings/masters/classic/muted/{muted}` (404) |
| set mute (streaming/monitoring channel) | `PUT` | `/volumeSettings/streamer/{slider}/{channel}/isMuted/{muted}`, `/VolumeSettings/streamer/{slider}/{channel}/isMuted/{muted}` | `/volumeSettings/devices/{channel}/stream/{mode}/{muted}`, `/VolumeSettings/devices/{channel}/stream/{mode}/{muted}` (404) |
| select preset | `PUT` | `/configs/{presetId}/select`, `/Configs/{presetId}/select` | `/presets/{presetId}/select`, `/Presets/{presetId}/select` (404) |

If all write paths fail, command is rejected as unsupported.

### 6.3 Local launch for GG UI

Not an API endpoint, but still part of Arctis/GG integration:

- Try executable launch:
  - `C:\Program Files\SteelSeries\GG\SteelSeriesGGClient.exe`
  - `C:\Program Files\SteelSeries\GG\SteelSeriesGG.exe`
  - `C:\Program Files (x86)\SteelSeries\GG\SteelSeriesGG.exe`
- fallback: `steelseriesgg://`

## 7) Sonar payload interpretation used by UI/state

### Channels

`CHANNELS = ["master", "game", "chatRender", "media", "aux", "chatCapture"]`

### Selected preset extraction

The code resolves selected preset values from:

1. full payload keys matching direct channel names
2. fallback channel aliases:
   - `master` (or `main`)
   - `game` (or `gaming`)
   - `chatRender` (`chat`)
   - `chatCapture` (`chat`, `mic`, `microphone`, `capture`)
   - `media` (or `music`)
   - `aux` (or `auxiliary`)

Numeric channel identifiers can also be mapped:

- `1 -> game`
- `2 -> chatRender`
- `3 -> chatCapture`
- `4 -> media`
- `5 -> aux`
- `6 -> master`

### Preset catalog normalization

Preset catalog response is flattened and filtered with heuristics:

- Accept candidates that include `favorite`/`isFavorite`/`starred`.
- Accept common id fields: `preset_id`, `presetId`, `id`, `uuid`.
- Accept common name fields: `name`, `displayName`, `label`.
- Map channel alias back into UI channel using known keys (`virtualAudioDevice`, `channel`, `vad`, `role`, etc).
- Keep only favorite entries and sort by name for each channel.

### Volume/mute parsing from payloads

- Supports 0..1 and 0..100 range values.
- Channel data may be nested under `masters`/`devices/{channel}`.
- Stream payloads may be under `.stream.streaming` / `.stream.monitoring`.
- Keys tested: `volume` / `Volume` for volume; `muted`, `isMuted`, `Mute` for mute.

### Routed app extraction

Routed app data is extracted from any payload shape that includes:

- channel-like route keys (`master`, `game`, `chat`, etc.)
- per-node `audioSessions`
- entries with audible signal fields (`peak`, `rms`, `level`, ...)

Audible filtering removes muted/system entries and non-positive levels.

## 8) HID layer (base station / headset events)

### Device selection

- vendor id: `0x1038`
- supported product ids: `0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D`
- interface number: `4`
- path-based detection, sorted and deduplicated

### Polling behavior

- Poll frequency: `120ms` (`readTimeout` polling loop)
- USB device rescan: every `1500ms`
- If no candidates exist, `base_station_connected = false`

### HID packet format

- Packets shorter than 5 bytes are ignored.
- Valid `reportId`: `0x06` and `0x07`
- `command = data[1]`

| Command | Data usage | Meaning |
|---|---|---|
| `0x25` | `rawVolume = 0x38 - data[2]` | `headset_volume_percent = round(clamp(rawVolume / 0x38 * 100, 0..100))` |
| `0xB5` | `data[4] == 8` => wireless, `data[3] == 1` => bluetooth | `connected`, `wireless`, `bluetooth`; if wireless, set `anc_mode = off` |
| `0xB7` | `data[2]`, `data[3]` | `headset_battery_percent = round(clamp(data[2]/8*100,0..100))`; `base_battery_percent = round(clamp(data[3]/8*100,0..100))` |
| `0x85` | `data[2]` 1..10 | `oled_brightness` |
| `0x39` | `data[2]` | `sidetone_level` |
| `0xBD` | `data[2]` (0/1/2) | `anc_mode = off | transparency | anc` |
| `0xBB` | `data[2] == 1` | `mic_mute = true/false` |

### Snapshot shape pushed into app state

- `headset_battery_percent`
- `base_battery_percent`
- `base_station_connected`
- `headset_volume_percent`
- `anc_mode`
- `mic_mute`
- `sidetone_level`
- `connected`
- `wireless`
- `bluetooth`
- `oled_brightness`

The HID snapshot is merged into the Sonar state each refresh and emitted to UI.

## 9) Derived state fields outside Arctis transport

The app also exposes:

- `channel_apps` (derived from routed app payloads)
- `channel_preset` (normalized from selected preset payloads)
- `chat_mix_balance` (normalized `(raw + 1) * 50`, clamped 0..100)
- `updated_at` label from local `HH:mm:ss`

## 10) How to replicate with your own client

1. Resolve Sonar URL with `coreProps.json -> /subApps`.
2. Poll Sonar + HID at ~700ms and merge state.
3. Keep the probe-produced winning endpoint matrix as primary transport policy for this environment.
4. Maintain legacy candidate lists only as optional compatibility for other deployments.
5. Use raw HID parsing above for fast headset/base events.
6. For commands, emit `set_channel_volume`, `set_channel_mute`, `set_preset` and use `configs/Configs` + channel-style write URLs from section 6.2.
7. Normalize outputs before UI:
   - clamp percentages
   - convert boolean values from string/number/object forms

### Backend command payloads (frontend -> main process)

- `set_channel_volume`

```ts
{ name: "set_channel_volume", payload: { channel: "game", value: 60 } }
```

- `set_channel_mute`

```ts
{ name: "set_channel_mute", payload: { channel: "game", value: true } }
```

- `set_preset`

```ts
{ name: "set_preset", payload: { channel: "game", preset_id: "preset-uuid" } }
```

Channel in payload must be one of `master | game | chatRender | media | aux | chatCapture`.

## 11) Notes

- Endpoint casing and path shape differ between installs; the fallback matrix is intentional.
- HTTPS certificate verification is disabled in the current implementation.
- Most writes are `PUT` with no JSON body in these endpoints.
- This is an observed interface, not a published/guaranteed API contract.

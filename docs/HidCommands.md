# Arctis Nova Pro Wireless — HID Command Reference

_Last verified: `2026-05-01` — derived from `baseStationEvents.ts` and `oled/service.ts`_

This document catalogues every HID packet format discovered for the Arctis Nova Pro Wireless base station (USB receiver). It is written so another agent or developer can re-implement compatible HID communication without reading the source files.

---

## 1. Device Identification

| Field | Value |
|---|---|
| Vendor ID | `0x1038` (SteelSeries) |
| Interface number | `4` |
| Supported Product IDs | `0x12CB`, `0x12CD`, `0x12E0`, `0x12E5`, `0x225D` |

The app opens **up to two HID handles** per session (paths sorted lexicographically, reversed). Duplicate paths are deduplicated. All reads and writes target interface 4.

---

## 2. General Packet Rules

- **Incoming (device → host):** read via `device.readTimeout(1 ms)` in a polling loop every **120 ms**.
- **Outgoing writes:** sent via `device.write(payload)` — 64-byte arrays.
- **Outgoing feature reports:** sent via `device.sendFeatureReport(payload)` — 1024-byte arrays.
- Packets shorter than **5 bytes** are discarded.
- Valid incoming `reportId` values: **`0x06`** and **`0x07`**.
- `command = data[1]` — all other bytes are payload for that command.

---

## 3. Incoming Events (Device → Host)

### 3.1 Volume — `0x25`

Fires when the user adjusts the hardware volume wheel on the headset.

```
[reportId, 0x25, rawVolume, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID (`0x06` or `0x07`) |
| 1 | Command `0x25` |
| 2 | Raw volume (inverted: `0x38 − data[2]` = actual level) |

**Decoding:**
```
rawLevel  = max(0, 0x38 − data[2])          // 0x38 = 56
percent   = round(clamp(rawLevel / 56 × 100, 0, 100))
```

**State field:** `headset_volume_percent` (0–100)

---

### 3.2 Connectivity Mode — `0xB5`

Fires on connection-state changes (wireless link established/lost, Bluetooth).

```
[reportId, 0xB5, _, btFlag, wirelessFlag, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID |
| 1 | Command `0xB5` |
| 2 | Unused |
| 3 | Bluetooth flag: `1` = Bluetooth active |
| 4 | Wireless flag: `8` = wireless (2.4 GHz) active |

**Decoding:**
```
wireless  = (data[4] === 8)
bluetooth = (data[3] === 1)
connected = wireless
if wireless → force anc_mode = "off"
```

**State fields:** `connected`, `wireless`, `bluetooth`, `anc_mode` (forced `"off"` when wireless)

> The wireless flag value `8` is the only observed valid value. Any other value is treated as "not connected via wireless".

---

### 3.3 Battery Levels — `0xB7`

Fires on battery-level updates for both the headset and the charging dock.

```
[reportId, 0xB7, headsetLevel, dockLevel, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID |
| 1 | Command `0xB7` |
| 2 | Headset battery level (0–8 raw) |
| 3 | Dock/base battery level (0–8 raw) |

**Decoding:**
```
BATTERY_MAX = 8
headset_battery_percent = round(clamp(data[2] / 8 × 100, 0, 100))
base_battery_percent    = round(clamp(data[3] / 8 × 100, 0, 100))
```

**State fields:** `headset_battery_percent`, `base_battery_percent` (both 0–100)

---

### 3.4 OLED Brightness — `0x85`

Fires when the user changes OLED display brightness via the headset controls.

```
[reportId, 0x85, brightnessLevel, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID |
| 1 | Command `0x85` |
| 2 | Brightness level (1–10) |

**Decoding:**
```
if data[2] >= 1 && data[2] <= 10 → oled_brightness = data[2]
else → discard event
```

**State field:** `oled_brightness` (1–10)

---

### 3.5 Sidetone Level — `0x39`

Fires when the sidetone (microphone self-monitoring) level is changed.

```
[reportId, 0x39, level, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID |
| 1 | Command `0x39` |
| 2 | Sidetone level (raw numeric value) |

**Decoding:**
```
sidetone_level = data[2]
```

**State field:** `sidetone_level`

---

### 3.6 ANC Mode — `0xBD`

Fires when the user cycles through ANC / Transparency / Off modes on the headset.

```
[reportId, 0xBD, mode, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID |
| 1 | Command `0xBD` |
| 2 | Mode value: `0` = off, `1` = transparency, `2` = ANC |

**Decoding:**
```
0 → anc_mode = "off"
1 → anc_mode = "transparency"
2 → anc_mode = "anc"
other → discard event
```

**State field:** `anc_mode` (`"off"` | `"transparency"` | `"anc"`)

> **Note:** When command `0xB5` reports wireless mode, `anc_mode` is overridden to `"off"` regardless of this event.

---

### 3.7 Microphone Mute — `0xBB`

Fires when the user presses the microphone mute button on the headset.

```
[reportId, 0xBB, muteState, ...]
```

| Byte | Meaning |
|---|---|
| 0 | Report ID |
| 1 | Command `0xBB` |
| 2 | Mute state: `1` = muted, `0` = unmuted |

**Decoding:**
```
mic_mute = (data[2] === 1)
```

**State field:** `mic_mute` (boolean)

---

## 4. Outgoing Commands (Host → Device)

### 4.1 Return to SteelSeries UI — `0x95`

Restores OLED control to the SteelSeries GG / Sonar application. Called after a custom OLED notification expires or when the OLED service stops.

**Transport:** `device.write(payload)`

**Payload (64 bytes):**

```
[0x06, 0x95, 0x00, 0x00, ..., 0x00]
 └─ reportId  └─ command  └─ 62 bytes of 0x00 padding
```

| Byte | Value | Meaning |
|---|---|---|
| 0 | `0x06` | Report ID |
| 1 | `0x95` | Command: return control |
| 2–63 | `0x00` | Padding |

Total size: **64 bytes**.

---

### 4.2 OLED Screen Draw — `0x93`

Draws a bitmap frame on the 128×64 OLED display. The screen is split into two 64-pixel-wide vertical halves, each sent as a separate feature report.

**Transport:** `device.sendFeatureReport(report)` — called twice per frame (left half, right half).

**Report structure (1024 bytes per report):**

```
[0x06, 0x93, splitX, 0x00, chunkW, paddedH, <bitmap data ...>]
```

| Byte | Value | Meaning |
|---|---|---|
| 0 | `0x06` | Report ID |
| 1 | `0x93` | Command: draw |
| 2 | `0` or `64` | X offset of this chunk (`splitX`) |
| 3 | `0x00` | Y offset (always 0) |
| 4 | `64` | Chunk width in pixels |
| 5 | `64` | Padded height (height rounded up to next multiple of 8 — for 64 px screen: `64`) |
| 6–1023 | packed bits | 1-bit-per-pixel bitmap data |

**Bitmap packing algorithm:**

```
For each pixel (x, y) in the chunk where bitmap[y × screenWidth + splitX + x] !== 0:
  idx = x × paddedHeight + y
  report[(idx >> 3) + 6] |= 1 << (idx & 7)
```

Pixels are packed column-major (x is the outer loop, y is the inner loop), LSB first within each byte.

**Screen specification:**

| Constant | Value |
|---|---|
| `SCREEN_WIDTH` | 128 px |
| `SCREEN_HEIGHT` | 64 px |
| `SCREEN_REPORT_SPLIT_WIDTH` | 64 px |
| `SCREEN_REPORT_SIZE` | 1024 bytes |
| Reports per frame | 2 (left chunk at `splitX=0`, right chunk at `splitX=64`) |

**Animation:** After the first frame, the OLED service sends two more identical frames at +180 ms and +360 ms to compensate for any dropped writes.

---

## 5. State Fields Summary

| Field | Source command | Type |
|---|---|---|
| `headset_battery_percent` | `0xB7` | `number \| null` (0–100) |
| `base_battery_percent` | `0xB7` | `number \| null` (0–100) |
| `base_station_connected` | device presence | `boolean \| null` |
| `headset_volume_percent` | `0x25` | `number \| null` (0–100) |
| `anc_mode` | `0xBD`, `0xB5` | `"off" \| "transparency" \| "anc" \| null` |
| `mic_mute` | `0xBB` | `boolean \| null` |
| `sidetone_level` | `0x39` | `number \| null` |
| `connected` | `0xB5` | `boolean \| null` |
| `wireless` | `0xB5` | `boolean \| null` |
| `bluetooth` | `0xB5` | `boolean \| null` |
| `oled_brightness` | `0x85` | `number \| null` (1–10) |

---

## 6. Polling and Discovery

| Parameter | Value |
|---|---|
| Poll interval | 120 ms |
| Read timeout per call | 1 ms |
| Device rescan interval | 1500 ms |
| Max open devices | 2 |

Device paths are sorted lexicographically, then reversed before opening — the result is that the numerically higher path is opened first. This is the order the base station's two endpoints are enumerated on Windows.

When no candidate devices are found, `base_station_connected` is set to `false` and the snapshot is not updated further.

---

## 7. Implementation Notes

- The app does **not** send commands to control volume, ANC, sidetone, or mute via HID — those are read-only observations from the hardware. Write control of those features goes through the Sonar REST API (see `docs/ArctisApi.md`).
- The only outgoing HID commands are OLED-related: draw (`0x93`) and return control (`0x95`).
- OLED writes use `{ nonExclusive: true }` when opening the HID handle so they do not block the event-listening handles.
- This is an observed protocol, not a published/guaranteed API contract from SteelSeries.

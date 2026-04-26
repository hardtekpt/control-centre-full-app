# Arctis Nova Pro Wireless — HID Protocol Mapping Plan

Complete step-by-step guide to reverse-engineer every HID read and write command
for the SteelSeries Arctis Nova Pro Wireless, covering push events from the headset,
base station commands, and traffic from SteelSeries GG Engine.

---

## Sources Used

| Source | Coverage |
|--------|---------|
| Current project `baseStationEvents.ts` | Push event decoding (7 known events) |
| `cheahkhing/arctis-headset-hid` (Nova 7X) | Read/write command reference for similar hardware |
| `Sapd/HeadsetControl` `nova_pro_wireless.hpp` | **Authoritative Nova Pro Wireless write commands** |

---

## What Is Already Known

### Push Events (read from headset — already in `baseStationEvents.ts`)

All events arrive on **Interface 4**, with report ID `0x06` or `0x07` at byte `[0]`.

| Command byte `[1]` | Field | Data |
|-------------------|-------|------|
| `0x25` | `headset_volume_percent` | `byte[2]` = raw level `(0–0x38)`, inverted: `percent = (0x38 - val) / 0x38 * 100` |
| `0xB5` | `connected`, `wireless`, `bluetooth` | `byte[3]=1` → BT active; `byte[4]=8` → 2.4GHz active |
| `0xB7` | `headset_battery_percent`, `base_battery_percent` | `byte[2]` = headset level `(0–8)`, `byte[3]` = base level `(0–8)` |
| `0x85` | `oled_brightness` | `byte[2]` = OLED brightness `(1–10)` |
| `0x39` | `sidetone_level` | `byte[2]` = level `(0–3)` |
| `0xBD` | `anc_mode` | `byte[2]`: `0`=off, `1`=transparency, `2`=ANC |
| `0xBB` | `mic_mute` | `byte[2]`: `0`=unmuted, `1`=muted |

### Write Commands (confirmed by HeadsetControl — `nova_pro_wireless.hpp`)

> **Critical:** All write commands use **`0x06` as byte `[0]`** (HID report ID).  
> Native packet size: **31 bytes**. Padding to 64 bytes with zeros is safe.  
> Confirmed PIDs: `0x12E0` (Nova Pro Wireless), `0x12E5` (Nova Pro Wireless X).

| Command | Opcode `[1]` | Packet | Values |
|---------|-------------|--------|--------|
| Sidetone | `0x39` | `[0x06, 0x39, level, 0×28]` | `0`=off, `1`=low, `2`=medium, `3`=high |
| OLED/LED brightness | `0xBF` | `[0x06, 0xBF, strength, 0×28]` | `1–10` |
| Idle timeout | `0xC1` | `[0x06, 0xC1, level, 0×28]` | `0`=disabled, `1`=1min, `2`=5min, `3`=10min, `4`=15min, `5`=30min, `6`=60min |
| EQ preset select | `0x2E` | `[0x06, 0x2E, preset, 0×28]` | `0–3`=factory, `4`=custom |
| EQ bands write | `0x33` | `[0x06, 0x33, band×10, 0×18]` | See EQ formula below |
| Save to flash | `0x09` | `[0x06, 0x09, 0×29]` | No payload |

**Battery query (HeadsetControl confirmed):**  
Send `[0x06, 0xB0, 0×29]` → response `byte[6]` = level `(0–8)`, `byte[15]` = status (`0x01`=offline, `0x02`=charging, `0x08`=online)

**EQ band formula:**  
`band_byte = 0x14 + (2 × gain_dB)` where gain ∈ `[-10.0, +10.0]`, step `0.5 dB`  
`0x14` = 0 dB (flat). Examples: `+4 dB = 0x1C`, `-6 dB = 0x08`  
Must select custom preset (`0x2E` with value `4`) before writing bands via `0x33`.  
Send save command (`0x09`) after bands to persist to device flash.

### Nova 7X Commands That Are WRONG on Nova Pro

| Feature | Nova 7X opcode | Nova Pro opcode | Note |
|---------|----------------|-----------------|------|
| Idle timeout | `0xA3` (raw minutes) | `0xC1` (level index) | Different opcode AND value encoding |
| LED brightness | `0xAE` (0–3 levels) | `0xBF` (1–10 strength) | Different opcode AND range |
| EQ apply | `0x27` | `0x2E` (preset select) | Different opcode |

**Do not use `0xA3`, `0xAE`, or `0x27` on the Nova Pro.**

### Still Unknown (require Wireshark capture)

| Feature | Push event | Write candidate | Status |
|---------|-----------|-----------------|--------|
| ANC mode | `0xBD` | `[0x06, 0xBD, mode]` | Inferred — unconfirmed |
| Mic mute write | `0xBB` | `[0x06, 0xBB, muted]` | Inferred — unconfirmed |
| USB input switch | None known | `0xC0` or `0xC2` | Unknown |
| ChatMix balance | None known | Unknown | Unknown |
| Dual battery read | `0xB7` push | Format differs from `0xB0` | Needs investigation |

---

## Prerequisites (one-time setup)

### Python dependencies

```bash
cd scripts/hid-research
pip install -r requirements.txt   # installs 'hid' package
```

### Wireshark + USBPcap

Download from <https://www.wireshark.org/download.html> and during installation
check **USBPcap** when prompted. Verify afterwards:

```
tshark --version
```

### Identify the correct USBPcap interface

```powershell
tshark -D
```

Look for interfaces named `USBPcap1`, `USBPcap2`, etc. To confirm which one
contains your headset: unplug the dongle, start a capture, plug it back in, and
watch which USBPcap interface shows activity.

---

## Phase 1 — Device Enumeration

**Goal:** Find every HID interface exposed by the dongle and base station with their
exact usage pages, interface numbers, and paths.

```bash
python enumerate.py            # show Nova Pro interfaces only
python enumerate.py --all      # include other SteelSeries devices
```

**What to look for:**

| Column | Meaning |
|--------|---------|
| Interface number | Target interface for later phases |
| Usage Page `0xFFC0` | Control/command channel |
| Usage Page `0xFF00` | Event push channel |

**Output:** `enumerate-output.json`

**Expected result:** 4–6 interfaces per PID. Interface 4 is the confirmed event
interface. Interface 3 is the primary candidate for write commands (matches
HeadsetControl's usage pattern).

---

## Phase 2 — Passive Event Listener

**Goal:** Log every push event the headset sends spontaneously. SteelSeries GG
Engine may remain running — this phase only reads, never writes.

Open two terminals side by side.

```bash
# Terminal A — listen to all interfaces simultaneously
python listen.py

# Restrict to a known interface once enumeration is done
python listen.py --if 4

# Auto-stop after 2 minutes
python listen.py --timeout 120
```

**Perform every physical headset action while listening:**

| Action | Expected push event |
|--------|---------------------|
| Turn volume knob | `cmd=0x25` — headset_volume |
| Press mute button | `cmd=0xBB` — mic_mute |
| Press ANC button on headset | `cmd=0xBD` — anc_mode |
| Remove headset from base / power off | `cmd=0xB5` — connection_state |
| Place headset on base (start charging) | `cmd=0xB7` — battery_levels |
| In GG Engine — change sidetone | `cmd=0x39` — sidetone_level |
| In GG Engine — change OLED brightness | `cmd=0x85` — oled_brightness |
| Rotate ChatMix dial | Unknown — watch for new bytes |
| Switch USB input port in GG Engine | Unknown — watch for new bytes |

Events marked `[UNKNOWN]` in the output are candidates not yet decoded by the
current project. Note their `report_id` and `command` bytes for investigation.

**Output:** `listen-log-<timestamp>.json`

---

## Phase 3 — USB Wire Capture

**Goal:** Capture the exact bytes GG Engine sends to the device when you change
settings. This reveals write commands for features not covered by HeadsetControl.

### 3a. Automated capture

Run **as Administrator**:

```powershell
.\capture-usb.ps1

# Or specify interface and duration directly:
.\capture-usb.ps1 -Interface "\\.\USBPcap1" -Duration 120
```

The script lists interfaces, asks you to confirm the correct USBPcap, then runs
a timed capture and saves a `.pcapng` file.

### 3b. What to do in GG Engine during capture

Change **each setting one at a time**, pausing 2–3 seconds between changes. This
lets `parse-wireshark.py` group commands by what you were doing:

1. **Sidetone:** Off → Low → Medium → High → back to Medium  
   *(Expected write opcode: `0x39` — HeadsetControl confirmed)*
2. **OLED brightness:** cycle through all 10 levels  
   *(Expected write opcode: `0xBF` — HeadsetControl confirmed)*
3. **Idle timeout:** change value  
   *(Expected write opcode: `0xC1` — HeadsetControl confirmed)*
4. **EQ:** change one preset, then modify a band in custom mode  
   *(Expected write opcodes: `0x2E` preset, `0x33` bands, `0x09` save)*
5. **ANC mode:** Off → Transparency → ANC → Off  
   *(Write opcode unknown — CAPTURE PRIORITY)*
6. **USB input switch:** switch between PC input 1 and 2  
   *(Write opcode unknown — CAPTURE PRIORITY)*
7. **Microphone volume:** drag the slider  
   *(Write opcode unknown — CAPTURE PRIORITY)*

### 3c. Manual Wireshark capture (alternative)

1. **Capture → Options → USBPcap1** → Start
2. Perform GG Engine actions
3. Stop
4. **File → Export Packet Dissections → As JSON** → save as `capture.json`
5. Use `--json capture.json` in Phase 4

**Wireshark display filter** to see only SteelSeries OUT traffic (host → device):

```
usb.idVendor == 0x1038 && usb.endpoint_address.direction == 0
```

**Output:** `capture-<timestamp>.pcapng`

---

## Phase 4 — Parse USB Capture

**Goal:** Extract the raw HID bytes from the wire capture and group them by
command opcode. This turns a raw `.pcapng` into an actionable command table.

```bash
# From a pcapng file (tshark invoked automatically):
python parse-wireshark.py --pcap capture-20240426-120000.pcapng

# From tshark JSON exported manually:
python parse-wireshark.py --json capture.json

# Cross-reference with listen.py events:
python parse-wireshark.py --pcap capture.pcapng --events listen-log.json
```

**Reading the output:**

The script groups all OUT packets by `[byte0 byte1]` pattern. Example:

```
  06 39  [sidetone]  ×4
    frame=1234  06 39 00 00 00 00…   ← sidetone OFF
    frame=1238  06 39 01 00 00 00…   ← sidetone LOW

  06 BF  [OLED brightness]  ×10
    frame=1290  06 BF 01 00 00 00…
    ...

  06 BD  [UNKNOWN CMD]  ×3
    frame=1310  06 BD 00 00 00 00…   ← ANC OFF (to be confirmed)
    frame=1320  06 BD 01 00 00 00…   ← Transparency
    frame=1330  06 BD 02 00 00 00…   ← ANC ON
```

Any `[UNKNOWN CMD]` entry for byte1 values outside the HeadsetControl confirmed
set is a new discovery. Record its opcode and byte values for Phase 6.

**Output:** `wireshark-commands.json`

---

## Phase 5 — Read Command Prober

**Goal:** Verify which interfaces respond to synchronous query commands (request
sent → response received), separate from spontaneous push events.

**Close SteelSeries GG Engine first.**

```bash
# Probe all interfaces with all candidate commands
python probe-read.py

# Restrict to interface 3 (primary control candidate)
python probe-read.py --if 3

# Full brute-force: scan all 256 possible byte1 opcodes
python probe-read.py --scan
```

**Priority candidates (★ = HeadsetControl confirmed):**

| Packet sent | Expected on success |
|------------|---------------------|
| `[0x06, 0xB0, …]` | ★ Battery: `resp[6]`=level (0–8), `resp[15]`=status |
| `[0x06, 0x39, …]` | ★ Sidetone: current level |
| `[0x06, 0xBF, …]` | ★ OLED brightness: current strength |
| `[0x06, 0xC1, …]` | ★ Idle timeout: current level index |
| `[0x06, 0x2E, …]` | ★ EQ preset: current preset |
| `[0x06, 0x33, …]` | ★ EQ bands: 10 band bytes |
| `[0x06, 0xBD, …]` | ANC mode: current mode (Nova Pro only) |

**If `0xB0` responds on Interface 3**, the Nova Pro uses the same control channel
layout as the Nova 7X — the full read protocol transfers directly.

**Output:** `probe-read-results.json`

---

## Phase 6 — Write Command Testing

**Goal:** Confirm write commands work on the actual device and observe the push
event responses they trigger.

**Setup:** Two terminals must be open simultaneously.

```bash
# Terminal A — keep listen.py running throughout this entire phase
python listen.py

# Terminal B — interactive write tests
python probe-write.py --list              # show available groups
python probe-write.py                     # interactive menu
python probe-write.py --group sidetone    # run one specific group
```

### Command groups

**★ HeadsetControl confirmed — test these first:**

| Group | Opcode | Packet | Expected push event |
|-------|--------|--------|---------------------|
| `sidetone` | `0x39` | `[0x06, 0x39, level]` level 0–3 | `cmd=0x39` with matching level |
| `oled_brightness` | `0xBF` | `[0x06, 0xBF, strength]` 1–10 | `cmd=0x85` with brightness value |
| `idle_timeout` | `0xC1` | `[0x06, 0xC1, level]` 0–6 | Timeout change event |
| `eq_preset` | `0x2E` | `[0x06, 0x2E, preset]` 0–4 | EQ preset event |
| `eq_bands` | `0x33` | `[0x06, 0x33, band×10]` | EQ bands event |
| `eq_save` | `0x09` | `[0x06, 0x09]` | Save ack |

**Nova Pro specific — need confirmation:**

| Group | Candidate opcode | Packet | Expected push event |
|-------|-----------------|--------|---------------------|
| `anc_mode` | `0xBD` | `[0x06, 0xBD, mode]` 0/1/2 | `cmd=0xBD` |
| `mic_mute` | `0xBB` | `[0x06, 0xBB, muted]` 0/1 | `cmd=0xBB` |
| `usb_input` | `0xC0`/`0xC2` | `[0x06, 0xC0, input]` 1/2 | USB input event |
| `mic_volume` | `0x37` | `[0x06, 0x37, level]` 0–7 | Mic volume event |

### Interpreting results

| Terminal A shows | Meaning |
|-----------------|---------|
| `[sidetone_level] ← 06 39 01 …` | Write confirmed ✓ |
| `[UNKNOWN] ← 06 BD 00 …` | Write works, push opcode newly discovered |
| *(silence after write)* | Wrong interface, wrong opcode, or GG Engine blocking |

### If silence on all interfaces

1. Try the command on a different interface number (`--if 3` vs `--if 4`)
2. Check Wireshark capture — what exact bytes did GG Engine send?
3. Some writes may need the packet padded to exactly 31 bytes, not 64
4. The device may require a specific report ID other than `0x06`

**Output:** `probe-write-results.json`

---

## Phase 7 — Build Command Map

**Goal:** Aggregate all findings into `command-map.json`, the single authoritative
reference for implementing write commands in the TypeScript application.

```bash
python build-map.py \
  --listen   listen-log-<timestamp>.json \
  --read     probe-read-results.json \
  --write    probe-write-results.json \
  --wireshark wireshark-commands.json \
  --out      command-map.json
```

The output JSON has these sections:

```jsonc
{
  "_meta": {
    "write_report_id": "0x06",
    "native_packet_size_bytes": 31,
    "notes": ["HeadsetControl confirmed opcodes", "EQ formula", "battery response offsets"]
  },
  "push_events": [ /* 7 baseline + any newly discovered */ ],
  "write_commands_confirmed": [
    { "name": "sidetone", "command": "0x39", "packet": "[0x06, 0x39, level]", "write_confirmed": true },
    { "name": "oled_lights", "command": "0xBF", "packet": "[0x06, 0xBF, strength]", "write_confirmed": true },
    // ... all HeadsetControl confirmed + probe-write verified
  ],
  "write_commands_unknown": [
    { "name": "anc_mode_write", "candidate_write_cmd": "0xBD", "notes": "needs Wireshark" }
  ],
  "read_queries_confirmed_headsetcontrol": [ /* 0xB0 battery query */ ],
  "read_queries_confirmed_probe": [ /* interfaces that responded */ ],
  "wireshark_out_commands": [ /* all OUT packets from GG Engine */ ],
  "nova7x_commands_not_valid_on_nova_pro": [ /* 0xA3, 0xAE, 0x27 */ ]
}
```

**Output:** `command-map.json`

---

## Phase 8 — Integration Validation

**Goal:** Verify that confirmed commands work through the project's own `node-hid`
binary (the same native module that runs inside Electron) and that push event
responses parse correctly via the existing `parseEvent()` logic in
`baseStationEvents.ts`.

**Close SteelSeries GG Engine first.**

```bash
# Most reliable — runs under Electron's Node (correct native ABI):
npx electron scripts/hid-research/validate.cjs

# List available test groups:
npx electron scripts/hid-research/validate.cjs --list

# Test a single group:
npx electron scripts/hid-research/validate.cjs --group sidetone
npx electron scripts/hid-research/validate.cjs --group oled_brightness
npx electron scripts/hid-research/validate.cjs --group eq_bands
```

The validator sends each confirmed write command, drains push events for 600ms,
and reports whether the push event matches the expected opcode using the same
`parseEvent()` decoder from `baseStationEvents.ts`.

**Test groups in validator:**

| Group | Source | Tests |
|-------|--------|-------|
| `sidetone` | ★ HeadsetControl | `[0x06, 0x39, 0]`, `[0x06, 0x39, 1]`, restore |
| `oled_brightness` | ★ HeadsetControl | `[0x06, 0xBF, 1/5]`, restore |
| `idle_timeout` | ★ HeadsetControl | levels 3 and 5, restore |
| `eq_preset` | ★ HeadsetControl | select custom (4), restore to 0 |
| `eq_bands` | ★ HeadsetControl | flat EQ, save, restore |
| `anc_mode` | Candidate | off/transparency/ANC, restore |
| `mic_volume` | Candidate | levels 5 and 3 |
| `battery_query` | ★ HeadsetControl | read and print response |

**Output:** `validate-results-<timestamp>.json`

---

## Phase 9 — Implement HID Writer Service

Once `command-map.json` is complete and Phase 8 passes, implement write support
in the TypeScript application.

### New file: `src/main/services/apis/arctis/hidWriter.ts`

```typescript
// Skeleton structure only — fill in after Phase 8 validation

const REPORT_ID = 0x06;
const PACKET_SIZE = 31;

function makePacket(opcode: number, payload: number[] = []): number[] {
  const pkt = new Array(PACKET_SIZE).fill(0);
  pkt[0] = REPORT_ID;
  pkt[1] = opcode;
  payload.forEach((v, i) => { if (2 + i < PACKET_SIZE) pkt[2 + i] = v; });
  return pkt;
}

// Confirmed writes (HeadsetControl):
setSidetone(level: 0|1|2|3)         → makePacket(0x39, [level])
setOledBrightness(strength: number)  → makePacket(0xBF, [strength])  // 1–10
setIdleTimeout(levelIndex: 0-6)      → makePacket(0xC1, [levelIndex])
setEqPreset(preset: 0-4)             → makePacket(0x2E, [preset])
setEqBands(gains: number[10])        → makePacket(0x33, gains.map(g => 0x14 + 2*g))
saveToFlash()                        → makePacket(0x09)
queryBattery()                       → makePacket(0xB0)  // read response

// After Phase 6/8 — fill in when confirmed:
setAncMode(mode: 0|1|2)             → makePacket(0xBD, [mode])  // 0=off,1=trans,2=anc
setMicMute(muted: boolean)          → makePacket(0xBB, [muted ? 1 : 0])
setUsbInput(input: 1|2)             → makePacket(0xC0, [input])
```

### New IPC channels to add in `src/shared/ipc.ts`

```typescript
// IPC_INVOKE map additions
"hid:set-sidetone"          // { level: 0|1|2|3 }
"hid:set-oled-brightness"   // { strength: number }  // 1–10
"hid:set-idle-timeout"      // { levelIndex: number } // 0–6
"hid:set-eq-preset"         // { preset: number }     // 0–4
"hid:set-eq-bands"          // { gains: number[] }    // 10 values, -10 to +10 dB
"hid:query-battery"         // → { level: number, status: string }
// After confirmation:
"hid:set-anc-mode"          // { mode: 'off'|'transparency'|'anc' }
"hid:set-mic-mute"          // { muted: boolean }
"hid:set-usb-input"         // { input: 1|2 }
```

---

## Decision Tree — When Commands Are Silent

```
Write sent → no push event received in listen.py
│
├─ Try a different interface number (IF=3 vs IF=4)
│
├─ Verify GG Engine is fully closed (it may hold exclusive access)
│
├─ Compare exact bytes with Wireshark Phase 3/4 capture of GG Engine
│   └─ GG Engine uses different byte0? → update report ID in probe-write.py
│
├─ Try padding packet to exactly 31 bytes (native size) instead of 64
│
├─ Check if GG Engine uses a 2-step handshake
│   (send query first, read response, then send write command)
│
├─ Try report ID 0x07 as byte0 instead of 0x06
│
└─ Feature may require SteelSeries Sonar HTTP API, not HID
    (e.g., Sonar mixer volumes, preset selection)
```

---

## Complete Confidence Reference Table

| Feature | Write opcode | Packet | Source | Confidence |
|---------|-------------|--------|--------|-----------|
| Sidetone | `0x39` | `[0x06, 0x39, level]` 0–3 | HeadsetControl ✓ | **Very High** |
| OLED brightness | `0xBF` | `[0x06, 0xBF, strength]` 1–10 | HeadsetControl ✓ | **Very High** |
| Idle timeout | `0xC1` | `[0x06, 0xC1, levelIdx]` 0–6 | HeadsetControl ✓ | **Very High** |
| EQ preset | `0x2E` | `[0x06, 0x2E, preset]` 0–4 | HeadsetControl ✓ | **Very High** |
| EQ bands | `0x33` | `[0x06, 0x33, band×10]` | HeadsetControl ✓ | **Very High** |
| Save to flash | `0x09` | `[0x06, 0x09]` | HeadsetControl ✓ | **Very High** |
| Battery query | `0xB0` | `[0x06, 0xB0]` read | HeadsetControl ✓ | **Very High** |
| ANC mode | `0xBD` | `[0x06, 0xBD, mode]` 0/1/2 | Push event inference | Medium |
| Mic mute write | `0xBB` | `[0x06, 0xBB, muted]` 0/1 | Push event inference | Medium |
| Mic volume | `0x37` | `[0x06, 0x37, level]` 0–7 | Nova 7X + corrected RID | Medium |
| USB input switch | `0xC0`? | `[0x06, 0xC0, input]` 1/2 | Candidate | Low |
| ChatMix balance | Unknown | Unknown | Wireshark needed | Unknown |
| Volume limiter | `0x3A`? | `[0x06, 0x3A, toggle]` | Nova 7X + corrected RID | Low–Medium |

---

## File Reference

| File | Phase | Purpose |
|------|-------|---------|
| `enumerate.py` | 1 | Discover all HID interfaces |
| `listen.py` | 2 | Passive push event logger |
| `capture-usb.ps1` | 3 | Automated USBPcap/tshark capture |
| `parse-wireshark.py` | 4 | Extract OUT commands from pcapng |
| `probe-read.py` | 5 | Synchronous read command prober |
| `probe-write.py` | 6 | Interactive write command tester |
| `build-map.py` | 7 | Aggregate all findings → `command-map.json` |
| `validate.cjs` | 8 | Integration test via project's node-hid |
| `requirements.txt` | — | Python dependency (`hid`) |
| `command-map.json` | Output | Authoritative command reference |

---

## Quick Start

```bash
# 1. Install Python dep
pip install -r requirements.txt

# 2. Enumerate interfaces
python enumerate.py

# 3. Passive listen (keep running, perform headset actions)
python listen.py

# 4. In a second terminal — probe confirmed read commands
python probe-read.py --if 3

# 5. Test HeadsetControl confirmed writes (GG Engine CLOSED)
python probe-write.py --group sidetone
python probe-write.py --group oled_brightness
python probe-write.py --group idle_timeout

# 6. Wireshark capture for unknowns (GG Engine OPEN)
.\capture-usb.ps1 -Interface "\\.\USBPcap1" -Duration 120
python parse-wireshark.py --pcap capture-*.pcapng

# 7. Test unknown write commands (GG Engine CLOSED)
python probe-write.py --group anc_mode
python probe-write.py --group usb_input

# 8. Build command map
python build-map.py

# 9. Integration validate
npx electron scripts/hid-research/validate.cjs
```

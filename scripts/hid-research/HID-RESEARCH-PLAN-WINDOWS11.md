# Arctis Nova Pro Wireless — HID Protocol Mapping Plan (Windows 11)

Complete step-by-step guide to map every HID read and write command for the
SteelSeries Arctis Nova Pro Wireless on Windows 11, including the four Nova Pro-
specific features — **ANC mode**, **USB input switching**, **mic mute write**,
and **ChatMix** — with full implementation steps for the TypeScript application.

All commands are written for **PowerShell 5.1** (Windows built-in).  
Run PowerShell from the project root: `C:\Users\ffvd\Documents\arctis_centre\src\Apps\control-centre-full-app`

---

## What Is Already Known

### Push events (already decoded in `src\main\services\apis\arctis\baseStationEvents.ts`)

Events arrive on **Interface 4**, report ID `0x06` or `0x07` at `byte[0]`.

| `byte[1]` | Field | Decoding |
|-----------|-------|----------|
| `0x25` | `headset_volume_percent` | `byte[2]` raw `0–0x38`, inverted → percent |
| `0xB5` | `connected` / `wireless` / `bluetooth` | `byte[3]=1` BT; `byte[4]=8` 2.4 GHz |
| `0xB7` | `headset_battery_percent` / `base_battery_percent` | `byte[2]` headset `0–8`; `byte[3]` base `0–8` |
| `0x85` | `oled_brightness` | `byte[2]` level `1–10` |
| `0x39` | `sidetone_level` | `byte[2]` level `0–3` |
| `0xBD` | `anc_mode` | `byte[2]`: `0`=off `1`=transparency `2`=ANC |
| `0xBB` | `mic_mute` | `byte[2]`: `0`=unmuted `1`=muted |

### Write commands (confirmed by HeadsetControl `nova_pro_wireless.hpp`)

> All write packets: **`byte[0] = 0x06`** (HID report ID). Native size **31 bytes**.

| Feature | Opcode `byte[1]` | `byte[2]` values |
|---------|-----------------|------------------|
| Sidetone | `0x39` | `0`=off `1`=low `2`=med `3`=high |
| OLED brightness | `0xBF` | `1–10` |
| Idle timeout | `0xC1` | `0`=off `1`=1min `2`=5min `3`=10min `4`=15min `5`=30min `6`=60min |
| EQ preset | `0x2E` | `0–3`=factory `4`=custom |
| EQ bands | `0x33` | 10 bytes: `0x14 + (2 × gain_dB)`, gain `±10 dB` |
| Save to flash | `0x09` | — |
| Battery query (read) | `0xB0` | → `resp[6]` level `0–8`; `resp[15]` `0x01`=offline `0x02`=charging `0x08`=online |

### Still unknown — primary targets of this plan

| Feature | Push event | Write opcode candidate |
|---------|-----------|----------------------|
| ANC mode write | `0xBD` known | `0xBD` inferred |
| Mic mute write | `0xBB` known | `0xBB` inferred |
| USB input switch | None known | `0xC0` candidate |
| ChatMix | Not yet captured | Likely read-only via HID; Sonar HTTP used for write |

---

## Prerequisites

### 1. Python 3.11+

Open PowerShell and check if Python is installed:

```powershell
python --version
```

If not installed:

```powershell
winget install Python.Python.3.11
```

Or download from <https://www.python.org/downloads/> — during installation check
**"Add Python to PATH"**.

Verify after install (open a new PowerShell window):

```powershell
python --version   # should show 3.11.x or later
pip --version
```

### 2. Python virtual environment

From the `scripts\hid-research\` directory:

```powershell
cd scripts\hid-research
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

If `Activate.ps1` is blocked by execution policy:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then retry the activation. You will see `(.venv)` at the start of the prompt
when the environment is active. **Activate it every time you open a new terminal.**

### 3. Wireshark + USBPcap

Download **Wireshark** from <https://www.wireshark.org/download.html> and run the
installer as Administrator. On the component selection screen, check **USBPcap**
(it is unchecked by default). Complete the installation.

Verify `tshark` is available:

```powershell
& "C:\Program Files\Wireshark\tshark.exe" --version
```

If you see version output, setup is complete. Add it to PATH permanently
(optional — the scripts fall back to the full path automatically):

```powershell
$env:PATH += ";C:\Program Files\Wireshark"
```

### 4. Identify your USBPcap interface number

Run once to list all capture interfaces:

```powershell
& "C:\Program Files\Wireshark\tshark.exe" -D
```

Look for lines like `\\.\USBPcap1`, `\\.\USBPcap2`, etc. To find which one
contains the headset dongle, unplug the dongle, then run:

```powershell
& "C:\Program Files\Wireshark\tshark.exe" -i "\\.\USBPcap1" -q -a duration:5
```

Plug the dongle back in while counting — the interface that shows a packet count
greater than zero is your headset's USB bus. Note the number (e.g. `USBPcap2`).

### 5. PowerShell execution policy for capture script

The `capture-usb.ps1` script requires Administrator and a relaxed execution policy:

```powershell
# In an elevated (Administrator) PowerShell:
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine
```

### 6. Confirm SteelSeries GG Engine path

GG Engine is typically installed at:

```
C:\Program Files\SteelSeries\GG\SteelSeriesGG.exe
```

Useful PowerShell commands for GG Engine management used throughout this plan:

```powershell
# Check if GG Engine is running
Get-Process -Name "SteelSeriesGGClient" -ErrorAction SilentlyContinue

# Stop GG Engine (required before probing)
Stop-Process -Name "SteelSeriesGGClient" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "SteelSeriesGG" -Force -ErrorAction SilentlyContinue

# Start GG Engine (required for Wireshark capture phases)
Start-Process "C:\Program Files\SteelSeries\GG\SteelSeriesGG.exe"
Start-Sleep -Seconds 5   # allow it to connect to the headset
```

### 7. Windows HID access behaviour

On Windows 11, HID interfaces with usage page `0xFF00`/`0xFFC0` can be opened
by multiple processes simultaneously — so `listen.py` and `probe-write.py` can
run alongside each other. However, GG Engine may hold **exclusive write access**
to the control interface (Interface 3). If write commands fail, stop GG Engine
first. Passive reading (listen.py) is safe with GG Engine running.

---

## Phase 1 — Device Enumeration

**Goal:** Find every HID interface the dongle exposes on Windows 11 and confirm
interface numbers, usage pages, and device paths.

```powershell
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1

python enumerate.py           # Nova Pro interfaces only
python enumerate.py --all     # include all SteelSeries devices
```

**What to note in the output:**

| Field | Meaning |
|-------|---------|
| Interface number | The target for later phases — note which ones appear |
| Usage Page `0xFFC0` | Control/command channel (write commands go here) |
| Usage Page `0xFF00` | Push event channel (this is Interface 4) |

The current project uses **Interface 4** for push events. Interface **3** is the
primary candidate for write commands, based on HeadsetControl's implementation.

**Output:** `enumerate-output.json`

**Common Windows 11 issue:** If enumerate shows zero Nova Pro devices, check:

```powershell
# Confirm device is seen by Windows
Get-PnpDevice | Where-Object { $_.FriendlyName -like "*Arctis*" -or $_.FriendlyName -like "*SteelSeries*" }
```

---

## Phase 2 — Passive Event Listener

**Goal:** Log every push event the headset sends spontaneously with GG Engine
running. This phase never writes anything — safe to run alongside GG Engine.

Open **two PowerShell windows** side-by-side.

```powershell
# Window A — passive listener
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1
python listen.py

# Restrict to Interface 4 once you know it (faster output):
python listen.py --if 4

# Auto-stop after 3 minutes:
python listen.py --timeout 180
```

**While listening, perform every action listed below. For each one, observe
Window A for the push event hex and decoded label.**

### Standard actions (events already decoded)

| Action | Where | Expected `[decoded]` label |
|--------|-------|---------------------------|
| Turn volume knob on headset | Physical headset | `[headset_volume]` cmd `0x25` |
| Press ANC button on headset | Physical headset button | `[anc_mode]` cmd `0xBD` |
| Press mic mute button/flip mic | Physical headset | `[mic_mute]` cmd `0xBB` |
| Remove headset from base | Physical | `[connection_state]` cmd `0xB5` |
| Place headset on base | Physical | `[battery_levels]` cmd `0xB7` |
| Change sidetone in GG Engine | GG → Headset → Microphone | `[sidetone_level]` cmd `0x39` |
| Change OLED brightness in GG Engine | GG → Headset → Display | `[oled_brightness]` cmd `0x85` |

### Nova Pro-specific actions (push events to discover)

| Action | Where in GG Engine | Watch for |
|--------|-------------------|-----------|
| Rotate **ChatMix** dial on base station | Physical dial on base | `[UNKNOWN]` — note hex |
| Switch **USB input port** in GG Engine | GG → Headset → Base Station → PC Port (1 or 2) | `[UNKNOWN]` — note hex |
| Toggle **ANC** in GG Engine | GG → Headset → Noise Cancelling | Should match physical button `[anc_mode]` |

**ChatMix dial location in GG Engine:** Open GG Engine → click the headset icon
at the top → look for "ChatMix" slider. The physical dial on the base station
generates a HID event; GG Engine reads it and updates the Sonar HTTP API balance.

**USB input location in GG Engine:** GG Engine → Headset tab → scroll to
"Base Station" section → there is a "PC Port" or "USB Connection" toggle between
port 1 and port 2. This is the USB input switch.

**Events marked `[UNKNOWN]`** are new push events not yet decoded by the project.
Record their `report_id` and `command` bytes — these are inputs to Phase 4.

**Output:** `listen-log-<timestamp>.json`

---

## Phase 3 — USB Wire Capture

**Goal:** Capture the exact HID packets GG Engine sends to the device when you
change settings. This reveals write commands for the four unknown Nova Pro features.

### 3a. Automated capture (recommended)

Open PowerShell **as Administrator**:

```powershell
# Right-click Start → Windows PowerShell (Admin)
cd "C:\Users\ffvd\Documents\arctis_centre\src\Apps\control-centre-full-app\scripts\hid-research"

# Interactive — prompts for interface:
.\capture-usb.ps1

# Direct — if you already know the interface:
.\capture-usb.ps1 -Interface "\\.\USBPcap2" -Duration 180
```

The script runs `tshark` for the specified duration and saves a `.pcapng` file.

### 3b. GG Engine actions during capture — standard features

Perform these first to validate that your capture is working. You will see
packets matching the known HeadsetControl opcodes in Phase 4 output:

1. **Sidetone:** Off → Low → Medium → High → Medium  
   *(Expected opcode: `0x39` — HeadsetControl confirmed)*
2. **OLED brightness:** cycle through levels 1–10  
   *(Expected opcode: `0xBF` — HeadsetControl confirmed)*
3. **Idle timeout:** change to several different values  
   *(Expected opcode: `0xC1` — HeadsetControl confirmed)*
4. **EQ:** select each factory preset (0–3), then select custom and move one band  
   *(Expected opcodes: `0x2E`, `0x33`, `0x09`)*

### 3c. GG Engine actions during capture — Nova Pro specific (primary targets)

Perform each group with a **3-second pause** between actions:

#### ANC Mode
GG Engine location: **GG Engine → Headset icon → Noise Cancelling** (or similar label)

1. Set ANC to **Off**. Wait 3 s.
2. Set ANC to **Transparency**. Wait 3 s.
3. Set ANC to **Active Noise Cancellation**. Wait 3 s.
4. Set ANC back to **Off**. Wait 3 s.

You can also cycle through modes using the **physical ANC button** on the headset
while the capture is running — this will show what the device sends, and whether
GG Engine echoes anything back.

#### USB Input Switch
GG Engine location: **GG Engine → Headset tab → Base Station → PC Port**

1. Switch to **PC Port 1**. Wait 3 s.
2. Switch to **PC Port 2**. Wait 3 s.
3. Switch back to **PC Port 1**. Wait 3 s.

> If you cannot find this control, open GG Engine and look for "Base Station",
> "Connection", or "USB" in the headset settings. It controls which of the two
> USB ports on the base station is active.

#### Mic Mute Write
GG Engine does **not** have a software mic mute button for the Nova Pro — the
mute is controlled by the physical button/flip mic mechanism on the headset.

To capture any write-back behaviour, do the following **while the capture runs**:

1. Physically **mute the microphone** on the headset. Wait 2 s.
2. Watch GG Engine — does it visually update to show muted state?
3. Physically **unmute** the microphone. Wait 2 s.

After the physical press triggers a `0xBB` push event IN, watch for whether
GG Engine immediately sends an OUT packet back to the device. This bidirectional
pattern would confirm that `0xBB` is both a push event AND a writable command.

If GG Engine shows no visual response to the physical mute button, then
**mic mute has no HID write command** and is hardware-only.

#### ChatMix
ChatMix is **physical-dial-only** — it cannot be written from the PC. The dial
on the base station generates a HID push event; GG Engine reads it and posts the
balance to the Sonar HTTP API. The current project already reads `chat_mix_balance`
from Sonar HTTP (`extractChatMix()` in `service.ts`).

To confirm the push event format and opcode:

1. Slowly rotate the **ChatMix dial** on the base station toward Game. Wait 2 s.
2. Rotate toward Chat. Wait 2 s.
3. Center the dial. Wait 2 s.

The push event raw bytes will appear in Window A from Phase 2 (`listen.py`)
simultaneously. Cross-reference with the Wireshark capture to confirm the
direction (IN = device → host = push event, no OUT needed).

### 3d. Manual Wireshark capture (alternative if capture-usb.ps1 fails)

1. Open **Wireshark as Administrator**
2. **Capture → Options** → find the USBPcap interface that has the headset → double-click to start
3. Perform the GG Engine actions above
4. **Stop** the capture
5. Apply this display filter to see only SteelSeries OUT packets:
   ```
   usb.idVendor == 0x1038 && usb.endpoint_address.direction == 0
   ```
6. **File → Export Packet Dissections → As JSON** → save as `capture.json`

**Output:** `capture-<timestamp>.pcapng`

---

## Phase 4 — Parse USB Capture

**Goal:** Extract the raw HID bytes from the capture and group them by opcode,
revealing the exact write commands GG Engine sends.

```powershell
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1

# From a pcapng file (tshark runs automatically):
python parse-wireshark.py --pcap capture-20240426-120000.pcapng

# From JSON exported manually from Wireshark:
python parse-wireshark.py --json capture.json

# Cross-reference with listen.py log to correlate IN events with OUT commands:
python parse-wireshark.py --pcap capture-*.pcapng --events listen-log-*.json
```

**Reading the output — what to look for for each feature:**

#### Confirming already-known commands (validate your capture is working)

```
06 39  [sidetone]  ×4      ← HeadsetControl confirmed ✓
  06 39 00 …               ← sidetone off
  06 39 01 …               ← sidetone low
06 BF  [OLED brightness]   ← HeadsetControl confirmed ✓
06 C1  [idle timeout]       ← HeadsetControl confirmed ✓
```

#### ANC mode — expected pattern

```
06 BD  [UNKNOWN CMD]  ×3
  06 BD 00 …               ← ANC OFF
  06 BD 01 …               ← Transparency
  06 BD 02 …               ← ANC ON
```

If `0xBD` appears with those values, the write opcode is confirmed.  
If a different opcode appears when you toggle ANC, use that opcode instead.

#### USB input switch — expected pattern

```
06 ??  [UNKNOWN CMD]  ×2
  06 ?? 01 …               ← PC Port 1
  06 ?? 02 …               ← PC Port 2
```

The opcode `??` is the unknown. Record it — this is what you will use in Phase 6.

#### Mic mute write — what to look for

After you physically press the mute button, watch for an OUT packet immediately
following the IN event. The pattern would be:

```
IN:  06 BB 01 …     ← push event from headset: mic muted
OUT: 06 BB 01 …     ← GG Engine echoing back (if it does)
```

If no OUT packet follows the IN event, **mic mute is physical-only** with no
software write command. In that case, the current push event handling is sufficient.

#### ChatMix — expected pattern

```
No OUT packets when rotating dial.
```

ChatMix will show as IN packets only (device → host). There is no write command
to the device for ChatMix — it goes via Sonar HTTP API instead. Use the IN event
opcode discovered here to update `AppState` directly in `baseStationEvents.ts`
without waiting for the Sonar poll interval.

**Output:** `wireshark-commands.json`

**Update the write candidates in `probe-write.py`** based on what you found.
For any newly discovered opcode, add a variant to the relevant command group:

```python
# Example: if Wireshark showed USB input uses opcode 0xC3
(0x06, 0xC3, [0x01], "USB input 1 via 0xC3 [Wireshark confirmed]"),
(0x06, 0xC3, [0x02], "USB input 2 via 0xC3 [Wireshark confirmed]"),
```

---

## Phase 5 — Read Command Prober

**Goal:** Confirm which interfaces respond to synchronous query packets, separate
from push events.

**Stop GG Engine before this phase:**

```powershell
Stop-Process -Name "SteelSeriesGGClient" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "SteelSeriesGG" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
```

```powershell
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1

# Probe all interfaces with all candidate commands:
python probe-read.py

# Restrict to Interface 3 first (primary control candidate):
python probe-read.py --if 3

# Then Interface 4:
python probe-read.py --if 4

# Full scan — try all 256 possible byte1 opcodes on Interface 3:
python probe-read.py --if 3 --scan
```

**Priority responses to look for (★ = HeadsetControl confirmed):**

| Packet sent | Expected response on success |
|------------|------------------------------|
| `[0x06, 0xB0, 0×29]` | ★ `resp[6]`=headset level `(0–8)`, `resp[15]`=status |
| `[0x06, 0x39, 0×29]` | ★ Current sidetone level in `resp[2]` |
| `[0x06, 0xBF, 0×29]` | ★ Current OLED strength in `resp[2]` |
| `[0x06, 0xC1, 0×29]` | ★ Current idle timeout level in `resp[2]` |
| `[0x06, 0xBD, 0×29]` | ANC mode in `resp[2]` (0/1/2) |

If `0xB0` responds on Interface 3 with non-zero bytes at `[6]` and `[15]`, the
write control interface is confirmed.

**Output:** `probe-read-results.json`

---

## Phase 6 — Write Command Testing

**Goal:** Test confirmed and candidate write commands against the live device and
observe push-event responses.

Open **two PowerShell windows**.

```powershell
# Window A — passive listener (keep running throughout)
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1
python listen.py --if 4

# Window B — interactive write tester
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1
python probe-write.py --list
```

**Stop GG Engine before Window B:**

```powershell
Stop-Process -Name "SteelSeriesGGClient" -Force -ErrorAction SilentlyContinue
```

### Test sequence

Run HeadsetControl-confirmed groups first to validate the setup:

```powershell
# Window B:
python probe-write.py --group sidetone        # expect: [sidetone_level] events in Window A
python probe-write.py --group oled_brightness # expect: [oled_brightness] events in Window A
python probe-write.py --group idle_timeout    # expect: timeout change event
python probe-write.py --group eq_preset       # expect: EQ event
python probe-write.py --group eq_bands        # expect: EQ bands event (run eq_preset first)
python probe-write.py --group eq_save         # persist to flash
```

Then test Nova Pro specific groups. **Update the variant opcodes in `probe-write.py`
first** if Wireshark (Phase 4) revealed a specific opcode:

```powershell
python probe-write.py --group anc_mode        # expect: [anc_mode] events in Window A
python probe-write.py --group mic_mute        # expect: [mic_mute] event (if writable)
python probe-write.py --group usb_input       # expect: USB input change event
python probe-write.py --group mic_volume      # expect: mic volume event
```

### Interpreting Window A during write tests

| Window A shows | Meaning |
|----------------|---------|
| `[sidetone_level] ← 06 39 01 …` | Write confirmed ✓ — opcode and value correct |
| `[UNKNOWN] ← 06 BD 00 …` | Write triggered a response, but push opcode is new |
| *(silence)* | Wrong interface, wrong opcode, or packet format issue |
| `[FAIL] Cannot open` | GG Engine still running — stop it and retry |

### Nova Pro-specific troubleshooting

**ANC mode silent:** If `0xBD` produces no push event, GG Engine may use a
different opcode. Check `wireshark-commands.json` for any `06 BC` or `06 BE` OUT
packets during ANC toggles.

**Mic mute silent:** This is expected if GG Engine showed no OUT packet in
Phase 4. Mic mute is likely hardware-only — the physical button triggers a push
event and GG Engine reads it, but there is no write-back. Skip this group.

**USB input silent:** Try the opcode found in Wireshark. If no Wireshark capture
was done yet, test `0xC0`, `0xC2`, and `0xC3` in sequence. Check `listen.py` for
any new `[UNKNOWN]` push events — the device may not push back for this command.

**ChatMix:** No write test needed. ChatMix is read-only from the HID side. The
push event opcode from Phase 2/listen.py is what to add to `baseStationEvents.ts`.

**Output:** `probe-write-results.json`

---

## Phase 7 — Build Command Map

**Goal:** Consolidate all phase outputs into `command-map.json`.

```powershell
cd scripts\hid-research
.\.venv\Scripts\Activate.ps1

python build-map.py `
  --listen   listen-log-<timestamp>.json `
  --read     probe-read-results.json `
  --write    probe-write-results.json `
  --wireshark wireshark-commands.json `
  --out      command-map.json
```

(PowerShell uses backtick `` ` `` for line continuation, not backslash.)

**Output:** `command-map.json`

---

## Phase 8 — Integration Validation

**Goal:** Confirm all write commands work through the project's own `node-hid`
binary (Electron ABI) and push events decode correctly via `parseEvent()`.

**Stop GG Engine:**

```powershell
Stop-Process -Name "SteelSeriesGGClient" -Force -ErrorAction SilentlyContinue
```

From the **project root**:

```powershell
# Most reliable — Electron's Node ABI matches production:
npx electron scripts\hid-research\validate.cjs

# List all test groups:
npx electron scripts\hid-research\validate.cjs --list

# Test individual groups:
npx electron scripts\hid-research\validate.cjs --group sidetone
npx electron scripts\hid-research\validate.cjs --group oled_brightness
npx electron scripts\hid-research\validate.cjs --group anc_mode
npx electron scripts\hid-research\validate.cjs --group battery_query
```

**Output:** `validate-results-<timestamp>.json`

---

## Phase 9 — Implementation

Once `command-map.json` is complete and Phase 8 passes, implement the HID write
service and wire each feature into the application.

### Step 9.1 — Create `src\main\services\apis\arctis\hidWriter.ts`

This service opens the control interface and exposes typed write methods. It is
intentionally separate from `baseStationEvents.ts` (which handles reads) to keep
the two concerns independent.

```typescript
import type { HidDeviceInfo as RawHidDevice } from "node-hid";

const STEELSERIES_VID = 0x1038;
const NOVA_PRO_PIDS = new Set([0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D]);
const CONTROL_INTERFACE = 3; // confirmed by probe-read.py
const REPORT_ID = 0x06;
const PACKET_SIZE = 31;

// Idle timeout level index → minutes mapping (HeadsetControl confirmed)
export const IDLE_TIMEOUT_MINUTES = [0, 1, 5, 10, 15, 30, 60] as const;
export type IdleTimeoutLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ANC modes
export type AncMode = "off" | "transparency" | "anc";
const ANC_MODE_BYTES: Record<AncMode, number> = { off: 0, transparency: 1, anc: 2 };

type HidHandle = { write: (data: number[]) => number; close: () => void };
type HidModule = { devices: () => RawHidDevice[]; HID: new (path: string) => HidHandle };

export class HidWriterService {
  private hid: HidModule | null = null;
  private device: HidHandle | null = null;
  private lastError = "";

  public start(): void {
    this.hid = this.tryLoadHid();
    if (!this.hid) {
      this.lastError = "node-hid unavailable";
      return;
    }
    this.openControlInterface();
  }

  public stop(): void {
    this.closeDevice();
  }

  public getLastError(): string {
    return this.lastError;
  }

  // ── HeadsetControl confirmed writes ──────────────────────────────────────

  public setSidetone(level: 0 | 1 | 2 | 3): boolean {
    return this.write([REPORT_ID, 0x39, level]);
  }

  public setOledBrightness(strength: number): boolean {
    const clamped = Math.max(1, Math.min(10, Math.round(strength)));
    return this.write([REPORT_ID, 0xBF, clamped]);
  }

  public setIdleTimeout(levelIndex: IdleTimeoutLevel): boolean {
    return this.write([REPORT_ID, 0xC1, levelIndex]);
  }

  public setEqPreset(preset: 0 | 1 | 2 | 3 | 4): boolean {
    return this.write([REPORT_ID, 0x2E, preset]);
  }

  public setEqBands(gains: number[]): boolean {
    if (gains.length !== 10) {
      this.lastError = "EQ requires exactly 10 band values";
      return false;
    }
    // Formula: byte = 0x14 + (2 * gain_dB), gain clamped to ±10
    const bandBytes = gains.map((g) => {
      const clamped = Math.max(-10, Math.min(10, g));
      return Math.round(0x14 + 2 * clamped);
    });
    // Must select custom preset (4) first
    if (!this.setEqPreset(4)) {
      return false;
    }
    return this.write([REPORT_ID, 0x33, ...bandBytes]);
  }

  public saveToFlash(): boolean {
    return this.write([REPORT_ID, 0x09]);
  }

  public queryBattery(): number[] | null {
    // Returns raw response or null on failure
    return this.writeAndRead([REPORT_ID, 0xB0]);
  }

  // ── Nova Pro specific (fill in opcode after Phase 6 confirms) ────────────

  public setAncMode(mode: AncMode): boolean {
    return this.write([REPORT_ID, 0xBD, ANC_MODE_BYTES[mode]]);
  }

  public setMicMute(muted: boolean): boolean {
    // Only call this if Phase 6 confirmed 0xBB is a writable command.
    // If mic mute is physical-only, this method is a no-op.
    return this.write([REPORT_ID, 0xBB, muted ? 1 : 0]);
  }

  public setUsbInput(input: 1 | 2): boolean {
    // Replace 0xC0 with the opcode confirmed by Wireshark Phase 4.
    return this.write([REPORT_ID, 0xC0, input]);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private write(payload: number[]): boolean {
    if (!this.device) {
      this.openControlInterface();
      if (!this.device) {
        this.lastError = "Control interface not open";
        return false;
      }
    }
    const pkt = this.makePacket(payload);
    try {
      this.device.write(pkt);
      this.lastError = "";
      return true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.closeDevice();
      return false;
    }
  }

  private writeAndRead(payload: number[]): number[] | null {
    if (!this.write(payload)) {
      return null;
    }
    // For a proper synchronous read, the caller should use probe-read.py approach.
    // Implement if the battery query needs to be polled on-demand.
    return null;
  }

  private makePacket(payload: number[]): number[] {
    const pkt = new Array(PACKET_SIZE).fill(0);
    payload.forEach((b, i) => { if (i < PACKET_SIZE) pkt[i] = b; });
    return pkt;
  }

  private openControlInterface(): void {
    if (!this.hid) {
      return;
    }
    try {
      const all = this.hid.devices();
      const candidate = all.find(
        (d) =>
          d.vendorId === STEELSERIES_VID &&
          NOVA_PRO_PIDS.has(Number(d.productId)) &&
          d.interface === CONTROL_INTERFACE &&
          typeof d.path === "string",
      );
      if (!candidate?.path) {
        this.lastError = `No Nova Pro on Interface ${CONTROL_INTERFACE}`;
        return;
      }
      this.device = new this.hid.HID(candidate.path);
      this.lastError = "";
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.device = null;
    }
  }

  private closeDevice(): void {
    try {
      this.device?.close();
    } catch {
      // ignore
    }
    this.device = null;
  }

  private tryLoadHid(): HidModule | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require("node-hid") as HidModule;
    } catch {
      return null;
    }
  }
}
```

### Step 9.2 — Add IPC channels to `src\shared\ipc.ts`

In `IPC_INVOKE`, add after `HID_GET_INFO`:

```typescript
HID_SET_SIDETONE:       "hid:set-sidetone",
HID_SET_OLED:           "hid:set-oled-brightness",
HID_SET_IDLE_TIMEOUT:   "hid:set-idle-timeout",
HID_SET_EQ_PRESET:      "hid:set-eq-preset",
HID_SET_EQ_BANDS:       "hid:set-eq-bands",
HID_SET_ANC_MODE:       "hid:set-anc-mode",
HID_SET_MIC_MUTE:       "hid:set-mic-mute",      // only if Phase 6 confirmed writable
HID_SET_USB_INPUT:      "hid:set-usb-input",
```

Add response type to `IpcInvokeMap` after the `HID_GET_INFO` entry:

```typescript
[IPC_INVOKE.HID_SET_SIDETONE]:     { params: [{ level: number }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_OLED]:         { params: [{ strength: number }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_IDLE_TIMEOUT]: { params: [{ levelIndex: number }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_EQ_PRESET]:    { params: [{ preset: number }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_EQ_BANDS]:     { params: [{ gains: number[] }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_ANC_MODE]:     { params: [{ mode: "off" | "transparency" | "anc" }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_MIC_MUTE]:     { params: [{ muted: boolean }]; result: BooleanOkResponse };
[IPC_INVOKE.HID_SET_USB_INPUT]:    { params: [{ input: 1 | 2 }]; result: BooleanOkResponse };
```

Add to `ArctisBridgeApi` interface:

```typescript
hidSetSidetone(level: number): Promise<BooleanOkResponse>;
hidSetOledBrightness(strength: number): Promise<BooleanOkResponse>;
hidSetIdleTimeout(levelIndex: number): Promise<BooleanOkResponse>;
hidSetEqPreset(preset: number): Promise<BooleanOkResponse>;
hidSetEqBands(gains: number[]): Promise<BooleanOkResponse>;
hidSetAncMode(mode: "off" | "transparency" | "anc"): Promise<BooleanOkResponse>;
hidSetMicMute(muted: boolean): Promise<BooleanOkResponse>;
hidSetUsbInput(input: 1 | 2): Promise<BooleanOkResponse>;
```

### Step 9.3 — Register handlers in `src\main\ipc\registerCoreHandlers.ts`

Add to `RegisterCoreIpcHandlersDeps`:

```typescript
hidSetSidetone: (payload: { level: number }) => BooleanOkResponse;
hidSetOledBrightness: (payload: { strength: number }) => BooleanOkResponse;
hidSetIdleTimeout: (payload: { levelIndex: number }) => BooleanOkResponse;
hidSetEqPreset: (payload: { preset: number }) => BooleanOkResponse;
hidSetEqBands: (payload: { gains: number[] }) => BooleanOkResponse;
hidSetAncMode: (payload: { mode: string }) => BooleanOkResponse;
hidSetMicMute: (payload: { muted: boolean }) => BooleanOkResponse;
hidSetUsbInput: (payload: { input: number }) => BooleanOkResponse;
```

Add to `registerCoreIpcHandlers` body (after the `HID_GET_INFO` handler):

```typescript
ipcMain.handle(IPC_INVOKE.HID_SET_SIDETONE,
  (_e, p: { level: number }) => deps.hidSetSidetone(p));
ipcMain.handle(IPC_INVOKE.HID_SET_OLED,
  (_e, p: { strength: number }) => deps.hidSetOledBrightness(p));
ipcMain.handle(IPC_INVOKE.HID_SET_IDLE_TIMEOUT,
  (_e, p: { levelIndex: number }) => deps.hidSetIdleTimeout(p));
ipcMain.handle(IPC_INVOKE.HID_SET_EQ_PRESET,
  (_e, p: { preset: number }) => deps.hidSetEqPreset(p));
ipcMain.handle(IPC_INVOKE.HID_SET_EQ_BANDS,
  (_e, p: { gains: number[] }) => deps.hidSetEqBands(p));
ipcMain.handle(IPC_INVOKE.HID_SET_ANC_MODE,
  (_e, p: { mode: string }) => deps.hidSetAncMode(p));
ipcMain.handle(IPC_INVOKE.HID_SET_MIC_MUTE,
  (_e, p: { muted: boolean }) => deps.hidSetMicMute(p));
ipcMain.handle(IPC_INVOKE.HID_SET_USB_INPUT,
  (_e, p: { input: number }) => deps.hidSetUsbInput(p));
```

### Step 9.4 — Expose in `src\preload\index.ts`

Following the same pattern as `getHidInfo`, add to the `contextBridge.exposeInMainWorld` object:

```typescript
hidSetSidetone:     (level: number) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_SIDETONE, { level }),
hidSetOledBrightness: (strength: number) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_OLED, { strength }),
hidSetIdleTimeout:  (levelIndex: number) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_IDLE_TIMEOUT, { levelIndex }),
hidSetEqPreset:     (preset: number) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_EQ_PRESET, { preset }),
hidSetEqBands:      (gains: number[]) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_EQ_BANDS, { gains }),
hidSetAncMode:      (mode: "off" | "transparency" | "anc") =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_ANC_MODE, { mode }),
hidSetMicMute:      (muted: boolean) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_MIC_MUTE, { muted }),
hidSetUsbInput:     (input: 1 | 2) =>
  ipcRenderer.invoke(IPC_INVOKE.HID_SET_USB_INPUT, { input }),
```

### Step 9.5 — Wire `HidWriterService` into `src\main\index.ts`

In `src\main\index.ts`, alongside the existing `ArctisApiService`:

```typescript
import { HidWriterService } from "./services/apis/arctis/hidWriter.js";

// Instantiate (alongside ArctisApiService):
const hidWriter = new HidWriterService();

// Start when app is ready (alongside other services):
hidWriter.start();

// Stop when app quits:
app.on("before-quit", () => {
  hidWriter.stop();
});

// Pass to registerCoreIpcHandlers as deps:
hidSetSidetone: ({ level }) => {
  const ok = hidWriter.setSidetone(level as 0 | 1 | 2 | 3);
  if (ok) void arctisService.refreshNow();
  return { ok };
},
hidSetOledBrightness: ({ strength }) => {
  const ok = hidWriter.setOledBrightness(strength);
  if (ok) void arctisService.refreshNow();
  return { ok };
},
hidSetIdleTimeout: ({ levelIndex }) => {
  const ok = hidWriter.setIdleTimeout(levelIndex as IdleTimeoutLevel);
  return { ok };
},
hidSetEqPreset: ({ preset }) => {
  const ok = hidWriter.setEqPreset(preset as 0 | 1 | 2 | 3 | 4);
  if (ok) void arctisService.refreshNow();
  return { ok };
},
hidSetEqBands: ({ gains }) => {
  const ok = hidWriter.setEqBands(gains);
  if (ok) { hidWriter.saveToFlash(); void arctisService.refreshNow(); }
  return { ok };
},
hidSetAncMode: ({ mode }) => {
  const ok = hidWriter.setAncMode(mode as AncMode);
  if (ok) void arctisService.refreshNow();
  return { ok };
},
hidSetMicMute: ({ muted }) => {
  const ok = hidWriter.setMicMute(muted);
  if (ok) void arctisService.refreshNow();
  return { ok };
},
hidSetUsbInput: ({ input }) => {
  const ok = hidWriter.setUsbInput(input as 1 | 2);
  if (ok) void arctisService.refreshNow();
  return { ok };
},
```

### Step 9.6 — Add ChatMix push event to `baseStationEvents.ts`

ChatMix has no write command — it is read-only from HID. Add its push event
decoding based on the opcode discovered in Phase 2. The opcode is currently
unknown; once Phase 2 reveals it (e.g. `0x45`), add to `parseEvent()`:

```typescript
// In parseEvent(), after the 0xBB block:
if (command === 0x45) {  // replace 0x45 with the actual opcode from listen.py
  // byte[2] = game volume position (0–100), byte[3] = chat volume position (0–100)
  // Convert to chat_mix_balance: 0 = full game, 100 = full chat
  const gameVol = Number(data[2] ?? 50);
  const chatVol = Number(data[3] ?? 50);
  const total = gameVol + chatVol;
  const balance = total > 0 ? Math.round((chatVol / total) * 100) : 50;
  return { chat_mix_balance: balance };
}
```

This allows `AppState.chat_mix_balance` to update immediately when the user
rotates the physical ChatMix dial, without waiting for the 2-second Sonar poll.

### Step 9.7 — Run typecheck to verify all wiring

```powershell
cd "C:\Users\ffvd\Documents\arctis_centre\src\Apps\control-centre-full-app"
npm run typecheck
```

Fix any type errors before testing. Common issues:
- Missing `IdleTimeoutLevel` import — add to the import line in `index.ts`
- `hidSetAncMode` string vs union — add a cast or narrow at the call site
- `ArctisBridgeApi` missing new methods — ensure Step 9.2's additions are complete

---

## Nova Pro-Specific Feature Decision Summary

### ANC Mode

| Step | Action |
|------|--------|
| Phase 3 | Toggle ANC in GG Engine and via physical button while capturing |
| Phase 4 | Find `06 BD` or alternate opcode in `wireshark-commands.json` |
| Phase 6 | Run `python probe-write.py --group anc_mode`, observe `[anc_mode]` in listen.py |
| Phase 9 | `hidWriter.setAncMode()` uses `0xBD` — update opcode if Phase 4 found a different one |

### USB Input Switch

| Step | Action |
|------|--------|
| Phase 2 | Switch PC Port in GG Engine while `listen.py` runs — does device push an event? |
| Phase 3 | Switch PC Port while Wireshark captures — find the OUT opcode |
| Phase 4 | Identify opcode from the `06 ?? 01` / `06 ?? 02` OUT packets |
| Phase 6 | Update `probe-write.py` usb_input group with confirmed opcode, then test |
| Phase 9 | Update `setUsbInput()` opcode to the confirmed value |

### Mic Mute Write

| Step | Action |
|------|--------|
| Phase 2 | Physically mute/unmute while `listen.py` runs — confirms `0xBB` push event format |
| Phase 3 | Physically press mute while Wireshark runs — check for OUT packets after IN event |
| Phase 4 | If no OUT packets follow the `0xBB` IN event → mic mute is **hardware-only**, skip write |
| Phase 6 | Only test `python probe-write.py --group mic_mute` if Phase 4 found OUT packets |
| Phase 9 | If hardware-only: remove `hidSetMicMute()` from the service and IPC channels |

### ChatMix

| Step | Action |
|------|--------|
| Phase 2 | Rotate ChatMix dial while `listen.py` runs — find push event opcode (e.g. `0x45`) |
| Phase 3 | Rotate dial during capture — confirm no OUT packets (read-only from HID) |
| Phase 4 | Verify only IN packets appear — no write command needed |
| Phase 6 | No write test needed |
| Phase 9 | Add push event decoder to `baseStationEvents.ts` (Step 9.6) with discovered opcode |
| Notes | `chat_mix_balance` already read from Sonar HTTP — HID event allows faster updates |

---

## Decision Tree — When Commands Are Silent on Windows 11

```
Write sent → no push event in listen.py
│
├─ Is GG Engine still running?
│   Run: Get-Process -Name "SteelSeriesGGClient"
│   If yes: Stop-Process -Name "SteelSeriesGGClient" -Force
│
├─ Is the correct interface open?
│   Check probe-read.py — did Interface 3 respond to 0xB0?
│   If no: try --if 4
│
├─ Does Wireshark show the correct opcode?
│   Open wireshark-commands.json and compare byte[1] against what probe-write sends
│
├─ Is the packet size wrong?
│   Try padding to exactly 31 bytes (PACKET_SIZE = 31 in probe-write.py)
│
├─ Is byte[0] correct?
│   Should be 0x06. If Wireshark shows a different first byte, update probe-write.py
│
├─ Windows HID exclusive access
│   Some interfaces lock under Windows — try the other interface number
│   Check Device Manager for a "SteelSeries HID" device that has a yellow warning
│
└─ Feature is Sonar HTTP only (not HID)
    Examples: Sonar mixer volumes, preset selection, chatmix write
```

---

## Quick Reference — All Commands

```powershell
# ── Setup (once) ──────────────────────────────────────────────────────────────
cd scripts\hid-research
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# ── Phase 1: Enumerate ────────────────────────────────────────────────────────
python enumerate.py

# ── Phase 2: Listen (keep running, do all headset actions) ───────────────────
python listen.py

# ── Phase 3: Wireshark capture (Admin PowerShell, GG Engine OPEN) ────────────
.\capture-usb.ps1 -Interface "\\.\USBPcap2" -Duration 180

# ── Phase 4: Parse capture ───────────────────────────────────────────────────
python parse-wireshark.py --pcap capture-*.pcapng --events listen-log-*.json

# ── Phase 5: Read prober (GG Engine CLOSED) ──────────────────────────────────
Stop-Process -Name "SteelSeriesGGClient" -Force -ErrorAction SilentlyContinue
python probe-read.py --if 3

# ── Phase 6: Write tests (GG Engine CLOSED, listen.py open in Window A) ──────
python probe-write.py --group sidetone
python probe-write.py --group oled_brightness
python probe-write.py --group idle_timeout
python probe-write.py --group anc_mode
python probe-write.py --group usb_input
python probe-write.py --group mic_mute

# ── Phase 7: Build map ────────────────────────────────────────────────────────
python build-map.py --listen listen-log-*.json --read probe-read-results.json `
  --write probe-write-results.json --wireshark wireshark-commands.json

# ── Phase 8: Integration validate (GG Engine CLOSED, project root) ───────────
cd ..\..\..\..\..
npx electron scripts\hid-research\validate.cjs

# ── Phase 9: Typecheck after implementation ──────────────────────────────────
npm run typecheck
npm run dev   # smoke test
```

---

## Confidence Reference

| Feature | Write opcode | Source | Confidence |
|---------|-------------|--------|-----------|
| Sidetone | `0x39` | HeadsetControl ✓ | **Very High** |
| OLED brightness | `0xBF` | HeadsetControl ✓ | **Very High** |
| Idle timeout | `0xC1` | HeadsetControl ✓ | **Very High** |
| EQ preset select | `0x2E` | HeadsetControl ✓ | **Very High** |
| EQ bands write | `0x33` | HeadsetControl ✓ | **Very High** |
| Save to flash | `0x09` | HeadsetControl ✓ | **Very High** |
| Battery query | `0xB0` (read) | HeadsetControl ✓ | **Very High** |
| ANC mode | `0xBD` | Push event inference | Medium — confirm Phase 3/4 |
| Mic mute write | `0xBB` | Push event inference | Low — may be physical-only |
| USB input switch | `0xC0` (candidate) | Unknown — Phase 3/4 required | Low |
| ChatMix write | N/A — read-only HID | Sonar HTTP for write | N/A |
| ChatMix push event | Unknown opcode | Phase 2 listen.py | Capturable |

#!/usr/bin/env python3
"""
Arctis Nova Pro Wireless — Interactive HID Discovery Wizard
===========================================================
Single script that guides you through every hardware and GG Engine interaction,
captures all HID push events in real-time, tests write commands, and saves a
complete discovery log.

Usage (from project root, inside .venv):
    python scripts/hid-research/discover.py

Requirements:
    pip install hidapi colorama
    GG Engine CLOSED for write sessions (open for GG Engine capture sessions)
"""

import hid
import time
import threading
import queue
import json
import sys
import os
from datetime import datetime
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

try:
    from colorama import init as colorama_init, Fore, Style, Back
    colorama_init()
    _HAS_COLOR = True
except ImportError:
    _HAS_COLOR = False

# ── Colour helpers ─────────────────────────────────────────────────────────────

class C:
    if _HAS_COLOR:
        RED     = Fore.RED
        GREEN   = Fore.GREEN
        YELLOW  = Fore.YELLOW
        BLUE    = Fore.BLUE
        MAGENTA = Fore.MAGENTA
        CYAN    = Fore.CYAN
        WHITE   = Fore.WHITE
        BOLD    = Style.BRIGHT
        DIM     = Style.DIM
        RESET   = Style.RESET_ALL
    else:
        RED = GREEN = YELLOW = BLUE = MAGENTA = CYAN = WHITE = ""
        BOLD = DIM = RESET = ""

def _print_header(title: str, width: int = 72):
    bar = "═" * width
    print(f"\n{C.BOLD}{C.CYAN}{bar}{C.RESET}")
    pad = " " * max(0, (width - len(title) - 2) // 2)
    print(f"{C.BOLD}{C.CYAN}  {title}{C.RESET}")
    print(f"{C.BOLD}{C.CYAN}{bar}{C.RESET}\n")

def _sub(text: str):
    print(f"\n{C.BOLD}{C.BLUE}── {text}{C.RESET}")

def _ok(text: str):
    print(f"{C.GREEN}  ✓  {text}{C.RESET}")

def _warn(text: str):
    print(f"{C.YELLOW}  ⚠  {text}{C.RESET}")

def _err(text: str):
    print(f"{C.RED}  ✗  {text}{C.RESET}")

def _info(text: str):
    print(f"{C.DIM}     {text}{C.RESET}")

def _instruction(text: str):
    print(f"\n{C.BOLD}{C.YELLOW}  ▶  {text}{C.RESET}")

def _clr():
    os.system("cls" if os.name == "nt" else "clear")

# ── Device constants ───────────────────────────────────────────────────────────

VID = 0x1038
NOVA_PRO_PIDS: set[int] = {0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D}
PACKET_SIZE   = 64
POLL_TIMEOUT  = 80   # ms per read call in background thread
PUSH_WINDOW   = 700  # ms to drain after a write command

# ── Known events (mirrors baseStationEvents.ts) ────────────────────────────────

KNOWN_PUSH: dict[int, str] = {
    0x25: "headset_volume",
    0xB5: "connection_state",
    0xB7: "battery_levels",
    0x85: "oled_brightness",
    0x39: "sidetone_level",
    0xBD: "anc_mode",
    0xBB: "mic_mute",
}

KNOWN_WRITE: dict[int, str] = {
    0x39: "sidetone       [HeadsetControl ✓]",
    0xBF: "oled_brightness[HeadsetControl ✓]",
    0xC1: "idle_timeout   [HeadsetControl ✓]",
    0x2E: "eq_preset      [HeadsetControl ✓]",
    0x33: "eq_bands       [HeadsetControl ✓]",
    0x09: "save_to_flash  [HeadsetControl ✓]",
    0xB0: "battery_query  [HeadsetControl ✓]",
    0xBD: "anc_mode       [candidate]",
    0xBB: "mic_mute       [candidate]",
    0x37: "mic_volume     [candidate]",
    0xC0: "usb_input      [candidate]",
    0xC2: "wireless_mode  [candidate]",
}

# ── Event decoding ─────────────────────────────────────────────────────────────

def _decode_detail(data: list[int]) -> str:
    """Return a human-readable detail string for a known push event."""
    if len(data) < 2:
        return ""
    cmd = data[1]
    d = lambda i, default=0: data[i] if len(data) > i else default

    if cmd == 0x25:  # headset_volume
        level = d(2)
        pct = round(level / 0x38 * 100)
        return f"level=0x{level:02X} ({pct}%)"

    if cmd == 0xB7:  # battery_levels
        hs_level  = d(2)
        hs_status = d(3)
        bs_level  = d(6)
        charge_map = {0: "discharging", 1: "charging", 2: "full"}
        hs_charge = charge_map.get(hs_status, f"status={hs_status}")
        return (f"headset={hs_level}/8 [{hs_charge}]  "
                f"base={bs_level}/8")

    if cmd == 0xBD:  # anc_mode
        mode = d(2)
        names = {0: "OFF", 1: "TRANSPARENCY", 2: "ANC"}
        return f"mode={mode} ({names.get(mode, '?')})"

    if cmd == 0xBB:  # mic_mute
        muted = d(2)
        return f"muted={'YES' if muted else 'NO'} (raw={muted})"

    if cmd == 0x39:  # sidetone
        level = d(2)
        names = {0: "OFF", 1: "LOW", 2: "MID", 3: "HIGH"}
        return f"level={level} ({names.get(level, '?')})"

    if cmd == 0x85:  # oled_brightness
        return f"strength={d(2)} (1–10)"

    if cmd == 0xB5:  # connection_state
        state = d(2)
        names = {0: "disconnected", 1: "connected", 2: "pairing"}
        return f"state={state} ({names.get(state, '?')})"

    return ""


def _hex(data: list[int], n: int = 16) -> str:
    return " ".join(f"{b:02X}" for b in data[:n]) + (" …" if len(data) > n else "")


def _is_push(data: list[int]) -> bool:
    return (len(data) >= 2
            and data[0] in (0x06, 0x07)
            and any(b != 0 for b in data[1:]))


# ── HidEvent ───────────────────────────────────────────────────────────────────

@dataclass
class HidEvent:
    ts:         float
    session:    str
    iface:      int
    raw:        list[int]
    known_name: Optional[str]
    detail:     str

    def display(self, prefix: str = "  "):
        ts_str = datetime.fromtimestamp(self.ts).strftime("%H:%M:%S.%f")[:-3]
        hex_s  = _hex(self.raw, 14)
        cmd    = f"0x{self.raw[1]:02X}" if len(self.raw) > 1 else "??"
        if self.known_name:
            name_s   = f"{C.GREEN}{self.known_name:<20}{C.RESET}"
            detail_s = f"{C.DIM}{self.detail}{C.RESET}" if self.detail else ""
            print(f"{prefix}{C.DIM}[{ts_str}]{C.RESET} {C.CYAN}IF{self.iface}{C.RESET}  "
                  f"[{hex_s}]  {name_s}  {detail_s}")
        else:
            print(f"{prefix}{C.DIM}[{ts_str}]{C.RESET} {C.CYAN}IF{self.iface}{C.RESET}  "
                  f"[{hex_s}]  {C.YELLOW}UNKNOWN cmd={cmd}{C.RESET}")

    def as_dict(self) -> dict:
        return {
            "ts":         self.ts,
            "session":    self.session,
            "iface":      self.iface,
            "hex":        _hex(self.raw, 32),
            "raw":        self.raw[:32],
            "known_name": self.known_name,
            "detail":     self.detail,
        }


# ── DeviceManager ──────────────────────────────────────────────────────────────

class DeviceManager:
    """Opens all Nova Pro HID interfaces and runs a background reader."""

    def __init__(self):
        self.devices:    dict[int, hid.Device] = {}  # iface_num -> device
        self.ev_queue:   queue.Queue[HidEvent]  = queue.Queue()
        self._stop:      threading.Event        = threading.Event()
        self._session:   list[str]              = ["idle"]

    # -- device lifecycle ------------------------------------------------------

    def open(self) -> list[int]:
        all_info = hid.enumerate(VID, 0)
        candidates = [d for d in all_info if d["product_id"] in NOVA_PRO_PIDS]
        if not candidates:
            raise RuntimeError("No Arctis Nova Pro interfaces found — plug in the dongle.")
        opened: list[int] = []
        for info in sorted(candidates, key=lambda d: d.get("interface_number", 0)):
            iface = info.get("interface_number", len(self.devices))
            try:
                dev = hid.Device(path=info["path"])
                self.devices[iface] = dev
                opened.append(iface)
            except Exception as ex:
                _warn(f"Cannot open IF{iface}: {ex}")
        if not self.devices:
            raise RuntimeError(
                "Could not open any interface — is SteelSeries GG Engine running?\n"
                "     Close GG Engine and try again (for write tests).\n"
                "     For passive listen sessions it is OK for GG Engine to be open."
            )
        return opened

    def start_reader(self) -> None:
        self._stop.clear()
        for iface, dev in self.devices.items():
            t = threading.Thread(
                target=self._reader_loop, args=(iface, dev), daemon=True
            )
            t.start()

    def _reader_loop(self, iface: int, dev: hid.Device) -> None:
        while not self._stop.is_set():
            try:
                data = dev.read(PACKET_SIZE, timeout_ms=POLL_TIMEOUT)
                if data and _is_push(list(data)):
                    d = list(data)
                    cmd = d[1]
                    name = KNOWN_PUSH.get(cmd)
                    evt = HidEvent(
                        ts         = time.time(),
                        session    = self._session[0],
                        iface      = iface,
                        raw        = d,
                        known_name = name,
                        detail     = _decode_detail(d) if name else "",
                    )
                    self.ev_queue.put(evt)
            except Exception:
                time.sleep(0.05)

    def close(self) -> None:
        self._stop.set()
        for dev in self.devices.values():
            try:
                dev.close()
            except Exception:
                pass

    # -- write -----------------------------------------------------------------

    def write(self, packet: list[int]) -> bool:
        for dev in self.devices.values():
            try:
                dev.write(bytes(packet))
                return True
            except Exception:
                continue
        return False

    # -- queue helpers ---------------------------------------------------------

    def flush(self) -> None:
        while not self.ev_queue.empty():
            try:
                self.ev_queue.get_nowait()
            except queue.Empty:
                break

    def drain(self, window_ms: int) -> list[HidEvent]:
        events: list[HidEvent] = []
        deadline = time.time() + window_ms / 1000
        while time.time() < deadline:
            try:
                events.append(self.ev_queue.get(timeout=0.05))
            except queue.Empty:
                pass
        return events

    def set_session(self, name: str) -> None:
        self._session[0] = name
        self.flush()


# ── Packet builder ─────────────────────────────────────────────────────────────

def make_packet(b0: int, b1: int, extra: list[int] | None = None) -> list[int]:
    pkt = [0] * PACKET_SIZE
    pkt[0] = b0
    pkt[1] = b1
    if extra:
        for i, v in enumerate(extra):
            if 2 + i < PACKET_SIZE:
                pkt[2 + i] = v
    return pkt


# ── Discovery orchestrator ─────────────────────────────────────────────────────

class Discovery:
    def __init__(self, dm: DeviceManager):
        self.dm            = dm
        self.all_events:   list[HidEvent] = []
        self.results:      dict[str, list[dict]] = defaultdict(list)
        self._result_file  = (
            f"discovery-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        )

    # -- live capture ----------------------------------------------------------

    def _live_capture(self, session: str, prompt: str, window_s: float | None = None) -> list[HidEvent]:
        """
        Collect events in real-time.
        If window_s is given: auto-stop after that many seconds.
        Otherwise: wait for user to press Enter.
        """
        self.dm.set_session(session)
        captured: list[HidEvent] = []
        stop_evt = threading.Event()

        def _display():
            while not stop_evt.is_set():
                try:
                    evt = self.dm.ev_queue.get(timeout=0.1)
                    captured.append(evt)
                    self.all_events.append(evt)
                    evt.display(prefix="     ")
                except queue.Empty:
                    pass

        t = threading.Thread(target=_display, daemon=True)
        t.start()

        if window_s is not None:
            print(f"{C.DIM}     (auto-capturing for {window_s:.0f} s…){C.RESET}", flush=True)
            time.sleep(window_s)
        else:
            input(f"\n{C.BOLD}     {prompt} — press [Enter] when done…{C.RESET}")

        stop_evt.set()
        t.join(timeout=0.5)
        return captured

    # -- session runners -------------------------------------------------------

    def run_read_session(self, key: str, sess: dict) -> None:
        _print_header(sess["name"])
        for tip in sess.get("tips", []):
            _info(tip)
        _instruction(sess["instructions"])
        print(f"\n{C.DIM}     ← live HID events appear here →{C.RESET}\n")

        evts = self._live_capture(key, "Interact with the hardware now")

        self._finish_session(key, evts)

    def run_write_session(self, key: str, sess: dict) -> None:
        _print_header(sess["name"])
        _info(sess["description"])
        _warn("GG Engine must be CLOSED for write commands to succeed.")
        print()

        all_evts: list[HidEvent] = []

        for var in sess["variants"]:
            label  = var["label"]
            pkt_def = var["packet"]
            extra  = pkt_def[2:] if len(pkt_def) > 2 else []
            pkt    = make_packet(pkt_def[0], pkt_def[1], extra)

            print(f"\n{C.BOLD}     → {label}{C.RESET}")
            print(f"       {C.DIM}[{_hex(pkt_def)}]{C.RESET}")

            self.dm.set_session(f"{key}:{label}")
            sent = self.dm.write(pkt)

            if not sent:
                _err("Write failed on all interfaces.")
                continue
            _ok("Sent")

            evts = self.dm.drain(PUSH_WINDOW)
            if evts:
                for e in evts:
                    e.display(prefix="     ← ")
                all_evts.extend(evts)
                self.all_events.extend(evts)
            else:
                print(f"       {C.DIM}← (no push response){C.RESET}")

            time.sleep(0.3)

        self._finish_session(key, all_evts)

    def run_gg_session(self, key: str, sess: dict) -> None:
        _print_header(f"GG Engine: {sess['name']}")
        _info("Open GG Engine now. Follow each step then press [Enter].")
        print()

        all_evts: list[HidEvent] = []

        for step in sess["steps"]:
            _instruction(step["instruction"])
            if step.get("detail"):
                _info(step["detail"])
            print(f"\n{C.DIM}     ← live HID events appear here →{C.RESET}\n")

            evts = self._live_capture(
                f"{key}:{step['id']}", "Make the change in GG Engine"
            )
            if evts:
                _ok(f"{len(evts)} event(s) captured")
            else:
                _warn("No events captured")
            all_evts.extend(evts)
            print()

        self._finish_session(f"gg:{key}", all_evts)

    def run_scan(self) -> None:
        """Sweep byte2 across a range for a given command byte to find responses."""
        _print_header("Write Scan — sweep byte2 over a range")
        _warn("GG Engine must be CLOSED.")
        print()

        try:
            raw_b0  = input(f"  byte0 (hex, default 06): ").strip() or "06"
            raw_b1  = input(f"  byte1 / cmd byte (hex):  ").strip()
            raw_lo  = input(f"  byte2 start (hex, default 00): ").strip() or "00"
            raw_hi  = input(f"  byte2 end   (hex, default 0F): ").strip() or "0F"
            name    = input(f"  Label for this scan (e.g. usb_input): ").strip() or "scan"
            b0  = int(raw_b0, 16)
            b1  = int(raw_b1, 16)
            lo  = int(raw_lo, 16)
            hi  = int(raw_hi, 16)
        except (ValueError, KeyboardInterrupt):
            _warn("Cancelled.")
            input(f"\n  Press [Enter] to continue…")
            return

        print(f"\n  Scanning [0x{b0:02X}, 0x{b1:02X}, 0x{lo:02X}…0x{hi:02X}]\n")

        findings: list[dict] = []
        try:
            for val in range(lo, hi + 1):
                pkt = make_packet(b0, b1, [val])
                self.dm.set_session(f"scan:{name}:0x{val:02X}")
                print(f"  → [0x{b0:02X} 0x{b1:02X} 0x{val:02X}] … ", end="", flush=True)
                self.dm.write(pkt)
                evts = self.dm.drain(450)
                if evts:
                    print(f"{C.GREEN}{len(evts)} event(s){C.RESET}")
                    for e in evts:
                        e.display(prefix="      ← ")
                        self.all_events.append(e)
                    findings.append({"val": val, "events": [e.as_dict() for e in evts]})
                else:
                    print(f"{C.DIM}(no response){C.RESET}")
                time.sleep(0.15)
        except KeyboardInterrupt:
            print("\n  Stopped early.")

        if findings:
            _ok(f"{len(findings)} value(s) produced responses")
            self.results[f"scan:{name}"].extend(findings)
        else:
            _warn("No responses detected — check that GG Engine is closed.")

        self._save()
        input(f"\n  Press [Enter] to continue…")

    def run_custom(self) -> None:
        """Interactive custom packet sender."""
        _print_header("Custom Packet Builder")
        _info("Enter bytes as space-separated hex (e.g. 06 39 01).")
        _info("Type 'q' to return to menu.")
        _warn("GG Engine must be CLOSED for writes to succeed.")
        print()

        while True:
            try:
                raw = input(f"  {C.BOLD}bytes> {C.RESET}").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if raw.lower() in ("q", "quit", "exit"):
                break
            if not raw:
                continue
            try:
                parts = [int(b, 16) for b in raw.split()]
            except ValueError as ex:
                _err(f"Invalid hex: {ex}")
                continue
            if len(parts) < 2:
                _warn("Need at least 2 bytes (byte0 + cmd).")
                continue

            pkt = make_packet(parts[0], parts[1], parts[2:])
            print(f"  → [{_hex(parts)}]")

            self.dm.set_session(f"custom:{raw}")
            if self.dm.write(pkt):
                _ok("Sent")
                evts = self.dm.drain(PUSH_WINDOW)
                if evts:
                    for e in evts:
                        e.display(prefix="  ← ")
                        self.all_events.append(e)
                        self.results["custom"].append(e.as_dict())
                else:
                    print(f"  {C.DIM}← (no response){C.RESET}")
            else:
                _err("Write failed on all interfaces.")

        self._save()

    # -- helpers ---------------------------------------------------------------

    def _finish_session(self, key: str, evts: list[HidEvent]) -> None:
        if evts:
            _ok(f"{len(evts)} event(s) captured in this session.")
            # Highlight any unknown commands
            unknown = [e for e in evts if not e.known_name]
            if unknown:
                cmds = {e.raw[1] for e in unknown if len(e.raw) > 1}
                _warn(f"NEW unknown cmd byte(s): {', '.join(f'0x{c:02X}' for c in cmds)}")
                _info("Add these to KNOWN_PUSH if confirmed.")
        else:
            _warn("No events captured.")

        self.results[key].extend(e.as_dict() for e in evts)
        self._save()
        input(f"\n  Press [Enter] to continue…")

    def _save(self) -> None:
        out = {
            "generated":    datetime.now().isoformat(),
            "total_events": len(self.all_events),
            "sessions":     {k: v for k, v in self.results.items()},
            "all_events":   [e.as_dict() for e in self.all_events],
        }
        with open(self._result_file, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)

    def show_summary(self) -> None:
        _print_header("Capture Summary")

        if not self.all_events:
            _warn("No events captured yet.")
            input(f"\n  Press [Enter] to continue…")
            return

        by_cmd: dict[int, list[HidEvent]] = defaultdict(list)
        for e in self.all_events:
            if len(e.raw) > 1:
                by_cmd[e.raw[1]].append(e)

        print(f"  {'CMD':<8}  {'NAME':<25}  {'COUNT':<7}  SESSIONS")
        print(f"  {'-'*68}")
        for cmd in sorted(by_cmd):
            evts  = by_cmd[cmd]
            name  = KNOWN_PUSH.get(cmd, "UNKNOWN ← investigate!")
            sessions = sorted({e.session for e in evts})[:4]
            sess_str = ", ".join(sessions)
            color = C.GREEN if cmd in KNOWN_PUSH else C.YELLOW
            print(f"  {color}0x{cmd:02X}{C.RESET}     {color}{name:<25}{C.RESET}  "
                  f"{len(evts):<7}  {sess_str}")

        unknown_cmds = [c for c in by_cmd if c not in KNOWN_PUSH]
        print(f"\n  {C.DIM}Total events : {len(self.all_events)}{C.RESET}")
        print(f"  {C.DIM}Known cmds   : {len(by_cmd) - len(unknown_cmds)}{C.RESET}")
        if unknown_cmds:
            print(f"  {C.YELLOW}Unknown cmds : {len(unknown_cmds)} → "
                  f"{', '.join(f'0x{c:02X}' for c in unknown_cmds)}{C.RESET}")
        print(f"\n  {C.DIM}Results saved to: {self._result_file}{C.RESET}")

        input(f"\n  Press [Enter] to continue…")


# ── Session catalogue ──────────────────────────────────────────────────────────

READ_SESSIONS: list[dict] = [
    # ── HEADSET ──────────────────────────────────────────────────────────────
    dict(
        key  = "headset:volume:read",
        name = "Headset / Volume — READ",
        instructions = "Rotate the volume wheel on the headset — up then back down slowly.",
        tips = [
            "Expected cmd: 0x25 (headset_volume)  level 0x00–0x38 (0–100%)",
        ],
    ),
    dict(
        key  = "headset:chatmix:read",
        name = "Headset / ChatMix — READ (UNKNOWN opcode)",
        instructions = "Rotate the ChatMix dial on the headset from one extreme to the other.",
        tips = [
            "Opcode UNKNOWN — this session discovers it.",
            "Expect a yellow UNKNOWN line with a new cmd byte.",
            "Note the cmd byte and any payload bytes for ChatMix balance.",
        ],
    ),
    dict(
        key  = "headset:micmute:read",
        name = "Headset / Mic Mute — READ",
        instructions = "Toggle the mic mute button twice: mute → unmute.",
        tips = [
            "Expected cmd: 0xBB (mic_mute)  data[2]=0 unmuted, 1 muted",
        ],
    ),
    dict(
        key  = "headset:anc:read",
        name = "Headset / ANC & Transparency — READ",
        instructions = "Press the ANC button on the headset to cycle through all 3 modes.",
        tips = [
            "Expected cmd: 0xBD (anc_mode)  data[2]: 0=off 1=transparency 2=ANC",
        ],
    ),
    dict(
        key  = "headset:battery:read",
        name = "Headset / Battery — READ",
        instructions = "Wait — a battery query will be sent automatically, then listen for 5 s.",
        tips = [
            "Expected cmd: 0xB7 (battery_levels)",
            "data[2]=headset level (0–8)  data[3]=charge status  data[6]=base station level",
        ],
    ),
    # ── BASE STATION ─────────────────────────────────────────────────────────
    dict(
        key  = "base:usb_input:read",
        name = "Base Station / USB Input — READ (UNKNOWN opcode)",
        instructions = (
            "Press the USB input select button on the BACK of the base station "
            "to toggle between PC Port 1 and Port 2."
        ),
        tips = [
            "Opcode UNKNOWN — this session discovers it.",
            "Also try: GG Engine → Headset → Base Station → PC Port.",
        ],
    ),
    dict(
        key  = "base:oled_brightness:read",
        name = "Base Station / OLED Brightness — READ",
        instructions = "In GG Engine → Headset → OLED, drag the brightness slider.",
        tips = [
            "Expected cmd: 0x85 (oled_brightness)  data[2]=strength 1–10",
        ],
    ),
    dict(
        key  = "base:anc:read",
        name = "Base Station / ANC (via GG Engine) — READ",
        instructions = (
            "In GG Engine → Headset → Noise Cancelling, click each mode: "
            "OFF → TRANSPARENCY → ANC."
        ),
        tips = [
            "Expected cmd: 0xBD (anc_mode)",
        ],
    ),
    dict(
        key  = "base:sidetone:read",
        name = "Base Station / Sidetone — READ",
        instructions = "In GG Engine → Headset → Sidetone, drag the slider from 0 to max.",
        tips = [
            "Expected cmd: 0x39 (sidetone_level)  level 0–3",
        ],
    ),
    dict(
        key  = "base:mic_volume:read",
        name = "Base Station / Mic Volume — READ (UNKNOWN opcode)",
        instructions = "In GG Engine → Headset → Microphone, drag the mic volume slider.",
        tips = [
            "Opcode UNKNOWN — candidate 0x37.",
            "Note cmd byte and payload range.",
        ],
    ),
    dict(
        key  = "base:wireless_mode:read",
        name = "Base Station / Wireless Mode — READ (UNKNOWN opcode)",
        instructions = "In GG Engine → Headset → Wireless, toggle between Speed and Range mode.",
        tips = [
            "Opcode UNKNOWN — candidate 0xC2.",
        ],
    ),
    dict(
        key  = "base:dual_battery:read",
        name = "Base Station / Dual Battery Detail — READ",
        instructions = "Let the headset sit connected for 10 s to receive a periodic battery push.",
        tips = [
            "Expected cmd: 0xB7  — check data[6] for base station battery level separately.",
        ],
    ),
]

WRITE_SESSIONS: list[dict] = [
    # ── HEADSET WRITES ────────────────────────────────────────────────────────
    dict(
        key  = "headset:micmute:write",
        name = "Headset / Mic Mute — WRITE",
        description = (
            "Candidate opcode 0xBB — same byte as push event. "
            "If successful, the mic LED should change."
        ),
        variants = [
            dict(label="Mute (0x01)",   packet=[0x06, 0xBB, 0x01]),
            dict(label="Unmute (0x00)", packet=[0x06, 0xBB, 0x00]),
        ],
    ),
    dict(
        key  = "headset:anc:write",
        name = "Headset / ANC Mode — WRITE",
        description = (
            "Candidate opcode 0xBD. Same byte as push event. "
            "Physical ANC button should reflect the change."
        ),
        variants = [
            dict(label="OFF (0x00)",          packet=[0x06, 0xBD, 0x00]),
            dict(label="Transparency (0x01)", packet=[0x06, 0xBD, 0x01]),
            dict(label="ANC (0x02)",          packet=[0x06, 0xBD, 0x02]),
            dict(label="Restore OFF",         packet=[0x06, 0xBD, 0x00]),
        ],
    ),
    dict(
        key  = "headset:battery_query:write",
        name = "Battery Query — WRITE [HeadsetControl confirmed]",
        description = "Send [0x06, 0xB0] → device replies with battery_levels push event.",
        variants = [
            dict(label="Battery query", packet=[0x06, 0xB0]),
        ],
    ),
    # ── BASE STATION WRITES ───────────────────────────────────────────────────
    dict(
        key  = "base:usb_input:write",
        name = "Base Station / USB Input — WRITE",
        description = (
            "Candidate opcode 0xC0. Run base:usb_input:read first to confirm opcode."
        ),
        variants = [
            dict(label="Port 1 (0xC0 candidate)", packet=[0x06, 0xC0, 0x01]),
            dict(label="Port 2 (0xC0 candidate)", packet=[0x06, 0xC0, 0x02]),
            dict(label="Port 1 (restore)",        packet=[0x06, 0xC0, 0x01]),
        ],
    ),
    dict(
        key  = "base:oled_brightness:write",
        name = "Base Station / OLED Brightness — WRITE [HeadsetControl confirmed]",
        description = "Opcode 0xBF, strength 1–10. GG Engine shows updated brightness.",
        variants = [
            dict(label="Brightness 1 (min)", packet=[0x06, 0xBF, 0x01]),
            dict(label="Brightness 5 (mid)", packet=[0x06, 0xBF, 0x05]),
            dict(label="Brightness 10 (max)",packet=[0x06, 0xBF, 0x0A]),
            dict(label="Restore to 5",       packet=[0x06, 0xBF, 0x05]),
        ],
    ),
    dict(
        key  = "base:anc:write",
        name = "Base Station / ANC Mode — WRITE",
        description = "Candidate opcode 0xBD. Same as push event cmd.",
        variants = [
            dict(label="OFF",          packet=[0x06, 0xBD, 0x00]),
            dict(label="Transparency", packet=[0x06, 0xBD, 0x01]),
            dict(label="ANC",          packet=[0x06, 0xBD, 0x02]),
            dict(label="Restore OFF",  packet=[0x06, 0xBD, 0x00]),
        ],
    ),
    dict(
        key  = "base:sidetone:write",
        name = "Base Station / Sidetone — WRITE [HeadsetControl confirmed]",
        description = "Opcode 0x39, level 0–3 (off / low / mid / high).",
        variants = [
            dict(label="OFF (0)",    packet=[0x06, 0x39, 0x00]),
            dict(label="LOW (1)",    packet=[0x06, 0x39, 0x01]),
            dict(label="MID (2)",    packet=[0x06, 0x39, 0x02]),
            dict(label="HIGH (3)",   packet=[0x06, 0x39, 0x03]),
            dict(label="Restore OFF",packet=[0x06, 0x39, 0x00]),
        ],
    ),
    dict(
        key  = "base:mic_volume:write",
        name = "Base Station / Mic Volume — WRITE",
        description = "Candidate opcode 0x37, level 0–7. Run base:mic_volume:read first.",
        variants = [
            dict(label="Vol 0 (min)", packet=[0x06, 0x37, 0x00]),
            dict(label="Vol 3 (mid)", packet=[0x06, 0x37, 0x03]),
            dict(label="Vol 7 (max)", packet=[0x06, 0x37, 0x07]),
            dict(label="Restore 3",   packet=[0x06, 0x37, 0x03]),
        ],
    ),
    dict(
        key  = "base:wireless_mode:write",
        name = "Base Station / Wireless Mode — WRITE",
        description = "Candidate opcode 0xC2. Run base:wireless_mode:read first to confirm.",
        variants = [
            dict(label="Speed mode (0x00)", packet=[0x06, 0xC2, 0x00]),
            dict(label="Range mode (0x01)", packet=[0x06, 0xC2, 0x01]),
            dict(label="Restore Speed",     packet=[0x06, 0xC2, 0x00]),
        ],
    ),
    dict(
        key  = "base:idle_timeout:write",
        name = "Base Station / Idle Timeout — WRITE [HeadsetControl confirmed]",
        description = (
            "Opcode 0xC1, level index: 0=disabled 1=1min 2=5min 3=10min "
            "4=15min 5=30min 6=60min."
        ),
        variants = [
            dict(label="Disabled (0)",  packet=[0x06, 0xC1, 0x00]),
            dict(label="10 min (3)",    packet=[0x06, 0xC1, 0x03]),
            dict(label="30 min (5)",    packet=[0x06, 0xC1, 0x05]),
            dict(label="Restore 10min", packet=[0x06, 0xC1, 0x03]),
        ],
    ),
    dict(
        key  = "base:eq_preset:write",
        name = "Base Station / EQ Preset — WRITE [HeadsetControl confirmed]",
        description = "Opcode 0x2E, preset 0–3 (built-in), 4=custom.",
        variants = [
            dict(label="Preset 0 (default)", packet=[0x06, 0x2E, 0x00]),
            dict(label="Preset 1",           packet=[0x06, 0x2E, 0x01]),
            dict(label="Custom (4)",         packet=[0x06, 0x2E, 0x04]),
            dict(label="Restore preset 0",   packet=[0x06, 0x2E, 0x00]),
        ],
    ),
    dict(
        key  = "base:eq_bands:write",
        name = "Base Station / EQ Bands — WRITE [HeadsetControl confirmed]",
        description = (
            "Opcode 0x33, 10 band bytes. Formula: byte = 0x14 + 2×gain_dB. "
            "Sends flat EQ (all 0 dB) then saves to flash."
        ),
        variants = [
            dict(label="Custom preset first",   packet=[0x06, 0x2E, 0x04]),
            dict(label="Flat EQ (all 0 dB)",    packet=[0x06, 0x33, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14]),
            dict(label="Save to flash (0x09)",  packet=[0x06, 0x09]),
            dict(label="Restore preset 0",      packet=[0x06, 0x2E, 0x00]),
        ],
    ),
]

GG_ENGINE_SESSIONS: list[dict] = [
    dict(
        key  = "gg:eq",
        name = "EQ Settings",
        steps = [
            dict(id="preset_flat",   instruction="GG Engine → EQ → select Flat preset",           detail="Expected: cmd=0x2E preset=0"),
            dict(id="preset_bass",   instruction="GG Engine → EQ → select Bass Boost preset",     detail="Expected: cmd=0x2E preset=1 or 2"),
            dict(id="custom_slide",  instruction="GG Engine → EQ → Custom → drag bass band ±10 dB", detail="Expected: cmd=0x33 (10 band bytes) + cmd=0x09 (save)"),
        ],
    ),
    dict(
        key  = "gg:sidetone",
        name = "Sidetone",
        steps = [
            dict(id="min", instruction="GG Engine → Headset → Sidetone → drag to minimum (0)", detail="Expected: cmd=0x39 level=0"),
            dict(id="max", instruction="GG Engine → Headset → Sidetone → drag to maximum",    detail="Expected: cmd=0x39 level=3"),
        ],
    ),
    dict(
        key  = "gg:mic_volume",
        name = "Mic Volume",
        steps = [
            dict(id="min", instruction="GG Engine → Headset → Microphone → drag Mic Volume to 0",   detail="Opcode unknown — discovering (candidate 0x37)"),
            dict(id="max", instruction="GG Engine → Headset → Microphone → drag Mic Volume to max", detail=None),
        ],
    ),
    dict(
        key  = "gg:anc",
        name = "ANC / Transparency",
        steps = [
            dict(id="off",          instruction="GG Engine → Headset → Noise Cancelling → OFF",          detail="Expected: cmd=0xBD mode=0"),
            dict(id="transparency", instruction="GG Engine → Headset → Noise Cancelling → TRANSPARENCY", detail="Expected: cmd=0xBD mode=1"),
            dict(id="anc",          instruction="GG Engine → Headset → Noise Cancelling → ANC ON",       detail="Expected: cmd=0xBD mode=2"),
        ],
    ),
    dict(
        key  = "gg:usb_input",
        name = "USB Input",
        steps = [
            dict(id="port1", instruction="GG Engine → Headset → Base Station → PC Port → Port 1", detail="Opcode unknown — discovering"),
            dict(id="port2", instruction="GG Engine → Headset → Base Station → PC Port → Port 2", detail=None),
        ],
    ),
    dict(
        key  = "gg:wireless_mode",
        name = "Wireless Mode",
        steps = [
            dict(id="speed", instruction="GG Engine → Headset → Wireless → Speed mode", detail="Opcode unknown — discovering (candidate 0xC2)"),
            dict(id="range", instruction="GG Engine → Headset → Wireless → Range mode", detail=None),
        ],
    ),
    dict(
        key  = "gg:oled_brightness",
        name = "OLED Brightness",
        steps = [
            dict(id="min", instruction="GG Engine → Headset → OLED → drag brightness to minimum", detail="Expected: write 0xBF, push response 0x85"),
            dict(id="max", instruction="GG Engine → Headset → OLED → drag brightness to maximum", detail=None),
        ],
    ),
    dict(
        key  = "gg:chat_mix",
        name = "ChatMix (read only from HID side)",
        steps = [
            dict(
                id   = "dial",
                instruction = "Rotate the ChatMix dial on the headset slowly from game to chat",
                detail = "GG Engine does not write ChatMix via HID — this confirms push opcode only",
            ),
        ],
    ),
]

PREDEFINED_SCANS: list[dict] = [
    dict(name="usb_input_0xC0",   b0=0x06, b1=0xC0, lo=0x00, hi=0x05, label="USB input candidate 0xC0"),
    dict(name="usb_input_0xC2",   b0=0x06, b1=0xC2, lo=0x00, hi=0x05, label="Wireless/USB candidate 0xC2"),
    dict(name="mic_volume_0x37",  b0=0x06, b1=0x37, lo=0x00, hi=0x09, label="Mic volume candidate 0x37"),
    dict(name="anc_0xBD",         b0=0x06, b1=0xBD, lo=0x00, hi=0x04, label="ANC mode 0xBD sweep"),
    dict(name="full_cmd_sweep",   b0=0x06, b1=None, lo=0x00, hi=0xFF, label="Full command byte sweep (byte1 0x00–0xFF, byte2=0x00)"),
]


# ── Main menu ──────────────────────────────────────────────────────────────────

def _menu_print(items: list[tuple[int, bool, str]], title: str) -> None:
    print(f"  {C.BOLD}{C.CYAN}{title}{C.RESET}")
    for num, done, label in items:
        tick = f"{C.GREEN}✓{C.RESET}" if done else " "
        print(f"  {tick} {num:>3}.  {label}")
    print()


def main() -> None:
    _clr()
    _print_header("Arctis Nova Pro Wireless — Interactive HID Discovery Wizard")
    print(f"""  Guides you through {C.BOLD}every hardware and GG Engine interaction{C.RESET},
  captures HID events in real-time, tests write commands, and builds
  a complete discovery log saved to a timestamped JSON file.

  {C.YELLOW}For READ sessions:{C.RESET}  GG Engine may be open OR closed.
  {C.YELLOW}For WRITE sessions:{C.RESET} GG Engine MUST be CLOSED (to avoid HID conflicts).
  {C.YELLOW}For GG Engine sessions:{C.RESET} GG Engine MUST be OPEN.

  Press Ctrl+C during any session to abort and return to the menu.
  All partial results are saved automatically after each session.
""")
    input(f"  {C.BOLD}Press [Enter] to scan for devices…{C.RESET}")

    dm = DeviceManager()
    try:
        ifaces = dm.open()
    except RuntimeError as ex:
        _err(str(ex))
        sys.exit(1)

    _ok(f"Opened {len(ifaces)} interface(s): {[f'IF{i}' for i in ifaces]}")
    print()
    dm.start_reader()

    disc = Discovery(dm)

    # Flat item list for numbered menu entries
    # Each entry: (kind, payload)
    # kind: "read" | "write" | "gg" | "scan_pre" | "scan_custom" | "custom" | "summary"

    def _build_menu() -> list[tuple[str, object]]:
        items: list[tuple[str, object]] = []
        items += [("read",  s) for s in READ_SESSIONS]
        items += [("write", s) for s in WRITE_SESSIONS]
        items += [("gg",    s) for s in GG_ENGINE_SESSIONS]
        items += [("scan_pre", s) for s in PREDEFINED_SCANS]
        items.append(("scan_custom", None))
        items.append(("custom",      None))
        items.append(("summary",     None))
        return items

    while True:
        _clr()
        _print_header("Main Menu")

        flat = _build_menu()
        num  = 1

        # ── Print sections ────────────────────────────────────────────────────

        print(f"  {C.BOLD}{C.CYAN}HEADSET — Read Events{C.RESET}")
        headset_reads = [s for s in READ_SESSIONS if s["key"].startswith("headset:")]
        for s in headset_reads:
            done = bool(disc.results.get(s["key"]))
            tick = f"{C.GREEN}✓{C.RESET}" if done else " "
            print(f"  {tick} {num:>3}.  {s['name']}")
            num += 1
        print()

        print(f"  {C.BOLD}{C.CYAN}HEADSET — Write Commands{C.RESET}")
        headset_writes = [s for s in WRITE_SESSIONS if s["key"].startswith("headset:")]
        for s in headset_writes:
            done = bool(disc.results.get(s["key"]))
            tick = f"{C.GREEN}✓{C.RESET}" if done else " "
            print(f"  {tick} {num:>3}.  {s['name']}")
            num += 1
        print()

        print(f"  {C.BOLD}{C.CYAN}BASE STATION — Read Events{C.RESET}")
        base_reads = [s for s in READ_SESSIONS if s["key"].startswith("base:")]
        for s in base_reads:
            done = bool(disc.results.get(s["key"]))
            tick = f"{C.GREEN}✓{C.RESET}" if done else " "
            print(f"  {tick} {num:>3}.  {s['name']}")
            num += 1
        print()

        print(f"  {C.BOLD}{C.CYAN}BASE STATION — Write Commands{C.RESET}")
        base_writes = [s for s in WRITE_SESSIONS if s["key"].startswith("base:")]
        for s in base_writes:
            done = bool(disc.results.get(s["key"]))
            tick = f"{C.GREEN}✓{C.RESET}" if done else " "
            print(f"  {tick} {num:>3}.  {s['name']}")
            num += 1
        print()

        print(f"  {C.BOLD}{C.CYAN}GG ENGINE — Guided Capture{C.RESET}")
        for s in GG_ENGINE_SESSIONS:
            done = bool(disc.results.get(f"gg:{s['key']}"))
            tick = f"{C.GREEN}✓{C.RESET}" if done else " "
            print(f"  {tick} {num:>3}.  GG Engine: {s['name']}")
            num += 1
        print()

        print(f"  {C.BOLD}{C.CYAN}ADVANCED{C.RESET}")
        for ps in PREDEFINED_SCANS:
            done = bool(disc.results.get(f"scan:{ps['name']}"))
            tick = f"{C.GREEN}✓{C.RESET}" if done else " "
            print(f"  {tick} {num:>3}.  Scan: {ps['label']}")
            num += 1
        print(f"      {num:>3}.  Custom scan (enter byte range manually)")
        num += 1
        print(f"      {num:>3}.  Custom packet builder (raw hex input)")
        num += 1
        print(f"      {num:>3}.  View capture summary")
        num += 1
        print(f"        0.  Exit")
        print()

        total = num - 1
        try:
            raw_choice = input(f"  {C.BOLD}Select [1–{total}] or 0 to exit: {C.RESET}").strip()
        except (EOFError, KeyboardInterrupt):
            break

        if raw_choice == "0":
            break

        try:
            choice = int(raw_choice)
            if choice < 1 or choice > total:
                continue
        except ValueError:
            continue

        item_kind, item_data = flat[choice - 1]

        try:
            if item_kind == "read":
                # Special: battery read auto-sends query first
                if item_data["key"] == "headset:battery:read":
                    _print_header(item_data["name"])
                    _info("Sending battery query [0x06 0xB0] first…")
                    pkt = make_packet(0x06, 0xB0)
                    disc.dm.set_session(item_data["key"])
                    disc.dm.write(pkt)
                    _ok("Query sent — listening for 5 s.")
                    print(f"\n{C.DIM}     ← live HID events appear here →{C.RESET}\n")
                    evts = disc._live_capture(item_data["key"], "waiting", window_s=5)
                    disc._finish_session(item_data["key"], evts)
                else:
                    disc.run_read_session(item_data["key"], item_data)

            elif item_kind == "write":
                disc.run_write_session(item_data["key"], item_data)

            elif item_kind == "gg":
                disc.run_gg_session(item_data["key"], item_data)

            elif item_kind == "scan_pre":
                ps = item_data
                if ps["b1"] is None:
                    # Full command sweep: vary byte1, byte2 fixed to 0
                    _print_header(f"Full Command Sweep — [0x{ps['b0']:02X}, 0x00–0xFF, 0x00]")
                    _warn("This sends 256 packets. GG Engine must be CLOSED.")
                    _warn("Watch for any push responses that indicate a valid command.")
                    cont = input("  Proceed? [y/N]: ").strip().lower()
                    if cont != "y":
                        continue
                    findings: list[dict] = []
                    print()
                    for b1_val in range(ps["lo"], ps["hi"] + 1):
                        pkt = make_packet(ps["b0"], b1_val, [0x00])
                        disc.dm.set_session(f"sweep:0x{b1_val:02X}")
                        print(f"  → [0x{ps['b0']:02X} 0x{b1_val:02X} 0x00] … ", end="", flush=True)
                        disc.dm.write(pkt)
                        evts = disc.dm.drain(300)
                        if evts:
                            print(f"{C.GREEN}{len(evts)} response(s){C.RESET}")
                            for e in evts:
                                e.display(prefix="       ← ")
                                disc.all_events.append(e)
                            findings.append({"b1": b1_val, "events": [e.as_dict() for e in evts]})
                        else:
                            print(f"{C.DIM}—{C.RESET}")
                        time.sleep(0.12)
                    disc.results[f"scan:{ps['name']}"] = findings
                    _ok(f"{len(findings)} byte1 value(s) produced responses")
                    disc._save()
                    input(f"\n  Press [Enter] to continue…")
                else:
                    _print_header(f"Scan: {ps['label']}")
                    _warn("GG Engine must be CLOSED.")
                    print(f"  Scanning [0x{ps['b0']:02X}, 0x{ps['b1']:02X}, 0x{ps['lo']:02X}–0x{ps['hi']:02X}]\n")
                    findings = []
                    try:
                        for val in range(ps["lo"], ps["hi"] + 1):
                            pkt = make_packet(ps["b0"], ps["b1"], [val])
                            disc.dm.set_session(f"scan:{ps['name']}:0x{val:02X}")
                            print(f"  → [0x{ps['b0']:02X} 0x{ps['b1']:02X} 0x{val:02X}] … ", end="", flush=True)
                            disc.dm.write(pkt)
                            evts = disc.dm.drain(450)
                            if evts:
                                print(f"{C.GREEN}{len(evts)} event(s){C.RESET}")
                                for e in evts:
                                    e.display(prefix="      ← ")
                                    disc.all_events.append(e)
                                findings.append({"val": val, "events": [e.as_dict() for e in evts]})
                            else:
                                print(f"{C.DIM}(no response){C.RESET}")
                            time.sleep(0.15)
                    except KeyboardInterrupt:
                        print("\n  Stopped early.")
                    disc.results[f"scan:{ps['name']}"] = findings
                    _ok(f"{len(findings)} value(s) produced responses") if findings else _warn("No responses")
                    disc._save()
                    input(f"\n  Press [Enter] to continue…")

            elif item_kind == "scan_custom":
                disc.run_scan()

            elif item_kind == "custom":
                disc.run_custom()

            elif item_kind == "summary":
                disc.show_summary()

        except KeyboardInterrupt:
            print(f"\n\n  {C.YELLOW}Session interrupted — returning to menu.{C.RESET}")
            time.sleep(0.6)

    # ── Exit ──────────────────────────────────────────────────────────────────
    dm.close()
    disc._save()
    print()
    _ok(f"Session ended. Results saved to: {disc._result_file}")
    print()


if __name__ == "__main__":
    main()

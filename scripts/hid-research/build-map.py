#!/usr/bin/env python3
"""
Phase 7 — Build Command Map
Aggregates results from all previous phases into a single command-map.json.
This becomes the authoritative reference for implementing write commands
in the TypeScript application (baseStationEvents.ts / new HID writer service).

Usage:
  python build-map.py
  python build-map.py \
    --listen  listen-log.json \
    --read    probe-read-results.json \
    --write   probe-write-results.json \
    --wireshark wireshark-commands.json \
    --out     command-map.json
"""
import argparse
import json
from pathlib import Path
from typing import Any

# ── Baseline: known commands from current TypeScript project (read events) ────
BASELINE_EVENTS: list[dict] = [
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0x25",
        "name": "headset_volume",
        "description": "Headset hardware volume knob turned",
        "data_fields": {
            "byte2": "raw_volume (0–0x38, inverted: percent = (0x38-val)/0x38 * 100)"
        },
        "write_command": None,
        "write_confirmed": False,
    },
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0xB5",
        "name": "connection_state",
        "description": "Headset connection state changed",
        "data_fields": {
            "byte3": "bluetooth (1 = BT active)",
            "byte4": "wireless (8 = 2.4GHz active)",
        },
        "write_command": None,
        "write_confirmed": False,
    },
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0xB7",
        "name": "battery_levels",
        "description": "Battery level update (headset + base station)",
        "data_fields": {
            "byte2": "headset battery level (0–8)",
            "byte3": "base station / charging case battery level (0–8)",
        },
        "write_command": None,
        "write_confirmed": False,
    },
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0x85",
        "name": "oled_brightness",
        "description": "OLED display brightness changed",
        "data_fields": {
            "byte2": "brightness level (1–10)"
        },
        "write_command": None,
        "write_confirmed": False,
        "notes": "Nova 7X uses LED command 0xAE (0–3). Nova Pro may use 0x85 or 0xAE for write.",
    },
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0x39",
        "name": "sidetone_level",
        "description": "Sidetone level changed",
        "data_fields": {
            "byte2": "sidetone level (0–3: off, low, medium, high)"
        },
        "write_command": {
            "opcode": "0x39",
            "packet": "[0x00, 0x39, level, 0x00…]",
            "values": {"0": "off", "1": "low", "2": "medium", "3": "high"},
            "source": "Nova 7X confirmed — same opcode as push event",
        },
        "write_confirmed": False,
    },
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0xBD",
        "name": "anc_mode",
        "description": "ANC/transparency mode changed",
        "data_fields": {
            "byte2": "mode (0=off, 1=transparency, 2=ANC)"
        },
        "write_command": {
            "opcode": "0xBD",
            "packet": "[0x00, 0xBD, mode, 0x00…]",
            "values": {"0": "off", "1": "transparency", "2": "anc"},
            "source": "Candidate — same opcode as push event. Needs Wireshark confirmation.",
        },
        "write_confirmed": False,
    },
    {
        "type": "push_event",
        "source": "current_project (baseStationEvents.ts)",
        "interface_hint": 4,
        "report_ids": ["0x06", "0x07"],
        "command": "0xBB",
        "name": "mic_mute",
        "description": "Microphone mute state changed",
        "data_fields": {
            "byte2": "muted (0=unmuted, 1=muted)"
        },
        "write_command": None,
        "write_confirmed": False,
        "notes": "Physical mute button is on headset. Programmatic mute may require different opcode.",
    },
]

# ── Baseline: Nova 7X write commands (candidates for Nova Pro) ────────────────
NOVA7X_CANDIDATES: list[dict] = [
    {
        "type": "write_candidate",
        "source": "Nova 7X confirmed",
        "name": "mic_volume",
        "command": "0x37",
        "packet": "[0x00, 0x37, level, 0x00…]",
        "values": {"range": "0–7"},
        "write_confirmed": False,
    },
    {
        "type": "write_candidate",
        "source": "Nova 7X confirmed",
        "name": "volume_limiter",
        "command": "0x3A",
        "packet": "[0x00, 0x3A, value, 0x00…]",
        "values": {"0": "off", "1": "on"},
        "write_confirmed": False,
    },
    {
        "type": "write_candidate",
        "source": "Nova 7X confirmed",
        "name": "idle_timeout",
        "command": "0xA3",
        "packet": "[0x00, 0xA3, minutes, 0x00…]",
        "values": {"range": "0–90 (0=disabled)"},
        "write_confirmed": False,
    },
    {
        "type": "write_candidate",
        "source": "Nova 7X confirmed",
        "name": "eq_set_params",
        "command": "0x33",
        "packet": "[0x00, 0x33, profile, 0x20, 0x00, 0x01, 0x00, 0x86, 0x05, <10-band data>…]",
        "values": {"profile": "0x00=2.4GHz, 0x01=Bluetooth"},
        "write_confirmed": False,
    },
    {
        "type": "write_candidate",
        "source": "Nova 7X confirmed",
        "name": "eq_apply",
        "command": "0x27",
        "packet": "[0x00, 0x27, profile, 0x00…]",
        "write_confirmed": False,
    },
    {
        "type": "write_candidate",
        "source": "Nova 7X confirmed",
        "name": "eq_save_flash",
        "command": "0x09",
        "packet": "[0x00, 0x09, 0x00…]",
        "write_confirmed": False,
    },
]


def load_json(path: str | None) -> Any:
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        print(f"  WARNING: {path} not found, skipping.")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def extract_new_push_events(listen_log: list[dict]) -> list[dict]:
    """Find events in listen log that are not already in BASELINE_EVENTS."""
    known_commands = {e["command"] for e in BASELINE_EVENTS if e.get("type") == "push_event"}
    seen: set[str] = set()
    new_events: list[dict] = []
    for entry in listen_log:
        cmd = entry.get("command")
        if not cmd or cmd in known_commands or cmd in seen:
            continue
        seen.add(cmd)
        new_events.append({
            "type": "push_event",
            "source": "listen.py discovery",
            "interface_hint": None,
            "report_ids": [entry.get("report_id", "?")],
            "command": cmd,
            "name": f"UNKNOWN_{cmd}",
            "description": f"Discovered in passive listen. Example: {entry.get('hex', '')}",
            "data_fields": {},
            "write_command": None,
            "write_confirmed": False,
            "raw_example": entry.get("hex"),
        })
    return new_events


def extract_confirmed_reads(read_results: list[dict]) -> list[dict]:
    """Extract commands that produced responses from probe-read-results.json."""
    confirmed: list[dict] = []
    seen: set[str] = set()
    for r in read_results:
        if r.get("status") != "RESPONSE":
            continue
        key = f"{r.get('b0')} {r.get('b1')}"
        if key in seen:
            continue
        seen.add(key)
        confirmed.append({
            "type": "read_query",
            "source": "probe-read.py confirmed",
            "interface": r.get("interface"),
            "b0": r.get("b0"),
            "b1": r.get("b1"),
            "description": r.get("desc"),
            "response_hex": r.get("response_hex"),
            "response_bytes": r.get("response"),
        })
    return confirmed


def mark_confirmed_writes(baseline: list[dict], write_results: list[dict]) -> list[dict]:
    """Mark write commands as confirmed if probe-write produced push events."""
    # Build a lookup of confirmed b1 opcodes
    confirmed_opcodes: set[str] = set()
    for r in write_results:
        if r.get("push_events"):
            confirmed_opcodes.add(r.get("b1", "").lower())

    result = []
    for entry in baseline:
        e = dict(entry)
        wc = e.get("write_command")
        if wc and wc.get("opcode", "").lower() in confirmed_opcodes:
            e["write_confirmed"] = True
        result.append(e)
    return result


def extract_wireshark_commands(ws_data: dict) -> list[dict]:
    """Extract unique command patterns from wireshark-commands.json."""
    if not ws_data:
        return []
    groups = ws_data.get("command_groups", {})
    result: list[dict] = []
    for key, packets in groups.items():
        if not packets:
            continue
        sample = packets[0]
        result.append({
            "type": "wireshark_out_command",
            "source": "Wireshark capture (GG Engine → device)",
            "pattern": key,
            "count": len(packets),
            "sample_hex": sample.get("hex"),
            "sample_bytes": sample.get("data"),
            "status": "unconfirmed — correlate with listen.py events",
        })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 7: Build command map")
    parser.add_argument("--listen", default="listen-log.json", help="listen.py output JSON")
    parser.add_argument("--read", default="probe-read-results.json", help="probe-read.py output JSON")
    parser.add_argument("--write", default="probe-write-results.json", help="probe-write.py output JSON")
    parser.add_argument("--wireshark", default="wireshark-commands.json", help="parse-wireshark.py output JSON")
    parser.add_argument("--out", default="command-map.json", help="Output command map JSON")
    args = parser.parse_args()

    print("\nPhase 7: Building command map\n")

    listen_log: list[dict] = load_json(args.listen) or []
    read_results: list[dict] = load_json(args.read) or []
    write_results: list[dict] = load_json(args.write) or []
    ws_data: dict = load_json(args.wireshark) or {}

    # Build command map sections
    push_events = list(BASELINE_EVENTS)
    new_events = extract_new_push_events(listen_log)
    push_events.extend(new_events)

    if write_results:
        push_events = mark_confirmed_writes(push_events, write_results)

    write_candidates = list(NOVA7X_CANDIDATES)
    if write_results:
        confirmed_b1 = {r.get("b1", "").lower() for r in write_results if r.get("push_events")}
        for c in write_candidates:
            if c.get("command", "").lower() in confirmed_b1:
                c["write_confirmed"] = True

    read_queries = extract_confirmed_reads(read_results)
    wireshark_commands = extract_wireshark_commands(ws_data)

    command_map = {
        "_meta": {
            "device": "SteelSeries Arctis Nova Pro Wireless",
            "vendor_id": "0x1038",
            "product_ids": {
                "0x12CB": "dongle variant A",
                "0x12CD": "dongle variant B",
                "0x12E0": "Nova Pro Wireless",
                "0x12E5": "Nova Pro Wireless X",
                "0x225D": "base station / wired",
            },
            "event_interface": 4,
            "event_report_ids": ["0x06", "0x07"],
            "control_interface_hint": "3 or 4 — confirm with probe-read.py results",
            "packet_size": 64,
            "notes": [
                "All packets padded to 64 bytes with 0x00.",
                "Write commands: [report_id, opcode, value, 0x00…×61]",
                "Push events are polled at 120ms interval in the current project.",
                "write_confirmed=true means probe-write.py observed a push event response.",
            ],
        },
        "push_events": push_events,
        "write_candidates": write_candidates,
        "confirmed_read_queries": read_queries,
        "wireshark_out_commands": wireshark_commands,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(command_map, f, indent=2)

    confirmed_writes = sum(1 for e in push_events if e.get("write_confirmed"))
    confirmed_reads = len(read_queries)
    new_discovered = len(new_events)
    ws_count = len(wireshark_commands)

    print(f"{'=' * 60}")
    print(f"Command map saved to: {args.out}")
    print(f"{'=' * 60}")
    print(f"  Push events (baseline + discovered): {len(push_events)}")
    print(f"    - Newly discovered from listen.py : {new_discovered}")
    print(f"    - Write commands confirmed         : {confirmed_writes}")
    print(f"  Write candidates (Nova 7X origin)   : {len(write_candidates)}")
    print(f"    - Confirmed on Nova Pro            : {sum(1 for c in write_candidates if c.get('write_confirmed'))}")
    print(f"  Read queries confirmed               : {confirmed_reads}")
    print(f"  Wireshark OUT commands               : {ws_count}")
    print()
    print("NEXT STEP → Run validate.cjs to test confirmed commands via the")
    print("  project's node-hid and verify integration with the app state.")


if __name__ == "__main__":
    main()

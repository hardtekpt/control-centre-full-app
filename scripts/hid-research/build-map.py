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

# ── HeadsetControl CONFIRMED write commands for Nova Pro Wireless ─────────────
# Source: github.com/Sapd/HeadsetControl blob/master/lib/devices/steelseries_arctis_nova_pro_wireless.hpp
# PIDs confirmed: 0x12e0 (Nova Pro Wireless), 0x12e5 (Nova Pro Wireless X)
# All commands: report_id=0x06, native packet size=31 bytes.
HEADSETCONTROL_CONFIRMED: list[dict] = [
    {
        "type": "write_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "sidetone",
        "command": "0x39",
        "report_id": "0x06",
        "packet": "[0x06, 0x39, level, 0x00…×28]",
        "packet_size_native": 31,
        "values": {
            "0": "off",
            "1": "low  (input ≤42 on 0–128 scale)",
            "2": "medium (input ≤85 on 0–128 scale)",
            "3": "high  (input >85 on 0–128 scale)",
        },
        "notes": "Same opcode as push event 0x39 — write triggers matching push response.",
        "write_confirmed": True,
    },
    {
        "type": "write_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "oled_lights",
        "command": "0xBF",
        "report_id": "0x06",
        "packet": "[0x06, 0xBF, strength, 0x00…×28]",
        "packet_size_native": 31,
        "values": {"range": "1–10 (maps boolean on/off to LED strength)"},
        "notes": "Write opcode is 0xBF. Push event uses 0x85. These are DIFFERENT opcodes.",
        "write_confirmed": True,
    },
    {
        "type": "write_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "idle_timeout",
        "command": "0xC1",
        "report_id": "0x06",
        "packet": "[0x06, 0xC1, level, 0x00…×28]",
        "packet_size_native": 31,
        "values": {
            "0": "disabled",
            "1": "1 minute",
            "2": "5 minutes",
            "3": "10 minutes",
            "4": "15 minutes",
            "5": "30 minutes",
            "6": "60 minutes",
        },
        "notes": "Value is a level INDEX (0–6), not minutes directly. Nova 7X used 0xA3 — different.",
        "write_confirmed": True,
    },
    {
        "type": "write_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "eq_preset_select",
        "command": "0x2E",
        "report_id": "0x06",
        "packet": "[0x06, 0x2E, preset, 0x00…×28]",
        "packet_size_native": 31,
        "values": {
            "0": "preset 1",
            "1": "preset 2",
            "2": "preset 3",
            "3": "preset 4",
            "4": "custom (required before writing eq_bands)",
        },
        "write_confirmed": True,
    },
    {
        "type": "write_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "eq_bands",
        "command": "0x33",
        "report_id": "0x06",
        "packet": "[0x06, 0x33, band0, band1, …band9, 0x00…]",
        "packet_size_native": 31,
        "values": {
            "formula": "band_byte = 0x14 + (2 * gain_dB)",
            "baseline": "0x14 = 0 dB (flat)",
            "range_dB": "-10.0 to +10.0",
            "step_dB": "0.5",
            "num_bands": 10,
            "example": "+4 dB = 0x1C, -6 dB = 0x08",
        },
        "notes": "Must call eq_preset_select with preset=4 (custom) before writing bands.",
        "write_confirmed": True,
    },
    {
        "type": "write_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "save_to_flash",
        "command": "0x09",
        "report_id": "0x06",
        "packet": "[0x06, 0x09, 0x00…×29]",
        "packet_size_native": 31,
        "values": {},
        "notes": "Persists current settings to device flash. Send after eq_bands or settings writes.",
        "write_confirmed": True,
    },
]

# ── Read query confirmed by HeadsetControl ────────────────────────────────────
HEADSETCONTROL_READ_QUERIES: list[dict] = [
    {
        "type": "read_query_confirmed",
        "source": "HeadsetControl (nova_pro_wireless.hpp) — authoritative",
        "name": "battery_status",
        "command": "0xB0",
        "report_id": "0x06",
        "packet": "[0x06, 0xB0, 0x00…×29]",
        "response_fields": {
            "byte_6": "headset battery level (0–8, map to 0–100%)",
            "byte_15": "status (0x01=offline/disconnected, 0x02=charging, 0x08=online/discharging)",
        },
        "notes": "Only headset battery is documented. Dual battery (base station) not in HeadsetControl.",
    },
]

# ── Nova 7X commands now flagged as INCORRECT for Nova Pro ───────────────────
NOVA7X_DISCARDED: list[dict] = [
    {
        "name": "idle_timeout_nova7x",
        "command": "0xA3",
        "reason": "Nova 7X opcode — Nova Pro uses 0xC1 instead (HeadsetControl confirmed)",
        "status": "DO_NOT_USE_ON_NOVA_PRO",
    },
    {
        "name": "led_brightness_nova7x",
        "command": "0xAE",
        "reason": "Nova 7X LED opcode — Nova Pro uses 0xBF instead (HeadsetControl confirmed)",
        "status": "DO_NOT_USE_ON_NOVA_PRO",
    },
    {
        "name": "eq_apply_nova7x",
        "command": "0x27",
        "reason": "Nova 7X EQ apply — Nova Pro uses 0x2E for preset select (HeadsetControl confirmed)",
        "status": "DO_NOT_USE_ON_NOVA_PRO",
    },
]

# ── Remaining unknowns — still require Wireshark capture ─────────────────────
NOVA_PRO_UNKNOWNS: list[dict] = [
    {
        "type": "unknown_needs_wireshark",
        "name": "anc_mode_write",
        "push_event_cmd": "0xBD",
        "candidate_write_cmd": "0xBD",
        "candidate_packet": "[0x06, 0xBD, mode, 0x00…]",
        "candidate_values": {"0": "off", "1": "transparency", "2": "anc"},
        "notes": "Not in HeadsetControl (Nova Pro specific). Inferred from push event opcode.",
    },
    {
        "type": "unknown_needs_wireshark",
        "name": "usb_input_switch",
        "push_event_cmd": "None known",
        "candidate_write_cmd": "0xC0 or 0xC2",
        "candidate_packet": "[0x06, 0xC0, input, 0x00…] where input=1 or 2",
        "notes": "Nova Pro has dual USB inputs (PC port 1/2). Not in HeadsetControl.",
    },
    {
        "type": "unknown_needs_wireshark",
        "name": "mic_mute_write",
        "push_event_cmd": "0xBB",
        "candidate_write_cmd": "0xBB",
        "candidate_packet": "[0x06, 0xBB, muted, 0x00…] where muted=0/1",
        "notes": "Physical mute button triggers push event. Software write may use same opcode.",
    },
    {
        "type": "unknown_needs_wireshark",
        "name": "chatmix_read",
        "push_event_cmd": "None yet captured",
        "candidate_write_cmd": "Unknown",
        "notes": "ChatMix dial exists on Nova Pro. Opcode unknown.",
    },
    {
        "type": "unknown_needs_wireshark",
        "name": "dual_battery_base_station",
        "push_event_cmd": "0xB7",
        "notes": "Current project reads byte[2]=headset, byte[3]=base. HeadsetControl only documents byte[6] for single headset battery. The 0xB7 push event format may differ from the 0xB0 query response.",
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

    # Mark HeadsetControl confirmed writes in the probe-write results too
    hc_confirmed_b1 = {e["command"].lower() for e in HEADSETCONTROL_CONFIRMED}
    if write_results:
        for r in write_results:
            if r.get("b1", "").lower() in hc_confirmed_b1:
                r["headsetcontrol_confirmed"] = True

    # Build write_confirmed list = HeadsetControl + any probe-write additions
    write_confirmed_list = list(HEADSETCONTROL_CONFIRMED)
    if write_results:
        probe_confirmed_b1 = {r.get("b1", "").lower() for r in write_results if r.get("push_events")}
        extra_b1 = probe_confirmed_b1 - hc_confirmed_b1
        for b1 in extra_b1:
            matching = [r for r in write_results if r.get("b1", "").lower() == b1 and r.get("push_events")]
            if matching:
                write_confirmed_list.append({
                    "type": "write_confirmed",
                    "source": "probe-write.py verified",
                    "command": matching[0]["b1"],
                    "label": matching[0].get("label", ""),
                    "push_events_observed": matching[0].get("push_events", []),
                    "write_confirmed": True,
                })

    read_queries = extract_confirmed_reads(read_results)
    wireshark_commands = extract_wireshark_commands(ws_data)

    command_map = {
        "_meta": {
            "device": "SteelSeries Arctis Nova Pro Wireless",
            "vendor_id": "0x1038",
            "product_ids": {
                "0x12CB": "dongle variant A",
                "0x12CD": "dongle variant B",
                "0x12E0": "Nova Pro Wireless (base station) [HeadsetControl primary PID]",
                "0x12E5": "Nova Pro Wireless X [HeadsetControl secondary PID]",
                "0x225D": "base station / wired",
            },
            "event_interface": 4,
            "event_report_ids": ["0x06", "0x07"],
            "write_report_id": "0x06",
            "native_packet_size_bytes": 31,
            "test_packet_size_bytes": 64,
            "sources": [
                "Current project baseStationEvents.ts (push event decoding)",
                "cheahkhing/arctis-headset-hid (Nova 7X reference)",
                "Sapd/HeadsetControl nova_pro_wireless.hpp (Nova Pro confirmed)",
            ],
            "notes": [
                "Write commands use report_id=0x06 as byte[0] — NOT 0x00.",
                "Native packet size is 31 bytes. Padding to 64 is safe for testing.",
                "Write format: [0x06, opcode, value, 0x00…] padded to packet size.",
                "Push events polled at 120ms in current project.",
                "Battery query 0xB0: resp[6]=headset level(0-8), resp[15]=status.",
                "Idle timeout opcode 0xC1 uses level INDEX 0-6, not minutes directly.",
                "LED/OLED write opcode is 0xBF — push event uses 0x85 (different).",
                "EQ: select preset 4 (custom) via 0x2E before writing bands via 0x33.",
                "EQ band formula: byte = 0x14 + (2 * gain_dB), range -10 to +10 dB.",
            ],
        },
        "push_events": push_events,
        "write_commands_confirmed": write_confirmed_list,
        "write_commands_unknown": NOVA_PRO_UNKNOWNS,
        "read_queries_confirmed_headsetcontrol": HEADSETCONTROL_READ_QUERIES,
        "read_queries_confirmed_probe": read_queries,
        "wireshark_out_commands": wireshark_commands,
        "nova7x_commands_not_valid_on_nova_pro": NOVA7X_DISCARDED,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(command_map, f, indent=2)

    confirmed_writes = len(write_confirmed_list)
    confirmed_reads = len(read_queries) + len(HEADSETCONTROL_READ_QUERIES)
    new_discovered = len(new_events)
    ws_count = len(wireshark_commands)
    unknowns = len(NOVA_PRO_UNKNOWNS)

    print(f"{'=' * 60}")
    print(f"Command map saved to: {args.out}")
    print(f"{'=' * 60}")
    print(f"  Push events (baseline + discovered)  : {len(push_events)}")
    print(f"    - Newly discovered from listen.py  : {new_discovered}")
    print(f"  Write commands confirmed              : {confirmed_writes}")
    print(f"    - HeadsetControl authoritative      : {len(HEADSETCONTROL_CONFIRMED)}")
    print(f"    - probe-write.py additional         : {confirmed_writes - len(HEADSETCONTROL_CONFIRMED)}")
    print(f"  Unknown commands (need Wireshark)     : {unknowns}")
    print(f"  Read queries confirmed                : {confirmed_reads}")
    print(f"  Wireshark OUT commands                : {ws_count}")
    print()
    print("NEXT STEP → Run validate.cjs to test confirmed commands via the")
    print("  project's node-hid and verify integration with the app state.")


if __name__ == "__main__":
    main()

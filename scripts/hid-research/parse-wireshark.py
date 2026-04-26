#!/usr/bin/env python3
"""
Phase 4 — Parse Wireshark USB Capture
Extracts HID OUT transfers sent by SteelSeries GG Engine to the headset.
These are the write commands (host → device).

Usage:
  # Convert pcapng to tshark JSON first, then parse:
  python parse-wireshark.py --pcap capture.pcapng

  # Or if you already have the tshark JSON:
  python parse-wireshark.py --json capture.json

  # Annotate with a session log from listen.py to correlate writes to events:
  python parse-wireshark.py --pcap capture.pcapng --events listen-log.json

REQUIREMENTS:
  tshark must be in PATH or installed at C:\\Program Files\\Wireshark\\tshark.exe
"""
import argparse
import json
import subprocess
import sys
import os
from collections import defaultdict
from pathlib import Path

STEELSERIES_VID = 0x1038
NOVA_PRO_PIDS: set[int] = {0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D}

# Known decoded commands from the current project (for annotation)
KNOWN_COMMANDS: dict[int, str] = {
    0x25: "headset_volume",
    0xB5: "connection_state",
    0xB7: "battery",
    0x85: "oled_brightness",
    0x39: "sidetone",
    0xBD: "anc_mode",
    0xBB: "mic_mute",
    # Nova 7X read commands (to verify if Nova Pro responds to the same)
    0xB0: "STATUS_QUERY",
    0xA0: "CONFIG_QUERY",
    0x20: "MIC_QUERY",
    # Nova 7X write commands (candidates — unverified on Nova Pro)
    0x37: "SET_MIC_VOLUME",
    0x3A: "SET_VOLUME_LIMITER",
    0xA3: "SET_IDLE_TIMEOUT",
    0xAE: "SET_LED_BRIGHTNESS",
    0x33: "SET_EQ_PARAMS",
    0x27: "EQ_APPLY",
    0x09: "EQ_SAVE_FLASH",
    0xA7: "SET_PRESET_NAME",
    0x32: "GET_EQ_PARAMS",
    0xA6: "GET_PRESET_NAME",
}


def find_tshark() -> str:
    for candidate in ["tshark", r"C:\Program Files\Wireshark\tshark.exe"]:
        try:
            subprocess.run([candidate, "--version"], capture_output=True, check=True)
            return candidate
        except (FileNotFoundError, subprocess.CalledProcessError):
            continue
    return ""


def pcap_to_json(pcap_path: str, tshark: str) -> list[dict]:
    """Run tshark and parse its JSON output into packet list."""
    cmd = [
        tshark,
        "-r", pcap_path,
        "-T", "json",
        "-e", "frame.number",
        "-e", "frame.time_epoch",
        "-e", "usb.idVendor",
        "-e", "usb.idProduct",
        "-e", "usb.endpoint_address",
        "-e", "usb.endpoint_address.direction",
        "-e", "usb.device_address",
        "-e", "usb.capdata",
        "-e", "usbhid.data",
        "-e", "usb.data_len",
        "-e", "usb.transfer_type",
    ]
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"tshark error: {result.stderr}")
        sys.exit(1)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as e:
        print(f"Failed to parse tshark JSON: {e}")
        sys.exit(1)


def extract_layers(packet: dict) -> dict:
    try:
        return packet["_source"]["layers"]
    except (KeyError, TypeError):
        return {}


def get_field(layers: dict, *keys: str) -> str | None:
    for key in keys:
        val = layers.get(key)
        if val is not None:
            if isinstance(val, list):
                val = val[0]
            return str(val).strip()
    return None


def parse_hex_bytes(hex_str: str) -> list[int]:
    """Parse ':' or ' ' separated hex byte string to int list."""
    if not hex_str:
        return []
    cleaned = hex_str.replace(":", " ").replace("-", " ")
    try:
        return [int(b, 16) for b in cleaned.split() if b]
    except ValueError:
        return []


def hex_display(data: list[int], max_bytes: int = 32) -> str:
    truncated = data[:max_bytes]
    suffix = "…" if len(data) > max_bytes else ""
    return " ".join(f"{b:02X}" for b in truncated) + suffix


def annotate_bytes(data: list[int]) -> str:
    if len(data) < 2:
        return ""
    b0, b1 = data[0], data[1]
    name = KNOWN_COMMANDS.get(b1, "")
    return f"[{name}]" if name else "[UNKNOWN CMD]"


def is_steelseries_device(layers: dict) -> bool:
    vid_str = get_field(layers, "usb.idVendor")
    if vid_str:
        try:
            vid = int(vid_str, 16) if vid_str.startswith("0x") else int(vid_str)
            return vid == STEELSERIES_VID
        except ValueError:
            pass
    return False


def is_out_transfer(layers: dict) -> bool:
    """USB OUT = direction bit 0 (host→device)."""
    direction = get_field(layers, "usb.endpoint_address.direction")
    if direction is not None:
        return direction.strip() == "0"
    # Fall back to endpoint address MSB
    ep = get_field(layers, "usb.endpoint_address")
    if ep:
        try:
            val = int(ep, 16) if ep.startswith("0x") else int(ep)
            return (val & 0x80) == 0
        except ValueError:
            pass
    return False


def process_packets(packets: list[dict]) -> list[dict]:
    """Extract and return all OUT HID packets from SteelSeries devices."""
    results: list[dict] = []
    seen_device_addresses: set[str] = set()

    for pkt in packets:
        layers = extract_layers(pkt)
        if not layers:
            continue

        # Collect device addresses we see with a SteelSeries VID so we can
        # later filter by address even when the VID field is absent (common
        # in subsequent packets after the enumeration burst).
        if is_steelseries_device(layers):
            addr = get_field(layers, "usb.device_address")
            if addr:
                seen_device_addresses.add(addr)

        # Only keep OUT transfers (commands sent to device)
        if not is_out_transfer(layers):
            continue

        # Filter by device address
        addr = get_field(layers, "usb.device_address")
        is_known_device = (
            is_steelseries_device(layers)
            or (addr is not None and addr in seen_device_addresses)
        )
        if not is_known_device:
            continue

        # Extract raw data bytes
        raw = get_field(layers, "usb.capdata") or get_field(layers, "usbhid.data") or ""
        data = parse_hex_bytes(raw)
        if not data:
            continue

        frame_num = get_field(layers, "frame.number") or "?"
        epoch = get_field(layers, "frame.time_epoch") or "0"
        ep = get_field(layers, "usb.endpoint_address") or "?"

        results.append({
            "frame": frame_num,
            "epoch": float(epoch) if epoch != "0" else 0.0,
            "device_address": addr or "?",
            "endpoint": ep,
            "data": data,
            "hex": hex_display(data),
            "annotation": annotate_bytes(data),
            "byte0": f"0x{data[0]:02X}" if data else None,
            "byte1": f"0x{data[1]:02X}" if len(data) > 1 else None,
        })

    return results


def group_by_command(packets: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for pkt in packets:
        key = f"{pkt.get('byte0', '?')} {pkt.get('byte1', '?')}"
        groups[key].append(pkt)
    return dict(groups)


def print_summary(packets: list[dict]) -> None:
    groups = group_by_command(packets)
    print(f"\n{'=' * 70}")
    print(f"COMMAND GROUPS  ({len(packets)} OUT packets, {len(groups)} unique patterns)")
    print(f"{'=' * 70}")

    for key in sorted(groups.keys()):
        group = groups[key]
        sample = group[0]
        annotation = sample.get("annotation", "")
        count = len(group)
        print(f"\n  {key}  {annotation}  ×{count}")
        shown = min(5, len(group))
        for pkt in group[:shown]:
            print(f"    frame={pkt['frame']:>6}  {pkt['hex']}")
        if len(group) > shown:
            print(f"    … and {len(group) - shown} more")


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 4: Parse Wireshark USB capture")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--pcap", help="Path to .pcapng file (tshark will convert it)")
    src.add_argument("--json", help="Path to tshark JSON already exported")
    parser.add_argument("--events", help="listen.py log JSON to correlate with captures")
    parser.add_argument("--out", default="wireshark-commands.json", help="Output JSON file")
    parser.add_argument("--tshark", default="", help="Path to tshark executable")
    args = parser.parse_args()

    # ── Load packets ────────────────────────────────────────────────────────
    if args.pcap:
        tshark = args.tshark or find_tshark()
        if not tshark:
            print("ERROR: tshark not found. Install Wireshark (include tshark) and ensure it is in PATH.")
            sys.exit(1)
        print(f"\nPhase 4: Parsing {args.pcap}")
        raw_packets = pcap_to_json(args.pcap, tshark)
    else:
        print(f"\nPhase 4: Loading {args.json}")
        with open(args.json, encoding="utf-8") as f:
            raw_packets = json.load(f)

    print(f"Total raw packets: {len(raw_packets)}")

    # ── Extract OUT packets ─────────────────────────────────────────────────
    out_packets = process_packets(raw_packets)
    print(f"OUT (host→device) HID packets: {len(out_packets)}")

    # ── Summary ─────────────────────────────────────────────────────────────
    print_summary(out_packets)

    # ── Save ────────────────────────────────────────────────────────────────
    output = {
        "source": args.pcap or args.json,
        "total_raw_packets": len(raw_packets),
        "out_packets_count": len(out_packets),
        "command_groups": {
            k: [{"frame": p["frame"], "hex": p["hex"], "data": p["data"]} for p in v]
            for k, v in group_by_command(out_packets).items()
        },
        "all_out_packets": out_packets,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(f"\nFull output saved to: {args.out}")
    print("\nNEXT STEP → Run probe-read.py to confirm which read commands work on the device.")
    print("  Then run probe-write.py to test the write commands discovered here.")


if __name__ == "__main__":
    main()

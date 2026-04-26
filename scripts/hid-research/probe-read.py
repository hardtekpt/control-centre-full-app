#!/usr/bin/env python3
"""
Phase 5 — Read Command Prober
Systematically sends query packets to each Nova Pro interface and records
which ones produce responses.

This is the active/polling read path: sending [0x00, CMD, 0x00…] and
waiting for a synchronous response — distinct from push events in listen.py.

IMPORTANT:
  Close SteelSeries GG Engine before running this script.
  The script only sends read queries — it never issues write commands.

Usage:
  python probe-read.py                     # probe all interfaces, all candidates
  python probe-read.py --pid 0x12E0        # restrict to PID
  python probe-read.py --if 3              # restrict to interface
  python probe-read.py --scan              # also scan all 256 possible cmd bytes
  python probe-read.py --in probe-read-results.json --rescan  # retry from previous run
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

try:
    import hid
except ImportError:
    print("ERROR: 'hid' package not found. Run: pip install hidapi")
    sys.exit(1)

STEELSERIES_VID = 0x1038
NOVA_PRO_PIDS: set[int] = {0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D}

# ── Candidate read commands ───────────────────────────────────────────────────
# Each entry: (byte0, byte1, description)
# Byte0 is typically 0x00 (report ID 0 / no-ID prefix).
# Byte1 is the command.
CANDIDATE_READS: list[tuple[int, int, str]] = [
    # ── HeadsetControl CONFIRMED for Nova Pro Wireless (0x12e0 / 0x12e5) ──────
    # Report ID 0x06 is confirmed by HeadsetControl for all Nova Pro commands.
    # Packet size is 31 bytes on the device, padded here to PACKET_SIZE.
    (0x06, 0xB0, "★ BATTERY/STATUS query [HeadsetControl confirmed] → resp[6]=level(0-8), resp[15]=status(0x01=offline,0x02=charging,0x08=online)"),
    (0x06, 0x39, "★ SIDETONE query [HeadsetControl confirmed — same opcode as push event]"),
    (0x06, 0xBF, "★ LIGHTS/OLED query [HeadsetControl confirmed — opcode 0xBF, NOT 0xAE]"),
    (0x06, 0xC1, "★ INACTIVE TIME query [HeadsetControl confirmed — opcode 0xC1, NOT 0xA3]"),
    (0x06, 0x2E, "★ EQ PRESET query [HeadsetControl confirmed — opcode 0x2E]"),
    (0x06, 0x33, "★ EQ PARAMS query [HeadsetControl confirmed — 10 bands, baseline 0x14]"),
    (0x06, 0x09, "★ SAVE query [HeadsetControl confirmed — persist to flash]"),
    # ── Nova Pro specific — not in HeadsetControl, infer from push events ──────
    (0x06, 0xBD, "ANC MODE query [Nova Pro push event cmd — write opcode candidate]"),
    (0x06, 0xBB, "MIC MUTE query [Nova Pro push event cmd]"),
    (0x06, 0xB5, "CONNECTION STATE query [Nova Pro push event cmd]"),
    (0x06, 0xB7, "DUAL BATTERY query [Nova Pro push event cmd]"),
    (0x06, 0x85, "OLED BRIGHTNESS query [Nova Pro push event cmd — alt to 0xBF]"),
    (0x06, 0x25, "VOLUME query [Nova Pro push event cmd]"),
    # ── Unknown Nova Pro features ─────────────────────────────────────────────
    (0x06, 0xC0, "USB INPUT query [candidate — PCUsbInput 1/2]"),
    (0x06, 0xBC, "ANC alt query"),
    (0x06, 0xBE, "ANC alt query 2"),
    (0x06, 0x45, "CHATMIX query"),
    # ── Nova 7X commands for comparison (report ID 0x00) ─────────────────────
    (0x00, 0xB0, "Nova 7X STATUS — compare response format"),
    (0x00, 0xA0, "Nova 7X CONFIG — compare response format"),
    (0x00, 0x20, "Nova 7X MIC"),
    (0x00, 0x32, "Nova 7X EQ GET"),
    # ── Firmware / device info ────────────────────────────────────────────────
    (0x06, 0x10, "FIRMWARE version"),
    (0x06, 0x11, "SERIAL number"),
    (0x06, 0x90, "DEVICE INFO"),
]

PACKET_SIZE = 64
READ_TIMEOUT_MS = 250


def make_packet(b0: int, b1: int, size: int = PACKET_SIZE) -> list[int]:
    pkt = [0x00] * size
    pkt[0] = b0
    pkt[1] = b1
    return pkt


def hex_str(data: list[int]) -> str:
    return " ".join(f"{b:02X}" for b in data)


def probe_interface(
    path: bytes,
    label: str,
    commands: list[tuple[int, int, str]],
    delay_s: float = 0.05,
) -> list[dict]:
    results: list[dict] = []

    try:
        dev = hid.device()
        dev.open_path(path)
        dev.set_nonblocking(False)
    except Exception as e:
        print(f"\n  [CANNOT OPEN] {label}: {e}")
        print("  → Close SteelSeries GG Engine and try again.")
        return results

    print(f"\n{'─' * 70}")
    print(f"  Probing: {label}  ({len(commands)} commands)")
    print(f"{'─' * 70}")

    for b0, b1, desc in commands:
        pkt = make_packet(b0, b1)
        try:
            written = dev.write(pkt)
            time.sleep(delay_s)
            response = dev.read(PACKET_SIZE, timeout_ms=READ_TIMEOUT_MS)
        except Exception as e:
            print(f"  [ERROR]   [{b0:02X} {b1:02X}]  {desc}: {e}")
            results.append({
                "interface": label,
                "b0": f"0x{b0:02X}",
                "b1": f"0x{b1:02X}",
                "desc": desc,
                "status": "error",
                "error": str(e),
                "response": None,
            })
            continue

        has_response = bool(response) and any(b != 0 for b in response)
        status = "RESPONSE" if has_response else "silent"

        if has_response:
            resp_hex = hex_str(response)
            print(f"  [{status}]  [{b0:02X} {b1:02X}]  {desc}")
            print(f"              → {resp_hex}")
        else:
            print(f"  [{status}]   [{b0:02X} {b1:02X}]  {desc}")

        results.append({
            "interface": label,
            "b0": f"0x{b0:02X}",
            "b1": f"0x{b1:02X}",
            "desc": desc,
            "status": status,
            "written_bytes": written,
            "response": list(response) if response else None,
            "response_hex": hex_str(response) if response else None,
        })

    try:
        dev.close()
    except Exception:
        pass

    return results


def build_scan_commands() -> list[tuple[int, int, str]]:
    """Build all 256 possible byte1 read commands with report ID 0x00."""
    return [(0x00, b1, f"SCAN byte1=0x{b1:02X}") for b1 in range(0x100)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 5: Read command prober")
    parser.add_argument("--pid", type=lambda x: int(x, 16), help="Filter to PID (hex)")
    parser.add_argument("--if", dest="iface", type=int, help="Filter to interface number")
    parser.add_argument("--scan", action="store_true", help="Also scan all 256 byte1 values")
    parser.add_argument("--out", default="probe-read-results.json", help="Output JSON file")
    args = parser.parse_args()

    devices = hid.enumerate()
    nova = [
        d for d in devices
        if d.get("vendor_id") == STEELSERIES_VID
        and d.get("product_id") in NOVA_PRO_PIDS
    ]

    if args.pid is not None:
        nova = [d for d in nova if d.get("product_id") == args.pid]
    if args.iface is not None:
        nova = [d for d in nova if d.get("interface_number") == args.iface]

    if not nova:
        print("ERROR: No matching Nova Pro interfaces found.")
        sys.exit(1)

    commands = list(CANDIDATE_READS)
    if args.scan:
        existing_b1 = {b1 for _, b1, _ in CANDIDATE_READS}
        extra = [(b0, b1, desc) for b0, b1, desc in build_scan_commands() if b1 not in existing_b1]
        commands = commands + extra
        print(f"Scan mode enabled: {len(commands)} total commands per interface")

    print(f"\nPhase 5: Read Command Prober")
    print(f"  Interfaces to probe: {len(nova)}")
    print(f"  Commands per interface: {len(commands)}")
    print(f"\n  ⚠  Ensure SteelSeries GG Engine is CLOSED before proceeding.")
    input("\n  Press Enter to start probing...")

    all_results: list[dict] = []
    for d in sorted(nova, key=lambda x: (x.get("product_id", 0), x.get("interface_number", 0))):
        path = d["path"]
        label = f"PID=0x{d.get('product_id', 0):04X}/IF={d.get('interface_number', -1)}"
        results = probe_interface(path, label, commands)
        all_results.extend(results)

    # Save results
    fname = args.out
    with open(fname, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    # Summary
    responders = [r for r in all_results if r.get("status") == "RESPONSE"]
    print(f"\n{'=' * 70}")
    print(f"PROBE COMPLETE  —  {len(responders)} commands produced responses")
    print(f"{'=' * 70}")

    seen: set[str] = set()
    for r in responders:
        key = f"{r['b0']} {r['b1']}"
        if key in seen:
            continue
        seen.add(key)
        print(f"\n  Interface : {r['interface']}")
        print(f"  Command   : {r['b0']} {r['b1']}  ({r['desc']})")
        print(f"  Response  : {r.get('response_hex', 'N/A')}")

    print(f"\nFull results saved to: {fname}")
    print("\nNEXT STEP → Run probe-write.py to test write commands.")
    print("  Use the Wireshark capture (Phase 3/4) to inform the write commands to test.")


if __name__ == "__main__":
    main()

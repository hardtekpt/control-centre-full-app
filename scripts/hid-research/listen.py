#!/usr/bin/env python3
"""
Phase 2 — Passive HID Event Listener
Opens every Nova Pro HID interface simultaneously and logs all push events.
SteelSeries GG Engine may run alongside this script (read-only, no conflict).

Usage:
  python listen.py                   # listen on all interfaces
  python listen.py --pid 0x12E0      # restrict to a specific PID
  python listen.py --if 4            # restrict to interface number 4
  python listen.py --timeout 60      # stop automatically after 60 seconds

How to use:
  1. Run this script.
  2. Perform headset actions: turn volume knob, press mute button, rotate chatmix
     dial, disconnect/reconnect the headset, change ANC mode via the headset
     button, put the headset on the charger, open SteelSeries GG and change
     settings like sidetone or OLED brightness.
  3. Press Ctrl+C to stop. Results saved to listen-log-<timestamp>.json.
"""
import argparse
import json
import signal
import sys
import threading
import time
from datetime import datetime
from typing import Optional

try:
    import hid
except ImportError:
    print("ERROR: 'hid' package not found. Run: pip install hidapi")
    sys.exit(1)

STEELSERIES_VID = 0x1038
NOVA_PRO_PIDS: set[int] = {0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D}

# Commands already decoded in the current TypeScript project (baseStationEvents.ts).
# report_id → command_byte → description
KNOWN: dict[int, dict[int, str]] = {
    0x06: {
        0x25: "headset_volume",
        0xB5: "connection_state",
        0xB7: "battery_levels",
        0x85: "oled_brightness",
        0x39: "sidetone_level",
        0xBD: "anc_mode",
        0xBB: "mic_mute",
    },
    0x07: {
        0x25: "headset_volume",
        0xB5: "connection_state",
        0xB7: "battery_levels",
        0x85: "oled_brightness",
        0x39: "sidetone_level",
        0xBD: "anc_mode",
        0xBB: "mic_mute",
    },
}

events_log: list[dict] = []
stop_event = threading.Event()
log_lock = threading.Lock()


def decode(data: list[int]) -> Optional[str]:
    if len(data) < 2:
        return None
    r = data[0]
    c = data[1]
    return KNOWN.get(r, {}).get(c)


def hex_str(data: list[int]) -> str:
    return " ".join(f"{b:02X}" for b in data)


def listen_interface(path: bytes, label: str) -> None:
    try:
        dev = hid.device()
        dev.open_path(path)
        dev.set_nonblocking(True)
        print(f"  [OPEN] {label}")
    except Exception as e:
        print(f"  [FAIL] {label}: {e}")
        return

    try:
        while not stop_event.is_set():
            try:
                data = dev.read(64, timeout_ms=100)
            except Exception as e:
                print(f"  [READ ERROR] {label}: {e}")
                break

            if not data:
                continue

            ts = datetime.now().isoformat(timespec="milliseconds")
            decoded = decode(data)
            tag = f"[{decoded}]" if decoded else "[UNKNOWN]"
            h = hex_str(data)

            entry = {
                "ts": ts,
                "interface": label,
                "hex": h,
                "report_id": f"0x{data[0]:02X}",
                "command": f"0x{data[1]:02X}" if len(data) > 1 else None,
                "decoded": decoded,
                "bytes": list(data),
            }
            with log_lock:
                events_log.append(entry)

            known_marker = "" if decoded else "  ← NEW/UNKNOWN"
            print(f"  {ts}  {label:35s}  {tag:28s}  {h}{known_marker}")
    finally:
        try:
            dev.close()
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 2: Passive HID event listener")
    parser.add_argument("--pid", type=lambda x: int(x, 16), default=None, help="Filter to PID (hex, e.g. 0x12E0)")
    parser.add_argument("--if", dest="iface", type=int, default=None, help="Filter to interface number")
    parser.add_argument("--timeout", type=float, default=None, help="Stop after N seconds")
    parser.add_argument("--out", default=None, help="Output JSON file (default: listen-log-<timestamp>.json)")
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
        print("ERROR: No matching Arctis Nova Pro interfaces found.")
        print("  → Plug in the wireless dongle and try again.")
        sys.exit(1)

    print(f"Phase 2: Listening on {len(nova)} interface(s). Press Ctrl+C to stop.\n")
    print(f"  {'TIMESTAMP':<28}  {'INTERFACE':<35}  {'DECODED':<28}  HEX DATA")
    print("  " + "-" * 120)

    threads: list[threading.Thread] = []
    for d in sorted(nova, key=lambda x: (x.get("product_id", 0), x.get("interface_number", 0))):
        path = d["path"]
        label = f"PID=0x{d.get('product_id', 0):04X}/IF={d.get('interface_number', -1)}"
        t = threading.Thread(target=listen_interface, args=(path, label), daemon=True)
        t.start()
        threads.append(t)

    def handle_stop(sig, frame):  # noqa: ANN001
        print("\n\nStopping listener...")
        stop_event.set()

    signal.signal(signal.SIGINT, handle_stop)

    deadline = time.time() + args.timeout if args.timeout else None
    while not stop_event.is_set():
        if deadline and time.time() >= deadline:
            print(f"\nTimeout of {args.timeout}s reached.")
            stop_event.set()
        time.sleep(0.1)

    time.sleep(0.3)  # let threads drain

    fname = args.out or f"listen-log-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    with log_lock:
        snapshot = list(events_log)

    with open(fname, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2)

    unknown = [e for e in snapshot if not e["decoded"]]
    print(f"\nSaved {len(snapshot)} events to {fname}")
    print(f"  Known:   {len(snapshot) - len(unknown)}")
    print(f"  Unknown: {len(unknown)}")

    if unknown:
        print("\nUNKNOWN event byte patterns (candidates for further investigation):")
        seen: set[str] = set()
        for e in unknown:
            key = f"{e['report_id']} {e['command']}"
            if key not in seen:
                seen.add(key)
                print(f"  report={e['report_id']}  cmd={e['command']}  example: {e['hex'][:30]}")

    print("\nNEXT STEP → Run the Wireshark capture (Phase 3) while using GG Engine,")
    print("  then run parse-wireshark.py (Phase 4) to find write commands.")


if __name__ == "__main__":
    main()

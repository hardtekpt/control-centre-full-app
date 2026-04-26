#!/usr/bin/env python3
"""
Phase 6 — Write Command Tester
Tests specific HID write commands against the Nova Pro and observes push-event
responses. Each command is described with its expected effect and safe value
range before execution — the user must confirm each group.

IMPORTANT SAFETY RULES:
  1. Close SteelSeries GG Engine before running. GG will fight for the device.
  2. Run listen.py in a SEPARATE terminal first so you can see push events.
  3. Always start with the lowest/safest value for each command.
  4. Keep headset volume at a comfortable level throughout.

Usage:
  python probe-write.py                         # interactive — pick a command group
  python probe-write.py --group sidetone        # run a specific group non-interactively
  python probe-write.py --list                  # list available groups
  python probe-write.py --if 3 --group sidetone # target a specific interface

WORKFLOW:
  1. Open two terminals.
  2. Terminal A: python listen.py
  3. Terminal B: python probe-write.py
  4. In Terminal B, run each command group and watch Terminal A for the push events.
  5. Note which commands produce a matching push event — those are confirmed writes.
"""
import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from typing import Callable

try:
    import hid
except ImportError:
    print("ERROR: 'hid' package not found. Run: pip install hid")
    sys.exit(1)

STEELSERIES_VID = 0x1038
NOVA_PRO_PIDS: set[int] = {0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D}
PACKET_SIZE = 64
READ_TIMEOUT_MS = 300


@dataclass
class WriteCommand:
    name: str
    description: str
    # (b0, b1, extra_bytes, label)
    variants: list[tuple[int, int, list[int], str]] = field(default_factory=list)
    expected_push_event: str = ""
    interface_hint: int | None = None  # If None, try all


# ── Command groups ────────────────────────────────────────────────────────────
# Each group tests one headset setting with multiple values.
# Commands are sourced from the Nova 7X repo and are likely to transfer.
# The first byte is the report ID prefix (0x00 for most).
# The second byte is the command opcode.

COMMAND_GROUPS: list[WriteCommand] = [
    # ── HeadsetControl CONFIRMED commands for Nova Pro Wireless ────────────────
    # All use report ID 0x06 as byte0. Packet size on device is 31 bytes.
    # Padding to PACKET_SIZE (64) with zeros is safe for testing.
    WriteCommand(
        name="sidetone",
        description="★ CONFIRMED by HeadsetControl (nova_pro_wireless.hpp)\n"
                    "Sidetone level — how much mic audio you hear in the headset.\n"
                    "Opcode 0x39, values 0–3. Report ID byte0=0x06.\n"
                    "Expected push event: cmd 0x39 in data[1].",
        expected_push_event="sidetone_level (cmd 0x39)",
        variants=[
            (0x06, 0x39, [0x00], "★ sidetone OFF  [HeadsetControl: level 0]"),
            (0x06, 0x39, [0x01], "★ sidetone LOW  [HeadsetControl: level 1, input ≤42]"),
            (0x06, 0x39, [0x02], "★ sidetone MED  [HeadsetControl: level 2, input ≤85]"),
            (0x06, 0x39, [0x03], "★ sidetone HIGH [HeadsetControl: level 3, input >85]"),
        ],
    ),
    WriteCommand(
        name="oled_brightness",
        description="★ CONFIRMED by HeadsetControl (nova_pro_wireless.hpp)\n"
                    "LED/OLED brightness. Opcode 0xBF (NOT 0xAE or 0x85). Report ID byte0=0x06.\n"
                    "Strength range 1–10 (maps bool on/off to LED strength).\n"
                    "Push event may use cmd 0x85 (different opcode from write).",
        expected_push_event="oled_brightness (cmd 0x85)",
        variants=[
            (0x06, 0xBF, [0x01], "★ OLED brightness 1 (min) via 0xBF [HeadsetControl]"),
            (0x06, 0xBF, [0x05], "★ OLED brightness 5 (mid) via 0xBF [HeadsetControl]"),
            (0x06, 0xBF, [0x0A], "★ OLED brightness 10 (max) via 0xBF [HeadsetControl]"),
            (0x06, 0xBF, [0x05], "★ OLED brightness 5 (restore) via 0xBF"),
            # Cross-check — does write 0x85 also work?
            (0x06, 0x85, [0x05], "  alt: OLED via 0x85 (push event opcode — unlikely write)"),
        ],
    ),
    WriteCommand(
        name="idle_timeout",
        description="★ CONFIRMED by HeadsetControl (nova_pro_wireless.hpp)\n"
                    "Auto-off idle timeout. Opcode 0xC1 (NOT 0xA3). Report ID byte0=0x06.\n"
                    "Values are level indices 0–6 mapping to [disabled,1,5,10,15,30,60] min.",
        expected_push_event="idle timeout change event",
        variants=[
            (0x06, 0xC1, [0x00], "★ timeout DISABLED        [HeadsetControl level 0]"),
            (0x06, 0xC1, [0x01], "★ timeout 1 min           [HeadsetControl level 1]"),
            (0x06, 0xC1, [0x03], "★ timeout 10 min          [HeadsetControl level 3]"),
            (0x06, 0xC1, [0x05], "★ timeout 30 min          [HeadsetControl level 5]"),
            (0x06, 0xC1, [0x03], "★ timeout 10 min (restore)[HeadsetControl level 3]"),
        ],
    ),
    WriteCommand(
        name="eq_preset",
        description="★ CONFIRMED by HeadsetControl (nova_pro_wireless.hpp)\n"
                    "EQ preset selection. Opcode 0x2E. Report ID byte0=0x06.\n"
                    "Presets 0–3 are factory; preset 4 = custom (must select before writing bands).",
        expected_push_event="EQ preset event",
        variants=[
            (0x06, 0x2E, [0x00], "★ EQ preset 0 [HeadsetControl]"),
            (0x06, 0x2E, [0x01], "★ EQ preset 1 [HeadsetControl]"),
            (0x06, 0x2E, [0x04], "★ EQ preset 4 (custom) [HeadsetControl — required before eq_bands]"),
            (0x06, 0x2E, [0x00], "★ EQ preset 0 (restore)"),
        ],
    ),
    WriteCommand(
        name="eq_bands",
        description="★ CONFIRMED by HeadsetControl (nova_pro_wireless.hpp)\n"
                    "Write 10-band EQ. Opcode 0x33. Report ID byte0=0x06.\n"
                    "Formula: band_byte = 0x14 + (2 * gain_dB) for gain -10.0 to +10.0 dB.\n"
                    "0x14 = flat (0 dB). Must select preset 4 (custom) first via eq_preset group.\n"
                    "After writing bands, send save command (eq_save group) to persist.",
        expected_push_event="EQ bands event",
        variants=[
            # Flat EQ: all bands = 0x14 (baseline = 0 dB)
            (0x06, 0x33, [0x14]*10, "★ EQ flat (all bands 0 dB) [HeadsetControl formula verified]"),
            # Bass boost: band 0 (+4dB=0x1C), band 1 (+2dB=0x18), rest flat
            (0x06, 0x33, [0x1C, 0x18, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14, 0x14], "★ EQ bass boost test"),
            # Restore flat
            (0x06, 0x33, [0x14]*10, "★ EQ flat (restore)"),
        ],
    ),
    WriteCommand(
        name="eq_save",
        description="★ CONFIRMED by HeadsetControl (nova_pro_wireless.hpp)\n"
                    "Persist current EQ/settings to device flash. Opcode 0x09. Report ID byte0=0x06.\n"
                    "Send after eq_bands to make settings survive power cycle.",
        expected_push_event="save ack event",
        variants=[
            (0x06, 0x09, [], "★ SAVE to flash [HeadsetControl]"),
        ],
    ),
    # ── Nova Pro specific — not in HeadsetControl ─────────────────────────────
    WriteCommand(
        name="anc_mode",
        description="Nova Pro SPECIFIC — not in HeadsetControl.\n"
                    "ANC mode. Opcode inferred from push event 0xBD. Report ID byte0=0x06.\n"
                    "Values: 0=off, 1=transparency, 2=ANC. Requires Wireshark confirmation.",
        expected_push_event="anc_mode (cmd 0xBD)",
        variants=[
            (0x06, 0xBD, [0x00], "ANC OFF   [candidate — inferred from push event]"),
            (0x06, 0xBD, [0x01], "TRANSPARENCY [candidate]"),
            (0x06, 0xBD, [0x02], "ANC ON    [candidate]"),
            (0x06, 0xBD, [0x00], "ANC OFF   (restore)"),
            # Alt candidates
            (0x06, 0xBC, [0x00], "ANC OFF via 0xBC [alt candidate]"),
            (0x06, 0xBC, [0x01], "TRANSPARENCY via 0xBC"),
            (0x06, 0xBC, [0x02], "ANC ON via 0xBC"),
        ],
    ),
    WriteCommand(
        name="mic_mute",
        description="Nova Pro SPECIFIC — not in HeadsetControl.\n"
                    "Software mic mute. Push event uses cmd 0xBB. Report ID byte0=0x06.\n"
                    "Physical mute button triggers 0xBB push event. Write may use same opcode.",
        expected_push_event="mic_mute (cmd 0xBB)",
        variants=[
            (0x06, 0xBB, [0x00], "mic UNMUTE [candidate]"),
            (0x06, 0xBB, [0x01], "mic MUTE   [candidate]"),
            (0x06, 0xBB, [0x00], "mic UNMUTE (restore)"),
        ],
    ),
    WriteCommand(
        name="usb_input",
        description="Nova Pro SPECIFIC — not in HeadsetControl.\n"
                    "USB input switch (PC has two USB inputs: 1 or 2).\n"
                    "Opcode unknown — testing candidates based on 0xC1 space (confirmed idle timeout).",
        expected_push_event="USB input change event",
        variants=[
            (0x06, 0xC0, [0x01], "USB input 1 via 0xC0 [candidate]"),
            (0x06, 0xC0, [0x02], "USB input 2 via 0xC0 [candidate]"),
            (0x06, 0xC2, [0x01], "USB input 1 via 0xC2 [candidate]"),
            (0x06, 0xC2, [0x02], "USB input 2 via 0xC2 [candidate]"),
        ],
    ),
    WriteCommand(
        name="mic_volume",
        description="Nova 7X command 0x37 (unconfirmed on Nova Pro).\n"
                    "Now using correct report ID byte0=0x06.\n"
                    "Watch for a push event reporting mic volume change.",
        expected_push_event="mic volume change event",
        variants=[
            (0x06, 0x37, [0x03], "mic vol 3 (mid) via 0x37"),
            (0x06, 0x37, [0x05], "mic vol 5 via 0x37"),
            (0x06, 0x37, [0x03], "mic vol 3 (restore)"),
        ],
    ),
]

GROUP_MAP: dict[str, WriteCommand] = {g.name: g for g in COMMAND_GROUPS}


def make_packet(b0: int, b1: int, extra: list[int], size: int = PACKET_SIZE) -> list[int]:
    pkt = [0x00] * size
    pkt[0] = b0
    pkt[1] = b1
    for i, val in enumerate(extra):
        if 2 + i < size:
            pkt[2 + i] = val
    return pkt


def hex_str(data: list[int]) -> str:
    return " ".join(f"{b:02X}" for b in data)


def send_and_observe(
    dev: hid.device,
    pkt: list[int],
    label: str,
    wait_for_push_ms: int = 400,
) -> dict:
    print(f"\n  Sending: {hex_str(pkt[:8])}…  ({label})")
    result: dict = {"label": label, "sent": hex_str(pkt), "error": None, "push_events": []}

    try:
        dev.write(pkt)
    except Exception as e:
        result["error"] = str(e)
        print(f"  [WRITE ERROR] {e}")
        return result

    # Drain incoming push events for a short window
    deadline = time.monotonic() + (wait_for_push_ms / 1000)
    while time.monotonic() < deadline:
        try:
            data = dev.read(64, timeout_ms=50)
        except Exception:
            break
        if data and any(b != 0 for b in data):
            h = hex_str(data)
            result["push_events"].append(h)
            print(f"  ← PUSH: {h}")

    if not result["push_events"]:
        print("  ← (no push events received)")

    return result


def run_group(group: WriteCommand, devices: list[dict]) -> list[dict]:
    print(f"\n{'═' * 70}")
    print(f"  COMMAND GROUP: {group.name.upper()}")
    print(f"{'═' * 70}")
    print(f"  {group.description}")
    print(f"  Expected push event: {group.expected_push_event}")
    print()

    # Pick target interfaces
    targets = devices
    if group.interface_hint is not None:
        targets = [d for d in devices if d.get("interface_number") == group.interface_hint]
    if not targets:
        targets = devices

    all_results: list[dict] = []
    for d in sorted(targets, key=lambda x: (x.get("product_id", 0), x.get("interface_number", 0))):
        path = d["path"]
        label = f"PID=0x{d.get('product_id', 0):04X}/IF={d.get('interface_number', -1)}"
        print(f"  Interface: {label}")

        try:
            dev = hid.device()
            dev.open_path(path)
            dev.set_nonblocking(False)
        except Exception as e:
            print(f"  [CANNOT OPEN] {e}")
            continue

        for b0, b1, extra, variant_label in group.variants:
            pkt = make_packet(b0, b1, extra)
            confirm = input(f"\n  Ready to send [{b0:02X} {b1:02X} {' '.join(f'{v:02X}' for v in extra)}] ({variant_label}). Enter=send, s=skip, q=quit: ").strip().lower()
            if confirm == "q":
                dev.close()
                return all_results
            if confirm == "s":
                continue

            res = send_and_observe(dev, pkt, variant_label)
            res["interface"] = label
            res["group"] = group.name
            res["b0"] = f"0x{b0:02X}"
            res["b1"] = f"0x{b1:02X}"
            all_results.append(res)
            time.sleep(0.3)

        try:
            dev.close()
        except Exception:
            pass

    return all_results


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 6: Write command tester")
    parser.add_argument("--list", action="store_true", help="List available command groups")
    parser.add_argument("--group", help="Run a specific group (use name from --list)")
    parser.add_argument("--pid", type=lambda x: int(x, 16), help="Filter to PID (hex)")
    parser.add_argument("--if", dest="iface", type=int, help="Filter to interface number")
    parser.add_argument("--out", default="probe-write-results.json", help="Output JSON file")
    args = parser.parse_args()

    if args.list:
        print("Available command groups:")
        for g in COMMAND_GROUPS:
            print(f"  {g.name:20s}  {g.description.splitlines()[0]}")
        return

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

    print("\nPhase 6: Write Command Tester")
    print(f"  Interfaces: {len(nova)}")
    print()
    print("  ⚠  BEFORE PROCEEDING:")
    print("  1. Close SteelSeries GG Engine")
    print("  2. Open listen.py in another terminal to observe push events")
    print()

    groups_to_run: list[WriteCommand]
    if args.group:
        if args.group not in GROUP_MAP:
            print(f"ERROR: Unknown group '{args.group}'. Run with --list to see options.")
            sys.exit(1)
        groups_to_run = [GROUP_MAP[args.group]]
    else:
        print("Available groups:")
        for i, g in enumerate(COMMAND_GROUPS, 1):
            print(f"  {i:2d}. {g.name:20s}  {g.description.splitlines()[0]}")
        print()
        selection = input("Enter group names (comma-separated) or 'all': ").strip()
        if selection.lower() == "all":
            groups_to_run = list(COMMAND_GROUPS)
        else:
            names = [s.strip() for s in selection.split(",")]
            groups_to_run = []
            for name in names:
                if name in GROUP_MAP:
                    groups_to_run.append(GROUP_MAP[name])
                else:
                    print(f"  WARNING: Unknown group '{name}', skipping.")

    all_results: list[dict] = []
    for group in groups_to_run:
        results = run_group(group, nova)
        all_results.extend(results)

    # Save
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    # Summary
    confirmed = [r for r in all_results if r.get("push_events")]
    print(f"\n{'═' * 70}")
    print(f"WRITE TEST COMPLETE")
    print(f"{'═' * 70}")
    print(f"  Total commands sent : {len(all_results)}")
    print(f"  Produced push events: {len(confirmed)}")
    print()
    if confirmed:
        print("  CONFIRMED WRITES (produced a push event):")
        for r in confirmed:
            print(f"    {r['interface']:35s}  [{r['b0']} {r['b1']}]  {r['label']}")
            for evt in r["push_events"]:
                print(f"      ← {evt}")

    print(f"\nFull results saved to: {args.out}")
    print("\nNEXT STEP → Run build-map.py to consolidate all findings into command-map.json.")


if __name__ == "__main__":
    main()

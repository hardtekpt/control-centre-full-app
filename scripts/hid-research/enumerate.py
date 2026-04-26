#!/usr/bin/env python3
"""
Phase 1 — Device Enumeration
Finds all SteelSeries HID interfaces and prints their properties.
Saves enumerate-output.json for use by later phases.

Usage:
  python enumerate.py
  python enumerate.py --all     # include non-Nova-Pro SteelSeries devices
"""
import argparse
import json
import sys

try:
    import hid
except ImportError:
    print("ERROR: 'hid' package not found. Run: pip install hid")
    sys.exit(1)

STEELSERIES_VID = 0x1038

# All known Arctis Nova Pro Wireless product IDs.
# Add any newly discovered PIDs here.
NOVA_PRO_PIDS: dict[int, str] = {
    0x12CB: "Nova Pro Wireless (dongle A)",
    0x12CD: "Nova Pro Wireless (dongle B)",
    0x12E0: "Nova Pro Wireless",
    0x12E5: "Nova Pro Wireless X",
    0x225D: "Nova Pro (base station / wired)",
}


def fmt_pid(pid: int) -> str:
    return f"0x{pid:04X}"


def fmt_hex(value: int, width: int = 4) -> str:
    return f"0x{value:0{width}X}"


def safe_str(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode("utf-8", errors="replace")
        except Exception:
            return repr(value)
    return str(value) if value is not None else ""


def safe_path(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", errors="replace")
    return str(value) if value else ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Phase 1: HID device enumeration")
    parser.add_argument("--all", action="store_true", help="Show all SteelSeries devices, not just Nova Pro")
    parser.add_argument("--out", default="enumerate-output.json", help="Output JSON file")
    args = parser.parse_args()

    all_devices = hid.enumerate()
    ss_devices = [d for d in all_devices if d.get("vendor_id") == STEELSERIES_VID]
    nova_devices = [d for d in ss_devices if d.get("product_id") in NOVA_PRO_PIDS]
    other_devices = [d for d in ss_devices if d.get("product_id") not in NOVA_PRO_PIDS]

    print(f"Total HID interfaces on system : {len(all_devices)}")
    print(f"SteelSeries interfaces          : {len(ss_devices)}")
    print(f"Arctis Nova Pro interfaces      : {len(nova_devices)}")
    print()

    if not nova_devices:
        print("WARNING: No Arctis Nova Pro interfaces detected.")
        print("  → Ensure the wireless dongle is plugged in.")
        print("  → If using a different model, add its PID to NOVA_PRO_PIDS in this script.")

    print("=" * 70)
    print("ARCTIS NOVA PRO INTERFACES")
    print("=" * 70)

    rows: list[dict] = []
    for d in sorted(nova_devices, key=lambda x: (x.get("product_id", 0), x.get("interface_number", 0))):
        pid = d.get("product_id", 0)
        iface = d.get("interface_number", -1)
        usage_page = d.get("usage_page", 0)
        usage = d.get("usage", 0)
        product = safe_str(d.get("product_string"))
        manufacturer = safe_str(d.get("manufacturer_string"))
        path = safe_path(d.get("path"))
        pid_name = NOVA_PRO_PIDS.get(pid, "unknown")

        print()
        print(f"  PID         : {fmt_pid(pid)}  ({pid_name})")
        print(f"  Interface   : {iface}")
        print(f"  Usage Page  : {fmt_hex(usage_page)}")
        print(f"  Usage       : {fmt_hex(usage)}")
        print(f"  Product     : {product}")
        print(f"  Manufacturer: {manufacturer}")
        print(f"  Path        : {path}")

        rows.append({
            "pid": fmt_pid(pid),
            "pid_name": pid_name,
            "interface": iface,
            "usage_page": fmt_hex(usage_page),
            "usage": fmt_hex(usage),
            "product": product,
            "manufacturer": manufacturer,
            "path": path,
        })

    if args.all and other_devices:
        print()
        print("=" * 70)
        print("OTHER STEELSERIES DEVICES")
        print("=" * 70)
        for d in sorted(other_devices, key=lambda x: (x.get("product_id", 0), x.get("interface_number", 0))):
            pid = d.get("product_id", 0)
            iface = d.get("interface_number", -1)
            product = safe_str(d.get("product_string"))
            print(f"  PID={fmt_pid(pid)}  IF={iface}  {product}")

    output = {
        "steelseries_vid": fmt_hex(STEELSERIES_VID),
        "nova_pro_interfaces": rows,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print()
    print(f"Full output saved to: {args.out}")
    print()
    print("NEXT STEP → Run listen.py to capture live push events from the headset.")


if __name__ == "__main__":
    main()

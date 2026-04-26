#!/usr/bin/env node
/**
 * Phase 8 — Integration Validator
 * Tests confirmed write commands using the project's own node-hid build
 * (the same binary that runs inside Electron) and verifies the push-event
 * response format matches what baseStationEvents.ts expects.
 *
 * Run via Electron's Node to ensure the native node-hid ABI matches:
 *   npx electron scripts/hid-research/validate.cjs
 *
 * Or run under system Node (may work if node-hid is compatible):
 *   node scripts/hid-research/validate.cjs
 *
 * Arguments:
 *   --map   path/to/command-map.json   (default: command-map.json)
 *   --group sidetone                   (test only one group)
 *   --list                             (list testable commands)
 */

"use strict";

const path = require("node:path");
const fs = require("node:fs");

// ── node-hid resolution ────────────────────────────────────────────────────
let hid;
try {
  hid = require("node-hid");
} catch {
  try {
    hid = require(path.resolve(__dirname, "../../node_modules/node-hid"));
  } catch (e) {
    console.error("ERROR: node-hid not found.", e.message);
    console.error("Run from project root: npx electron scripts/hid-research/validate.cjs");
    process.exit(1);
  }
}

const STEELSERIES_VID = 0x1038;
const NOVA_PRO_PIDS = new Set([0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D]);
const PACKET_SIZE = 64;
const POLL_INTERVAL_MS = 120;
const PUSH_WINDOW_MS = 600;

// ── Known push event decoders (mirrors baseStationEvents.ts parseEvent) ────
const KNOWN_EVENTS = {
  0x25: "headset_volume",
  0xB5: "connection_state",
  0xB7: "battery_levels",
  0x85: "oled_brightness",
  0x39: "sidetone_level",
  0xBD: "anc_mode",
  0xBB: "mic_mute",
};

function parseEvent(data) {
  if (!data || data.length < 5) return null;
  const reportId = data[0];
  if (reportId !== 0x06 && reportId !== 0x07) return null;
  const cmd = data[1];
  const name = KNOWN_EVENTS[cmd];
  if (!name) return null;
  return { name, reportId: `0x${reportId.toString(16).toUpperCase()}`, cmd: `0x${cmd.toString(16).padStart(2, "0").toUpperCase()}`, data: Array.from(data) };
}

function hexStr(data) {
  return Array.from(data).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function makePacket(b0, b1, extra = []) {
  const pkt = new Array(PACKET_SIZE).fill(0);
  pkt[0] = b0;
  pkt[1] = b1;
  extra.forEach((v, i) => { if (2 + i < PACKET_SIZE) pkt[2 + i] = v; });
  return pkt;
}

// ── Test cases (hardcoded known-safe commands) ─────────────────────────────
const TEST_GROUPS = [
  {
    name: "sidetone",
    description: "Sidetone write via 0x39, confirm push event matches",
    expectedPushCmd: 0x39,
    commands: [
      { b0: 0x00, b1: 0x39, extra: [0x00], label: "sidetone OFF" },
      { b0: 0x00, b1: 0x39, extra: [0x01], label: "sidetone LOW" },
      { b0: 0x00, b1: 0x39, extra: [0x00], label: "sidetone OFF (restore)" },
    ],
  },
  {
    name: "anc_mode",
    description: "ANC mode write via 0xBD, confirm push event matches",
    expectedPushCmd: 0xBD,
    commands: [
      { b0: 0x00, b1: 0xBD, extra: [0x00], label: "ANC OFF" },
      { b0: 0x00, b1: 0xBD, extra: [0x01], label: "TRANSPARENCY" },
      { b0: 0x00, b1: 0xBD, extra: [0x00], label: "ANC OFF (restore)" },
    ],
  },
  {
    name: "oled_brightness",
    description: "OLED brightness write, try 0xAE (Nova 7X) and 0x85",
    expectedPushCmd: 0x85,
    commands: [
      { b0: 0x00, b1: 0xAE, extra: [0x02], label: "brightness 2 via 0xAE" },
      { b0: 0x00, b1: 0x85, extra: [0x05], label: "brightness 5 via 0x85" },
      { b0: 0x00, b1: 0xAE, extra: [0x02], label: "restore via 0xAE" },
    ],
  },
  {
    name: "mic_volume",
    description: "Mic volume write via 0x37",
    expectedPushCmd: null,
    commands: [
      { b0: 0x00, b1: 0x37, extra: [0x05], label: "mic vol 5" },
      { b0: 0x00, b1: 0x37, extra: [0x03], label: "mic vol 3 (restore)" },
    ],
  },
  {
    name: "volume_limiter",
    description: "Volume limiter toggle via 0x3A",
    expectedPushCmd: null,
    commands: [
      { b0: 0x00, b1: 0x3A, extra: [0x00], label: "limiter OFF" },
      { b0: 0x00, b1: 0x3A, extra: [0x01], label: "limiter ON" },
      { b0: 0x00, b1: 0x3A, extra: [0x00], label: "limiter OFF (restore)" },
    ],
  },
  {
    name: "idle_timeout",
    description: "Idle timeout via 0xA3 (minutes)",
    expectedPushCmd: null,
    commands: [
      { b0: 0x00, b1: 0xA3, extra: [0x0A], label: "timeout 10min" },
      { b0: 0x00, b1: 0xA3, extra: [0x0A], label: "timeout 10min (restore)" },
    ],
  },
];

const GROUP_MAP = Object.fromEntries(TEST_GROUPS.map((g) => [g.name, g]));

// ── Device discovery ────────────────────────────────────────────────────────
function findNovaPro() {
  const all = hid.devices();
  return all.filter(
    (d) => d.vendorId === STEELSERIES_VID && NOVA_PRO_PIDS.has(d.productId)
  ).sort((a, b) => a.path.localeCompare(b.path));
}

function openDevice(path_) {
  const dev = new hid.HID(path_);
  return dev;
}

// ── Test runner ─────────────────────────────────────────────────────────────
function drainPushEvents(devices, windowMs) {
  const events = [];
  const start = Date.now();
  while (Date.now() - start < windowMs) {
    for (const dev of devices) {
      try {
        const data = dev.readTimeout(POLL_INTERVAL_MS);
        if (data && data.length > 0) {
          const parsed = parseEvent(data);
          events.push({ raw: hexStr(data), parsed });
        }
      } catch {
        // ignore read timeouts
      }
    }
  }
  return events;
}

async function runGroup(group, devices) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  GROUP: ${group.name.toUpperCase()}`);
  console.log(`  ${group.description}`);
  console.log(`${"═".repeat(70)}`);

  const results = [];

  for (const cmd of group.commands) {
    const pkt = makePacket(cmd.b0, cmd.b1, cmd.extra);
    const sentHex = hexStr(pkt.slice(0, 8)) + "…";
    console.log(`\n  Sending: [${sentHex}]  (${cmd.label})`);

    let written = false;
    for (const dev of devices) {
      try {
        dev.write(pkt);
        written = true;
        break;
      } catch {
        // try next device
      }
    }

    if (!written) {
      console.log("  [WRITE FAILED on all interfaces]");
      results.push({ ...cmd, written: false, pushEvents: [] });
      continue;
    }

    await new Promise((r) => setTimeout(r, 50));
    const pushEvents = drainPushEvents(devices, PUSH_WINDOW_MS);

    if (pushEvents.length > 0) {
      for (const evt of pushEvents) {
        const tag = evt.parsed ? `[${evt.parsed.name}]` : "[UNKNOWN]";
        console.log(`  ← PUSH: ${tag}  ${evt.raw}`);
      }
    } else {
      console.log("  ← (no push events)");
    }

    const matchesPush = group.expectedPushCmd !== null &&
      pushEvents.some((e) => e.parsed && e.parsed.cmd === `0x${group.expectedPushCmd.toString(16).padStart(2, "0").toUpperCase()}`);

    results.push({
      label: cmd.label,
      b0: `0x${cmd.b0.toString(16).padStart(2, "0").toUpperCase()}`,
      b1: `0x${cmd.b1.toString(16).padStart(2, "0").toUpperCase()}`,
      written: true,
      pushEvents: pushEvents.map((e) => e.raw),
      matchesExpectedPush: matchesPush,
    });

    await new Promise((r) => setTimeout(r, 300));
  }

  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const listMode = args.includes("--list");
  const groupArg = args[args.indexOf("--group") + 1] || null;

  if (listMode) {
    console.log("Available test groups:");
    for (const g of TEST_GROUPS) {
      console.log(`  ${g.name.padEnd(20)}  ${g.description}`);
    }
    return;
  }

  console.log("\nPhase 8: Integration Validator");
  console.log("Using node-hid version:", hid.HID ? "(loaded)" : "(missing)");
  console.log("\n⚠  Ensure SteelSeries GG Engine is CLOSED.\n");

  const candidates = findNovaPro();
  if (candidates.length === 0) {
    console.error("ERROR: No Arctis Nova Pro interfaces found. Plug in the dongle.");
    process.exit(1);
  }

  console.log(`Found ${candidates.length} Nova Pro interface(s):`);
  for (const c of candidates) {
    console.log(`  PID=0x${c.productId.toString(16).toUpperCase()}  IF=${c.interface}  ${c.path}`);
  }

  const devices = [];
  for (const c of candidates) {
    try {
      devices.push(openDevice(c.path));
    } catch (e) {
      console.warn(`  [SKIP] Cannot open IF=${c.interface}: ${e.message}`);
    }
  }

  if (devices.length === 0) {
    console.error("ERROR: Could not open any interfaces. Is GG Engine still running?");
    process.exit(1);
  }

  const groupsToRun = groupArg
    ? [GROUP_MAP[groupArg]].filter(Boolean)
    : TEST_GROUPS;

  if (groupsToRun.length === 0) {
    console.error(`Unknown group: ${groupArg}`);
    process.exit(1);
  }

  const allResults = {};
  for (const group of groupsToRun) {
    allResults[group.name] = await runGroup(group, devices);
  }

  for (const dev of devices) {
    try { dev.close(); } catch { /* ignore */ }
  }

  // Summary
  console.log(`\n${"═".repeat(70)}`);
  console.log("VALIDATION SUMMARY");
  console.log(`${"═".repeat(70)}`);

  const outLines = [];
  for (const [groupName, results] of Object.entries(allResults)) {
    const confirmed = results.filter((r) => r.matchesExpectedPush);
    const hasPush = results.filter((r) => r.pushEvents && r.pushEvents.length > 0);
    console.log(`\n  ${groupName}:`);
    console.log(`    Commands sent       : ${results.length}`);
    console.log(`    Produced push events: ${hasPush.length}`);
    console.log(`    Matched expected cmd: ${confirmed.length}`);
    outLines.push({ group: groupName, results });
  }

  const fname = `validate-results-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  fs.writeFileSync(fname, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to: ${fname}`);
  console.log("\nNEXT STEP → Update command-map.json with confirmed commands,");
  console.log("  then implement HidWriterService in src/main/services/apis/arctis/.");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

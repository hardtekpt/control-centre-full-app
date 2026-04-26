import { useEffect, useRef, useState } from "react";
import type { HidDeviceEntry, HidInfoPayload, HidRawEvent } from "@shared/ipc";

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function commandName(cmd: number | null): string {
  if (cmd === null) return "?";
  const names: Record<number, string> = {
    0x25: "VOLUME",
    0xb5: "CONNECTIVITY",
    0xb7: "BATTERY",
    0x85: "OLED_BRIGHTNESS",
    0x39: "SIDETONE",
    0xbd: "ANC_MODE",
    0xbb: "MIC_MUTE",
  };
  return names[cmd] ?? `0x${cmd.toString(16).toUpperCase().padStart(2, "0")}`;
}

function DecodedBadges({ decoded }: { decoded: Record<string, string | number | boolean> }) {
  return (
    <span className="hid-decoded">
      {Object.entries(decoded).map(([k, v]) => (
        <span key={k} className="hid-badge">
          {k}: <strong>{String(v)}</strong>
        </span>
      ))}
    </span>
  );
}

function EventRow({ event }: { event: HidRawEvent }) {
  return (
    <div className="hid-event-row">
      <span className="hid-event-ts">{formatTimestamp(event.timestamp)}</span>
      <span className="hid-event-cmd">{commandName(event.command)}</span>
      <span className="hid-event-hex">{event.hex}</span>
      {event.decoded && Object.keys(event.decoded).length > 0 && (
        <DecodedBadges decoded={event.decoded} />
      )}
    </div>
  );
}

function DeviceRow({ device }: { device: HidDeviceEntry }) {
  const vid = `0x${device.vendorId.toString(16).toUpperCase().padStart(4, "0")}`;
  const pid = `0x${device.productId.toString(16).toUpperCase().padStart(4, "0")}`;
  return (
    <div className="hid-device-row">
      <span className="hid-device-path" title={device.path}>{device.path}</span>
      <span className="hid-device-meta">VID {vid} · PID {pid} · IF {device.interfaceNumber}</span>
    </div>
  );
}

export default function HidSettingsTab() {
  const [events, setEvents] = useState<HidRawEvent[]>([]);
  const [devices, setDevices] = useState<HidDeviceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const autoScrollRef = useRef(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.arctisBridge.getHidInfo().then((info: HidInfoPayload) => {
      setDevices(info.devices);
      setEvents(info.recentEvents);
      setLoading(false);
    });
    const unsub = window.arctisBridge.onHidEvent((event: HidRawEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, 200));
    });
    return unsub;
  }, []);

  function handleClear() {
    setEvents([]);
  }

  return (
    <>
      <h3>HID</h3>

      <div className="settings-section">
        <div className="hid-log-header">
          <span className="settings-section-title" style={{ marginBottom: 0 }}>Event Log</span>
          <button className="btn btn-sm" onClick={handleClear} disabled={events.length === 0}>
            Clear
          </button>
        </div>
        <div className="logs-list hid-event-list" ref={listRef}>
          {loading && <div className="log-line">Loading…</div>}
          {!loading && events.length === 0 && (
            <div className="log-line">No events yet. HID events will appear here when the headset communicates.</div>
          )}
          {events.map((ev) => (
            <EventRow key={`${ev.timestamp}-${ev.hex.slice(0, 8)}`} event={ev} />
          ))}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Hardware</div>
        {devices.length === 0 ? (
          <div className="hid-device-empty">No HID devices currently open.</div>
        ) : (
          devices.map((d) => <DeviceRow key={d.path} device={d} />)
        )}
        <div className="hid-hw-meta">
          Vendor: SteelSeries (0x1038) · Interface: 4 · Supported PIDs: 0x12CB, 0x12CD, 0x12E0, 0x12E5, 0x225D
        </div>
      </div>
    </>
  );
}

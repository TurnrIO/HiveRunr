import { useState, useEffect, useRef } from "react";

const COMMON_TZ = [
  "UTC",
  "Europe/London","Europe/Paris","Europe/Berlin","Europe/Amsterdam",
  "Europe/Madrid","Europe/Rome","Europe/Stockholm","Europe/Warsaw",
  "Europe/Athens","Europe/Helsinki","Europe/Lisbon",
  "America/New_York","America/Chicago","America/Denver","America/Los_Angeles",
  "America/Toronto","America/Vancouver","America/Sao_Paulo","America/Mexico_City",
  "America/Buenos_Aires","America/Bogota","America/Lima",
  "Asia/Dubai","Asia/Kolkata","Asia/Dhaka","Asia/Bangkok",
  "Asia/Singapore","Asia/Hong_Kong","Asia/Shanghai","Asia/Tokyo","Asia/Seoul",
  "Asia/Karachi","Asia/Tashkent","Asia/Yekaterinburg",
  "Australia/Sydney","Australia/Melbourne","Australia/Perth","Australia/Brisbane",
  "Pacific/Auckland","Pacific/Honolulu","Pacific/Fiji",
  "Africa/Cairo","Africa/Lagos","Africa/Nairobi","Africa/Johannesburg",
];

export function TimezoneSelect({ value, onChange }) {
  const [search, setSearch] = useState("");
  const [open, setOpen]     = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function close(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const filtered = search
    ? COMMON_TZ.filter(tz => tz.toLowerCase().includes(search.toLowerCase()))
    : COMMON_TZ;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        value={open ? search : (value || "UTC")}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        onFocus={() => { setSearch(""); setOpen(true); }}
        placeholder="UTC"
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-elev)", border: "1px solid var(--accent)", borderRadius: 8,
          zIndex: 999, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted-2)" }}>No matches</div>
          )}
          {filtered.map(tz => (
            <div key={tz}
              onMouseDown={() => { onChange(tz); setSearch(""); setOpen(false); }}
              style={{ padding: "7px 12px", cursor: "pointer", fontSize: 12, background: tz === value ? "var(--bg-hover)" : "", color: tz === value ? "var(--text)" : "var(--text-muted)" }}
              onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
              onMouseLeave={e => e.currentTarget.style.background = tz === value ? "var(--bg-hover)" : ""}>
              {tz}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

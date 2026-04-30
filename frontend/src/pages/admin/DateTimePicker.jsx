export function DateTimePicker({ value, onChange, required }) {
  const pad = n => String(n).padStart(2, "0");

  const datePart = value ? value.split("T")[0] : "";
  const timePart = value ? (value.split("T")[1] || "09:00") : "09:00";

  function combine(d, t) {
    if (!d) { onChange(""); return; }
    onChange(`${d}T${t || "09:00"}`);
  }

  function localStr(dt) {
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  const picks = [
    { label: "In 1 hour",    fn: () => { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; } },
    { label: "In 4 hours",   fn: () => { const d = new Date(); d.setHours(d.getHours() + 4, 0, 0, 0); return d; } },
    { label: "Tonight 8pm",  fn: () => { const d = new Date(); d.setHours(20, 0, 0, 0); return d; } },
    { label: "Tomorrow 9am", fn: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
    { label: "Mon 9am",      fn: () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; } },
  ];

  const inputStyle = {
    background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 6,
    padding: "6px 10px", color: "var(--text)", fontSize: 13, colorScheme: "auto",
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
        <input type="date" value={datePart}
          onChange={e => combine(e.target.value, timePart)}
          required={required}
          style={{ ...inputStyle, flex: 1 }} />
        <input type="time" value={timePart}
          onChange={e => combine(datePart, e.target.value)}
          style={{ ...inputStyle, width: 110, flex: "none" }} />
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {picks.map(p => (
          <button key={p.label} type="button" onClick={() => onChange(localStr(p.fn()))}
            style={{ padding: "3px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text-muted)", fontWeight: 500 }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--accent)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

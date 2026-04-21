// ── Sticky note colour palette ─────────────────────────────────────────────────
export const NOTE_COLORS = {
  amber:  { bg:"#854d0e22", border:"#b45309", text:"#fde68a", sub:"#92400e" },
  blue:   { bg:"#1e3a8a22", border:"#2563eb", text:"#93c5fd", sub:"#1e3a8a" },
  green:  { bg:"#064e3b22", border:"#059669", text:"#6ee7b7", sub:"#065f46" },
  purple: { bg:"#3b076422", border:"#7c3aed", text:"#c4b5fd", sub:"#4c1d95" },
  red:    { bg:"#450a0a22", border:"#dc2626", text:"#fca5a5", sub:"#7f1d1d" },
  slate:  { bg:"#1e293b22", border:"#475569", text:"#94a3b8", sub:"#334155" },
};

export function StickyNote({ id, data, selected }) {
  const cfg  = data.config || {};
  const text = cfg.text || "Double-click to edit in config panel →";
  const clr  = NOTE_COLORS[cfg.colour] || NOTE_COLORS.amber;
  const w    = cfg.width  ? (parseInt(cfg.width)  || 200) : 200;
  const h    = cfg.height ? (parseInt(cfg.height) || 100) : 100;
  return (
    <div
      className={`note-node${selected ? " selected" : ""}`}
      style={{
        background: clr.bg,
        borderColor: clr.border,
        minWidth: w + "px",
        minHeight: h + "px",
        boxShadow: selected
          ? `0 0 0 2px ${clr.border}66, 0 4px 12px rgba(0,0,0,.3)`
          : "0 4px 12px rgba(0,0,0,.3)",
      }}
    >
      <div className="note-body" style={{ color: clr.text }}>{text}</div>
      <div className="note-id" style={{ color: clr.sub }}>#{id}</div>
    </div>
  );
}

import { useEffect } from "react";

const CANVAS_SHORTCUTS = [
  { section: "Flow management" },
  { key: "Ctrl + S",          desc: "Save flow" },
  { key: "Ctrl + Z",          desc: "Undo" },
  { key: "Ctrl + Y",          desc: "Redo  (Mac: Ctrl + Shift + Z)" },
  { key: "Ctrl + F",          desc: "Search / filter nodes" },
  { section: "Multi-select & clipboard" },
  { key: "Shift + click",     desc: "Add node to selection" },
  { key: "Left drag",         desc: "Drag-to-select box (marquee)" },
  { key: "Middle drag",       desc: "Pan the canvas" },
  { key: "Ctrl + A",          desc: "Select all nodes" },
  { key: "Ctrl + C",          desc: "Copy selected nodes" },
  { key: "Ctrl + V",          desc: "Paste copied nodes (offset each paste)" },
  { key: "Ctrl + D",          desc: "Duplicate selected nodes in-place" },
  { section: "Nodes" },
  { key: "Click node",        desc: "Select & open config panel" },
  { key: "Double-click node", desc: "Open node editor" },
  { key: "Right-click node",  desc: "Context menu (copy, paste, rename, duplicate, delete)" },
  { key: "Delete",            desc: "Delete selected node(s)" },
  { key: "Drag from sidebar", desc: "Drop a new node onto the canvas" },
  { section: "Canvas" },
  { key: "Escape",            desc: "Deselect / close open panel" },
  { key: "Scroll / Pinch",   desc: "Zoom in and out" },
  { key: "Middle drag",       desc: "Pan the canvas" },
  { section: "Other" },
  { key: "🗺  (topbar / ⋯)", desc: "Toggle minimap" },
  { key: "?",                 desc: "Toggle this cheatsheet" },
];

function KBD({ children }) {
  return (
    <kbd style={{
      background: "#0f1117", border: "1px solid #374151", borderRadius: 5,
      padding: "2px 7px", fontSize: 10, color: "#a78bfa", fontFamily: "monospace",
      whiteSpace: "nowrap", boxShadow: "0 1px 0 #374151", display: "inline-block",
    }}>
      {children}
    </kbd>
  );
}

/**
 * ShortcutsModal — canvas keyboard shortcut cheatsheet.
 */
export function ShortcutsModal({ onClose }) {
  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, []);

  return (
    <div
      className="modal-overlay"
      aria-hidden="true"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal"
        style={{ maxWidth: 420, padding: "18px 20px", maxHeight: "80vh", overflowY: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0" }}>⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {CANVAS_SHORTCUTS.map((row, i) =>
          row.section
            ? (
              <div key={i} style={{
                fontSize: 10, color: "#6366f1", fontWeight: 700, textTransform: "uppercase",
                letterSpacing: ".06em", margin: i === 0 ? "0 0 8px" : "14px 0 8px",
                paddingBottom: 5, borderBottom: "1px solid #1e2235",
              }}>
                {row.section}
              </div>
            )
            : (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 7 }}>
                <KBD>{row.key}</KBD>
                <span style={{ color: "#94a3b8", fontSize: 12, flex: 1 }}>{row.desc}</span>
              </div>
            )
        )}

        <div style={{
          marginTop: 16, paddingTop: 12, borderTop: "1px solid #2a2d3e",
          fontSize: 11, color: "#475569", textAlign: "center",
        }}>
          Press <KBD>?</KBD> or use <strong style={{ color: "#64748b" }}>⋯ → Keyboard shortcuts</strong> to reopen
        </div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { NODE_DEFS } from "./nodeDefs.js";

const SEARCH_GROUPS = [
  { key: "all",         label: "All" },
  { key: "trigger",     label: "Triggers" },
  { key: "action",      label: "Actions" },
  { key: "integration", label: "Integrations" },
  { key: "utility",     label: "Utility" },
];

/**
 * NodeSearchBar — floating Ctrl+F search bar for jumping to canvas nodes.
 * Positioned absolute within the ReactFlow wrapper.
 */
export function NodeSearchBar({ nodes, onJump, onClose }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [onClose]);

  const q = query.trim().toLowerCase();

  const results = nodes.filter(n => {
    const def   = NODE_DEFS[n.data?.type] || {};
    const label = (n.data?.label || def.label || n.data?.type || "").toLowerCase();
    const type  = (n.data?.type || "").toLowerCase();
    const grp   = def.group || "action";
    if (group !== "all" && grp !== group) return false;
    if (!q) return true;
    return label.includes(q) || type.includes(q);
  });

  return (
    <div
      style={{
        position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)",
        zIndex: 9999, width: 380, background: "#1a1d2e", border: "1px solid #6366f1",
        borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,.6)", overflow: "hidden",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Search nodes"
      onClick={e => e.stopPropagation()}
    >
      {/* Input row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 12px", borderBottom: "1px solid #2a2d3e",
      }}>
        <span style={{ color: "#6366f1", fontSize: 14 }}>🔍</span>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search by label or type…"
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "#e2e8f0", fontSize: 13, fontFamily: "inherit",
          }}
          aria-label="Node search query"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 13, padding: 0 }}
            aria-label="Clear search"
          >✕</button>
        )}
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 13, padding: 0, marginLeft: 2 }}
          aria-label="Close search"
        >✕</button>
      </div>

      {/* Group filter chips */}
      <div style={{
        display: "flex", gap: 6, padding: "8px 12px",
        borderBottom: "1px solid #2a2d3e", flexWrap: "wrap",
      }}>
        {SEARCH_GROUPS.map(g => (
          <button
            key={g.key}
            onClick={() => setGroup(g.key)}
            style={{
              background: group === g.key ? "#6366f1" : "#0f1117",
              color:      group === g.key ? "#fff"    : "#94a3b8",
              border:     group === g.key ? "1px solid #6366f1" : "1px solid #374151",
              borderRadius: 20, padding: "2px 10px", fontSize: 11,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {results.length === 0 ? (
          <div style={{ padding: "16px 12px", color: "#475569", fontSize: 12, textAlign: "center" }}>
            No nodes match
          </div>
        ) : (
          results.map(n => {
            const def = NODE_DEFS[n.data?.type] || {};
            const lbl = n.data?.label || def.label || n.data?.type || "Node";
            const typ = n.data?.type || "";
            const clr = def.color || "#475569";
            return (
              <button
                key={n.id}
                onClick={() => { onJump(n); onClose(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                  background: "none", border: "none", borderBottom: "1px solid #12151f",
                  padding: "8px 12px", cursor: "pointer", textAlign: "left",
                  fontFamily: "inherit",
                }}
                onMouseEnter={e => e.currentTarget.style.background = "#1e2235"}
                onMouseLeave={e => e.currentTarget.style.background = "none"}
                title={`Jump to: ${lbl}`}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: 6, background: clr,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, flexShrink: 0,
                }}>
                  {def.icon || "⬡"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    color: "#e2e8f0", fontSize: 12, fontWeight: 600,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{lbl}</div>
                  <div style={{ color: "#475569", fontSize: 10, marginTop: 1, fontFamily: "monospace" }}>{typ}</div>
                </div>
                <span style={{ color: "#4b5563", fontSize: 10, whiteSpace: "nowrap" }}>⏎ jump</span>
              </button>
            );
          })
        )}
        {!q && results.length > 0 && (
          <div style={{ padding: "6px 12px", color: "#374151", fontSize: 10, textAlign: "center" }}>
            {results.length} node{results.length !== 1 ? "s" : ""} on canvas
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * CommandPalette — Ctrl+K global search.
 *
 * Searches flows, run IDs/names, credentials, and settings pages.
 * Results are keyboard-navigable; Enter / click jumps to the result.
 *
 * Usage:
 *   <CommandPalette open={open} onClose={() => setOpen(false)} navigate={navigate} />
 *
 * The parent is responsible for toggling open via Ctrl+K / Cmd+K.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client.js";
import { useFocusTrap } from "./useFocusTrap.js";

const STATIC_PAGES = [
  { type: "page", label: "Dashboard",      icon: "🏠", path: "/" },
  { type: "page", label: "Canvas Flows",   icon: "🔄", path: "/graphs" },
  { type: "page", label: "Metrics",        icon: "📊", path: "/metrics" },
  { type: "page", label: "Run Logs",       icon: "📋", path: "/logs" },
  { type: "page", label: "Credentials",    icon: "🔑", path: "/credentials" },
  { type: "page", label: "Schedules",      icon: "⏰", path: "/schedules" },
  { type: "page", label: "Templates",      icon: "📦", path: "/templates" },
  { type: "page", label: "Users",          icon: "👥", path: "/users" },
  { type: "page", label: "Audit Log",      icon: "🔍", path: "/audit" },
  { type: "page", label: "Settings",       icon: "⚙",  path: "/settings" },
  { type: "page", label: "Workspaces",     icon: "🏢", path: "/workspaces" },
  { type: "page", label: "System",         icon: "🖥",  path: "/system" },
];

const TYPE_COLOR = {
  page:       "#7c3aed",
  flow:       "#059669",
  run:        "#0891b2",
  credential: "#d97706",
};

function highlight(text, q) {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "#4338ca44", color: "#a5b4fc", borderRadius: 2 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function resultKey(item) {
  if (item.type === "page") return `page:${item.path}`;
  if (item.type === "flow") return `flow:${item.hash || item.label}`;
  if (item.type === "run") return `run:${item.runId || item.label}`;
  if (item.type === "credential") return `credential:${item.label}`;
  return `${item.type}:${item.label}`;
}

export function CommandPalette({ open, onClose, navigate }) {
  const [query, setQuery]       = useState("");
  const [results, setResults]   = useState([]);
  const [cursor, setCursor]     = useState(0);
  const [loading, setLoading]   = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, onClose);
  const requestIdRef = useRef(0);
  const catalogRef = useRef({ graphs: [], credentials: [] });

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(STATIC_PAGES.slice(0, 8));
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      requestIdRef.current += 1;
      setLoading(false);
    }
  }, [open]);

  // Prefetch relatively static catalogs once per open instead of once per keystroke.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      api("GET", "/api/graphs").catch(() => []),
      api("GET", "/api/credentials").catch(() => []),
    ]).then(([graphs, credentials]) => {
      if (cancelled) return;
      catalogRef.current = {
        graphs: graphs || [],
        credentials: credentials || [],
      };
      setCatalogVersion(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [open]);

  // Search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(STATIC_PAGES.slice(0, 8));
      setCursor(0);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    async function search() {
      const items = [];
      const qLower = q.toLowerCase();
      const { graphs, credentials } = catalogRef.current;

      // Static pages
      STATIC_PAGES.forEach(p => {
        if (p.label.toLowerCase().includes(qLower))
          items.push(p);
      });

      // Flows — filter the prefetched graph list locally.
      (graphs || []).forEach(g => {
        const name = (g.name || "").toLowerCase();
        const description = (g.description || "").toLowerCase();
        if (name.includes(qLower) || description.includes(qLower)) {
          items.push({
            type: "flow",
            label: g.name,
            sub: g.description || `#${g.id} · ${g.enabled ? "enabled" : "disabled"}`,
            icon: "🔄",
            path: `/graphs`,
            hash: `graph-${g.id}`,
            canvasHref: `/canvas#graph-${g.id}`,
          });
        }
      });

      // Runs — search by ID or flow name
      try {
        const enc = encodeURIComponent(q);
        const data = await api("GET", `/api/runs?q=${enc}&page_size=5`);
        (data.runs ?? data ?? []).forEach(r => {
          items.push({
            type: "run",
            runId: r.id || r.task_id,
            label: `Run #${r.id} — ${r.flow_name || r.workflow || "unknown"}`,
            sub: `${r.status} · ${r.created_at ? new Date(r.created_at).toLocaleString() : ""}`,
            icon: "▶",
            path: "/logs",
          });
        });
      } catch {}

      // Credentials — filter the prefetched list locally.
      (credentials || []).forEach(c => {
        if ((c.name || "").toLowerCase().includes(qLower)) {
          items.push({
            type: "credential",
            label: c.name,
            sub: c.type || "credential",
            icon: "🔑",
            path: "/credentials",
          });
        }
      });

      if (requestId === requestIdRef.current) {
        setResults(items.slice(0, 12));
        setCursor(0);
        setLoading(false);
      }
    }

    const t = setTimeout(search, 180);
    return () => { clearTimeout(t); };
  }, [open, query, catalogVersion]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[cursor];
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = useCallback((item) => {
    if (!item) return;
    if (item.canvasHref) {
      window.location.href = item.canvasHref;
    } else {
      navigate(item.path);
    }
    onClose();
  }, [navigate, onClose]);

  function onKeyDown(e) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter")     { go(results[cursor]); }
  }

  if (!open) return null;

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Command palette"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh",
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      ref={dialogRef}
    >
      <div style={{
        width: "min(580px, 94vw)", background: "#13152a",
        border: "1px solid #3730a3", borderRadius: 12,
        boxShadow: "0 24px 60px #0008",
        overflow: "hidden",
      }}>
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid #1e2235", gap: 10 }}>
          <span style={{ color: "#64748b", fontSize: 16 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search flows, runs, credentials, pages…"
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              color: "#e2e8f0", fontSize: 15,
            }}
          />
          {loading && <span style={{ color: "#4b5563", fontSize: 11 }}>…</span>}
          <kbd style={{ fontSize: 10, color: "#4b5563", background: "#1e2235", borderRadius: 4, padding: "2px 6px", border: "1px solid #2a2d3e" }}>Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight: 380, overflowY: "auto" }}>
          {results.length === 0 && !loading && (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "#4b5563", fontSize: 13 }}>
              No results for "{query}"
            </div>
          )}
          {results.map((item, i) => (
            <div
              key={resultKey(item)}
              onClick={() => go(item)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 14px", cursor: "pointer",
                background: cursor === i ? "#1e1b4b" : "transparent",
                borderBottom: "1px solid #1a1d2e",
                transition: "background .08s",
              }}
              onMouseEnter={() => setCursor(i)}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {highlight(item.label, query)}
                </div>
                {item.sub && (
                  <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.sub}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 9, fontWeight: 600, padding: "1px 6px", borderRadius: 8,
                background: `${TYPE_COLOR[item.type]}22`,
                color: TYPE_COLOR[item.type],
                border: `1px solid ${TYPE_COLOR[item.type]}44`,
                flexShrink: 0,
              }}>{item.type}</span>
              {cursor === i && (
                <kbd style={{ fontSize: 9, color: "#64748b", background: "#1e2235", borderRadius: 3, padding: "1px 5px", border: "1px solid #2a2d3e", flexShrink: 0 }}>↵</kbd>
              )}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ padding: "6px 14px", borderTop: "1px solid #1e2235", display: "flex", gap: 14, fontSize: 10, color: "#334155" }}>
          <span><kbd style={{ background: "#1e2235", borderRadius: 3, padding: "1px 4px", border: "1px solid #2a2d3e" }}>↑↓</kbd> navigate</span>
          <span><kbd style={{ background: "#1e2235", borderRadius: 3, padding: "1px 4px", border: "1px solid #2a2d3e" }}>↵</kbd> open</span>
          <span><kbd style={{ background: "#1e2235", borderRadius: 3, padding: "1px 4px", border: "1px solid #2a2d3e" }}>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

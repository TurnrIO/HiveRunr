import { useState, useEffect, useRef } from "react";

export function FlowPicker({ value, onChange, graphs, scripts }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen]   = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => { if (!value) setQuery(""); }, [value]);

  useEffect(() => {
    if (!open) return;
    function close(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const q = (query || "").toLowerCase();
  const filteredGraphs  = (graphs  || []).filter(g => (g.name || "").toLowerCase().includes(q)).slice(0, 20);
  const filteredScripts = (scripts || []).filter(s => (s.name || "").toLowerCase().includes(q)).slice(0, 20);
  const hasResults = filteredGraphs.length > 0 || filteredScripts.length > 0;

  function selectGraph(g)  { setQuery(g.name);              onChange({ workflow: g.name,             graph_id: g.id   }); setOpen(false); }
  function selectScript(s) { setQuery("script:" + s.name); onChange({ workflow: "script:" + s.name, graph_id: null   }); setOpen(false); }
  function handleInput(e)  { setQuery(e.target.value); onChange({ workflow: e.target.value, graph_id: null }); setOpen(true); }

  const sectionLabel = {
    padding: "4px 12px 2px", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
    textTransform: "uppercase", color: "var(--text-muted-2)", background: "var(--bg-elev-2)",
  };
  const itemStyle = {
    padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "space-between", borderBottom: "1px solid var(--border)", fontSize: 13,
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input required value={query} onChange={handleInput} onFocus={() => setOpen(true)}
        placeholder="Search flows &amp; scripts…" autoComplete="off" style={{ width: "100%" }} />
      {open && hasResults && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-elev)", border: "1px solid var(--accent)", borderRadius: 8,
          zIndex: 999, maxHeight: 260, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.5)",
        }}>
          {filteredGraphs.length > 0 && (
            <>
              <div style={sectionLabel}>Flows</div>
              {filteredGraphs.map(g => (
                <div key={"g" + g.id} onMouseDown={() => selectGraph(g)} style={itemStyle}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <span style={{ color: "var(--text)" }}>{g.name}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="theme-chip theme-chip-accent" style={{ fontSize: 10, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>Flow</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted-2)", fontFamily: "monospace" }}>#{g.id}</span>
                  </span>
                </div>
              ))}
            </>
          )}
          {filteredScripts.length > 0 && (
            <>
              <div style={sectionLabel}>Scripts</div>
              {filteredScripts.map(s => (
                <div key={"s" + s.name} onMouseDown={() => selectScript(s)} style={itemStyle}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}>
                  <span style={{ color: "var(--text)" }}>{s.name}</span>
                  <span className="theme-chip theme-chip-success" style={{ fontSize: 10, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>Script</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {open && query && !hasResults && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
          background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8,
          padding: "10px 12px", fontSize: 13, color: "var(--text-muted-2)", zIndex: 999,
        }}>
          No matching flows or scripts
        </div>
      )}
    </div>
  );
}

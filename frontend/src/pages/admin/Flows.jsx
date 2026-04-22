import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";
import { ViewerBanner } from "../../components/ViewerBanner.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { GraphRow } from "./GraphRow.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

const EXAMPLE_RE = /^[📧🤖🔄⚠⚡🔍🧪📊🐍⏰💻📁]/u;

export function Flows({ showToast }) {
  const { currentUser: user } = useAuth();
  const [graphs, setGraphs]           = useState([]);
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(null);
  const [search, setSearch]           = useState("");
  const [activeTag, setActiveTag]     = useState(null);
  const [reseeding, setReseeding]     = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [healthMap, setHealthMap]     = useState({});

  const loadHealth = useCallback(async () => {
    try {
      const rows = await api("GET", "/api/analytics/flows?days=30");
      const m = {};
      (rows || []).forEach(r => { m[r.graph_id] = r; });
      setHealthMap(m);
    } catch { /* analytics optional */ }
  }, []);

  const load = useCallback(async () => {
    try { setGraphs(await api("GET", "/api/graphs")); }
    catch (e) { showToast(e.message, "error"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); loadHealth(); }, []);

  async function reseedExamples() {
    setConfirmState({
      message: "Re-seed all example flows? Missing examples will be restored; existing ones are left unchanged.",
      confirmLabel: "Re-seed",
      fn: async () => {
        setReseeding(true);
        try { await api("POST", "/api/graphs/reseed"); showToast("Examples re-seeded"); load(); }
        catch (e) { showToast(e.message, "error"); }
        setReseeding(false);
      },
    });
  }

  async function renameGraph(g) {
    const newName = window.prompt("Rename flow:", g.name);
    if (!newName || newName.trim() === g.name) return;
    try { await api("PUT", `/api/graphs/${g.id}`, { name: newName.trim() }); showToast("Renamed"); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function runGraph(id, name) {
    setRunning(id);
    try { await api("POST", `/api/graphs/${id}/run`, { source: "admin" }); showToast(`Queued: ${name}`); }
    catch (e) { showToast(e.message, "error"); }
    setRunning(null);
  }

  async function toggleGraph(id, enabled) {
    try { await api("PUT", `/api/graphs/${id}`, { enabled: !enabled }); load(); showToast(enabled ? "Disabled" : "Enabled"); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function duplicateGraph(g) {
    try {
      const copy = await api("POST", `/api/graphs/${g.id}/duplicate`);
      showToast(`Duplicated as "${copy.name}"`); load();
    } catch (e) { showToast(e.message, "error"); }
  }

  function deleteGraph(id, name) {
    setConfirmState({
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        try { await api("DELETE", `/api/graphs/${id}`); showToast("Deleted"); load(); }
        catch (e) { showToast(e.message, "error"); }
      },
    });
  }

  // Collect all unique tags across all flows
  const allTags = [...new Set(graphs.flatMap(g => Array.isArray(g.tags) ? g.tags : []))].sort();

  const isExample = name => EXAMPLE_RE.test(name);
  const q = search.toLowerCase();
  const filtered = graphs.filter(g => {
    if (q && !g.name.toLowerCase().includes(q) && !(g.description || "").toLowerCase().includes(q)) return false;
    if (activeTag && !(Array.isArray(g.tags) ? g.tags : []).includes(activeTag)) return false;
    return true;
  });
  const exampleFlows = filtered.filter(g => isExample(g.name));
  const userFlows    = filtered.filter(g => !isExample(g.name));
  const ro = user?.role === "viewer";

  return (
    <div>
      {ro && <ViewerBanner />}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Canvas Flows</h1>
        {!ro && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" disabled={reseeding} onClick={reseedExamples} title="Restore any missing example flows">
              {reseeding ? "Reseeding…" : "↺ Restore examples"}
            </button>
            <a href="/canvas" className="btn btn-primary">+ New in Canvas</a>
          </div>
        )}
      </div>

      <div style={{ marginBottom: allTags.length > 0 ? 8 : 16 }}>
        <input
          style={{ width: "100%", background: "#1a1d2e", color: "#e2e8f0", border: "1px solid #2a2d3e", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}
          placeholder="🔍  Search flows…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {allTags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#4b5563" }}>Filter:</span>
          <button
            onClick={() => setActiveTag(null)}
            style={{
              background: !activeTag ? "#4338ca" : "#1e2235",
              border: `1px solid ${!activeTag ? "#6366f1" : "#2a2d3e"}`,
              color: !activeTag ? "#fff" : "#94a3b8",
              borderRadius: 5, padding: "2px 10px", fontSize: 11, cursor: "pointer",
            }}
          >All</button>
          {allTags.map(tag => (
            <button key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              style={{
                background: activeTag === tag ? "#1e1b4b" : "#13152a",
                border: `1px solid ${activeTag === tag ? "#4338ca" : "#2a2d3e"}`,
                color: activeTag === tag ? "#a5b4fc" : "#64748b",
                borderRadius: 5, padding: "2px 10px", fontSize: 11, cursor: "pointer",
                transition: "all .12s",
              }}
            >{tag}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Loading…</div>
      ) : graphs.length === 0 ? (
        <div className="card">
          <div className="empty-state" style={{ padding: "40px 0" }}>
            No graphs yet.<br />
            <a href="/canvas" style={{ color: "#a78bfa", textDecoration: "none", marginTop: 8, display: "inline-block" }}>
              Open the canvas to create your first flow →
            </a>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty-state">No flows match "{search}".</div></div>
      ) : (
        <div>
          {exampleFlows.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  Example Flows <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>({exampleFlows.length})</span>
                </div>
                <span style={{ fontSize: 11, color: "#64748b" }}>Duplicate to make your own copy</span>
              </div>
              {exampleFlows.map(g => (
                <GraphRow key={g.id} g={g} running={running}
                  onRun={runGraph} onToggle={toggleGraph} onDuplicate={duplicateGraph}
                  onDelete={deleteGraph} onRename={renameGraph}
                  showToast={showToast} load={load} isExample={true} ro={ro}
                  health={healthMap[g.id]} />
              ))}
            </div>
          )}
          {userFlows.length > 0 && (
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  Your Flows <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>({userFlows.length})</span>
                </div>
              </div>
              {userFlows.map(g => (
                <GraphRow key={g.id} g={g} running={running}
                  onRun={runGraph} onToggle={toggleGraph} onDuplicate={duplicateGraph}
                  onDelete={deleteGraph} onRename={renameGraph}
                  showToast={showToast} load={load} isExample={false} ro={ro}
                  health={healthMap[g.id]} />
              ))}
            </div>
          )}
        </div>
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={() => { confirmState.fn(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

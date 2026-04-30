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
    } catch {
      setHealthMap({});
    }
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      setGraphs(await api("GET", "/api/graphs"));
    } catch (e) {
      setGraphs([]);
      if (!silent) showToast(e.message, "error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); loadHealth(); }, [load, loadHealth]);

  async function reseedExamples() {
    setConfirmState({
      message: "Re-seed all example flows? Missing examples will be restored; existing ones are left unchanged.",
      confirmLabel: "Re-seed",
      fn: async () => {
        setReseeding(true);
        try {
          await api("POST", "/api/graphs/reseed");
          await load({ silent: true });
          await loadHealth();
          showToast("Examples re-seeded");
        } catch (e) {
          showToast(e.message, "error");
        } finally {
          setReseeding(false);
        }
      },
    });
  }

  async function renameGraph(g) {
    const newName = window.prompt("Rename flow:", g.name);
    if (!newName || newName.trim() === g.name) return;
    try {
      await api("PUT", `/api/graphs/${g.id}`, { name: newName.trim() });
      await load({ silent: true });
      showToast("Renamed");
    }
    catch (e) { showToast(e.message, "error"); }
  }

  async function runGraph(id, name) {
    setRunning(id);
    try {
      await api("POST", `/api/graphs/${id}/run`, { source: "admin" });
      await loadHealth();
      showToast(`Queued: ${name}`);
    }
    catch (e) { showToast(e.message, "error"); }
    finally { setRunning(null); }
  }

  async function toggleGraph(id, enabled) {
    try {
      await api("PUT", `/api/graphs/${id}`, { enabled: !enabled });
      await load({ silent: true });
      showToast(enabled ? "Disabled" : "Enabled");
    }
    catch (e) { showToast(e.message, "error"); }
  }

  async function duplicateGraph(g) {
    try {
      const copy = await api("POST", `/api/graphs/${g.id}/duplicate`);
      await load({ silent: true });
      showToast(`Duplicated as "${copy.name}"`);
    } catch (e) { showToast(e.message, "error"); }
  }

  function deleteGraph(id, name) {
    setConfirmState({
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        try {
          await api("DELETE", `/api/graphs/${id}`);
          await load({ silent: true });
          await loadHealth();
          showToast("Deleted");
        }
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
  const pinnedFlows  = filtered.filter(g => g.pinned);
  const exampleFlows = filtered.filter(g => !g.pinned && isExample(g.name));
  const userFlows    = filtered.filter(g => !g.pinned && !isExample(g.name));
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
          style={{
            width: "100%",
            background: "var(--bg-soft)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 13,
          }}
          placeholder="🔍  Search flows…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {allTags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--text-muted-3)" }}>Filter:</span>
          <button
            onClick={() => setActiveTag(null)}
            style={{
              background: !activeTag ? "var(--accent)" : "var(--bg-soft)",
              border: `1px solid ${!activeTag ? "var(--accent-border)" : "var(--border)"}`,
              color: !activeTag ? "#fff" : "var(--text-muted)",
              borderRadius: 5, padding: "2px 10px", fontSize: 11, cursor: "pointer",
            }}
          >All</button>
          {allTags.map(tag => (
            <button key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              style={{
                background: activeTag === tag ? "var(--accent-soft)" : "var(--bg-elev-2)",
                border: `1px solid ${activeTag === tag ? "var(--accent-border)" : "var(--border)"}`,
                color: activeTag === tag ? "var(--accent-2)" : "var(--text-muted-2)",
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
          {pinnedFlows.length > 0 && (
            <div className="card" style={{ marginBottom: 16, borderColor: "#4338ca66" }}>
              <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8 }}>
                <span style={{ fontSize: 14 }}>📌</span>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  Pinned <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>({pinnedFlows.length})</span>
                </div>
              </div>
              {pinnedFlows.map(g => (
                <GraphRow key={g.id} g={g} running={running}
                  onRun={runGraph} onToggle={toggleGraph} onDuplicate={duplicateGraph}
                  onDelete={deleteGraph} onRename={renameGraph}
                  showToast={showToast} load={load} isExample={isExample(g.name)} ro={ro}
                  health={healthMap[g.id]} />
              ))}
            </div>
          )}
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

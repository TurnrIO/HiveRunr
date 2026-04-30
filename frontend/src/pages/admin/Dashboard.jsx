import { Fragment, useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";
import { ViewerBanner } from "../../components/ViewerBanner.jsx";
import { ReplayEditModal } from "../../components/ReplayEditModal.jsx";
import { useResilientLoad } from "../../components/useResilientLoad.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";

export function Dashboard({ showToast }) {
  const { currentUser: user } = useAuth();
  const { activeWorkspace } = useWorkspace();
  const [metrics, setMetrics]       = useState(null);   // server-side accurate stats
  const [runs, setRuns]             = useState([]);      // last 20 runs for the feed
  const [workflows, setWfs]         = useState([]);
  const [graphs, setGraphs]         = useState([]);
  const [expandedRunId, setExpanded] = useState(null);
  const [replayEdit, setReplayEdit] = useState(null);
  const [queue, setQueue]           = useState(null);
  const fetchDashboard = useCallback(async () => {
    const [m, r, w, g] = await Promise.all([
      api("GET", "/api/metrics"),
      api("GET", "/api/runs?page_size=20"),
      api("GET", "/api/workflows"),
      api("GET", "/api/graphs"),
    ]);
    return {
      metrics: m,
      runs: r.runs ?? r,
      workflows: w,
      graphs: g,
    };
  }, []);

  const { load, loading, loadError } = useResilientLoad(fetchDashboard, {
    onSuccess: ({ metrics, runs, workflows, graphs }) => {
      setMetrics(metrics);
      setRuns(runs);
      setWfs(workflows);
      setGraphs(graphs);
    },
    onHardError: (e) => {
      setMetrics(null);
      setRuns([]);
      setWfs([]);
      setGraphs([]);
      showToast(e.message, "error");
    },
    getErrorMessage: (e) => e.message || "Failed to load dashboard",
  });

  const loadQueue = useCallback(async () => {
    try { setQueue(await api("GET", "/api/runs/queue")); }
    catch { /* queue is optional */ }
  }, []);

  useEffect(() => {
    load();
    loadQueue();
    const t1 = setInterval(() => load({ silent: true, clearError: false }), 5000);
    const t2 = setInterval(loadQueue, 10000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [load, loadQueue]);

  // Use server-side accurate counts from /api/metrics; fall back to run list while loading
  const activeCount = runs.filter(r => r.status === "running" || r.status === "queued").length;
  const stats = metrics ? {
    total:  metrics.total  ?? 0,
    active: activeCount,               // live count from the feed (refreshes every 5s)
    ok:     metrics.succeeded ?? 0,
    failed: metrics.failed    ?? 0,
    avg_ms: metrics.avg_ms,
  } : {
    total: 0, active: 0, ok: 0, failed: 0,
  };

  async function toggleWf(name) {
    try { await api("POST", `/api/workflows/${name}/toggle`); await load({ silent: true }); showToast("Toggled"); }
    catch (e) { showToast(e.message, "error"); }
  }
  async function runWf(name) {
    try { await api("POST", `/api/workflows/${name}/run`, { payload: {} }); await load({ silent: true }); showToast("Queued!"); }
    catch (e) { showToast(e.message, "error"); }
  }
  async function deleteRun(id) {
    try { await api("DELETE", `/api/runs/${id}`); await load({ silent: true }); }
    catch (e) { showToast(e.message, "error"); }
  }
  async function cancelRun(id) {
    try { await api("POST", `/api/runs/${id}/cancel`); await load({ silent: true }); showToast("Cancelled"); }
    catch (e) { showToast(e.message, "error"); }
  }
  async function replayRun(id) {
    try { await api("POST", `/api/runs/${id}/replay`); await load({ silent: true }); showToast("Queued for replay"); }
    catch (e) { showToast(e.message, "error"); }
  }
  async function openReplayEdit(id) {
    try {
      const data = await api("GET", `/api/runs/${id}/payload`);
      setReplayEdit({ runId: id, payload: JSON.stringify(data.payload || {}, null, 2) });
    } catch (e) { showToast(e.message, "error"); }
  }
  async function submitReplayEdit(runId, payloadStr) {
    try {
      let payload;
      try { payload = JSON.parse(payloadStr); }
      catch { showToast("Invalid JSON payload", "error"); return; }
      await api("POST", `/api/runs/${runId}/replay`, { payload });
      await load({ silent: true });
      showToast("Queued for replay with custom payload");
      setReplayEdit(null);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function clearAllRuns() {
    try {
      await api("DELETE", "/api/runs");
      await load({ silent: true });
      showToast("Run history cleared");
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  function fmtDur(r) {
    if (r.status === "queued" || r.status === "running") return "—";
    if (!r.updated_at || !r.created_at) return "—";
    const d = new Date(r.updated_at) - new Date(r.created_at);
    return d < 1000 ? `${d}ms` : `${(d / 1000).toFixed(1)}s`;
  }

  const ro = user?.role === "viewer";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Dashboard</h1>
        {activeWorkspace && (
          <span style={{
            fontSize: 11, color: "#6366f1", background: "#1e1b4b",
            border: "1px solid #3730a3", borderRadius: 12,
            padding: "3px 10px", display: "flex", alignItems: "center", gap: 5,
          }}>
            🏢 {activeWorkspace.name}
          </span>
        )}
      </div>
      {ro && <ViewerBanner />}

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-val">{stats.total}</div><div className="stat-lbl">Total Runs (30d)</div></div>
        <div className="stat-card"><div className="stat-val" style={{ color: "#60a5fa" }}>{stats.active}</div><div className="stat-lbl">Active</div></div>
        <div className="stat-card"><div className="stat-val" style={{ color: "#4ade80" }}>{stats.ok}</div><div className="stat-lbl">Succeeded</div></div>
        <div className="stat-card"><div className="stat-val" style={{ color: "#f87171" }}>{stats.failed}</div><div className="stat-lbl">Failed</div></div>
        {stats.avg_ms > 0 && (
          <div className="stat-card">
            <div className="stat-val" style={{ color: "#38bdf8" }}>
              {stats.avg_ms < 1000 ? `${Math.round(stats.avg_ms)}ms` : `${(stats.avg_ms / 1000).toFixed(1)}s`}
            </div>
            <div className="stat-lbl">Avg Duration</div>
          </div>
        )}
      </div>

      {queue && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>⚙ Worker Queue</div>
            <span style={{ fontSize: 11, color: "#4b5563" }}>auto-refreshes every 10 s</span>
          </div>
          {!queue.ok ? (
            <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>⚠ {queue.error || "Could not reach broker"}</div>
          ) : (
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: 10 }}>
                {[
                  { label: "Active",    val: queue.active,       color: "#34d399" },
                  { label: "Reserved",  val: queue.reserved,     color: "#60a5fa" },
                  { label: "Scheduled", val: queue.scheduled,    color: "#a78bfa" },
                  { label: "Workers",   val: queue.worker_count, color: "#fbbf24" },
                ].map(({ label, val, color }) => (
                  <div key={label} style={{ textAlign: "center", minWidth: 56 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>{label}</div>
                  </div>
                ))}
              </div>
              {queue.workers.length > 0 && (
                <div style={{ flex: 1, minWidth: 200 }}>
                  {queue.workers.map(w => (
                    <div key={w.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", borderBottom: "1px solid #1e2235" }}>
                      <span style={{ fontSize: 10, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={w.name}>{w.name}</span>
                      <span style={{ fontSize: 10, color: "#34d399", minWidth: 28 }} title="active">{w.active}▶</span>
                      <span style={{ fontSize: 10, color: "#60a5fa", minWidth: 30 }} title="reserved">{w.reserved}⏳</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(workflows.length > 0 || graphs.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: workflows.length > 0 && graphs.length > 0 ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 24 }}>
          {workflows.length > 0 && (
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-title">Python Workflows</div>
              {workflows.map(w => (
                <div key={w.name} className="wf-pill">
                  <div>
                    <div className="wf-name">{w.name}</div>
                    <div className={w.enabled ? "wf-enabled" : "wf-disabled"}>{w.enabled ? "● enabled" : "○ disabled"}</div>
                  </div>
                  {!ro && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn btn-ghost" onClick={() => toggleWf(w.name)}>Toggle</button>
                      <button className="btn btn-success" disabled={!w.enabled} onClick={() => runWf(w.name)}>▶ Run</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {graphs.length > 0 && (
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-title">Canvas Flows</div>
              {graphs.map(g => (
                <div key={g.id} className="wf-pill">
                  <div>
                    <div className="wf-name">{g.name}</div>
                    <div className={g.enabled ? "wf-enabled" : "wf-disabled"}>{g.enabled ? "● enabled" : "○ disabled"}</div>
                  </div>
                  {!ro && (
                    <div style={{ display: "flex", gap: 8 }}>
                      <a className="btn btn-ghost" href={`/canvas#graph-${g.id}`}>✏️ Edit</a>
                      <button className="btn btn-success" disabled={!g.enabled}
                        onClick={async () => {
                          try { await api("POST", `/api/graphs/${g.id}/run`, { payload: {} }); await load({ silent: true }); showToast("Queued!"); }
                          catch (e) { showToast(e.message, "error"); }
                        }}>▶ Run</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Recent Runs</div>
          {!ro && runs.length > 0 && (
            <button className="btn btn-ghost" onClick={clearAllRuns}>Clear all</button>
          )}
        </div>

        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : loadError ? (
          <div className="empty-state">{loadError}</div>
        ) : runs.length === 0 ? (
          <div className="empty-state">No runs yet. Trigger a workflow to get started.</div>
        ) : (
          <table>
            <thead>
              <tr><th>#</th><th>Workflow</th><th>Status</th><th>Started</th><th>Duration</th><th></th></tr>
            </thead>
            <tbody>
              {runs.map(r => (
                <Fragment key={r.id}>
                  <tr key={r.id} className="expandable-row"
                    onClick={() => setExpanded(expandedRunId === r.id ? null : r.id)}
                    style={{ cursor: "pointer" }}>
                    <td style={{ color: "#4b5563" }}>{r.id}</td>
                    <td>{r.flow_name || "—"}</td>
                    <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                    <td style={{ color: "#64748b" }}>{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</td>
                    <td style={{ color: "#64748b", fontVariantNumeric: "tabular-nums" }}>{fmtDur(r)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        {r.graph_id && (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); replayRun(r.id); }} title="Replay with original payload">▶ Replay</button>
                            <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); openReplayEdit(r.id); }} title="Replay with custom payload">✏ Replay…</button>
                          </>
                        )}
                        {(r.status === "queued" || r.status === "running") && (
                          <button className="btn btn-ghost btn-sm" style={{ color: "#fbbf24" }} onClick={e => { e.stopPropagation(); cancelRun(r.id); }}>Cancel</button>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ color: "#f87171" }} title="Delete run" aria-label="Delete run"
                          onClick={e => { e.stopPropagation(); deleteRun(r.id); }}>✕</button>
                      </div>
                    </td>
                  </tr>
                  {expandedRunId === r.id && (
                    <tr key={`${r.id}-expand`} style={{ background: "#0f1117" }}>
                      <td colSpan="6" style={{ padding: "12px" }}>
                        {r.initial_payload && Object.keys(r.initial_payload).length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>Initial Payload</div>
                            <div style={{ background: "#0a0c14", border: "1px solid #2a2d3e", borderRadius: 6, padding: 10, fontFamily: "monospace", fontSize: 11, color: "#94a3b8", maxHeight: 200, overflowY: "auto" }}>
                              {JSON.stringify(r.initial_payload, null, 2)}
                            </div>
                          </div>
                        )}
                        {r.result && (r.result.output || r.result.error) && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: r.result.error ? "#f87171" : "#4ade80", marginBottom: 6 }}>
                              {r.result.error ? "❌ Error" : "✅ Output"}
                            </div>
                            <div style={{
                              background: "#0a0c14", border: `1px solid ${r.result.error ? "#7f1d1d" : "#14532d"}`,
                              borderRadius: 6, padding: 10, fontFamily: "monospace", fontSize: 11,
                              color: r.result.error ? "#fca5a5" : "#86efac",
                              maxHeight: 300, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                            }}>
                              {r.result.error || r.result.output}
                            </div>
                          </div>
                        )}
                        {r.traces && r.traces.length > 0 ? (
                          <div>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>Trace</div>
                            <div className="trace-table">
                              <table>
                                <thead><tr><th>Node</th><th>Type</th><th>Status</th><th>Duration (ms)</th><th>Attempts</th><th>Output/Error</th></tr></thead>
                                <tbody>
                                  {r.traces.map((t, idx) => (
                                    <tr key={idx}>
                                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{t.node_id}</td>
                                      <td style={{ fontSize: 11 }}>{t.type}</td>
                                      <td>
                                        <span className={`trace-status-dot ${t.status === undefined || t.status === "ok" ? "ok" : t.status === "error" ? "err" : "skipped"}`} />
                                        {t.status === undefined || t.status === "ok" ? "ok" : t.status === "error" ? "error" : "skipped"}
                                      </td>
                                      <td>{t.duration_ms ?? "—"}</td>
                                      <td>{t.attempts ?? 1}</td>
                                      <td>
                                        <div style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                                          {t.error
                                            ? <span style={{ color: "#f87171" }}>{String(t.error).slice(0, 50)}</span>
                                            : t.output
                                            ? <span style={{ color: "#94a3b8" }}>{typeof t.output === "string" ? t.output : JSON.stringify(t.output).slice(0, 50)}</span>
                                            : "—"}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: "#4b5563", fontSize: 12 }}>No trace data available</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {replayEdit && (
        <ReplayEditModal
          runId={replayEdit.runId}
          payload={replayEdit.payload}
          onClose={() => setReplayEdit(null)}
          onSubmit={submitReplayEdit}
        />
      )}
    </div>
  );
}

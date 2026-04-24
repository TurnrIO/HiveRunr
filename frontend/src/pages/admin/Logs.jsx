import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { TraceRow } from "../../components/TraceRow.jsx";
import { ReplayEditModal } from "../../components/ReplayEditModal.jsx";

const STATUS_COLOR = {
  succeeded: "#4ade80", failed: "#f87171", dead: "#ef4444",
  retrying: "#fb923c", running: "#34d399", queued: "#60a5fa", cancelled: "#9ca3af",
};
const TRACE_DOT = { ok: "#4ade80", error: "#f87171", skipped: "#64748b" };

function fmtTs(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}
function fmtDur(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Logs({ showToast }) {
  const [runs, setRuns]               = useState([]);
  const [total, setTotal]             = useState(0);
  const [page, setPage]               = useState(1);
  const [pages, setPages]             = useState(1);
  const PAGE_SIZE                     = 50;
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(null);
  const [checked, setChecked]         = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [search, setSearch]           = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatus]     = useState("all");
  const [replayEdit, setReplayEdit]   = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteText, setNoteText]       = useState("");
  const [savedFilters, setSavedFilters] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hr_log_filters") || "[]"); } catch { return []; }
  });
  const [showSaveFilter, setShowSaveFilter] = useState(false);
  const [filterName, setFilterName]   = useState("");

  const load = async (pg, st, sq) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, page_size: PAGE_SIZE });
      if (st && st !== "all") params.set("status", st);
      if (sq) params.set("q", sq);
      const data = await api("GET", `/api/runs?${params}`);
      setRuns(data.runs ?? data);
      setTotal(data.total ?? (data.runs ?? data).length);
      setPage(data.page ?? pg);
      setPages(data.pages ?? 1);
    } catch (e) { showToast(e.message, "error"); }
    setLoading(false);
  };

  useEffect(() => { load(1, statusFilter, search); }, []);

  const handleStatusChange = val => {
    setStatus(val); setPage(1); setSelected(null); setChecked(new Set());
    load(1, val, search);
  };
  const handleSearch = val => {
    setSearch(val); setPage(1); setSelected(null); setChecked(new Set());
    load(1, statusFilter, val);
  };
  const goToPage = pg => {
    setPage(pg); setSelected(null); setChecked(new Set());
    load(pg, statusFilter, search);
  };

  const toggleCheck = (id, e) => {
    e.stopPropagation();
    setChecked(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allChecked = runs.length > 0 && runs.every(r => checked.has(r.id));
  const toggleAll  = () => setChecked(allChecked ? new Set() : new Set(runs.map(r => r.id)));

  const bulkDelete = async () => {
    if (!checked.size) return;
    setBulkDeleting(true);
    try {
      const res = await api("POST", "/api/runs/bulk-delete", { ids: [...checked] });
      showToast(`Deleted ${res.deleted} run${res.deleted !== 1 ? "s" : ""}`);
      setChecked(new Set());
      if (selected && checked.has(selected)) setSelected(null);
      load(page, statusFilter, search);
    } catch (e) { showToast(e.message, "error"); }
    setBulkDeleting(false);
  };

  async function replayRun(id) {
    try { await api("POST", `/api/runs/${id}/replay`); load(page, statusFilter, search); showToast("Queued for replay"); }
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
      load(page, statusFilter, search);
      showToast("Queued for replay with custom payload");
      setReplayEdit(null);
    } catch (e) { showToast(e.message, "error"); }
  }

  function openNoteEditor(r, e) {
    e.stopPropagation();
    setEditingNoteId(r.id);
    setNoteText(r.note || "");
  }
  async function saveNote(runId) {
    try {
      await api("PUT", `/api/runs/${runId}/note`, { note: noteText.trim() || null });
      setRuns(rs => rs.map(r => r.id === runId ? { ...r, note: noteText.trim() || null } : r));
      setEditingNoteId(null);
      showToast("Note saved");
    } catch (e) { showToast(e.message, "error"); }
  }

  function persistFilters(list) {
    setSavedFilters(list);
    try { localStorage.setItem("hr_log_filters", JSON.stringify(list)); } catch {}
  }
  function saveFilter() {
    const name = filterName.trim();
    if (!name) return;
    const entry = { name, status: statusFilter, q: search };
    persistFilters([...savedFilters.filter(f => f.name !== name), entry]);
    setFilterName(""); setShowSaveFilter(false);
    showToast(`Filter "${name}" saved`);
  }
  function applyFilter(f) {
    setStatus(f.status); setSearch(f.q); setSearchInput(f.q);
    setPage(1); setSelected(null); setChecked(new Set());
    load(1, f.status, f.q);
  }
  function deleteFilter(name) {
    persistFilters(savedFilters.filter(f => f.name !== name));
  }
  const hasActiveFilter = search || statusFilter !== "all";

  const selRun = selected != null ? runs.find(r => r.id === selected) : null;
  const traces = selRun?.traces || [];

  return (
    <div>
      <h1 className="page-title">Run Logs</h1>
      <div className="info-box" style={{ marginBottom: 16 }}>
        Per-node execution traces for every run. Each entry shows status, duration, retries,
        and the input/output at each step. Data is stored in the database — there are no
        separate log files.
      </div>

      {/* Saved filter chips */}
      {(savedFilters.length > 0 || hasActiveFilter) && (
        <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#4b5563" }}>Saved:</span>
          {savedFilters.map(f => (
            <span key={f.name} style={{ display: "inline-flex", alignItems: "center", gap: 3,
              background: "#1e2235", border: "1px solid #2a2d3e", borderRadius: 12,
              fontSize: 11, padding: "2px 4px 2px 8px", cursor: "pointer", color: "#94a3b8" }}>
              <span onClick={() => applyFilter(f)} style={{ cursor: "pointer" }}>{f.name}</span>
              <button onClick={() => deleteFilter(f.name)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "#475569",
                         padding: "0 2px", fontSize: 11, lineHeight: 1 }} title="Remove">✕</button>
            </span>
          ))}
          {hasActiveFilter && (
            showSaveFilter ? (
              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input autoFocus value={filterName} onChange={e => setFilterName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveFilter(); if (e.key === "Escape") setShowSaveFilter(false); }}
                  placeholder="Filter name…"
                  style={{ fontSize: 11, padding: "2px 7px", background: "#13152a", color: "#e2e8f0",
                           border: "1px solid #4338ca", borderRadius: 6, width: 130 }} />
                <button className="btn btn-primary" style={{ fontSize: 11, padding: "2px 8px" }} onClick={saveFilter}>Save</button>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 6px" }} onClick={() => setShowSaveFilter(false)}>✕</button>
              </span>
            ) : (
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#64748b" }}
                onClick={() => { setShowSaveFilter(true); setFilterName(""); }}>
                + Save filter
              </button>
            )
          )}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Search by flow name or run ID…" value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch(searchInput)}
          onBlur={() => handleSearch(searchInput)}
          style={{ maxWidth: 280, flex: "none" }} />
        <select value={statusFilter} onChange={e => handleStatusChange(e.target.value)} style={{ width: 130, flex: "none" }}>
          <option value="all">All statuses</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="dead">Dead (exhausted retries)</option>
          <option value="retrying">Retrying</option>
          <option value="running">Running</option>
          <option value="queued">Queued</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="btn btn-ghost" aria-label="Refresh run logs"
          onClick={() => load(page, statusFilter, search)}>↻ Refresh</button>
        {checked.size > 0 && (
          <button className="btn btn-danger" style={{ marginLeft: 4 }} disabled={bulkDeleting} onClick={bulkDelete}>
            {bulkDeleting ? "Deleting…" : `Delete selected (${checked.size})`}
          </button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>{total} run{total !== 1 ? "s" : ""}</span>
      </div>

      <div className="runs-split" style={{ display: "grid", gridTemplateColumns: "minmax(260px,340px) 1fr", gap: 16, alignItems: "start" }}>
        {/* Run list + pagination */}
        <div>
          <div style={{ background: "#1a1d2e", border: "1px solid #2a2d3e", borderRadius: 10, overflow: "hidden" }}>
            {!loading && runs.length > 0 && (
              <div style={{ padding: "6px 14px", borderBottom: "1px solid #2a2d3e", display: "flex", alignItems: "center", gap: 8, background: "#13161f" }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll}
                  style={{ width: 14, height: 14, cursor: "pointer", accentColor: "#7c3aed" }}
                  title={allChecked ? "Deselect all" : "Select all on this page"} />
                <span style={{ fontSize: 11, color: "#64748b" }}>{allChecked ? "Deselect all" : "Select all"}</span>
                {checked.size > 0 && <span style={{ fontSize: 11, color: "#a78bfa", marginLeft: 4 }}>{checked.size} selected</span>}
              </div>
            )}
            {loading && <div className="empty-state" style={{ padding: "30px 0" }}>Loading…</div>}
            {!loading && runs.length === 0 && <div className="empty-state" style={{ padding: "30px 0" }}>No runs match.</div>}
            {runs.map(r => (
              <div key={r.id} onClick={() => setSelected(r.id === selected ? null : r.id)}
                style={{
                  padding: "10px 14px", borderBottom: "1px solid #1e2235", cursor: "pointer",
                  background: checked.has(r.id) ? "#1e1a35" : selected === r.id ? "#252840" : "transparent",
                  borderLeft: `3px solid ${checked.has(r.id) ? "#7c3aed" : selected === r.id ? "#7c3aed" : "transparent"}`,
                  transition: "background .12s", display: "flex", gap: 10, alignItems: "flex-start",
                }}>
                <input type="checkbox" checked={checked.has(r.id)}
                  onClick={e => toggleCheck(r.id, e)} onChange={() => {}}
                  style={{ marginTop: 3, flexShrink: 0, width: 14, height: 14, cursor: "pointer", accentColor: "#7c3aed" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.flow_name || `run #${r.id}`}
                    </span>
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      {r.status === "dead" && (
                        <span title="Exhausted all retries" style={{ fontSize: 10, fontWeight: 700, color: "#ef4444", background: "#1f0a0a", border: "1px solid #dc262644", borderRadius: 10, padding: "1px 6px" }}>DEAD</span>
                      )}
                      {r.status === "retrying" && (
                        <span title={`Attempt ${(r.retry_count || 0) + 1}`} style={{ fontSize: 10, fontWeight: 700, color: "#fb923c", background: "#1c1000", border: "1px solid #ea580c44", borderRadius: 10, padding: "1px 6px" }}>RETRY {r.retry_count || 0}</span>
                      )}
                      {(r.retry_count > 0 && r.status !== "retrying" && r.status !== "dead") && (
                        <span title={`Succeeded after ${r.retry_count} ${r.retry_count === 1 ? "retry" : "retries"}`} style={{ fontSize: 10, color: "#94a3b8", background: "#1e2235", borderRadius: 10, padding: "1px 6px" }}>{r.retry_count}↺</span>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[r.status] || "#94a3b8" }}>{r.status}</span>
                      <button
                        title={r.note ? "Edit note" : "Add note"}
                        onClick={e => openNoteEditor(r, e)}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 13, color: r.note ? "#a78bfa" : "#334155", lineHeight: 1 }}
                      >📝</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    #{r.id} · {fmtTs(r.created_at)}
                    {(r.traces || []).length > 0 && (
                      <span style={{ marginLeft: 6 }}>{r.traces.length} node{r.traces.length !== 1 ? "s" : ""}</span>
                    )}
                  </div>
                  {r.note && editingNoteId !== r.id && (
                    <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.note}
                    </div>
                  )}
                  {editingNoteId === r.id && (
                    <div onClick={e => e.stopPropagation()} style={{ marginTop: 6 }}>
                      <input
                        autoFocus
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") saveNote(r.id);
                          if (e.key === "Escape") setEditingNoteId(null);
                        }}
                        placeholder="Add a note… (Enter to save, Esc to cancel)"
                        style={{ width: "100%", fontSize: 11, background: "#13152a", color: "#e2e8f0", border: "1px solid #4338ca", borderRadius: 4, padding: "3px 7px" }}
                      />
                      <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
                        <button className="btn btn-primary" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => saveNote(r.id)}>Save</button>
                        <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => setEditingNoteId(null)}>Cancel</button>
                        {r.note && <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f87171" }} onClick={() => { setNoteText(""); saveNote(r.id); }}>Clear</button>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {pages > 1 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 }}>
              <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 12 }}
                disabled={page <= 1} onClick={() => goToPage(page - 1)}>‹ Prev</button>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>Page {page} of {pages}</span>
              <button className="btn btn-ghost" style={{ padding: "3px 10px", fontSize: 12 }}
                disabled={page >= pages} onClick={() => goToPage(page + 1)}>Next ›</button>
            </div>
          )}
        </div>

        {/* Trace detail */}
        <div>
          {!selRun ? (
            <div className="empty-state" style={{ paddingTop: 60, background: "#1a1d2e", border: "1px solid #2a2d3e", borderRadius: 10 }}>
              ← Select a run to view its node traces
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
                      {selRun.flow_name || `Run #${selRun.id}`}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>
                      Started: {fmtTs(selRun.created_at)}
                      {selRun.updated_at && selRun.status !== "running" && selRun.status !== "queued" && (
                        <> · Finished: {fmtTs(selRun.updated_at)}</>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {selRun.graph_id && (
                      <>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                          onClick={() => replayRun(selRun.id)} title="Re-run with original payload">▶ Replay</button>
                        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                          onClick={() => openReplayEdit(selRun.id)} title="Re-run with custom payload">✏ Replay…</button>
                      </>
                    )}
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                      background: selRun.status === "succeeded" ? "#14532d" : selRun.status === "dead" ? "#2d0a0a" : selRun.status === "failed" ? "#3f1111" : "#1e3a5f",
                      color: STATUS_COLOR[selRun.status] || "#94a3b8",
                    }}>{selRun.status}</span>
                  </div>
                </div>
                {selRun.retry_count > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
                    {selRun.status === "dead"
                      ? `⚠ Exhausted all ${selRun.retry_count} retry attempt${selRun.retry_count !== 1 ? "s" : ""}. Fix the error in the flow then re-run manually.`
                      : selRun.status === "retrying"
                      ? `↺ Retry attempt ${selRun.retry_count} in progress…`
                      : `↺ Succeeded after ${selRun.retry_count} retry attempt${selRun.retry_count !== 1 ? "s" : ""}`}
                  </div>
                )}
                {selRun.result?.error && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "#3f1111", borderRadius: 6, fontSize: 12, color: "#f87171", fontFamily: "monospace", wordBreak: "break-word" }}>
                    {selRun.result.error}
                  </div>
                )}
                {selRun.note && (
                  <div style={{ marginTop: 8, padding: "6px 10px", background: "#1a1d2e", border: "1px solid #2a2d3e", borderRadius: 6, fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
                    📝 {selRun.note}
                  </div>
                )}
              </div>

              {traces.length === 0 ? (
                <div className="empty-state" style={{ padding: "30px 0", background: "#1a1d2e", border: "1px solid #2a2d3e", borderRadius: 10 }}>
                  No trace data for this run.
                </div>
              ) : (
                <div className="trace-table">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 18 }}></th>
                        <th>Node</th>
                        <th>Type</th>
                        <th>Duration</th>
                        <th>Attempts</th>
                        <th>Input / Output</th>
                      </tr>
                    </thead>
                    <tbody>
                      {traces.map((t, i) => (
                        <TraceRow key={i} t={t} fmtDur={fmtDur} dot={TRACE_DOT} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
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

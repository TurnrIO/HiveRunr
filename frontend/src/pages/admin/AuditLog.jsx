import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client.js";

const ACTION_COLORS = {
  "graph.create":          "#34d399",
  "graph.update":          "#60a5fa",
  "graph.delete":          "#f87171",
  "graph.run":             "#a78bfa",
  "graph.duplicate":       "#60a5fa",
  "graph.restore_version": "#fbbf24",
  "run.delete":            "#f87171",
  "run.clear_all":         "#ef4444",
  "run.trim":              "#fb923c",
  "run.cancel":            "#f87171",
  "run.replay":            "#a78bfa",
  "settings.retention":    "#fbbf24",
  "token.create":          "#34d399",
  "token.delete":          "#f87171",
  "user.create":           "#34d399",
  "user.update_role":      "#fbbf24",
  "user.reset_password":   "#fb923c",
  "user.delete":           "#f87171",
};

const ACTION_GROUPS = [
  ["graph.",    "Graphs"],
  ["run.",      "Runs"],
  ["settings.", "Settings"],
  ["token.",    "Tokens"],
  ["user.",     "Users"],
];

const PAGE = 100;

function normalizeDetail(detail) {
  if (!detail) return null;
  if (typeof detail === "string") {
    try {
      return JSON.parse(detail);
    } catch {
      return detail;
    }
  }
  return detail;
}

function DetailBadge({ detail }) {
  const items = normalizeDetail(detail);
  if (!items) return null;
  if (typeof items !== "object" || Array.isArray(items)) {
    return <span style={{ color: "var(--text-muted-2)", fontSize: 11 }}>{String(items)}</span>;
  }
  const parts = Object.entries(items)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  return <span style={{ color: "var(--text-muted-2)", fontSize: 11 }}>{parts.join("  •  ")}</span>;
}

export function AuditLog({ showToast }) {
  const [rows,         setRows]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [filterActor,  setFilterActor]  = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [offset,       setOffset]       = useState(0);

  const load = useCallback(async (off = 0, actor = "", action = "") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: PAGE, offset: off });
      if (actor.trim())  params.set("actor",  actor.trim());
      if (action.trim()) params.set("action", action.trim());
      const data = await api("GET", `/api/audit-log?${params}`);
      setRows(data || []);
      setOffset(off);
    } catch (e) {
      setRows([]);
      showToast("Failed to load audit log", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(0, filterActor, filterAction); }, [load]);

  function handleSearch(e) {
    e.preventDefault();
    load(0, filterActor, filterAction);
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    } catch { return iso; }
  }

  return (
    <div className="page">
      <h1 className="page-title">Audit Log</h1>

      {/* Filter bar */}
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="Filter by actor…" value={filterActor}
          onChange={e => setFilterActor(e.target.value)}
          style={{ width: 180, fontSize: 13 }}
        />
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
          style={{ width: 180, fontSize: 13 }}>
          <option value="">All actions</option>
          {ACTION_GROUPS.map(([prefix, label]) => (
            <optgroup key={prefix} label={label}>
              {Object.keys(ACTION_COLORS)
                .filter(a => a.startsWith(prefix))
                .map(a => <option key={a} value={a}>{a}</option>)}
            </optgroup>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>
          {loading ? "Loading…" : "Search"}
        </button>
        {(filterActor || filterAction) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
            setFilterActor(""); setFilterAction(""); load(0, "", "");
          }}>Clear</button>
        )}
      </form>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="mobile-cards" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--bg-soft)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted-2)", fontWeight: 500, width: 160 }}>Time</th>
              <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted-2)", fontWeight: 500, width: 120 }}>Actor</th>
              <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted-2)", fontWeight: 500, width: 180 }}>Action</th>
              <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted-2)", fontWeight: 500, width: 80 }}>Target</th>
              <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted-2)", fontWeight: 500 }}>Detail</th>
              <th style={{ padding: "10px 14px", textAlign: "left", color: "var(--text-muted-2)", fontWeight: 500, width: 110 }}>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-muted-2)" }}>
                  {loading ? "Loading…" : "No audit log entries found."}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-soft)"}
                onMouseLeave={e => e.currentTarget.style.background = ""}>
                <td data-label="Time"   style={{ padding: "8px 14px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                <td data-label="Actor"  style={{ padding: "8px 14px", color: "var(--text)", fontFamily: "monospace" }}>{r.actor}</td>
                <td data-label="Action" style={{ padding: "8px 14px" }}>
                  <span style={{
                    display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 11,
                    fontFamily: "monospace", fontWeight: 600, letterSpacing: "0.3px",
                    background: `color-mix(in srgb, ${ACTION_COLORS[r.action] || "var(--bg-soft)"} 12%, transparent)`,
                    color: ACTION_COLORS[r.action] || "#94a3b8",
                    border: `1px solid color-mix(in srgb, ${ACTION_COLORS[r.action] || "var(--border)"} 26%, transparent)`,
                  }}>{r.action}</span>
                </td>
                <td data-label="Target" style={{ padding: "8px 14px", color: "var(--text-muted-2)", fontSize: 12 }}>
                  {r.target_type && <span>{r.target_type}</span>}
                  {r.target_id && <span style={{ color: "var(--text-muted-3)" }}> #{r.target_id}</span>}
                </td>
                <td data-label="Detail" style={{ padding: "8px 14px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <DetailBadge detail={r.detail} />
                </td>
                <td data-label="IP" style={{ padding: "8px 14px", color: "var(--text-muted-3)", fontFamily: "monospace", fontSize: 11 }}>{r.ip || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button className="btn btn-ghost btn-sm" disabled={offset === 0 || loading}
          onClick={() => load(Math.max(0, offset - PAGE), filterActor, filterAction)}>← Prev</button>
        <span style={{ fontSize: 12, color: "var(--text-muted-2)" }}>
          Showing {offset + 1}–{offset + rows.length}
        </span>
        <button className="btn btn-ghost btn-sm" disabled={rows.length < PAGE || loading}
          onClick={() => load(offset + PAGE, filterActor, filterAction)}>Next →</button>
      </div>
    </div>
  );
}

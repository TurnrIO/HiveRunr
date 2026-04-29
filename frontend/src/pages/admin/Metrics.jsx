import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function fmtDur(ms) {
  if (ms == null || ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function relativeTime(ts) {
  if (!ts) return "—";
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d < 60)    return `${d}s ago`;
  if (d < 3600)  return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function shortDate(dayStr) {
  const d = new Date(dayStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const RANGE_OPTIONS = [
  { label: "7d",  days: 7  },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

/* ── Sort indicator ──────────────────────────────────────────────────────── */
function SortIcon({ col, sortBy, dir }) {
  if (sortBy !== col) return <span style={{ color: "#374151", marginLeft: 3 }}>⇅</span>;
  return <span style={{ color: "#a78bfa", marginLeft: 3 }}>{dir === "asc" ? "↑" : "↓"}</span>;
}

/* ── Dual-layer bar chart (volume + duration overlay) ────────────────────── */
function DailyChart({ daily }) {
  const maxVol = Math.max(...daily.map(d => d.total), 1);
  const maxDur = Math.max(...daily.map(d => d.avg_ms || 0), 1);
  const BAR_H  = 80;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, minWidth: daily.length * 28,
                    height: BAR_H + 32, paddingBottom: 24, position: "relative" }}>
        {/* Duration line (SVG overlay).
            Uses a fixed viewBox matching the bar layout so it scales correctly
            with the flex container — avoids the pixel/percentage mismatch. */}
        {maxDur > 0 && (() => {
          const W = daily.length * 28;
          return (
            <svg
              viewBox={`0 0 ${W} ${BAR_H}`}
              preserveAspectRatio="none"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: BAR_H,
                       pointerEvents: "none", overflow: "visible" }}
            >
              <polyline
                fill="none"
                stroke="#38bdf8"
                strokeWidth="1.5"
                strokeDasharray="3 2"
                vectorEffect="non-scaling-stroke"
                points={daily.map((d, i) => {
                  const x = i * 28 + 14;
                  const y = BAR_H - ((d.avg_ms || 0) / maxDur) * (BAR_H - 8);
                  return `${x},${y}`;
                }).join(" ")}
              />
              {daily.map((d, i) => d.avg_ms > 0 && (
                <circle
                  key={i}
                  cx={i * 28 + 14}
                  cy={BAR_H - (d.avg_ms / maxDur) * (BAR_H - 8)}
                  r="2.5"
                  fill="#38bdf8"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          );
        })()}

        {/* Volume bars */}
        {daily.map((d, i) => {
          const sucH  = maxVol > 0 ? (d.succeeded / maxVol) * BAR_H : 0;
          const failH = maxVol > 0 ? (d.failed    / maxVol) * BAR_H : 0;
          return (
            <div key={i} title={`${shortDate(d.day)}: ${d.succeeded}✓ ${d.failed}✗  avg ${fmtDur(d.avg_ms)}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
                       justifyContent: "flex-end", minWidth: 20, position: "relative" }}>
              {d.succeeded > 0 && (
                <div style={{ width: "80%", height: sucH, background: "#4ade8055",
                              border: "1px solid #4ade8088", borderRadius: "2px 2px 0 0" }} />
              )}
              {d.failed > 0 && (
                <div style={{ width: "80%", height: failH, background: "#f8717155",
                              border: "1px solid #f8717188" }} />
              )}
              <div style={{ fontSize: 9, color: "#475569", marginTop: 4, whiteSpace: "nowrap" }}>
                {shortDate(d.day)}
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, fontSize: 10, color: "#64748b", marginTop: 4 }}>
        <span><span style={{ color: "#4ade80" }}>■</span> Succeeded</span>
        <span><span style={{ color: "#f87171" }}>■</span> Failed</span>
        <span><span style={{ color: "#38bdf8" }}>— —</span> Avg duration</span>
      </div>
    </div>
  );
}

/* ── Per-flow performance table ─────────────────────────────────────────── */
function FlowTable({ flows, onOpen }) {
  const [sortBy, setSortBy] = useState("total");
  const [dir,    setDir]    = useState("desc");

  function toggleSort(col) {
    if (sortBy === col) setDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setDir("desc"); }
  }

  const sorted = [...flows].sort((a, b) => {
    const av = a[sortBy] ?? 0, bv = b[sortBy] ?? 0;
    return dir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const th = (col, label) => (
    <th onClick={() => toggleSort(col)}
        style={{ cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
      {label}<SortIcon col={col} sortBy={sortBy} dir={dir} />
    </th>
  );

  function errColor(rate) {
    if (rate === 0) return "#4ade80";
    if (rate < 10)  return "#fbbf24";
    return "#f87171";
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Flow</th>
            {th("total",      "Runs")}
            {th("error_rate", "Error %")}
            {th("avg_ms",     "Avg")}
            {th("p95_ms",     "P95")}
            {th("p99_ms",     "P99")}
            <th>Last run</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(f => (
            <tr key={f.graph_id ?? f.flow_name}
                style={{ cursor: f.graph_id ? "pointer" : "default" }}
                onClick={() => f.graph_id && onOpen && onOpen(f.graph_id)}>
              <td style={{ fontWeight: 500, maxWidth: 200, overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.flow_name}
              </td>
              <td>
                <span style={{ color: "#a78bfa" }}>{f.total}</span>
                {f.failed > 0 && (
                  <span style={{ color: "#f87171", fontSize: 10, marginLeft: 4 }}>
                    ({f.failed} ✗)
                  </span>
                )}
              </td>
              <td>
                <span style={{ color: errColor(f.error_rate), fontWeight: f.error_rate > 0 ? 600 : 400 }}>
                  {f.error_rate}%
                </span>
              </td>
              <td style={{ color: "#94a3b8" }}>{fmtDur(f.avg_ms)}</td>
              <td style={{ color: "#94a3b8" }}>{fmtDur(f.p95_ms)}</td>
              <td style={{ color: "#64748b"  }}>{fmtDur(f.p99_ms)}</td>
              <td style={{ color: "#64748b", fontSize: 11 }}>{relativeTime(f.last_run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */
export function Metrics({ showToast }) {
  const [summary,  setSummary]  = useState(null);
  const [daily,    setDaily]    = useState([]);
  const [flows,    setFlows]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [days,     setDays]     = useState(30);
  const [tab,      setTab]      = useState("overview"); // "overview" | "flows"

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const [m, dailyData, flowData] = await Promise.all([
        api("GET", "/api/metrics"),
        api("GET", `/api/analytics/daily?days=${d}`),
        api("GET", `/api/analytics/flows?days=${d}`),
      ]);
      setSummary(m);
      setDaily(dailyData);
      setFlows(flowData);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(days); }, [days, load]);

  function openFlow(graphId) {
    sessionStorage.setItem("canvas_open_graph", graphId);
    window.open("/canvas", "_blank");
  }

  const tabStyle = (t) => ({
    padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 500,
    background: tab === t ? "#6d28d9" : "transparent",
    color:      tab === t ? "#fff"    : "#64748b",
    transition: "all .15s",
  });

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Metrics</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Tab switcher */}
          <div style={{ background: "#13152a", border: "1px solid #1e2235",
                        borderRadius: 8, padding: 3, display: "flex", gap: 2 }}>
            <button style={tabStyle("overview")} onClick={() => setTab("overview")}>Overview</button>
            <button style={tabStyle("flows")}    onClick={() => setTab("flows")}>Per-flow</button>
          </div>
          {/* Range selector */}
          <div style={{ background: "#13152a", border: "1px solid #1e2235",
                        borderRadius: 8, padding: 3, display: "flex", gap: 2 }}>
            {RANGE_OPTIONS.map(o => (
              <button key={o.days}
                style={{
                  padding: "5px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 500,
                  background: days === o.days ? "#6d28d9" : "transparent",
                  color:      days === o.days ? "#fff"    : "#64748b",
                }}
                onClick={() => setDays(o.days)}>
                {o.label}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => load(days)} disabled={loading}
            title="Refresh">↺</button>
        </div>
      </div>

      {loading && <div className="empty-state">Loading…</div>}

      {!loading && summary && tab === "overview" && (
        <>
          {/* ── Stat cards ── */}
          <div className="stat-cards">
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#a78bfa" }}>{summary.total || 0}</div>
              <div className="stat-label">Total Runs (30d)</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#4ade80" }}>{summary.succeeded || 0}</div>
              <div className="stat-label">Succeeded</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#f87171" }}>{summary.failed || 0}</div>
              <div className="stat-label">Failed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#4ade80" }}>{summary.success_rate ?? 0}%</div>
              <div className="stat-label">Success Rate</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: "#38bdf8" }}>{fmtDur(summary.avg_ms)}</div>
              <div className="stat-label">Avg Duration</div>
            </div>
          </div>

          {/* ── Daily chart ── */}
          <div className="card">
            <div className="card-title">
              Daily Volume + Avg Duration
              <span style={{ fontSize: 10, color: "#475569", marginLeft: 8, fontWeight: 400 }}>
                last {days} days
              </span>
            </div>
            <DailyChart daily={daily} />
          </div>

          {/* ── Flaky flows ── */}
          {(() => {
            const flaky = flows
              .filter(f => f.total >= 3 && f.error_rate > 5 && f.error_rate < 95)
              .sort((a, b) => Math.abs(a.error_rate - 50) - Math.abs(b.error_rate - 50))
              .slice(0, 5);
            if (!flaky.length) return null;
            return (
              <div className="card">
                <div className="card-title">⚡ Flaky Flows
                  <span style={{ fontSize: 10, color: "#475569", fontWeight: 400, marginLeft: 8 }}>
                    intermittently failing · {days}d
                  </span>
                </div>
                <table>
                  <thead><tr><th>Flow</th><th>Runs</th><th>Error %</th><th>Avg duration</th><th>Last run</th></tr></thead>
                  <tbody>
                    {flaky.map(f => (
                      <tr key={f.graph_id ?? f.flow_name}
                          style={{ cursor: f.graph_id ? "pointer" : "default" }}
                          onClick={() => f.graph_id && openFlow(f.graph_id)}>
                        <td style={{ fontWeight: 500 }}>{f.flow_name}</td>
                        <td style={{ color: "#a78bfa" }}>{f.total}</td>
                        <td>
                          <span style={{
                            fontWeight: 600,
                            color: f.error_rate >= 40 ? "#f87171" : "#fbbf24",
                          }}>{f.error_rate}%</span>
                        </td>
                        <td style={{ color: "#94a3b8" }}>{fmtDur(f.avg_ms)}</td>
                        <td style={{ color: "#64748b", fontSize: 11 }}>{relativeTime(f.last_run)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* ── Top failing flows ── */}
          {(summary.top_failing || []).length > 0 && (
            <div className="card">
              <div className="card-title">Top Failing Flows (30d)</div>
              <table>
                <thead><tr><th>Flow</th><th>Failures</th></tr></thead>
                <tbody>
                  {(summary.top_failing || []).map(f => (
                    <tr key={f.name}>
                      <td>{f.name}</td>
                      <td><span className="badge badge-failed">{f.failures}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Recent runs ── */}
          {(summary.recent || []).length > 0 && (
            <div className="card">
              <div className="card-title">Recent Runs</div>
              <table>
                <thead>
                  <tr><th>Flow</th><th>Status</th><th>Duration</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {(summary.recent || []).map(r => (
                    <tr key={r.id}>
                      <td style={{ fontSize: 12 }}>{r.flow_name || "—"}</td>
                      <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                      <td style={{ fontSize: 12 }}>{fmtDur(r.duration_ms)}</td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{relativeTime(r.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && tab === "flows" && (
        <>
          {flows.length === 0 ? (
            <div className="empty-state">No completed runs in the last {days} days.</div>
          ) : (
            <div className="card">
              <div className="card-title">
                Per-flow Performance
                <span style={{ fontSize: 10, color: "#475569", marginLeft: 8, fontWeight: 400 }}>
                  {flows.length} flow{flows.length !== 1 ? "s" : ""} · last {days} days ·
                  click row to open in canvas
                </span>
              </div>
              <FlowTable flows={flows} onOpen={openFlow} />
            </div>
          )}

          {/* Duration chart per-flow timeframe */}
          {daily.length > 0 && (
            <div className="card">
              <div className="card-title">
                Daily Volume
                <span style={{ fontSize: 10, color: "#475569", marginLeft: 8, fontWeight: 400 }}>
                  all flows combined · last {days} days
                </span>
              </div>
              <DailyChart daily={daily} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

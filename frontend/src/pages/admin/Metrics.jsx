import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";

function relativeTime(ts) {
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function Metrics({ showToast }) {
  const [metrics, setMetrics]      = useState(null);
  const [failingFlows, setFailing] = useState([]);
  const [recentRuns, setRecent]    = useState([]);
  const [loading, setLoading]      = useState(true);

  const load = useCallback(async () => {
    try {
      const m = await api("GET", "/api/metrics");
      setMetrics(m);

      const runsResp = await api("GET", "/api/runs?page_size=200");
      const runs = runsResp.runs ?? runsResp;
      const failMap = {};
      runs.forEach(r => {
        if (r.status === "failed") {
          const wf = r.flow_name || "unknown";
          failMap[wf] = (failMap[wf] || 0) + 1;
        }
      });
      setFailing(Object.entries(failMap).sort((a, b) => b[1] - a[1]).slice(0, 5));
      setRecent(runs.slice(0, 10));
    } catch (e) { showToast(e.message, "error"); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, []);

  if (loading) return <div className="empty-state">Loading metrics…</div>;
  if (!metrics) return <div className="empty-state">No metrics available.</div>;

  const lastDay = (metrics.daily || []).slice(-14);
  const maxRuns = Math.max(...lastDay.map(d => (d.succeeded || 0) + (d.failed || 0)), 1);

  return (
    <div>
      <h1 className="page-title">Metrics</h1>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#a78bfa" }}>{metrics.total || 0}</div>
          <div className="stat-label">Total Runs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#4ade80" }}>{metrics.succeeded || 0}</div>
          <div className="stat-label">Succeeded</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#f87171" }}>{metrics.failed || 0}</div>
          <div className="stat-label">Failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#38bdf8" }}>{Math.round(metrics.avg_ms || 0)}</div>
          <div className="stat-label">Avg Duration (ms)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "#4ade80" }}>{metrics.success_rate ?? 0}%</div>
          <div className="stat-label">Success Rate</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Last 14 Days</div>
        <div className="bar-chart">
          {lastDay.map((day, idx) => {
            const succeeded  = day.succeeded || 0;
            const failed     = day.failed || 0;
            const sucHeight  = maxRuns > 0 ? (succeeded / maxRuns) * 70 : 0;
            const failHeight = maxRuns > 0 ? (failed / maxRuns) * 70 : 0;
            const dateStr    = new Date(day.day).getDate().toString().padStart(2, "0");
            return (
              <div key={idx} className="bar-col" title={`${dateStr}: ${succeeded}✓ ${failed}✗`}>
                {succeeded > 0 && <div className="bar-seg" style={{ height: `${sucHeight}px`, background: "#4ade80" }} />}
                {failed > 0    && <div className="bar-seg" style={{ height: `${failHeight}px`, background: "#f87171" }} />}
                <div className="bar-label">{dateStr}</div>
              </div>
            );
          })}
        </div>
      </div>

      {failingFlows.length > 0 && (
        <div className="card">
          <div className="card-title">Top Failing Flows</div>
          <table>
            <thead><tr><th>Flow</th><th>Failed</th></tr></thead>
            <tbody>
              {failingFlows.map(([name, count]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td><span className="badge badge-failed">{count}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="card">
          <div className="card-title">Recent Runs</div>
          <table>
            <thead><tr><th>Flow</th><th>Status</th><th>Duration (ms)</th><th>Time</th></tr></thead>
            <tbody>
              {recentRuns.map(r => {
                const durMs = r.created_at && r.updated_at
                  ? Math.max(0, Math.round(new Date(r.updated_at) - new Date(r.created_at)))
                  : null;
                return (
                  <tr key={r.id}>
                    <td style={{ fontSize: 12 }}>{r.flow_name || "—"}</td>
                    <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                    <td style={{ fontSize: 12 }}>{durMs != null ? durMs : "—"}</td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{relativeTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

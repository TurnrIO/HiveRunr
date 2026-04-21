import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";

const STATUS_ICON   = { ok: "✓", warning: "⚠", error: "✕" };
const STATUS_COLOR  = { ok: "#4ade80", warning: "#fbbf24", error: "#f87171" };
const STATUS_BG     = { ok: "#0a1f1433", warning: "#1c140033", error: "#1f0a0a33" };
const STATUS_BORDER = { ok: "#16a34a44", warning: "#ca8a0444", error: "#dc262644" };

const CHECKS = [
  { id: "db",         title: "PostgreSQL Database" },
  { id: "redis",      title: "Redis" },
  { id: "worker",     title: "Celery Workers" },
  { id: "scheduler",  title: "APScheduler" },
  { id: "email",      title: "Email (AgentMail)" },
  { id: "encryption", title: "Credential Encryption" },
  { id: "security",   title: "Security Posture" },
  { id: "oauth",      title: "OAuth Providers" },
  { id: "system",     title: "Platform" },
];

function Check({ id, title, check }) {
  if (!check) return null;
  const s = check.status || "ok";
  return (
    <div style={{
      background: STATUS_BG[s] || "#1e223533",
      border: `1px solid ${STATUS_BORDER[s] || "#2a2d3e"}`,
      borderRadius: 8, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 12,
          fontWeight: 700, flexShrink: 0,
          color: STATUS_COLOR[s] || "#94a3b8",
          background: STATUS_BG[s] || "#1e2235",
          border: `1px solid ${STATUS_BORDER[s] || "#2a2d3e"}`,
        }}>{STATUS_ICON[s] || "?"}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0" }}>{title}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: STATUS_COLOR[s] || "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{s}</span>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", paddingLeft: 32 }}>{check.message}</div>
      {check.fix && (
        <div style={{
          fontSize: 11, color: "#fbbf24", paddingLeft: 32,
          background: "#1c1400", borderRadius: 4, padding: "6px 10px 6px 32px",
          border: "1px solid #92400e44",
        }}>
          <strong>Fix: </strong>{check.fix}
        </div>
      )}
      {id === "db" && check.status === "ok" && (
        <div style={{ display: "flex", gap: 16, paddingLeft: 32, flexWrap: "wrap" }}>
          {[
            ["Migration", check.migration],
            ["Latency", `${check.latency_ms} ms`],
            ["DB size", check.db_size],
            check.pool ? ["Pool", `${check.pool.pool_in_use ?? 0}/${check.pool.pool_max ?? "?"} in use (${check.pool.pool_available ?? 0} free)`] : null,
          ].filter(Boolean).map(([l, v]) => v != null && (
            <span key={l} style={{ fontSize: 11, color: "#64748b" }}><strong style={{ color: "#94a3b8" }}>{l}:</strong> {v}</span>
          ))}
        </div>
      )}
      {id === "redis" && check.status === "ok" && (
        <div style={{ paddingLeft: 32 }}>
          <span style={{ fontSize: 11, color: "#64748b" }}><strong style={{ color: "#94a3b8" }}>Latency:</strong> {check.latency_ms} ms</span>
        </div>
      )}
      {id === "worker" && check.status === "ok" && check.worker_names?.length > 0 && (
        <div style={{ paddingLeft: 32, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {check.worker_names.map(n => (
            <code key={n} style={{ fontSize: 10, background: "#1e2235", padding: "2px 6px", borderRadius: 4, color: "#94a3b8" }}>{n}</code>
          ))}
        </div>
      )}
      {id === "oauth" && (
        <div style={{ paddingLeft: 32, display: "flex", gap: 12 }}>
          {Object.entries(check.providers || {}).map(([p, enabled]) => (
            <span key={p} style={{ fontSize: 11, color: enabled ? "#4ade80" : "#475569" }}>
              {enabled ? "✓" : "✕"} {p}
            </span>
          ))}
        </div>
      )}
      {id === "system" && check.status === "ok" && (
        <div style={{ display: "flex", gap: 16, paddingLeft: 32, flexWrap: "wrap" }}>
          {[
            ["Version", check.app_version],
            ["Python", check.python],
            ["Hostname", check.hostname],
            ["PID", check.pid],
            ["Timezone", check.app_timezone],
            ["URL", check.app_url],
            ["Signup", check.allow_signup ? "enabled" : "disabled"],
          ].filter(([, v]) => v != null).map(([l, v]) => (
            <span key={l} style={{ fontSize: 11, color: "#64748b" }}><strong style={{ color: "#94a3b8" }}>{l}:</strong> {v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function System({ showToast }) {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [lastFetch, setLastFetch] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api("GET", "/api/system/status");
      setData(d);
      setLastFetch(new Date());
    } catch (e) {
      showToast("Failed to load diagnostics: " + e.message, "error");
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
  }, [load]);

  const overallStatus = !data ? "unknown"
    : CHECKS.some(c => data[c.id]?.status === "error")   ? "error"
    : CHECKS.some(c => data[c.id]?.status === "warning") ? "warning"
    : "ok";

  const overallColor = { ok: "#4ade80", warning: "#fbbf24", error: "#f87171", unknown: "#64748b" }[overallStatus];

  return (
    <div>
      <h1 className="page-title">System Diagnostics</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: overallColor,
          background: STATUS_BG[overallStatus] || "#1e2235", border: `1px solid ${STATUS_BORDER[overallStatus] || "#2a2d3e"}`,
          borderRadius: 20, padding: "4px 14px",
        }}>
          {overallStatus === "ok"      ? "✓ All systems operational"
           : overallStatus === "warning" ? "⚠ Action recommended"
           : overallStatus === "error"   ? "✕ System issue detected"
           : "Checking…"}
        </div>
        {lastFetch && <span style={{ fontSize: 11, color: "#475569" }}>Last checked {lastFetch.toLocaleTimeString()} · auto-refreshes every 30 s</span>}
        <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => load()} disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {loading && !data ? (
        <div className="empty-state">Running diagnostics…</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {CHECKS.map(c => <Check key={c.id} id={c.id} title={c.title} check={data?.[c.id]} />)}
        </div>
      )}
    </div>
  );
}

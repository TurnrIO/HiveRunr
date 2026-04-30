import { useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";
import { useResilientLoad } from "../../components/useResilientLoad.js";

const STATUS_ICON   = { ok: "✓", warning: "⚠", error: "✕" };
const STATUS_COLOR  = { ok: "#4ade80", warning: "#fbbf24", error: "#f87171" };
const STATUS_BG     = { ok: "var(--success-soft)", warning: "var(--warn-soft)", error: "var(--danger-soft)" };
const STATUS_BORDER = { ok: "var(--success-border)", warning: "var(--warn-border)", error: "var(--danger-border)" };

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
      borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: "50%", display: "flex",
          alignItems: "center", justifyContent: "center", fontSize: 12,
          fontWeight: 700, flexShrink: 0,
          color: STATUS_COLOR[s] || "var(--text-muted)",
          background: "var(--bg-elev)",
          border: `1px solid ${STATUS_BORDER[s] || "#2a2d3e"}`,
        }}>{STATUS_ICON[s] || "?"}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{title}</span>
        <span className={`theme-chip ${s === "ok" ? "theme-chip-success" : s === "warning" ? "theme-chip-warn" : "theme-chip-danger"}`} style={{ marginLeft: "auto", fontWeight: 700, textTransform: "uppercase" }}>{s}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 32 }}>{check.message}</div>
      {check.fix && (
        <div className="theme-panel-warn" style={{
          fontSize: 11, color: "var(--warn)", paddingLeft: 32,
          padding: "6px 10px 6px 32px",
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
            <span key={l} style={{ fontSize: 11, color: "var(--text-muted-2)" }}><strong style={{ color: "var(--text-muted)" }}>{l}:</strong> {v}</span>
          ))}
        </div>
      )}
      {id === "redis" && check.status === "ok" && (
        <div style={{ paddingLeft: 32 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted-2)" }}><strong style={{ color: "var(--text-muted)" }}>Latency:</strong> {check.latency_ms} ms</span>
        </div>
      )}
      {id === "worker" && check.status === "ok" && check.worker_names?.length > 0 && (
        <div style={{ paddingLeft: 32, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {check.worker_names.map(n => (
            <code key={n} className="theme-inline-code" style={{ fontSize: 10 }}>{n}</code>
          ))}
        </div>
      )}
      {id === "oauth" && (
        <div style={{ paddingLeft: 32, display: "flex", gap: 12 }}>
          {Object.entries(check.providers || {}).map(([p, enabled]) => (
            <span key={p} style={{ fontSize: 11, color: enabled ? "var(--success)" : "var(--text-muted-3)" }}>
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
            <span key={l} style={{ fontSize: 11, color: "var(--text-muted-2)" }}><strong style={{ color: "var(--text-muted)" }}>{l}:</strong> {v}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function System({ showToast }) {
  const [data,      setData]      = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const fetchDiagnostics = useCallback(async () => api("GET", "/api/system/status"), []);

  const { load, loading, loadError } = useResilientLoad(fetchDiagnostics, {
    onSuccess: (d) => {
      setData(d);
      setLastFetch(new Date());
    },
    onHardError: () => {
      setData(null);
    },
    getErrorMessage: (e) => e?.message === "Failed to fetch" ? "Failed to load diagnostics." : (e.message || "Failed to load diagnostics"),
  });

  useEffect(() => {
    load();
    const t = setInterval(() => load({ silent: true, clearError: false }), 30000);
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
          background: STATUS_BG[overallStatus] || "var(--bg-soft)", border: `1px solid ${STATUS_BORDER[overallStatus] || "var(--border)"}`,
          borderRadius: 20, padding: "4px 14px",
        }}>
          {overallStatus === "ok"      ? "✓ All systems operational"
           : overallStatus === "warning" ? "⚠ Action recommended"
           : overallStatus === "error"   ? "✕ System issue detected"
           : "Checking…"}
        </div>
        {lastFetch && <span style={{ fontSize: 11, color: "var(--text-muted-2)" }}>Last checked {lastFetch.toLocaleTimeString()} · auto-refreshes every 30 s</span>}
        <button className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => load()} disabled={loading}>
          {loading ? "…" : "↻ Refresh"}
        </button>
      </div>

      {loading && !data ? (
        <div className="empty-state">Running diagnostics…</div>
      ) : !data && loadError ? (
        <div className="empty-state">{loadError}</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {CHECKS.map(c => <Check key={c.id} id={c.id} title={c.title} check={data?.[c.id]} />)}
        </div>
      )}
    </div>
  );
}

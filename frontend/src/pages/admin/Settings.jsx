import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { StatusDot } from "../../components/StatusDot.jsx";
import { useFocusTrap } from "../../components/useFocusTrap.js";

function TokenRevealModal({ token, onCopy, onClose }) {
  const ref = useRef(null);
  useFocusTrap(ref, onClose);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="true"
    >
      <div
        ref={ref}
        className="card"
        style={{ width: 500, margin: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="New API token"
      >
        <div className="card-title" style={{ color: "#4ade80" }}>✓ Token created — copy it now</div>
        <p style={{ fontSize: 13, color: "#f87171", marginBottom: 12 }}>
          This token will <strong>not</strong> be shown again. Copy it and store it securely.
        </p>
        <div style={{ background: "#0d0f1a", border: "1px solid #2a2d3e", borderRadius: 8, padding: "10px 12px",
          fontFamily: "monospace", fontSize: 13, color: "#a78bfa", wordBreak: "break-all", marginBottom: 12,
          userSelect: "all", cursor: "text" }}>
          {token.token}
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12, display: "flex", gap: 16 }}>
          <span>Scope: <strong style={{ color: "#c4b5fd" }}>{token.scope || "manage"}</strong></span>
          <span>Expires: <strong style={{ color: "#94a3b8" }}>{token.expires_at ? new Date(token.expires_at).toLocaleDateString() : "Never"}</strong></span>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
          Use as: <code style={{ color: "#7dd3fc" }}>Authorization: Bearer {token.token.slice(0, 12)}…</code>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={onCopy}>⎘ Copy</button>
          <button className="btn btn-ghost" onClick={onClose}>Done — I've saved it</button>
        </div>
      </div>
    </div>
  );
}

export function Settings({ showToast }) {
  const { currentUser: user } = useAuth();
  const isOwner = user?.role === "owner";

  const [status,          setStatus]          = useState(null);
  const [loadingSt,       setLoadingSt]        = useState(true);
  const [statusError,     setStatusError]      = useState("");
  const [nodes,           setNodes]            = useState([]);
  const [reloading,       setReloading]        = useState(false);
  const [resetting,       setResetting]        = useState(false);
  const [clearing,        setClearing]         = useState(false);
  const [trimming,        setTrimming]         = useState(false);
  const [savingRetention, setSavingRetention]  = useState(false);
  const [retention,       setRetention]        = useState({ enabled: false, mode: "count", count: 500, days: 30 });
  const [ratelimit,       setRatelimit]        = useState({ limit: 60, window: 60, counters: [] });
  const [savingRL,        setSavingRL]         = useState(false);
  const [tokens,          setTokens]           = useState([]);
  const [newTokenName,    setNewTokenName]     = useState("");
  const [newTokenScope,   setNewTokenScope]    = useState("manage");
  const [newTokenExpiry,  setNewTokenExpiry]   = useState("");
  const [creatingToken,   setCreatingToken]    = useState(false);
  const [revealedToken,   setRevealedToken]    = useState(null);
  const [tokensLoading,   setTokensLoading]    = useState(isOwner);
  const [tokensError,     setTokensError]      = useState("");
  const [confirmState,    setConfirmState]     = useState(null);
  const hasStatusRef = useRef(false);
  const hasTokensRef = useRef(false);

  const webhookBase = `${window.location.origin}/webhook/`;

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent || !hasStatusRef.current) setLoadingSt(true);
    try {
      setStatus(await api("GET", "/api/system/status"));
      setStatusError("");
      hasStatusRef.current = true;
    } catch (err) {
      if (silent && hasStatusRef.current) {
        return;
      }
      setStatus(null);
      setStatusError(err.message || "Failed to load system health");
      hasStatusRef.current = false;
      if (!silent) {
        showToast(err.message || "Failed to load system health", "error");
      }
    } finally {
      if (!silent || !hasStatusRef.current) {
        setLoadingSt(false);
      }
    }
  }, [showToast]);

  const loadNodes = useCallback(async ({ silent = true } = {}) => {
    try {
      const r = await api("GET", "/api/nodes");
      setNodes(r.node_types || []);
    } catch (e) {
      setNodes([]);
      if (!silent) {
        showToast(e.message, "error");
      }
    }
  }, [showToast]);

  const loadRetention = useCallback(async ({ silent = true } = {}) => {
    try {
      setRetention(await api("GET", "/api/runs/retention"));
    } catch (e) {
      if (!silent) {
        showToast(e.message, "error");
      }
    }
  }, [showToast]);

  const loadRatelimit = useCallback(async ({ silent = true } = {}) => {
    try {
      setRatelimit(await api("GET", "/api/settings/ratelimit"));
    } catch (e) {
      if (!silent) {
        showToast(e.message, "error");
      }
    }
  }, [showToast]);

  const loadTokens = useCallback(async ({ silent = false } = {}) => {
    if (!silent || !hasTokensRef.current) setTokensLoading(true);
    try {
      setTokens(await api("GET", "/api/tokens"));
      setTokensError("");
      hasTokensRef.current = true;
    } catch (err) {
      if (silent && hasTokensRef.current) {
        return;
      }
      setTokens([]);
      setTokensError(err.message || "Failed to load API tokens");
      hasTokensRef.current = false;
      if (!silent) {
        showToast(err.message, "error");
      }
    } finally {
      if (!silent || !hasTokensRef.current) {
        setTokensLoading(false);
      }
    }
  }, [showToast]);

  useEffect(() => {
    loadStatus();
    loadNodes();
    loadRetention();
    loadRatelimit();
    if (isOwner) loadTokens();
  }, [isOwner, loadNodes, loadRatelimit, loadRetention, loadStatus, loadTokens]);

  async function createToken(e) {
    e.preventDefault();
    if (!newTokenName.trim()) return;
    setCreatingToken(true);
    try {
      const body = { name: newTokenName.trim(), scope: newTokenScope };
      const days = parseInt(newTokenExpiry);
      if (days > 0) body.expires_days = days;
      const t = await api("POST", "/api/tokens", body);
      setRevealedToken(t);
      setNewTokenName(""); setNewTokenExpiry("");
      await loadTokens({ silent: true });
    } catch (err) { showToast(err.message, "error"); }
    finally { setCreatingToken(false); }
  }

  async function revokeToken(id, name) {
    setConfirmState({
      message: `Revoke token "${name}"? Any services using it will lose access immediately.`,
      confirmLabel: "Revoke",
      fn: async () => {
        try { await api("DELETE", `/api/tokens/${id}`); await loadTokens({ silent: true }); showToast("Token revoked"); }
        catch (err) { showToast(err.message, "error"); }
      }
    });
  }

  async function reloadNodes() {
    setReloading(true);
    try {
      const r = await api("POST", "/api/admin/reload_nodes");
      setNodes(r.node_types || []);
      showToast(`Reloaded — ${(r.node_types || []).length} node types registered`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setReloading(false); }
  }

  async function clearRuns() {
    setConfirmState({
      message: "Delete ALL run history? This cannot be undone.",
      confirmLabel: "Delete",
      fn: async () => {
        setClearing(true);
        try { await api("DELETE", "/api/runs"); showToast("Run history cleared"); await loadStatus(); }
        catch (e) { showToast(e.message, "error"); }
        finally { setClearing(false); }
      }
    });
  }

  async function saveRatelimit() {
    setSavingRL(true);
    try {
      const saved = await api("PUT", "/api/settings/ratelimit", { limit: ratelimit.limit, window: ratelimit.window });
      setRatelimit(r => ({ ...r, ...saved }));
      showToast("Rate limit policy saved");
    } catch (e) { showToast(e.message, "error"); }
    finally { setSavingRL(false); }
  }

  async function saveRetention() {
    setSavingRetention(true);
    try {
      const saved = await api("PUT", "/api/runs/retention", retention);
      setRetention(saved);
      showToast("Retention policy saved");
    } catch (e) { showToast(e.message, "error"); }
    finally { setSavingRetention(false); }
  }

  async function trimNow() {
    const body = retention.mode === "age" ? { days: retention.days } : { keep: retention.count };
    const modeLabel = retention.mode === "age"
      ? `runs older than ${retention.days} day${retention.days !== 1 ? "s" : ""}`
      : `all but the ${retention.count} most recent run${retention.count !== 1 ? "s" : ""}`;
    setConfirmState({
      message: `Delete ${modeLabel}? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        setTrimming(true);
        try {
          const r = await api("POST", "/api/runs/trim", body);
          showToast(`Trimmed ${r.deleted} old run${r.deleted !== 1 ? "s" : ""}`);
          await loadStatus();
        } catch (e) { showToast(e.message, "error"); }
        finally { setTrimming(false); }
      }
    });
  }

  async function resetSeqs() {
    setConfirmState({
      message: "Reset ID sequences? Only safe when all tables are empty.",
      confirmLabel: "Reset",
      fn: async () => {
        setResetting(true);
        try { await api("POST", "/api/maintenance/reset_sequences"); showToast("Sequences reset"); }
        catch (e) { showToast(e.message, "error"); }
        finally { setResetting(false); }
      }
    });
  }

  function copyWebhook() {
    navigator.clipboard.writeText(webhookBase)
      .then(() => showToast("Webhook URL copied"))
      .catch(() => showToast("Failed to copy webhook URL", "error"));
  }

  function copyRevealedToken() {
    navigator.clipboard.writeText(revealedToken.token)
      .then(() => showToast("Token copied to clipboard"))
      .catch(() => showToast("Failed to copy token", "error"));
  }

  const st  = status || {};
  const db  = st.db || {};
  const redis = st.redis || {};
  const worker = st.worker || {};
  const sys = st.system || {};
  const statusOf = s => loadingSt ? "loading" : (s.status || "error");

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 className="page-title">Settings</h1>

      {/* ── System Health ── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>System Health</div>
          <button className="btn btn-ghost btn-sm" onClick={() => loadStatus()} disabled={loadingSt}>
            {loadingSt ? "Checking…" : "↺ Refresh"}
          </button>
        </div>
        {!loadingSt && statusError && (
          <div className="empty-state" style={{ marginBottom: 16 }}>{statusError}</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
          {[
            { label: "Database",      s: statusOf(db),     detail: db.status === "ok" ? `${db.db_size} · ${db.run_count} runs · ${db.flow_count} flows` : db.error },
            { label: "Redis",         s: statusOf(redis),  detail: redis.status === "ok" ? redis.url : redis.error },
            { label: "Celery Worker", s: statusOf(worker), detail: worker.status === "ok" ? `${worker.workers} worker${worker.workers !== 1 ? "s" : ""} active` : worker.status === "warning" ? "No workers responding" : worker.error },
          ].map(({ label, s, detail }) => (
            <div key={label} style={{ background: "#0f1117", border: "1px solid #2a2d3e", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".05em" }}>{label}</div>
              <StatusDot status={s} />
              {detail && <div style={{ fontSize: 11, color: "#475569", marginTop: 5, wordBreak: "break-all" }}>{detail}</div>}
            </div>
          ))}
        </div>
        {sys.hostname && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 12, color: "#475569", borderTop: "1px solid #1e2130", paddingTop: 12 }}>
            {[["Version", `v${sys.app_version}`], ["Python", sys.python], ["Host", sys.hostname], ["PID", sys.pid], ["Platform", sys.platform]].map(([k, v]) => (
              <span key={k}><span style={{ color: "#64748b" }}>{k}: </span>{v}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── API Tokens ── */}
      {isOwner && (
        <div className="card">
          <div className="card-title">API Tokens</div>
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 14 }}>
            Tokens allow external services and scripts to call the API without a browser session.
            Preferred: <code style={{ color: "#a78bfa" }}>Authorization: Bearer &lt;token&gt;</code> header.
            Legacy: <code style={{ color: "#64748b" }}>x-api-token</code> header (also accepted).
            Tokens are shown only once at creation — store them securely.
            Choose <strong>read</strong> for monitoring, <strong>run</strong> for CI pipelines, <strong>manage</strong> for full API access.
          </p>
          <form onSubmit={createToken} style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            <input value={newTokenName} onChange={e => setNewTokenName(e.target.value)}
              placeholder="Token name (e.g. CI pipeline, monitoring)" style={{ flex: "1 1 200px", minWidth: 160 }} />
            <select value={newTokenScope} onChange={e => setNewTokenScope(e.target.value)}
              title="Permission scope" style={{ width: 110, flex: "none" }}>
              <option value="read">read</option>
              <option value="run">run</option>
              <option value="manage">manage</option>
            </select>
            <input value={newTokenExpiry} onChange={e => setNewTokenExpiry(e.target.value)}
              placeholder="Expires in days" type="number" min="1"
              title="Leave blank for no expiry" style={{ width: 140, flex: "none" }} />
            <button type="submit" className="btn btn-primary" disabled={creatingToken || !newTokenName.trim()}>
              {creatingToken ? "Generating…" : "+ Generate"}
            </button>
          </form>
          {tokensLoading ? (
            <div className="empty-state" style={{ padding: "12px 0" }}>Loading tokens…</div>
          ) : tokensError ? (
            <div className="empty-state" style={{ padding: "12px 0" }}>{tokensError}</div>
          ) : tokens.length === 0 ? (
            <div className="empty-state" style={{ padding: "12px 0" }}>No API tokens yet.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Name</th><th>Scope</th><th>Created</th><th>Last used</th><th>Expires</th><th></th></tr>
              </thead>
              <tbody>
                {tokens.map(t => {
                  const expired = t.expires_at && new Date(t.expires_at) < new Date();
                  const expiryLabel = !t.expires_at ? "Never"
                    : expired ? <span style={{ color: "#f87171" }}>Expired</span>
                    : new Date(t.expires_at).toLocaleDateString();
                  return (
                    <tr key={t.id} style={{ opacity: expired ? 0.5 : 1 }}>
                      <td style={{ fontWeight: 500 }}>{t.name}</td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 10,
                          background: t.scope === "manage" ? "#3f2d70" : t.scope === "run" ? "#1e3a5f" : "#1a2e1a",
                          color: t.scope === "manage" ? "#c4b5fd" : t.scope === "run" ? "#60a5fa" : "#4ade80",
                        }}>{t.scope || "manage"}</span>
                      </td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{new Date(t.created_at).toLocaleString()}</td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{t.last_used ? new Date(t.last_used).toLocaleString() : "Never"}</td>
                      <td style={{ fontSize: 12, color: "#64748b" }}>{expiryLabel}</td>
                      <td><button className="btn btn-danger btn-sm" onClick={() => revokeToken(t.id, t.name)}>Revoke</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Token reveal modal ── */}
      {revealedToken && (
        <TokenRevealModal
          token={revealedToken}
          onCopy={copyRevealedToken}
          onClose={() => setRevealedToken(null)}
        />
      )}

      {/* ── Webhook URL ── */}
      <div className="card">
        <div className="card-title">Webhook Base URL</div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 10 }}>Trigger flows via HTTP. Append the webhook token configured on a Webhook Trigger node.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <code style={{ flex: 1, padding: "9px 12px", background: "#0f1117", borderRadius: 6, fontSize: 13, color: "#4ade80", userSelect: "all", border: "1px solid #2a2d3e" }}>
            {webhookBase}<span style={{ color: "#64748b" }}>{"<token>"}</span>
          </code>
          <button className="btn btn-ghost btn-sm" onClick={copyWebhook}>⎘ Copy</button>
        </div>
      </div>

      {/* ── Quick Links ── */}
      <div className="card">
        <div className="card-title">Quick Links</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary btn-sm" onClick={() => window.open("/canvas")}>⚡ Open Canvas →</button>
          <a href="/flower/" target="_blank" className="btn btn-ghost btn-sm">🌸 Flower monitor ↗</a>
          <a href="/docs" target="_blank" className="btn btn-ghost btn-sm">📖 Swagger docs ↗</a>
        </div>
      </div>

      {/* ── Node Registry ── */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div className="card-title" style={{ margin: 0 }}>Node Registry</div>
          <button className="btn btn-ghost btn-sm" onClick={reloadNodes} disabled={reloading}>
            {reloading ? "Reloading…" : "↺ Reload custom nodes"}
          </button>
        </div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>
          {nodes.length} node type{nodes.length !== 1 ? "s" : ""} registered. Custom nodes live in{" "}
          <code style={{ color: "#a78bfa" }}>app/nodes/custom/</code> and can be hot-reloaded without a restart.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {nodes.map(n => (
            <span key={n} style={{ background: "#1e2130", border: "1px solid #2a2d3e", borderRadius: 4, padding: "3px 8px", fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{n}</span>
          ))}
        </div>
      </div>

      {/* ── Run Retention Policy ── */}
      <div className="card">
        <div className="card-title">Run History &amp; Retention</div>
        {db.run_count != null && (
          <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
            {db.run_count} run{db.run_count !== 1 ? "s" : ""} stored in the database.
          </p>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 14, userSelect: "none" }}>
          <div style={{
            position: "relative", width: 36, height: 20, borderRadius: 10, flexShrink: 0,
            background: retention.enabled ? "#7c3aed" : "#2a2d3e", transition: "background .2s", cursor: "pointer"
          }} onClick={() => setRetention(r => ({ ...r, enabled: !r.enabled }))}>
            <div style={{
              position: "absolute", top: 2, left: retention.enabled ? 18 : 2, width: 16, height: 16,
              borderRadius: "50%", background: "#fff", transition: "left .2s"
            }} />
          </div>
          <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>Auto-trim runs nightly</span>
          {retention.enabled && <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>ON</span>}
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16,
          opacity: retention.enabled ? 1 : 0.45, pointerEvents: retention.enabled ? "auto" : "none" }}>
          <select value={retention.mode} onChange={e => setRetention(r => ({ ...r, mode: e.target.value }))}
            style={{ background: "#0f1117", border: "1px solid #2a2d3e", borderRadius: 6, padding: "5px 10px", color: "#e2e8f0", fontSize: 13 }}>
            <option value="count">Keep last N runs</option>
            <option value="age">Delete runs older than N days</option>
          </select>
          <input type="number" min="1"
            value={retention.mode === "age" ? retention.days : retention.count}
            onChange={e => {
              const v = Math.max(1, parseInt(e.target.value) || 1);
              setRetention(r => retention.mode === "age" ? { ...r, days: v } : { ...r, count: v });
            }}
            style={{ width: 80, background: "#0f1117", border: "1px solid #2a2d3e", borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 13 }} />
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{retention.mode === "age" ? "days" : "runs"}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <button className="btn btn-primary btn-sm" onClick={saveRetention} disabled={savingRetention}>
            {savingRetention ? "Saving…" : "Save policy"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={trimNow} disabled={trimming}>
            {trimming ? "Trimming…" : "✂ Trim now"}
          </button>
          <span style={{ fontSize: 11, color: "#475569" }}>Trim now applies the current mode and value immediately.</span>
        </div>
        <div style={{ borderTop: "1px solid #1e2130", paddingTop: 12 }}>
          <button className="btn btn-danger btn-sm" onClick={clearRuns} disabled={clearing}>
            {clearing ? "Clearing…" : "🗑 Clear all run history"}
          </button>
          <span style={{ fontSize: 11, color: "#475569", marginLeft: 10 }}>Permanently deletes all run records and traces.</span>
        </div>
      </div>

      {/* ── Webhook Rate Limits ── */}
      <div className="card">
        <div className="card-title">Webhook Rate Limits</div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 16 }}>
          Maximum number of webhook calls allowed per token within a rolling window.
          Set limit to <strong>0</strong> to disable rate limiting entirely.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Max calls", key: "limit", min: 0 },
            { label: "Window (seconds)", key: "window", min: 1 },
          ].map(({ label, key, min }) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</label>
              <input type="number" min={min} value={ratelimit[key]}
                onChange={e => setRatelimit(r => ({ ...r, [key]: Math.max(min, parseInt(e.target.value) || min) }))}
                style={{ width: 90, background: "#0f1117", border: "1px solid #2a2d3e", borderRadius: 6, padding: "5px 8px", color: "#e2e8f0", fontSize: 13 }} />
            </div>
          ))}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>&nbsp;</label>
            <button className="btn btn-primary btn-sm" onClick={saveRatelimit} disabled={savingRL}>
              {savingRL ? "Saving…" : "Save"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>&nbsp;</label>
            <button className="btn btn-ghost btn-sm" onClick={() => loadRatelimit({ silent: false })}>↻ Refresh</button>
          </div>
        </div>
        <div style={{ fontSize: 11, color: ratelimit.limit === 0 ? "#f59e0b" : "#475569", marginBottom: ratelimit.counters?.length ? 16 : 0 }}>
          {ratelimit.limit === 0 ? "⚠ Rate limiting is disabled." : `Current policy: ${ratelimit.limit} calls per ${ratelimit.window}s per webhook token.`}
        </div>
        {ratelimit.counters?.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 8 }}>Live counters (from Redis)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ratelimit.counters.map(c => (
                <div key={c.token} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", background: "#0f1117", borderRadius: 6, fontSize: 11 }}>
                  <code style={{ color: "#a78bfa", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.token}</code>
                  <span style={{ color: c.count >= ratelimit.limit ? "#f87171" : "#4ade80", fontWeight: 600, flexShrink: 0 }}>{c.count}/{ratelimit.limit}</span>
                  <span style={{ color: "#475569", flexShrink: 0 }}>resets in {c.ttl_seconds}s</span>
                </div>
              ))}
            </div>
          </>
        )}
        {ratelimit.counters?.length === 0 && ratelimit.limit > 0 && (
          <div style={{ fontSize: 11, color: "#475569" }}>No active webhook traffic in the current window.</div>
        )}
      </div>

      {/* ── Danger Zone ── */}
      <div className="card" style={{ borderColor: "#7f1d1d44" }}>
        <div className="card-title" style={{ color: "#f87171" }}>Danger Zone</div>
        <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>
          Reset PostgreSQL ID sequences back to 1. <strong style={{ color: "#f87171" }}>Only run this when all tables are completely empty</strong>, otherwise it will cause duplicate key errors.
        </p>
        <button className="btn btn-danger btn-sm" disabled={resetting} onClick={resetSeqs}>
          {resetting ? "Resetting…" : "Reset ID sequences"}
        </button>
      </div>

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

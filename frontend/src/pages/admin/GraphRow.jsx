import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

/**
 * GraphRow — one row in the Flows list.
 * Includes inline HistoryModal and AlertSettingsModal.
 */
/* ── Tag colour palette (cycles through 6 hues) ─────────────────────────── */
const TAG_COLOURS = [
  { bg: "#1e1b4b", border: "#4338ca", text: "#a5b4fc" },
  { bg: "#0c4a6e", border: "#0369a1", text: "#7dd3fc" },
  { bg: "#064e3b", border: "#059669", text: "#6ee7b7" },
  { bg: "#4a1942", border: "#9333ea", text: "#d8b4fe" },
  { bg: "#78350f", border: "#d97706", text: "#fcd34d" },
  { bg: "#7f1d1d", border: "#dc2626", text: "#fca5a5" },
];
function tagColour(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  return TAG_COLOURS[h % TAG_COLOURS.length];
}

export function GraphRow({ g, running, onRun, onToggle, onDuplicate, onDelete, onRename, showToast, load, isExample, ro }) {
  const [open, setOpen]                     = useState(false);
  const [showVersions, setShowVersions]     = useState(false);
  const [versions, setVersions]             = useState([]);
  const [loadingVersions, setLoadingVers]   = useState(false);
  const [previewVersion, setPreviewVersion] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirmState, setConfirmState]     = useState(null);
  const [showAlerts, setShowAlerts]         = useState(false);
  const [alertCfg, setAlertCfg]             = useState({ alert_emails: "", alert_webhook: "", alert_on_success: false });
  const [savingAlerts, setSavingAlerts]     = useState(false);
  const [editingTags,  setEditingTags]      = useState(false);
  const [tagInput,     setTagInput]         = useState("");

  const nodeCount = ((g.graph_data?.nodes) || []).filter(n => n.type !== "note").length;
  const tags = Array.isArray(g.tags) ? g.tags : [];

  async function addTag(tag) {
    const t = tag.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!t || tags.includes(t)) return;
    try { await api("PUT", `/api/graphs/${g.id}`, { tags: [...tags, t] }); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function removeTag(tag) {
    try { await api("PUT", `/api/graphs/${g.id}`, { tags: tags.filter(t => t !== tag) }); load(); }
    catch (e) { showToast(e.message, "error"); }
  }

  function handleTagKeyDown(e) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
      setTagInput("");
    } else if (e.key === "Escape") {
      setEditingTags(false);
      setTagInput("");
    }
  }

  useEffect(() => {
    if (!showVersions) return;
    const h = e => { if (e.key === "Escape") setShowVersions(false); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [showVersions]);

  async function openVersionHistory() {
    setLoadingVers(true);
    try {
      const v = await api("GET", `/api/graphs/${g.id}/versions`);
      setVersions(v);
      setShowVersions(true);
    } catch (e) { showToast(e.message, "error"); }
    setLoadingVers(false);
  }

  async function previewVer(v) {
    setLoadingPreview(v.id);
    try {
      const full = await api("GET", `/api/graphs/${g.id}/versions/${v.id}`);
      setPreviewVersion(full);
    } catch (e) { showToast(e.message, "error"); }
    setLoadingPreview(false);
  }

  async function openAlerts() {
    try {
      const cfg = await api("GET", `/api/graphs/${g.id}/alerts`);
      setAlertCfg({
        alert_emails:     cfg.alert_emails    || "",
        alert_webhook:    cfg.alert_webhook   || "",
        alert_on_success: cfg.alert_on_success || false,
      });
      setShowAlerts(true);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function saveAlerts() {
    setSavingAlerts(true);
    try {
      await api("PUT", `/api/graphs/${g.id}/alerts`, {
        alert_emails:     alertCfg.alert_emails.trim()  || null,
        alert_webhook:    alertCfg.alert_webhook.trim() || null,
        alert_on_success: alertCfg.alert_on_success,
      });
      showToast("Alert settings saved");
      setShowAlerts(false);
    } catch (e) { showToast(e.message, "error"); }
    setSavingAlerts(false);
  }

  function restoreVersion(vid) {
    setConfirmState({
      message: "Restore this version? Current changes will be lost.",
      confirmLabel: "Restore",
      fn: async () => {
        try {
          await api("POST", `/api/graphs/${g.id}/versions/${vid}/restore`);
          showToast("Version restored");
          load();
          setShowVersions(false);
          setPreviewVersion(null);
        } catch (e) { showToast(e.message, "error"); }
      },
    });
  }

  return (
    <>
      <div style={{ borderBottom: "1px solid #1e2235", paddingBottom: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: "#e2e8f0" }}>{g.name}</span>
              <span className={`badge ${g.enabled ? "badge-succeeded" : "badge-cancelled"}`}>{g.enabled ? "enabled" : "disabled"}</span>
              <span style={{ fontSize: 11, color: "#4b5563" }}>#{g.id} · {nodeCount} node{nodeCount !== 1 ? "s" : ""}</span>
            </div>
            {g.description && <div style={{ fontSize: 12, color: "#64748b" }}>{g.description}</div>}
            {tags.length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                {tags.map(t => {
                  const c = tagColour(t);
                  return (
                    <span key={t} style={{
                      background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                      borderRadius: 4, padding: "1px 7px", fontSize: 10, fontWeight: 500,
                    }}>{t}</span>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flex: "none" }}>
            <a className="btn btn-ghost" href={`/canvas#graph-${g.id}`}>{ro ? "👁 View" : "✏️ Edit"}</a>
            {!ro && (
              <button className="btn btn-success" disabled={running === g.id || !g.enabled}
                onClick={() => onRun(g.id, g.name)}>
                {running === g.id ? "…" : "▶"}
              </button>
            )}
            {!ro && (
              <button className="btn btn-ghost" onClick={() => setOpen(o => !o)} aria-expanded={open}>⋯</button>
            )}
          </div>
        </div>

        {open && (
          <div style={{ display: "flex", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid #1e2235", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={() => onRename(g)}>✏ Rename</button>
            <button className="btn btn-ghost" onClick={() => onDuplicate(g)}>📋 Duplicate</button>
            <button className="btn btn-ghost" onClick={openVersionHistory} disabled={loadingVersions}>📜 History</button>
            <button className="btn btn-ghost" onClick={openAlerts}>🔔 Alerts</button>
            <button className="btn btn-ghost" onClick={() => { setEditingTags(t => !t); setTagInput(""); }}>🏷 Tags</button>
            <button className="btn btn-ghost" onClick={() => onToggle(g.id, g.enabled)}>{g.enabled ? "⏸ Disable" : "▶ Enable"}</button>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: "#4b5563", alignSelf: "center", display: "flex", gap: 8, alignItems: "center" }}>
              Webhook: <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>{"••••••••"}</span>
              <button className="btn btn-ghost" style={{ marginLeft: 8, padding: "3px 8px", fontSize: 11 }}
                onClick={() => navigator.clipboard.writeText(g.webhook_token).then(() => showToast("Copied")).catch(() => showToast("Copy failed", "error"))}>
                Copy
              </button>
            </div>
            <button className="btn btn-danger" onClick={() => onDelete(g.id, g.name)}
              title={isExample ? "⚠ This is an example flow — use ↺ Restore examples to get it back" : undefined}>
              🗑 Delete{isExample ? " (example)" : ""}
            </button>
          </div>
        )}

        {open && editingTags && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "#0f1117", borderRadius: 6, border: "1px solid #2a2d3e" }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
              🏷 Tags — press <kbd style={{ background: "#1e2235", borderRadius: 3, padding: "1px 4px", fontSize: 10 }}>Enter</kbd> or <kbd style={{ background: "#1e2235", borderRadius: 3, padding: "1px 4px", fontSize: 10 }}>,</kbd> to add · click pill to remove
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
              {tags.map(t => {
                const c = tagColour(t);
                return (
                  <span key={t} style={{
                    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
                    borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 500,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  }}
                    onClick={() => removeTag(t)}
                    title="Click to remove"
                  >
                    {t} <span style={{ opacity: 0.6, fontSize: 10 }}>✕</span>
                  </span>
                );
              })}
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => { if (tagInput) { addTag(tagInput); setTagInput(""); } }}
                placeholder="Add tag…"
                autoFocus
                style={{
                  background: "transparent", border: "none", outline: "none",
                  color: "#e2e8f0", fontSize: 12, width: 100, padding: "2px 0",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Version History Modal ── */}
      {showVersions && (
        <div className="modal-overlay" aria-hidden="true"
          onClick={e => { if (e.target === e.currentTarget) { setShowVersions(false); setPreviewVersion(null); } }}>
          <div className="modal" style={{ width: previewVersion ? 700 : 480, maxWidth: "95vw" }}
            role="dialog" aria-modal="true" aria-label="Version History">
            <h2>📜 Version History — {g.name}</h2>
            <div style={{ display: "grid", gridTemplateColumns: previewVersion ? "220px 1fr" : "1fr", gap: 16, marginTop: 12 }}>
              <div>
                {versions.length === 0 ? (
                  <div className="empty-state" style={{ padding: "20px 0" }}>
                    No versions yet — versions are saved automatically each time you save the flow.
                  </div>
                ) : versions.map((v, idx) => (
                  <div key={idx} className="version-row"
                    style={{
                      background: previewVersion?.id === v.id ? "#252840" : "transparent",
                      borderLeft: `3px solid ${previewVersion?.id === v.id ? "#7c3aed" : "transparent"}`,
                      borderRadius: 4, paddingLeft: 6,
                    }}>
                    <div className="version-info" style={{ flex: 1, cursor: "pointer" }} onClick={() => previewVer(v)}>
                      <div className="version-num">v{v.version}</div>
                      <div className="version-date">{new Date(v.saved_at).toLocaleString()}</div>
                      {v.note && <div className="version-note">{v.note}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" disabled={loadingPreview === v.id} onClick={() => previewVer(v)}>
                        {loadingPreview === v.id ? "…" : "👁"}
                      </button>
                      {!ro && <button className="btn btn-ghost btn-sm" onClick={() => restoreVersion(v.version)}>↩</button>}
                    </div>
                  </div>
                ))}
              </div>

              {previewVersion && (
                <div style={{ borderLeft: "1px solid #2a2d3e", paddingLeft: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontWeight: 600, color: "#e2e8f0" }}>v{previewVersion.version} preview</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {!ro && (
                        <button className="btn btn-primary btn-sm" onClick={() => restoreVersion(previewVersion.version)}>
                          ↩ Restore this version
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setPreviewVersion(null)}>✕</button>
                    </div>
                  </div>
                  {previewVersion.note && (
                    <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10, fontStyle: "italic" }}>{previewVersion.note}</div>
                  )}
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                    {(() => {
                      const nodes = (previewVersion.graph_data?.nodes || []).filter(n => n.type !== "note");
                      const edges = previewVersion.graph_data?.edges || [];
                      return `${nodes.length} node${nodes.length !== 1 ? "s" : ""} · ${edges.length} edge${edges.length !== 1 ? "s" : ""}`;
                    })()}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Nodes</div>
                  <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
                    {(previewVersion.graph_data?.nodes || []).filter(n => n.type !== "note").map((n, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid #1e2130", fontSize: 12 }}>
                        <span style={{ color: "#94a3b8", fontFamily: "monospace", fontSize: 10, flex: "none", width: 90, overflow: "hidden", textOverflow: "ellipsis" }}>{n.type}</span>
                        <span style={{ color: "#e2e8f0" }}>{n.data?.label || n.id}</span>
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary style={{ fontSize: 11, color: "#475569", cursor: "pointer", marginBottom: 4 }}>Raw JSON</summary>
                    <pre style={{ background: "#0a0c14", border: "1px solid #1e2235", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: "#64748b", maxHeight: 160, overflowY: "auto", whiteSpace: "pre-wrap", margin: 0 }}>
                      {JSON.stringify(previewVersion.graph_data, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
            <div className="modal-btns">
              <button className="btn btn-ghost" onClick={() => { setShowVersions(false); setPreviewVersion(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Alert Settings Modal ── */}
      {showAlerts && (
        <div className="modal-overlay" aria-hidden="true"
          onClick={e => { if (e.target === e.currentTarget) setShowAlerts(false); }}>
          <div className="modal" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-label="Alert Settings">
            <h2>🔔 Alert Settings — {g.name}</h2>
            <p style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>
              Notifications are sent when this flow fails. Enable "also on success" to alert on every run.
            </p>
            <div className="form-group">
              <label>Email recipients</label>
              <input type="text" placeholder="alice@example.com, bob@example.com"
                value={alertCfg.alert_emails}
                onChange={e => setAlertCfg(c => ({ ...c, alert_emails: e.target.value }))} />
              <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>Comma-separated. Requires AGENTMAIL_API_KEY in .env.</div>
            </div>
            <div className="form-group">
              <label>Webhook URL</label>
              <input type="url" placeholder="https://hooks.example.com/…"
                value={alertCfg.alert_webhook}
                onChange={e => setAlertCfg(c => ({ ...c, alert_webhook: e.target.value }))} />
              <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>POST JSON with event, flow, task_id, status, error.</div>
            </div>
            <div className="form-group" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <input type="checkbox" id={`alert-success-${g.id}`} checked={alertCfg.alert_on_success}
                onChange={e => setAlertCfg(c => ({ ...c, alert_on_success: e.target.checked }))}
                style={{ width: 16, height: 16, accentColor: "#7c3aed", cursor: "pointer" }} />
              <label htmlFor={`alert-success-${g.id}`} style={{ fontSize: 13, color: "#94a3b8", cursor: "pointer", margin: 0 }}>
                Also alert on successful runs
              </label>
            </div>
            <div className="modal-btns">
              <button className="btn btn-ghost" onClick={() => setShowAlerts(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={savingAlerts} onClick={saveAlerts}>
                {savingAlerts ? "Saving…" : "Save alerts"}
              </button>
            </div>
          </div>
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
    </>
  );
}

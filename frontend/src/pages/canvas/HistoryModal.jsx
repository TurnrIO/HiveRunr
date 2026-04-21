import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * HistoryModal — two-pane version history viewer with preview and restore.
 */
export function HistoryModal({ isOpen, onClose, graphId, showToast, onRestored }) {
  const [versions,      setVersions]      = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [selected,      setSelected]      = useState(null);   // version object
  const [preview,       setPreview]       = useState(null);   // { nodes, edges }
  const [restoring,     setRestoring]     = useState(false);
  const [confirmState,  setConfirmState]  = useState(null);

  useEffect(() => {
    if (!isOpen || !graphId) return;
    setSelected(null);
    setPreview(null);
    async function load() {
      setLoading(true);
      try {
        const v = await api("GET", `/api/graphs/${graphId}/versions`);
        setVersions(v || []);
      } catch (e) {
        showToast(e.message, "error");
      }
      setLoading(false);
    }
    load();
  }, [isOpen, graphId]);

  async function selectVersion(v) {
    setSelected(v);
    setPreview(null);
    try {
      const detail = await api("GET", `/api/graphs/${graphId}/versions/${v.version}`);
      const gd = detail.graph_data || {};
      setPreview({ nodes: gd.nodes || [], edges: gd.edges || [] });
    } catch { /* preview is optional */ }
  }

  function restore() {
    if (!selected) return;
    setConfirmState({
      message: `Restore to Version ${selected.version}? Unsaved changes will be lost.`,
      confirmLabel: "Restore",
      fn: async () => {
        setRestoring(true);
        try {
          const restored = await api("POST", `/api/graphs/${graphId}/versions/${selected.version}/restore`);
          showToast(`Restored to v${selected.version} ✓`);
          if (onRestored) onRestored(restored);
          onClose();
        } catch (e) {
          showToast(e.message, "error");
        }
        setRestoring(false);
      },
    });
  }

  if (!isOpen) return null;

  const nonNoteNodes = (preview?.nodes || []).filter(n => n.type !== "note");

  return (
    <>
      <div
        className="modal-overlay"
        aria-hidden="true"
        onClick={e => { if (e.target.className === "modal-overlay") onClose(); }}
      >
        <div
          className="modal"
          style={{ maxWidth: 700, width: "95vw", padding: 0, overflow: "hidden" }}
          role="dialog"
          aria-modal="true"
          aria-label="Version History"
        >
          <div style={{ display: "flex", height: 480 }}>

            {/* ── Left: version list ── */}
            <div style={{
              width: 230, flexShrink: 0, borderRight: "1px solid #1e2130",
              overflowY: "auto", display: "flex", flexDirection: "column",
            }}>
              <div style={{ padding: "16px 16px 10px", borderBottom: "1px solid #1e2130" }}>
                <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>📜 Version History</h2>
              </div>

              {loading ? (
                <div style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 13 }}>
                  Loading…
                </div>
              ) : versions.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 13 }}>
                  No versions yet.
                </div>
              ) : (
                <div style={{ flex: 1, overflowY: "auto" }}>
                  {versions.map((v, idx) => {
                    const isCurrent = idx === 0;
                    const isSel     = selected?.version === v.version;
                    return (
                      <div
                        key={v.version}
                        onClick={() => selectVersion(v)}
                        style={{
                          padding: "10px 14px", cursor: "pointer",
                          borderBottom: "1px solid #1e2130",
                          background:   isSel ? "#1e1b4b" : "transparent",
                          borderLeft:   isSel ? "3px solid #7c3aed" : "3px solid transparent",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: isSel ? "#a78bfa" : "#e2e8f0" }}>
                            v{v.version}
                          </span>
                          {isCurrent && (
                            <span style={{
                              fontSize: 10, background: "#14532d", color: "#4ade80",
                              padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                            }}>CURRENT</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>{fmtDate(v.saved_at)}</div>
                        {v.note && (
                          <div style={{
                            fontSize: 11, color: "#94a3b8", marginTop: 2,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{v.note}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Right: preview pane ── */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {!selected ? (
                <div style={{
                  flex: 1, display: "flex", alignItems: "center",
                  justifyContent: "center", color: "#475569", fontSize: 13,
                }}>
                  ← Select a version to preview
                </div>
              ) : (
                <>
                  <div style={{ padding: "16px 18px 10px", borderBottom: "1px solid #1e2130" }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>
                      Version {selected.version}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{fmtDate(selected.saved_at)}</div>
                    {selected.note && (
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{selected.note}</div>
                    )}
                  </div>

                  <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
                    {!preview ? (
                      <div style={{ color: "#64748b", fontSize: 12 }}>Loading preview…</div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
                          <div style={{ background: "#0f1117", borderRadius: 6, padding: "8px 14px", fontSize: 12 }}>
                            <span style={{ color: "#64748b" }}>Nodes </span>
                            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{nonNoteNodes.length}</span>
                          </div>
                          <div style={{ background: "#0f1117", borderRadius: 6, padding: "8px 14px", fontSize: 12 }}>
                            <span style={{ color: "#64748b" }}>Edges </span>
                            <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{preview.edges.length}</span>
                          </div>
                        </div>
                        <div style={{
                          fontSize: 11, color: "#64748b", marginBottom: 6,
                          textTransform: "uppercase", letterSpacing: "0.5px",
                        }}>Nodes in this version</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {nonNoteNodes.map(n => (
                            <div key={n.id} style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "5px 8px", background: "#0f1117", borderRadius: 5,
                            }}>
                              <span style={{
                                fontSize: 11, color: "#7c3aed", fontFamily: "monospace",
                                minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              }}>
                                {n.data?.label || n.type}
                              </span>
                              <span style={{ fontSize: 10, color: "#475569", marginLeft: "auto", whiteSpace: "nowrap" }}>
                                {n.type}
                              </span>
                            </div>
                          ))}
                          {nonNoteNodes.length === 0 && (
                            <div style={{ color: "#475569", fontSize: 12 }}>No nodes</div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{
                    padding: "12px 18px", borderTop: "1px solid #1e2130",
                    display: "flex", gap: 8, justifyContent: "flex-end",
                  }}>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={restore}
                      disabled={restoring || versions[0]?.version === selected?.version}
                    >
                      {restoring ? "Restoring…" : `↩ Restore v${selected.version}`}
                    </button>
                  </div>
                </>
              )}
            </div>

          </div>

          {!selected && (
            <div style={{ padding: "10px 16px", borderTop: "1px solid #1e2130", textAlign: "right" }}>
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
            </div>
          )}
        </div>
      </div>

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

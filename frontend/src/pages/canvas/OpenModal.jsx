import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import ConfirmModal from "../../components/ConfirmModal.jsx";
import { isTemplate } from "./canvasHelpers.js";

const CAT_COLOR = {
  Monitoring: "#0891b2", AI: "#8b5cf6", Integrations: "#0284c7",
  Productivity: "#059669", Reporting: "#d97706", Notifications: "#7c3aed",
  Automation: "#be185d", Data: "#0d9488", General: "#4b5563",
};

/**
 * OpenModal — file-picker / template gallery.
 *
 * Props:
 *   graphs        — array of graph objects from the API
 *   onClose       — close handler
 *   onSelect(g)   — open an existing graph
 *   onNew(name)   — create a new graph
 *   onDuplicate(g)
 *   onDelete(id, name)
 *   onRename(g)
 *   onFromTemplate(created) — called after importing a built-in template
 */
export function OpenModal({ graphs, onClose, onSelect, onNew, onDuplicate, onDelete, onRename, onFromTemplate }) {
  const [tab,              setTab]             = useState("flows");  // "flows" | "templates"
  const [name,             setName]            = useState("");
  const [search,           setSearch]          = useState("");
  const [busyId,           setBusyId]          = useState(null);
  const [confirmState,     setConfirmState]     = useState(null);
  // Built-in template gallery
  const [builtinTemplates, setBuiltinTemplates] = useState([]);
  const [tmplLoading,      setTmplLoading]      = useState(false);
  const [tmplCategory,     setTmplCategory]     = useState("All");
  const [tmplBusy,         setTmplBusy]         = useState(null);

  const q          = search.toLowerCase();
  const allFiltered = q
    ? graphs.filter(g => g.name.toLowerCase().includes(q) || (g.description || "").toLowerCase().includes(q))
    : graphs;
  const templates   = allFiltered.filter(g =>  isTemplate(g.name));
  const userFlows   = allFiltered.filter(g => !isTemplate(g.name));

  // Fetch built-in templates when the Templates tab opens
  useEffect(() => {
    if (tab !== "templates" || builtinTemplates.length > 0) return;
    setTmplLoading(true);
    api("GET", "/api/templates")
      .then(setBuiltinTemplates)
      .catch(() => {})
      .finally(() => setTmplLoading(false));
  }, [tab]);

  async function handleUseTemplate(slug) {
    setTmplBusy(slug);
    try {
      const tpl     = await api("GET", `/api/templates/${slug}`);
      const created = await api("POST", "/api/graphs/import", {
        name:        tpl.name,
        description: tpl.description || "",
        graph_data:  tpl.graph_data,
      });
      onFromTemplate(created);
    } catch { /* parent handles errors */ }
    setTmplBusy(null);
  }

  const tmplCategories = ["All", ...Array.from(new Set(builtinTemplates.map(t => t.category).filter(Boolean)))];
  const filteredTmpls  = tmplCategory === "All"
    ? builtinTemplates
    : builtinTemplates.filter(t => t.category === tmplCategory);

  async function handleDuplicate(e, g) {
    e.stopPropagation();
    setBusyId(g.id);
    await onDuplicate(g);
    setBusyId(null);
  }

  function handleDelete(e, g) {
    e.stopPropagation();
    const msg = isTemplate(g.name)
      ? `Delete example "${g.name}"?\nYou can restore it via ↺ Restore examples.\nThis cannot be undone.`
      : `Delete "${g.name}"?\nThis cannot be undone.`;
    setConfirmState({
      message: msg,
      confirmLabel: "Delete",
      fn: async () => {
        setBusyId(g.id);
        await onDelete(g.id, g.name);
        setBusyId(null);
      },
    });
  }

  async function handleRename(e, g) {
    e.stopPropagation();
    await onRename(g);
  }

  function nodeCount(g) {
    return ((g.graph_data?.nodes) || []).filter(n => n.type !== "note").length;
  }

  function renderRow(g, isTempl) {
    const busy = busyId === g.id;
    const nc   = nodeCount(g);
    return (
      <div key={g.id} className="graph-row" onClick={() => { if (!busy) onSelect(g); }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span className="graph-row-name">{g.name}</span>
            {isTempl && <span className="tmpl-badge">EXAMPLE</span>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {g.description && (
              <div className="graph-row-desc">
                {g.description.slice(0, 60)}{g.description.length > 60 ? "…" : ""}
              </div>
            )}
            <span style={{ fontSize: 10, color: "#4b5563", flexShrink: 0 }}>
              {nc} node{nc !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <span className="graph-row-badge" style={{ color: g.enabled ? "#4ade80" : "#f87171", marginRight: 6 }}>
          {g.enabled ? "●" : "○"}
        </span>
        <div className="graph-row-actions">
          <button className="btn-icon" title="Rename"    aria-label="Rename flow"    disabled={busy} onClick={e => handleRename(e, g)}>✏</button>
          <button className="btn-icon" title="Duplicate" aria-label="Duplicate flow" disabled={busy} onClick={e => handleDuplicate(e, g)}>📋</button>
          <button className="btn-icon danger" title="Delete" aria-label="Delete flow" disabled={busy} onClick={e => handleDelete(e, g)}>🗑</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="modal-overlay"
        aria-hidden="true"
        onClick={e => { if (e.target.className === "modal-overlay") onClose(); }}
      >
        <div className="modal" role="dialog" aria-modal="true" aria-label="Flows" style={{ maxWidth: 580 }}>
          <h2>📂 Flows</h2>

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid #2a2d3e" }}>
            {[["flows", "⚡ My Flows"], ["templates", "📦 Templates"]].map(([t, l]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "6px 16px", border: "none",
                  borderBottom: tab === t ? "2px solid #6366f1" : "2px solid transparent",
                  background: "none", color: tab === t ? "#a78bfa" : "#64748b",
                  cursor: "pointer", fontSize: 12,
                  fontWeight: tab === t ? 700 : 400, fontFamily: "inherit", marginBottom: -1,
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* ══ My Flows tab ══ */}
          {tab === "flows" && (
            <>
              {/* Create new */}
              <div className="field-group" style={{ marginBottom: 10 }}>
                <div className="field-label">New flow</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="field-input"
                    placeholder="Flow name…"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && name.trim()) onNew(name.trim()); }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!name.trim()}
                    onClick={() => onNew(name.trim())}
                  >Create</button>
                </div>
              </div>

              {/* Search */}
              <div className="field-group" style={{ marginBottom: 6 }}>
                <input
                  className="field-input"
                  placeholder="🔍 Search flows…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>

              {/* Your Flows */}
              <div className="modal-section">
                ⚡ Your Flows{userFlows.length > 0 ? ` (${userFlows.length})` : ""}
              </div>
              {userFlows.length === 0 && !q
                ? <div className="your-flows-empty">No flows yet — create one above or start from a template.</div>
                : userFlows.length === 0 && q
                ? <div className="your-flows-empty">No matching flows.</div>
                : userFlows.map(g => renderRow(g, false))
              }

              {/* Examples */}
              {templates.length > 0 && (
                <>
                  <div className="modal-section templates">
                    📚 Examples{templates.length > 0 ? ` (${templates.length})` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginBottom: 8 }}>
                    Click to open, ✏ rename, or 📋 duplicate to make your own copy.
                  </div>
                  {templates.map(g => renderRow(g, true))}
                </>
              )}
            </>
          )}

          {/* ══ Templates tab ══ */}
          {tab === "templates" && (
            <>
              {/* Category filter chips */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {tmplCategories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setTmplCategory(cat)}
                    style={{
                      background: tmplCategory === cat ? (CAT_COLOR[cat] || "#6366f1") : "#0f1117",
                      color:      tmplCategory === cat ? "#fff" : "#94a3b8",
                      border:     `1px solid ${tmplCategory === cat ? (CAT_COLOR[cat] || "#6366f1") : "#374151"}`,
                      borderRadius: 20, padding: "3px 12px", fontSize: 11,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {tmplLoading && (
                <div style={{ color: "#64748b", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                  Loading templates…
                </div>
              )}
              {!tmplLoading && filteredTmpls.length === 0 && (
                <div style={{ color: "#64748b", fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                  No templates in this category.
                </div>
              )}

              {/* Template cards grid */}
              <div style={{
                display: "grid", gridTemplateColumns: "1fr 1fr",
                gap: 10, maxHeight: 380, overflowY: "auto",
              }}>
                {filteredTmpls.map(t => {
                  const catColor = CAT_COLOR[t.category] || "#4b5563";
                  const busy     = tmplBusy === t.slug;
                  return (
                    <div key={t.slug} style={{
                      background: "#13161f", border: "1px solid #2a2d3e",
                      borderRadius: 8, padding: "12px 14px",
                      display: "flex", flexDirection: "column", gap: 6,
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: "#e2e8f0", lineHeight: 1.3 }}>
                          {t.name}
                        </span>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                          background: catColor + "22", color: catColor, border: `1px solid ${catColor}44`, flexShrink: 0,
                        }}>
                          {t.category}
                        </span>
                      </div>
                      <div style={{ color: "#64748b", fontSize: 11, lineHeight: 1.4, flex: 1 }}>
                        {t.description.slice(0, 90)}{t.description.length > 90 ? "…" : ""}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: "#374151" }}>
                          {t.node_count} node{t.node_count !== 1 ? "s" : ""}
                          {t.tags?.length > 0 && <> · {t.tags.slice(0, 2).join(", ")}</>}
                        </span>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: 11, padding: "3px 10px" }}
                          disabled={busy}
                          onClick={() => handleUseTemplate(t.slug)}
                        >
                          {busy ? "Creating…" : "Use template"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="modal-btns" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
          </div>
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

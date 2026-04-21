import { useState, useEffect } from "react";
import { api } from "../../api/client.js";

const CATEGORY_COLORS = {
  "Monitoring":   "#0891b2",
  "Integrations": "#7c3aed",
  "Productivity": "#059669",
  "Reporting":    "#d97706",
  "AI":           "#8b5cf6",
  "General":      "#475569",
};

export function Templates({ showToast }) {
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [importing, setImporting] = useState(null);

  useEffect(() => {
    api("GET", "/api/templates")
      .then(setTemplates)
      .catch(e => showToast(e.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  async function useTemplate(t) {
    setImporting(t.id);
    try {
      const g = await api("POST", `/api/templates/${t.id}/use`, {});
      showToast(`Flow "${g.name}" created! Open it in Canvas Flows.`);
    } catch (e) {
      showToast("Failed: " + e.message, "error");
    }
    setImporting(null);
  }

  // Group by category
  const groups = {};
  templates.forEach(t => {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  });

  return (
    <div className="page">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>📐 Workflow Templates</h1>
          <div style={{ fontSize: 13, color: "#64748b" }}>
            Start from a pre-built template — click <strong style={{ color: "#94a3b8" }}>Use template</strong> to create a flow, then edit it in Canvas Flows.
          </div>
        </div>
      </div>

      {loading && <div style={{ color: "#64748b", padding: 24 }}>Loading templates…</div>}
      {!loading && templates.length === 0 && (
        <div style={{ color: "#64748b", padding: 24 }}>
          No templates found. Add JSON files to <code>app/templates/</code>.
        </div>
      )}

      {Object.entries(groups).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 32 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: CATEGORY_COLORS[category] || "#94a3b8",
            textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12, paddingBottom: 6,
            borderBottom: `1px solid ${(CATEGORY_COLORS[category] || "#2a2d3e")}44`,
          }}>
            {category}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
            {items.map(t => (
              <div key={t.id} style={{
                background: "#181b2e", border: "1px solid #2a2d3e", borderRadius: 10,
                padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8,
                transition: "border-color .15s", cursor: "default",
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor = CATEGORY_COLORS[t.category] || "#7c3aed"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2d3e"}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontWeight: 600, color: "#e2e8f0", fontSize: 14 }}>{t.name}</div>
                  <span style={{
                    fontSize: 10, color: CATEGORY_COLORS[t.category] || "#475569",
                    background: (CATEGORY_COLORS[t.category] || "#475569") + "22",
                    borderRadius: 4, padding: "2px 7px", whiteSpace: "nowrap",
                  }}>{t.category}</span>
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{t.description}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(t.tags || []).map(tag => (
                      <span key={tag} style={{ fontSize: 10, color: "#64748b", background: "#0f1117", borderRadius: 3, padding: "1px 6px", border: "1px solid #2a2d3e" }}>{tag}</span>
                    ))}
                    <span style={{ fontSize: 10, color: "#4b5563" }}>
                      {t.node_count} node{t.node_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={importing === t.id}
                    onClick={() => useTemplate(t)}
                    style={{ minWidth: 80 }}>
                    {importing === t.id ? "Importing…" : "Use template"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

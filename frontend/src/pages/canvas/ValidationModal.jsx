/**
 * ValidationModal — shows flow-validation results (errors + warnings)
 * and lets the user either close or run anyway.
 */
export function ValidationModal({ issues, onClose, onRunAnyway }) {
  if (!issues) return null;
  const errors   = issues.filter(i => i.level === "error");
  const warnings = issues.filter(i => i.level === "warning");

  return (
    <div
      className="modal-overlay"
      aria-hidden="true"
      onClick={e => { if (e.target.className === "modal-overlay") onClose(); }}
    >
      <div
        className="modal"
        style={{ minWidth: 420 }}
        role="dialog"
        aria-modal="true"
        aria-label="Flow Validation"
      >
        <h2>
          {issues.length === 0
            ? "✅ Flow looks good"
            : errors.length
              ? "❌ Validation errors"
              : "⚠ Validation warnings"}
        </h2>

        {issues.length === 0 ? (
          <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 12 }}>
            No issues found. The flow is ready to run.
          </p>
        ) : (
          <div style={{ marginBottom: 12 }}>
            {issues.map((iss, i) => (
              <div
                key={i}
                style={{
                  display: "flex", gap: 8, alignItems: "flex-start",
                  padding: "6px 0", borderBottom: "1px solid #2a2d3e", fontSize: 12,
                }}
              >
                <span style={{ color: iss.level === "error" ? "#f87171" : "#fbbf24", flexShrink: 0 }}>
                  {iss.level === "error" ? "✗" : "⚠"}
                </span>
                <span style={{ color: "#cbd5e1" }}>{iss.msg}</span>
              </div>
            ))}
          </div>
        )}

        <div className="modal-btns">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {issues.length === 0
            ? <button className="btn btn-success" onClick={onRunAnyway}>▶ Run now</button>
            : errors.length === 0 && (
                <button className="btn btn-ghost" onClick={onRunAnyway}>Run anyway</button>
              )
          }
        </div>
      </div>
    </div>
  );
}

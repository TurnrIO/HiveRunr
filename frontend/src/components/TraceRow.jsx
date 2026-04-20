import { useState } from "react";

/**
 * TraceRow — expandable table row for a single node trace entry.
 *
 * Props:
 *   t      {object}   — trace object { node_id, label, type, status, duration_ms,
 *                        attempts, input, output, error }
 *   fmtDur {function} — formats duration_ms to a human-readable string
 *   dot    {object}   — maps status strings to CSS colour values
 */
export function TraceRow({ t, fmtDur, dot }) {
  const [open, setOpen] = useState(false);
  const hasDetail = t.input || t.output || t.error;

  return (
    <>
      <tr
        className="expandable-row"
        onClick={() => hasDetail && setOpen((o) => !o)}
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <td>
          <span
            className="trace-status-dot"
            style={{ background: dot[t.status] || "#64748b" }}
          />
        </td>
        <td style={{ color: "#e2e8f0", fontWeight: 500 }}>
          {t.label || t.node_id}
        </td>
        <td style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8" }}>
          {t.type}
        </td>
        <td style={{ color: "#94a3b8" }}>{fmtDur(t.duration_ms)}</td>
        <td style={{ color: "#94a3b8", textAlign: "center" }}>
          {t.attempts || 1}
        </td>
        <td style={{ color: t.status === "error" ? "#f87171" : "#64748b", fontSize: 11 }}>
          {t.status === "error"
            ? t.error
            : hasDetail
            ? open
              ? "▲ hide"
              : "▼ show"
            : "—"}
        </td>
      </tr>

      {open && hasDetail && (
        <tr>
          <td colSpan={6} style={{ padding: "0 10px 10px" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              {t.input && (
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#64748b",
                      marginBottom: 4,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                    }}
                  >
                    Input
                  </div>
                  <pre
                    style={{
                      background: "#0a0c14",
                      border: "1px solid #2a2d3e",
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 11,
                      color: "#94a3b8",
                      whiteSpace: "pre-wrap",
                      maxHeight: 200,
                      overflow: "auto",
                      margin: 0,
                    }}
                  >
                    {typeof t.input === "string"
                      ? t.input
                      : JSON.stringify(t.input, null, 2)}
                  </pre>
                </div>
              )}

              {(t.output || t.error) && (
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#64748b",
                      marginBottom: 4,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                    }}
                  >
                    {t.error ? "Error" : "Output"}
                  </div>
                  <pre
                    style={{
                      background: "#0a0c14",
                      border: `1px solid ${t.error ? "#7f1d1d" : "#2a2d3e"}`,
                      borderRadius: 6,
                      padding: "8px 10px",
                      fontSize: 11,
                      color: t.error ? "#f87171" : "#94a3b8",
                      whiteSpace: "pre-wrap",
                      maxHeight: 200,
                      overflow: "auto",
                      margin: 0,
                    }}
                  >
                    {t.error ||
                      (typeof t.output === "string"
                        ? t.output
                        : JSON.stringify(t.output, null, 2))}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

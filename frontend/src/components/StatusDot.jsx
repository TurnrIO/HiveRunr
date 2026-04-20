/**
 * StatusDot — coloured dot + label for system-check status values.
 *
 * Props:
 *   status {string} — "ok" | "warning" | "error" | "loading"
 */
export function StatusDot({ status }) {
  const colors = {
    ok: "#4ade80",
    warning: "#f59e0b",
    error: "#f87171",
    loading: "#64748b",
  };
  const labels = {
    ok: "OK",
    warning: "Warning",
    error: "Error",
    loading: "…",
  };

  const color = colors[status] || colors.loading;
  const label = labels[status] || status;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow:
            status === "ok"
              ? `0 0 5px ${colors.ok}80`
              : status === "error"
              ? `0 0 5px ${colors.error}80`
              : "none",
          flexShrink: 0,
        }}
      />
      <span style={{ color, fontWeight: 600 }}>{label}</span>
    </span>
  );
}

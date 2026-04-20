/**
 * ViewerBanner — shown at the top of pages when the user has the Viewer role.
 * Reminds them that the page is read-only and suggests contacting an admin.
 */
export function ViewerBanner() {
  return (
    <div
      style={{
        background: "#64748b14",
        border: "1px solid #64748b33",
        borderRadius: 8,
        padding: "8px 14px",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: "#94a3b8",
      }}
    >
      <span>👁</span>
      <span>
        <strong style={{ color: "#e2e8f0" }}>View-only mode.</strong> Your
        account has the Viewer role — you can browse but not make changes.
        Contact an admin to request elevated access.
      </span>
    </div>
  );
}

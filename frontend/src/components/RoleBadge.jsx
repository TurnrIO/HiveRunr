/**
 * Role metadata used by RoleBadge and the Users page.
 * Exported so downstream components can reference descriptions / colours.
 */
export const ROLE_META = {
  owner: {
    label: "Owner",
    color: "#f59e0b",
    bg: "#f59e0b14",
    desc:
      "Full access to everything, including user management and danger-zone actions. " +
      "Only one owner account exists.",
  },
  admin: {
    label: "Admin",
    color: "#a78bfa",
    bg: "#7c3aed14",
    desc:
      "Full access to flows, schedules, credentials, scripts, and settings. " +
      "Can manage viewer accounts.",
  },
  viewer: {
    label: "Viewer",
    color: "#64748b",
    bg: "#64748b14",
    desc:
      "Read-only access. Can view flows, runs, metrics, and logs but cannot " +
      "create, edit, delete, or trigger anything.",
  },
};

/**
 * RoleBadge — small coloured pill showing a user's role.
 *
 * Props:
 *   role {string} — "owner" | "admin" | "viewer"
 */
export function RoleBadge({ role }) {
  const m = ROLE_META[role] || ROLE_META.viewer;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        borderRadius: 4,
        padding: "2px 7px",
        background: m.bg,
        color: m.color,
        textTransform: "uppercase",
        letterSpacing: ".05em",
      }}
    >
      {m.label}
    </span>
  );
}

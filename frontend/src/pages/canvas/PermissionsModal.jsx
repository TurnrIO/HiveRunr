import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client.js";
import { useFocusTrap } from "../../components/useFocusTrap.js";

const ROLES     = ["viewer", "runner", "editor"];
const ROLE_DESC = { viewer: "View-only", runner: "Can trigger runs", editor: "Can edit flow" };

/**
 * PermissionsModal — manage per-flow user access and invite by email.
 */
export function PermissionsModal({ isOpen, onClose, graphId, showToast }) {
  const [perms,       setPerms]       = useState([]);
  const [users,       setUsers]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [selUser,     setSelUser]     = useState("");
  const [selRole,     setSelRole]     = useState("viewer");
  const [invEmail,    setInvEmail]    = useState("");
  const [invRole,     setInvRole]     = useState("viewer");
  const [inviting,    setInviting]    = useState(false);
  const [inviteLink,  setInviteLink]  = useState(null);
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, onClose);

  async function load() {
    if (!graphId) return;
    setLoading(true);
    try {
      const data = await api("GET", `/api/graphs/${graphId}/permissions`);
      setPerms(data.permissions || []);
      setUsers(data.users || []);
    } catch (e) {
      setPerms([]);
      setUsers([]);
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      load();
      setInviteLink(null);
      setInvEmail("");
    }
  }, [isOpen, graphId, showToast]);

  async function grantPermission() {
    if (!selUser) return;
    setSaving(true);
    try {
      await api("PUT", `/api/graphs/${graphId}/permissions`, { user_id: parseInt(selUser), role: selRole });
      showToast("Permission set ✓");
      setSelUser("");
      await load();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function removePermission(userId) {
    try {
      await api("DELETE", `/api/graphs/${graphId}/permissions/${userId}`);
      showToast("Access removed");
      await load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function changeRole(userId, role) {
    try {
      await api("PUT", `/api/graphs/${graphId}/permissions`, { user_id: userId, role });
      await load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function sendInvite() {
    if (!invEmail.trim()) return;
    setInviting(true);
    setInviteLink(null);
    try {
      const res = await api("POST", `/api/graphs/${graphId}/invite`, { email: invEmail.trim(), role: invRole });
      if (res.email_sent) {
        showToast(`Invite sent to ${res.email} ✓`);
      } else {
        setInviteLink(res.invite_url);
        showToast("Email not configured — copy the link below", "error");
      }
      setInvEmail("");
      await load();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setInviting(false);
    }
  }

  if (!isOpen) return null;

  const permUserIds = new Set(perms.map(p => p.user_id));
  const availUsers  = users.filter(u => !permUserIds.has(u.id));

  const inputStyle = {
    background: "#1e2130", border: "1px solid #2d3148", borderRadius: 6,
    color: "#e2e8f0", fontSize: 13, padding: "6px 10px",
  };

  return (
    <div
      className="modal-overlay"
      aria-hidden="true"
      onClick={e => { if (e.target.className === "modal-overlay") onClose(); }}
    >
      <div
        className="modal"
        style={{ minWidth: 520, maxWidth: 600, maxHeight: "80vh", overflowY: "auto" }}
        role="dialog"
        aria-modal="true"
        aria-label="Flow Permissions"
        ref={dialogRef}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>🔐 Flow Permissions</h3>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="Close"
            onClick={onClose}
          >✕</button>
        </div>

        {loading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "#64748b" }}>Loading…</div>
        ) : (
          <>
            {/* Current permissions */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Current access
              </div>
              {perms.length === 0 ? (
                <div style={{ color: "#475569", fontSize: 13, padding: "8px 0" }}>
                  No users have been granted access yet.
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 500 }}>User</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "#64748b", fontWeight: 500 }}>Role</th>
                      <th style={{ padding: "4px 8px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {perms.map(p => (
                      <tr key={p.user_id} style={{ borderTop: "1px solid #1e2130" }}>
                        <td style={{ padding: "6px 8px", color: "#e2e8f0" }}>
                          {p.username}
                          <span style={{ color: "#475569", fontSize: 11, marginLeft: 6 }}>{p.email}</span>
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <select
                            value={p.role}
                            onChange={e => changeRole(p.user_id, e.target.value)}
                            style={{ ...inputStyle, fontSize: 12, padding: "2px 6px" }}
                          >
                            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <span style={{ fontSize: 10, color: "#64748b", marginLeft: 6 }}>{ROLE_DESC[p.role]}</span>
                        </td>
                        <td style={{ padding: "6px 8px", textAlign: "right" }}>
                          <button
                            onClick={() => removePermission(p.user_id)}
                            style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 13 }}
                          >✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Add existing user */}
            {availUsers.length > 0 && (
              <div style={{ borderTop: "1px solid #1e2130", paddingTop: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                  Add existing user
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={selUser}
                    onChange={e => setSelUser(e.target.value)}
                    style={{ ...inputStyle, flex: 1, minWidth: 120 }}
                  >
                    <option value="">Select user…</option>
                    {availUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                    ))}
                  </select>
                  <select
                    value={selRole}
                    onChange={e => setSelRole(e.target.value)}
                    style={inputStyle}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={grantPermission}
                    disabled={!selUser || saving}
                  >
                    {saving ? "Saving…" : "Grant"}
                  </button>
                </div>
              </div>
            )}

            {/* Invite by email */}
            <div style={{ borderTop: "1px solid #1e2130", paddingTop: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Invite by email
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={invEmail}
                  onChange={e => setInvEmail(e.target.value)}
                  placeholder="user@example.com"
                  onKeyDown={e => e.key === "Enter" && sendInvite()}
                  style={{ ...inputStyle, flex: 1, minWidth: 160 }}
                />
                <select
                  value={invRole}
                  onChange={e => setInvRole(e.target.value)}
                  style={inputStyle}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={sendInvite}
                  disabled={!invEmail.trim() || inviting}
                >
                  {inviting ? "Sending…" : "Send invite"}
                </button>
              </div>

              {inviteLink && (
                <div style={{
                  marginTop: 10, background: "#1e2130", border: "1px solid #2d3148",
                  borderRadius: 6, padding: "8px 12px", fontSize: 12,
                }}>
                  <div style={{ color: "#94a3b8", marginBottom: 4 }}>
                    Email not configured. Share this link manually:
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      readOnly
                      value={inviteLink}
                      style={{
                        flex: 1, background: "#0d0f1a", border: "1px solid #2d3148",
                        borderRadius: 4, color: "#a78bfa", fontSize: 11,
                        padding: "4px 8px", fontFamily: "monospace",
                      }}
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        navigator.clipboard.writeText(inviteLink)
                          .then(() => showToast("Copied!"))
                          .catch(() => showToast("Copy failed", "error"));
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid #1e2130", paddingTop: 10, fontSize: 11, color: "#374151" }}>
              <strong style={{ color: "#64748b" }}>viewer</strong> — read-only canvas access &nbsp;|&nbsp;
              <strong style={{ color: "#64748b" }}>runner</strong> — can trigger runs &nbsp;|&nbsp;
              <strong style={{ color: "#64748b" }}>editor</strong> — can modify the flow
            </div>
          </>
        )}
      </div>
    </div>
  );
}

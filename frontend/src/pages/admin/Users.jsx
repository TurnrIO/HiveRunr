import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { RoleBadge } from "../../components/RoleBadge.jsx";
import { useFocusTrap } from "../../components/useFocusTrap.js";

const ROLE_META = {
  owner:  { label: "Owner",  color: "#f59e0b", bg: "#f59e0b14", desc: "Full access to everything, including user management and danger-zone actions. Only one owner account exists." },
  admin:  { label: "Admin",  color: "#a78bfa", bg: "#7c3aed14", desc: "Full access to flows, schedules, credentials, scripts, and settings. Can manage viewer accounts." },
  viewer: { label: "Viewer", color: "#64748b", bg: "#64748b14", desc: "Read-only access. Can view flows, runs, metrics, and logs but cannot create, edit, delete, or trigger anything." },
};

function ResetPasswordModal({ username, newPw, setNewPw, resetting, onSubmit, onClose }) {
  const ref = useRef(null);
  useFocusTrap(ref, onClose);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="true"
    >
      <div
        className="card"
        ref={ref}
        style={{ width: 360, margin: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={`Reset password for ${username}`}
      >
        <div className="card-title">Reset password — {username}</div>
        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label>New Password</label>
            <input required type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="At least 8 characters" autoFocus />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={resetting || newPw.length < 8}>
              {resetting ? "Resetting…" : "Reset Password"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Users({ showToast }) {
  const { currentUser: user } = useAuth();
  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "admin" || isOwner;

  const [users,        setUsers]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [form,         setForm]         = useState({ username: "", email: "", password: "", role: "viewer" });
  const [creating,     setCreating]     = useState(false);
  const [resetModal,   setResetModal]   = useState(null);
  const [newPw,        setNewPw]        = useState("");
  const [resetting,    setResetting]    = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [loadError,    setLoadError]    = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      setUsers(await api("GET", "/api/users"));
    } catch (err) {
      setUsers([]);
      if (!silent) {
        setLoadError(err.message || "Failed to load users");
        showToast(err.message, "error");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setCreating(true);
    try {
      await api("POST", "/api/users", form);
      setForm({ username: "", email: "", password: "", role: "viewer" });
      await load({ silent: true });
      showToast("User created");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(id, role) {
    try {
      await api("PATCH", `/api/users/${id}/role`, { role });
      await load({ silent: true });
      showToast("Role updated");
    }
    catch (err) { showToast(err.message, "error"); }
  }

  async function deleteUser(id, username) {
    setConfirmState({
      message: `Delete user "${username}"? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        try {
          await api("DELETE", `/api/users/${id}`);
          await load({ silent: true });
          showToast("User deleted");
        }
        catch (err) { showToast(err.message, "error"); }
      }
    });
  }

  async function resetPassword(e) {
    e.preventDefault();
    setResetting(true);
    try {
      await api("POST", `/api/users/${resetModal.id}/reset-password`, { new_password: newPw });
      setResetModal(null); setNewPw(""); showToast("Password reset");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">Users &amp; Permissions</h1>

      {/* ── Role documentation ── */}
      <div className="card">
        <div className="card-title">Roles &amp; Permissions</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginBottom: 4 }}>
          {Object.entries(ROLE_META).map(([role, m]) => (
            <div key={role} style={{ background: m.bg, border: `1px solid ${m.color}33`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18 }}>{role === "owner" ? "👑" : role === "admin" ? "🛡" : "👁"}</span>
                <span style={{ fontWeight: 700, color: m.color, fontSize: 13 }}>{m.label}</span>
              </div>
              <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.55, margin: 0 }}>{m.desc}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: "#475569", marginTop: 10 }}>
          Roles are enforced on both the API and UI layers. The owner account cannot be deleted or demoted.
          Password resets for any user can be performed by the owner; admins can reset viewer passwords.
        </p>
      </div>

      {/* ── Create user ── */}
      {isAdmin && (
        <div className="card">
          <div className="card-title">Create User</div>
          <form onSubmit={create}>
            <div className="form-row">
              <div className="form-group">
                <label>Username</label>
                <input required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="jsmith" />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="j@example.com" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Password</label>
                <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="viewer">Viewer — read-only</option>
                  {isOwner && <option value="admin">Admin — full access</option>}
                </select>
              </div>
            </div>
            <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? "Creating…" : "+ Create User"}</button>
          </form>
        </div>
      )}

      {/* ── Users table ── */}
      <div className="card">
        <div className="card-title">All Users</div>
        {loading ? <div className="empty-state">Loading…</div> : loadError ? <div className="empty-state">{loadError}</div> : users.length === 0 ? <div className="empty-state">No users found.</div> : (
          <table>
            <thead>
              <tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th>{isAdmin && <th></th>}</tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isMe    = user?.id === u.id;
                const canEdit = isOwner || (isAdmin && u.role !== "owner" && u.role !== "admin");
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                          background: u.role === "owner" ? "#f59e0b22" : u.role === "admin" ? "#7c3aed22" : "#64748b22",
                          border: `1px solid ${u.role === "owner" ? "#f59e0b55" : u.role === "admin" ? "#7c3aed55" : "#64748b55"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700,
                          color: u.role === "owner" ? "#f59e0b" : u.role === "admin" ? "#a78bfa" : "#64748b",
                        }}>
                          {u.username[0].toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500 }}>{u.username}
                          {isMe && <span style={{ fontSize: 10, color: "#475569", marginLeft: 5 }}>(you)</span>}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{u.email}</td>
                    <td>
                      {(isOwner && u.role !== "owner") ? (
                        <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                          style={{ fontSize: 11, padding: "2px 6px", background: "#0d0f1a", border: "1px solid #2a2d3e", color: "#e2e8f0", borderRadius: 4 }}>
                          <option value="viewer">Viewer</option>
                          <option value="admin">Admin</option>
                        </select>
                      ) : <RoleBadge role={u.role} />}
                    </td>
                    <td style={{ fontSize: 12, color: "#64748b" }}>{new Date(u.created_at).toLocaleDateString()}</td>
                    {isAdmin && (
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          {canEdit && (
                            <button className="btn btn-ghost btn-sm" onClick={() => { setResetModal({ id: u.id, username: u.username }); setNewPw(""); }}>
                              🔑 Reset pw
                            </button>
                          )}
                          {canEdit && !isMe && (
                            <button className="btn btn-ghost btn-sm" style={{ color: "#f87171" }}
                              onClick={() => deleteUser(u.id, u.username)}>✕</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Reset password modal ── */}
      {resetModal && (
        <ResetPasswordModal
          username={resetModal.username}
          newPw={newPw}
          setNewPw={setNewPw}
          resetting={resetting}
          onSubmit={resetPassword}
          onClose={() => setResetModal(null)}
        />
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={() => { confirmState.fn(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

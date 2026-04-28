import { useState, useEffect } from "react";
import { api } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useWorkspace } from "../../contexts/WorkspaceContext.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

const WS_ROLE_COLORS = { owner: "#f59e0b", admin: "#a78bfa", viewer: "#64748b" };

export function Workspaces({ showToast }) {
  const { currentUser: user } = useAuth();
  const { activeWorkspace, refreshWorkspaces, switchWorkspace } = useWorkspace();
  const isOwner = user?.role === "owner";
  const isAdmin = isOwner || user?.role === "admin";

  const [ws,           setWs]           = useState(null);
  const [allWs,        setAllWs]        = useState([]);
  const [members,      setMembers]      = useState([]);
  const [allUsers,     setAllUsers]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [renaming,     setRenaming]     = useState(false);
  const [editingName,  setEditingName]  = useState(false);
  const [newName,      setNewName]      = useState("");
  const [addUserId,    setAddUserId]    = useState("");
  const [addRole,      setAddRole]      = useState("viewer");
  const [addBusy,      setAddBusy]      = useState(false);
  const [showCreate,   setShowCreate]   = useState(false);
  const [createName,   setCreateName]   = useState("");
  const [createBusy,   setCreateBusy]   = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const _isOwner = user?.role === "owner";
      const [myList, usersResp] = await Promise.all([
        api("GET", "/api/workspaces/my/list"),
        api("GET", "/api/users"),
      ]);
      const list = myList || [];
      setAllUsers(usersResp || []);
      if (_isOwner) setAllWs(list);
      const wsId = activeWorkspace?.id;
      const active = (wsId ? list.find(w => String(w.id) === String(wsId)) : null) || list[0];
      if (active) {
        setWs(active);
        setNewName(active.name);
        setEditingName(false);
        const mem = await api("GET", `/api/workspaces/${active.id}/members`);
        setMembers(mem || []);
      }
    } catch (e) { showToast(e.message, "error"); }
    setLoading(false);
  };

  useEffect(() => { if (user?.id) load(); }, [user?.id]);

  const rename = async (e) => {
    e.preventDefault();
    if (!ws || !newName.trim() || newName.trim() === ws.name) return;
    setRenaming(true);
    try {
      const updated = await api("PATCH", `/api/workspaces/${ws.id}`, { name: newName.trim() });
      setWs(updated);
      setNewName(updated.name);
      setEditingName(false);
      setAllWs(prev => prev.map(w => w.id === updated.id ? { ...w, name: updated.name } : w));
      showToast("Workspace renamed");
    } catch (e) { showToast(e.message, "error"); }
    setRenaming(false);
  };

  const addMember = async (e) => {
    e.preventDefault();
    if (!ws || !addUserId) return;
    setAddBusy(true);
    try {
      await api("PUT", `/api/workspaces/${ws.id}/members`, { user_id: parseInt(addUserId), role: addRole });
      const mem = await api("GET", `/api/workspaces/${ws.id}/members`);
      setMembers(mem || []);
      setAddUserId(""); setAddRole("viewer");
      showToast("Member added");
    } catch (e) { showToast(e.message, "error"); }
    setAddBusy(false);
  };

  const changeRole = async (userId, role) => {
    if (!ws) return;
    try {
      await api("PUT", `/api/workspaces/${ws.id}/members`, { user_id: userId, role });
      setMembers(m => m.map(x => x.user_id === userId ? { ...x, role } : x));
      showToast("Role updated");
    } catch (e) { showToast(e.message, "error"); }
  };

  const removeMember = (userId, username) => {
    setConfirmState({
      message: `Remove ${username} from this workspace?`,
      confirmLabel: "Remove",
      fn: async () => {
        try {
          await api("DELETE", `/api/workspaces/${ws.id}/members/${userId}`);
          setMembers(m => m.filter(x => x.user_id !== userId));
          showToast("Member removed");
        } catch (e) { showToast(e.message, "error"); }
      }
    });
  };

  const createWorkspace = async (e) => {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateBusy(true);
    try {
      await api("POST", "/api/workspaces", { name: createName.trim() });
      setCreateName(""); setShowCreate(false);
      await load();
      await refreshWorkspaces();
      showToast("Workspace created — switch to it using the sidebar or the table below");
    } catch (e) { showToast(e.message, "error"); }
    setCreateBusy(false);
  };

  const deleteWorkspace = (w) => {
    setConfirmState({
      message: `Delete workspace "${w.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        try {
          await api("DELETE", `/api/workspaces/${w.id}`);
          setAllWs(prev => prev.filter(x => x.id !== w.id));
          showToast("Workspace deleted");
        } catch (e) { showToast(e.message, "error"); }
      }
    });
  };

  const switchTo = async (w) => {
    try {
      const workspace = await switchWorkspace(w.id);
      showToast(`Switched to ${workspace.name}`);
    } catch (e) { showToast(e.message, "error"); }
  };

  const nonMemberUsers = allUsers.filter(u => !members.find(m => m.user_id === u.id));

  if (loading) return <div className="page"><div className="empty-state">Loading…</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">🏢 Workspaces</h1>

      {!ws && (
        <div className="card" style={{ borderColor: "#f59e0b44", background: "#f59e0b08" }}>
          <div style={{ color: "#f59e0b", fontSize: 13 }}>
            ⚠ No active workspace found. Switch to one using the table below, or create a new one.
          </div>
        </div>
      )}

      {/* ── Current workspace ── */}
      {ws && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div className="card-title" style={{ marginBottom: 2 }}>Current: {ws.name}</div>
              <div style={{ fontSize: 12, color: "#475569" }}>
                Slug: <code style={{ color: "#a78bfa" }}>{ws.slug}</code>
                &nbsp;·&nbsp; Plan: <span style={{ color: "#94a3b8", textTransform: "capitalize" }}>{ws.plan || "free"}</span>
              </div>
            </div>
            {isAdmin && !editingName && (
              <button className="btn btn-ghost" style={{ fontSize: 12 }}
                onClick={() => { setNewName(ws.name); setEditingName(true); }}>✏ Rename</button>
            )}
          </div>
          {editingName && (
            <form onSubmit={rename} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>New Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} required autoFocus />
              </div>
              <button type="submit" className="btn btn-primary"
                disabled={renaming || !newName.trim() || newName.trim() === ws.name}>
                {renaming ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditingName(false)}>Cancel</button>
            </form>
          )}
        </div>
      )}

      {/* ── Members ── */}
      {ws && (
        <div className="card">
          <div className="card-title">Members</div>
          <table>
            <thead><tr><th>User</th><th>Workspace Role</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {members.map(m => {
                const isMe      = user?.id === m.user_id;
                const isWsOwner = m.role === "owner";
                return (
                  <tr key={m.user_id}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                          background: (WS_ROLE_COLORS[m.role] || "#64748b") + "22",
                          border: `1px solid ${(WS_ROLE_COLORS[m.role] || "#64748b")}55`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, color: WS_ROLE_COLORS[m.role] || "#64748b",
                        }}>
                          {(m.username || "?")[0].toUpperCase()}
                        </div>
                        <span style={{ fontWeight: 500 }}>{m.username}
                          {isMe && <span style={{ fontSize: 10, color: "#475569", marginLeft: 5 }}>(you)</span>}
                        </span>
                      </div>
                    </td>
                    <td>
                      {isAdmin && !isWsOwner ? (
                        <select value={m.role} onChange={e => changeRole(m.user_id, e.target.value)}
                          style={{ background: "#1e2130", border: "1px solid #2d3148", borderRadius: 6, color: "#e2e8f0", fontSize: 12, padding: "3px 6px" }}>
                          <option value="viewer">viewer</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>
                      ) : (
                        <span style={{ fontSize: 12, color: WS_ROLE_COLORS[m.role] || "#64748b", fontWeight: 600, textTransform: "capitalize" }}>{m.role}</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td style={{ textAlign: "right" }}>
                        {!isWsOwner && !isMe && (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f87171" }}
                            onClick={() => removeMember(m.user_id, m.username)}>Remove</button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {isAdmin && nonMemberUsers.length > 0 && (
            <form onSubmit={addMember} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 16, borderTop: "1px solid #2a2d3e", paddingTop: 14 }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>Add Member</label>
                <select value={addUserId} onChange={e => setAddUserId(e.target.value)} required
                  style={{ width: "100%", background: "#1e2130", border: "1px solid #2d3148", borderRadius: 6, color: "#e2e8f0", fontSize: 13, padding: "6px 8px" }}>
                  <option value="">— select user —</option>
                  {nonMemberUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.username} ({u.email})</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ width: 130, marginBottom: 0 }}>
                <label>Role</label>
                <select value={addRole} onChange={e => setAddRole(e.target.value)}
                  style={{ width: "100%", background: "#1e2130", border: "1px solid #2d3148", borderRadius: 6, color: "#e2e8f0", fontSize: 13, padding: "6px 8px" }}>
                  <option value="viewer">viewer</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                </select>
              </div>
              <button type="submit" className="btn btn-primary" disabled={addBusy || !addUserId}>
                {addBusy ? "Adding…" : "+ Add"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ── All workspaces (owner only) ── */}
      {isOwner && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>All Workspaces</div>
            <button className="btn btn-primary" style={{ fontSize: 12 }}
              onClick={() => setShowCreate(s => !s)}>
              {showCreate ? "Cancel" : "+ New Workspace"}
            </button>
          </div>
          {showCreate && (
            <form onSubmit={createWorkspace} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid #2a2d3e" }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>Workspace Name</label>
                <input value={createName} onChange={e => setCreateName(e.target.value)}
                  required placeholder="e.g. Acme Corp" autoFocus />
              </div>
              <button type="submit" className="btn btn-primary" disabled={createBusy}>
                {createBusy ? "Creating…" : "Create"}
              </button>
            </form>
          )}
          {allWs.length === 0
            ? <div className="empty-state">No workspaces found.</div>
            : (
            <table>
              <thead><tr><th>Name</th><th>Slug</th><th>Plan</th><th>Members</th><th></th></tr></thead>
              <tbody>
                {allWs.map(w => {
                  const isCurrent = ws && w.id === ws.id;
                  return (
                    <tr key={w.id} style={isCurrent ? { background: "#1a1d2e" } : {}}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{w.name}</span>
                        {isCurrent && <span style={{ fontSize: 10, color: "#a78bfa", marginLeft: 6, background: "#7c3aed22", padding: "1px 6px", borderRadius: 4 }}>current</span>}
                      </td>
                      <td><code style={{ fontSize: 11, color: "#64748b" }}>{w.slug}</code></td>
                      <td style={{ fontSize: 12, color: "#94a3b8", textTransform: "capitalize" }}>{w.plan || "free"}</td>
                      <td style={{ fontSize: 12, color: "#94a3b8" }}>{w.member_count ?? "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        {!isCurrent && (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", marginRight: 4 }}
                            onClick={() => switchTo(w)}>Switch</button>
                        )}
                        {w.slug !== "default" && (
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#f87171" }}
                            onClick={() => deleteWorkspace(w)}>Delete</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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

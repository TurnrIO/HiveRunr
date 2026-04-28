import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { api } from "../api/client.js";

/**
 * WorkspaceContext — provides the current workspace state to the whole app.
 *
 * Consumed via `useWorkspace()`.
 *
 * Shape:
 *   workspaces      {Array}    — list of workspaces the user belongs to
 *   activeWorkspace {object|null} — the currently selected workspace
 *   setActiveWorkspace {function}
 *   switchWorkspace {function(id)} — POST /api/workspaces/{id}/switch + reload
 *   refreshWorkspaces {function}  — re-fetch the workspace list
 */

const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(null);

  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await api("GET", "/api/workspaces/my/list");
      setWorkspaces(list || []);
      // Resolve the active workspace from the cookie, then first in list
      const wid = _getWorkspaceIdFromCookie();
      const active = wid
        ? (list || []).find((w) => String(w.id) === String(wid))
        : null;
      setActiveWorkspace(active || (list && list[0]) || null);
    } catch (_) {
      // Silently ignore — user may not be authenticated yet
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  async function switchWorkspace(id) {
    const res = await api("POST", `/api/workspaces/${id}/switch`);
    setActiveWorkspace(res.workspace);
    return res.workspace;
  }

  return (
    <WorkspaceContext.Provider
      value={{ workspaces, activeWorkspace, setActiveWorkspace, switchWorkspace, refreshWorkspaces }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

/** Read the hr_workspace cookie (set by the server on workspace switch). */
function _getWorkspaceIdFromCookie() {
  const m = document.cookie.match(/(?:^|;\s*)hr_workspace=([^;]+)/);
  return m ? m[1] : null;
}

/** Hook — use inside any component wrapped by WorkspaceProvider. */
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WorkspaceProvider } from "../contexts/WorkspaceContext.jsx";
import { AuthProvider } from "../contexts/AuthContext.jsx";
import { Toast } from "../components/Toast.jsx";
import { AdminLayout } from "./AdminLayout.jsx";
import { useState, useCallback } from "react";

// ── Page stubs (replaced per F-sprint) ───────────────────────────────────
// F4 will replace: Dashboard, Metrics, Flows/Graphs, Logs
// F5 will replace: Credentials, Schedules
// F6 will replace: Settings, AuditLog, System, Users, Workspaces, Templates
import { Dashboard }    from "../pages/admin/Dashboard.jsx";
import { Metrics }      from "../pages/admin/Metrics.jsx";
import { Flows }        from "../pages/admin/Flows.jsx";
import { Templates }    from "../pages/admin/Templates.jsx";
import { Scripts }      from "../pages/admin/Scripts.jsx";
import { Credentials }  from "../pages/admin/Credentials.jsx";
import { Schedules }    from "../pages/admin/Schedules.jsx";
import { Logs }         from "../pages/admin/Logs.jsx";
import { Users }        from "../pages/admin/Users.jsx";
import { AuditLog }     from "../pages/admin/AuditLog.jsx";
import { Settings }     from "../pages/admin/Settings.jsx";
import { Workspaces }   from "../pages/admin/Workspaces.jsx";
import { System }       from "../pages/admin/System.jsx";

export function App() {
  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type, key: Date.now() });
  }, []);

  return (
    <AuthProvider>
      <WorkspaceProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AdminLayout showToast={showToast} />}>
              <Route index           element={<Dashboard   showToast={showToast} />} />
              <Route path="graphs"   element={<Flows       showToast={showToast} />} />
              <Route path="templates"element={<Templates   showToast={showToast} />} />
              <Route path="metrics"  element={<Metrics     showToast={showToast} />} />
              <Route path="scripts"  element={<Scripts     showToast={showToast} />} />
              <Route path="credentials" element={<Credentials showToast={showToast} />} />
              <Route path="schedules"element={<Schedules   showToast={showToast} />} />
              <Route path="logs"     element={<Logs        showToast={showToast} />} />
              <Route path="users"    element={<Users       showToast={showToast} />} />
              <Route path="audit"    element={<AuditLog    showToast={showToast} />} />
              <Route path="settings" element={<Settings    showToast={showToast} />} />
              <Route path="workspaces" element={<Workspaces showToast={showToast} />} />
              <Route path="system"   element={<System      showToast={showToast} />} />
            </Route>
          </Routes>
        </BrowserRouter>
        {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
      </WorkspaceProvider>
    </AuthProvider>
  );
}

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WorkspaceProvider } from "../contexts/WorkspaceContext.jsx";
import { AuthProvider } from "../contexts/AuthContext.jsx";
import { Toast } from "../components/Toast.jsx";
import { AdminLayout } from "./AdminLayout.jsx";
import { ErrorBoundary } from "../components/ErrorBoundary.jsx";
import { useState, useCallback } from "react";
import { useWorkspace } from "../contexts/WorkspaceContext.jsx";

/** Wrap a page element in a per-route ErrorBoundary. */
function page(label, element) {
  return <ErrorBoundary label={label}>{element}</ErrorBoundary>;
}

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
    /* Top-level boundary — catches auth/provider crashes */
    <ErrorBoundary label="App" fullPage>
      <AuthProvider>
        <WorkspaceProvider>
          <BrowserRouter>
            <AdminRoutes showToast={showToast} />
          </BrowserRouter>
          {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
        </WorkspaceProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

function AdminRoutes({ showToast }) {
  const { activeWorkspace } = useWorkspace();
  const workspaceKey = activeWorkspace?.id || "workspace:none";

  return (
    <Routes key={workspaceKey}>
      <Route element={<AdminLayout showToast={showToast} />}>
        <Route index             element={page("Dashboard",   <Dashboard   showToast={showToast} />)} />
        <Route path="graphs"     element={page("Canvas Flows",<Flows       showToast={showToast} />)} />
        <Route path="templates"  element={page("Templates",   <Templates   showToast={showToast} />)} />
        <Route path="metrics"    element={page("Metrics",     <Metrics     showToast={showToast} />)} />
        <Route path="scripts"    element={page("Scripts",     <Scripts     showToast={showToast} />)} />
        <Route path="credentials" element={page("Credentials",<Credentials showToast={showToast} />)} />
        <Route path="schedules"  element={page("Schedules",   <Schedules   showToast={showToast} />)} />
        <Route path="logs"       element={page("Logs",        <Logs        showToast={showToast} />)} />
        <Route path="users"      element={page("Users",       <Users       showToast={showToast} />)} />
        <Route path="audit"      element={page("Audit Log",   <AuditLog    showToast={showToast} />)} />
        <Route path="settings"   element={page("Settings",    <Settings    showToast={showToast} />)} />
        <Route path="workspaces" element={page("Workspaces",  <Workspaces  showToast={showToast} />)} />
        <Route path="system"     element={page("System",      <System      showToast={showToast} />)} />
      </Route>
    </Routes>
  );
}

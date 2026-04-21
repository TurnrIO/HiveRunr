import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useWorkspace } from "../contexts/WorkspaceContext.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useFocusTrap } from "../components/useFocusTrap.js";
import { Toast } from "../components/Toast.jsx";

// ── Navigation pages ─────────────────────────────────────────────────────
export const PAGES = [
  { id: "dashboard",   path: "/",            icon: "⬛", label: "Dashboard"    },
  { id: "graphs",      path: "/graphs",      icon: "🎨", label: "Canvas Flows" },
  { id: "templates",   path: "/templates",   icon: "📐", label: "Templates"    },
  { id: "metrics",     path: "/metrics",     icon: "📊", label: "Metrics"      },
  { id: "scripts",     path: "/scripts",     icon: "🐍", label: "Scripts"      },
  { id: "credentials", path: "/credentials", icon: "🔑", label: "Credentials"  },
  { id: "schedules",   path: "/schedules",   icon: "⏰", label: "Schedules"    },
  { id: "logs",        path: "/logs",        icon: "📋", label: "Logs"         },
  { id: "users",       path: "/users",       icon: "👥", label: "Users"        },
  { id: "audit",       path: "/audit",       icon: "🔍", label: "Audit Log"    },
  { id: "settings",    path: "/settings",    icon: "⚙",  label: "Settings"     },
  { id: "workspaces",  path: "/workspaces",  icon: "🏢", label: "Workspaces"   },
  { id: "system",      path: "/system",      icon: "🔧", label: "System"       },
];

// ── Keyboard shortcuts modal ──────────────────────────────────────────────
const ADMIN_SHORTCUTS = [
  { key: "?",      desc: "Toggle this cheatsheet" },
  { key: "Escape", desc: "Close sidebar / cheatsheet" },
];

function AdminShortcutsModal({ onClose }) {
  const ref = useRef(null);
  useFocusTrap(ref, onClose);
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="true">
      <div className="modal" style={{ maxWidth: 380, padding: "18px 20px" }} ref={ref}
        role="dialog" aria-modal="true" aria-label="Keyboard shortcuts"
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0" }}>⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 18px", alignItems: "center" }}>
          {ADMIN_SHORTCUTS.map(({ key, desc }) => (
            <Fragment key={key}>
              <kbd style={{ background: "#0f1117", border: "1px solid #374151", borderRadius: 5,
                padding: "3px 8px", fontSize: 11, color: "#a78bfa", fontFamily: "monospace",
                whiteSpace: "nowrap", boxShadow: "0 1px 0 #374151" }}>
                {key}
              </kbd>
              <span style={{ color: "#94a3b8", fontSize: 13 }}>{desc}</span>
            </Fragment>
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #2a2d3e",
          fontSize: 11, color: "#475569", textAlign: "center" }}>
          Press <kbd style={{ background: "#0f1117", border: "1px solid #374151", borderRadius: 4,
            padding: "1px 6px", fontSize: 10, color: "#a78bfa", fontFamily: "monospace" }}>?</kbd> anywhere to show this
        </div>
      </div>
    </div>
  );
}

// ── AdminLayout — sidebar + main content area ─────────────────────────────
export function AdminLayout({ showToast }) {
  const { currentUser, logout } = useAuth();
  const { workspaces, activeWorkspace, switchWorkspace } = useWorkspace();
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [versionInfo, setVersionInfo]     = useState(null);
  const [updateDismissed, setUpdateDismissed] = useState(() => {
    try { return localStorage.getItem("hr_update_dismissed") || ""; } catch { return ""; }
  });
  const navigate = useNavigate();

  // Fetch version info once
  useEffect(() => {
    fetch("/api/version", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then(v => { if (v) setVersionInfo(v); })
      .catch(() => {});
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
      if (e.key === "?") { setShowShortcuts(s => !s); }
      if (e.key === "Escape") { setShowShortcuts(false); setSidebarOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showUpdateBanner = versionInfo?.update_available && versionInfo.latest !== updateDismissed;

  return (
    <>
      {/* ── Update banner ───────────────────────────────────────────────── */}
      {showUpdateBanner && (
        <div className="update-banner" role="alert">
          <span>🆕</span>
          <span style={{ flex: 1 }}>
            HiveRunr <strong>v{versionInfo.latest}</strong> is available — you're on v{versionInfo.current}.{" "}
            <a href={versionInfo.release_url || "https://github.com/TurnrIO/HiveRunr/releases"}
              target="_blank" rel="noopener" style={{ color: "#fbbf24", fontWeight: 600 }}>
              View release notes ↗
            </a>
          </span>
          <button onClick={() => {
            const v = versionInfo.latest;
            try { localStorage.setItem("hr_update_dismissed", v); } catch {}
            setUpdateDismissed(v);
          }} aria-label="Dismiss update notification"
            style={{ background: "none", border: "none", color: "#fbbf24", cursor: "pointer",
              fontSize: 16, lineHeight: 1, padding: "0 4px", opacity: .7 }}
            onMouseEnter={e => e.currentTarget.style.opacity = "1"}
            onMouseLeave={e => e.currentTarget.style.opacity = ".7"}>✕</button>
        </div>
      )}

      {/* ── Hamburger (mobile) ──────────────────────────────────────────── */}
      <button className="hamburger" aria-label="Open navigation menu" aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(o => !o)}>☰</button>

      {/* ── Sidebar overlay ─────────────────────────────────────────────── */}
      <div className={`sidebar-overlay${sidebarOpen ? " sidebar-open" : ""}`}
        onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}
        role="navigation" aria-label="Main navigation">
        <div className="logo">⚡ HiveRunr</div>

        {/* Workspace selector */}
        {workspaces.length > 1 && (
          <div style={{ padding: "0 12px 12px", borderBottom: "1px solid #2a2d3e", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: .06, fontWeight: 600 }}>Workspace</div>
              {(currentUser?.role === "owner" || currentUser?.role === "admin") && (
                <button onClick={() => navigate("/workspaces")} title="Workspace settings"
                  style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}
                  onMouseEnter={e => e.currentTarget.style.color = "#a78bfa"}
                  onMouseLeave={e => e.currentTarget.style.color = "#4b5563"}>⚙</button>
              )}
            </div>
            <select value={activeWorkspace?.id || ""} onChange={e => switchWorkspace(parseInt(e.target.value))}
              style={{ width: "100%", background: "#1e2130", border: "1px solid #2d3148", borderRadius: 6,
                color: "#a78bfa", fontSize: 12, padding: "5px 8px", cursor: "pointer" }}>
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}

        {workspaces.length === 1 && activeWorkspace && (
          <div style={{ padding: "0 12px 10px", borderBottom: "1px solid #2a2d3e", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <div style={{ fontSize: 10, color: "#4b5563", textTransform: "uppercase", letterSpacing: .06, fontWeight: 600 }}>Workspace</div>
              {(currentUser?.role === "owner" || currentUser?.role === "admin") && (
                <button onClick={() => navigate("/workspaces")} title="Workspace settings"
                  style={{ background: "none", border: "none", color: "#4b5563", cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}
                  onMouseEnter={e => e.currentTarget.style.color = "#a78bfa"}
                  onMouseLeave={e => e.currentTarget.style.color = "#4b5563"}>⚙</button>
              )}
            </div>
            <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600 }}>🏢 {activeWorkspace.name}</div>
          </div>
        )}

        {/* Nav links — scrollable so footer stays pinned */}
        <div className="sidebar-nav">
          {PAGES.map(p => (
            <NavLink key={p.id} to={p.path} end={p.path === "/"}
              className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              onClick={() => setSidebarOpen(false)}
              role="menuitem">
              <span className="nav-icon" aria-hidden="true">{p.icon}</span>{p.label}
            </NavLink>
          ))}
        </div>

        {/* Footer — pinned at bottom */}
        <div className="sidebar-footer">
          <div className="footer-label" style={{ display: "flex", alignItems: "center", padding: "0 8px", marginBottom: 8 }}>
            Quick links
            {versionInfo && (
              showUpdateBanner
                ? <a href={versionInfo.release_url || "https://github.com/TurnrIO/HiveRunr/releases"}
                    target="_blank" rel="noopener" className="version-chip update-avail"
                    title={`v${versionInfo.latest} available`}>↑ v{versionInfo.latest}</a>
                : <span className="version-chip" title={`HiveRunr v${versionInfo.current}`}>v{versionInfo.current}</span>
            )}
          </div>
          <a className="ext-link" href="/canvas"><span className="el-icon">🎨</span>Node Canvas</a>
          <a className="ext-link" href="/flower/" target="_blank" rel="noopener"><span className="el-icon">🌸</span>Flower / Celery</a>
          <a className="ext-link" href="/docs" target="_blank" rel="noopener"><span className="el-icon">📖</span>API Docs</a>
          <a className="ext-link" href="/health" target="_blank" rel="noopener"><span className="el-icon">💚</span>Health check</a>
          <button className="ext-link" onClick={() => setShowShortcuts(true)}
            style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer" }}>
            <span className="el-icon">⌨️</span>Keyboard shortcuts
            <kbd style={{ marginLeft: "auto", background: "#1e2235", border: "1px solid #2a2d3e", borderRadius: 4,
              padding: "1px 5px", fontSize: 9, color: "#6366f1", fontFamily: "monospace" }}>?</kbd>
          </button>

          {currentUser && (
            <div style={{ marginTop: 12, borderTop: "1px solid #2a2d3e", paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", marginBottom: 2 }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#7c3aed22",
                  border: "1px solid #7c3aed55", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700, color: "#a78bfa", flexShrink: 0 }}>
                  {currentUser.username[0].toUpperCase()}
                </div>
                <div style={{ overflow: "hidden", flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.username}</div>
                  <div style={{ fontSize: 10, color: "#475569", textTransform: "capitalize" }}>{currentUser.role}</div>
                </div>
              </div>
              <button onClick={logout}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none",
                  color: "#64748b", fontSize: 12, cursor: "pointer", padding: "6px 8px", borderRadius: 6,
                  display: "flex", alignItems: "center", gap: 6, transition: "color .15s" }}
                onMouseEnter={e => e.currentTarget.style.color = "#f87171"}
                onMouseLeave={e => e.currentTarget.style.color = "#64748b"}>
                <span style={{ fontSize: 14 }}>⎋</span> Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="main">
        <Outlet context={{ showToast }} />
      </div>

      {showShortcuts && <AdminShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </>
  );
}

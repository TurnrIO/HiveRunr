import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useWorkspace } from "../contexts/WorkspaceContext.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useTheme } from "../contexts/ThemeContext.jsx";
import { useFocusTrap } from "../components/useFocusTrap.js";
import { Toast } from "../components/Toast.jsx";
import { CommandPalette } from "../components/CommandPalette.jsx";

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
  { key: "Ctrl+K", desc: "Open global search / command palette" },
  { key: "?",      desc: "Toggle this cheatsheet" },
  { key: "Escape", desc: "Close sidebar / cheatsheet / palette" },
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
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>⌨️ Keyboard Shortcuts</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 18px", alignItems: "center" }}>
          {ADMIN_SHORTCUTS.map(({ key, desc }) => (
            <Fragment key={key}>
              <kbd className="theme-kbd-inline">{key}</kbd>
              <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{desc}</span>
            </Fragment>
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--border)",
          fontSize: 11, color: "var(--text-muted-3)", textAlign: "center" }}>
          Press <kbd className="theme-kbd-inline small">?</kbd> anywhere to show this
        </div>
      </div>
    </div>
  );
}

// ── AdminLayout — sidebar + main content area ─────────────────────────────
export function AdminLayout({ showToast }) {
  const { currentUser, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { workspaces, activeWorkspace, switchWorkspace } = useWorkspace();
  const [sidebarOpen, setSidebarOpen]     = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette]     = useState(false);
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
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setShowPalette(s => !s); }
      if (e.key === "Escape") { setShowShortcuts(false); setSidebarOpen(false); setShowPalette(false); }
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
              target="_blank" rel="noopener">
              View release notes ↗
            </a>
          </span>
          <button onClick={() => {
            const v = versionInfo.latest;
            try { localStorage.setItem("hr_update_dismissed", v); } catch {}
            setUpdateDismissed(v);
          }} aria-label="Dismiss update notification">✕</button>
        </div>
      )}

      {/* ── Hamburger (mobile) ──────────────────────────────────────────── */}
      <button className="hamburger" aria-label="Open navigation menu" aria-expanded={sidebarOpen}
        onClick={() => setSidebarOpen(o => !o)}>☰</button>
      <button className="theme-fab" onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
        {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
      </button>

      {/* ── Sidebar overlay ─────────────────────────────────────────────── */}
      <div className={`sidebar-overlay${sidebarOpen ? " sidebar-open" : ""}`}
        onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}
        role="navigation" aria-label="Main navigation">
        <div className="logo">⚡ HiveRunr</div>

        {/* Workspace selector */}
        {workspaces.length > 1 && (
          <div className="sidebar-section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <div className="sidebar-section-label">Workspace</div>
              {(currentUser?.role === "owner" || currentUser?.role === "admin") && (
                <button className="sidebar-ghost-btn" onClick={() => navigate("/workspaces")}
                  title="Workspace settings">⚙</button>
              )}
            </div>
            <select value={activeWorkspace?.id || ""} onChange={async e => {
              const nextId = parseInt(e.target.value, 10);
              if (!nextId || nextId === activeWorkspace?.id) return;
              try {
                const workspace = await switchWorkspace(nextId);
                setSidebarOpen(false);
                showToast?.(`Switched to ${workspace.name}`);
              } catch (err) {
                showToast?.(err.message || "Workspace switch failed", "error");
              }
            }}
              className="workspace-select">
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}

        {workspaces.length === 1 && activeWorkspace && (
          <div className="sidebar-section compact">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <div className="sidebar-section-label">Workspace</div>
              {(currentUser?.role === "owner" || currentUser?.role === "admin") && (
                <button className="sidebar-ghost-btn" onClick={() => navigate("/workspaces")}
                  title="Workspace settings">⚙</button>
              )}
            </div>
            <div className="workspace-title">🏢 {activeWorkspace.name}</div>
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
          <button className="ext-link" onClick={() => setShowPalette(true)}
            style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer" }}>
            <span className="el-icon">🔍</span>Search
            <kbd className="theme-kbd">Ctrl+K</kbd>
          </button>
          <button className="ext-link" onClick={() => setShowShortcuts(true)}
            style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer" }}>
            <span className="el-icon">⌨️</span>Keyboard shortcuts
            <kbd className="theme-kbd">?</kbd>
          </button>
          <button className="ext-link" onClick={toggleTheme}
            style={{ background: "none", border: "none", width: "100%", textAlign: "left", cursor: "pointer" }}>
            <span className="el-icon">{theme === "dark" ? "🌙" : "☀️"}</span>
            {theme === "dark" ? "Dark theme" : "Light theme"}
            <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted-2)" }}>toggle</span>
          </button>

          {currentUser && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", marginBottom: 2 }}>
                <div className="profile-avatar">{currentUser.username[0].toUpperCase()}</div>
                <div style={{ overflow: "hidden", flex: 1 }}>
                  <div className="profile-name">{currentUser.username}</div>
                  <div className="profile-role">{currentUser.role}</div>
                </div>
              </div>
              <button onClick={logout} className="signout-btn">
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
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} navigate={navigate} />
    </>
  );
}

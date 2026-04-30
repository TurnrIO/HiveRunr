/**
 * AuthCard — shared dark-card layout used by all auth pages (login, signup, reset, invite).
 *
 * Renders a centred card on a dark background with the HiveRunr logo.
 *
 * Props:
 *   title    {string}      — heading inside the card
 *   subtitle {ReactNode}   — secondary text below the heading
 *   children {ReactNode}   — form / body content
 *   maxWidth {number}      — optional max-width override (default 400)
 */
import { useEffect } from "react";
import { applyTheme, getInitialTheme } from "../contexts/ThemeContext.jsx";

export function AuthCard({ title, subtitle, children, maxWidth = 400 }) {
  useEffect(() => {
    applyTheme(getInitialTheme());
  }, []);

  return (
    <>
      <style>{AUTH_CSS}</style>
      <div className="auth-outer">
        <div className="auth-card" style={{ maxWidth }}>
          <div className="auth-logo">
            <div className="auth-logo-icon">⚡</div>
            <div className="auth-logo-text">HiveRunr</div>
          </div>
          {title && <h1 className="auth-title">{title}</h1>}
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
        </div>
      </div>
    </>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const AUTH_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --auth-bg: #0d0f1a;
    --auth-text: #e2e8f0;
    --auth-muted: #64748b;
    --auth-soft: #475569;
    --auth-card: #13151f;
    --auth-card-border: #1e2130;
    --auth-input-bg: #0d0f1a;
    --auth-input-border: #2a2d3e;
    --auth-accent: #7c3aed;
    --auth-accent-2: #6d28d9;
    --auth-info: #1e2130;
    --auth-info-border: #2d3148;
    --auth-plan-bg: #7c3aed22;
    --auth-plan-border: #7c3aed44;
    --auth-role-bg: #312e81;
    --auth-shadow: 0 24px 64px rgba(0,0,0,.5);
  }
  :root[data-theme="light"] {
    --auth-bg: #f4f7fb;
    --auth-text: #111827;
    --auth-muted: #5b6475;
    --auth-soft: #7b8497;
    --auth-card: #ffffff;
    --auth-card-border: #dbe3ef;
    --auth-input-bg: #f8fafc;
    --auth-input-border: #cbd5e1;
    --auth-accent: #6d28d9;
    --auth-accent-2: #7c3aed;
    --auth-info: #f3f4f6;
    --auth-info-border: #d1d5db;
    --auth-plan-bg: #ede9fe;
    --auth-plan-border: #c4b5fd;
    --auth-role-bg: #e0e7ff;
    --auth-shadow: 0 18px 42px rgba(15,23,42,.12);
  }
  body {
    background: var(--auth-bg);
    color: var(--auth-text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 100vh;
  }
  .auth-outer {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 16px;
  }
  .auth-card {
    background: var(--auth-card);
    border: 1px solid var(--auth-card-border);
    border-radius: 16px;
    padding: 40px 36px;
    width: 100%;
    box-shadow: var(--auth-shadow);
  }
  .auth-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 32px;
    justify-content: center;
  }
  .auth-logo-icon {
    width: 38px;
    height: 38px;
    background: linear-gradient(135deg,#7c3aed,#a855f7);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }
  .auth-logo-text {
    font-size: 22px;
    font-weight: 700;
    color: var(--auth-text);
    letter-spacing: -.5px;
  }
  .auth-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--auth-text);
    margin-bottom: 4px;
    text-align: center;
  }
  .auth-subtitle {
    font-size: 13px;
    color: var(--auth-muted);
    text-align: center;
    margin-bottom: 28px;
  }
  .auth-field { margin-bottom: 18px; }
  .auth-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--auth-muted);
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .auth-input {
    width: 100%;
    padding: 10px 13px;
    background: var(--auth-input-bg);
    border: 1px solid var(--auth-input-border);
    border-radius: 8px;
    color: var(--auth-text);
    font-size: 14px;
    outline: none;
    transition: border-color .15s;
  }
  .auth-input:focus { border-color: var(--auth-accent); }
  .auth-input[readonly] { opacity: .6; }
  .auth-hint { font-size: 11px; color: var(--auth-soft); margin-top: 4px; }
  .auth-btn {
    width: 100%;
    padding: 11px;
    background: linear-gradient(135deg,var(--auth-accent),var(--auth-accent-2));
    border: none;
    border-radius: 8px;
    color: #fff;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity .15s;
    margin-top: 8px;
  }
  .auth-btn:hover { opacity: .88; }
  .auth-btn:disabled { opacity: .5; cursor: not-allowed; }
  .auth-msg {
    border-radius: 8px;
    padding: 10px 13px;
    font-size: 13px;
    margin-bottom: 18px;
  }
  .auth-msg-error {
    background: #f871711a;
    border: 1px solid #f8717140;
    color: #fca5a5;
  }
  .auth-msg-success {
    background: #22c55e1a;
    border: 1px solid #22c55e40;
    color: #86efac;
  }
  .auth-link {
    display: block;
    text-align: center;
    font-size: 13px;
    color: var(--auth-muted);
    text-decoration: none;
    margin-top: 16px;
    cursor: pointer;
  }
  .auth-link:hover { color: var(--auth-accent); }
  .auth-link a { color: var(--auth-accent); text-decoration: none; }
  .auth-link a:hover { text-decoration: underline; }
  .auth-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: auth-spin .6s linear infinite;
    vertical-align: middle;
    margin-right: 6px;
  }
  @keyframes auth-spin { to { transform: rotate(360deg); } }
  .auth-forgot-link {
    display: block;
    text-align: right;
    font-size: 12px;
    color: var(--auth-muted);
    text-decoration: none;
    margin-top: -10px;
    margin-bottom: 14px;
    cursor: pointer;
  }
  .auth-forgot-link:hover { color: var(--auth-accent); }
  .auth-info-box {
    background: var(--auth-info);
    border: 1px solid var(--auth-info-border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 13px;
    color: var(--auth-muted);
  }
  .auth-info-box strong { color: var(--auth-text); }
  .auth-plan-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
    background: var(--auth-plan-bg);
    color: var(--auth-accent);
    border: 1px solid var(--auth-plan-border);
    margin-left: 6px;
    vertical-align: middle;
  }
  .auth-role-badge {
    display: inline-block;
    background: var(--auth-role-bg);
    color: var(--auth-accent);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    margin-left: 6px;
  }
  @media (max-width: 560px) {
    .auth-card { padding: 28px 20px; border-radius: 14px; }
    .auth-logo { margin-bottom: 24px; }
    .auth-title { font-size: 17px; }
  }
`;

import { useState, useRef } from "react";
import { useFocusTrap } from "../../components/useFocusTrap.js";

export const OAUTH_PROVIDER_META = {
  github: {
    icon: "🐙",
    label: "GitHub",
    hint: "Grants access to repositories (scope: repo, read:user). Use in action.github nodes.",
    defaultName: "github",
  },
  google: {
    icon: "📊",
    label: "Google Sheets / Drive",
    hint: "Grants Sheets + Drive file access. Use in action.google_sheets nodes.",
    defaultName: "google-sheets",
  },
  notion: {
    icon: "📝",
    label: "Notion",
    hint: "Grants workspace access. Use in action.notion nodes.",
    defaultName: "notion",
  },
};

export function OAuthConnectModal({ provider, onClose }) {
  const meta = OAUTH_PROVIDER_META[provider] || {};
  const [name, setName] = useState(meta.defaultName || provider);
  const ref = useRef(null);
  useFocusTrap(ref, onClose);

  function connect() {
    if (!name.trim()) return;
    window.location.href = `/api/oauth/${provider}/start?cred_name=${encodeURIComponent(name.trim())}`;
  }

  return (
    <div className="modal-overlay" aria-hidden="true"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 440 }}
        role="dialog" aria-modal="true" aria-label={`Connect ${meta.label}`} ref={ref}>
        <h2 style={{ marginBottom: 12 }}>{meta.icon} Connect {meta.label}</h2>
        <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>{meta.hint}</div>
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label>Credential Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") connect(); }}
            placeholder={meta.defaultName}
          />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Letters, numbers, hyphens, underscores only.</div>
        </div>
        <div style={{ fontSize: 11, color: "#475569", background: "#0f1117", border: "1px solid #1e2130", borderRadius: 6, padding: "8px 12px", marginBottom: 16 }}>
          You'll be redirected to {meta.label} to authorise HiveRunr. After approving, the token is saved as credential{" "}
          <strong style={{ color: "#a78bfa" }}>"{name}"</strong> in your workspace.
        </div>
        <div className="modal-btns">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={connect} disabled={!name.trim()}>Authorise →</button>
        </div>
      </div>
    </div>
  );
}

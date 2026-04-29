import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { AuthCard } from "../../components/AuthCard.jsx";

function Reset() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [done, setDone]       = useState(false);
  const [busy, setBusy]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess(""); setBusy(true);
    const fd = new FormData(e.target);
    const pw1 = fd.get("pw1");
    const pw2 = fd.get("pw2");
    if (pw1 !== pw2) { setError("Passwords do not match"); setBusy(false); return; }
    if (pw1.length < 8) { setError("Password must be at least 8 characters"); setBusy(false); return; }
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pw1 }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess("Password updated! Redirecting to login…");
        setDone(true);
        setTimeout(() => { window.location.href = "/login"; }, 2000);
      } else {
        setError(data.detail || "Invalid or expired reset link.");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Set new password"
      subtitle={token ? "Enter your new password below." : "Missing or invalid reset link."}
    >
      {error   && <div className="auth-msg auth-msg-error">{error}</div>}
      {success && <div className="auth-msg auth-msg-success">{success}</div>}

      {token && !done && (
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label">New password</label>
            <input className="auth-input" name="pw1" type="password"
              autoComplete="new-password" required autoFocus placeholder="At least 8 characters"/>
          </div>
          <div className="auth-field">
            <label className="auth-label">Confirm password</label>
            <input className="auth-input" name="pw2" type="password"
              autoComplete="new-password" required placeholder="Same password again"/>
          </div>
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? <><span className="auth-spinner"/>Saving…</> : "Set password"}
          </button>
        </form>
      )}
      <a className="auth-link" href="/login">← Back to login</a>
    </AuthCard>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Reset /></React.StrictMode>
);

import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { AuthCard } from "../../components/AuthCard.jsx";

function Login() {
  const [view, setView]       = useState("login");
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy]       = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError(""); setSuccess(""); setBusy(true);
    const fd = new FormData(e.target);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fd.get("username").trim(),
          password: fd.get("password"),
        }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/";
        window.location.href = next;
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Invalid username or password");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError(""); setSuccess(""); setBusy(true);
    const fd = new FormData(e.target);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fd.get("email").trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess(data.message || "If that email matches the owner account, a reset link has been sent.");
      } else {
        setError(data.detail || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={view === "login" ? "Welcome back" : "Forgot password"}
      subtitle={view === "login" ? "Sign in to your account" : null}
    >
      {error   && <div className="auth-msg auth-msg-error">{error}</div>}
      {success && <div className="auth-msg auth-msg-success">{success}</div>}

      {view === "login" ? (
        <form onSubmit={handleLogin}>
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input className="auth-input" name="username" type="text"
              autoComplete="username" autoFocus required placeholder="your-username"/>
          </div>
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input className="auth-input" name="password" type="password"
              autoComplete="current-password" required placeholder="••••••••"/>
          </div>
          <a className="auth-forgot-link" href="#"
            onClick={e => { e.preventDefault(); setError(""); setSuccess(""); setView("forgot"); }}>
            Forgot password?
          </a>
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? <><span className="auth-spinner"/>Signing in…</> : "Sign in"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleForgot}>
          <p style={{fontSize:13,color:"#64748b",marginBottom:18}}>
            Enter the owner account email address and we'll send a reset link.
          </p>
          <div className="auth-field">
            <label className="auth-label">Owner email</label>
            <input className="auth-input" name="email" type="email"
              autoComplete="email" required autoFocus placeholder="owner@example.com"/>
          </div>
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? <><span className="auth-spinner"/>Sending…</> : "Send reset link"}
          </button>
          <a className="auth-link" href="#"
            onClick={e => { e.preventDefault(); setError(""); setSuccess(""); setView("login"); }}>
            ← Back to login
          </a>
        </form>
      )}
    </AuthCard>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Login /></React.StrictMode>
);

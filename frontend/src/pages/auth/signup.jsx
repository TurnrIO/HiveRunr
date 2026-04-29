import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { AuthCard } from "../../components/AuthCard.jsx";

function Signup() {
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy]       = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setSuccess(""); setBusy(true);
    const fd = new FormData(e.target);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username:       fd.get("username").trim(),
          email:          fd.get("email").trim(),
          password:       fd.get("password"),
          workspace_name: fd.get("workspace").trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess("Account created! Redirecting…");
        setTimeout(() => { window.location.href = "/"; }, 800);
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
      title="Create your account"
      subtitle={<>Start automating in minutes <span className="auth-plan-badge">Free</span></>}
      maxWidth={420}
    >
      {error   && <div className="auth-msg auth-msg-error">{error}</div>}
      {success && <div className="auth-msg auth-msg-success">{success}</div>}

      <form onSubmit={handleSubmit}>
        <div className="auth-field">
          <label className="auth-label">Username</label>
          <input className="auth-input" name="username" type="text"
            autoComplete="username" autoFocus required placeholder="your-username"/>
          <p className="auth-hint">Lowercase letters, numbers, and hyphens only</p>
        </div>
        <div className="auth-field">
          <label className="auth-label">Email</label>
          <input className="auth-input" name="email" type="email"
            autoComplete="email" required placeholder="you@example.com"/>
        </div>
        <div className="auth-field">
          <label className="auth-label">Password</label>
          <input className="auth-input" name="password" type="password"
            autoComplete="new-password" required placeholder="Min. 8 characters"/>
        </div>
        <div className="auth-field">
          <label className="auth-label">
            Workspace name{" "}
            <span style={{color:"#475569",fontWeight:400,textTransform:"none"}}>(optional)</span>
          </label>
          <input className="auth-input" name="workspace" type="text" placeholder="My Company"/>
          <p className="auth-hint">Defaults to your username if left blank</p>
        </div>
        <button className="auth-btn" type="submit" disabled={busy}>
          {busy ? <><span className="auth-spinner"/>Creating account…</> : "Create free account"}
        </button>
      </form>

      <p className="auth-link">Already have an account? <a href="/login">Sign in</a></p>
    </AuthCard>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Signup /></React.StrictMode>
);

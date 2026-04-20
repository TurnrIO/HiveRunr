import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { AuthCard } from "../../components/AuthCard.jsx";

function Invite() {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [title, setTitle]       = useState("You've been invited");
  const [subtitle, setSubtitle] = useState("Loading invitation…");
  const [error, setError]       = useState("");
  const [view, setView]         = useState("loading");
  const [inviteData, setInviteData] = useState(null);
  const [accepted, setAccepted] = useState({ role: "" });
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    if (!token) { setError("No invite token found in URL."); setView("error"); return; }
    fetch(`/api/invite/accept?token=${encodeURIComponent(token)}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setError(d.detail || "Invalid or expired invite link."); setView("error"); return; }
        if (d.logged_in) {
          setTitle("Invitation accepted!");
          setSubtitle(`You now have ${d.role} access to "${d.graph_name}".`);
          setAccepted({ role: d.role });
          setView("accepted");
          setTimeout(() => { window.location.href = "/canvas"; }, 2000);
          return;
        }
        if (d.needs_signup) {
          setTitle("Create your account");
          setSubtitle(null);
          setInviteData({ email: d.email, token: d.token, role: d.role, graph_name: d.graph_name });
          setView("signup");
        }
      })
      .catch(e => { setError("Failed to validate invite: " + e.message); setView("error"); });
  }, [token]);

  async function handleSignup(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    const fd = new FormData(e.target);
    try {
      const res = await fetch("/api/invite/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token:    inviteData.token,
          username: fd.get("username").trim(),
          password: fd.get("password"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.detail || "Signup failed."); setBusy(false); return; }
      setTitle("Welcome aboard!");
      setSubtitle(`Account created. You now have ${data.role} access.`);
      setAccepted({ role: data.role });
      setView("accepted");
      setTimeout(() => { window.location.href = "/canvas"; }, 1500);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  const subtitleNode = view === "signup" && inviteData ? (
    <>You've been invited to <strong style={{color:"#e2e8f0"}}>{inviteData.graph_name}</strong> as{" "}
    <span className="auth-role-badge">{inviteData.role}</span></>
  ) : subtitle;

  return (
    <AuthCard title={title} subtitle={subtitleNode}>
      {error && <div className="auth-msg auth-msg-error">{error}</div>}

      {view === "signup" && inviteData && (
        <form onSubmit={handleSignup}>
          <div className="auth-field">
            <label className="auth-label">Email</label>
            <input className="auth-input" type="email" value={inviteData.email} readOnly/>
          </div>
          <div className="auth-field">
            <label className="auth-label">Username</label>
            <input className="auth-input" name="username" type="text"
              placeholder="Choose a username" required autoFocus autoComplete="username"/>
          </div>
          <div className="auth-field">
            <label className="auth-label">Password</label>
            <input className="auth-input" name="password" type="password"
              placeholder="At least 8 characters" required autoComplete="new-password"/>
          </div>
          <button className="auth-btn" type="submit" disabled={busy}>
            {busy ? <><span className="auth-spinner"/>Creating account…</> : "Create account & join"}
          </button>
        </form>
      )}

      {view === "accepted" && (
        <div style={{textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:16}}>✅</div>
          <p style={{color:"#64748b",fontSize:14,marginBottom:20}}>
            You now have {accepted.role} access.
          </p>
          <a href="/canvas" className="auth-btn"
            style={{display:"inline-block",textDecoration:"none",textAlign:"center"}}>
            Open canvas →
          </a>
        </div>
      )}
    </AuthCard>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Invite /></React.StrictMode>
);

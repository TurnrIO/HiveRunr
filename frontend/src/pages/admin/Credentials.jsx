import { Fragment, useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";
import { ViewerBanner } from "../../components/ViewerBanner.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { OAuthConnectModal, OAUTH_PROVIDER_META } from "./OAuthConnectModal.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

// ── Credential type schemas ───────────────────────────────────────────────────
const CRED_SCHEMAS = {
  generic:    { label: "Generic Secret",          fields: [{ k: "secret",          l: "Secret Value",             ph: "any secret value",                      secret: true }] },
  slack:      { label: "Slack Incoming Webhook",  fields: [{ k: "webhook_url",     l: "Webhook URL",              ph: "https://hooks.slack.com/services/T…",   secret: true }] },
  webhook:    { label: "Webhook URL",             fields: [{ k: "url",             l: "Webhook URL",              ph: "https://discord.com/api/webhooks/…",    secret: true }] },
  telegram:   { label: "Telegram Bot",            fields: [{ k: "secret",          l: "Bot Token",                ph: "123456:ABC…",                           secret: true },
                                                            { k: "chat_id",         l: "Default Chat ID",          ph: "-100123456789" }] },
  api_key:    { label: "API Key / Bearer Token",  fields: [{ k: "key",             l: "API Key / Token",          ph: "sk-… or eyJ…",                          secret: true },
                                                            { k: "header",          l: "Header name",              ph: "Authorization" }] },
  basic_auth: { label: "HTTP Basic Auth",         fields: [{ k: "username",        l: "Username",                 ph: "admin" },
                                                            { k: "password",        l: "Password",                 ph: "••••••••",                              secret: true }] },
  openai_api: { label: "OpenAI / LLM API Key",   fields: [{ k: "secret",          l: "API Key",                  ph: "sk-…",                                  secret: true },
                                                            { k: "base_url",        l: "Base URL (optional)",      ph: "https://api.openai.com/v1" }] },
  smtp:       { label: "SMTP Server",             fields: [{ k: "host",            l: "Host",                     ph: "smtp.agentmail.to" },
                                                            { k: "port",            l: "Port",                     ph: "587" },
                                                            { k: "user",            l: "Username",                 ph: "inbox@agentmail.to" },
                                                            { k: "pass",            l: "Password / API key",       ph: "your-api-key",                          secret: true }] },
  ssh:        { label: "SSH Server",              fields: [{ k: "host",            l: "Host / IP",                ph: "192.168.1.1" },
                                                            { k: "port",            l: "Port",                     ph: "22" },
                                                            { k: "username",        l: "Username",                 ph: "admin" },
                                                            { k: "password",        l: "Password",                 ph: "••••••••",                              secret: true },
                                                            { k: "key",             l: "Private Key (PEM, optional)", ph: "-----BEGIN RSA PRIVATE KEY-----…",  textarea: true }] },
  sftp:       { label: "SFTP / FTP Server",       fields: [{ k: "protocol",        l: "Protocol",                 ph: "sftp", select: ["sftp", "ftp"] },
                                                            { k: "host",            l: "Host / IP",                ph: "files.example.com" },
                                                            { k: "port",            l: "Port",                     ph: "22 (sftp) · 21 (ftp)" },
                                                            { k: "username",        l: "Username",                 ph: "ftpuser" },
                                                            { k: "password",        l: "Password",                 ph: "••••••••",                              secret: true }] },
  aws:        { label: "AWS Credentials",         fields: [{ k: "access_key_id",   l: "Access Key ID",            ph: "AKIAIOSFODNN7EXAMPLE" },
                                                            { k: "secret_access_key", l: "Secret Access Key",      ph: "wJalrXUt…",                             secret: true },
                                                            { k: "region",          l: "Default Region",           ph: "us-east-1" }] },
};

const typeColors = {
  openai_api: "openai_api",
  smtp:       "smtp",
  telegram:   "telegram",
  aws:        "aws",
  ssh:        "ssh",
  sftp:       "ftp",
  github_oauth: "github_oauth",
  google_oauth: "google_oauth",
  notion_oauth: "notion_oauth",
};

function blankSubFields(type) {
  const schema = CRED_SCHEMAS[type] || CRED_SCHEMAS.generic;
  return Object.fromEntries(schema.fields.map(f => [f.k, ""]));
}

function encodeSecret(type, subFields) {
  const schema = CRED_SCHEMAS[type] || CRED_SCHEMAS.generic;
  if (schema.fields.length === 1 && schema.fields[0].k === "secret") {
    return subFields.secret || "";
  }
  const obj = {};
  schema.fields.forEach(f => { if (subFields[f.k]) obj[f.k] = subFields[f.k]; });
  return JSON.stringify(obj);
}

function credFieldSummary(type) {
  const schema = CRED_SCHEMAS[type] || CRED_SCHEMAS.generic;
  if (schema.fields.length === 1) return null;
  return schema.fields.filter(f => !f.secret).map(f => f.l).join(" · ");
}

const USAGE_HINTS = {
  generic:    <>Use <code style={{ color: "#a78bfa" }}>{"{{creds.name}}"}</code> to inject the secret value anywhere in a node config.</>,
  slack:      <>In the Slack node set <strong>Webhook URL</strong> to <code style={{ color: "#a78bfa" }}>{"{{creds.name.webhook_url}}"}</code>.</>,
  webhook:    <>Use <code style={{ color: "#a78bfa" }}>{"{{creds.name.url}}"}</code> in any node field that accepts a URL.</>,
  telegram:   <>Use <code style={{ color: "#a78bfa" }}>{"{{creds.name}}"}</code> for the token, <code style={{ color: "#a78bfa" }}>{"{{creds.name.chat_id}}"}</code> for the chat ID in Telegram nodes.</>,
  api_key:    <>In HTTP Request headers use <code style={{ color: "#a78bfa" }}>{'{"Authorization":"Bearer {{creds.name.key}}"}'}</code>.</>,
  basic_auth: <>Reference <code style={{ color: "#a78bfa" }}>{"{{creds.name.username}}"}</code> and <code style={{ color: "#a78bfa" }}>{"{{creds.name.password}}"}</code> directly.</>,
  openai_api: <>Use <code style={{ color: "#a78bfa" }}>{"{{creds.name}}"}</code> as the API key in LLM Call nodes. Set <code style={{ color: "#a78bfa" }}>{"{{creds.name.base_url}}"}</code> for non-OpenAI providers.</>,
  smtp:       <>In Send Email nodes set <strong>SMTP Credential</strong> to <code style={{ color: "#a78bfa" }}>name</code>. Fields are filled automatically.</>,
  ssh:        <>In SSH nodes set <strong>SSH Credential</strong> to <code style={{ color: "#a78bfa" }}>name</code>. Fields are filled automatically.</>,
  sftp:       <>In SFTP nodes set <strong>SFTP Credential</strong> to <code style={{ color: "#a78bfa" }}>name</code>. Fields are filled automatically.</>,
  aws:        <>Reference fields: <code style={{ color: "#a78bfa" }}>{"{{creds.name.access_key_id}}"}</code>, <code style={{ color: "#a78bfa" }}>{"{{creds.name.secret_access_key}}"}</code>, <code style={{ color: "#a78bfa" }}>{"{{creds.name.region}}"}</code>.</>,
};

export function Credentials({ showToast }) {
  const { currentUser: user, encryptionOk } = useAuth();
  const [credentials, setCredentials]   = useState([]);
  const [form, setForm]                 = useState({ name: "", type: "generic", note: "", sub: blankSubFields("generic") });
  const [loading, setLoading]           = useState(true);
  const [confirmState, setConfirmState] = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editForm, setEditForm]         = useState({});
  const [oauthProviders, setOauthProviders] = useState({});
  const [oauthModal, setOauthModal]     = useState(null);
  const [testResults, setTestResults]   = useState({}); // {credId: {ok, message, latency_ms}}
  const [testing, setTesting]           = useState({}); // {credId: true}

  const load = useCallback(async ({ silent = false } = {}) => {
    setLoading(true);
    try {
      setCredentials(await api("GET", "/api/credentials"));
    } catch (e) {
      setCredentials([]);
      if (!silent) {
        showToast(e.message, "error");
      }
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    api("GET", "/api/oauth/providers").then(setOauthProviders).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const validateName = name => /^[a-zA-Z0-9_-]+$/.test(name);

  function changeType(t) {
    setForm(f => ({ ...f, type: t, sub: blankSubFields(t) }));
  }

  async function create(e) {
    e.preventDefault();
    if (!form.name.trim()) { showToast("Name required", "error"); return; }
    if (!validateName(form.name)) { showToast("Name may only contain letters, numbers, hyphens, underscores", "error"); return; }
    const secret = encodeSecret(form.type, form.sub);
    if (!secret.trim()) { showToast("At least one field is required", "error"); return; }
    try {
      await api("POST", "/api/credentials", { name: form.name, type: form.type, secret, note: form.note });
      setForm({ name: "", type: "generic", note: "", sub: blankSubFields("generic") });
      await load({ silent: true });
      showToast("Credential created");
    } catch (err) { showToast(err.message, "error"); }
  }

  async function del(id) {
    setConfirmState({
      message: "Delete this credential? This cannot be undone.",
      confirmLabel: "Delete",
      fn: async () => {
        try { await api("DELETE", `/api/credentials/${id}`); await load({ silent: true }); showToast("Deleted"); }
        catch (e) { showToast(e.message, "error"); }
      },
    });
  }

  function startEdit(c) {
    setEditingId(c.id);
    setEditForm({ type: c.type, secret: "", note: c.note || "" });
  }

  async function saveEdit(e) {
    e.preventDefault();
    try {
      await api("PUT", `/api/credentials/${editingId}`, editForm);
      setEditingId(null); setEditForm({});
      await load({ silent: true }); showToast("Credential updated");
    } catch (ex) { showToast(ex.message, "error"); }
  }

  async function testCredential(id) {
    setTesting(t => ({ ...t, [id]: true }));
    try {
      const res = await api("POST", `/api/credentials/${id}/test`);
      setTestResults(r => ({ ...r, [id]: res }));
    } catch (e) {
      setTestResults(r => ({ ...r, [id]: { ok: false, message: e.message } }));
    }
    setTesting(t => ({ ...t, [id]: false }));
  }

  const schema = CRED_SCHEMAS[form.type] || CRED_SCHEMAS.generic;
  const ro = user?.role === "viewer";

  return (
    <div>
      {encryptionOk === false && (
        <div style={{ background: "#1c1400", border: "1px solid #ca8a04", borderRadius: 8, padding: "10px 14px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fde047" }}>Credential encryption is not configured</div>
            <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 3 }}>
              Secrets are protected by a weak fallback key. Set <code style={{ background: "#2a2000", padding: "1px 5px", borderRadius: 3 }}>SECRET_KEY</code> in your <code style={{ background: "#2a2000", padding: "1px 5px", borderRadius: 3 }}>.env</code> file and restart the stack.
            </div>
          </div>
        </div>
      )}
      {encryptionOk === true && (
        <div style={{ background: "#0a1f14", border: "1px solid #16a34a", borderRadius: 8, padding: "8px 14px", marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>🔒</span>
          <span style={{ fontSize: 12, color: "#4ade80" }}>Credentials are encrypted at rest (AES-128-CBC via Fernet)</span>
        </div>
      )}

      <h1 className="page-title">Credentials</h1>
      {ro && <ViewerBanner />}

      <div className="info-box">
        🔑 Secrets are never exposed in flow exports or logs.&nbsp;
        {USAGE_HINTS[form.type] || USAGE_HINTS.generic}
      </div>

      {!ro && (
        <div className="card">
          <div className="card-title">New Credential</div>
          <form onSubmit={create}>
            <div className="form-row">
              <div className="form-group">
                <label>Name <span style={{ color: "#64748b", fontWeight: 400 }}>(unique · letters, numbers, hyphens, underscores)</span></label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="my-smtp-server" />
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={form.type} onChange={e => changeType(e.target.value)}>
                  <optgroup label="Generic">
                    <option value="generic">Generic Secret</option>
                  </optgroup>
                  <optgroup label="Messaging &amp; Notifications">
                    <option value="slack">Slack Incoming Webhook</option>
                    <option value="webhook">Webhook URL (Discord, Teams…)</option>
                    <option value="telegram">Telegram Bot</option>
                  </optgroup>
                  <optgroup label="HTTP / API Auth">
                    <option value="api_key">API Key / Bearer Token</option>
                    <option value="basic_auth">HTTP Basic Auth</option>
                    <option value="openai_api">OpenAI / LLM API Key</option>
                  </optgroup>
                  <optgroup label="Email">
                    <option value="smtp">SMTP Server</option>
                  </optgroup>
                  <optgroup label="Infrastructure">
                    <option value="ssh">SSH Server</option>
                    <option value="sftp">SFTP / FTP Server</option>
                    <option value="aws">AWS Credentials</option>
                  </optgroup>
                </select>
              </div>
            </div>

            <div style={{ background: "#0f1117", border: "1px solid #1e2130", borderRadius: 8, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{schema.label}</div>
              <div className="form-row" style={{ flexWrap: "wrap" }}>
                {schema.fields.map(f => (
                  <div key={f.k} className="form-group" style={{ minWidth: f.textarea || f.k === "key" ? "100%" : "180px", flex: f.textarea || f.k === "key" ? "1 1 100%" : "1 1 180px" }}>
                    <label>{f.l}</label>
                    {f.select ? (
                      <select value={form.sub[f.k] || f.select[0]} onChange={e => setForm({ ...form, sub: { ...form.sub, [f.k]: e.target.value } })}>
                        {f.select.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.textarea ? (
                      <textarea rows={3} value={form.sub[f.k] || ""} onChange={e => setForm({ ...form, sub: { ...form.sub, [f.k]: e.target.value } })} placeholder={f.ph} style={{ fontFamily: "monospace", fontSize: 12 }} />
                    ) : (
                      <input type={f.secret ? "password" : "text"} value={form.sub[f.k] || ""} onChange={e => setForm({ ...form, sub: { ...form.sub, [f.k]: e.target.value } })} placeholder={f.ph} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>Note <span style={{ color: "#64748b", fontWeight: 400 }}>(optional)</span></label>
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. Production server · rotates monthly" />
            </div>
            <button type="submit" className="btn btn-primary">+ Create</button>
          </form>
        </div>
      )}

      {!ro && Object.values(oauthProviders).some(Boolean) && (
        <div className="card">
          <div className="card-title">Connect via OAuth</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
            Authorise HiveRunr directly with these providers — no API key copy/paste needed. Tokens are saved automatically as a workspace credential.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {Object.entries(OAUTH_PROVIDER_META).map(([key, meta]) => {
              if (!oauthProviders[key]) return null;
              const alreadyConnected = credentials.some(c => c.type === `${key}_oauth`);
              return (
                <button key={key} className="oauth-provider-btn" onClick={() => setOauthModal(key)}>
                  <span className="oauth-provider-icon">{meta.icon}</span>
                  <span style={{ flex: 1, textAlign: "left" }}>{meta.label}</span>
                  {alreadyConnected && <span className="oauth-connected">✓ connected</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Your Credentials</div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : credentials.length === 0 ? (
          <div className="empty-state">No credentials yet. Create one above to get started.</div>
        ) : (
          <table className="mobile-cards">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Fields</th><th>Note</th><th>Created</th>{!ro && <th></th>}</tr>
            </thead>
            <tbody>
              {credentials.map(c => (
                <Fragment key={c.id}>
                  <tr key={c.id}>
                    <td data-label="Name">
                      <code className="badge-credential" style={{ background: "#0f1117", color: "#a78bfa" }}>{c.name}</code>
                    </td>
                    <td data-label="Type">
                      <span className={`badge-credential ${typeColors[c.type] || "generic"}`}>{c.type}</span>
                    </td>
                    <td data-label="Fields" style={{ color: "#475569", fontSize: 11 }}>
                      {credFieldSummary(c.type) || <span style={{ color: "#334155" }}>••••••••</span>}
                    </td>
                    <td data-label="Note" style={{ color: "#64748b", fontSize: 12 }}>{c.note || "—"}</td>
                    <td data-label="Created" style={{ color: "#64748b", fontSize: 12 }}>{new Date(c.created_at).toLocaleString()}</td>
                    {!ro && (
                      <td data-label="">
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <button className="btn btn-ghost" disabled={testing[c.id]} onClick={() => testCredential(c.id)}>
                            {testing[c.id] ? "…" : "🔌 Test"}
                          </button>
                          {testResults[c.id] && (
                            <span style={{
                              fontSize: 11, padding: "2px 8px", borderRadius: 12, fontWeight: 600,
                              background: testResults[c.id].ok ? "#0a1f14" : "#1f0a0a",
                              color: testResults[c.id].ok ? "#4ade80" : "#f87171",
                              border: `1px solid ${testResults[c.id].ok ? "#16a34a44" : "#dc262644"}`,
                            }}>
                              {testResults[c.id].ok ? "✓" : "✗"} {testResults[c.id].message}
                              {testResults[c.id].latency_ms != null && <span style={{ color: "#64748b", marginLeft: 4 }}>{testResults[c.id].latency_ms}ms</span>}
                            </span>
                          )}
                          <button className="btn btn-ghost" onClick={() => startEdit(c)}>✏️ Edit</button>
                          <button className="btn btn-danger" aria-label="Delete credential" onClick={() => del(c.id)}>✕</button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {editingId === c.id && (
                    <tr key={`${c.id}-edit`} style={{ background: "#0f1117" }}>
                      <td colSpan="99" style={{ padding: "12px 16px" }}>
                        <form onSubmit={saveEdit} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <label style={{ fontSize: 11, color: "#94a3b8" }}>Type</label>
                            <select value={editForm.type} onChange={e => setEditForm(p => ({ ...p, type: e.target.value }))} style={{ width: 130 }}>
                              <option value="generic">Generic</option>
                              <option value="api_key">API Key</option>
                              <option value="basic_auth">Basic Auth</option>
                              <option value="smtp">SMTP</option>
                              <option value="ssh">SSH</option>
                              <option value="sftp">SFTP</option>
                              <option value="aws">AWS</option>
                              <option value="openai_api">OpenAI API</option>
                              <option value="slack">Slack</option>
                              <option value="telegram">Telegram</option>
                            </select>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
                            <label style={{ fontSize: 11, color: "#94a3b8" }}>New Secret (leave blank to keep existing)</label>
                            <input type="password" value={editForm.secret} onChange={e => setEditForm(p => ({ ...p, secret: e.target.value }))} placeholder="leave blank to keep existing" />
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
                            <label style={{ fontSize: 11, color: "#94a3b8" }}>Note</label>
                            <input value={editForm.note} onChange={e => setEditForm(p => ({ ...p, note: e.target.value }))} />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="submit" className="btn btn-primary">Save</button>
                            <button type="button" className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={() => { confirmState.fn(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
      {oauthModal && <OAuthConnectModal provider={oauthModal} onClose={() => setOauthModal(null)} />}
    </div>
  );
}

import { Fragment, useState, useEffect, useCallback } from "react";
import { api } from "../../api/client.js";
import { ViewerBanner } from "../../components/ViewerBanner.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { CronBuilder } from "./CronBuilder.jsx";
import { CronNextRun } from "./CronNextRun.jsx";
import { DateTimePicker } from "./DateTimePicker.jsx";
import { TimezoneSelect } from "./TimezoneSelect.jsx";
import { FlowPicker } from "./FlowPicker.jsx";
import { useAuth } from "../../contexts/AuthContext.jsx";

const pill = (active, onClick, label) => (
  <span onClick={onClick} style={{
    padding: "3px 12px", borderRadius: 20, fontSize: 12, cursor: "pointer",
    fontWeight: 600, border: "1px solid",
    background: active ? "#7c3aed" : "transparent",
    borderColor: active ? "#7c3aed" : "#2a2d3e",
    color: active ? "#fff" : "#64748b",
  }}>{label}</span>
);

function parseSchedulePayload(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, value: parsed };
    }
    return { ok: false, error: "Payload must be a JSON object" };
  } catch {
    return { ok: false, error: "Payload must be valid JSON" };
  }
}

export function Schedules({ showToast }) {
  const { currentUser: user } = useAuth();
  const [schedules, setSchedules]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [graphs, setGraphs]             = useState([]);
  const [scripts, setScripts]           = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [runningNow, setRunningNow]     = useState({});

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [defaultTz, setDefaultTz] = useState(browserTz);

  const [schedMode, setSchedMode] = useState("recurring");
  const [form, setForm] = useState({
    name: "", workflow: "", graph_id: null,
    cron: "0 9 * * *", payload: "{}", timezone: browserTz, run_at: "",
  });

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm]   = useState({});

  const load = useCallback(async ({ silent = false } = {}) => {
    setLoading(true);
    try {
      setSchedules(await api("GET", "/api/schedules"));
    } catch (e) {
      setSchedules([]);
      if (!silent) {
        showToast(e.message || "Failed to load schedules", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
    api("GET", "/api/graphs").then(setGraphs).catch(() => {});
    api("GET", "/api/scripts").then(data => setScripts(Array.isArray(data) ? data : (data.scripts || []))).catch(() => {});
    api("GET", "/api/system/status").then(st => {
      const tz = st?.system?.app_timezone;
      if (tz) { setDefaultTz(tz); setForm(f => ({ ...f, timezone: tz })); }
    }).catch(() => {});
  }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!form.workflow?.trim()) { showToast("Select a flow or script", "error"); return; }
    if (schedMode === "once" && !form.run_at) { showToast("Pick a date/time", "error"); return; }
    const payload = parseSchedulePayload(form.payload);
    if (!payload.ok) { showToast(payload.error, "error"); return; }
    try {
      await api("POST", "/api/schedules", {
        ...form,
        payload: payload.value,
        cron:   schedMode === "once" ? null : form.cron,
        run_at: schedMode === "once" ? new Date(form.run_at).toISOString() : null,
      });
      setForm({ name: "", workflow: "", graph_id: null, cron: "0 9 * * *", payload: "{}", timezone: defaultTz, run_at: "" });
      setSchedMode("recurring");
      await load({ silent: true });
      showToast("Schedule created");
    } catch (err) { showToast(err.message, "error"); }
  }

  async function toggle(id) {
    try { await api("POST", `/api/schedules/${id}/toggle`); await load({ silent: true }); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function runNow(id, name) {
    setRunningNow(r => ({ ...r, [id]: true }));
    try {
      const res = await api("POST", `/api/schedules/${id}/run-now`);
      showToast(`▶ "${name}" queued (task ${res.task_id?.slice(0, 8)}…)`);
    } catch (e) { showToast(e.message, "error"); }
    setRunningNow(r => ({ ...r, [id]: false }));
  }

  function confirmDel(id, name) {
    setConfirmState({
      message: `Delete schedule "${name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        try { await api("DELETE", `/api/schedules/${id}`); await load({ silent: true }); showToast("Schedule deleted"); }
        catch (e) { showToast(e.message, "error"); }
      },
    });
  }

  function startEdit(s) {
    setEditingId(s.id);
    setEditForm({
      name:     s.name,
      workflow: s.workflow || "",
      graph_id: s.graph_id || null,
      cron:     s.cron || "0 9 * * *",
      payload:  typeof s.payload === "object" ? JSON.stringify(s.payload) : (s.payload || "{}"),
      timezone: s.timezone || defaultTz,
      run_at:   s.run_at ? new Date(s.run_at).toISOString().slice(0, 16) : "",
      mode:     s.run_at ? "once" : "recurring",
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    const payload = parseSchedulePayload(editForm.payload);
    if (!payload.ok) { showToast(payload.error, "error"); return; }
    try {
      await api("PUT", `/api/schedules/${editingId}`, {
        name:     editForm.name,
        workflow: editForm.workflow,
        graph_id: editForm.graph_id,
        payload:  payload.value,
        timezone: editForm.timezone,
        cron:     editForm.mode === "once" ? null : editForm.cron,
        run_at:   editForm.mode === "once" ? new Date(editForm.run_at).toISOString() : null,
      });
      setEditingId(null); setEditForm({});
      await load({ silent: true }); showToast("Schedule updated");
    } catch (ex) { showToast(ex.message, "error"); }
  }

  const ro = user?.role === "viewer";

  return (
    <div>
      <h1 className="page-title">Schedules</h1>
      {ro && <ViewerBanner />}

      {!ro && (
        <div className="card">
          <div className="card-title">New Schedule</div>
          <form onSubmit={create}>
            <div className="form-row">
              <div className="form-group">
                <label>Name</label>
                <input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Daily digest" />
              </div>
              <div className="form-group">
                <label>Flow / Script</label>
                <FlowPicker value={form.workflow} graphs={graphs} scripts={scripts}
                  onChange={({ workflow, graph_id }) => setForm({ ...form, workflow, graph_id })} />
              </div>
            </div>

            <div className="form-group">
              <label>Schedule Type</label>
              <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                {pill(schedMode === "recurring", () => setSchedMode("recurring"), "🔁 Recurring")}
                {pill(schedMode === "once",      () => setSchedMode("once"),      "⚡ Run Once")}
              </div>
            </div>

            {schedMode === "recurring" ? (
              <div className="form-row" style={{ alignItems: "flex-start" }}>
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Schedule</label>
                  <CronBuilder value={form.cron} onChange={v => setForm({ ...form, cron: v })} timezone={form.timezone} />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Timezone</label>
                  <TimezoneSelect value={form.timezone} onChange={v => setForm({ ...form, timezone: v })} />
                </div>
              </div>
            ) : (
              <div className="form-row">
                <div className="form-group">
                  <label>Run at (local time)</label>
                  <DateTimePicker value={form.run_at} onChange={v => setForm({ ...form, run_at: v })} required={schedMode === "once"} />
                </div>
                <div className="form-group">
                  <label>Timezone</label>
                  <TimezoneSelect value={form.timezone} onChange={v => setForm({ ...form, timezone: v })} />
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Payload (JSON)</label>
              <input value={form.payload} onChange={e => setForm({ ...form, payload: e.target.value })} placeholder="{}" />
            </div>
            <button type="submit" className="btn btn-primary">+ Create</button>
          </form>
        </div>
      )}

      <div className="card">
        <div className="card-title">Scheduled Jobs</div>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : schedules.length === 0 ? (
          <div className="empty-state">No schedules yet.</div>
        ) : (
          <table className="mobile-cards">
            <thead>
              <tr>
                <th>Name</th><th>Flow</th><th>Schedule</th>
                <th>Next run</th><th>Last run</th><th>Status</th>
                {!ro && <th></th>}
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => {
                const lastRunBadge = s.last_run_status ? (
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className={`badge badge-${s.last_run_status}`} style={{ fontSize: 10 }}>{s.last_run_status}</span>
                    <span style={{ fontSize: 10, color: "#475569" }}>{new Date(s.last_run_at).toLocaleString()}</span>
                    {s.last_run_duration_ms && <span style={{ fontSize: 10, color: "#475569" }}>{(s.last_run_duration_ms / 1000).toFixed(1)}s</span>}
                  </span>
                ) : <span style={{ fontSize: 11, color: "#475569" }}>never</span>;

                return (
                  <Fragment key={s.id}>
                    <tr key={s.id}>
                      <td data-label="Name" style={{ fontWeight: 500 }}>{s.name}</td>
                      <td data-label="Flow" style={{ fontSize: 12 }}>
                        {s.graph_name
                          ? <span style={{ color: "#a78bfa" }}>{s.graph_name}</span>
                          : <span style={{ color: "#475569", fontFamily: "monospace" }}>{s.workflow || "—"}</span>}
                      </td>
                      <td data-label="Schedule" style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {s.run_at
                          ? <span><span style={{ fontSize: 10, background: "#1e3a5f", color: "#60a5fa", borderRadius: 4, padding: "1px 6px", fontWeight: 600, marginRight: 6 }}>ONCE</span>{new Date(s.run_at).toLocaleString()}</span>
                          : s.cron}
                      </td>
                      <td data-label="Next run">
                        <CronNextRun cron={s.cron} timezone={s.timezone} enabled={s.enabled} runAt={s.run_at} />
                      </td>
                      <td data-label="Last run">{lastRunBadge}</td>
                      <td data-label="Status">
                        <span className={`badge ${s.enabled ? "badge-succeeded" : "badge-cancelled"}`}>{s.enabled ? "active" : "paused"}</span>
                      </td>
                      {!ro && (
                        <td data-label="">
                          <div style={{ display: "flex", gap: 6 }}>
                            {s.graph_id && (
                              <button className="btn btn-primary btn-sm" onClick={() => runNow(s.id, s.name)}
                                disabled={runningNow[s.id]} title="Run now">
                                {runningNow[s.id] ? "…" : "▶"}
                              </button>
                            )}
                            <button className="btn btn-ghost" onClick={() => startEdit(s)} title="Edit" aria-label="Edit schedule">✏️</button>
                            {!s.run_at && (
                              <button className="btn btn-ghost" onClick={() => toggle(s.id)}>{s.enabled ? "Pause" : "Resume"}</button>
                            )}
                            <button className="btn btn-danger btn-sm" onClick={() => confirmDel(s.id, s.name)} title="Delete" aria-label="Delete schedule">✕</button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {editingId === s.id && (
                      <tr style={{ background: "#0f1117" }}>
                        <td colSpan="7" style={{ padding: "16px" }}>
                          <form onSubmit={saveEdit}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
                                <label style={{ fontSize: 11, color: "#94a3b8" }}>Name</label>
                                <input required value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 180 }}>
                                <label style={{ fontSize: 11, color: "#94a3b8" }}>Flow / Script</label>
                                <FlowPicker value={editForm.workflow} graphs={graphs} scripts={scripts}
                                  onChange={({ workflow, graph_id }) => setEditForm(p => ({ ...p, workflow, graph_id }))} />
                              </div>
                            </div>
                            <div style={{ marginTop: 10, display: "flex", gap: 6, marginBottom: 10 }}>
                              {pill(editForm.mode === "recurring", () => setEditForm(p => ({ ...p, mode: "recurring" })), "🔁 Recurring")}
                              {pill(editForm.mode === "once",      () => setEditForm(p => ({ ...p, mode: "once" })),      "⚡ Run Once")}
                            </div>
                            {editForm.mode === "recurring" ? (
                              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 10 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Cron</label>
                                  <input value={editForm.cron} onChange={e => setEditForm(p => ({ ...p, cron: e.target.value }))} style={{ fontFamily: "monospace" }} />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Timezone</label>
                                  <TimezoneSelect value={editForm.timezone} onChange={v => setEditForm(p => ({ ...p, timezone: v }))} />
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 10 }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Run at</label>
                                  <DateTimePicker value={editForm.run_at} onChange={v => setEditForm(p => ({ ...p, run_at: v }))} />
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: 11, color: "#94a3b8" }}>Timezone</label>
                                  <TimezoneSelect value={editForm.timezone} onChange={v => setEditForm(p => ({ ...p, timezone: v }))} />
                                </div>
                              </div>
                            )}
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                              <label style={{ fontSize: 11, color: "#94a3b8" }}>Payload (JSON)</label>
                              <input value={editForm.payload} onChange={e => setEditForm(p => ({ ...p, payload: e.target.value }))} />
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
                );
              })}
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
    </div>
  );
}

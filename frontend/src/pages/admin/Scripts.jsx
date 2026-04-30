import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { useTheme } from "../../contexts/ThemeContext.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ViewerBanner } from "../../components/ViewerBanner.jsx";

/* ── Monaco loader ─────────────────────────────────────────────────────── */
function loadMonaco(cb) {
  if (window.monaco) { cb(); return; }
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs/loader.min.js";
  script.onload = () => {
    window.require.config({
      paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs" },
    });
    window.require(["vs/editor/editor.main"], cb);
  };
  document.head.appendChild(script);
}

const RUN_STATUS_COLOR = {
  succeeded: "var(--success)", failed: "var(--danger)", dead: "var(--danger)",
  running: "#34d399", queued: "#60a5fa", retrying: "#fb923c",
};

export function Scripts({ showToast }) {
  const { currentUser: user }                 = useAuth();
  const { theme }                             = useTheme();
  const [scripts, setScripts]                 = useState([]);
  const [selectedScript, setSelectedScript]   = useState(null);
  const [loadingList, setLoadingList]         = useState(true);
  const [loadingContent, setLoadingContent]   = useState(false);
  const [loadError, setLoadError]             = useState("");
  const [newName, setNewName]                 = useState("");
  const [creating, setCreating]               = useState(false);
  const [confirmState, setConfirmState]       = useState(null);
  // run status: { taskId, status, error } per script name
  const [runStatus, setRunStatus]             = useState({});
  // last run info per script name: { status, created_at }
  const [lastRuns, setLastRuns]               = useState({});
  const selectedNameRef     = useRef(null);
  const monacoRef          = useRef(null);
  const editorContainerRef = useRef(null);
  const pollRef            = useRef({});

  const selectScript = useCallback(async (name) => {
    setLoadingContent(true);
    try {
      const full = await api("GET", `/api/scripts/${name}`);
      selectedNameRef.current = full?.name || name;
      setSelectedScript(full);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoadingContent(false);
    }
  }, [showToast]);

  /* ── fetch list + last-run info ──────────────────────────────────────── */
  const load = useCallback(async ({ preserveSelection = true, silent = false } = {}) => {
    if (!silent) setLoadingList(true);
    setLoadError("");
    try {
      const s = await api("GET", "/api/scripts");
      const list = Array.isArray(s) ? s : [];
      setScripts(list);
      const names = new Set(list.map(sc => sc.name));
      setRunStatus(prev => Object.fromEntries(Object.entries(prev).filter(([name]) => names.has(name))));
      const lastRunEntries = await Promise.all(list.map(async sc => {
        try {
          const runs = await api("GET", `/api/runs?q=${encodeURIComponent(sc.name)}&page_size=1`);
          const latest = (runs.runs ?? runs)[0];
          if (latest) {
            return [sc.name, {
              status: latest.status,
              created_at: latest.created_at,
            }];
          }
        } catch {
          return null;
        }
        return null;
      }));
      setLastRuns(Object.fromEntries(lastRunEntries.filter(Boolean)));

      if (list.length === 0) {
        selectedNameRef.current = null;
        setSelectedScript(null);
        return;
      }
      const preferredName = preserveSelection && selectedNameRef.current && names.has(selectedNameRef.current)
        ? selectedNameRef.current
        : list[0].name;
      if (selectedNameRef.current !== preferredName) {
        await selectScript(preferredName);
      }
    } catch (e) {
      setScripts([]);
      selectedNameRef.current = null;
      setSelectedScript(null);
      setLastRuns({});
      setRunStatus({});
      if (!silent) {
        setLoadError(e.message || "Failed to load scripts");
        showToast(e.message, "error");
      }
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, [selectScript, showToast]);

  useEffect(() => {
    load({ preserveSelection: false });
    return () => { Object.values(pollRef.current).forEach(clearInterval); };
  }, [load]);

  /* ── Monaco editor lifecycle ─────────────────────────────────────────── */
  useEffect(() => {
    if (!selectedScript || !editorContainerRef.current) return;
    if (monacoRef.current) { monacoRef.current.dispose(); monacoRef.current = null; }

    function initEditor() {
      monacoRef.current = window.monaco.editor.create(editorContainerRef.current, {
        value: selectedScript.content || "",
        language: "python",
        theme: theme === "dark" ? "vs-dark" : "vs",
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
      });
    }

    loadMonaco(initEditor);
    return () => { if (monacoRef.current) { monacoRef.current.dispose(); monacoRef.current = null; } };
  }, [selectedScript?.name, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── actions ─────────────────────────────────────────────────────────── */
  async function createScript(e) {
    e.preventDefault();
    if (!newName.trim()) { showToast("Script name required", "error"); return; }
    setCreating(true);
    try {
      await api("POST", "/api/scripts", { name: newName, content: `# ${newName}.py\n` });
      const created = newName;
      setNewName("");
      await load({ preserveSelection: true, silent: true });
      await selectScript(created);
      showToast("Script created");
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setCreating(false);
    }
  }

  async function saveScript() {
    if (!selectedScript || !monacoRef.current) return;
    try {
      const content = monacoRef.current.getValue();
      await api("PUT", `/api/scripts/${selectedScript.name}`, { content });
      setSelectedScript(s => ({ ...s, content }));
      await load({ preserveSelection: true, silent: true });
      showToast("Saved");
    } catch (e) { showToast(e.message, "error"); }
  }

  async function deleteScript() {
    if (!selectedScript) return;
    setConfirmState({
      message: `Delete script "${selectedScript.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      fn: async () => {
        try {
          await api("DELETE", `/api/scripts/${selectedScript.name}`);
          showToast("Deleted");
          selectedNameRef.current = null;
          setSelectedScript(null);
          await load({ preserveSelection: false, silent: true });
        } catch (e) { showToast(e.message, "error"); }
      },
    });
  }

  async function runScript() {
    if (!selectedScript) return;
    const name = selectedScript.name;
    try {
      const res = await api("POST", `/api/scripts/${name}/run`);
      showToast(`▶ Running ${name}…`);
      setRunStatus(prev => ({ ...prev, [name]: { taskId: res.task_id, status: "queued" } }));

      // Poll until terminal
      if (pollRef.current[name]) clearInterval(pollRef.current[name]);
      pollRef.current[name] = setInterval(async () => {
        try {
          const run = await api("GET", `/api/runs/by-task/${res.task_id}`);
          if (!run) return;
          setRunStatus(prev => ({ ...prev, [name]: { taskId: res.task_id, status: run.status, error: run.result?.error } }));
          if (["succeeded","failed","dead","cancelled"].includes(run.status)) {
            clearInterval(pollRef.current[name]);
            delete pollRef.current[name];
            setLastRuns(prev => ({ ...prev, [name]: { status: run.status, created_at: run.created_at } }));
            if (run.status === "succeeded") showToast(`✓ ${name} succeeded`);
            else showToast(`✗ ${name} ${run.status}${run.result?.error ? `: ${run.result.error}` : ""}`, "error");
          }
        } catch {
          clearInterval(pollRef.current[name]);
          delete pollRef.current[name];
        }
      }, 2000);
    } catch (e) { showToast(e.message, "error"); }
  }

  const ro = user?.role === "viewer";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <h1 className="page-title">Scripts</h1>
      {ro && <ViewerBanner />}

      <div style={{
        display: "flex", flex: 1, overflow: "hidden",
        marginTop: -8, marginLeft: -32, marginRight: -32, marginBottom: -32,
      }}>
        {/* ── Sidebar list ── */}
        <div className="script-list">
          {!ro && (
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <form onSubmit={createScript}>
                <input
                  type="text"
                  className="field-input"
                  placeholder="New script name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  style={{ width: "100%", marginBottom: 8 }}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: "100%" }}
                  disabled={creating}
                >
                  {creating ? "Creating…" : "+ Create"}
                </button>
              </form>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {loadingList && (
              <div style={{ padding: "16px 14px", color: "var(--text-muted-2)", fontSize: 12 }}>
                Loading scripts…
              </div>
            )}
            {!loadingList && loadError && (
              <div style={{ padding: "16px 14px", color: "var(--danger)", fontSize: 12 }}>
                {loadError}
              </div>
            )}
            {!loadingList && !loadError && scripts.length === 0 && (
              <div style={{ padding: "16px 14px", color: "var(--text-muted-3)", fontSize: 12 }}>
                No scripts yet. Create one above.
              </div>
            )}
            {!loadingList && !loadError && scripts.map(s => {
              const live = runStatus[s.name];
              const last = lastRuns[s.name];
              const isRunning = live && ["queued","running","retrying"].includes(live.status);
              const displayStatus = live?.status || last?.status;
              return (
                <div
                  key={s.name}
                  className={`script-item${selectedScript?.name === s.name ? " active" : ""}`}
                  onClick={() => selectScript(s.name)}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="script-item-name">{s.name}</div>
                    {displayStatus && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8,
                        color: RUN_STATUS_COLOR[displayStatus] || "var(--text-muted)",
                        animation: isRunning ? "pulse 1.2s ease-in-out infinite" : "none",
                      }}>
                        {isRunning ? "⟳" : displayStatus === "succeeded" ? "✓" : displayStatus === "failed" ? "✗" : "●"}{" "}
                        {displayStatus}
                      </span>
                    )}
                  </div>
                  <div className="script-item-meta">
                    {s.size} bytes · {new Date(s.modified * 1000).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Editor pane ── */}
        <div className="editor-wrap">
          {loadingContent ? (
            <div className="empty-state" style={{ alignSelf: "center", marginTop: "40%" }}>
              Loading…
            </div>
          ) : selectedScript ? (
            <>
              <div className="editor-toolbar">
                <span style={{ color: "var(--text-muted-2)", fontSize: 12, marginRight: "auto", fontFamily: "monospace" }}>
                  {selectedScript.name}.py
                </span>
                {!ro && <button className="btn btn-primary btn-sm" onClick={saveScript}>💾 Save</button>}
                {!ro && (
                  <button className="btn btn-success btn-sm" onClick={runScript}
                    disabled={["queued","running"].includes(runStatus[selectedScript?.name]?.status)}>
                    {["queued","running"].includes(runStatus[selectedScript?.name]?.status)
                      ? <><span style={{ animation: "spin .8s linear infinite", display: "inline-block" }}>⟳</span> Running…</>
                      : "▶ Run"}
                  </button>
                )}
                {!ro && <button className="btn btn-danger btn-sm" onClick={deleteScript}>✕ Delete</button>}
              </div>
              <div className="editor-container" ref={editorContainerRef} />
            </>
          ) : (
            <div className="empty-state" style={{ alignSelf: "center", marginTop: "40%" }}>
              Select a script or create a new one.
            </div>
          )}
        </div>
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

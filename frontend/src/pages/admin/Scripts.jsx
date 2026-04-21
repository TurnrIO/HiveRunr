import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../../api/client.js";
import { useAuth } from "../../contexts/AuthContext.jsx";
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

export function Scripts({ showToast }) {
  const { user }                              = useAuth();
  const [scripts, setScripts]                 = useState([]);
  const [selectedScript, setSelectedScript]   = useState(null);
  const [loadingContent, setLoadingContent]   = useState(false);
  const [newName, setNewName]                 = useState("");
  const [creating, setCreating]               = useState(false);
  const [confirmState, setConfirmState]       = useState(null);
  const monacoRef          = useRef(null);
  const editorContainerRef = useRef(null);

  /* ── fetch list ──────────────────────────────────────────────────────── */
  const load = useCallback(async (keepSelected = false) => {
    try {
      const s = await api("GET", "/api/scripts");
      const list = Array.isArray(s) ? s : [];
      setScripts(list);
      if (!keepSelected && list.length > 0) {
        await selectScript(list[0].name);
      }
    } catch (e) { showToast(e.message, "error"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function selectScript(name) {
    setLoadingContent(true);
    try {
      const full = await api("GET", `/api/scripts/${name}`);
      setSelectedScript(full);
    } catch (e) { showToast(e.message, "error"); }
    setLoadingContent(false);
  }

  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Monaco editor lifecycle ─────────────────────────────────────────── */
  useEffect(() => {
    if (!selectedScript || !editorContainerRef.current) return;
    if (monacoRef.current) { monacoRef.current.dispose(); monacoRef.current = null; }

    function initEditor() {
      monacoRef.current = window.monaco.editor.create(editorContainerRef.current, {
        value: selectedScript.content || "",
        language: "python",
        theme: "vs-dark",
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
      });
    }

    loadMonaco(initEditor);
    return () => { if (monacoRef.current) { monacoRef.current.dispose(); monacoRef.current = null; } };
  }, [selectedScript?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── actions ─────────────────────────────────────────────────────────── */
  async function createScript(e) {
    e.preventDefault();
    if (!newName.trim()) { showToast("Script name required", "error"); return; }
    setCreating(true);
    try {
      await api("POST", "/api/scripts", { name: newName, content: `# ${newName}.py\n` });
      const created = newName;
      setNewName("");
      await load(true);
      await selectScript(created);
      showToast("Script created");
    } catch (e) { showToast(e.message, "error"); }
    setCreating(false);
  }

  async function saveScript() {
    if (!selectedScript || !monacoRef.current) return;
    try {
      const content = monacoRef.current.getValue();
      await api("PUT", `/api/scripts/${selectedScript.name}`, { content });
      setSelectedScript(s => ({ ...s, content }));
      await load(true);
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
          setSelectedScript(null);
          await load(false);
        } catch (e) { showToast(e.message, "error"); }
      },
    });
  }

  async function runScript() {
    if (!selectedScript) return;
    try {
      const res = await api("POST", `/api/scripts/${selectedScript.name}/run`);
      showToast(`Queued: task ${res.task_id}`);
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
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #2a2d3e" }}>
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
            {scripts.length === 0 && (
              <div style={{ padding: "16px 14px", color: "#475569", fontSize: 12 }}>
                No scripts yet. Create one above.
              </div>
            )}
            {scripts.map(s => (
              <div
                key={s.name}
                className={`script-item${selectedScript?.name === s.name ? " active" : ""}`}
                onClick={() => selectScript(s.name)}
              >
                <div className="script-item-name">{s.name}</div>
                <div className="script-item-meta">
                  {s.size} bytes · {new Date(s.modified * 1000).toLocaleDateString()}
                </div>
              </div>
            ))}
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
                <span style={{ color: "#64748b", fontSize: 12, marginRight: "auto", fontFamily: "monospace" }}>
                  {selectedScript.name}.py
                </span>
                {!ro && <button className="btn btn-primary btn-sm"  onClick={saveScript}>💾 Save</button>}
                {!ro && <button className="btn btn-success btn-sm"  onClick={runScript}>▶ Run</button>}
                {!ro && <button className="btn btn-danger btn-sm"   onClick={deleteScript}>✕ Delete</button>}
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

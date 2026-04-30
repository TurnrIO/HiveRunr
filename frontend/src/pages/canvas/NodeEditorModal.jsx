import { useState, useEffect, useRef, useMemo } from "react";
import { NODE_DEFS } from "./nodeDefs.js";
import { NioBody } from "./ConfigPanel.jsx";
import { VarField } from "./VarField.jsx";
import { buildVarList } from "./canvasHelpers.js";

// ── WebhookUrlPanel ────────────────────────────────────────────────────────────
function WebhookUrlPanel({ graph, nodeConfig }) {
  const [copied, setCopied] = useState(false);

  if (!graph) {
    return (
      <div style={{
        background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 6,
        padding: "10px 12px", fontSize: 11, color: "var(--text-muted-2)", marginTop: 8,
      }}>
        🔗 Save this flow first to get its webhook URL.
      </div>
    );
  }

  const base      = (window.location.origin || "").replace(/\/+$/, "");
  const token     = graph.webhook_token || "";
  const url       = token ? `${base}/webhook/${token}` : "(token not available — reload the page)";
  const hasSecret = !!(nodeConfig.secret || "").trim();

  function copy() {
    if (!token) return;
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div style={{
      background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 6,
      padding: "10px 12px", fontSize: 11, color: "var(--text-muted)", marginTop: 8,
    }}>
      <div style={{ fontWeight: 700, color: "var(--info)", marginBottom: 6, fontSize: 11 }}>🔗 Webhook URL</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <code style={{
          flex: 1, background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", borderRadius: 4,
          padding: "5px 8px", fontSize: 10, color: "var(--accent-2)", wordBreak: "break-all", lineHeight: 1.5,
        }}>
          {url}
        </code>
        <button
          onClick={copy}
          style={{
            flexShrink: 0,
            background: copied ? "var(--success-soft)" : "var(--bg-elev-2)",
            border: `1px solid ${copied ? "var(--success-border)" : "var(--border-strong)"}`,
            borderRadius: 5, padding: "5px 10px",
            color: copied ? "var(--success)" : "var(--text-muted)",
            fontSize: 10, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}
        >
          {copied ? "✓ Copied" : "📋 Copy"}
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", color: "var(--text-muted-2)", fontSize: 10 }}>
        <span>Method</span><code style={{ color: "var(--text-muted)" }}>POST</code>
        <span>Body</span><code style={{ color: "var(--text-muted)" }}>application/json</code>
        {hasSecret ? (
          <>
            <span>Auth</span>
            <span style={{ color: "#fb923c" }}>X-Hub-Signature-256: sha256=&lt;hmac&gt;</span>
          </>
        ) : (
          <>
            <span>Auth</span>
            <span style={{ color: "var(--text-muted-3)" }}>None (open — consider adding a secret)</span>
          </>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted-3)", lineHeight: 1.5 }}>
        The payload body becomes the node's output. Use{" "}
        <code style={{ color: "var(--accent-2)" }}>{"{{trigger.field}}"}</code> in downstream nodes.
      </div>
    </div>
  );
}

// ── Node type hint panels ──────────────────────────────────────────────────────
function NodeHints({ type, currentGraph, nodeConfig }) {
  const hintBox = { background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: "var(--text-muted)", marginTop: 6 };
  const grid2   = { display: "grid", gridTemplateColumns: "auto 1fr", gap: "0 10px" };

  if (type === "action.condition") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      Expression must evaluate to a Python bool.<br />
      <div style={{ color: "#059669", marginTop: 4 }}>● True handle → nodes that run when condition is met</div>
      <div style={{ color: "#dc2626" }}>● False handle → nodes that run when condition is not met</div>
      <div style={{ marginTop: 4 }}>Output: <code style={{ color: "#a78bfa" }}>{"{ result: bool, input: ... }"}</code></div>
    </div>
  );
  if (type === "action.loop") return (
    <div style={{ ...hintBox }}>
      <div style={{ color: "#7e22ce", marginBottom: 3 }}>● Body → runs per item</div>
      <div style={{ color: "#64748b", marginBottom: 4 }}>● Done → after all iterations</div>
      Each body node receives the current item as input.
    </div>
  );
  if (type === "action.transform") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <code style={{ color: "#a78bfa" }}>input</code> is the upstream output (often a dict).<br />
      To slice a nested list: <code style={{ color: "#6ee7b7" }}>input['body'][:5]</code> not <code style={{ color: "#f87171" }}>input[:5]</code>.<br />
      Also available: <code style={{ color: "#a78bfa" }}>context</code>, <code style={{ color: "#a78bfa" }}>json</code>.
    </div>
  );
  if (type === "action.filter") return (
    <div style={{ ...hintBox }}>
      Output: <code style={{ color: "#a78bfa" }}>{"{ items: [...], count: N }"}</code><br />
      Use <code style={{ color: "#a78bfa" }}>item</code> in the expression.
    </div>
  );
  if (type === "action.llm_call") return (
    <div style={{ ...hintBox }}>
      Output: <code style={{ color: "#a78bfa" }}>{"{ response, model, tokens }"}</code><br />
      Set <code style={{ color: "#a78bfa" }}>api_base</code> for Groq, Together AI, Ollama etc.
    </div>
  );
  if (type === "action.slack") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>💡 Credential shortcut</div>
      Create a <strong>Slack Incoming Webhook</strong> credential → set <strong>Slack Credential</strong> to its name.<br />
      Output: <code style={{ color: "#a78bfa" }}>{"{ sent: true, message }"}</code>
    </div>
  );
  if (type === "action.call_graph") return (
    <div style={{ ...hintBox }}>
      Runs another flow as a sub-routine.<br />Output: the sub-flow's final context dict.<br />
      Max nesting depth: <code style={{ color: "#a78bfa" }}>5</code> levels.
    </div>
  );
  if (type === "action.run_script") return (
    <div style={{ background: "#2d0a0a", border: "1px solid #7f1d1d", borderRadius: 6, padding: "8px 10px", fontSize: 10, marginTop: 6 }}>
      <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 4 }}>⚠️ Danger — arbitrary code execution</div>
      <div style={{ color: "#fca5a5", lineHeight: 1.7 }}>
        Runs Python via <code style={{ color: "#fca5a5" }}>exec()</code> with <code style={{ color: "#fca5a5" }}>os</code>,{" "}
        <code style={{ color: "#fca5a5" }}>json</code>, <code style={{ color: "#fca5a5" }}>time</code> in scope.<br />
        <strong>Disabled by default</strong> — set <code style={{ color: "#fca5a5" }}>ENABLE_RUN_SCRIPT=true</code> in{" "}
        <code style={{ color: "#fca5a5" }}>.env</code> to enable.<br />
        Every execution is written to the audit log. Assign output to <code style={{ color: "#fca5a5" }}>result</code>.
      </div>
    </div>
  );
  if (type === "action.send_email") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>💡 Credential shortcut</div>
      Create an <strong>SMTP Server</strong> credential → set <strong>SMTP Credential</strong> to its name.
    </div>
  );
  if (type === "action.ssh") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>💡 Credential shortcut</div>
      Create an <strong>SSH Server</strong> credential → set <strong>SSH Credential</strong> to its name.<br />
      Output: <code style={{ color: "#a78bfa" }}>{"{ stdout, stderr, exit_code, success }"}</code>
    </div>
  );
  if (type === "action.sftp") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>📁 SFTP / FTP Operations</div>
      Create an <strong>SFTP / FTP Server</strong> credential → set <strong>SFTP Credential</strong> to its name.<br />
      <div style={{ ...grid2, marginTop: 6 }}>
        <code style={{ color: "#a78bfa" }}>list</code><span>→ files[] — set <em>recursive: true</em> to walk subdirs</span>
        <code style={{ color: "#a78bfa" }}>upload</code><span>→ put <em>content</em> at remote_path</span>
        <code style={{ color: "#a78bfa" }}>download</code><span>→ {"{ content, size }"}</span>
        <code style={{ color: "#a78bfa" }}>delete</code><span>→ remove file</span>
        <code style={{ color: "#a78bfa" }}>mkdir</code><span>→ create directory</span>
        <code style={{ color: "#a78bfa" }}>rename</code><span>→ move/rename (set <em>new_path</em>)</span>
        <code style={{ color: "#a78bfa" }}>exists</code><span>→ {"{ exists, is_dir }"}</span>
        <code style={{ color: "#a78bfa" }}>stat</code><span>→ {"{ size, is_dir, modified }"}</span>
      </div>
    </div>
  );
  if (type === "action.github") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>🐙 GitHub</div>
      Create a <strong>GitHub Token</strong> credential (API Key type, paste PAT) → set <strong>GitHub Credential</strong>.<br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#a78bfa" }}>get_repo</code><span>→ repo details</span>
        <code style={{ color: "#a78bfa" }}>list_issues</code><span>→ open issues</span>
        <code style={{ color: "#a78bfa" }}>create_issue</code><span>→ new issue</span>
        <code style={{ color: "#a78bfa" }}>add_comment</code><span>→ comment on issue</span>
        <code style={{ color: "#a78bfa" }}>list_commits</code><span>→ recent commits</span>
        <code style={{ color: "#a78bfa" }}>get_file</code><span>→ raw file content</span>
        <code style={{ color: "#a78bfa" }}>create_release</code><span>→ new release</span>
      </div>
    </div>
  );
  if (type === "action.google_sheets") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>📊 Google Sheets</div>
      Service Account credential → set <strong>Google SA Credential</strong>.<br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#a78bfa" }}>read_range</code><span>→ rows[]</span>
        <code style={{ color: "#a78bfa" }}>write_range</code><span>→ overwrite range</span>
        <code style={{ color: "#a78bfa" }}>append_rows</code><span>→ append below data</span>
        <code style={{ color: "#a78bfa" }}>clear_range</code><span>→ clear range</span>
      </div>
    </div>
  );
  if (type === "action.notion") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>🗒 Notion</div>
      Integration Token credential → set <strong>Notion Credential</strong>.<br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#a78bfa" }}>query_database</code><span>→ rows[]</span>
        <code style={{ color: "#a78bfa" }}>get_page</code><span>→ page properties</span>
        <code style={{ color: "#a78bfa" }}>create_page</code><span>→ new page</span>
        <code style={{ color: "#a78bfa" }}>update_page</code><span>→ update properties</span>
        <code style={{ color: "#a78bfa" }}>append_blocks</code><span>→ add content</span>
      </div>
    </div>
  );
  if (type === "trigger.cron") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>⏰ Saved automatically as a schedule</div>
      <div style={{ ...grid2 }}>
        <span style={{ color: "#64748b" }}>Every minute</span><code>* * * * *</code>
        <span style={{ color: "#64748b" }}>Every hour</span><code>0 * * * *</code>
        <span style={{ color: "#64748b" }}>Daily at 9am</span><code>0 9 * * *</code>
        <span style={{ color: "#64748b" }}>Weekdays 9am</span><code>0 9 * * 1-5</code>
        <span style={{ color: "#64748b" }}>Every 15 min</span><code>*/15 * * * *</code>
      </div>
    </div>
  );
  if (type === "trigger.webhook") return <WebhookUrlPanel graph={currentGraph} nodeConfig={nodeConfig || {}} />;
  if (type === "action.merge") return (
    <div style={{ ...hintBox, lineHeight: 1.9 }}>
      <div style={{ color: "#a78bfa", fontWeight: 600, marginBottom: 4 }}>⇒ Merge / Join</div>
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#4ade80" }}>dict</code><span>→ merge dicts (last wins)</span>
        <code style={{ color: "#60a5fa" }}>all</code><span>→ {"{ merged: [...], count }"}</span>
        <code style={{ color: "#94a3b8" }}>first</code><span>→ pass first upstream value</span>
      </div>
    </div>
  );
  if (type === "action.switch") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      Output: <code style={{ color: "#a78bfa" }}>{"{ value, matched_case, matched_index, no_match }"}</code><br />
      <div style={{ color: "#64748b", marginTop: 3 }}>Cases matched in order — first match wins. <code>no_match: true</code> if nothing matched.</div>
    </div>
  );
  if (type === "action.aggregate") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ ...grid2 }}>
        <code style={{ color: "#4ade80" }}>list</code><span>→ {"{ items:[...], count }"}</span>
        <code style={{ color: "#60a5fa" }}>dict</code><span>→ merged object</span>
        <code style={{ color: "#94a3b8" }}>concat</code><span>→ {"{ result: '...', count }"}</span>
      </div>
    </div>
  );
  if (type === "action.date") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      Output: <code style={{ color: "#a78bfa" }}>{"{ iso, unix, formatted, year, month, day, hour, minute, second, weekday }"}</code><br />
      <code>diff</code>: <code style={{ color: "#a78bfa" }}>{"{ seconds, minutes, hours, days, human, past }"}</code>
    </div>
  );
  if (type === "action.discord") return (
    <div style={{ ...hintBox }}>
      Output: <code style={{ color: "#a78bfa" }}>{"{ sent: true, message }"}</code>
    </div>
  );
  if (type === "action.csv") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ ...grid2 }}>
        <code style={{ color: "#4ade80" }}>parse</code><span>→ {"{ rows, count, headers }"}</span>
        <code style={{ color: "#60a5fa" }}>generate</code><span>→ {"{ csv, count }"}</span>
      </div>
    </div>
  );
  if (type === "action.http_request") return (
    <div style={{ ...hintBox }}>
      Output: <code style={{ color: "#a78bfa" }}>{"{ status, ok, body, headers }"}</code>
    </div>
  );
  if (type === "trigger.rss") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ color: "#ea580c", fontWeight: 600, marginBottom: 4 }}>📡 RSS / Atom</div>
      No dependencies — uses Python stdlib xml.etree + urllib.<br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#4ade80" }}>entries[]</code><span>→ title, link, published, summary, author, id</span>
        <code style={{ color: "#60a5fa" }}>count</code><span>→ number of matching entries</span>
        <code style={{ color: "#a78bfa" }}>title/link/summary</code><span>→ first-entry shortcuts</span>
        <code style={{ color: "#f59e0b" }}>feed_title</code><span>→ name of the feed</span>
      </div>
    </div>
  );
  if (type === "action.pdf") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ color: "#b91c1c", fontWeight: 600, marginBottom: 4 }}>📋 PDF Generate</div>
      Renders HTML to PDF using xhtml2pdf (pure Python, no system binaries).<br />
      Output: <code style={{ color: "#a78bfa" }}>{"{ pdf_bytes (base64), size_bytes, filename, ok }"}</code><br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#60a5fa" }}>pdf_bytes</code><span>→ base64 string, pass to S3 put or email attachment</span>
        <code style={{ color: "#4ade80" }}>size_bytes</code><span>→ raw byte count of generated PDF</span>
      </div>
    </div>
  );
  if (type === "action.graphql") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ color: "#e535ab", fontWeight: 600, marginBottom: 4 }}>◈ GraphQL</div>
      Credential fields: <code style={{ color: "#a78bfa" }}>endpoint</code>, <code style={{ color: "#a78bfa" }}>token</code>.<br />
      Template rendering supported in query + variables.<br />
      Output: <code style={{ color: "#a78bfa" }}>{"{ data, errors[], has_errors, status_code, ok }"}</code>
    </div>
  );
  if (type === "action.airtable") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ color: "#f59e0b", fontWeight: 600, marginBottom: 4 }}>🟧 Airtable</div>
      Credential: <code style={{ color: "#a78bfa" }}>api_key</code> (pat…) + <code style={{ color: "#a78bfa" }}>base_id</code> (app…).<br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#4ade80" }}>list_records</code><span>→ {"{ records[], count, record }"}</span>
        <code style={{ color: "#60a5fa" }}>get_record</code><span>→ {"{ record, id, fields }"}</span>
        <code style={{ color: "#a78bfa" }}>create_record</code><span>→ {"{ id, fields, created: true }"}</span>
        <code style={{ color: "#f59e0b" }}>update_record</code><span>→ {"{ id, fields, updated: true }"}</span>
        <code style={{ color: "#94a3b8" }}>upsert_record</code><span>→ create or update on field match</span>
        <code style={{ color: "#f87171" }}>delete_record</code><span>→ {"{ id, deleted: true }"}</span>
      </div>
    </div>
  );
  if (type === "action.redis") return (
    <div style={{ ...hintBox, lineHeight: 1.8 }}>
      <div style={{ color: "#dc2626", fontWeight: 600, marginBottom: 4 }}>🟥 Redis</div>
      Credential url: <code style={{ color: "#a78bfa" }}>redis://[:pass@]host:6379/0</code><br />
      <div style={{ ...grid2, marginTop: 4 }}>
        <code style={{ color: "#4ade80" }}>get</code><span>→ {"{ value, key, exists }"}</span>
        <code style={{ color: "#4ade80" }}>set</code><span>→ {"{ ok, key, value }"} (set ttl for expiry)</span>
        <code style={{ color: "#60a5fa" }}>incr/decr</code><span>→ {"{ value, key }"}</span>
        <code style={{ color: "#a78bfa" }}>lpush/rpop</code><span>→ {"{ length/value, key }"}</span>
        <code style={{ color: "#f59e0b" }}>smembers</code><span>→ {"{ members[], count }"}</span>
        <code style={{ color: "#94a3b8" }}>hgetall</code><span>→ {"{ data{}, count }"}</span>
        <code style={{ color: "#64748b" }}>lrange</code><span>→ {"{ items[], count }"}</span>
      </div>
    </div>
  );
  return null;
}

// ── NodeEditorModal ────────────────────────────────────────────────────────────
/**
 * Full-screen slide-in node editor (n8n-style 3-column layout).
 * Left: upstream INPUT   Centre: CONFIG   Right: OUTPUT
 */
export function NodeEditorModal({
  node, onChange, onDelete, onClose,
  edges, allNodes, credentials,
  onTestNode, onPinOutput, currentGraph,
}) {
  const isNote      = node.data.type === "note";
  const isTrigger   = node.data.type?.startsWith("trigger.");
  const def         = NODE_DEFS[node.data.type] || { label: node.data.type, icon: "?", color: "#475569", fields: [] };
  const isDisabled  = !!node.data.disabled;
  const runStatus   = node.data._runStatus;
  const runOutput   = node.data._runOutput;
  const runInput    = node.data._runInput;
  const runDurationMs = node.data._runDurationMs;
  const runAttempts = node.data._runAttempts;
  const retryMax    = node.data.retry_max  ?? 0;
  const retryDelay  = node.data.retry_delay ?? 5;
  const failMode    = node.data.fail_mode  || "abort";

  const upstreamNodeId = useMemo(() => {
    if (!edges || !node) return null;
    const e = edges.find(e => e.target === node.id);
    return e ? e.source : null;
  }, [edges, node?.id]);

  const vars = useMemo(
    () => buildVarList(node.id, allNodes || [], edges || [], credentials || []),
    [node.id, allNodes, edges, credentials],
  );

  const [inputView,   setInputView]   = useState("schema");
  const [outputView,  setOutputView]  = useState("schema");
  const [testOpen,    setTestOpen]    = useState(false);
  const [testInput,   setTestInput]   = useState("{}");
  const [testLoading, setTestLoading] = useState(false);
  const [testError,   setTestError]   = useState(null);

  const isPinned = !!node.data._pinnedOutput;

  const upstreamNode = useMemo(() => {
    if (!edges || !allNodes) return null;
    const e = edges.find(e => e.target === node.id);
    if (!e) return null;
    return allNodes.find(n => n.id === e.source) || null;
  }, [edges, allNodes, node.id]);

  const upstreamPinned   = upstreamNode?.data?._pinnedOutput;
  const upstreamLabel    = upstreamNode?.data?.label || upstreamNode?.data?.type || null;
  const upstreamPinnedRef = useRef(upstreamPinned);
  upstreamPinnedRef.current = upstreamPinned;

  const displayInput = useMemo(() => {
    if (testOpen) {
      try { return JSON.parse(testInput); } catch { return upstreamPinned || runInput; }
    }
    return runInput;
  }, [testOpen, testInput, upstreamPinned, runInput]);

  useEffect(() => {
    if (!testOpen) return;
    const pinned = upstreamPinnedRef.current;
    if (pinned) setTestInput(JSON.stringify(pinned, null, 2));
    else        setTestInput("{}");
  }, [testOpen, node.id, upstreamNode?.id]);

  useEffect(() => {
    const h = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  function update(key, val)          { onChange(node.id, { ...node.data, config: { ...node.data.config, [key]: val } }); }
  function updateLabel(val)          { onChange(node.id, { ...node.data, label: val }); }
  function updateRetryMax(val)       { onChange(node.id, { ...node.data, retry_max:   parseInt(val) || 0 }); }
  function updateRetryDelay(val)     { onChange(node.id, { ...node.data, retry_delay: parseInt(val) || 5 }); }
  function updateFailMode(val)       { onChange(node.id, { ...node.data, fail_mode: val }); }
  function toggleDisabled()          { onChange(node.id, { ...node.data, disabled: !isDisabled }); }
  function copyId()                  { navigator.clipboard.writeText(node.id).catch(() => {}); }

  function dropProps(fieldKey, currentVal) {
    return {
      onDragOver:  e => { e.preventDefault(); e.currentTarget.classList.add("drag-over"); },
      onDragLeave: e => e.currentTarget.classList.remove("drag-over"),
      onDrop: e => {
        e.preventDefault();
        e.currentTarget.classList.remove("drag-over");
        const tmpl = e.dataTransfer.getData("text/plain");
        if (!tmpl) return;
        const el    = e.currentTarget;
        const start = el.selectionStart ?? (currentVal || "").length;
        const end   = el.selectionEnd   ?? start;
        const newVal = (currentVal || "").slice(0, start) + tmpl + (currentVal || "").slice(end);
        update(fieldKey, newVal);
        setTimeout(() => { try { el.selectionStart = el.selectionEnd = start + tmpl.length; } catch (e) {} }, 0);
      },
    };
  }

  const statusLabel = runStatus === "ok" ? "Succeeded" : runStatus === "err" ? "Failed" : runStatus === "skip" ? "Skipped" : null;
  const statusCls   = runStatus === "ok" ? "run-status-ok" : runStatus === "err" ? "run-status-err" : "run-status-skip";

  return (
    <div className="nem-overlay">
      {/* Backdrop is pointer-events:none so canvas stays interactive.
          Click the ✕ button or press Escape to close. */}
      <div className="nem-backdrop" />
      <div className="nem-panel">

        {/* Header */}
        <div className="nem-hdr">
          <span className="nem-hdr-icon">{def.icon}</span>
          <span className="nem-hdr-title">{node.data.label || def.label}</span>
          {statusLabel && (
            <span className={`run-output-status ${statusCls}`} style={{ fontSize: 10, flexShrink: 0 }}>{statusLabel}</span>
          )}
          {runDurationMs !== undefined && (
            <span style={{ fontSize: 10, color: "var(--text-muted-2)", flexShrink: 0 }}>{runDurationMs}ms</span>
          )}
          {isPinned && (
            <span title="Output is pinned — downstream test nodes will use this as input"
              style={{ fontSize: 11, color: "var(--warn)", flexShrink: 0, cursor: "default" }}>
              📌 Pinned
            </span>
          )}
          <button className="nem-hdr-close" onClick={onClose}>✕</button>
        </div>

        {/* Three columns */}
        <div className="nem-columns">

          {/* ── LEFT: INPUT ── */}
          <div className="nem-io-col left">
            <div className="nem-io-col-hdr">
              ← Input
              {upstreamNodeId && <span className="nem-drag-hint">drag → config field</span>}
            </div>
            <div className="nem-io-view-tabs">
              <button className={`nem-io-view-tab${inputView === "schema" ? " active" : ""}`} onClick={() => setInputView("schema")}>Schema</button>
              <button className={`nem-io-view-tab${inputView === "json"   ? " active" : ""}`} onClick={() => setInputView("json")}>JSON</button>
            </div>
            <div className="nem-io-col-body">
              <NioBody
                data={displayInput}
                view={inputView}
                sourceNodeId={upstreamNodeId}
                isTruncated={!!(displayInput && displayInput.__truncated)}
              />
            </div>
          </div>

          {/* ── CENTRE: CONFIG ── */}
          <div className="nem-cfg-col">

            {/* Node ID badge */}
            <div className="node-id-badge" onClick={copyId} title="Click to copy" style={{ marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted-2)", marginBottom: 2 }}>NODE ID (for templates)</div>
                <code>{node.id}</code>
              </div>
              <span className="copy-hint">📋 copy</span>
            </div>

            {/* Enable/disable toggle */}
            {!isNote && (
              <div className="disable-toggle-row">
                <span className="disable-toggle-label">{isDisabled ? "⏸ Node disabled" : "▶ Node enabled"}</span>
                <label className="toggle-switch">
                  <input type="checkbox" checked={!isDisabled} onChange={toggleDisabled} />
                  <div className="toggle-track" />
                  <div className="toggle-thumb" />
                </label>
              </div>
            )}

            {/* Label */}
            {!isNote && (
              <>
                <div className="section-divider">Label</div>
                <div className="field-group">
                  <input
                    className="field-input"
                    placeholder={def.label}
                    value={node.data.label || ""}
                    onChange={e => updateLabel(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Config fields */}
            {def.fields.length > 0 && <div className="section-divider">Config</div>}
            {def.fields.map(f => {
              const cfgVal          = (node.data.config || {})[f.k] || "";
              const dp              = (!f.secret && f.type !== "select") ? dropProps(f.k, cfgVal) : {};
              const useAutocomplete = !f.secret && f.type !== "select";
              return (
                <div className="field-group" key={f.k}>
                  <div className="field-label">
                    {f.l}
                    {f.secret && <span className="field-hint">🔒 sensitive</span>}
                  </div>
                  {f.type === "select" ? (
                    <select
                      className="field-input"
                      value={cfgVal || f.options[0]}
                      onChange={e => update(f.k, e.target.value)}
                    >
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : useAutocomplete ? (
                    <VarField
                      multiline={!!f.textarea}
                      rows={4}
                      className={`field-input${f.mono ? " mono" : ""}`}
                      placeholder={f.ph}
                      value={cfgVal}
                      onChangeValue={v => update(f.k, v)}
                      vars={vars}
                      {...dp}
                    />
                  ) : (
                    <input
                      className={`field-input${f.mono ? " mono" : ""}`}
                      placeholder={f.ph}
                      type="password"
                      value={cfgVal}
                      onChange={e => update(f.k, e.target.value)}
                    />
                  )}
                  {f.secret && (
                    <span className="secret-hint">
                      💡 Or use {"{{creds.your-credential-name}}"}
                    </span>
                  )}
                </div>
              );
            })}

            {/* Node-type hint panels */}
            <NodeHints type={node.data.type} currentGraph={currentGraph} nodeConfig={node.data.config || {}} />

            {/* Retry Policy */}
            {!isNote && !isTrigger && (
              <>
                <div className="section-divider">Retry Policy</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="field-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4, display: "block" }}>
                      Max retries
                    </label>
                    <input
                      className="field-input"
                      type="number" min="0" max="5"
                      value={retryMax}
                      onChange={e => updateRetryMax(e.target.value)}
                    />
                  </div>
                  <div className="field-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4, display: "block" }}>
                      Retry delay (sec)
                    </label>
                    <input
                      className="field-input"
                      type="number" min="1" max="60"
                      value={retryDelay}
                      onChange={e => updateRetryDelay(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field-group" style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginBottom: 4, display: "block" }}>
                    On failure
                  </label>
                  <select className="field-input" value={failMode} onChange={e => updateFailMode(e.target.value)}>
                    <option value="abort">abort — stop the graph (default)</option>
                    <option value="continue">continue — store error, keep going</option>
                  </select>
                  {failMode === "continue" && (
                    <div style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>
                      ⚠ Downstream nodes receive {"{ __error, __node, __type }"} as input.
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Test panel */}
            {!isNote && onTestNode && (
              <div style={{ marginTop: 16 }}>
                <button
                  className="btn btn-sm"
                  style={{
                    width: "100%", background: "var(--info-soft)", color: "var(--info)",
                    border: "1px solid var(--info-border)", borderRadius: 6, padding: "6px 0",
                    fontWeight: 600, cursor: "pointer",
                  }}
                  onClick={() => { setTestOpen(o => !o); setTestError(null); }}
                >
                  {testOpen ? "▼ Test node" : "▶ Test node"}
                </button>

                {testOpen && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Input JSON</label>
                      {upstreamPinned && (
                        <span style={{ fontSize: 10, color: "var(--warn)" }}>
                          📌 from {upstreamLabel}
                          <button
                            onClick={() => {
                              const p = upstreamPinnedRef.current;
                              if (p) setTestInput(JSON.stringify(p, null, 2));
                            }}
                            style={{
                              marginLeft: 4, fontSize: 10, color: "var(--warn)",
                              background: "none", border: "none", cursor: "pointer",
                              padding: 0, textDecoration: "underline",
                            }}
                          >reset</button>
                        </span>
                      )}
                    </div>
                    <textarea
                      value={testInput}
                      onChange={e => { setTestInput(e.target.value); setTestError(null); }}
                      rows={4}
                      spellCheck={false}
                      style={{
                        width: "100%", background: "var(--bg-soft)", color: "var(--text)",
                        border: "1px solid var(--border-strong)", borderRadius: 4, padding: "6px 8px",
                        fontFamily: "monospace", fontSize: 12, resize: "vertical", boxSizing: "border-box",
                      }}
                    />
                    {testError && <div style={{ fontSize: 11, color: "#f87171" }}>{testError}</div>}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        className="btn btn-sm"
                        disabled={testLoading}
                        style={{
                          flex: 1, background: "var(--success-soft)", color: "var(--success)",
                          border: "1px solid var(--success-border)", borderRadius: 6, padding: "5px 0",
                          fontWeight: 600, cursor: testLoading ? "not-allowed" : "pointer",
                          opacity: testLoading ? 0.7 : 1,
                        }}
                        onClick={async () => {
                          let inp;
                          try { inp = JSON.parse(testInput); }
                          catch (e) { setTestError("Invalid JSON: " + e.message); return; }
                          setTestLoading(true);
                          setTestError(null);
                          await onTestNode(node.id, inp);
                          setTestLoading(false);
                        }}
                      >
                        {testLoading ? "Running…" : "▶ Run"}
                      </button>
                      {runOutput && runStatus === "ok" && onPinOutput && (
                        <button
                          className="btn btn-sm"
                          title={isPinned ? "Unpin output" : "Pin output — downstream nodes will use this as their test input"}
                          style={{
                            background: isPinned ? "var(--warn-soft)" : "var(--bg-elev-2)",
                            color:      isPinned ? "var(--warn)" : "var(--text-muted-2)",
                            border:     `1px solid ${isPinned ? "var(--warn-border)" : "var(--border-strong)"}`,
                            borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 14,
                          }}
                          onClick={() => onPinOutput(node.id, isPinned ? null : runOutput)}
                        >
                          📌
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              className="delete-node-btn"
              style={{ marginTop: 16 }}
              onClick={() => { onDelete(node.id); onClose(); }}
            >
              🗑 Remove node
            </button>
          </div>

          {/* ── RIGHT: OUTPUT ── */}
          <div className="nem-io-col right">
            <div className="nem-io-col-hdr">Output →</div>
            <div className="nem-io-view-tabs">
              <button className={`nem-io-view-tab${outputView === "schema" ? " active" : ""}`} onClick={() => setOutputView("schema")}>Schema</button>
              <button className={`nem-io-view-tab${outputView === "json"   ? " active" : ""}`} onClick={() => setOutputView("json")}>JSON</button>
            </div>
            <div className="nem-io-col-body">
              <NioBody
                data={runOutput}
                view={outputView}
                sourceNodeId={node.id}
                isTruncated={!!(runOutput && runOutput.__truncated)}
              />
            </div>
          </div>

        </div>{/* end nem-columns */}
      </div>{/* end nem-panel */}
    </div>
  );
}

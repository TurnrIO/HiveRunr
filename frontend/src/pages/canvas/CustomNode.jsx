import { useContext } from "react";
import { Handle, Position } from "reactflow";
import { NODE_DEFS } from "./nodeDefs.js";
import { StickyNote } from "./StickyNote.jsx";
import { ValidationContext } from "./CanvasApp.jsx";

export function CustomNode({ id, data, selected }) {
  if (data.type === "note") return <StickyNote id={id} data={data} selected={selected} />;

  const validationMap = useContext(ValidationContext);
  const issues = validationMap.get(id) || [];

  const def        = NODE_DEFS[data.type] || { label: data.type, icon: "?", color: "#475569" };
  const isCondition = data.type === "action.condition";
  const isLoop      = data.type === "action.loop";
  const isTrigger   = data.type?.startsWith("trigger.");
  const isDisabled  = !!data.disabled;
  const runStatus   = data._runStatus;  // "ok" | "err" | "skip" | "pending" | "unreached"
  const runOutput   = data._runOutput;
  const runDuration = data._runDurationMs;

  const isCron    = data.type === "trigger.cron";
  const cronExpr  = isCron ? ((data.config || {}).cron || "not set") : null;
  const cronDesc  = isCron ? ((data.config || {}).description || null) : null;
  const summary   = isCron ? null : Object.entries(data.config || {})
    .filter(([k, v]) => v && !["smtp_pass", "api_key", "bot_token"].includes(k))
    .map(([k, v]) => `${k}: ${String(v).slice(0, 22)}`).join(" · ").slice(0, 55);

  return (
    <div
      className={
        `custom-node${selected ? " selected" : ""}${isDisabled ? " disabled-node" : ""}${runStatus === "pending" ? " node-running" : ""}`
      }
      style={{ borderColor: selected ? def.color : undefined }}
    >
      {!isTrigger && (
        <Handle type="target" position={Position.Left} style={{ background: def.color }} />
      )}
      <div className="node-header">
        <div className="nh-icon" style={{ background: def.color + "22", color: def.color }}>
          {def.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="nh-title">{data.label || def.label}</div>
          <div className="nh-type">{data.type}</div>
        </div>
        {isDisabled && <span className="node-off-chip">OFF</span>}
      </div>

      {isCron ? (
        <div className="node-body" style={{ padding: "5px 10px 6px" }}>
          <div style={{
            fontFamily: "'JetBrains Mono','Fira Code',monospace",
            fontSize: 11, color: "#a78bfa", letterSpacing: ".03em",
          }}>
            {cronExpr}
          </div>
          {cronDesc && (
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{cronDesc}</div>
          )}
        </div>
      ) : summary ? (
        <div className="node-body">{summary}</div>
      ) : null}

      <div className="node-footer">
        <span className="node-id">#{id}</span>
        {issues.length > 0 && !runStatus && (
          <span
            className="node-validation-badge"
            title={issues.map(i => i.msg).join("\n")}
          >
            ⚠ {issues.length}
          </span>
        )}
        {runStatus && (
          <span className={`node-status-badge ${runStatus}`}>
            {runStatus === "ok"        ? "✓"
            : runStatus === "err"      ? "✗"
            : runStatus === "pending"  ? "⟳"
            : runStatus === "unreached"? "?"
            : "—"}
            {runStatus === "ok" && runDuration != null ? ` ${runDuration}ms` : ""}
            {runStatus === "err"       ? " err"       : ""}
            {runStatus === "skip"      ? " skip"      : ""}
            {runStatus === "unreached" ? " not reached" : ""}
          </span>
        )}
      </div>

      {isCondition ? (
        <>
          <Handle type="source" position={Position.Right} id="true"  style={{ top: "35%", background: "#059669" }} />
          <Handle type="source" position={Position.Right} id="false" style={{ top: "65%", background: "#dc2626" }} />
        </>
      ) : isLoop ? (
        <>
          <Handle type="source" position={Position.Right}  id="body" style={{ top: "35%", background: def.color }} title="Loop body" />
          <Handle type="source" position={Position.Bottom} id="done" style={{ background: "#64748b" }} title="After loop" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} style={{ background: def.color }} />
      )}
    </div>
  );
}

export const nodeTypes = { custom: CustomNode };

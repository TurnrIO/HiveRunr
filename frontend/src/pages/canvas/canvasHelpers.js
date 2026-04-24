/**
 * canvasHelpers.js
 * Pure utility functions shared across canvas components.
 * No React imports — safe to import anywhere.
 */

// ── Template-name detection ────────────────────────────────────────────────────
const TEMPLATE_EMOJIS = /^[📧🤖🔄⚠🔍📊⚡🧪🐍⏰💻📁]/u;
export function isTemplate(name) {
  return TEMPLATE_EMOJIS.test(name);
}

// ── Auto-layout (BFS column assignment) ───────────────────────────────────────
export function computeAutoLayout(nodes, edges) {
  const ids  = nodes.map(n => n.id);
  const indeg = Object.fromEntries(ids.map(id => [id, 0]));
  const succ  = Object.fromEntries(ids.map(id => [id, []]));

  edges.forEach(e => {
    if (succ[e.source] !== undefined && indeg[e.target] !== undefined) {
      succ[e.source].push(e.target);
      indeg[e.target]++;
    }
  });

  const depth   = Object.fromEntries(ids.map(id => [id, 0]));
  const visited = new Set();
  const queue   = ids.filter(id => indeg[id] === 0);

  while (queue.length) {
    const n = queue.shift();
    if (visited.has(n)) continue;
    visited.add(n);
    (succ[n] || []).forEach(nb => {
      depth[nb] = Math.max(depth[nb], depth[n] + 1);
      indeg[nb]--;
      if (indeg[nb] === 0) queue.push(nb);
    });
  }

  const cols = {};
  ids.forEach(id => {
    const d = depth[id] || 0;
    if (!cols[d]) cols[d] = [];
    cols[d].push(id);
  });

  const COL_W = 265, ROW_H = 130, PAD_X = 60, PAD_Y = 80;
  const newPos = {};
  Object.entries(cols).forEach(([col, nodeIds]) => {
    const c = parseInt(col);
    nodeIds.forEach((id, row) => {
      newPos[id] = { x: PAD_X + c * COL_W, y: PAD_Y + row * ROW_H };
    });
  });

  return nodes.map(n => ({ ...n, position: newPos[n.id] || n.position }));
}

// ── Flow validation ────────────────────────────────────────────────────────────
export const REQUIRED_FIELDS = {
  "trigger.cron":         ["cron"],
  "trigger.email":        ["credential"],
  "trigger.rss":          ["url"],
  "action.http_request":  ["url"],
  "action.send_email":    ["to", "subject"],
  "action.ssh":           ["host", "command"],
  "action.sftp":          ["host", "remote_path"],
  "action.call_graph":    ["graph_id"],
  "action.slack":         ["message"],
  "action.discord":       ["message"],
  "action.telegram":      ["chat_id", "text"],
  "action.llm_call":      ["prompt"],
  "action.run_script":    ["script"],
  "action.transform":     ["expression"],
  "action.condition":     ["expression"],
  "action.github":        ["repo", "action"],
  "action.google_sheets": ["spreadsheet_id", "action"],
  "action.notion":        ["action"],
  "action.postgres":      ["query"],
  "action.mysql":         ["query"],
  "action.mongodb":       ["database", "collection", "operation"],
  "action.s3":            ["bucket", "operation"],
  "action.airtable":      ["operation"],
  "action.hubspot":       ["operation"],
  "action.jira":          ["operation"],
  "action.twilio":        ["operation"],
  "action.graphql":       ["query"],
  "action.redis":         ["operation"],
  "action.pdf":           ["html"],
  "action.wait_for_approval": ["to"],
};

/**
 * Compute validation issues for a SINGLE node.
 * Returns an array of { level: "error"|"warning", msg: string }.
 * Pass credNames as a Set<string> for credential checking.
 */
export function nodeIssues(node, edges, credNames) {
  if (!node.data || node.data.type === "note" || node.data.disabled) return [];
  const issues    = [];
  const label     = node.data.label || node.data.type || node.id;
  const isTrigger = node.data.type?.startsWith("trigger.");
  const cfg       = node.data.config || {};
  const creds     = credNames instanceof Set ? credNames : new Set(credNames || []);

  // Disconnected non-trigger node
  const connectedIds = new Set([...edges.map(e => e.source), ...edges.map(e => e.target)]);
  if (!isTrigger && !connectedIds.has(node.id))
    issues.push({ level: "warning", msg: "Not connected to any other node" });

  // Required fields
  (REQUIRED_FIELDS[node.data.type] || []).forEach(f => {
    if (!cfg[f] || !String(cfg[f]).trim())
      issues.push({ level: "warning", msg: `Required field "${f}" is empty` });
  });

  // Credential field by name (when a "credential" field is used)
  const credField = cfg.credential;
  if (credField && credField.trim() && !creds.has(credField.trim()))
    issues.push({ level: "warning", msg: `Credential "${credField}" not found` });

  // Inline {{creds.name}} references
  const configStr = JSON.stringify(cfg);
  [...configStr.matchAll(/\{\{creds\.([^.}]+)\.[^}]*\}\}/g)].forEach(m => {
    const name = m[1].trim();
    if (!creds.has(name))
      issues.push({ level: "warning", msg: `Credential "{{creds.${name}…}}" not found` });
  });

  return issues;
}

export function validateFlow(nodes, edges, credentials) {
  const issues   = [];
  const triggers = nodes.filter(n => n.data.type?.startsWith("trigger.") && !n.data.disabled);
  const credNames = new Set((credentials || []).map(c => c.name));

  if (triggers.length === 0)
    issues.push({ level: "error", msg: "No trigger node — the flow can't start" });

  nodes.forEach(node => {
    if (node.data.type === "note" || node.data.disabled) return;
    const label = node.data.label || node.data.type || node.id;
    nodeIssues(node, edges, credNames).forEach(iss =>
      issues.push({ ...iss, msg: `"${label}" — ${iss.msg}` })
    );
  });

  return issues;
}

// ── Variable autocomplete helpers ──────────────────────────────────────────────
export function flattenVarPaths(obj, nodeId, nodeLabel, prefix, depth) {
  prefix = prefix || "";
  depth  = depth  || 0;
  const results = [];
  if (!obj || typeof obj !== "object" || depth > 3) return results;

  if (Array.isArray(obj)) {
    obj.slice(0, 2).forEach((item, i) => {
      const p = prefix ? `${prefix}[${i}]` : `[${i}]`;
      results.push({ template: `{{${nodeId}.${p}}}`, label: p, nodeLabel });
      results.push(...flattenVarPaths(item, nodeId, nodeLabel, p, depth + 1));
    });
    return results;
  }

  for (const k of Object.keys(obj)) {
    if (k.startsWith("__")) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    results.push({ template: `{{${nodeId}.${p}}}`, label: p, nodeLabel });
    if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k]))
      results.push(...flattenVarPaths(obj[k], nodeId, nodeLabel, p, depth + 1));
  }
  return results;
}

export function buildVarList(targetNodeId, allNodes, edges, credentials) {
  const vars = [];

  const upstreamIds = edges.filter(e => e.target === targetNodeId).map(e => e.source);
  for (const upId of upstreamIds) {
    const upNode   = allNodes.find(n => n.id === upId);
    if (!upNode) continue;
    const nodeLabel = upNode.data.label || upNode.data.type || upId;
    const output    = upNode.data._runOutput;
    if (output && !output.__truncated && typeof output === "object") {
      const paths = flattenVarPaths(output, upId, nodeLabel, "", 0);
      vars.push(...paths);
      if (!paths.length)
        vars.push({ template: `{{${upId}}}`, label: "(output)", nodeLabel });
    } else {
      vars.push({ template: `{{${upId}}}`, label: "(run flow to see fields)", nodeLabel, dimmed: true });
    }
  }

  if (credentials && credentials.length) {
    for (const c of credentials)
      vars.push({ template: `{{creds.${c.name}}}`, label: `creds.${c.name}`, nodeLabel: "Credentials", isCred: true });
  }
  return vars;
}

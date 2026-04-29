import { useState, useEffect, useRef, useCallback, createContext, useContext, useMemo } from "react";
import ReactFlow, {
  ReactFlowProvider, addEdge, Background, Controls, MiniMap,
  useNodesState, useEdgesState, useReactFlow,
  MarkerType, BackgroundVariant, SelectionMode,
} from "reactflow";
import "reactflow/dist/style.css";

import { api } from "../../api/client.js";
import { Toast }            from "../../components/Toast.jsx";
import { ConfirmModal }     from "../../components/ConfirmModal.jsx";
import { ReplayEditModal }  from "../../components/ReplayEditModal.jsx";
import { nodeTypes }        from "./CustomNode.jsx";
import { NODE_DEFS }        from "./nodeDefs.js";
import { Palette }          from "./Palette.jsx";
import { ConfigPanel }      from "./ConfigPanel.jsx";
import { NodeContextMenu }  from "./NodeContextMenu.jsx";
import { NodeEditorModal }  from "./NodeEditorModal.jsx";
import { OpenModal }        from "./OpenModal.jsx";
import { TestPayloadModal } from "./TestPayloadModal.jsx";
import { ValidationModal }  from "./ValidationModal.jsx";
import { HistoryModal }     from "./HistoryModal.jsx";
import { PermissionsModal } from "./PermissionsModal.jsx";
import { ShortcutsModal }     from "./ShortcutsModal.jsx";
import { NodeSearchBar }      from "./NodeSearchBar.jsx";
import { AlignmentToolbar }     from "./AlignmentToolbar.jsx";
import { ExtractSubflowModal }  from "./ExtractSubflowModal.jsx";
import { EdgeLabelModal }   from "./EdgeLabelModal.jsx";
import { validateFlow, computeAutoLayout, nodeIssues } from "./canvasHelpers.js";

/** Per-node validation issues — Map<nodeId, {level,msg}[]> */
export const ValidationContext = createContext(new Map());

const QUICK_START_TEMPLATES = [
  { slug: "email_to_slack", icon: "📧", label: "Email → Slack" },
  { slug: "webhook_to_notion", icon: "🔗", label: "Webhook → Notion" },
  { slug: "sheets_to_slack_report", icon: "⏰", label: "Sheets report" },
  { slug: "csv_to_db", icon: "🔄", label: "CSV → Database" },
];

/* ── RFC 4122 v4 UUID ──────────────────────────────────────────────────── */
function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ── Edge style helpers ─────────────────────────────────────────────────── */
const EDGE_STYLE = {
  type: "smoothstep", animated: true,
  style: { stroke: "#7c3aed", strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, color: "#7c3aed" },
};
function styledEdge(e) { return { ...e, ...EDGE_STYLE }; }

const EDGE_OVERLAY = {
  ok:        { stroke: "#4ade80", strokeWidth: 2.5, opacity: 1,   animated: true  },
  err:       { stroke: "#f87171", strokeWidth: 2.5, opacity: 1,   animated: false },
  skip:      { stroke: "#4b5563", strokeWidth: 1.5, opacity: 0.4, animated: false },
  unreached: { stroke: "#2a2d3e", strokeWidth: 1.5, opacity: 0.3, animated: false },
};

/** Apply a traceMap to nodes + edges, returning updated arrays.
 *  Nodes not present in traceMap are marked "unreached".
 *  Edges are coloured based on their source node's outcome. */
function overlayTrace(nodes, edges, traceMap) {
  const nodeStatus = {};   // id → "ok" | "err" | "skip" | "unreached"
  const updatedNodes = nodes.map(n => {
    if (n.data.type === "note") return n;
    const t = traceMap[n.id];
    let st;
    if (t) {
      st = t.status === "ok" ? "ok" : t.status === "error" ? "err" : "skip";
    } else {
      st = "unreached";
    }
    nodeStatus[n.id] = st;
    return { ...n, data: { ...n.data, _runStatus: st, _runOutput: t?.output, _runInput: t?.input, _runDurationMs: t?.duration_ms, _runAttempts: t?.attempts } };
  });
  const updatedEdges = edges.map(e => {
    const srcSt = nodeStatus[e.source] || "unreached";
    const ov    = EDGE_OVERLAY[srcSt];
    return {
      ...e,
      animated: ov.animated,
      style: { ...EDGE_STYLE.style, stroke: ov.stroke, strokeWidth: ov.strokeWidth, opacity: ov.opacity },
      markerEnd: { type: MarkerType.ArrowClosed, color: ov.stroke },
    };
  });
  return { nodes: updatedNodes, edges: updatedEdges };
}

/** Reset all overlay state on nodes + edges back to defaults. */
function clearOverlay(nodes, edges) {
  return {
    nodes: nodes.map(n => ({ ...n, data: { ...n.data, _runStatus: undefined, _runOutput: undefined, _runInput: undefined, _runDurationMs: undefined } })),
    edges: edges.map(styledEdge),
  };
}

/* ── Run overlay summary bar ────────────────────────────────────────────── */
function RunOverlayBar({ run, nodes, onClear }) {
  if (!run) return null;
  const counts = { ok: 0, err: 0, skip: 0, unreached: 0 };
  nodes.forEach(n => { if (n.data.type !== "note" && n.data._runStatus) counts[n.data._runStatus] = (counts[n.data._runStatus] || 0) + 1; });
  const statusColor = run.status === "succeeded" ? "#4ade80" : run.status === "failed" ? "#f87171" : "#60a5fa";
  return (
    <div style={{
      position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)",
      zIndex: 10, display: "flex", alignItems: "center", gap: 8,
      background: "#13152aee", border: "1px solid #2a2d3e", borderRadius: 20,
      padding: "5px 14px 5px 10px", boxShadow: "0 4px 16px #0006",
      fontSize: 12, pointerEvents: "auto",
    }}>
      <span style={{ color: "#64748b", fontSize: 11 }}>Run</span>
      <span style={{ fontWeight: 700, color: "#e2e8f0" }}>#{run.id}</span>
      <span style={{ fontWeight: 600, color: statusColor, fontSize: 11 }}>{run.status}</span>
      <span style={{ color: "#4ade80" }}>✓ {counts.ok}</span>
      {counts.err > 0    && <span style={{ color: "#f87171" }}>✗ {counts.err}</span>}
      {counts.skip > 0   && <span style={{ color: "#94a3b8" }}>— {counts.skip}</span>}
      {counts.unreached > 0 && <span style={{ color: "#374151" }}>? {counts.unreached}</span>}
      <button onClick={onClear} title="Clear overlay" style={{
        background: "none", border: "none", cursor: "pointer", color: "#64748b",
        fontSize: 13, padding: "0 0 0 4px", lineHeight: 1,
      }}>✕</button>
    </div>
  );
}

/* ── Node loader ───────────────────────────────────────────────────────── */
function loadNode(n) {
  return {
    id: n.id, type: "custom",
    position: n.position || { x: 100, y: 100 },
    ...(n.type === "note" ? { zIndex: -1 } : {}),
    data: {
      type:        n.type,
      label:       n.data?.label || "",
      config:      n.data?.config || {},
      disabled:    !!n.data?.disabled,
      retry_max:   n.data?.retry_max   || 0,
      retry_delay: n.data?.retry_delay || 5,
      fail_mode:   n.data?.fail_mode   || "abort",
    },
  };
}

/* ── MoreMenu ──────────────────────────────────────────────────────────── */
function MoreMenu({
  onExport, onImport, onLayout, onValidate, onHistory, onPermissions,
  onTest, onAdmin, onUndo, onRedo, undoDisabled, redoDisabled,
  onShortcuts, onToggleMap, showMap, onSearch, onSaveWithNote, isAdmin, disabled,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function close(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  function act(fn) { setOpen(false); setTimeout(fn, 0); }
  return (
    <div className="tb-more-wrap" ref={wrapRef}>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} title="More actions">⋯</button>
      {open && (
        <div className="tb-more-menu">
          <button className="tb-more-item" onClick={() => act(onExport)} disabled={disabled}>⬇ Export flow</button>
          <button className="tb-more-item" onClick={() => act(onImport)}>⬆ Import flow</button>
          <div className="tb-more-sep"/>
          <button className="tb-more-item" onClick={() => act(onLayout)}>⊞ Auto-layout</button>
          <button className="tb-more-item" onClick={() => act(onValidate)} disabled={disabled}>✔ Validate</button>
          <div className="tb-more-sep"/>
          <button className="tb-more-item" onClick={() => act(onHistory)} disabled={disabled}>📜 Version history</button>
          <button className="tb-more-item" onClick={() => act(onSaveWithNote)} disabled={disabled}>💾 Save with note…</button>
          {isAdmin && <>
            <div className="tb-more-sep"/>
            <button className="tb-more-item" onClick={() => act(onPermissions)} disabled={disabled}>🔐 Manage permissions</button>
          </>}
          <div className="tb-more-sep"/>
          <button className="tb-more-item" onClick={() => act(onSearch)}>🔍 Search nodes (Ctrl+F)</button>
          <button className="tb-more-item" onClick={() => act(onToggleMap)}>{showMap ? "🗺 Hide minimap" : "🗺 Show minimap"}</button>
          <button className="tb-more-item" onClick={() => act(onShortcuts)}>⌨️ Keyboard shortcuts</button>
          {/* Mobile-only extras */}
          <div className="tb-more-sep tb-more-mobile-extra"/>
          <button className="tb-more-item tb-more-mobile-extra" onClick={() => act(onUndo)} disabled={undoDisabled}>↩ Undo</button>
          <button className="tb-more-item tb-more-mobile-extra" onClick={() => act(onRedo)} disabled={redoDisabled}>↪ Redo</button>
          <div className="tb-more-sep tb-more-mobile-extra"/>
          <button className="tb-more-item tb-more-mobile-extra" onClick={() => act(onTest)} disabled={disabled}>🧪 Test run</button>
          <button className="tb-more-item tb-more-mobile-extra" onClick={() => act(onAdmin)}>← Admin panel</button>
        </div>
      )}
    </div>
  );
}

/* ── Main CanvasApp ────────────────────────────────────────────────────── */
function CanvasApp() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode,    setSelectedNode]    = useState(null);
  const [selectedEdge,    setSelectedEdge]    = useState(null);
  const [edgeLabelInput,  setEdgeLabelInput]  = useState("");
  const [currentGraph,    setCurrentGraph]    = useState(null);
  const [graphName,       setGraphName]       = useState("Untitled Graph");
  const [graphs,          setGraphs]          = useState([]);
  const [showModal,       setShowModal]       = useState(false);
  const [showTestModal,   setShowTestModal]   = useState(false);
  const [showHistoryModal,   setShowHistoryModal]   = useState(false);
  const [showPermissionsModal, setShowPermissionsModal] = useState(false);
  const [showExtractModal,   setShowExtractModal]   = useState(false);
  const [currentUser,     setCurrentUser]     = useState(null);
  const [workspaces,      setWorkspaces]      = useState([]);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [contextMenu,     setContextMenu]     = useState(null);
  const [toast,           setToast]           = useState(null);
  const [confirmState,    setConfirmState]    = useState(null);
  const [saving,          setSaving]          = useState(false);
  const [isDirty,         setIsDirty]         = useState(false);
  const [running,         setRunning]         = useState(false);
  const [runError,        setRunError]        = useState(null);
  const [showMap,         setShowMap]         = useState(true);
  const [paletteSearch,   setPaletteSearch]   = useState("");
  const [testPayload,     setTestPayload]     = useState("{}");
  const [validationIssues,  setValidationIssues]  = useState(null);
  const [inspectorRuns,   setInspectorRuns]   = useState([]);
  const [inspectorRunId,  setInspectorRunId]  = useState(null);
  const [inspectorRun,    setInspectorRun]    = useState(null);  // full run obj for overlay bar
  const [credentials,     setCredentials]     = useState([]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showShortcuts,   setShowShortcuts]   = useState(false);
  const [showSearch,      setShowSearch]      = useState(false);
  const [replayEdit,      setReplayEdit]      = useState(null);
  const [hoveredNodeId,   setHoveredNodeId]   = useState(null);
  const [spacePanning,    setSpacePanning]    = useState(false); // Space-to-pan mode
  const [quickTemplateBusy, setQuickTemplateBusy] = useState(null);

  // Dependency highlight — compute upstream (blue) + downstream (green) sets when hovering
  const { upstreamIds, downstreamIds } = useMemo(() => {
    if (!hoveredNodeId) return { upstreamIds: new Set(), downstreamIds: new Set() };
    const pred  = {};
    const succ  = {};
    nodes.forEach(n => { pred[n.id] = []; succ[n.id] = []; });
    edges.forEach(e => {
      if (pred[e.target]) pred[e.target].push(e.source);
      if (succ[e.source]) succ[e.source].push(e.target);
    });
    const bfs = (start, adj) => {
      const visited = new Set();
      const q = [start];
      while (q.length) {
        const cur = q.shift();
        for (const nb of (adj[cur] || [])) {
          if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
        }
      }
      return visited;
    };
    return { upstreamIds: bfs(hoveredNodeId, pred), downstreamIds: bfs(hoveredNodeId, succ) };
  }, [hoveredNodeId, edges, nodes]);

  // Apply hover dimming — dim unrelated nodes/edges when hovering
  const displayNodes = useMemo(() => {
    if (!hoveredNodeId || (!upstreamIds.size && !downstreamIds.size)) return nodes;
    return nodes.map(n => {
      if (n.id === hoveredNodeId) return n;
      const isUp   = upstreamIds.has(n.id);
      const isDown = downstreamIds.has(n.id);
      const opacity = isUp || isDown ? 1 : 0.2;
      return { ...n, style: { ...(n.style || {}), opacity } };
    });
  }, [hoveredNodeId, upstreamIds, downstreamIds, nodes]);

  const displayEdges = useMemo(() => {
    if (!hoveredNodeId) return edges;
    return edges.map(e => {
      const srcUp   = e.source === hoveredNodeId || upstreamIds.has(e.source);
      const dstDown = e.target === hoveredNodeId || downstreamIds.has(e.target);
      const isUpstream   = upstreamIds.has(e.source) && (e.target === hoveredNodeId || upstreamIds.has(e.target));
      const isDownstream = (e.source === hoveredNodeId || downstreamIds.has(e.source)) && downstreamIds.has(e.target);
      if (isUpstream) {
        return { ...e, style: { ...(e.style || {}), stroke: "#60a5fa", opacity: 1 }, markerEnd: { type: "arrowclosed", color: "#60a5fa" } };
      }
      if (isDownstream) {
        return { ...e, style: { ...(e.style || {}), stroke: "#4ade80", opacity: 1 }, markerEnd: { type: "arrowclosed", color: "#4ade80" } };
      }
      return { ...e, style: { ...(e.style || {}), opacity: 0.1 } };
    });
  }, [hoveredNodeId, upstreamIds, downstreamIds, edges]);

  // Live per-node validation map — recomputed on every nodes/edges/credentials change
  const validationMap = useMemo(() => {
    const credNames = new Set((credentials || []).map(c => c.name));
    const map = new Map();
    nodes.forEach(n => {
      if (n.data.type === "note" || n.data.disabled) return;
      const issues = nodeIssues(n, edges, credNames);
      if (issues.length > 0) map.set(n.id, issues);
    });
    return map;
  }, [nodes, edges, credentials]);

  // Undo / redo
  const histRef    = useRef([]);
  const histIdx    = useRef(-1);
  const restoring  = useRef(false);
  const [histState, setHistState] = useState({ idx: -1, len: 0 });
  function syncHistState() { setHistState({ idx: histIdx.current, len: histRef.current.length }); }

  const reactFlowWrapper = useRef(null);
  const importFileRef    = useRef(null);
  const clipboardRef     = useRef(null);   // { nodes, edges } last Ctrl+C selection
  const { screenToFlowPosition, setCenter } = useReactFlow();

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type, key: Date.now() });
  }, []);

  function resetCanvasForWorkspaceSwitch(nextWorkspace) {
    setNodes([]);
    setEdges([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEdgeLabelInput("");
    setCurrentGraph(null);
    setGraphName("Untitled Graph");
    setContextMenu(null);
    setRunError(null);
    setRunning(false);
    setShowModal(false);
    setShowTestModal(false);
    setShowHistoryModal(false);
    setShowPermissionsModal(false);
    setShowExtractModal(false);
    setValidationIssues(null);
    setInspectorRuns([]);
    setInspectorRunId(null);
    setInspectorRun(null);
    setPaletteSearch("");
    setMobileSidebarOpen(false);
    setShowSearch(false);
    setReplayEdit(null);
    setHoveredNodeId(null);
    setActiveWorkspace(nextWorkspace || null);
    setIsDirty(false);
    histRef.current = [];
    histIdx.current = -1;
    syncHistState();
    sessionStorage.removeItem("canvas_open_graph");
    window.location.hash = "";
  }

  /* ── Jump viewport to a node ─────────────────────────────────────────── */
  function jumpToNode(n) {
    const x = n.position.x + (n.width  || 180) / 2;
    const y = n.position.y + (n.height || 60)  / 2;
    setCenter(x, y, { zoom: 1.2, duration: 400 });
    setNodes(ns => ns.map(nd => ({ ...nd, selected: nd.id === n.id })));
  }

  /* ── Startup effects ─────────────────────────────────────────────────── */
  useEffect(() => {
    loadGraphList();
    api("GET", "/api/credentials").then(setCredentials).catch(() => {});
    api("GET", "/api/auth/me").then(setCurrentUser).catch(() => {});
    api("GET", "/api/workspaces/my/list").then(list => {
      setWorkspaces(list || []);
      const wid = _getWorkspaceId();
      const active = wid ? (list || []).find(w => String(w.id) === String(wid)) : null;
      setActiveWorkspace(active || (list && list[0]) || null);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Auto-open from sessionStorage or URL hash ───────────────────────── */
  useEffect(() => {
    const ssId      = sessionStorage.getItem("canvas_open_graph");
    const slugMatch = window.location.hash.match(/^#flow-([a-f0-9]{8})/);
    const idMatch   = window.location.hash.match(/^#graph-(\d+)$/);
    const endpoint  = ssId
      ? `/api/graphs/${ssId}`
      : slugMatch
        ? `/api/graphs/by-slug/${slugMatch[1]}`
        : idMatch
          ? `/api/graphs/${idMatch[1]}`
          : null;
    if (!endpoint) return;
    sessionStorage.removeItem("canvas_open_graph");
    api("GET", endpoint)
      .then(full => {
        const gd = full.graph_data || { nodes: [], edges: [] };
        const newNodes = (gd.nodes || []).map(loadNode);
        const newEdges = (gd.edges || []).map(styledEdge);
        setNodes(newNodes); setEdges(newEdges);
        setCurrentGraph(full); setGraphName(full.name);
        setSelectedNode(null); setRunError(null);
        histRef.current = []; histIdx.current = -1; syncHistState();
        saveSnap(newNodes, newEdges);
        setIsDirty(false);
        window.location.hash = "flow-" + full.slug;
        showToast(`Opened: ${full.name}`);
      })
      .catch(() => { window.location.hash = ""; });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Keyboard shortcuts ──────────────────────────────────────────────── */
  const kbRef = useRef({});
  kbRef.current = {
    saveGraph, doUndo, doRedo, doCopy, doPaste, doDuplicate, doSelectAll,
    setSelectedNode, setSelectedEdge, setContextMenu, setRunError,
    setShowModal, setShowTestModal, setShowHistoryModal, setShowPermissionsModal,
    setShowShortcuts, setShowSearch,
  };
  useEffect(() => {
    function onKey(e) {
      const kb  = kbRef.current;
      const mac = e.metaKey, ctrl = e.ctrlKey;
      if ((ctrl || mac) && e.key === "z" && !e.shiftKey) { e.preventDefault(); kb.doUndo(); return; }
      if ((ctrl && e.key === "y") || (mac && e.shiftKey && e.key === "z")) { e.preventDefault(); kb.doRedo(); return; }
      if ((ctrl || mac) && e.key === "s") { e.preventDefault(); kb.saveGraph(); return; }
      if ((ctrl || mac) && e.key === "f") { e.preventDefault(); kb.setShowSearch(s => !s); return; }
      if ((ctrl || mac) && e.key === "c") { kb.doCopy(); return; }
      if ((ctrl || mac) && e.key === "v") { e.preventDefault(); kb.doPaste(); return; }
      if ((ctrl || mac) && e.key === "d") { e.preventDefault(); kb.doDuplicate(); return; }
      if ((ctrl || mac) && e.key === "a") { e.preventDefault(); kb.doSelectAll(); return; }
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
      if (e.key === "Escape") {
        kb.setContextMenu(null); kb.setSelectedEdge(null); kb.setRunError(null);
        kb.setSelectedNode(null); kb.setShowModal(false); kb.setShowTestModal(false);
        kb.setShowHistoryModal(false); kb.setShowPermissionsModal(false);
        kb.setShowShortcuts(false); kb.setShowSearch(false);
        return;
      }
      if (e.key === "?") { kb.setShowShortcuts(s => !s); }
    }
    function onSpaceDown(e) {
      if (e.code === "Space" && !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        setSpacePanning(true);
      }
    }
    function onSpaceUp(e) {
      if (e.code === "Space") setSpacePanning(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onSpaceDown);
    window.addEventListener("keyup",   onSpaceUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onSpaceDown);
      window.removeEventListener("keyup",   onSpaceUp);
    };
  }, []);

  /* ── Dirty-state beforeunload guard ─────────────────────────────────── */
  useEffect(() => {
    if (!isDirty) return;
    const h = e => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [isDirty]);

  /* ── Autosave (30 s after last change, existing graphs only) ─────────── */
  const autosaveTimer = useRef(null);
  useEffect(() => {
    if (!isDirty || !currentGraph) return;
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveGraph();
    }, 30000);
    return () => clearTimeout(autosaveTimer.current);
  }, [isDirty, currentGraph]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Undo / redo ─────────────────────────────────────────────────────── */
  function saveSnap(ns, es) {
    if (restoring.current) return;
    histRef.current = histRef.current.slice(0, histIdx.current + 1);
    histRef.current.push({
      nodes: JSON.parse(JSON.stringify(ns)),
      edges: JSON.parse(JSON.stringify(es)),
    });
    if (histRef.current.length > 60) histRef.current.shift();
    histIdx.current = histRef.current.length - 1;
    syncHistState();
    setIsDirty(true);
  }

  function doUndo() {
    if (histIdx.current <= 0) return;
    histIdx.current--;
    const snap = histRef.current[histIdx.current];
    restoring.current = true;
    setNodes(snap.nodes.map(n => ({ ...n })));
    setEdges(snap.edges.map(e => ({ ...styledEdge(e) })));
    setSelectedNode(null);
    syncHistState();
    setTimeout(() => { restoring.current = false; }, 50);
  }

  function doRedo() {
    if (histIdx.current >= histRef.current.length - 1) return;
    histIdx.current++;
    const snap = histRef.current[histIdx.current];
    restoring.current = true;
    setNodes(snap.nodes.map(n => ({ ...n })));
    setEdges(snap.edges.map(e => ({ ...styledEdge(e) })));
    setSelectedNode(null);
    syncHistState();
    setTimeout(() => { restoring.current = false; }, 50);
  }

  /* ── Copy / paste / duplicate / select-all ───────────────────────────── */
  function doCopy() {
    const selected = nodes.filter(n => n.selected);
    if (selected.length === 0) return;
    const ids = new Set(selected.map(n => n.id));
    clipboardRef.current = {
      nodes: selected.map(n => JSON.parse(JSON.stringify(n))),
      edges: edges.filter(e => ids.has(e.source) && ids.has(e.target))
                  .map(e => JSON.parse(JSON.stringify(e))),
    };
    showToast(`Copied ${selected.length} node${selected.length !== 1 ? "s" : ""}`);
  }

  function doPaste() {
    const cb = clipboardRef.current;
    if (!cb || cb.nodes.length === 0) return;
    const OFFSET = 60;
    const idMap = {};
    cb.nodes.forEach(n => { idMap[n.id] = uid(); });
    const pastedNodes = cb.nodes.map(n => ({
      ...n,
      id: idMap[n.id],
      position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
      selected: true,
      data: { ...n.data, _runStatus: undefined, _runOutput: undefined, _runInput: undefined },
    }));
    const pastedEdges = cb.edges.map(e => ({
      ...styledEdge(e), id: uid(),
      source: idMap[e.source], target: idMap[e.target],
    }));
    // Advance clipboard offset so repeated pastes stagger
    clipboardRef.current = {
      nodes: cb.nodes.map(n => ({ ...n, position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET } })),
      edges: cb.edges,
    };
    setNodes(ns => {
      const updated = [...ns.map(n => ({ ...n, selected: false })), ...pastedNodes];
      saveSnap(updated, [...edges, ...pastedEdges]);
      return updated;
    });
    setEdges(es => [...es, ...pastedEdges]);
    showToast(`Pasted ${pastedNodes.length} node${pastedNodes.length !== 1 ? "s" : ""}`);
  }

  function doDuplicate() {
    const selected = nodes.filter(n => n.selected);
    if (selected.length === 0) return;
    const ids = new Set(selected.map(n => n.id));
    const OFFSET = 40;
    const idMap = {};
    selected.forEach(n => { idMap[n.id] = uid(); });
    const dupNodes = selected.map(n => ({
      ...n,
      id: idMap[n.id],
      position: { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
      selected: true,
      data: { ...n.data, _runStatus: undefined, _runOutput: undefined, _runInput: undefined },
    }));
    const dupEdges = edges
      .filter(e => ids.has(e.source) && ids.has(e.target))
      .map(e => ({ ...styledEdge(e), id: uid(), source: idMap[e.source], target: idMap[e.target] }));
    setNodes(ns => {
      const updated = [...ns.map(n => ({ ...n, selected: false })), ...dupNodes];
      saveSnap(updated, [...edges, ...dupEdges]);
      return updated;
    });
    setEdges(es => [...es, ...dupEdges]);
    showToast(`Duplicated ${dupNodes.length} node${dupNodes.length !== 1 ? "s" : ""}`);
  }

  function doSelectAll() {
    setNodes(ns => ns.map(n => ({ ...n, selected: true })));
  }

  /* ── Subflow extraction ──────────────────────────────────────────────── */
  async function doExtractSubflow(name, description) {
    const selected = nodes.filter(n => n.selected);
    if (selected.length < 1) return;

    const selIds  = new Set(selected.map(n => n.id));
    // Edges fully within the selection
    const selEdges = edges.filter(e => selIds.has(e.source) && selIds.has(e.target));

    // Reposition extracted nodes to start near origin
    const minX = Math.min(...selected.map(n => n.position.x));
    const minY = Math.min(...selected.map(n => n.position.y));
    const extractedNodes = selected.map(n => ({
      ...n,
      position: { x: n.position.x - minX + 60, y: n.position.y - minY + 60 },
      selected: false,
      data: { ...n.data, _runStatus: undefined, _runOutput: undefined, _runInput: undefined },
    }));

    // Create new flow via API
    const graph_data = { nodes: extractedNodes, edges: selEdges };
    let newGraph;
    try {
      newGraph = await api("POST", "/api/graphs", { name, description, graph_data });
    } catch (err) {
      showToast("Extract failed: " + err.message, "error");
      return;
    }

    // Calculate centroid of selected nodes for placement of the call_graph node
    const cx = selected.reduce((s, n) => s + n.position.x, 0) / selected.length;
    const cy = selected.reduce((s, n) => s + n.position.y, 0) / selected.length;

    // Replace selected nodes with a single call_graph node
    const callNode = {
      id:       uid(),
      type:     "custom",
      position: { x: cx - 90, y: cy - 25 },
      selected: true,
      data: {
        type:      "action.call_graph",
        label:     name,
        config:    { graph_id: String(newGraph.id), payload: "" },
        retry_max: 0, retry_delay: 5,
      },
    };

    setNodes(ns => {
      const kept    = ns.filter(n => !selIds.has(n.id));
      const updated = [...kept, callNode];
      saveSnap(updated, edges.filter(e => !selIds.has(e.source) && !selIds.has(e.target)));
      return updated;
    });
    setEdges(es => es.filter(e => !selIds.has(e.source) && !selIds.has(e.target)));

    await loadGraphList();
    setShowExtractModal(false);
    setIsDirty(true);
    showToast(`Extracted to "${name}" (ID ${newGraph.id}) — Call Sub-flow node added`);
  }

  /* ── Graph list ──────────────────────────────────────────────────────── */
  async function loadGraphList() {
    try { setGraphs(await api("GET", "/api/graphs")); } catch (e) { /* silent */ }
  }

  async function performCanvasWorkspaceSwitch(workspaceId) {
    try {
      const res = await api("POST", `/api/workspaces/${workspaceId}/switch`);
      resetCanvasForWorkspaceSwitch(res.workspace);
      const [nextGraphs, nextCreds] = await Promise.all([
        api("GET", "/api/graphs"),
        api("GET", "/api/credentials"),
      ]);
      setGraphs(nextGraphs || []);
      setCredentials(nextCreds || []);
      showToast(`Switched to ${res.workspace.name}`);
    } catch (err) {
      showToast(err.message || "Workspace switch failed", "error");
    }
  }

  function switchCanvasWorkspace(workspaceId) {
    if (!workspaceId || workspaceId === activeWorkspace?.id) return;
    if (!isDirty) {
      performCanvasWorkspaceSwitch(workspaceId);
      return;
    }
    const nextWorkspace = workspaces.find(w => w.id === workspaceId);
    setConfirmState({
      message: `Switch to ${nextWorkspace?.name || "that workspace"} and discard unsaved canvas changes?`,
      confirmLabel: "Switch",
      fn: () => performCanvasWorkspaceSwitch(workspaceId),
    });
  }

  /* ── Edge events ─────────────────────────────────────────────────────── */
  const onConnect = useCallback((params) => {
    setEdges(eds => {
      const ne = addEdge({ ...params, ...EDGE_STYLE, label: undefined }, eds);
      saveSnap(nodes, ne);
      return ne;
    });
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  function onEdgeClick(e, edge) {
    setSelectedEdge(edge);
    setEdgeLabelInput(edge.label || "");
    setSelectedNode(null);
    setContextMenu(null);
  }

  function updateEdgeLabel(label) {
    setEdges(es => {
      const updated = es.map(e => e.id === selectedEdge.id ? { ...e, label: label || undefined } : e);
      saveSnap(nodes, updated);
      return updated;
    });
    setSelectedEdge(null);
  }

  /* ── Node events ─────────────────────────────────────────────────────── */
  function onNodeClick(e, node) { setSelectedNode(node); setContextMenu(null); }
  function onPaneClick() { setSelectedNode(null); setContextMenu(null); setSelectedEdge(null); }

  function onNodeContextMenu(e, node) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
    setSelectedNode(node);
  }

  function ctxDuplicateNode(node) {
    const newId = uid();
    const newNode = {
      ...node, id: newId,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, label: (node.data.label || "") + " (copy)", _runStatus: undefined, _runOutput: undefined },
      selected: false,
    };
    setNodes(ns => { const u = [...ns, newNode]; saveSnap(u, edges); return u; });
    setSelectedNode(newNode);
  }

  function ctxToggleDisabled(id) {
    setNodes(ns => {
      const u = ns.map(n => n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n);
      saveSnap(u, edges);
      return u;
    });
    setSelectedNode(s => s && s.id === id ? { ...s, data: { ...s.data, disabled: !s.data.disabled } } : s);
  }

  function ctxCopyId(id) {
    navigator.clipboard.writeText(id).catch(() => {});
    showToast(`Copied: ${id}`);
  }

  function ctxRenameNode(node) {
    const newLabel = window.prompt("Rename node:", node.data.label || (NODE_DEFS[node.data.type] || {}).label || "");
    if (newLabel === null || newLabel.trim() === "") return;
    onNodeChange(node.id, { ...node.data, label: newLabel.trim() });
  }

  function onNodeChange(id, newData) {
    setNodes(ns => {
      const updated = ns.map(n => n.id === id ? { ...n, data: newData } : n);
      saveSnap(updated, edges);
      return updated;
    });
    setSelectedNode(s => s && s.id === id ? { ...s, data: newData } : s);
  }

  function onDeleteNode(id) {
    setNodes(ns => { const u = ns.filter(n => n.id !== id); saveSnap(u, edges); return u; });
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }

  /* ── Drag & drop from palette ────────────────────────────────────────── */
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }

  function onDrop(e) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/reactflow-type");
    if (!type) return;
    const def  = NODE_DEFS[type];
    const pos  = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const id   = uid();
    const isNote = type === "note";
    setNodes(ns => {
      const updated = [...ns, {
        id, type: "custom", position: pos,
        ...(isNote ? { zIndex: -1 } : {}),
        data: { type, label: def.label, config: {}, retry_max: 0, retry_delay: 5 },
      }];
      saveSnap(updated, edges);
      return updated;
    });
  }

  /* ── Build serialised graph_data ─────────────────────────────────────── */
  function buildGraphData() {
    return {
      nodes: nodes.map(n => ({
        id: n.id, type: n.data.type, position: n.position,
        data: {
          label:       n.data.label    || "",
          config:      n.data.config   || {},
          disabled:    !!n.data.disabled,
          retry_max:   n.data.retry_max   || 0,
          retry_delay: n.data.retry_delay || 5,
          fail_mode:   n.data.fail_mode   || "abort",
        },
      })),
      edges: edges.map(e => ({
        id: e.id, source: e.source, target: e.target,
        sourceHandle: e.sourceHandle || null,
        targetHandle: e.targetHandle || null,
        label: e.label,
      })),
    };
  }

  /* ── Auto-layout ─────────────────────────────────────────────────────── */
  function doAutoLayout() {
    setNodes(ns => {
      const laid = computeAutoLayout(ns, edges);
      saveSnap(laid, edges);
      return laid;
    });
    showToast("Layout applied");
  }

  /* ── Save ────────────────────────────────────────────────────────────── */
  async function saveGraph(saveNote) {
    setSaving(true);
    try {
      const gd = buildGraphData();
      if (currentGraph) {
        const body = { name: graphName, graph_data: gd };
        if (saveNote) body.save_note = saveNote;
        await api("PUT", `/api/graphs/${currentGraph.id}`, body);
        setIsDirty(false);
        showToast(saveNote ? `Saved: "${saveNote}"` : "Graph saved!");
        await loadGraphList();
      } else {
        const g = await api("POST", "/api/graphs", { name: graphName, description: "", graph_data: gd });
        setCurrentGraph(g);
        setIsDirty(false);
        showToast("Graph created!");
        await loadGraphList();
      }
    } catch (e) { showToast(e.message, "error"); }
    setSaving(false);
  }

  async function saveGraphWithNote() {
    const note = window.prompt("Save note (optional — shown in version history):", "");
    if (note === null) return;   // cancelled
    await saveGraph(note.trim() || undefined);
  }

  /* ── Export / import ─────────────────────────────────────────────────── */
  function exportFlow() {
    if (!currentGraph) return;
    const data = {
      version: 8, name: graphName,
      description: currentGraph.description || "",
      graph_data:  buildGraphData(),
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${graphName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.flow.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported flow JSON");
  }

  async function importFlow(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    try {
      const text    = await file.text();
      const data    = JSON.parse(text);
      const name    = (data.name || file.name.replace(/\.flow\.json$/i, "").replace(/_/g, " ")) + " (imported)";
      const gd      = data.graph_data || data;
      const created = await api("POST", "/api/graphs", { name, description: data.description || "", graph_data: gd });
      showToast(`Imported as "${created.name}"`);
      await loadGraphList();
      onSelectGraph(created);
    } catch (err) { showToast("Import failed: " + err.message, "error"); }
  }

  /* ── Validate + run ──────────────────────────────────────────────────── */
  async function validateAndRun(payload) {
    let creds = [];
    try { creds = await api("GET", "/api/credentials"); } catch (e) { /* ok */ }
    const issues = validateFlow(nodes, edges, creds);
    if (issues.length === 0) {
      runGraph(payload);
    } else {
      setValidationIssues({ issues, payload });
    }
  }

  async function runGraph(payload, opts) {
    // opts: { start_node_id?, prior_context? } for "run from this node"
    if (!currentGraph) { showToast("Save the graph first", "error"); return; }
    setRunning(true);
    setRunError(null);
    setNodes(ns => ns.map(n => ({
      ...n, data: {
        ...n.data,
        _runStatus: n.data.type === "note" ? undefined : "pending",
        _runOutput: undefined, _runInput: undefined,
      },
    })));
    setSelectedNode(s => s ? { ...s, data: { ...s.data, _runStatus: "pending", _runOutput: undefined } } : s);

    let taskId;
    try {
      let runPayload = {};
      if (payload) {
        try { runPayload = JSON.parse(payload); }
        catch (e) { showToast("Invalid JSON in test payload", "error"); setRunning(false); return; }
      }
      const body = { source: "canvas", payload: runPayload };
      if (opts?.start_node_id) {
        body.start_node_id = opts.start_node_id;
        body.prior_context = opts.prior_context || {};
      }
      const r = await api("POST", `/api/graphs/${currentGraph.id}/run`, body);
      taskId = r.task_id;
    } catch (e) { showToast(e.message, "error"); setRunning(false); return; }

    const liveTraceMap = {};

    function applyRunDone(status, errMsg, finishedRun) {
      setRunning(false);
      refreshInspectorRuns();
      // Colour all nodes + edges from final liveTraceMap (unreached nodes get "?" badge)
      setNodes(ns => { const { nodes: n2 } = overlayTrace(ns, [], liveTraceMap); return n2; });
      setEdges(es => { const { edges: e2 } = overlayTrace([], es, liveTraceMap); return e2; });
      setSelectedNode(s => {
        if (!s || s.data.type === "note") return s;
        const t  = liveTraceMap[s.id];
        const st = t ? (t.status === "ok" ? "ok" : t.status === "error" ? "err" : "skip") : "unreached";
        return { ...s, data: { ...s.data, _runStatus: st, _runOutput: t?.output, _runInput: t?.input, _runDurationMs: t?.duration_ms } };
      });
      if (finishedRun) setInspectorRun(finishedRun);
      if (status === "succeeded") {
        showToast("Run succeeded ✓");
      } else if (status === "timeout") {
        showToast("Run timed out", "error");
      } else {
        const err = errMsg || "";
        const m = err.match(/\[([a-zA-Z0-9_-]+)\]/);
        const failedNodeId = m ? m[1] : null;
        setNodes(ns => {
          const n = ns.find(x => x.id === failedNodeId);
          const failedNodeName = n ? (n.data?.label || failedNodeId) : failedNodeId;
          setRunError({ msg: err, nodeName: failedNodeName });
          return ns;
        });
      }
    }

    // ── SSE streaming ──────────────────────────────────────────────────────
    let evtSource = null;
    const safetyTimer = setTimeout(() => { if (evtSource) { evtSource.close(); applyRunDone("timeout"); } }, 300000);

    try {
      evtSource = new EventSource(`/api/runs/${taskId}/stream`);
      evtSource.onmessage = (e) => {
        let event;
        try { event = JSON.parse(e.data); } catch { return; }
        if (event.type === "node_start") {
          setNodes(ns => ns.map(n => n.id !== event.node_id ? n : { ...n, data: { ...n.data, _runStatus: "running" } }));
          setSelectedNode(s => s && s.id === event.node_id ? { ...s, data: { ...s.data, _runStatus: "running" } } : s);
        }
        if (event.type === "node_done") {
          liveTraceMap[event.node_id] = event;
          const st = event.status === "ok" ? "ok" : event.status === "error" ? "err" : "skip";
          setNodes(ns => ns.map(n => n.id !== event.node_id ? n :
            { ...n, data: { ...n.data, _runStatus: st, _runOutput: event.output, _runInput: event.input, _runDurationMs: event.duration_ms } }));
          setSelectedNode(s => s && s.id === event.node_id
            ? { ...s, data: { ...s.data, _runStatus: st, _runOutput: event.output, _runInput: event.input, _runDurationMs: event.duration_ms } } : s);
        }
        if (event.type === "run_done") {
          clearTimeout(safetyTimer);
          evtSource.close();
          // Fetch the full run record so the overlay bar has id + status
          api("GET", `/api/runs/by-task/${taskId}`)
            .then(run => applyRunDone(event.status, event.error, run))
            .catch(() => applyRunDone(event.status, event.error));
        }
      };
      evtSource.onerror = () => {
        evtSource.close();
        clearTimeout(safetyTimer);
        api("GET", `/api/runs/by-task/${taskId}`).then(run => {
          if (!run) { setRunning(false); return; }
          (run.traces || []).forEach(t => { if (t.node_id) liveTraceMap[t.node_id] = t; });
          applyRunDone(run.status, (run.result || {}).error || run.error, run);
        }).catch(() => setRunning(false));
      };
    } catch {
      // EventSource not supported — polling fallback
      clearTimeout(safetyTimer);
      const poll = setInterval(async () => {
        try {
          const run = await api("GET", `/api/runs/by-task/${taskId}`);
          if (!run || run.status === "running" || run.status === "queued") return;
          clearInterval(poll);
          (run.traces || []).forEach(t => { if (t.node_id) liveTraceMap[t.node_id] = t; });
          applyRunDone(run.status, (run.result || {}).error || run.error, run);
        } catch { /* keep polling */ }
      }, 800);
      setTimeout(() => { clearInterval(poll); setRunning(false); }, 300000);
    }
  }

  /* ── Run from a specific node ───────────────────────────────────────── */
  function doRunFrom(nodeId) {
    if (!currentGraph) { showToast("Save the graph first", "error"); return; }
    // Collect current node outputs as prior context for the executor
    const prior = {};
    nodes.forEach(n => {
      if (n.data._runOutput !== undefined) prior[n.id] = n.data._runOutput;
    });
    const label = nodes.find(n => n.id === nodeId)?.data?.label || nodeId;
    showToast(`▶ Running from "${label}"…`);
    runGraph(null, { start_node_id: nodeId, prior_context: prior });
  }

  /* ── Single-node test ────────────────────────────────────────────────── */
  async function testNode(nodeId, testInput) {
    if (!currentGraph) { showToast("Save the graph first", "error"); return; }
    setSelectedNode(s => s ? { ...s, data: { ...s.data, _runStatus: "pending", _runOutput: undefined, _runInput: testInput } } : s);
    setNodes(ns => ns.map(n => n.id !== nodeId ? n : { ...n, data: { ...n.data, _runStatus: "pending" } }));
    try {
      const result = await api("POST", `/api/graphs/${currentGraph.id}/nodes/${nodeId}/test`, { input: testInput });
      const status = result.error ? "err" : "ok";
      const out    = result.error ? { __error: result.error } : result.output;
      setSelectedNode(s => s ? { ...s, data: { ...s.data, _runStatus: status, _runOutput: out, _runInput: testInput, _runDurationMs: result.duration_ms } } : s);
      setNodes(ns => ns.map(n => n.id !== nodeId ? n : { ...n, data: { ...n.data, _runStatus: status, _runOutput: out, _runDurationMs: result.duration_ms } }));
      showToast(result.error ? `Test failed: ${result.error}` : "Test succeeded ✓", result.error ? "error" : "success");
    } catch (e) {
      showToast(e.message || "Test request failed", "error");
      setSelectedNode(s => s ? { ...s, data: { ...s.data, _runStatus: undefined } } : s);
      setNodes(ns => ns.map(n => n.id !== nodeId ? n : { ...n, data: { ...n.data, _runStatus: undefined } }));
    }
  }

  /* ── Pin node output ─────────────────────────────────────────────────── */
  function pinNodeOutput(nodeId, output) {
    setNodes(ns => ns.map(n => n.id !== nodeId ? n : { ...n, data: { ...n.data, _pinnedOutput: output || undefined } }));
    setSelectedNode(s => s && s.id === nodeId ? { ...s, data: { ...s.data, _pinnedOutput: output || undefined } } : s);
    showToast(output ? "Output pinned 📌" : "Output unpinned", "success");
  }

  /* ── Run inspector / replay ──────────────────────────────────────────── */
  function _getInspectorRunDbId() {
    if (!inspectorRunId) return null;
    const run = inspectorRuns.find(r => String(r.id) === inspectorRunId || r.task_id === inspectorRunId);
    return run?.id || null;
  }

  async function replayInspectorRun() {
    const dbId = _getInspectorRunDbId();
    if (!dbId) return;
    try { await api("POST", `/api/runs/${dbId}/replay`); showToast("Queued for replay"); }
    catch (e) { showToast(e.message, "error"); }
  }

  async function openReplayEditCanvas() {
    const dbId = _getInspectorRunDbId();
    if (!dbId) return;
    try {
      const data = await api("GET", `/api/runs/${dbId}/payload`);
      setReplayEdit({ runId: dbId, payload: JSON.stringify(data.payload || {}, null, 2) });
    } catch (e) { showToast(e.message, "error"); }
  }

  async function submitReplayEditCanvas(runId, payloadStr) {
    try {
      let payload;
      try { payload = JSON.parse(payloadStr); } catch { showToast("Invalid JSON", "error"); return; }
      await api("POST", `/api/runs/${runId}/replay`, { payload });
      showToast("Queued for replay with custom payload");
      setReplayEdit(null);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function refreshInspectorRuns() {
    if (!currentGraph) { setInspectorRuns([]); return; }
    try {
      const allRuns = await api("GET", "/api/runs");
      const graphRuns = allRuns
        .filter(r => r.workflow === currentGraph.name || String(r.graph_id) === String(currentGraph.id))
        .slice(0, 20);
      setInspectorRuns(graphRuns);
    } catch {
      setInspectorRuns([]);
    }
  }

  async function loadInspectorRun(runId) {
    setInspectorRunId(runId);
    if (!runId) {
      setInspectorRun(null);
      setNodes(ns => { const { nodes: n2, edges: e2 } = clearOverlay(ns, []); return n2; });
      setEdges(es => clearOverlay([], es).edges);
      setSelectedNode(s => s ? { ...s, data: { ...s.data, _runStatus: undefined, _runOutput: undefined, _runInput: undefined } } : s);
      return;
    }
    try {
      const allRuns = await api("GET", "/api/runs");
      const run = allRuns.find(r => String(r.id) === String(runId) || r.task_id === runId);
      if (!run) { showToast("Run not found", "error"); return; }
      const traceMap = {};
      (run.traces || []).forEach(t => { if (t.node_id) traceMap[t.node_id] = t; });
      setNodes(ns => { const { nodes: n2 } = overlayTrace(ns, [], traceMap); return n2; });
      setEdges(es => { const { edges: e2 } = overlayTrace([], es, traceMap); return e2; });
      // Re-read the just-updated node state is unreliable; update selectedNode from traceMap directly
      setSelectedNode(s => {
        if (!s || s.data.type === "note") return s;
        const t = traceMap[s.id];
        const st = t ? (t.status === "ok" ? "ok" : t.status === "error" ? "err" : "skip") : "unreached";
        return { ...s, data: { ...s.data, _runStatus: st, _runOutput: t?.output, _runInput: t?.input, _runDurationMs: t?.duration_ms } };
      });
      setInspectorRun(run);
      showToast(`Loaded run #${run.id || runId.slice(0, 8)}`);
    } catch (e) { showToast("Failed to load run: " + e.message, "error"); }
  }

  /* ── Graph CRUD ──────────────────────────────────────────────────────── */
  async function onSelectGraph(g) {
    try {
      const full = await api("GET", `/api/graphs/${g.id}`);
      const gd   = full.graph_data || { nodes: [], edges: [] };
      const newNodes = (gd.nodes || []).map(loadNode);
      const newEdges = (gd.edges || []).map(styledEdge);
      setNodes(newNodes); setEdges(newEdges);
      setCurrentGraph(full); setGraphName(full.name);
      setSelectedNode(null); setShowModal(false);
      setRunError(null); setInspectorRunId(null); setInspectorRuns([]); setInspectorRun(null);
      histRef.current = []; histIdx.current = -1; syncHistState();
      saveSnap(newNodes, newEdges);
      setIsDirty(false);
      window.location.hash = "flow-" + full.slug;
      showToast(`Loaded: ${full.name}`);
      // Auto-load latest run traces
      try {
        const allRuns = await api("GET", "/api/runs");
        const graphRuns = allRuns.filter(r => r.workflow === full.name || String(r.graph_id) === String(full.id));
        if (graphRuns.length > 0) {
          const latest = graphRuns[0];
          setInspectorRuns(graphRuns.slice(0, 20));
          setInspectorRunId(String(latest.id || latest.task_id));
          setInspectorRun(latest);
          const traceMap = {};
          (latest.traces || []).forEach(t => { if (t.node_id) traceMap[t.node_id] = t; });
          setNodes(ns => { const { nodes: n2 } = overlayTrace(ns, [], traceMap); return n2; });
          setEdges(es => { const { edges: e2 } = overlayTrace([], es, traceMap); return e2; });
        }
      } catch { /* non-fatal */ }
    } catch (err) { showToast(err.message, "error"); }
  }

  function onNewGraph(name) {
    setNodes([]); setEdges([]); setCurrentGraph(null);
    setGraphName(name); setSelectedNode(null); setShowModal(false); setRunError(null);
    histRef.current = []; histIdx.current = -1; syncHistState();
    window.location.hash = "";
  }

  async function onFromTemplate(created) {
    try {
      await loadGraphList();
      showToast(`Created "${created.name}" from template`);
      setShowModal(false);
      const full = await api("GET", `/api/graphs/${created.id}`);
      onSelectGraph(full);
    } catch (e) { showToast(e.message, "error"); }
  }

  async function startFromQuickTemplate(slug) {
    setQuickTemplateBusy(slug);
    try {
      const tpl = await api("GET", `/api/templates/${slug}`);
      const created = await api("POST", "/api/graphs/import", {
        name: tpl.name,
        description: tpl.description || "",
        graph_data: tpl.graph_data,
      });
      await onFromTemplate(created);
    } catch (e) {
      showToast(`Template import failed: ${e.message}`, "error");
    } finally {
      setQuickTemplateBusy(null);
    }
  }

  async function duplicateGraph(g) {
    try {
      const full = await api("GET", `/api/graphs/${g.id}`);
      const copy = await api("POST", "/api/graphs", {
        name: full.name.replace(/^[📧🤖🔄⚠🔍📊⚡🧪🐍⏰💻📁]/u, "").trim() + " (copy)",
        description: full.description || "",
        graph_data:  full.graph_data || {},
      });
      showToast(`Duplicated as "${copy.name}"`);
      await loadGraphList();
    } catch (e) { showToast(e.message, "error"); }
  }

  async function renameGraph(g) {
    const newName = window.prompt("Rename flow:", g.name);
    if (!newName || newName.trim() === g.name) return;
    try {
      await api("PUT", `/api/graphs/${g.id}`, { name: newName.trim() });
      showToast(`Renamed to "${newName.trim()}"`);
      if (currentGraph && currentGraph.id === g.id) setGraphName(newName.trim());
      await loadGraphList();
    } catch (e) { showToast(e.message, "error"); }
  }

  async function deleteGraph(id, name) {
    try {
      await api("DELETE", `/api/graphs/${id}`);
      showToast(`Deleted "${name}"`);
      if (currentGraph && currentGraph.id === id) {
        setNodes([]); setEdges([]); setCurrentGraph(null);
        setGraphName("Untitled Graph"); setSelectedNode(null); setRunError(null);
        histRef.current = []; histIdx.current = -1; syncHistState();
        window.location.hash = "";
      }
      await loadGraphList();
    } catch (e) { showToast(e.message, "error"); }
  }

  /* ── Restore from version history ────────────────────────────────────── */
  function onRestored(restoredGraph) {
    const gd = restoredGraph.graph_data || { nodes: [], edges: [] };
    const newNodes = (gd.nodes || []).map(loadNode);
    const newEdges = (gd.edges || []).map(styledEdge);
    setNodes(newNodes); setEdges(newEdges);
    setCurrentGraph(restoredGraph); setGraphName(restoredGraph.name);
    setSelectedNode(null); setRunError(null); setIsDirty(false);
    histRef.current = []; histIdx.current = -1; syncHistState();
    saveSnap(newNodes, newEdges);
  }

  /* ─────────────────────────────────────────────────────────────────────── */
  const isAdmin = currentUser && (currentUser.role === "admin" || currentUser.role === "owner");

  return (
    <ValidationContext.Provider value={validationMap}>
    <>
      {/* Hidden import file input */}
      <input type="file" accept=".json" style={{ display: "none" }} ref={importFileRef} onChange={importFlow} />

      {/* ── Top bar ── */}
      <div className="topbar">
        <span className="logo">⚡ HiveRunr</span>
        <div className="tb-divider"/>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(true)}>📂 Open</button>
        <MoreMenu
          onExport={exportFlow}
          onImport={() => importFileRef.current && importFileRef.current.click()}
          onLayout={doAutoLayout}
          onValidate={() => validateAndRun()}
          onHistory={() => setShowHistoryModal(true)}
          onPermissions={() => setShowPermissionsModal(true)}
          onTest={() => setShowTestModal(true)}
          onAdmin={() => { window.location.href = "/"; }}
          onShortcuts={() => setShowShortcuts(s => !s)}
          onSearch={() => setShowSearch(s => !s)}
          onToggleMap={() => setShowMap(m => !m)}
          onSaveWithNote={saveGraphWithNote}
          showMap={showMap}
          onUndo={doUndo}
          onRedo={doRedo}
          undoDisabled={histState.idx <= 0}
          redoDisabled={histState.idx >= histState.len - 1}
          isAdmin={isAdmin}
          disabled={!currentGraph}
        />
        <div className="tb-divider"/>
        <input
          className="name-input"
          value={graphName}
          onChange={e => setGraphName(e.target.value)}
          placeholder="Flow name…"
        />
        {/* Mobile: node palette toggle */}
        <button
          className="topbar-mobile-only btn btn-ghost btn-sm"
          onClick={() => setMobileSidebarOpen(o => !o)}
          title="Toggle node palette" aria-label="Toggle node palette"
          style={{ fontSize: 15, padding: "4px 8px" }}
        >
          {mobileSidebarOpen ? "✕" : "📦"}
        </button>

        {/* Desktop secondary controls */}
        <div className="topbar-secondary">
          {currentGraph && (
            <span style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap" }}>
              #{currentGraph.id}
            </span>
          )}
        </div>
        <div className="topbar-spacer"/>
        <div className="topbar-secondary">
          <button className="btn btn-ghost btn-sm" onClick={doUndo}
            disabled={histState.idx <= 0} title="Undo (Ctrl+Z)">↩</button>
          <button className="btn btn-ghost btn-sm" onClick={doRedo}
            disabled={histState.idx >= histState.len - 1} title="Redo (Ctrl+Y)">↪</button>
          <div className="tb-divider"/>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSearch(s => !s)}
            title="Search nodes (Ctrl+F)" style={{ opacity: showSearch ? 1 : 0.65 }}>🔍</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowMap(m => !m)}
            title="Toggle minimap" style={{ opacity: showMap ? 1 : 0.45 }}>🗺</button>
          <div className="tb-divider"/>
          {/* Run inspector */}
          <select
            className="btn btn-ghost btn-sm"
            style={{ cursor: "pointer", maxWidth: 165, padding: "2px 6px" }}
            title="Load a past run to inspect node inputs/outputs"
            value={inspectorRunId || ""}
            onClick={refreshInspectorRuns}
            onChange={e => loadInspectorRun(e.target.value || null)}
            disabled={!currentGraph}
          >
            <option value="">🔬 Inspect run…</option>
            {inspectorRuns.map(r => (
              <option key={r.task_id || r.id} value={r.task_id || r.id}>
                #{r.id} {r.status === "succeeded" ? "✓" : r.status === "failed" ? "✗" : "⟳"} {r.created_at ? new Date(r.created_at).toLocaleTimeString() : ""}
              </option>
            ))}
          </select>
          {inspectorRunId && (<>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={replayInspectorRun} title="Replay with original payload">▶</button>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={openReplayEditCanvas} title="Replay with custom payload">✏</button>
            <button className="btn btn-ghost btn-sm" style={{ color: "#f87171" }} onClick={() => loadInspectorRun(null)} title="Clear run overlay">✕</button>
          </>)}
          <div className="tb-divider"/>
          {/* Workspace selector */}
          {workspaces.length > 1 && (
            <select
              className="btn btn-ghost btn-sm"
              style={{ cursor: "pointer", maxWidth: 160, padding: "2px 6px", color: "#a78bfa" }}
              title="Switch workspace"
              value={activeWorkspace?.id || ""}
              onChange={e => switchCanvasWorkspace(parseInt(e.target.value, 10))}
            >
              {workspaces.map(w => (
                <option key={w.id} value={w.id}>🏢 {w.name}</option>
              ))}
            </select>
          )}
          {workspaces.length === 1 && activeWorkspace && (
            <span style={{ fontSize: 11, color: "#6366f1", whiteSpace: "nowrap", padding: "0 4px" }}
              title={`Workspace: ${activeWorkspace.name}`}>
              🏢 {activeWorkspace.name}
            </span>
          )}
          <a href="/" className="btn btn-ghost btn-sm">← Admin</a>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowTestModal(true)} disabled={!currentGraph}>🧪 Test</button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={saveGraph} disabled={saving} title="Save (Ctrl+S)">
          {saving
            ? <><span style={{ animation: "spin .8s linear infinite", display: "inline-block" }}>⟳</span> Saving…</>
            : isDirty ? "💾 Save ●" : "💾 Save"}
        </button>
        <button className="btn btn-success btn-sm" onClick={() => runGraph()} disabled={running || !currentGraph}>
          {running
            ? <><span style={{ animation: "spin .8s linear infinite", display: "inline-block" }}>⟳</span> Running…</>
            : "▶ Run"}
        </button>
      </div>

      {/* ── Error banner ── */}
      {runError && (
        <div className="error-banner">
          <span className="eb-icon">✗</span>
          <div className="eb-body">
            <div className="eb-title">Run failed{runError.nodeName ? ` — node "${runError.nodeName}"` : ""}</div>
            <div className="eb-msg">{runError.msg}</div>
          </div>
          <button className="eb-close" onClick={() => setRunError(null)}>✕</button>
        </div>
      )}

      {/* ── Main canvas layout ── */}
      {mobileSidebarOpen && (
        <div className="sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-hidden="true"/>
      )}
      <div className="canvas-layout">
        <Palette search={paletteSearch} onSearch={setPaletteSearch} open={mobileSidebarOpen}/>
        <div className="flow-wrap" ref={reactFlowWrapper} style={{ position: "relative" }}>
          {/* ── Run overlay summary bar ── */}
          <RunOverlayBar
            run={inspectorRun}
            nodes={nodes}
            onClear={() => loadInspectorRun(null)}
          />
          {/* ── Alignment toolbar (shown when ≥2 nodes selected) ── */}
          <AlignmentToolbar
            nodes={nodes}
            edges={edges}
            setNodes={setNodes}
            onSaveSnap={saveSnap}
          />
          {/* ── Empty-state onboarding (no graph loaded) ── */}
          {!currentGraph && nodes.length === 0 && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 5,
              display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}>
              <div style={{
                textAlign: "center", maxWidth: 420, padding: "32px 28px",
                background: "#13152aee", border: "1px solid #2a2d3e",
                borderRadius: 16, boxShadow: "0 8px 32px #0008",
                pointerEvents: "auto",
              }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>⚡</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>
                  Welcome to HiveRunr Canvas
                </div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 24, lineHeight: 1.6 }}>
                  Build automation flows by connecting nodes. Drag from the left panel,
                  or start from a template below.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 24, flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    📂 Open / Browse flows
                  </button>
                  <button className="btn btn-ghost" onClick={() => {
                    setNodes([]); setEdges([]);
                    setCurrentGraph(null); setGraphName("Untitled Flow");
                    setShowModal(false);
                  }}>
                    + New blank flow
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  {QUICK_START_TEMPLATES.map(t => (
                    <button key={t.slug} className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "4px 10px", color: "#94a3b8" }}
                      onClick={() => startFromQuickTemplate(t.slug)}
                      disabled={quickTemplateBusy != null}
                      title={`Start from the ${t.label} template`}
                    >
                      {quickTemplateBusy === t.slug ? "⟳ Creating…" : `${t.icon} ${t.label}`}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 16, fontSize: 10, color: "#334155" }}>
                  Drag nodes from the left panel · Press <kbd style={{ background: "#1e2235", borderRadius: 3, padding: "1px 4px", fontSize: 9, border: "1px solid #2a2d3e" }}>?</kbd> for shortcuts
                </div>
              </div>
            </div>
          )}

          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={() => { onPaneClick(); setHoveredNodeId(null); }}
            onNodeContextMenu={onNodeContextMenu}
            onEdgeClick={onEdgeClick}
            onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onMoveStart={() => setContextMenu(null)}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            fitView
            deleteKeyCode="Delete"
            multiSelectionKeyCode="Shift"
            selectionOnDrag={!spacePanning}
            panOnDrag={spacePanning ? true : [1, 2]}
            panOnScroll
            panOnScrollMode="free"
            selectionMode={SelectionMode.Partial}
            style={{ background: "#0f1117", cursor: spacePanning ? "grab" : "default" }}
          >
            <Background variant={BackgroundVariant.Dots} color="#2a2d3e" gap={20} size={1}/>
            <Controls/>
            {showMap && (
              <MiniMap
                nodeColor={n => { const def = NODE_DEFS[n.data?.type]; return def ? def.color : "#475569"; }}
                nodeStrokeWidth={0}
                maskColor="#0f11178a"
                pannable
                zoomable
                style={{
                  background: "#1a1d2e", border: "1px solid #374151",
                  borderRadius: 10, boxShadow: "0 4px 16px rgba(0,0,0,.5)",
                  height: 120, width: 180,
                }}
              />
            )}
          </ReactFlow>
        </div>
        <ConfigPanel node={null} onChange={onNodeChange} onDelete={onDeleteNode} edges={edges}/>
      </div>

      {/* ── Node editor modal (slide-in panel when node selected) ── */}
      {selectedNode && (
        <NodeEditorModal
          key={selectedNode.id}
          node={selectedNode}
          onChange={onNodeChange}
          onDelete={onDeleteNode}
          onClose={() => setSelectedNode(null)}
          edges={edges}
          allNodes={nodes}
          credentials={credentials}
          onTestNode={testNode}
          onPinOutput={pinNodeOutput}
          currentGraph={currentGraph}
        />
      )}

      {showModal && (
        <OpenModal
          graphs={graphs}
          onClose={() => setShowModal(false)}
          onSelect={onSelectGraph}
          onNew={onNewGraph}
          onDuplicate={duplicateGraph}
          onDelete={deleteGraph}
          onRename={renameGraph}
          onFromTemplate={onFromTemplate}
          showToast={showToast}
        />
      )}

      <TestPayloadModal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        onRun={runGraph}
        testPayload={testPayload}
        onPayloadChange={setTestPayload}
      />

      <PermissionsModal
        isOpen={showPermissionsModal}
        onClose={() => setShowPermissionsModal(false)}
        graphId={currentGraph?.id}
        showToast={showToast}
      />

      <HistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        graphId={currentGraph?.id}
        showToast={showToast}
        onRestored={onRestored}
      />

      {selectedEdge && (
        <EdgeLabelModal
          edge={selectedEdge}
          value={edgeLabelInput}
          onChange={setEdgeLabelInput}
          onConfirm={updateEdgeLabel}
          onClose={() => setSelectedEdge(null)}
        />
      )}

      {validationIssues && (
        <ValidationModal
          issues={validationIssues.issues}
          onClose={() => setValidationIssues(null)}
          onRunAnyway={() => { runGraph(validationIssues.payload); setValidationIssues(null); }}
        />
      )}

      {confirmState && (
        <ConfirmModal
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={() => { confirmState.fn(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {contextMenu && (
        <NodeContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDuplicate={ctxDuplicateNode}
          onDelete={id => { onDeleteNode(id); setContextMenu(null); }}
          onToggleDisabled={ctxToggleDisabled}
          onCopyId={ctxCopyId}
          onRename={ctxRenameNode}
          onCopy={doCopy}
          onPaste={clipboardRef.current ? doPaste : null}
          onExtract={nodes.filter(n => n.selected).length > 1 ? () => setShowExtractModal(true) : null}
          onRunFrom={currentGraph ? doRunFrom : null}
          selectedCount={nodes.filter(n => n.selected).length || 1}
        />
      )}

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)}/>}

      <ExtractSubflowModal
        isOpen={showExtractModal}
        nodeCount={nodes.filter(n => n.selected).length}
        onConfirm={doExtractSubflow}
        onClose={() => setShowExtractModal(false)}
      />

      {showSearch && (
        <NodeSearchBar
          nodes={nodes}
          onJump={jumpToNode}
          onClose={() => setShowSearch(false)}
        />
      )}

      {replayEdit && (
        <ReplayEditModal
          runId={replayEdit.runId}
          payload={replayEdit.payload}
          onClose={() => setReplayEdit(null)}
          onSubmit={submitReplayEditCanvas}
        />
      )}

      {toast && <Toast key={toast.key} msg={toast.msg} type={toast.type} onDone={() => setToast(null)}/>}
    </>
    </ValidationContext.Provider>
  );
}

/* ── Root wrapper with ReactFlowProvider ───────────────────────────────── */
export function CanvasRoot() {
  return (
    <ReactFlowProvider>
      <CanvasApp/>
    </ReactFlowProvider>
  );
}

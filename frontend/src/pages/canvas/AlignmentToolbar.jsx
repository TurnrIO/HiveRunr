/**
 * AlignmentToolbar — floating bar shown when ≥2 nodes are selected.
 *
 * Props:
 *   nodes        {Array}    all current nodes
 *   setNodes     {Function} ReactFlow setNodes updater
 *   onSaveSnap   {Function} called after repositioning so undo/redo works
 */
import { useReactFlow } from "reactflow";

/* ── Alignment math ──────────────────────────────────────────────────────── */

function alignNodes(nodes, edges, op) {
  const sel = nodes.filter(n => n.selected && n.type !== "note");
  if (sel.length < 2) return nodes;

  // Node bounding values
  const lefts   = sel.map(n => n.position.x);
  const tops    = sel.map(n => n.position.y);
  const rights  = sel.map(n => n.position.x + (n.width  ?? 180));
  const bottoms = sel.map(n => n.position.y + (n.height ?? 50));

  const minX   = Math.min(...lefts);
  const maxX   = Math.max(...rights);
  const minY   = Math.min(...tops);
  const maxY   = Math.max(...bottoms);
  const midX   = (minX + maxX) / 2;
  const midY   = (minY + maxY) / 2;

  // For distribute: sort by position and spread evenly
  function distribute(axis) {
    const sorted = [...sel].sort((a, b) =>
      axis === "h" ? a.position.x - b.position.x : a.position.y - b.position.y
    );
    const totalNodeSize = sorted.reduce((s, n) =>
      s + (axis === "h" ? (n.width ?? 180) : (n.height ?? 50)), 0
    );
    const span = axis === "h" ? (maxX - minX) : (maxY - minY);
    const gap  = (span - totalNodeSize) / (sorted.length - 1);
    let cursor = axis === "h" ? minX : minY;
    const posMap = {};
    sorted.forEach(n => {
      posMap[n.id] = axis === "h"
        ? { x: cursor, y: n.position.y }
        : { x: n.position.x, y: cursor };
      cursor += (axis === "h" ? (n.width ?? 180) : (n.height ?? 50)) + gap;
    });
    return posMap;
  }

  const idSet = new Set(sel.map(n => n.id));

  return nodes.map(n => {
    if (!idSet.has(n.id)) return n;
    const w = n.width  ?? 180;
    const h = n.height ?? 50;
    let pos;
    switch (op) {
      case "align-left":    pos = { x: minX, y: n.position.y }; break;
      case "align-right":   pos = { x: maxX - w, y: n.position.y }; break;
      case "align-top":     pos = { x: n.position.x, y: minY }; break;
      case "align-bottom":  pos = { x: n.position.x, y: maxY - h }; break;
      case "center-h":      pos = { x: midX - w / 2, y: n.position.y }; break;
      case "center-v":      pos = { x: n.position.x, y: midY - h / 2 }; break;
      case "distribute-h":  pos = distribute("h")[n.id]; break;
      case "distribute-v":  pos = distribute("v")[n.id]; break;
      default: return n;
    }
    return { ...n, position: pos };
  });
}

/* ── Toolbar button ──────────────────────────────────────────────────────── */

function Btn({ title, children, onClick }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "#94a3b8", fontSize: 14, padding: "4px 7px", borderRadius: 5,
        lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
        transition: "background .12s, color .12s",
      }}
      onMouseEnter={e => { e.currentTarget.style.background = "#2a2d3e"; e.currentTarget.style.color = "#e2e8f0"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "none";    e.currentTarget.style.color = "#94a3b8"; }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div style={{ width: 1, height: 18, background: "#2a2d3e", margin: "0 2px", flexShrink: 0 }} />;
}

/* ── SVG icons (inline, 16×16) ───────────────────────────────────────────── */

const ICONS = {
  alignLeft:    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="2" height="12"/><rect x="4" y="4" width="7" height="3"/><rect x="4" y="9" width="10" height="3"/></svg>,
  alignRight:   <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="12" y="2" width="2" height="12"/><rect x="5" y="4" width="7" height="3"/><rect x="2" y="9" width="10" height="3"/></svg>,
  alignTop:     <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="2"/><rect x="4" y="4" width="3" height="7"/><rect x="9" y="4" width="3" height="10"/></svg>,
  alignBottom:  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="12" width="12" height="2"/><rect x="4" y="5" width="3" height="7"/><rect x="9" y="2" width="3" height="10"/></svg>,
  centerH:      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="7" y="2" width="2" height="12"/><rect x="3" y="5" width="10" height="3" rx="1"/><rect x="5" y="9" width="6" height="3" rx="1"/></svg>,
  centerV:      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="7" width="12" height="2"/><rect x="5" y="3" width="3" height="10" rx="1"/><rect x="9" y="5" width="3" height="6" rx="1"/></svg>,
  distH:        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="4" width="2" height="8"/><rect x="13" y="4" width="2" height="8"/><rect x="6" y="5" width="4" height="6" rx="1"/></svg>,
  distV:        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="1" width="8" height="2"/><rect x="4" y="13" width="8" height="2"/><rect x="5" y="6" width="6" height="4" rx="1"/></svg>,
};

/* ── Main component ──────────────────────────────────────────────────────── */

export function AlignmentToolbar({ nodes, edges, setNodes, onSaveSnap }) {
  const selectedCount = nodes.filter(n => n.selected).length;
  if (selectedCount < 2) return null;

  function apply(op) {
    setNodes(ns => {
      const updated = alignNodes(ns, edges, op);
      onSaveSnap && onSaveSnap(updated, edges);
      return updated;
    });
  }

  return (
    <div
      style={{
        position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
        zIndex: 20, display: "flex", alignItems: "center", gap: 2,
        background: "#13152a", border: "1px solid #2a2d3e",
        borderRadius: 10, padding: "5px 8px",
        boxShadow: "0 4px 20px rgba(0,0,0,.5)",
        userSelect: "none",
        pointerEvents: "all",
      }}
    >
      <span style={{ fontSize: 10, color: "#475569", marginRight: 4, whiteSpace: "nowrap" }}>
        {selectedCount} selected
      </span>
      <Sep />

      {/* Align group */}
      <Btn title="Align left edges"   onClick={() => apply("align-left")}   >{ICONS.alignLeft}</Btn>
      <Btn title="Align right edges"  onClick={() => apply("align-right")}  >{ICONS.alignRight}</Btn>
      <Btn title="Align top edges"    onClick={() => apply("align-top")}    >{ICONS.alignTop}</Btn>
      <Btn title="Align bottom edges" onClick={() => apply("align-bottom")} >{ICONS.alignBottom}</Btn>
      <Sep />

      {/* Center group */}
      <Btn title="Center horizontally" onClick={() => apply("center-h")} >{ICONS.centerH}</Btn>
      <Btn title="Center vertically"   onClick={() => apply("center-v")} >{ICONS.centerV}</Btn>
      <Sep />

      {/* Distribute group */}
      <Btn title="Distribute horizontally (equal spacing)" onClick={() => apply("distribute-h")} >{ICONS.distH}</Btn>
      <Btn title="Distribute vertically (equal spacing)"   onClick={() => apply("distribute-v")} >{ICONS.distV}</Btn>
    </div>
  );
}

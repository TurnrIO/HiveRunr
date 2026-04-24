import { useState } from "react";
import { NODE_DEFS, GROUPS } from "./nodeDefs.js";

// Triggers and Actions are open by default; Integrations and Utilities collapsed.
const DEFAULT_OPEN = new Set(["trigger", "action"]);

export function Palette({ search, onSearch, open }) {
  const [collapsed, setCollapsed] = useState(
    () => new Set(GROUPS.map(g => g.id).filter(id => !DEFAULT_OPEN.has(id)))
  );

  function toggle(groupId) {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }

  function onDragStart(e, type) {
    e.dataTransfer.setData("application/reactflow-type", type);
    e.dataTransfer.effectAllowed = "move";
  }

  const q        = search.toLowerCase();
  const filtered = Object.entries(NODE_DEFS).filter(([type, def]) =>
    !q || def.label.toLowerCase().includes(q) || type.includes(q)
  );
  const isSearching = q.length > 0;

  return (
    <div className={`sidebar${open ? " sidebar-open" : ""}`}>
      <div className="sidebar-search">
        <input
          placeholder="🔍 Search nodes…"
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
      </div>
      <div className="sidebar-scroll">
        {GROUPS.map(g => {
          const items = filtered.filter(([, d]) => d.group === g.id);
          if (!items.length) return null;
          // Auto-expand when searching; otherwise respect collapsed state
          const isOpen = isSearching || !collapsed.has(g.id);
          return (
            <div key={g.id}>
              <button
                className="sidebar-group-header"
                onClick={() => toggle(g.id)}
                aria-expanded={isOpen}
                title={isOpen ? `Collapse ${g.label}` : `Expand ${g.label}`}
              >
                <span>{g.label}</span>
                <span className="sidebar-group-count">{items.length}</span>
                <span className="sidebar-group-chevron">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && items.map(([type, def]) => (
                <div
                  key={type}
                  className="node-palette-item"
                  draggable
                  onDragStart={e => onDragStart(e, type)}
                  title={type}
                >
                  <div
                    className="node-icon"
                    style={{ background: def.color + "22", color: def.color }}
                  >
                    {def.icon}
                  </div>
                  <div>
                    <div className="node-label">{def.label}</div>
                    <div className="node-sublabel">{type}</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { NODE_DEFS, GROUPS } from "./nodeDefs.js";

export function Palette({ search, onSearch, open }) {
  function onDragStart(e, type) {
    e.dataTransfer.setData("application/reactflow-type", type);
    e.dataTransfer.effectAllowed = "move";
  }

  const q        = search.toLowerCase();
  const filtered = Object.entries(NODE_DEFS).filter(([type, def]) =>
    !q || def.label.toLowerCase().includes(q) || type.includes(q)
  );

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
          return (
            <div key={g.id}>
              <div className="sidebar-title">{g.label}</div>
              {items.map(([type, def]) => (
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

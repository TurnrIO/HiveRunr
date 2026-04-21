import { useEffect } from "react";
import { NODE_DEFS } from "./nodeDefs.js";

export function NodeContextMenu({ menu, onClose, onDuplicate, onDelete, onToggleDisabled, onCopyId, onRename }) {
  const node       = menu.node;
  const isDisabled = !!node.data.disabled;
  const isNote     = node.data.type === "note";

  useEffect(() => {
    const close = (e) => { if (!e.target.closest(".ctx-menu")) onClose(); };
    window.addEventListener("mousedown", close, true);
    return () => window.removeEventListener("mousedown", close, true);
  }, [onClose]);

  // Keep menu within viewport
  const style = {
    left: Math.min(menu.x, window.innerWidth - 190),
    top:  Math.min(menu.y, window.innerHeight - 240),
  };

  return (
    <div className="ctx-menu" style={style}>
      <div className="ctx-label">
        {(NODE_DEFS[node.data.type] || {}).label || node.data.type}
      </div>
      <div className="ctx-item" onClick={() => { onRename(node); onClose(); }}>
        ✏ Rename
      </div>
      <div className="ctx-item" onClick={() => { onCopyId(node.id); onClose(); }}>
        📋 Copy ID
      </div>
      <div className="ctx-divider" />
      <div className="ctx-item" onClick={() => { onDuplicate(node); onClose(); }}>
        ⧉ Duplicate node
      </div>
      {!isNote && (
        <div className="ctx-item" onClick={() => { onToggleDisabled(node.id); onClose(); }}>
          {isDisabled ? "▶ Enable node" : "⏸ Disable node"}
        </div>
      )}
      <div className="ctx-divider" />
      <div className="ctx-item danger" onClick={() => { onDelete(node.id); onClose(); }}>
        🗑 Delete node
      </div>
    </div>
  );
}

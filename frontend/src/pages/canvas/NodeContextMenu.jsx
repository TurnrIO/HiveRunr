import { useEffect } from "react";
import { NODE_DEFS } from "./nodeDefs.js";

export function NodeContextMenu({ menu, onClose, onDuplicate, onDelete, onToggleDisabled, onCopyId, onRename, onCopy, onPaste, onExtract, selectedCount }) {
  const node       = menu.node;
  const isDisabled = !!node.data.disabled;
  const isNote     = node.data.type === "note";
  const multi      = selectedCount > 1;

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
      <div className="ctx-item" onClick={() => { onCopy(); onClose(); }}>
        {multi ? `⧉ Copy ${selectedCount} nodes (Ctrl+C)` : "⧉ Copy node (Ctrl+C)"}
      </div>
      {onPaste && (
        <div className="ctx-item" onClick={() => { onPaste(); onClose(); }}>
          📋 Paste (Ctrl+V)
        </div>
      )}
      <div className="ctx-divider" />
      <div className="ctx-item" onClick={() => { onDuplicate(node); onClose(); }}>
        {multi ? `⊞ Duplicate ${selectedCount} nodes (Ctrl+D)` : "⊞ Duplicate node (Ctrl+D)"}
      </div>
      {!isNote && (
        <div className="ctx-item" onClick={() => { onToggleDisabled(node.id); onClose(); }}>
          {isDisabled ? "▶ Enable node" : "⏸ Disable node"}
        </div>
      )}
      {multi && onExtract && (
        <>
          <div className="ctx-divider" />
          <div className="ctx-item" onClick={() => { onExtract(); onClose(); }}>
            ⛓ Extract {selectedCount} nodes to subflow…
          </div>
        </>
      )}
      <div className="ctx-divider" />
      <div className="ctx-item danger" onClick={() => { onDelete(node.id); onClose(); }}>
        🗑 Delete node
      </div>
    </div>
  );
}

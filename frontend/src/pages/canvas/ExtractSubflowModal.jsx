/**
 * ExtractSubflowModal — confirms name + description before extracting
 * selected nodes into a new subflow.
 *
 * Props:
 *   isOpen       {bool}
 *   nodeCount    {number}   number of selected nodes being extracted
 *   onConfirm    {(name, description) => void}
 *   onClose      {() => void}
 */
import { useState, useEffect, useRef } from "react";
import { useFocusTrap } from "../../components/useFocusTrap.js";

export function ExtractSubflowModal({ isOpen, nodeCount, onConfirm, onClose }) {
  const [name, setName]   = useState("New Subflow");
  const [desc, setDesc]   = useState("");
  const [busy, setBusy]   = useState(false);
  const ref               = useRef(null);
  useFocusTrap(ref, onClose);

  useEffect(() => {
    if (isOpen) { setName("New Subflow"); setDesc(""); setBusy(false); }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleConfirm(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onConfirm(name.trim(), desc.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
      aria-hidden="true"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Extract to subflow"
        className="modal-panel"
        style={{ width: 420, maxWidth: "95vw" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ fontSize: 16, fontWeight: 600 }}>⛓ Extract to Subflow</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "16px 20px" }}>
          <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16, lineHeight: 1.6 }}>
            The <strong style={{ color: "#a78bfa" }}>{nodeCount} selected node{nodeCount !== 1 ? "s" : ""}</strong> will
            be moved into a new flow. A <strong style={{ color: "#6366f1" }}>Call Sub-flow</strong> node will replace
            them in the current flow.
          </p>

          <form onSubmit={handleConfirm}>
            <div className="field-group">
              <label className="field-label">Subflow name</label>
              <input
                className="field-input"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="New Subflow"
                autoFocus
                required
              />
            </div>
            <div className="field-group" style={{ marginBottom: 20 }}>
              <label className="field-label">Description (optional)</label>
              <textarea
                className="field-input"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder="What does this subflow do?"
                rows={2}
                style={{ resize: "vertical" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? "Extracting…" : "⛓ Extract"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

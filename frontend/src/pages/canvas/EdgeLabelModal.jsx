/**
 * EdgeLabelModal — small popup for editing or removing an edge label.
 */
export function EdgeLabelModal({ edge, value, onChange, onConfirm, onClose }) {
  if (!edge) return null;
  return (
    <div
      className="modal-overlay"
      aria-hidden="true"
      onClick={e => { if (e.target.className === "modal-overlay") onClose(); }}
    >
      <div
        className="modal"
        style={{ minWidth: 300 }}
        role="dialog"
        aria-modal="true"
        aria-label="Edge Label"
      >
        <h2>✏ Edge Label</h2>
        <div className="field-group">
          <input
            className="field-input"
            placeholder="Label (leave blank to remove)"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter")  onConfirm(value);
              if (e.key === "Escape") onClose();
            }}
            autoFocus
          />
        </div>
        <div className="modal-btns">
          <button className="btn btn-ghost"   onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onConfirm(value)}>Set label</button>
          {edge.label && (
            <button className="btn btn-danger" onClick={() => onConfirm("")}>Remove</button>
          )}
        </div>
      </div>
    </div>
  );
}

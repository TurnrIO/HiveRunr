/**
 * TestPayloadModal — lets the user supply a custom JSON payload before
 * triggering a manual test run of the current flow.
 */
export function TestPayloadModal({ isOpen, onClose, onRun, testPayload, onPayloadChange }) {
  if (!isOpen) return null;
  return (
    <div
      className="modal-overlay"
      aria-hidden="true"
      onClick={e => { if (e.target.className === "modal-overlay") onClose(); }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Test Payload">
        <h2>🧪 Test Payload</h2>
        <div className="field-group">
          <label style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500, marginBottom: 4, display: "block" }}>
            JSON
          </label>
          <textarea
            className="field-input mono"
            rows={8}
            value={testPayload}
            onChange={e => onPayloadChange(e.target.value)}
            placeholder='{"key":"value"}'
          />
        </div>
        <div className="modal-btns">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-success"
            onClick={() => { onRun(testPayload); onClose(); }}
          >
            Run with payload
          </button>
        </div>
      </div>
    </div>
  );
}

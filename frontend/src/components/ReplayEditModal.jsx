import { useState, useRef } from "react";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * ReplayEditModal — lets the user edit the trigger payload before replaying a run.
 *
 * Props:
 *   runId       {number|string} — ID of the run to replay
 *   payload     {string}        — JSON string of the initial payload (pre-filled)
 *   onClose     {function}      — called when the modal is dismissed
 *   onSubmit    {function}      — called with (runId, payloadString) when the user confirms
 */
export function ReplayEditModal({ runId, payload: initPayload, onClose, onSubmit }) {
  const [payload, setPayload] = useState(initPayload || "{}");
  const ref = useRef(null);
  useFocusTrap(ref, onClose);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      aria-hidden="true"
    >
      <div
        className="modal"
        ref={ref}
        style={{ maxWidth: 480, padding: "20px 24px" }}
        role="dialog"
        aria-modal="true"
        aria-label="Replay with custom payload"
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 14, color: "#e2e8f0" }}>
            ✏ Replay Run #{runId} with Custom Payload
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 12 }}>
          Edit the trigger payload below. The run will be re-enqueued with this
          data instead of the original.
        </p>

        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={10}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#0f1117",
            border: "1px solid #374151",
            borderRadius: 6,
            padding: "8px 10px",
            color: "#e2e8f0",
            fontFamily: "monospace",
            fontSize: 12,
            resize: "vertical",
            outline: "none",
          }}
          aria-label="Payload JSON"
          spellCheck={false}
        />

        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 14,
            justifyContent: "flex-end",
          }}
        >
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            onClick={() => onSubmit(runId, payload)}
          >
            ▶ Run with this payload
          </button>
        </div>
      </div>
    </div>
  );
}

import { useRef } from "react";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * ConfirmModal — generic confirmation dialog.
 *
 * Props:
 *   message      {string}   — question / warning text shown in the dialog
 *   confirmLabel {string}   — label for the confirm button (default: "Confirm")
 *   onConfirm    {function} — called when the user confirms
 *   onCancel     {function} — called when the user cancels (or presses Escape)
 */
export function ConfirmModal({
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  useFocusTrap(ref, onCancel);

  return (
    <div className="modal-overlay" onClick={onCancel} aria-hidden="true">
      <div
        className="modal"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={message}
        ref={ref}
      >
        <p style={{ margin: "0 0 20px", color: "#e2e8f0", fontSize: 14, lineHeight: 1.6 }}>
          {message}
        </p>
        <div className="modal-btns">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

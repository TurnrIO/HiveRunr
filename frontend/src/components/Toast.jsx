import { useEffect } from "react";

/**
 * Toast notification — auto-dismisses after 3 seconds.
 *
 * Props:
 *   msg    {string}   — message text
 *   type   {string}   — "success" | "error"
 *   onDone {function} — called when the timer fires
 */
export function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`toast ${type === "error" ? "err" : "ok"}`}
      role="status"
      aria-live="polite"
    >
      {type === "error" ? "✗" : "✓"} {msg}
    </div>
  );
}

import { useEffect } from "react";

const FOCUSABLE =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus trapped inside `ref.current` while the element is mounted.
 *
 * - Auto-focuses the first focusable child on mount.
 * - Tab / Shift+Tab wrap around within the container.
 * - Calls `onEscape` when the Escape key is pressed (optional).
 * - Restores focus to the previously focused element on unmount.
 *
 * @param {React.RefObject} ref       — ref attached to the container element
 * @param {function}        [onEscape] — callback fired on Escape key
 */
export function useFocusTrap(ref, onEscape) {
  useEffect(() => {
    const el = ref?.current;
    if (!el) return;
    const escapeHandler = typeof onEscape === "function" ? onEscape : null;

    const first = () => el.querySelectorAll(FOCUSABLE)[0];
    const last  = () => {
      const all = el.querySelectorAll(FOCUSABLE);
      return all[all.length - 1];
    };

    // Auto-focus first focusable element
    const prev = document.activeElement;
    requestAnimationFrame(() => {
      const f = first();
      if (f) f.focus();
    });

    const trap = (e) => {
      if (e.key === "Escape") {
        escapeHandler?.();
        return;
      }
      if (e.key !== "Tab") return;
      const f = first();
      const l = last();
      if (!f) return;
      if (e.shiftKey) {
        if (document.activeElement === f) {
          e.preventDefault();
          l?.focus();
        }
      } else {
        if (document.activeElement === l) {
          e.preventDefault();
          f?.focus();
        }
      }
    };

    el.addEventListener("keydown", trap);
    return () => {
      el.removeEventListener("keydown", trap);
      prev?.focus?.();
    };
  }, [ref, onEscape]);
}

import { useState, useRef } from "react";

/**
 * VarField — input or textarea with {{ template-variable autocomplete.
 * Shows a dropdown of upstream node outputs and credential references
 * when the user types "{{" in the field.
 */
export function VarField({ multiline, value, onChangeValue, vars, className, placeholder, type, rows, ...rest }) {
  const [show,   setShow]   = useState(false);
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const elRef = useRef(null);

  function detectTrigger(el) {
    const pos    = el.selectionStart || 0;
    const before = (el.value || "").slice(0, pos);
    const ddIdx  = before.lastIndexOf("{{");
    if (ddIdx !== -1 && !before.slice(ddIdx).includes("}}")) {
      setFilter(before.slice(ddIdx + 2).toLowerCase());
      setShow(true);
      setCursor(0);
    } else {
      setShow(false);
    }
  }

  function handleChange(e) {
    onChangeValue(e.target.value);
    detectTrigger(e.target);
  }

  function handleKeyDown(e) {
    if (!show || !filtered.length) return;
    if (e.key === "ArrowDown")  { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    else if (e.key === "Enter")   { e.preventDefault(); insertVar(filtered[cursor]); }
    else if (e.key === "Escape")  { e.preventDefault(); setShow(false); }
  }

  function insertVar(v) {
    const el = elRef.current;
    if (!el) return;
    const pos    = el.selectionStart || 0;
    const val    = value || "";
    const before = val.slice(0, pos);
    const after  = val.slice(pos);
    const ddIdx  = before.lastIndexOf("{{");
    const newVal = before.slice(0, ddIdx) + v.template + after;
    onChangeValue(newVal);
    setShow(false);
    setTimeout(() => {
      try {
        const newPos = ddIdx + v.template.length;
        el.selectionStart = el.selectionEnd = newPos;
        el.focus();
      } catch (e) { /* noop */ }
    }, 0);
  }

  const filtered = (vars || []).filter(v => {
    if (!filter) return true;
    return (
      v.label.toLowerCase().includes(filter) ||
      v.template.toLowerCase().includes(filter) ||
      (v.nodeLabel || "").toLowerCase().includes(filter)
    );
  }).slice(0, 30);

  // Group by nodeLabel for dropdown display
  const groups = [];
  const seen   = new Map();
  for (const v of filtered) {
    const g = v.isCred ? "Credentials" : (v.nodeLabel || "Upstream");
    if (!seen.has(g)) { seen.set(g, []); groups.push({ label: g, items: [] }); }
    seen.get(g).push(v);
    groups.find(x => x.label === g).items.push(v);
  }

  const sharedProps = {
    ref:      elRef,
    className: className || "field-input",
    placeholder,
    value:    value || "",
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur:   () => setTimeout(() => setShow(false), 180),
    onClick:  e => detectTrigger(e.target),
    ...rest,
  };

  return (
    <div className="var-wrap">
      {multiline
        ? <textarea {...sharedProps} rows={rows || 4} />
        : <input    {...sharedProps} type={type || "text"} />
      }
      {!show && <span className="var-trigger-hint">type {"{{"}  for vars</span>}
      {show && filtered.length > 0 && (
        <div className="var-dropdown">
          {groups.map((g, gi) => (
            <div key={gi}>
              <div className="var-dropdown-section">{g.label}</div>
              {g.items.map(v => {
                const globalIdx = filtered.indexOf(v);
                return (
                  <div
                    key={v.template}
                    className={`var-dropdown-item${globalIdx === cursor ? " active" : ""}`}
                    onMouseDown={e => { e.preventDefault(); insertVar(v); }}
                  >
                    <span className="var-dropdown-label" style={v.dimmed ? { color: "#475569" } : {}}>{v.label}</span>
                    <span className="var-dropdown-tmpl">{v.template}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

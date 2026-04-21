import { useState, useEffect } from "react";
import { api } from "../../api/client.js";

const HOUR_LABELS = [
  "Midnight","1 AM","2 AM","3 AM","4 AM","5 AM","6 AM","7 AM",
  "8 AM","9 AM","10 AM","11 AM","Noon","1 PM","2 PM","3 PM",
  "4 PM","5 PM","6 PM","7 PM","8 PM","9 PM","10 PM","11 PM",
];
const WEEKDAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const pill = (active, onClick, children, extra = {}) => (
  <span onClick={onClick} style={{
    padding: "3px 10px", borderRadius: 20, fontSize: 12, cursor: "pointer", userSelect: "none",
    fontWeight: 600, border: "1px solid",
    background: active ? "#7c3aed" : "transparent",
    borderColor: active ? "#7c3aed" : "#2a2d3e",
    color: active ? "#fff" : "#64748b",
    ...extra,
  }}>{children}</span>
);

const sel = (val, opts, onChange_) => (
  <select value={val} onChange={e => onChange_(+e.target.value || e.target.value)} style={{ flex: 1, minWidth: 0 }}>
    {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

const num = (val, min, max, onChg) => (
  <input type="number" value={val} min={min} max={max} onChange={e => onChg(+e.target.value)} style={{ width: 70 }} />
);

const row = (label, children) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
    <span style={{ width: 160, fontSize: 12, color: "#94a3b8", flexShrink: 0 }}>{label}</span>
    {children}
  </div>
);

export function CronBuilder({ value, onChange, timezone }) {
  const [mode, setMode] = useState("fixed");
  const [type, setType] = useState("day");
  const [cfg, setCfg] = useState({
    minuteInterval: 15,
    hourInterval: 1,  hourMinute: 0,
    dayInterval: 1,   dayHour: 9,   dayMinute: 0,
    weekDays: [1],    weekHour: 9,  weekMinute: 0,
    monthDay: 1,      monthHour: 9, monthMinute: 0,
  });
  const [expr, setExpr] = useState(value || "0 9 * * *");
  const [nextRun, setNextRun] = useState(null);
  const [fetchingNext, setFetchingNext] = useState(false);

  function buildCron(t, c) {
    switch (t || type) {
      case "minute": return `*/${c.minuteInterval || 1} * * * *`;
      case "hour":   return `${c.hourMinute} */${c.hourInterval || 1} * * *`;
      case "day":    return `${c.dayMinute} ${c.dayHour} */${c.dayInterval || 1} * *`;
      case "week":   return `${c.weekMinute} ${c.weekHour} * * ${(c.weekDays.length ? c.weekDays : [0]).sort().join(",")}`;
      case "month":  return `${c.monthMinute} ${c.monthHour} ${c.monthDay} * *`;
      default:       return "0 9 * * *";
    }
  }

  function update(patch, newType) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (mode === "fixed") onChange(buildCron(newType || type, next));
  }

  function switchMode(m) {
    setMode(m);
    if (m === "fixed") onChange(buildCron(type, cfg));
    else onChange(expr);
  }

  function switchType(t) {
    setType(t);
    if (mode === "fixed") onChange(buildCron(t, cfg));
  }

  function toggleDay(d) {
    const days = cfg.weekDays.includes(d)
      ? cfg.weekDays.filter(x => x !== d)
      : [...cfg.weekDays, d];
    update({ weekDays: days.length ? days : [d] });
  }

  useEffect(() => { if (mode === "fixed") onChange(buildCron(type, cfg)); }, []);

  const preview = mode === "fixed" ? buildCron(type, cfg) : expr;

  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(async () => {
      setFetchingNext(true);
      try {
        const tz = encodeURIComponent(timezone || "UTC");
        const r = await api("GET", `/api/schedules/next-run?cron=${encodeURIComponent(preview)}&timezone=${tz}&count=3`);
        setNextRun(r);
      } catch (e) { setNextRun({ valid: false, error: e.message }); }
      setFetchingNext(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [preview, timezone]);

  const minuteOpts = [1, 2, 5, 10, 15, 20, 30].map(n => [n, `${n} min${n > 1 ? "s" : ""}`]);
  const hourOpts   = [1, 2, 3, 4, 6, 8, 12].map(n => [n, `${n} hour${n > 1 ? "s" : ""}`]);
  const hourSel    = HOUR_LABELS.map((l, i) => [i, l]);
  const minSel     = Array.from({ length: 60 }, (_, i) => [i, String(i).padStart(2, "0")]);

  return (
    <div style={{ background: "#13151f", border: "1px solid #1e2130", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>Trigger Schedule</span>
        <div style={{ display: "flex", gap: 4 }}>
          {pill(mode === "fixed", () => switchMode("fixed"), "Fixed")}
          {pill(mode === "expr",  () => switchMode("expr"),  "Expression")}
        </div>
      </div>

      {mode === "expr" ? (
        <input value={expr} onChange={e => { setExpr(e.target.value); onChange(e.target.value); }}
          placeholder="0 9 * * *" style={{ width: "100%", fontFamily: "monospace" }} />
      ) : (
        <>
          {row("Trigger Interval",
            <select value={type} onChange={e => switchType(e.target.value)} style={{ flex: 1 }}>
              <option value="minute">Minutes</option>
              <option value="hour">Hours</option>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </select>
          )}

          {type === "minute" && row("Every", sel(cfg.minuteInterval, minuteOpts, v => update({ minuteInterval: v })))}

          {type === "hour" && <>
            {row("Every",     sel(cfg.hourInterval, hourOpts, v => update({ hourInterval: v })))}
            {row("At Minute", num(cfg.hourMinute, 0, 59, v => update({ hourMinute: v })))}
          </>}

          {type === "day" && <>
            {row("Every",     sel(cfg.dayInterval, [1, 2, 3, 7, 14].map(n => [n, `${n} day${n > 1 ? "s" : ""}`]), v => update({ dayInterval: v })))}
            {row("At Hour",   sel(cfg.dayHour,   hourSel, v => update({ dayHour: v })))}
            {row("At Minute", num(cfg.dayMinute, 0, 59,   v => update({ dayMinute: v })))}
          </>}

          {type === "week" && <>
            {row("On Days",
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {WEEKDAY_LABELS.map((d, i) => pill(cfg.weekDays.includes(i), () => toggleDay(i), d, { fontSize: 11 }))}
              </div>
            )}
            {row("At Hour",   sel(cfg.weekHour,   hourSel, v => update({ weekHour: v })))}
            {row("At Minute", num(cfg.weekMinute, 0, 59,   v => update({ weekMinute: v })))}
          </>}

          {type === "month" && <>
            {row("On Day",    num(cfg.monthDay,   1, 31, v => update({ monthDay: v })))}
            {row("At Hour",   sel(cfg.monthHour,  hourSel, v => update({ monthHour: v })))}
            {row("At Minute", num(cfg.monthMinute, 0, 59, v => update({ monthMinute: v })))}
          </>}
        </>
      )}

      <div style={{ marginTop: 10, padding: "7px 10px", background: "#0d0f1a", borderRadius: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: nextRun ? 4 : 0 }}>
          <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>cron</span>
          <code style={{ fontSize: 12, color: nextRun?.valid === false ? "#f87171" : "#a78bfa", fontFamily: "monospace" }}>{preview}</code>
          {nextRun?.valid === false && <span style={{ fontSize: 10, color: "#f87171", marginLeft: 4 }}>⚠ invalid</span>}
        </div>
        {nextRun?.valid === false && nextRun.error && (
          <div style={{ fontSize: 11, color: "#f87171", marginTop: 2 }}>{nextRun.error}</div>
        )}
        {nextRun?.valid && nextRun.next?.length > 0 && (
          <div style={{ fontSize: 11, color: "#4ade80", marginTop: 2 }}>
            Next: {new Date(nextRun.next[0]).toLocaleString()}
            {nextRun.next[1] && <span style={{ color: "#475569" }}> · {new Date(nextRun.next[1]).toLocaleString()}</span>}
          </div>
        )}
        {fetchingNext && <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>checking…</div>}
      </div>
    </div>
  );
}

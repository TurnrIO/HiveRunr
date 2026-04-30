import { useState, useEffect } from "react";
import { api } from "../../api/client.js";

export function CronNextRun({ cron, timezone, enabled, runAt }) {
  const [info, setInfo] = useState(null);
  const [now, setNow]   = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (runAt) { setInfo({ valid: true, next: [runAt] }); return; }
    if (!cron) return;
    let cancelled = false;
    api("GET", `/api/schedules/next-run?cron=${encodeURIComponent(cron)}&timezone=${encodeURIComponent(timezone || "UTC")}&count=1`)
      .then(r  => { if (!cancelled) setInfo(r); })
      .catch(() => { if (!cancelled) setInfo({ valid: false }); });
    return () => { cancelled = true; };
  }, [cron, timezone, runAt]);

  function fmtRelative(isoStr) {
    const diff = new Date(isoStr) - now;
    if (diff <= 0) return "now";
    const s = Math.floor(diff / 1000);
    if (s < 60) return `in ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `in ${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `in ${d}d ${h % 24}h`;
  }

  if (!info)              return <span style={{ fontSize: 11, color: "var(--text-muted-2)" }}>—</span>;
  if (!info.valid)        return <span style={{ fontSize: 11, color: "var(--danger)" }}>⚠ invalid cron</span>;
  if (!enabled)           return <span style={{ fontSize: 11, color: "var(--text-muted-2)" }}>paused</span>;
  if (!info.next?.length) return <span style={{ fontSize: 11, color: "var(--text-muted-2)" }}>—</span>;

  return (
    <span style={{ fontSize: 11 }}>
      <span style={{ color: "var(--success)", fontWeight: 600 }}>{fmtRelative(info.next[0])}</span>
      <span style={{ color: "var(--text-muted-2)", marginLeft: 6 }}>{new Date(info.next[0]).toLocaleString()}</span>
    </span>
  );
}

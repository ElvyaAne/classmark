import type { HistoryPoint } from "../api";
import { progress, type MetricProgress } from "../stats";

const W = 120;
const H = 28;
const PAD = 3;

const dayMs = (d: string) => Date.parse(d + "T00:00:00Z");
const longDate = (d: string) =>
  new Date(dayMs(d)).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Your own numbers over time: one small line per metric, from your first save to now. Only you see it. */
export function Progress({ history, scale }: { history: HistoryPoint[]; scale: number }) {
  if (history.length < 2) {
    return (
      <p className="muted small">
        Classmark keeps each day's numbers when you save, so you can see how they change. Come back and update them later in the
        term, and your progress shows up here. Only you can see it.
      </p>
    );
  }
  const rows = progress(history);
  const from = history[0].day;
  const to = history[history.length - 1].day;
  return (
    <div className="stack tight">
      <p className="muted small">
        {history.length} check-ins from {longDate(from)} to {longDate(to)}. Only you can see this, and deleting your numbers deletes it.
      </p>
      <div className="progress">
        {rows.map((r) => <Row key={r.metric.key} r={r} scale={scale} span={[dayMs(from), dayMs(to)]} />)}
      </div>
    </div>
  );
}

function Row({ r, scale, span }: { r: MetricProgress; scale: number; span: [number, number] }) {
  const gpa = r.metric.key === "gpa_pct";
  const show = (v: number) => (gpa ? `${v} / ${scale}` : r.metric.format(v));
  const values = r.points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (d: string) => PAD + ((dayMs(d) - span[0]) / (span[1] - span[0] || 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - PAD * 2) - (hi === lo ? (H - PAD * 2) / 2 : 0);
  const line = r.points.map((p) => `${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = r.points[r.points.length - 1];
  const sign = r.change > 0 ? "+" : r.change < 0 ? "−" : "";
  const delta = r.change === 0 ? "no change" : `${sign}${gpa ? Math.abs(r.change) : r.metric.format(Math.abs(r.change))}`;
  return (
    <div className="progress-row">
      <span className="small">{r.metric.label}</span>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${r.metric.label}: from ${show(r.first)} to ${show(r.last)}`}>
        <polyline points={line} fill="none" stroke="var(--peer)" strokeWidth={1.5} strokeLinejoin="round" />
        <circle cx={x(last.day)} cy={y(last.value)} r={3} fill="var(--you)" />
      </svg>
      <span className="val">{show(r.first)} → {show(r.last)}</span>
      <span className={`small delta ${r.change > 0 ? "tone-good" : "muted"}`}>{delta}</span>
    </div>
  );
}

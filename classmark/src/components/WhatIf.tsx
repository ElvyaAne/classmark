import { useEffect, useMemo, useState } from "react";
import type { MetricKey, ResponseInput } from "../api";
import { fieldOf, gaps, ordinal, overall, scoreMetrics, withValue, type MetricResult, type Weights } from "../stats";

interface Props {
  me: ResponseInput;
  /** The school's GPA scale (10, 4.0, 100…). */
  scale: number;
  results: MetricResult[];
  peerMetrics: Partial<Record<MetricKey, number[] | null>> | null;
  weights: Weights;
}

/** Slider bounds for a metric's raw value: from 0 to comfortably past you and the top of the group. */
function range(key: MetricKey, scale: number, current: number, top: number) {
  if (key === "gpa_pct") return { max: scale, step: scale <= 5 ? 0.01 : scale <= 12 ? 0.1 : 1 };
  if (key === "leetcode") return { max: Math.ceil(Math.max(500, current + 300, top) / 50) * 50, step: 5 };
  if (key === "work_months") return { max: Math.max(48, current + 24, top), step: 1 };
  return { max: Math.max(10, current + 10, top), step: 1 };
}

/** Raw value (school scale for GPA) to reach a metric-space target like the 75th percentile. */
function rawFor(key: MetricKey, target: number, scale: number, step: number) {
  const raw = key === "gpa_pct" ? (target / 100) * scale : target;
  return Math.ceil(raw / step - 1e-9) * step;
}

/**
 * "What if": move one of your numbers and see the new percentile and overall standing against the
 * same peers. Runs in the browser only; nothing is saved or sent.
 */
export function WhatIf({ me, scale, results, peerMetrics, weights }: Props) {
  const choices = results.filter((r) => r.peers != null);
  const suggested = gaps(results, 1, weights)[0]?.metric.key ?? choices[0]?.metric.key ?? null;
  const [key, setKey] = useState<MetricKey | null>(suggested);
  const active = choices.find((r) => r.metric.key === key) ?? choices[0] ?? null;
  const current = active ? Number(me[fieldOf(active.metric.key)] ?? 0) : 0;
  const [value, setValue] = useState(current);

  // start from your real number whenever the metric (or your saved numbers) change
  useEffect(() => setValue(current), [active?.metric.key, current]);

  const projected = useMemo(() => {
    if (!active) return null;
    const next = scoreMetrics(withValue(me, active.metric.key, value), scale, peerMetrics);
    return { metric: next.find((r) => r.metric.key === active.metric.key)!, overall: overall(next, weights) };
  }, [active, me, value, scale, peerMetrics, weights]);

  if (!active || !projected) {
    return <p className="muted small">Once enough peers answer a metric, you can try changing it here.</p>;
  }

  const k = active.metric.key;
  const top = Math.max(0, ...(active.peers ?? []).map((v) => (k === "gpa_pct" ? (v / 100) * scale : v)));
  const { max, step } = range(k, scale, current, top);
  const show = (raw: number) => (k === "gpa_pct" ? `${Number(raw.toFixed(2))} / ${scale}` : active.metric.format(raw));
  const target = active.p75 != null ? Math.min(max, rawFor(k, active.p75, scale, step)) : null;
  const now = overall(results, weights);
  const changed = value !== current;

  return (
    <div className="whatif stack">
      <div className="whatif-controls">
        <div className="field">
          <label htmlFor="wi-metric">Change</label>
          <select id="wi-metric" value={k} onChange={(e) => setKey(e.target.value as MetricKey)}>
            {choices.map((r) => <option key={r.metric.key} value={r.metric.key}>{r.metric.label}</option>)}
          </select>
        </div>
        <div className="field grow">
          <label htmlFor="wi-value">To <output htmlFor="wi-value" className="val">{show(value)}</output></label>
          <input id="wi-value" type="range" min={0} max={max} step={step} value={value}
            onChange={(e) => setValue(Number(e.target.value))} />
        </div>
      </div>
      <div className="whatif-result" aria-live="polite">
        <div>
          <span className="small muted">{active.metric.label}</span>
          <b>{fmt(active.percentile)} <span aria-hidden>→</span> <span className="you-line">{fmt(projected.metric.percentile)}</span></b>
        </div>
        <div>
          <span className="small muted">Overall standing</span>
          <b>{fmt(now)} <span aria-hidden>→</span> <span className="you-line">{fmt(projected.overall)}</span></b>
        </div>
      </div>
      <div className="actions">
        {target != null && target > current && (
          <button type="button" className="ghost" onClick={() => setValue(target)}>Try the 75th percentile ({show(target)})</button>
        )}
        {changed && <button type="button" className="ghost" onClick={() => setValue(current)}>Back to my number</button>}
      </div>
      <p className="muted small">Only you see this, and nothing is saved. It compares the new number with the same peers as above.</p>
    </div>
  );
}

function fmt(p: number | null) {
  return p == null ? "—" : ordinal(p);
}

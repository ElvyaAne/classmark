import { useState, type PointerEvent } from "react";

interface Props {
  label: string;
  peers: number[] | null;
  you: number | null;
  median: number | null;
  domain: [number, number];
  format: (v: number) => string;
}

const W = 400;
const H = 40;
const PAD = 8;

/** One-row dot plot: every peer as a dot, the median as a tick, you as a square. */
export function StripChart({ label, peers, you, median, domain, format }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [lo, hi] = domain;
  const sx = (v: number) => PAD + ((v - lo) / (hi - lo || 1)) * (W - PAD * 2);

  // stack identical values vertically so ties stay visible
  const seen = new Map<number, number>();
  const dots = (peers ?? []).map((v) => {
    const k = seen.get(v) ?? 0;
    seen.set(v, k + 1);
    const offset = k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.min(14, Math.ceil(k / 2) * 4);
    return { v, x: sx(v), y: H / 2 + offset };
  });

  const show = (e: PointerEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text });

  const aria = peers
    ? `${label}: ${peers.length} peers, median ${median != null ? format(median) : "n/a"}${you != null ? `, you ${format(you)}` : ""}`
    : `${label}: not enough peers to show the spread`;

  return (
    <div className="strip" onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={aria}>
        <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} stroke="var(--line)" strokeWidth={2} />
        {median != null && (
          <line x1={sx(median)} x2={sx(median)} y1={6} y2={H - 6} stroke="var(--ink-3)" strokeWidth={2} />
        )}
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={4.5} fill="var(--peer)" fillOpacity={0.55}
            stroke="var(--surface)" strokeWidth={1.5}
            onPointerMove={(e) => show(e, `Peer: ${format(d.v)}`)} />
        ))}
        {you != null && (
          <rect x={sx(Math.min(hi, Math.max(lo, you))) - 6.5} y={H / 2 - 6.5} width={13} height={13} rx={2}
            fill="var(--you)" stroke="var(--surface)" strokeWidth={2}
            onPointerMove={(e) => show(e, `You: ${format(you)}`)} />
        )}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(window.innerWidth - 160, tip.x + 12), top: tip.y - 32 }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

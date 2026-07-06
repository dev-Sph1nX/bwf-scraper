import { useMemo, useRef, useState } from "react";

// Graphique d'évolution de la cote Elo (une série = une discipline).
// SVG responsive (viewBox), thème sombre, ligne 2px + aire discrète, hover crosshair.
const W = 720, H = 260, PAD = { l: 46, r: 16, t: 18, b: 28 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

const parseT = (t) => (t ? new Date(t.replace(" ", "T")).getTime() : NaN);
const fmtDate = (t) => (t ? new Date(t.replace(" ", "T")).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" }) : "");

export default function EloChart({ points, label }) {
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);

  const geo = useMemo(() => {
    const pts = (points || []).filter((p) => Number.isFinite(p.r));
    if (pts.length === 0) return null;

    const times = pts.map((p) => parseT(p.t));
    const hasTime = times.every((t) => Number.isFinite(t)) && times[times.length - 1] > times[0];
    const tmin = times[0], tmax = times[times.length - 1];
    const xFrac = (i) => (pts.length === 1 ? 0.5 : hasTime ? (times[i] - tmin) / (tmax - tmin) : i / (pts.length - 1));
    const x = (i) => PAD.l + xFrac(i) * PW;

    const rs = pts.map((p) => p.r);
    let rmin = Math.min(...rs), rmax = Math.max(...rs);
    const pad = Math.max(15, (rmax - rmin) * 0.2);
    const ylo = Math.floor((rmin - pad) / 10) * 10;
    const yhi = Math.ceil((rmax + pad) / 10) * 10;
    const y = (r) => PAD.t + (1 - (r - ylo) / (yhi - ylo || 1)) * PH;

    const ticks = [];
    for (let k = 0; k <= 3; k++) ticks.push(Math.round(ylo + (k / 3) * (yhi - ylo)));

    const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.r).toFixed(1)}`).join(" ");
    const base = PAD.t + PH;
    const area = `${line} L ${x(pts.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`;

    return { pts, times, x, y, xFrac, ticks, line, area, base, first: pts[0], last: pts[pts.length - 1] };
  }, [points]);

  if (!geo) return <div className="muted" style={{ padding: "8px 0" }}>Pas encore d'historique de cote.</div>;

  const { pts, x, y, ticks, line, area, first, last } = geo;

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = Math.abs(x(i) - vbx); if (d < bd) { bd = d; best = i; } }
    setHi(best);
  };

  const cur = last.r, delta = last.r - first.r;

  return (
    <div className="chart" role="img" aria-label={`Évolution de la cote Elo en ${label} : de ${first.r} à ${cur} points`}>
      <div className="chart-head">
        <span className="chart-title">{label}</span>
        <span className="chart-cur">
          {cur} <span className={`form ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "→ 0"}
          </span>
          <span className="muted"> sur la période</span>
        </span>
      </div>
      <div className="chart-plot">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
             onMouseMove={onMove} onMouseLeave={() => setHi(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{t}</text>
            </g>
          ))}
          <path d={area} fill="var(--accent)" fillOpacity="0.12" stroke="none" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* point final */}
          <circle cx={x(pts.length - 1)} cy={y(last.r)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          {/* crosshair au survol */}
          {hi != null && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--muted)" strokeWidth="1" />
              <circle cx={x(hi)} cy={y(pts[hi].r)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}
          <text x={PAD.l} y={H - 6} fontSize="12" fill="var(--muted)">{fmtDate(first.t)}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="12" fill="var(--muted)">{fmtDate(last.t)}</text>
        </svg>
        {hi != null && (
          <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%`, top: `${(y(pts[hi].r) / H) * 100}%` }}>
            <b>{pts[hi].r}</b>
            <span>{fmtDate(pts[hi].t)} · {pts[hi].won ? "V" : "D"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

import { useMemo, useRef, useState } from "react";

// Graphe de COMPARAISON : superpose plusieurs séries Elo (une par entité) sur un
// même repère, échelle Y commune, une couleur + légende par série. Pensé pour le
// tête-à-tête (2 joueurs / 2 paires). SVG responsive (viewBox), thème sombre.
const W = 720, H = 260, PAD = { l: 46, r: 16, t: 18, b: 28 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

const parseT = (t) => (t ? new Date(t.replace(" ", "T")).getTime() : NaN);
const fmtMs = (ms) => new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" });

const RANGES = [
  { k: "3m", label: "3 mois", months: 3 },
  { k: "6m", label: "6 mois", months: 6 },
  { k: "1y", label: "1 an", months: 12 },
  { k: "all", label: "Tout", months: null },
];
function rangeCutoff(k, lastMs) {
  const r = RANGES.find((x) => x.k === k);
  if (!r || r.months == null || !Number.isFinite(lastMs)) return null;
  const d = new Date(lastMs);
  d.setMonth(d.getMonth() - r.months);
  return d.getTime();
}

export default function EloCompareChart({ series }) {
  const svgRef = useRef(null);
  const [hx, setHx] = useState(null); // fraction horizontale [0..1] survolée
  const [range, setRange] = useState("3m");

  const geo = useMemo(() => {
    // Chaque série = son historique complet (points finis), trié par date.
    const parsed = (series || []).map((s) => ({
      ...s,
      all: (s.points || []).filter((p) => Number.isFinite(p.r)).slice().sort((a, b) => parseT(a.t) - parseT(b.t)),
    }));
    const allT = parsed.flatMap((s) => s.all.map((p) => parseT(p.t))).filter(Number.isFinite);
    if (allT.length === 0) return null;

    // Domaine temporel commun : [tmin, tmax]. tmax = dernier match global ; tmin =
    // début de la fenêtre choisie (borné au 1er point réellement disponible).
    const totalPts = parsed.reduce((n, s) => n + s.all.length, 0);
    let hasTime = allT.length === totalPts;
    const tmaxAll = Math.max(...allT), tminAll = Math.min(...allT);
    const cutoff = rangeCutoff(range, tmaxAll);
    const tmin = cutoff == null ? tminAll : Math.max(cutoff, tminAll);
    const tmax = tmaxAll;
    if (!(tmax > tmin)) hasTime = false;

    // Une cote persiste entre deux matchs : on l'étend sur tout le domaine en
    // tenant la dernière valeur connue (à gauche jusqu'au début de la fenêtre,
    // à droite jusqu'au dernier match global). Jamais avant le 1er match de
    // l'entité (avant, elle n'a pas de cote → pas de ligne).
    const iso = (ms) => new Date(ms).toISOString();
    const clean = parsed.map((s) => {
      if (s.all.length === 0) return { ...s, points: [] };
      const inWin = s.all.filter((p) => { const t = parseT(p.t); return t >= tmin && t <= tmax; });
      let pts = inWin.slice();
      const atOrBefore = s.all.filter((p) => parseT(p.t) <= tmin);
      if (atOrBefore.length && (pts.length === 0 || parseT(pts[0].t) > tmin)) {
        pts = [{ t: iso(tmin), r: atOrBefore[atOrBefore.length - 1].r, anchor: true }, ...pts];
      }
      if (pts.length && parseT(pts[pts.length - 1].t) < tmax) {
        pts = [...pts, { t: iso(tmax), r: pts[pts.length - 1].r, anchor: true }];
      }
      return { ...s, points: pts };
    }).filter((s) => s.points.length > 0);
    if (clean.length === 0) return null;

    const allRs = clean.flatMap((s) => s.points.map((p) => p.r));
    let rmin = Math.min(...allRs), rmax = Math.max(...allRs);
    const pad = Math.max(15, (rmax - rmin) * 0.2);
    const ylo = Math.floor((rmin - pad) / 10) * 10;
    const yhi = Math.ceil((rmax + pad) / 10) * 10;
    const y = (r) => PAD.t + (1 - (r - ylo) / (yhi - ylo || 1)) * PH;
    const xOf = (t, i, n) => PAD.l + (hasTime ? (parseT(t) - tmin) / (tmax - tmin) : (n === 1 ? 0.5 : i / (n - 1))) * PW;

    const ticks = [];
    for (let k = 0; k <= 3; k++) ticks.push(Math.round(ylo + (k / 3) * (yhi - ylo)));

    const lines = clean.map((s) => {
      const n = s.points.length;
      const pts = s.points.map((p, i) => ({ ...p, cx: xOf(p.t, i, n), cy: y(p.r) }));
      const d = pts.map((p, i) => `${i ? "L" : "M"} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`).join(" ");
      const reals = pts.filter((p) => !p.anchor);
      const lastReal = reals.length ? reals[reals.length - 1] : pts[pts.length - 1];
      return { ...s, pts, d, last: lastReal };
    });

    return { lines, ticks, hasTime, tmin, tmax, y };
  }, [series, range]);

  const rangeTabs = (
    <div className="chart-ranges" role="tablist" aria-label="Période">
      {RANGES.map((r) => (
        <button key={r.k} role="tab" aria-selected={r.k === range}
          className={`range-btn ${r.k === range ? "active" : ""}`} onClick={() => setRange(r.k)}>
          {r.label}
        </button>
      ))}
    </div>
  );

  if (!geo) return (
    <div className="chart">
      {rangeTabs}
      <div className="muted" style={{ padding: "8px 0" }}>Aucun historique de cote sur cette période.</div>
    </div>
  );

  const { lines, ticks } = geo;

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    setHx(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  };
  // Point le plus proche horizontalement pour chaque série (au survol).
  const hoverX = hx == null ? null : PAD.l + hx * PW;
  const nearest = (line) => {
    if (hoverX == null) return null;
    let best = line.pts[0], bd = Infinity;
    for (const p of line.pts) { const d = Math.abs(p.cx - hoverX); if (d < bd) { bd = d; best = p; } }
    return best;
  };

  // Graduations de dates sur l'axe X (uniquement si les points sont horodatés).
  const N_X = 4;
  const xTicks = geo.hasTime && geo.tmax > geo.tmin
    ? Array.from({ length: N_X + 1 }, (_, k) => {
        const f = k / N_X;
        return { x: PAD.l + f * PW, t: geo.tmin + f * (geo.tmax - geo.tmin) };
      })
    : [];
  const hoverDate = (hoverX != null && geo.hasTime && geo.tmax > geo.tmin)
    ? fmtMs(geo.tmin + Math.min(1, Math.max(0, (hoverX - PAD.l) / PW)) * (geo.tmax - geo.tmin))
    : null;

  return (
    <div className="chart" role="img"
      aria-label={`Comparaison de cote Elo : ${lines.map((l) => `${l.label} ${l.last.r}`).join(", ")}`}>
      {rangeTabs}
      <div className="chart-legend">
        {lines.map((l) => (
          <span className="chart-leg" key={l.label}>
            <span className="chart-leg-swatch" style={{ background: l.color }} aria-hidden="true" />
            <span className="chart-leg-name">{l.label}</span>
            <b style={{ color: l.color }}>{l.last.r}</b>
          </span>
        ))}
      </div>
      <div className="chart-plot">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHx(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={geo.y(t)} y2={geo.y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 8} y={geo.y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{t}</text>
            </g>
          ))}
          {hoverX != null && (
            <line x1={hoverX} x2={hoverX} y1={PAD.t} y2={PAD.t + PH} stroke="var(--muted)" strokeWidth="1" />
          )}
          {lines.map((l) => (
            <g key={l.label}>
              <path d={l.d} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={l.last.cx} cy={l.last.cy} r="4" fill={l.color} stroke="var(--surface)" strokeWidth="2" />
              {hoverX != null && (() => { const p = nearest(l); return p ? <circle cx={p.cx} cy={p.cy} r="4.5" fill={l.color} stroke="var(--surface)" strokeWidth="2" /> : null; })()}
            </g>
          ))}
          {xTicks.map((tk, i) => (
            <text key={i} x={tk.x} y={H - 7}
              textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
              fontSize="11" fill="var(--muted)">{fmtMs(tk.t)}</text>
          ))}
        </svg>
        {hoverX != null && (
          <div className="chart-tip chart-tip--cmp" style={{ left: `${(hoverX / W) * 100}%`, top: 0 }}>
            {hoverDate && <div className="tip-cmp-date">{hoverDate}</div>}
            {lines.map((l) => {
              const p = nearest(l);
              return (
                <div className="tip-line" key={l.label}>
                  <span className="chart-leg-swatch" style={{ background: l.color }} aria-hidden="true" />
                  <span className="tip-cmp-name">{l.label}</span>
                  <b style={{ color: l.color }}>{p?.r}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

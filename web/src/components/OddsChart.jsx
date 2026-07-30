import { useMemo, useRef, useState } from "react";

// Évolution de la cote d'un match dans le temps, du premier relevé jusqu'au
// dernier avant la rencontre.
//
// On trace la PROBABILITÉ IMPLICITE et non la cote brute, pour deux raisons :
// les deux camps somment alors à 100 % (une cote de 1,20 face à une de 5,00 ne
// se lit pas sur la même échelle), et c'est la grandeur directement comparable à
// notre propre pronostic. La commission du bookmaker est retirée.
//
// viewBox volontairement étroit + largeur plafonnée : un viewBox large met le
// texte à l'échelle et le rend illisible sur mobile.
const W = 360, H = 210, PAD = { l: 38, r: 14, t: 12, b: 30 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
const PLOT_MAX = 420;

const fmtJour = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const fmtHeure = (iso) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const pc = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default function OddsChart({ serie, label1, label2 }) {
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);

  const geo = useMemo(() => {
    const pts = (serie?.points || []).filter((p) => Number.isFinite(p.impliedP1));
    if (!pts.length) return null;

    const ts = pts.map((p) => Date.parse(p.at));
    // Le dernier relevé garde la valeur jusqu'à `lastSeen` : on étend l'axe
    // jusque-là, sinon une cote stable depuis trois jours apparaît comme un point.
    const tFin = Math.max(...ts, Date.parse(pts[pts.length - 1].lastSeen || pts[pts.length - 1].at));
    const tMin = Math.min(...ts);
    const span = tFin - tMin;
    const x = (t) => PAD.l + (span > 0 ? (t - tMin) / span : 0.5) * PW;
    const y = (p) => PAD.t + (1 - p) * PH;

    // Palier : une cote tient jusqu'au relevé suivant, elle ne glisse pas
    // linéairement. Un tracé en escalier dit la vérité, une ligne droite non.
    const d = [];
    pts.forEach((p, i) => {
      const t0 = Date.parse(p.at);
      const t1 = i + 1 < pts.length ? Date.parse(pts[i + 1].at) : tFin;
      d.push(`${i ? "L" : "M"} ${x(t0).toFixed(1)} ${y(p.impliedP1).toFixed(1)}`);
      d.push(`L ${x(t1).toFixed(1)} ${y(p.impliedP1).toFixed(1)}`);
    });

    return { pts, ts, x, y, path: d.join(" "), tMin, tFin, single: pts.length === 1 };
  }, [serie]);

  if (!geo) return <p className="muted">Aucune cote relevée pour ce match.</p>;
  const { pts, ts, x, y, path, tMin, tFin, single } = geo;

  const onMove = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    ts.forEach((t, i) => { const dd = Math.abs(x(t) - vx); if (dd < bd) { bd = dd; best = i; } });
    setHi(best);
  };

  const ouv = pts[0], clo = pts[pts.length - 1];
  const derive = clo.impliedP1 - ouv.impliedP1;

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-title">{label1}</span>
        <span className="chart-cur">
          {pc(clo.impliedP1)}
          {!single && (
            <span className={`form ${derive > 0.001 ? "up" : derive < -0.001 ? "down" : "flat"}`}>
              {derive > 0.001 ? `▲ +${(derive * 100).toFixed(1)}` : derive < -0.001 ? `▼ ${(derive * 100).toFixed(1)}` : "→ 0"}
            </span>
          )}
          <span className="muted"> {single ? "un seul relevé" : "depuis l'ouverture"}</span>
        </span>
      </div>

      <div className="chart-plot" style={{ maxWidth: PLOT_MAX }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
             onMouseMove={onMove} onMouseLeave={() => setHi(null)}
             aria-label={`Évolution de la probabilité implicite de ${label1} : ${pc(ouv.impliedP1)} à l'ouverture, ${pc(clo.impliedP1)} au dernier relevé`}>
          {[0.25, 0.5, 0.75].map((p) => (
            <g key={p}>
              <line x1={PAD.l} x2={PAD.l + PW} y1={y(p)} y2={y(p)}
                    stroke="var(--line)" strokeWidth="1" strokeDasharray={p === 0.5 ? "" : "3 3"} />
              <text x={PAD.l - 6} y={y(p) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {p * 100}
              </text>
            </g>
          ))}

          <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
          {pts.map((p, i) => (
            <circle key={i} cx={x(ts[i])} cy={y(p.impliedP1)} r={i === hi ? 4.5 : 3}
                    fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
          ))}

          <text x={PAD.l} y={H - 8} fontSize="11" fill="var(--muted)">{fmtJour(pts[0].at)}</text>
          <text x={PAD.l + PW} y={H - 8} textAnchor="end" fontSize="11" fill="var(--muted)">
            {fmtJour(new Date(tFin).toISOString())}
          </text>
        </svg>

        {hi != null && (
          <div className="chart-tip"
               style={{ left: `${(x(ts[hi]) / W) * 100}%`, top: `${(y(pts[hi].impliedP1) / H) * 100}%` }}>
            <div className="tip-r"><b>{pc(pts[hi].impliedP1)}</b></div>
            <div className="tip-line muted">
              cotes {pts[hi].odd1} / {pts[hi].odd2}
            </div>
            <div className="tip-line muted">{fmtHeure(pts[hi].at)}</div>
          </div>
        )}
      </div>

      <p className="hint">
        Probabilité implicite de <b>{label1}</b> (commission du bookmaker retirée).
        Le complément va à {label2}. Tracé en paliers : une cote tient jusqu'au
        relevé suivant.
      </p>
    </div>
  );
}

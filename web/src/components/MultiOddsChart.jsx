import { useMemo } from "react";

// Comparaison des probabilités implicites de plusieurs opérateurs pour un même
// match, sur un repère temporel COMMUN (adaptation multi-séries d'OddsChart,
// qui reste utilisé tel quel côté Coulisses pour une cote unique).
//
// Mêmes principes que le mono-série : probabilité implicite (comparable entre
// opérateurs, commission retirée) et tracé en paliers (une cote tient jusqu'au
// relevé suivant). Pas de tooltip au survol ici : le dernier % de chaque
// opérateur est déjà lisible dans la légende, avant le graphe.
const W = 360, H = 210, PAD = { l: 38, r: 14, t: 12, b: 30 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
const PLOT_MAX = 420;

const COLORS = ["var(--accent)", "var(--accent-2)", "var(--green)"];
const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };

const fmtJour = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const pc = (v) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default function MultiOddsChart({ series, label1, label2 }) {
  const geo = useMemo(() => {
    const raw = (series || [])
      .map((s) => ({ ...s, pts: (s.points || []).filter((p) => Number.isFinite(p.impliedP1)) }))
      .filter((s) => s.pts.length > 0);
    if (!raw.length) return null;

    // Axe temps commun à TOUS les opérateurs : du tout premier relevé au plus
    // récent "encore valable" (lastSeen inclus), tous confondus.
    const starts = raw.map((s) => Math.min(...s.pts.map((p) => Date.parse(p.at))));
    const ends = raw.map((s) => {
      const last = s.pts[s.pts.length - 1];
      return Math.max(...s.pts.map((p) => Date.parse(p.at)), Date.parse(last.lastSeen || last.at));
    });
    const tMin = Math.min(...starts);
    const tFin = Math.max(...ends);
    const span = tFin - tMin;
    const x = (t) => PAD.l + (span > 0 ? (t - tMin) / span : 0.5) * PW;
    const y = (p) => PAD.t + (1 - p) * PH;

    const lines = raw.map((s, i) => {
      const pts = s.pts.map((p) => ({ ...p, cx: x(Date.parse(p.at)), cy: y(p.impliedP1) }));
      const single = pts.length === 1;
      let path = "";
      if (!single) {
        // Palier : chaque relevé tient jusqu'au suivant (ou jusqu'à tFin pour
        // le dernier), jamais d'interpolation linéaire entre deux cotes.
        const d = [];
        pts.forEach((p, idx) => {
          const xEnd = idx + 1 < pts.length ? pts[idx + 1].cx : x(tFin);
          d.push(`${idx ? "L" : "M"} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)}`);
          d.push(`L ${xEnd.toFixed(1)} ${p.cy.toFixed(1)}`);
        });
        path = d.join(" ");
      }
      return {
        book: s.book,
        name: s.label || BOOK_LABEL[s.book] || s.book,
        color: COLORS[i % COLORS.length],
        pts,
        single,
        path,
        last: pts[pts.length - 1],
      };
    });

    return { lines, tMin, tFin };
  }, [series]);

  if (!geo) return <p className="muted">Aucune cote relevée pour ce match.</p>;
  const { lines, tMin, tFin } = geo;

  return (
    <div className="chart">
      <div className="chart-legend">
        {lines.map((l) => (
          <span className="chart-leg" key={l.book}>
            <span className="chart-leg-swatch" style={{ background: l.color }} aria-hidden="true" />
            <span className="chart-leg-name">{l.name} ({l.pts.length})</span>
            <b style={{ color: l.color }}>{pc(l.last.impliedP1)}</b>
          </span>
        ))}
      </div>

      <div className="chart-plot" style={{ maxWidth: PLOT_MAX }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`Évolution de la probabilité implicite de ${label1} par opérateur : ${lines.map((l) => `${l.name} ${pc(l.last.impliedP1)}`).join(", ")}`}>
          {[0.25, 0.5, 0.75].map((p) => {
            const yy = PAD.t + (1 - p) * PH;
            return (
              <g key={p}>
                <line x1={PAD.l} x2={PAD.l + PW} y1={yy} y2={yy}
                      stroke="var(--line)" strokeWidth="1" strokeDasharray={p === 0.5 ? "" : "3 3"} />
                <text x={PAD.l - 6} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                  {p * 100}
                </text>
              </g>
            );
          })}

          {lines.map((l) => (
            <g key={l.book}>
              {!l.single && <path d={l.path} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" />}
              {l.pts.map((p, i) => (
                <circle key={i} cx={p.cx} cy={p.cy} r={i === l.pts.length - 1 ? 3.5 : 3}
                        fill={l.color} stroke="var(--surface)" strokeWidth="1.5" />
              ))}
            </g>
          ))}

          <text x={PAD.l} y={H - 8} fontSize="11" fill="var(--muted)">{fmtJour(new Date(tMin).toISOString())}</text>
          <text x={PAD.l + PW} y={H - 8} textAnchor="end" fontSize="11" fill="var(--muted)">
            {fmtJour(new Date(tFin).toISOString())}
          </text>
        </svg>
      </div>

      <p className="hint">
        Probabilité implicite de <b>{label1}</b> chez chaque opérateur (commission retirée).
        Le complément va à {label2}. Tracé en paliers : une cote tient jusqu'au
        relevé suivant.
      </p>
    </div>
  );
}

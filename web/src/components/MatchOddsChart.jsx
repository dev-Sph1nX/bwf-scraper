import { useMemo } from "react";

// Les DEUX cotes d'un match chez UN opérateur, dans le temps :
// rouge = camp 1, bleu = camp 2 (charte : --accent 1re série, --accent-2 2e).
// On trace les cotes BRUTES — c'est ce que paierait la mise — contrairement à
// OddsChart (probabilité implicite) utilisé côté Coulisses.
//
// viewBox étroit + largeur plafonnée : un viewBox large met le texte à
// l'échelle et le rend illisible sur mobile (piège documenté dans le skill UI).
const W = 360, H = 210, PAD = { l: 42, r: 14, t: 12, b: 30 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
const PLOT_MAX = 420;

const fmtJour = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";
const fmtOdd = (v) => (v == null ? "—" : v.toFixed(2));

export default function MatchOddsChart({ points, label1, label2 }) {
  const geo = useMemo(() => {
    const pts = (points || []).filter((p) => Number.isFinite(p.odd1) && Number.isFinite(p.odd2));
    if (!pts.length) return null;

    const ts = pts.map((p) => Date.parse(p.at));
    // Le dernier relevé vaut jusqu'à `lastSeen` : sans ça, une cote stable
    // depuis trois jours apparaîtrait comme un simple point.
    const dernier = pts[pts.length - 1];
    const tFin = Math.max(...ts, Date.parse(dernier.lastSeen || dernier.at));
    const tMin = Math.min(...ts);
    const span = tFin - tMin;
    const x = (t) => PAD.l + (span > 0 ? (t - tMin) / span : 0.5) * PW;

    const vals = pts.flatMap((p) => [p.odd1, p.odd2]);
    let vMin = Math.min(...vals), vMax = Math.max(...vals);
    const marge = Math.max((vMax - vMin) * 0.1, 0.05);
    vMin -= marge; vMax += marge;
    const y = (v) => PAD.t + (1 - (v - vMin) / (vMax - vMin)) * PH;

    // Palier : une cote tient jusqu'au relevé suivant, elle ne glisse pas
    // linéairement entre deux valeurs.
    const palier = (champ) => {
      const d = [];
      pts.forEach((p, i) => {
        const t0 = Date.parse(p.at);
        const t1 = i + 1 < pts.length ? Date.parse(pts[i + 1].at) : tFin;
        d.push(`${i ? "L" : "M"} ${x(t0).toFixed(1)} ${y(p[champ]).toFixed(1)}`);
        d.push(`L ${x(t1).toFixed(1)} ${y(p[champ]).toFixed(1)}`);
      });
      return d.join(" ");
    };

    const series = [
      { champ: "odd1", nom: label1, color: "var(--accent)" },
      { champ: "odd2", nom: label2, color: "var(--accent-2)" },
    ].map((s) => ({
      ...s,
      path: palier(s.champ),
      dots: pts.map((p) => ({ cx: x(Date.parse(p.at)), cy: y(p[s.champ]) })),
      last: dernier[s.champ],
    }));

    // 3 graduations « rondes » sur l'axe des cotes.
    const ticks = [0.25, 0.5, 0.75].map((f) => vMin + f * (vMax - vMin));

    return { pts, series, ticks, y, tMin, tFin, single: pts.length === 1 };
  }, [points, label1, label2]);

  if (!geo) return <p className="muted">Aucune cote relevée chez cet opérateur.</p>;
  const { series, ticks, y, tMin, tFin, single } = geo;

  return (
    <div className="chart">
      <div className="chart-legend">
        {series.map((s) => (
          <span className="chart-leg" key={s.champ}>
            <span className="chart-leg-swatch" style={{ background: s.color }} aria-hidden="true" />
            <span className="chart-leg-name">{s.nom}</span>
            <b style={{ color: s.color }}>{fmtOdd(s.last)}</b>
          </span>
        ))}
      </div>

      <div className="chart-plot" style={{ maxWidth: PLOT_MAX }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`Évolution des cotes : ${series.map((s) => `${s.nom} ${fmtOdd(s.last)}`).join(", ")}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={PAD.l + PW} y1={y(v)} y2={y(v)}
                    stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {v.toFixed(2)}
              </text>
            </g>
          ))}

          {series.map((s) => (
            <g key={s.champ}>
              {!single && <path d={s.path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />}
              {s.dots.map((d, i) => (
                <circle key={i} cx={d.cx} cy={d.cy} r={i === s.dots.length - 1 ? 3.5 : 3}
                        fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
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
        Cote de chaque camp au fil des relevés (toutes les 2 h). Plus la cote
        baisse, plus l'opérateur croit à sa victoire. Tracé en paliers : une
        cote tient jusqu'au relevé suivant.
      </p>
    </div>
  );
}

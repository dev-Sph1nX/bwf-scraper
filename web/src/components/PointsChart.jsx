import { useMemo, useState } from "react";

// Le POINT PAR POINT d'un match : une courbe de score par camp et par manche,
// qui monte jusqu'à 21 (ou au-delà en prolongation). Données de
// points/<tmtId>.json : par manche, m = marqueur de chaque point (1 = team1,
// 2 = team2), s = serveur (0 = inconnu), fin = [team1, team2].
// Charte : --accent pour la 1re série (team1), --accent-2 pour la 2e.
//
// viewBox étroit + largeur plafonnée : un viewBox large met le texte à
// l'échelle et le rend illisible sur mobile (piège documenté dans le skill UI).
const W = 360, H = 170, PAD = { l: 30, r: 14, t: 10, b: 24 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
const PLOT_MAX = 420;

// Cumul du score après chaque point : [{p1, p2}], index 0 = 0-0 avant le 1er point.
function cumul(m) {
  const rows = [{ p1: 0, p2: 0 }];
  let p1 = 0, p2 = 0;
  for (const c of m) { if (c === "1") p1++; else p2++; rows.push({ p1, p2 }); }
  return rows;
}

// Une manche : le graphe de la course au 21, avec survol (score à ce point-là).
function SetChart({ set, no, label1, label2 }) {
  const [hov, setHov] = useState(null); // index de point survolé (0 = 0-0)

  const geo = useMemo(() => {
    const rows = cumul(set.m);
    const n = rows.length - 1; // nombre de points joués
    const yMax = Math.max(21, set.fin[0], set.fin[1]);
    const x = (i) => PAD.l + (n > 0 ? i / n : 0) * PW;
    const y = (v) => PAD.t + (1 - v / yMax) * PH;
    const path = (champ) => rows.map((r, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(r[champ]).toFixed(1)}`).join(" ");
    // Graduations : les paliers du badminton, + le sommet en prolongation.
    const ticks = [7, 14, 21].filter((t) => t <= yMax);
    if (yMax > 21) ticks.push(yMax);
    return { rows, n, yMax, x, y, path1: path("p1"), path2: path("p2"), ticks };
  }, [set]);

  const { rows, n, x, y, ticks } = geo;
  const gagne1 = set.fin[0] > set.fin[1];

  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const cx = ((e.touches ? e.touches[0].clientX : e.clientX) - box.left) / box.width * W;
    setHov(Math.max(0, Math.min(n, Math.round((cx - PAD.l) / PW * n))));
  };

  const r = hov != null ? rows[hov] : null;
  const serveur = hov ? set.s[hov - 1] : "0"; // s est indexé par point (1er point = s[0])

  return (
    <div className="chart">
      <div className="chart-head">
        <span className="chart-title">Manche {no}</span>
        <span className="chart-cur">
          <span style={{ color: gagne1 ? "var(--accent)" : "var(--ink)" }}>{set.fin[0]}</span>
          <span className="muted"> – </span>
          <span style={{ color: !gagne1 ? "var(--accent-2)" : "var(--ink)" }}>{set.fin[1]}</span>
        </span>
      </div>
      <div className="chart-plot" style={{ maxWidth: PLOT_MAX }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`Manche ${no} : évolution du score point par point, ${set.fin[0]}-${set.fin[1]} en ${n} points`}
             onMouseMove={move} onMouseLeave={() => setHov(null)}
             onTouchStart={move} onTouchMove={move} onTouchEnd={() => setHov(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + PW} y1={y(t)} y2={y(t)}
                    stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" />
              <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{t}</text>
            </g>
          ))}
          <line x1={PAD.l} x2={PAD.l + PW} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth="1" />

          <path d={geo.path1} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
          <path d={geo.path2} fill="none" stroke="var(--accent-2)" strokeWidth="2" strokeLinejoin="round" />
          <circle cx={x(n)} cy={y(set.fin[0])} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
          <circle cx={x(n)} cy={y(set.fin[1])} r="3.5" fill="var(--accent-2)" stroke="var(--surface)" strokeWidth="1.5" />

          {r && (
            <g pointerEvents="none">
              <line x1={x(hov)} x2={x(hov)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 3" />
              <circle cx={x(hov)} cy={y(r.p1)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
              <circle cx={x(hov)} cy={y(r.p2)} r="3.5" fill="var(--accent-2)" stroke="var(--surface)" strokeWidth="1.5" />
            </g>
          )}

          <text x={PAD.l} y={H - 6} fontSize="11" fill="var(--muted)">0</text>
          <text x={PAD.l + PW} y={H - 6} textAnchor="end" fontSize="11" fill="var(--muted)">{n} points</text>
        </svg>

        {r && (
          <div className="chart-tip" style={{ left: `${(x(hov) / W) * 100}%`, top: 6, transform: "translate(-50%, 0)" }}>
            <div className="tip-r"><b>{r.p1} – {r.p2}</b><span className="muted">point {hov}</span></div>
            {hov > 0 && (serveur === "1" || serveur === "2") && (
              <div className="tip-line">
                <span className="chart-leg-swatch" style={{ background: serveur === "1" ? "var(--accent)" : "var(--accent-2)" }} aria-hidden="true" />
                <span className="tip-cmp-name">au service : {serveur === "1" ? label1 : label2}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PointsChart({ sets, label1, label2 }) {
  if (!sets?.length) return <p className="muted">Pas de point par point pour ce match.</p>;
  return (
    <div>
      <div className="chart-legend">
        <span className="chart-leg">
          <span className="chart-leg-swatch" style={{ background: "var(--accent)" }} aria-hidden="true" />
          <span className="chart-leg-name">{label1}</span>
        </span>
        <span className="chart-leg">
          <span className="chart-leg-swatch" style={{ background: "var(--accent-2)" }} aria-hidden="true" />
          <span className="chart-leg-name">{label2}</span>
        </span>
      </div>
      {sets.map((s, i) => <SetChart key={i} set={s} no={i + 1} label1={label1} label2={label2} />)}
      <p className="hint">
        Chaque courbe est le score d'un camp après chaque point joué — la première
        arrivée à 21 (avec 2 points d'écart, jusqu'à 30) gagne la manche. Survole
        le graphe pour lire le score et le serveur à ce moment du match. Source :
        relevés point par point Flashscore.
      </p>
    </div>
  );
}

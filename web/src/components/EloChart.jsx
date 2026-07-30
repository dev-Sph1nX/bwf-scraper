import { useMemo, useRef, useState } from "react";

// Graphique d'évolution : cote Elo (axe gauche) et, en option, rang mondial BWF
// (axe droit, INVERSÉ pour que « la courbe monte » = « le joueur progresse »
// sur les deux séries — sans quoi la comparaison serait trompeuse).
//
// Les deux séries partagent le MÊME domaine temporel : l'Elo est ponctuel (un
// point par match, horodatage irrégulier), le classement est hebdomadaire. Pas
// de rééchantillonnage ni d'interpolation.
//
// SVG responsive (viewBox), thème sombre, hover crosshair.
const W = 720, H = 260, PAD = { l: 46, r: 44, t: 18, b: 34 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

// Au-delà de 10 jours entre deux relevés hebdomadaires, le joueur est sorti du
// top : on coupe la courbe au lieu de tracer un trait droit qui affirmerait une
// continuité non mesurée.
const RANK_GAP_MS = 10 * 864e5;

// Normalise un horodatage vers l'heure LOCALE avant de le parser. Piège : un
// horodatage complet ("2026-03-10 09:30:00", série Elo) devient, une fois
// l'espace remplacé par un "T", une date-heure LOCALE pour le moteur JS ;
// mais une date "jour seul" ("2026-07-28", série de classement, un relevé par
// semaine) est interprétée comme minuit UTC si on la passe telle quelle à
// `new Date()`. Sans cette normalisation, les deux séries seraient décalées
// l'une par rapport à l'autre de l'offset local (jusqu'à quelques heures) sur
// le domaine temporel partagé — exportée pour que Player.jsx applique le même
// référentiel à son filtre de période plutôt que de dupliquer la règle.
export const parseT = (t) => {
  if (!t) return NaN;
  const s = t.includes(" ") ? t.replace(" ", "T") : t.includes("T") ? t : `${t}T00:00:00`;
  return new Date(s).getTime();
};
const DATE_FMT = { day: "numeric", month: "short", year: "2-digit" };
const fmtDate = (t) => (t ? new Date(t.replace(" ", "T")).toLocaleDateString("fr-FR", DATE_FMT) : "");
// Variante pour un horodatage déjà résolu en millisecondes (bornes du domaine
// temporel partagé `tmin`/`tmax`, cf. plus bas) : évite de re-sérialiser un
// nombre en chaîne pour repasser par `fmtDate`. Rend "" (pas "Invalid Date")
// si la valeur n'est pas exploitable.
const fmtDateMs = (ms) => (Number.isFinite(ms) ? new Date(ms).toLocaleDateString("fr-FR", DATE_FMT) : "");

export default function EloChart({ points, rankPoints, label, onPointClick }) {
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);

  const geo = useMemo(() => {
    const pts = (points || []).filter((p) => Number.isFinite(p.r));
    if (pts.length === 0) return null;
    const rk = (rankPoints || [])
      .filter((p) => Number.isFinite(p.rank))
      .slice()
      .sort((a, b) => parseT(a.t) - parseT(b.t));

    // --- domaine temporel PARTAGÉ par les deux séries ---
    const eloT = pts.map((p) => parseT(p.t));
    const rkT = rk.map((p) => parseT(p.t));
    const allT = [...eloT, ...rkT].filter(Number.isFinite);
    const tmin = allT.length ? Math.min(...allT) : NaN;
    const tmax = allT.length ? Math.max(...allT) : NaN;
    // `hasTime` porte sur la série ELO SEULE (pas sur l'union avec le rang) et
    // exige que TOUS ses points soient datés — comme avant l'ajout du rang
    // mondial (`times.every(Number.isFinite) && times.at(-1) > times[0]`). Un
    // simple `allT.filter(Number.isFinite)` laisserait passer un point Elo sans
    // date (souvent le DERNIER — un match sans matchTime connu) : `xOfT(NaN)`
    // retomberait alors sur sa branche de repli 0.5, épinglant ce point au
    // milieu horizontal du graphe (marqueur final, fermeture de l'aire et
    // dernier segment compris) au lieu de vraiment dégrader l'espacement.
    // On restaure donc le comportement d'origine — un seul point non daté fait
    // basculer TOUTE la série Elo en espacement par index — plutôt que
    // d'exclure ce point de `pts` : `last`/`cur` doivent rester la cote la plus
    // récente même non datée (c'est ce qu'affiche le reste de la fiche), et le
    // rang mondial n'est alors plus superposé sur une base temporelle fiable
    // (cf. `rank` ci-dessous, qui exige aussi `hasTime`) — même dégradation
    // groupée que pour l'Elo, pas une position individuelle trompeuse.
    const hasTime = eloT.every(Number.isFinite) && eloT[eloT.length - 1] > eloT[0];

    const xOfT = (t) => PAD.l + (hasTime && Number.isFinite(t) ? (t - tmin) / (tmax - tmin) : 0.5) * PW;
    const x = (i) => (hasTime ? xOfT(eloT[i]) : PAD.l + (pts.length === 1 ? 0.5 : i / (pts.length - 1)) * PW);

    // --- axe gauche : Elo ---
    const rs = pts.map((p) => p.r);
    const rmin = Math.min(...rs), rmax = Math.max(...rs);
    const pad = Math.max(15, (rmax - rmin) * 0.2);
    const ylo = Math.floor((rmin - pad) / 10) * 10;
    const yhi = Math.ceil((rmax + pad) / 10) * 10;
    const y = (r) => PAD.t + (1 - (r - ylo) / (yhi - ylo || 1)) * PH;

    const ticks = [];
    for (let k = 0; k <= 3; k++) ticks.push(Math.round(ylo + (k / 3) * (yhi - ylo)));

    const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.r).toFixed(1)}`).join(" ");
    const base = PAD.t + PH;
    const area = `${line} L ${x(pts.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`;

    // --- axe droit : rang mondial, inversé (rang 1 en haut) ---
    let rank = null;
    if (rk.length && hasTime) {
      const ranks = rk.map((p) => p.rank);
      let lo = Math.min(...ranks), hiR = Math.max(...ranks);
      if (lo === hiR) { lo = Math.max(1, lo - 5); hiR = hiR + 5; }
      const yR = (v) => PAD.t + ((v - lo) / (hiR - lo || 1)) * PH;

      // Segments : coupure dès qu'une semaine manque.
      const segments = [];
      let cur = [rk[0]];
      for (let i = 1; i < rk.length; i++) {
        if (rkT[i] - rkT[i - 1] > RANK_GAP_MS) { segments.push(cur); cur = []; }
        cur.push(rk[i]);
      }
      segments.push(cur);

      const paths = segments
        .filter((s) => s.length > 1)
        .map((s) => s.map((p, i) => `${i ? "L" : "M"} ${xOfT(parseT(p.t)).toFixed(1)} ${yR(p.rank).toFixed(1)}`).join(" "));
      const isolated = segments.filter((s) => s.length === 1).map((s) => s[0]);

      const rTicks = [];
      for (let k = 0; k <= 3; k++) rTicks.push(Math.round(lo + (k / 3) * (hiR - lo)));

      rank = { pts: rk, yR, paths, isolated, ticks: [...new Set(rTicks)], first: rk[0], last: rk[rk.length - 1] };
    }

    return { pts, x, y, xOfT, ticks, line, area, base, hasTime, tmin, tmax,
             first: pts[0], last: pts[pts.length - 1], rank };
  }, [points, rankPoints]);

  if (!geo) return <div className="muted" style={{ padding: "8px 0" }}>Pas encore d'historique de cote.</div>;

  const { pts, x, y, xOfT, ticks, line, area, first, last, rank, hasTime, tmin, tmax } = geo;

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = Math.abs(x(i) - vbx); if (d < bd) { bd = d; best = i; } }
    setHi(best);
  };

  const cur = last.r, delta = last.r - first.r;

  // Rang mondial le plus proche du point Elo survolé (pour l'infobulle).
  const rankNear = (t) => {
    if (!rank) return null;
    const target = parseT(t);
    let best = null, bd = Infinity;
    for (const p of rank.pts) { const d = Math.abs(parseT(p.t) - target); if (d < bd) { bd = d; best = p; } }
    return bd <= RANK_GAP_MS ? best : null;
  };

  const aria = rank
    ? `Évolution en ${label} : cote Elo de ${first.r} à ${cur} points, et rang mondial de ${rank.first.rank} à ${rank.last.rank}`
    : `Évolution de la cote Elo en ${label} : de ${first.r} à ${cur} points`;

  return (
    <div className="chart" role="img" aria-label={aria}>
      <div className="chart-head">
        <span className="chart-title">{label}</span>
        <span className="chart-cur">
          {cur} <span className={`form ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "→ 0"}
          </span>
          <span className="muted"> sur la période</span>
        </span>
      </div>

      {rank && (
        <div className="chart-legend">
          <span className="chart-leg">
            <span className="chart-leg-swatch" style={{ background: "var(--accent)" }} />
            <span className="chart-leg-name">Cote Elo (échelle de gauche)</span>
          </span>
          <span className="chart-leg">
            <span className="chart-leg-swatch" style={{ background: "var(--accent-2)" }} />
            <span className="chart-leg-name">Rang mondial (droite, 1er en haut)</span>
          </span>
        </div>
      )}

      <div className="chart-plot">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
             style={{ cursor: hi != null && pts[hi]?.tmtId ? "pointer" : "default" }}
             onMouseMove={onMove} onMouseLeave={() => setHi(null)}
             onClick={() => { if (hi != null && pts[hi]?.tmtId) onPointClick?.(pts[hi]); }}>
          {ticks.map((t) => (
            <g key={`e${t}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{t}</text>
            </g>
          ))}

          {/* rang mondial : axe droit, valeurs croissantes vers le bas */}
          {rank && rank.ticks.map((v) => (
            <text key={`r${v}`} x={W - PAD.r + 8} y={rank.yR(v) + 4}
                  fontSize="12" fill="var(--accent-2)">{v}e</text>
          ))}

          <path d={area} fill="var(--accent)" fillOpacity="0.12" stroke="none" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {rank && rank.paths.map((d, i) => (
            <path key={`rp${i}`} d={d} fill="none" stroke="var(--accent-2)" strokeWidth="2"
                  strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {rank && rank.isolated.map((p, i) => (
            <circle key={`ri${i}`} cx={xOfT(parseT(p.t))} cy={rank.yR(p.rank)} r="2.5" fill="var(--accent-2)" />
          ))}

          <circle cx={x(pts.length - 1)} cy={y(last.r)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />

          {hi != null && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--muted)" strokeWidth="1" />
              <circle cx={x(hi)} cy={y(pts[hi].r)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}

          {/* Bornes de l'axe X : quand l'axe est temporel (hasTime), il couvre le
              domaine PARTAGÉ (tmin/tmax, éventuellement étendu par le rang
              mondial au-delà du dernier point Elo) — les libellés doivent donc
              décrire ce domaine, pas la série Elo seule (first.t/last.t), sans
              quoi ils mentiraient sur la période couverte à droite du graphe.
              Quand l'axe retombe en espacement par index (pas de date
              exploitable sur toute la série Elo), il n'y a plus de domaine
              temporel réel : on redonne alors les dates des points réellement
              tracés aux deux extrémités, comme avant l'ajout du rang mondial. */}
          <text x={PAD.l} y={H - 6} fontSize="12" fill="var(--muted)">{hasTime ? fmtDateMs(tmin) : fmtDate(first.t)}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="12" fill="var(--muted)">{hasTime ? fmtDateMs(tmax) : fmtDate(last.t)}</text>
        </svg>

        {hi != null && (
          <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%`, top: `${(y(pts[hi].r) / H) * 100}%` }}>
            <div className="tip-r">
              <b>{pts[hi].r}</b>
              {typeof pts[hi].d === "number" && (
                <span className={`form ${pts[hi].d > 0 ? "up" : pts[hi].d < 0 ? "down" : "flat"}`}>
                  {pts[hi].d > 0 ? `+${pts[hi].d}` : pts[hi].d}
                </span>
              )}
            </div>
            <div className="tip-line">
              <span className={pts[hi].won ? "win" : "loss"}>{pts[hi].won ? "Victoire" : "Défaite"}</span>
              {pts[hi].round ? ` · ${pts[hi].round}` : ""} · {fmtDate(pts[hi].t)}
            </div>
            {pts[hi].opp && <div className="tip-line muted">vs {pts[hi].opp}</div>}
            {rankNear(pts[hi].t) && (
              <div className="tip-line muted">Mondial : {rankNear(pts[hi].t).rank}e</div>
            )}
            {pts[hi].tmt && <div className="tip-tmt">{pts[hi].tmt}</div>}
            {pts[hi].tmtId && <div className="tip-go">Voir le match ↓</div>}
          </div>
        )}
      </div>
    </div>
  );
}

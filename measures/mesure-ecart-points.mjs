// measures/mesure-ecart-points.mjs
// MESURE (étape 1 — isolation) : l'écart de POINTS des matchs passés
// (21-19 vs 21-5) porte-t-il de l'information que l'Elo n'a pas ?
//
//   node measures/mesure-ecart-points.mjs
//
// L'Elo ne compte que les manches : un match écrasé et un match arraché
// produisent la même mise à jour. Le facteur testé est la « domination
// passée » : la part moyenne de points gagnés sur les N derniers matchs
// (0,5 = équilibre). Elle est accumulée CHRONOLOGIQUEMENT via le crochet
// onMatch et lue AVANT d'être mise à jour avec le match courant — mêmes
// garanties anti-fuite que lib/dataset.mjs.
//
// Criblage par la méthode de référence du projet (lib/screen.mjs) : matchs
// entre entités d'Elo quasi identique, le facteur désigne le camp le plus
// dominateur ; tout écart à 50 % lui est imputable. Bootstrap à graine fixe.
//
// NB : ceci n'est que l'ÉTAPE 1 des trois (isolation → ajustement conjoint →
// hors échantillon). Un facteur qui échoue ici est écarté ; un facteur qui
// passe doit encore prouver son apport MARGINAL puis survivre sur 2026.

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { screenFactor, picksHigher, SKILL_WINDOWS } from "../lib/screen.mjs";

const FENETRE = 10;   // domination = moyenne sur les N derniers matchs
const MIN_HISTO = 5;  // en dessous, le facteur ne se prononce pas

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();

/** Part des points gagnés par team1 sur l'ensemble du match (0,5 = équilibre). */
function partPointsTeam1(score) {
  let pour = 0, contre = 0;
  for (const s of score || []) {
    if (!Number.isFinite(s?.home) || !Number.isFinite(s?.away)) return null;
    pour += s.home; contre += s.away;
  }
  return pour + contre > 0 ? pour / (pour + contre) : null;
}

const histo = new Map(); // cléEntité -> dernières parts de points (bornée à FENETRE)
const domOf = (cle) => {
  const h = histo.get(cle) || [];
  if (h.length < MIN_HISTO) return null;
  return h.reduce((s, v) => s + v, 0) / h.length;
};

const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ disc, match, won, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    const part = partPointsTeam1(match.score);

    // LECTURE avant mise à jour : uniquement de l'information d'avant match.
    const domA = domOf(`${disc}|${a.key}`), domB = domOf(`${disc}|${b.key}`);
    if (domA != null && domB != null) {
      rows.push({ eloA: a.entity.rating, eloB: b.entity.rating, won, domA, domB });
    }

    // MISE À JOUR après lecture.
    if (part != null) {
      for (const [cle, v] of [[`${disc}|${a.key}`, part], [`${disc}|${b.key}`, 1 - part]]) {
        const h = histo.get(cle) || [];
        h.push(v);
        if (h.length > FENETRE) h.shift();
        histo.set(cle, h);
      }
    }
  },
});
console.log(`Matchs où la domination passée des DEUX camps est connue : ${rows.length}`);
console.log(`(domination = part de points sur les ${FENETRE} derniers matchs, ≥ ${MIN_HISTO} matchs d'historique)\n`);

// Le facteur désigne le camp le plus dominateur aux points ; écart minimal de
// 1 point de pourcentage pour ne pas se prononcer sur du bruit.
const pick = (r) => {
  if (Math.abs(r.domA - r.domB) < 0.01) return null;
  return r.domA > r.domB ? 1 : 0;
};

console.log("Criblage en isolation, à niveau contrôlé (référence 50 %) :");
console.log("fenêtre |ΔElo| | n | réussite | IC 95 % | significatif");
for (const w of screenFactor(rows, pick, { windows: SKILL_WINDOWS })) {
  console.log(
    `  ≤ ${String(w.window).padEnd(3)} ${String(w.n).padStart(6)}  ` +
    (w.rate == null ? "  —  " : `${(100 * w.rate).toFixed(1)} %`) +
    (w.lo == null ? "" : `  [${(100 * w.lo).toFixed(1)} ; ${(100 * w.hi).toFixed(1)}]`) +
    `  ${w.significant ? "OUI" : "non"}${w.tooFew ? " (trop peu)" : ""}`
  );
}

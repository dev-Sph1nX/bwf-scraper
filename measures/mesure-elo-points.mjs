// measures/mesure-elo-points.mjs
// MESURE : un Elo construit avec la MARGE DE POINTS (« Elo-bis ») prédit-il
// mieux que l'Elo actuel ?
//
//   node measures/mesure-elo-points.mjs
//
// Idée (propriétaire) : ne pas ajouter la domination comme signal externe,
// mais l'injecter dans la CONSTRUCTION de la note — un 21-5 met à jour plus
// fort qu'un 21-19 (variante pointsFactor de lib/elo.mjs, avec amortissement
// anti-autocorrélation façon FiveThirtyEight).
//
// PROTOCOLE (leçon du §1.4 du journal : un gain de réglage ne se transfère
// pas forcément) :
//   - grille de paramètres évaluée sur 2024-2025 (SÉLECTION, log loss) ;
//   - la meilleure config est jugée UNIQUEMENT sur 2026 (VÉRIFICATION),
//     contre l'Elo actuel, sur exactement les mêmes matchs (comparaison
//     appariée : même collecte, même seuil provisoire) ;
//   - bootstrap apparié à graine fixe sur la différence de log loss.

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank, winnerPointShare } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { accuracy, brier, logLoss, makeRng } from "../lib/metrics.mjs";

const PROVISOIRE = 5;

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();

/** Rejoue tout l'historique avec des paramètres donnés -> une proba par match. */
async function collecte(params) {
  const rows = [];
  await computeElo(years, seeds, {
    params,
    onMatch: ({ match, won, a, b }) => {
      if (isWalkover(match) || !match.matchTime) return;
      if (a.entity.matches < PROVISOIRE || b.entity.matches < PROVISOIRE) return;
      rows.push({
        year: Number(String(match.matchTime).slice(0, 4)),
        won,
        p: 1 / (1 + 10 ** ((b.entity.rating - a.entity.rating) / 400)),
      });
    },
  });
  return rows;
}

// Marge de référence mesurée sur les données (part du vainqueur − 0,5),
// plutôt qu'une valeur devinée.
{
  let somme = 0, n = 0;
  await computeElo(years, seeds, {
    onMatch: ({ match }) => {
      if (isWalkover(match)) return;
      const s = winnerPointShare(match.score, match.winner);
      if (s != null) { somme += s - 0.5; n++; }
    },
  });
  var REF = somme / n; // var : lisible depuis le reste du script
  console.log(`Marge de référence mesurée : ${REF.toFixed(4)} (sur ${n} matchs)\n`);
}

const stats = (rows, filtre) => {
  const sel = rows.filter(filtre);
  return {
    n: sel.length,
    logLoss: logLoss(sel.map((r) => r.p), sel.map((r) => r.won)),
    brier: brier(sel.map((r) => r.p), sel.map((r) => r.won)),
    acc: accuracy(sel.map((r) => r.p), sel.map((r) => r.won)),
  };
};
const enSelection = (r) => r.year < 2026;
const enVerif = (r) => r.year === 2026;
const ligne = (nom, s) =>
  console.log(`${nom.padEnd(34)} n=${s.n}  logLoss=${s.logLoss.toFixed(4)}  brier=${s.brier.toFixed(4)}  réussite=${(100 * s.acc).toFixed(2)} %`);

// --- Référence : l'Elo actuel ---------------------------------------------------
const base = await collecte(undefined);
console.log("SÉLECTION (2024-2025) :");
ligne("Elo actuel", stats(base, enSelection));

// --- Grille de variantes --------------------------------------------------------
const GRILLE = [];
for (const pointsFactor of [0.5, 1, 1.5]) {
  for (const pointsDamping of [true, false]) {
    GRILLE.push({ pointsFactor, pointsRef: REF, pointsDamping });
  }
}

let best = null;
const resultats = [];
for (const params of GRILLE) {
  const rows = await collecte(params);
  if (rows.length !== base.length) throw new Error("collectes non appariées — le protocole est cassé");
  const s = stats(rows, enSelection);
  const nom = `pointsFactor=${params.pointsFactor}${params.pointsDamping ? " +amorti" : ""}`;
  ligne(nom, s);
  resultats.push({ params, rows, nom, sel: s });
  if (!best || s.logLoss < best.sel.logLoss) best = resultats[resultats.length - 1];
}

// --- Verdict : 2026 uniquement, comparaison appariée ----------------------------
console.log(`\nMeilleure config en sélection : ${best.nom}`);
console.log("\nVÉRIFICATION (2026, jamais utilisé pour choisir) :");
const b26 = stats(base, enVerif);
const v26 = stats(best.rows, enVerif);
ligne("Elo actuel", b26);
ligne(best.nom, v26);

// Bootstrap APPARIÉ de la différence de log loss (graine fixe) : les deux
// modèles sont évalués sur les mêmes matchs, on rééchantillonne les paires.
{
  const idx = [];
  for (let i = 0; i < base.length; i++) if (enVerif(base[i])) idx.push(i);
  const perte = (r) => (r.won === 1 ? -Math.log(Math.max(1e-15, r.p)) : -Math.log(Math.max(1e-15, 1 - r.p)));
  const diffs = idx.map((i) => perte(best.rows[i]) - perte(base[i])); // <0 = variante meilleure
  const rng = makeRng(42);
  const draws = 2000, moyennes = [];
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let k = 0; k < diffs.length; k++) s += diffs[Math.floor(rng() * diffs.length)];
    moyennes.push(s / diffs.length);
  }
  moyennes.sort((a, b) => a - b);
  const lo = moyennes[Math.floor(0.025 * draws)], hi = moyennes[Math.floor(0.975 * draws)];
  const m = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  console.log(`\nΔ log loss 2026 (variante − actuel) : ${m.toFixed(4)}  IC 95 % [${lo.toFixed(4)} ; ${hi.toFixed(4)}]`);
  console.log(hi < 0 ? "→ la variante est MEILLEURE, intervalle entièrement négatif ✅"
    : lo > 0 ? "→ la variante est PIRE, intervalle entièrement positif ❌"
    : "→ NON DÉPARTAGEABLE sur 2026 (l'intervalle contient 0)");
}

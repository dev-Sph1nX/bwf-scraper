// lib/screen.mjs
// Criblage des facteurs EN ISOLATION, à niveau contrôlé.
//
// Première des trois étapes de validation d'un facteur :
//
//   1. ISOLATION (ce module) — ce facteur porte-t-il de l'information ?
//   2. ajustement conjoint    — en apporte-t-il EN PLUS des autres ?
//   3. vérification hors échantillon — le gain survit-il sur des données neuves ?
//
// Pourquoi cette étape est indispensable, et pas seulement un préliminaire
// commode : un test conditionnel (comparer le résultat observé à la probabilité
// prédite par l'Elo) peut MASQUER un effet réel, parce que l'effet se noie dans
// la variance d'un échantillon aux écarts de niveau très hétérogènes. C'est
// arrivé sur la fraîcheur : jugée sans valeur par le test conditionnel, elle
// ressort nettement ici.
//
// Le contrôle est direct plutôt que statistique : on ne garde que les matchs
// entre entités de niveau QUASI IDENTIQUE. Le niveau ne peut alors plus
// expliquer le résultat, la référence devient un 50 % propre, et tout écart à
// 50 % est imputable au facteur testé. Aucune hypothèse sur la justesse de la
// probabilité Elo n'est nécessaire — c'est ce qui rend le test robuste.

import { makeRng } from "./metrics.mjs";

/** Écarts de note tolérés pour considérer deux entités « de même niveau ». */
export const SKILL_WINDOWS = [30, 50, 80];

/**
 * Taux de réussite d'un critère binaire, avec intervalle de confiance.
 *
 * @param {Array<{pick: 0|1, won: 0|1}>} cas  `pick` = 1 si le critère désigne A
 * @param {{draws?:number, seed?:number}} o
 * @returns {{n:number, rate:number|null, lo:number|null, hi:number|null, significant:boolean}}
 */
export function hitRate(cas, { draws = 2000, seed = 42, minN = 80 } = {}) {
  const n = cas.length;
  if (n < minN) return { n, rate: n ? cas.filter((c) => c.pick === c.won).length / n : null, lo: null, hi: null, significant: false, tooFew: true };

  const juste = (c) => (c.pick === c.won ? 1 : 0);
  const rate = cas.reduce((s, c) => s + juste(c), 0) / n;

  const rng = makeRng(seed);
  const ech = [];
  for (let d = 0; d < draws; d++) {
    let t = 0;
    for (let i = 0; i < n; i++) t += juste(cas[Math.floor(rng() * n)]);
    ech.push(t / n);
  }
  ech.sort((a, b) => a - b);
  const lo = ech[Math.floor(0.025 * draws)], hi = ech[Math.floor(0.975 * draws)];
  return { n, rate, lo, hi, significant: lo > 0.5 || hi < 0.5 };
}

/**
 * Crible un facteur sur plusieurs fenêtres de niveau.
 *
 * @param {Array} rows            lignes du jeu de données d'avant match
 * @param {(r:any)=>0|1|null} pick  1 si le facteur désigne A, 0 pour B, null s'il ne se prononce pas
 * @param {{windows?:number[], seed?:number}} o
 * @returns {Array<{window:number, n:number, rate, lo, hi, significant}>}
 */
export function screenFactor(rows, pick, { windows = SKILL_WINDOWS, seed = 42 } = {}) {
  return windows.map((w) => {
    const cas = [];
    for (const r of rows) {
      if (!Number.isFinite(r.eloA) || !Number.isFinite(r.eloB)) continue;
      if (Math.abs(r.eloA - r.eloB) >= w) continue;   // contrôle du niveau
      const p = pick(r);
      if (p !== 0 && p !== 1) continue;               // le facteur ne se prononce pas
      cas.push({ pick: p, won: r.won });
    }
    return { window: w, ...hitRate(cas, { seed }) };
  });
}

/** Le facteur désigne le camp dont la valeur est la PLUS BASSE (charge, rang…). */
export const picksLower = (fa, fb) => (r) => {
  const a = fa(r), b = fb(r);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return a < b ? 1 : 0;
};

/** Le facteur désigne le camp dont la valeur est la PLUS HAUTE (forme, H2H…). */
export const picksHigher = (fa, fb) => (r) => {
  const a = fa(r), b = fb(r);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return a > b ? 1 : 0;
};

/**
 * Variante à seuil : le facteur ne se prononce QUE si l'écart dépasse `seuil`.
 *
 * Utile parce que plusieurs effets se sont révélés être des effets de PALIER et
 * non proportionnels : sous le seuil, le facteur n'a rien à dire, et l'inclure
 * dilue le signal dans du bruit.
 */
export const picksLowerBeyond = (fa, fb, seuil) => (r) => {
  const a = fa(r), b = fb(r);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a - b) < seuil) return null;
  return a < b ? 1 : 0;
};

/** Les facteurs à cribler. `pick` renvoie le camp désigné, ou null. */
export const FACTORS = [
  { key: "load", label: "Fraîcheur (charge du tournoi)", pick: picksLower((r) => r.loadA, (r) => r.loadB) },
  { key: "load20", label: "Fraîcheur, écart >= 20 min", pick: picksLowerBeyond((r) => r.loadA, (r) => r.loadB, 20) },
  { key: "form", label: "Forme récente", pick: picksHigher((r) => r.formA, (r) => r.formB) },
  { key: "h2h", label: "Face-à-face", pick: picksHigher((r) => r.h2hA, (r) => r.h2hB) },
  { key: "rest", label: "Repos (moins de jours d'arrêt)", pick: picksLower((r) => r.daysOffA, (r) => r.daysOffB) },
  { key: "bwf", label: "Classement mondial", pick: picksLower((r) => r.bwfRankA, (r) => r.bwfRankB) },
  { key: "seed", label: "Tête de série", pick: picksLower((r) => r.seedA, (r) => r.seedB) },
  { key: "exp", label: "Expérience (plus de matchs joués)", pick: picksHigher((r) => r.nA, (r) => r.nB) },
];

// ÉCARTÉ — « l'adversaire sortait d'un 3 manches ».
//
// C'était le facteur le plus fort du criblage (57,5 % à niveau proche), mais il
// est retiré : mesuré contre « fraîcheur >= 20 min », les deux désignent le même
// camp dans 93 % des cas, et les 113 matchs qu'il couvrait seul donnent 56,6 %
// avec l'intervalle [46,9 ; 65,5] — non significatif. Ce n'est donc pas un signal
// distinct, seulement une autre façon de coder l'écart de charge : un match qui
// part au 3e set est un match long. Le conserver reviendrait à compter deux fois
// la même information dans l'ajustement conjoint.

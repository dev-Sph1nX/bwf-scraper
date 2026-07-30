// lib/models.mjs
// Les modèles comparés par le backtest. Chacun est une fonction PURE d'une ligne
// du jeu de données vers la probabilité que le camp A (team1) gagne, ou `null`
// s'il ne peut pas se prononcer sur ce match.
//
// L'intérêt du backtest n'est pas le chiffre de chaque modèle, c'est l'ÉCART
// entre eux : si l'Elo ne bat pas le classement mondial, notre calcul n'apporte
// rien ; si le modèle additif ne bat pas l'Elo simple, ses signaux ne servent à
// rien et le panneau d'explication serait du décor.
//
// Le renvoi de `null` est ce qui rend la comparaison honnête : les modèles n'ont
// pas la même couverture (tous les joueurs ne sont pas têtes de série, ni
// classés au mondial). On mesure donc chacun sur deux ensembles — le SOCLE
// COMMUN où tous se prononcent, seul comparable, et sa couverture propre.

import { PARAMS } from "./elo.mjs";

/** Probabilité Elo standard que A gagne, depuis l'écart de notes. */
export const eloProb = (eloA, eloB) => 1 / (1 + Math.pow(10, (eloB - eloA) / 400));

/**
 * Compare deux valeurs où le PLUS PETIT est le meilleur (rang, tête de série).
 * Rend 1 si A est mieux placé, 0 si B l'est, 0.5 en cas d'égalité, `null` si
 * l'une des deux valeurs manque.
 */
function betterIsLower(a, b) {
  if (a == null || b == null) return null;
  if (a === b) return 0.5;
  return a < b ? 1 : 0;
}

/** Une entité est « provisoire » tant qu'elle a joué moins de N matchs. */
export const isProvisional = (n) => !Number.isFinite(n) || n < PARAMS.provisionalMatches;

/**
 * Les modèles, dans l'ordre de sophistication croissante.
 *
 * `binary: true` signale un modèle qui désigne un vainqueur sans nuance (0 ou 1).
 * C'est volontaire — c'est ce que « le mieux classé gagne » veut dire — et son
 * score de Brier en sera lourdement pénalisé. C'est précisément l'information
 * qu'on cherche : une règle sans nuance est mauvaise pour parier même quand elle
 * a souvent raison, parce qu'elle ne dit jamais à quel point elle est sûre.
 */
export const MODELS = [
  {
    key: "random",
    label: "Hasard",
    binary: false,
    predict: () => 0.5,
  },
  {
    key: "seed",
    label: "Tête de série",
    binary: true,
    predict: (r) => betterIsLower(r.seedA, r.seedB),
  },
  {
    key: "bwf",
    label: "Classement mondial",
    binary: true,
    predict: (r) => betterIsLower(r.bwfRankA, r.bwfRankB),
  },
  {
    key: "elo",
    label: "Elo simple",
    binary: false,
    predict: (r) => {
      if (isProvisional(r.nA) || isProvisional(r.nB)) return null;
      if (!Number.isFinite(r.eloA) || !Number.isFinite(r.eloB)) return null;
      return eloProb(r.eloA, r.eloB);
    },
  },
];

export const modelByKey = (key) => MODELS.find((m) => m.key === key) || null;

/**
 * Calcule les prédictions de tous les modèles pour chaque ligne.
 *
 * @param {Array} rows
 * @param {Array} models
 * @returns {{preds: Array<Record<string, number|null>>, coverage: Record<string, number>}}
 */
export function predictAll(rows, models = MODELS) {
  const preds = [];
  const coverage = {};
  for (const m of models) coverage[m.key] = 0;

  for (const r of rows) {
    const p = {};
    for (const m of models) {
      const v = m.predict(r);
      p[m.key] = v == null || !Number.isFinite(v) ? null : v;
      if (p[m.key] != null) coverage[m.key]++;
    }
    preds.push(p);
  }
  return { preds, coverage };
}

/**
 * Indices des lignes où TOUS les modèles se prononcent.
 *
 * C'est le seul ensemble sur lequel les chiffres sont comparables entre modèles.
 * Comparer un taux obtenu sur 13 000 matchs à un taux obtenu sur 900 n'a aucun
 * sens, et ne publier que l'un des deux invite à le faire.
 */
export function commonBase(preds, models = MODELS) {
  const keys = models.map((m) => m.key);
  const idx = [];
  for (let i = 0; i < preds.length; i++) {
    if (keys.every((k) => preds[i][k] != null)) idx.push(i);
  }
  return idx;
}

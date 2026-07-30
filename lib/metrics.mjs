// lib/metrics.mjs
// Métriques d'évaluation du backtest, toutes des fonctions pures.
//
// Le taux de réussite est la colonne principale des écrans parce que c'est la
// seule grandeur qui se lit sans formation. Mais il a un angle mort : un modèle
// qui annonce 51 % et un qui annonce 95 % comptent identiquement quand ils ont
// raison. Or pour parier l'écart est décisif — c'est lui qui détermine la mise.
// Deux modèles à 70 % de réussite peuvent être l'un rentable, l'autre ruineux.
// D'où le score de Brier à côté, avec la seule indication « plus bas = mieux ».

/** Générateur pseudo-aléatoire à graine (mulberry32).
 *
 *  On n'utilise PAS Math.random : des intervalles de confiance qui bougent d'une
 *  exécution à l'autre rendraient les conclusions non reproductibles, et un
 *  écart entre deux disciplines pourrait apparaître ou disparaître au hasard. */
export function makeRng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Taux de réussite. Une prédiction à exactement 0,5 compte pour un demi-succès. */
export function accuracy(preds, outcomes) {
  if (!preds.length) return null;
  let s = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = preds[i], y = outcomes[i];
    if (p === 0.5) s += 0.5;
    else if ((p > 0.5 && y === 1) || (p < 0.5 && y === 0)) s += 1;
  }
  return s / preds.length;
}

/** Score de Brier : moyenne de (p − résultat)². Plus bas est meilleur. */
export function brier(preds, outcomes) {
  if (!preds.length) return null;
  let s = 0;
  for (let i = 0; i < preds.length; i++) s += (preds[i] - outcomes[i]) ** 2;
  return s / preds.length;
}

/**
 * Log loss. Pénalise durement les certitudes fausses.
 *
 * Les probabilités sont bornées loin de 0 et 1 : sans cela, un modèle binaire
 * (0 ou 1) qui se trompe une seule fois donnerait un log loss infini, ce qui
 * rendrait la colonne inutilisable pour comparer les modèles.
 */
export function logLoss(preds, outcomes, eps = 1e-15) {
  if (!preds.length) return null;
  let s = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = Math.min(1 - eps, Math.max(eps, preds[i]));
    s += outcomes[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / preds.length;
}

/** Part des matchs où le camp le moins bien noté gagne. */
export function upsetRate(preds, outcomes) {
  if (!preds.length) return null;
  let surprises = 0, decides = 0;
  for (let i = 0; i < preds.length; i++) {
    if (preds[i] === 0.5) continue;
    decides++;
    const favoriEstA = preds[i] > 0.5;
    if ((favoriEstA && outcomes[i] === 0) || (!favoriEstA && outcomes[i] === 1)) surprises++;
  }
  return decides ? surprises / decides : null;
}

/**
 * Bandes de confiance. Le taux de surprise GLOBAL est une métrique trop
 * grossière : un match donné à 51 % y compte autant qu'un match donné à 95 %,
 * alors que ce ne sont pas les mêmes événements. Une discipline où le modèle est
 * peu tranché récolte donc mécaniquement plus de « surprises » sans être moins
 * prévisible pour autant. La décomposition par bande sépare les deux.
 */
export const CONFIDENCE_BANDS = [
  { key: "tight", lo: 0.5, hi: 0.6, label: "Serrés", range: "50-60 %" },
  { key: "clear", lo: 0.6, hi: 0.75, label: "Nets", range: "60-75 %" },
  { key: "strong", lo: 0.75, hi: 0.9, label: "Francs", range: "75-90 %" },
  { key: "heavy", lo: 0.9, hi: 1.01, label: "Écrasants", range: "90 %+" },
];

/**
 * Taux de surprise par bande de confiance, plus la part de matchs dans chaque
 * bande. Les prédictions sont orientées sur le favori en interne, donc la
 * fonction accepte aussi bien des probabilités « camp A » que déjà orientées.
 *
 * @returns {Array<{key, label, range, n, share, upsetRate}>}
 */
export function upsetByBand(preds, outcomes, bands = CONFIDENCE_BANDS) {
  const total = preds.length;
  const oriente = [];
  for (let i = 0; i < total; i++) {
    const favEstA = preds[i] >= 0.5;
    oriente.push({ p: favEstA ? preds[i] : 1 - preds[i], gagne: favEstA ? outcomes[i] : 1 - outcomes[i] });
  }
  return bands.map((b) => {
    const dans = oriente.filter((x) => x.p >= b.lo && x.p < b.hi);
    const victoires = dans.filter((x) => x.gagne === 1).length;
    return {
      key: b.key, label: b.label, range: b.range,
      n: dans.length,
      share: total ? dans.length / total : null,
      upsetRate: dans.length ? 1 - victoires / dans.length : null,
    };
  });
}

/** Netteté : écart moyen à 0,5. Dit à quel point le modèle ose se prononcer. */
export function sharpness(preds) {
  if (!preds.length) return null;
  let s = 0;
  for (const p of preds) s += Math.abs(p - 0.5);
  return s / preds.length;
}

/**
 * Courbe de calibration : `bins` tranches de probabilité prédite, avec le taux
 * observé dans chacune et son effectif.
 *
 * Les prédictions sont d'abord repliées au-dessus de 0,5 (« le favori gagne-t-il
 * aussi souvent que je l'annonce ? »), sinon chaque paire de tranches
 * symétriques dirait deux fois la même chose.
 */
export function calibration(preds, outcomes, bins = 10) {
  const acc = Array.from({ length: bins }, () => ({ somme: 0, obs: 0, n: 0 }));
  for (let i = 0; i < preds.length; i++) {
    const favoriEstA = preds[i] >= 0.5;
    const p = favoriEstA ? preds[i] : 1 - preds[i];
    const y = favoriEstA ? outcomes[i] : 1 - outcomes[i];
    // p ∈ [0.5, 1] -> tranche
    let k = Math.floor((p - 0.5) / (0.5 / bins));
    if (k >= bins) k = bins - 1;
    if (k < 0) k = 0;
    acc[k].somme += p; acc[k].obs += y; acc[k].n++;
  }
  return acc.map((a, k) => ({
    bin: `${Math.round((0.5 + k * (0.5 / bins)) * 100)}-${Math.round((0.5 + (k + 1) * (0.5 / bins)) * 100)}`,
    predicted: a.n ? a.somme / a.n : null,
    observed: a.n ? a.obs / a.n : null,
    n: a.n,
  }));
}

/** Erreur de calibration : écart moyen |prédit − observé|, pondéré par l'effectif. */
export function calibrationError(preds, outcomes, bins = 10) {
  const c = calibration(preds, outcomes, bins);
  let s = 0, n = 0;
  for (const b of c) {
    if (!b.n) continue;
    s += b.n * Math.abs(b.predicted - b.observed);
    n += b.n;
  }
  return n ? s / n : null;
}

/**
 * Intervalle de confiance par bootstrap (rééchantillonnage avec remise).
 *
 * @param {Function} stat  (preds, outcomes) => number|null
 * @param {{draws?: number, seed?: number, level?: number}} o
 * @returns {{value: number|null, lo: number|null, hi: number|null, n: number}}
 */
export function bootstrapCI(preds, outcomes, stat, { draws = 1000, seed = 42, level = 0.95 } = {}) {
  const n = preds.length;
  const value = stat(preds, outcomes);
  if (!n || value == null) return { value, lo: null, hi: null, n };

  const rng = makeRng(seed);
  const echantillons = [];
  const bp = new Array(n), bo = new Array(n);
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      bp[i] = preds[j]; bo[i] = outcomes[j];
    }
    const v = stat(bp, bo);
    if (v != null && Number.isFinite(v)) echantillons.push(v);
  }
  if (!echantillons.length) return { value, lo: null, hi: null, n };

  echantillons.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const at = (q) => echantillons[Math.min(echantillons.length - 1, Math.max(0, Math.floor(q * echantillons.length)))];
  return { value, lo: at(alpha), hi: at(1 - alpha), n };
}

/** Les intervalles de deux mesures se chevauchent-ils ? (= non départageables) */
export const overlaps = (a, b) =>
  a?.lo != null && b?.lo != null && a.lo <= b.hi && b.lo <= a.hi;

/** Toutes les métriques d'un modèle sur un ensemble de lignes. */
export function evaluate(preds, outcomes, { draws = 1000, seed = 42 } = {}) {
  return {
    n: preds.length,
    accuracy: bootstrapCI(preds, outcomes, accuracy, { draws, seed }),
    brier: bootstrapCI(preds, outcomes, brier, { draws, seed }),
    logLoss: logLoss(preds, outcomes),
    upsetRate: upsetRate(preds, outcomes),
    sharpness: sharpness(preds),
    calibrationError: calibrationError(preds, outcomes),
  };
}

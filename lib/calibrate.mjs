// lib/calibrate.mjs
// Recalibration de la probabilité Elo : le modèle est trop TIMIDE sur certaines
// disciplines — il annonce moins que ce qui se réalise.
//
// Pourquoi ça compte, alors que le gain de précision est minuscule (le score de
// Brier ne bouge que de ~0,5 %) : parier est une décision à SEUIL. Si le favori
// est sous-estimé de 3 points, l'outsider est mécaniquement surestimé d'autant,
// et le signe de la valeur attendue s'inverse près du seuil. Un outsider à la
// cote 4,00 a besoin de 25 % pour valoir le pari ; annoncer 28 % au lieu de 22 %
// transforme un pari perdant en « opportunité ». C'est donc un prérequis de
// SÉCURITÉ de la couche de mise, pas une amélioration du modèle.
//
// Mécanisme : on étire les log-cotes. `logit(p) -> facteur × logit(p)`, ce qui
// éloigne p de 50 % sans jamais changer QUI est favori — le taux de réussite est
// donc inchangé par construction, seule la confiance annoncée bouge.

/**
 * Facteurs d'étirement, mesurés sur 2024-2025 puis vérifiés sur 2026.
 *
 * Ne sont retenus que ceux dont l'intervalle de confiance bootstrap EXCLUT 1 :
 * pour MS et MD, la valeur 1 est dans l'intervalle, donc rien ne prouve un
 * défaut de calibration et appliquer un facteur reviendrait à ajuster du bruit.
 * XD est à la limite ([1,02 – 1,32]) et son facteur s'inverse en 2026 (0,92) :
 * écarté aussi, faute de stabilité.
 *
 * Constat de fond : la sous-confiance ne concerne que les disciplines féminines.
 *
 * | disc | 2024 | 2025 | 2026 | IC bootstrap    | retenu |
 * |------|------|------|------|-----------------|--------|
 * | WS   | 1,42 | 1,53 | 1,34 | [1,38 – 1,66]   | oui    |
 * | WD   | 1,38 | 1,27 | 1,37 | [1,14 – 1,52]   | oui    |
 * | XD   | 1,19 | 1,16 | 0,92 | [1,02 – 1,32]   | non    |
 * | MD   | 1,02 | 1,03 | 1,19 | [0,93 – 1,16]   | non    |
 * | MS   | 1,13 | 0,97 | 0,84 | [0,88 – 1,18]   | non    |
 */
export const STRETCH = { WS: 1.50, WD: 1.31 };

/** Facteur applicable à une discipline. 1 = aucune correction. */
export const stretchFor = (disc) => STRETCH[disc] ?? 1;

const EPS = 1e-9;

/**
 * Recalibre une probabilité pour une discipline.
 *
 * Les bornes 0 et 1 sont renvoyées telles quelles : leurs log-cotes sont
 * infinies, et les étirer n'aurait aucun sens (une certitude reste une
 * certitude). Une valeur hors [0,1] ou non finie renvoie `null` plutôt qu'un
 * `NaN` qui se propagerait silencieusement dans les métriques.
 */
export function recalibrate(p, disc) {
  if (!Number.isFinite(p) || p < 0 || p > 1) return null;
  const s = stretchFor(disc);
  if (s === 1) return p;
  if (p <= EPS || p >= 1 - EPS) return p;
  const z = Math.log(p / (1 - p));
  return 1 / (1 + Math.exp(-s * z));
}

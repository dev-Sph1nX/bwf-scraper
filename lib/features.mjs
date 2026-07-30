// lib/features.mjs
// Traduit une ligne du jeu de données d'avant match en variables exploitables
// par le modèle additif.
//
// Trois règles de conception :
//
//   1. Chaque variable est une DIFFÉRENCE orientée « camp A ». Positive = avantage
//      à A. Ça garantit qu'un signal absent vaut 0 (aucun avantage pour personne),
//      ce qui est une valeur neutre honnête — contrairement à une imputation par
//      la moyenne, qui inventerait un avantage.
//   2. Les échelles sont choisies pour que les coefficients soient comparables :
//      chaque variable vaut typiquement entre −1 et +1.
//   3. Le rang mondial est pris en LOGARITHME : passer du 1er au 5e est un abîme,
//      du 100e au 104e n'est rien. Une différence brute de rangs traiterait les
//      deux écarts à l'identique.

/** Les variables du modèle, dans l'ordre d'affichage de la cascade. */
export const FEATURES = [
  { key: "elo", label: "Écart Elo" },
  { key: "form", label: "Forme récente" },
  { key: "h2h", label: "Face-à-face" },
  { key: "fresh", label: "Fraîcheur (écart continu)" },
  { key: "fresh20", label: "Fraîcheur au-delà de 20 min" },
  { key: "rest", label: "Repos" },
  { key: "bwf", label: "Écart au classement mondial" },
  { key: "seed", label: "Têtes de série" },
];
// L'ordre ci-dessus DOIT correspondre à celui du tableau renvoyé par featuresOf.
// Un test le verrouille : une désynchronisation attribuerait silencieusement le
// poids d'une variable à une autre.

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const featureLabel = (key) => FEATURES.find((f) => f.key === key)?.label ?? key;

const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * Avantage de face-à-face, normalisé dans [−1, 1].
 *
 * Le dénominateur `total + 1` fait que 1 victoire à 0 pèse moins que 5 à 0 : une
 * seule confrontation est une information faible, et un ratio brut lui donnerait
 * le poids d'une certitude.
 */
export function h2hSignal(a, b) {
  const na = num(a) ?? 0, nb = num(b) ?? 0;
  return (na - nb) / (na + nb + 1);
}

/**
 * Variables d'une ligne, dans l'ordre de FEATURE_KEYS.
 * @returns {number[]}
 */
export function featuresOf(r) {
  const eloDiff = ((num(r.eloA) ?? 0) - (num(r.eloB) ?? 0)) / 400;
  const formDiff = ((num(r.formA) ?? 0) - (num(r.formB) ?? 0)) / 50;

  // La charge de l'ADVERSAIRE est un avantage pour A, d'où l'ordre B − A.
  // Le drapeau « sortait d'un 3 manches » est ajouté, en minutes équivalentes.
  const chargeA = (num(r.loadA) ?? 0) + (r.sets3A ? 20 : 0);
  const chargeB = (num(r.loadB) ?? 0) + (r.sets3B ? 20 : 0);
  const freshDiff = (chargeB - chargeA) / 60;

  // Repos : plafonné à 60 jours. Au-delà, l'information est « inactif depuis
  // longtemps » et non « de plus en plus reposé » — sans plafond, un joueur
  // absent 2 ans dominerait la variable.
  const cap = (v) => Math.min(num(v) ?? 30, 60);
  const restDiff = (cap(r.daysOffA) - cap(r.daysOffB)) / 30;

  // Rang mondial en log : seul l'écart RELATIF a un sens. 0 si l'un des deux
  // n'est pas classé — on ne peut pas comparer.
  const bwfDiff = (num(r.bwfRankA) && num(r.bwfRankB))
    ? (Math.log(r.bwfRankB) - Math.log(r.bwfRankA)) / 2
    : 0;

  // Têtes de série : 0 si l'un des deux n'en est pas une.
  const seedDiff = (num(r.seedA) && num(r.seedB)) ? (r.seedB - r.seedA) / 8 : 0;

  // Variante à SEUIL de la fraîcheur. Le criblage à niveau contrôlé montre que
  // l'effet est un PALIER et non une proportion : sous ~20 minutes d'écart, il n'y
  // a rien à dire, et une variable continue dilue le signal dans du bruit.
  const brut = (num(r.loadB) ?? 0) - (num(r.loadA) ?? 0);
  const fresh20 = Math.abs(brut) < 20 ? 0 : Math.sign(brut);

  return [eloDiff, formDiff, h2hSignal(r.h2hA, r.h2hB), freshDiff, fresh20, restDiff, bwfDiff, seedDiff];
}

/** Matrice des variables et cible, pour un ensemble de lignes. */
export function designMatrix(rows) {
  return { X: rows.map(featuresOf), y: rows.map((r) => r.won), keys: FEATURE_KEYS };
}

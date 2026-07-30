// lib/logistic.mjs
// Régression logistique, écrite à la main : le dépôt n'a que `playwright` comme
// dépendance et ce chantier n'introduit rien.
//
// Pourquoi une régression logistique et pas autre chose : c'est le seul modèle
// dont les contributions s'ADDITIONNENT par construction. C'est ce qui permet
// d'afficher un panneau « pourquoi ce pronostic » qui soit l'arithmétique réelle
// du calcul, et non une narration rédigée à côté. Une explication décorative est
// pire qu'aucune explication : elle produit de la confiance sans fondement.
//
// La formule Elo étant déjà une fonction logistique de l'écart de notes,
// l'extension est naturelle : on somme des termes dans la même échelle.

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Moyenne et écart-type de chaque colonne, pour centrer-réduire. */
function standardize(X) {
  const n = X.length, d = X[0]?.length ?? 0;
  const mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1; // colonne constante -> 1
  return { mean, std };
}

const applyStd = (row, mean, std) => row.map((v, j) => (v - mean[j]) / std[j]);

/**
 * Ajuste une régression logistique par descente de gradient.
 *
 * Les variables sont centrées-réduites en interne : sans cela, des colonnes
 * d'échelles très différentes font osciller la descente et les coefficients ne
 * sont pas comparables entre eux — or on veut justement les comparer pour dire
 * quel signal pèse le plus.
 *
 * @param {number[][]} X  matrice des variables
 * @param {number[]} y    cible binaire (0 ou 1)
 * @param {{l2?:number, lr?:number, epochs?:number, keys?:string[]}} o
 *        l2 : régularisation, freine les coefficients qu'aucune donnée ne soutient
 * @returns {{bias:number, weights:number[], mean:number[], std:number[], keys:string[], logLoss:number, epochs:number}}
 */
export function fitLogistic(X, y, { l2 = 1e-3, lr = 0.5, epochs = 3000, keys = null } = {}) {
  if (!X.length) throw new Error("aucune ligne à ajuster");
  if (X.length !== y.length) throw new Error(`X (${X.length}) et y (${y.length}) de tailles différentes`);

  const n = X.length, d = X[0].length;
  const { mean, std } = standardize(X);
  const Z = X.map((row) => applyStd(row, mean, std));

  let bias = 0;
  const w = new Array(d).fill(0);

  for (let it = 0; it < epochs; it++) {
    let gb = 0;
    const gw = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - y[i];
      gb += err / n;
      for (let j = 0; j < d; j++) gw[j] += (err * Z[i][j]) / n;
    }
    bias -= lr * gb;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] + l2 * w[j]);
  }

  // log loss final, pour vérifier la convergence
  let ll = 0;
  for (let i = 0; i < n; i++) {
    let z = bias;
    for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
    const p = Math.min(1 - 1e-15, Math.max(1e-15, sigmoid(z)));
    ll += (y[i] === 1 ? -Math.log(p) : -Math.log(1 - p)) / n;
  }

  return { bias, weights: w, mean, std, keys: keys || X[0].map((_, j) => `x${j}`), logLoss: ll, epochs };
}

/** Somme pondérée (log-cote) d'une ligne, selon un modèle ajusté. */
export function scoreLogistic(model, row) {
  const z = applyStd(row, model.mean, model.std);
  let s = model.bias;
  for (let j = 0; j < model.weights.length; j++) s += model.weights[j] * z[j];
  return s;
}

/** Probabilité prédite pour une ligne. */
export const predictLogistic = (model, row) => sigmoid(scoreLogistic(model, row));

/**
 * Contribution de chaque variable à la log-cote, pour un cas donné.
 *
 * Sert au panneau d'explication : une contribution est `poids × valeur centrée`,
 * donc positive si la variable pousse vers une victoire du camp A.
 */
export function contributions(model, row) {
  const z = applyStd(row, model.mean, model.std);
  return model.keys.map((key, j) => ({ key, value: row[j], contribution: model.weights[j] * z[j] }));
}

/**
 * Cascade exacte : on part du niveau de base et chaque variable montre le SAUT
 * de probabilité qu'elle provoque, dans un ordre fixé.
 *
 * Pourquoi une cascade et pas des contributions affichées côte à côte : un même
 * poids ne déplace pas la probabilité du même nombre de points selon qu'on part
 * de 50 % ou de 90 %. Afficher « +4 %, +2 %, −5 % » qui ne s'additionnent pas au
 * total réintroduirait exactement le flou qu'on cherche à supprimer. Ici la somme
 * des sauts égale le total PAR CONSTRUCTION.
 *
 * @returns {{steps: Array<{key, value, delta, cumulative}>, base: number, final: number}}
 */
export function explain(model, row, order = null) {
  const z = applyStd(row, model.mean, model.std);
  const ordre = order
    ? order.map((k) => model.keys.indexOf(k)).filter((j) => j >= 0)
    : model.keys.map((_, j) => j);

  let s = model.bias;
  const base = sigmoid(s);
  const steps = [];
  for (const j of ordre) {
    const avant = sigmoid(s);
    s += model.weights[j] * z[j];
    const apres = sigmoid(s);
    steps.push({ key: model.keys[j], value: row[j], delta: apres - avant, cumulative: apres });
  }
  return { steps, base, final: sigmoid(s) };
}

// measures/gbm.mjs
// GBM maison — arbres boostés à perte logistique, en JS pur.
//
// Pourquoi le réécrire plutôt qu'une dépendance : le projet est 100 % Node
// (pas de sklearn sur la machine, vérifié le 2026-08-19), le besoin est un
// UNIQUE banc d'essai reproductible, et l'algorithme tient en ~150 lignes.
// C'est le schéma standard type XGBoost, sans ses raffinements :
//
//   F₀(x) = offset fourni (logit d'un modèle de base) ou logit(moyenne de y)
//   à chaque tour : résidu rᵢ = yᵢ − sigmoïde(Fᵢ), hessien hᵢ = pᵢ(1−pᵢ) ;
//   un arbre de régression est ajusté sur r (critère : gain en somme de
//   carrés, recherche exhaustive des seuils) ; chaque feuille reçoit le pas
//   de Newton régularisé Σr / (Σh + λ) (borné à ±4) ; F += lr × arbre(x).
//
// ENTIÈREMENT DÉTERMINISTE : aucun sous-échantillonnage, aucune source
// d'aléa — deux ajustements sur les mêmes données rendent le même modèle.
// Ex æquo de gain : la première feature puis le premier seuil gagnent.
//
// L'option `offsets` sert la variante « résiduelle » du banc : les arbres
// partent du logit du modèle de production et n'apprennent que ce qu'il
// rate. Testé dans test/gbm.test.mjs (XOR, résidu, déterminisme).

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const clampLeaf = (v) => Math.max(-4, Math.min(4, v));
const EPS = 1e-12;

/**
 * Ajuste un arbre de régression sur les résidus.
 * @returns nœuds `{feat, thr, left, right}` ou feuilles `{value}`, racine en 0.
 */
function buildTree(X, resid, hess, idx, { depth, minLeaf, lambda }) {
  const nodes = [];
  const leafValue = (ids) => {
    let sr = 0, sh = 0;
    for (const i of ids) { sr += resid[i]; sh += hess[i]; }
    return clampLeaf(sr / (sh + lambda + EPS)); // L2 : amortit les feuilles peu peuplées
  };

  const grow = (ids, d) => {
    const node = nodes.length;
    nodes.push(null);
    let best = null;
    if (d < depth && ids.length >= 2 * minLeaf) {
      // Meilleure coupure toutes features confondues (gain en somme de carrés).
      let sT = 0;
      for (const i of ids) sT += resid[i];
      const baseScore = (sT * sT) / ids.length;
      for (let f = 0; f < X[0].length; f++) {
        const sorted = [...ids].sort((a, b) => X[a][f] - X[b][f]);
        let sL = 0;
        for (let k = 0; k < sorted.length - 1; k++) {
          sL += resid[sorted[k]];
          const nL = k + 1, nR = sorted.length - nL;
          if (nL < minLeaf || nR < minLeaf) continue;
          const vk = X[sorted[k]][f], vk1 = X[sorted[k + 1]][f];
          if (vk === vk1) continue; // pas de seuil entre deux valeurs égales
          const sR = sT - sL;
          const gain = (sL * sL) / nL + (sR * sR) / nR - baseScore;
          if (gain > EPS && (!best || gain > best.gain)) {
            best = { gain, feat: f, thr: (vk + vk1) / 2, sorted, k };
          }
        }
      }
    }
    if (!best) {
      nodes[node] = { value: leafValue(ids) };
      return node;
    }
    const left = best.sorted.slice(0, best.k + 1);
    const right = best.sorted.slice(best.k + 1);
    const l = grow(left, d + 1);
    const r = grow(right, d + 1);
    nodes[node] = { feat: best.feat, thr: best.thr, left: l, right: r };
    return node;
  };

  grow(idx, 0);
  return nodes;
}

function treeValue(nodes, x) {
  let n = nodes[0];
  while (n.value === undefined) n = x[n.feat] <= n.thr ? nodes[n.left] : nodes[n.right];
  return n.value;
}

/**
 * Arbres boostés, perte logistique.
 * @param {number[][]} X lignes de features (finies)
 * @param {number[]} y cibles 0/1
 * @param {object} opts trees, depth, lr, minLeaf, offsets (logit de base par ligne)
 */
export function fitGBM(X, y, { trees = 200, depth = 3, lr = 0.1, minLeaf = 50, lambda = 1, offsets = null } = {}) {
  if (!X.length) throw new Error("fitGBM : aucune ligne");
  if (X.length !== y.length) throw new Error(`fitGBM : tailles différentes (${X.length} vs ${y.length})`);
  if (offsets && offsets.length !== X.length) {
    throw new Error(`fitGBM : tailles différentes (offsets ${offsets.length} vs ${X.length})`);
  }
  const n = X.length;
  // Intercept : logit de la moyenne SEULEMENT sans offsets (avec offsets, la
  // base est déjà un modèle : un intercept global fausserait sa calibration).
  let base = 0;
  if (!offsets) {
    const m = Math.min(1 - 1e-6, Math.max(1e-6, y.reduce((s, v) => s + v, 0) / n));
    base = Math.log(m / (1 - m));
  }
  const F = new Array(n);
  for (let i = 0; i < n; i++) F[i] = base + (offsets ? offsets[i] : 0);

  const resid = new Array(n), hess = new Array(n);
  const idx = [...Array(n).keys()];
  const forest = [];
  for (let t = 0; t < trees; t++) {
    for (let i = 0; i < n; i++) {
      const p = sigmoid(F[i]);
      resid[i] = y[i] - p;
      hess[i] = Math.max(p * (1 - p), 1e-6);
    }
    const nodes = buildTree(X, resid, hess, idx, { depth, minLeaf, lambda });
    forest.push(nodes);
    for (let i = 0; i < n; i++) F[i] += lr * treeValue(nodes, X[i]);
  }
  return { base, lr, forest };
}

/** Probabilité (classe 1) ; `offset` = même logit de base qu'à l'ajustement. */
export function predictGBM(model, x, offset = 0) {
  let z = model.base + offset;
  for (const nodes of model.forest) z += model.lr * treeValue(nodes, x);
  return sigmoid(z);
}

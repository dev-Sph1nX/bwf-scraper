// Tests du GBM maison (measures/gbm.mjs) — arbres boostés à perte logistique.
//   node --test test/
//
// Comme pour logistic.test.mjs : on vérifie que le moteur RETROUVE des
// structures connues sur données synthétiques. Le test central est le XOR :
// une relation que la régression logistique NE PEUT PAS apprendre (aucune
// combinaison linéaire ne la sépare) mais qu'un arbre de profondeur ≥ 2
// capture — c'est précisément la raison d'être de la variante « arbres »
// au banc (chercher des interactions que le modèle additif rate).

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitGBM, predictGBM } from "../measures/gbm.mjs";
import { fitLogistic, predictLogistic } from "../lib/logistic.mjs";
import { makeRng, logLoss } from "../lib/metrics.mjs";

/** Jeu XOR bruité : y = 1 si (x1>0) ≠ (x2>0), inversé 10 % du temps. */
function xorData(n, seed) {
  const rng = makeRng(seed);
  const X = [], y = [];
  for (let i = 0; i < n; i++) {
    const x1 = (rng() - 0.5) * 2, x2 = (rng() - 0.5) * 2;
    const label = (x1 > 0) !== (x2 > 0) ? 1 : 0;
    X.push([x1, x2]);
    y.push(rng() < 0.1 ? 1 - label : label);
  }
  return { X, y };
}

test("le GBM apprend le XOR là où la logistique échoue", () => {
  const { X, y } = xorData(3000, 7);
  const { X: Xt, y: yt } = xorData(1000, 8); // jeu de test indépendant

  const gbm = fitGBM(X, y, { trees: 150, depth: 3, lr: 0.1, minLeaf: 20 });
  const pGbm = Xt.map((x) => predictGBM(gbm, x));
  const llGbm = logLoss(pGbm, yt);

  const logi = fitLogistic(X, y, { epochs: 2000, l2: 0 });
  const llLogi = logLoss(Xt.map((x) => predictLogistic(logi, x)), yt);

  // La logistique reste au niveau du pile-ou-face (~0,69) ; le GBM doit
  // approcher le plancher du bruit à 10 % (~0,33).
  assert.ok(llLogi > 0.6, `logistique ${llLogi.toFixed(3)} : le XOR doit lui être inapprenable`);
  assert.ok(llGbm < 0.45, `GBM ${llGbm.toFixed(3)} : doit capturer l'interaction`);
});

test("le GBM est déterministe : deux ajustements identiques, mêmes prédictions", () => {
  const { X, y } = xorData(800, 3);
  const a = fitGBM(X, y, { trees: 60, depth: 3, lr: 0.1, minLeaf: 10 });
  const b = fitGBM(X, y, { trees: 60, depth: 3, lr: 0.1, minLeaf: 10 });
  for (const x of X.slice(0, 50)) {
    assert.equal(predictGBM(a, x), predictGBM(b, x));
  }
});

test("une relation monotone simple est retrouvée", () => {
  const rng = makeRng(5);
  const X = [], y = [];
  for (let i = 0; i < 2000; i++) {
    const x = (rng() - 0.5) * 4;
    X.push([x]);
    y.push(rng() < 1 / (1 + Math.exp(-2 * x)) ? 1 : 0);
  }
  const m = fitGBM(X, y, { trees: 100, depth: 2, lr: 0.1, minLeaf: 30 });
  assert.ok(predictGBM(m, [1.5]) > 0.8, `p(+1,5)=${predictGBM(m, [1.5]).toFixed(2)}`);
  assert.ok(predictGBM(m, [-1.5]) < 0.2, `p(−1,5)=${predictGBM(m, [-1.5]).toFixed(2)}`);
  assert.ok(predictGBM(m, [1.5]) > predictGBM(m, [0.2]), "monotone");
});

test("avec offsets : sur du bruit pur, le HORS-ÉCHANTILLON ne se dégrade pas", () => {
  // La cible est entièrement expliquée par l'offset (logit fourni), la feature
  // est du bruit. Un GBM mémorise toujours un peu le bruit d'ENTRAÎNEMENT —
  // le critère honnête est hors échantillon (comme au banc, jugé walk-forward) :
  // le log loss ne doit pas se dégrader sensiblement vs l'offset seul.
  const gen = (n, seed) => {
    const rng = makeRng(seed);
    const X = [], y = [], offsets = [];
    for (let i = 0; i < n; i++) {
      const z = (rng() - 0.5) * 6; // logit vrai
      X.push([(rng() - 0.5) * 2]); // feature SANS lien avec y
      offsets.push(z);
      y.push(rng() < 1 / (1 + Math.exp(-z)) ? 1 : 0);
    }
    return { X, y, offsets };
  };
  const train = gen(3000, 13), tst = gen(1500, 14);
  const m = fitGBM(train.X, train.y, { trees: 100, depth: 3, lr: 0.1, minLeaf: 30, offsets: train.offsets });
  const llOffset = logLoss(tst.offsets.map((z) => 1 / (1 + Math.exp(-z))), tst.y);
  const llGbm = logLoss(tst.X.map((x, i) => predictGBM(m, x, tst.offsets[i])), tst.y);
  assert.ok(llGbm < llOffset + 0.02, `GBM ${llGbm.toFixed(3)} vs offset seul ${llOffset.toFixed(3)} : dérive excessive sur du bruit`);
});

test("avec offsets : un vrai résidu est capturé", () => {
  // L'offset n'explique que la moitié du logit ; l'autre moitié dépend d'une
  // feature. Les arbres doivent la retrouver et améliorer le log loss.
  const rng = makeRng(17);
  const X = [], y = [], offsets = [];
  for (let i = 0; i < 3000; i++) {
    const zOff = (rng() - 0.5) * 3;
    const x = (rng() - 0.5) * 2;
    const zVrai = zOff + 2.5 * x;
    X.push([x]);
    offsets.push(zOff);
    y.push(rng() < 1 / (1 + Math.exp(-zVrai)) ? 1 : 0);
  }
  const m = fitGBM(X, y, { trees: 120, depth: 2, lr: 0.1, minLeaf: 30, offsets });
  const llOffset = logLoss(offsets.map((z) => 1 / (1 + Math.exp(-z))), y);
  const llGbm = logLoss(X.map((x, i) => predictGBM(m, x, offsets[i])), y);
  assert.ok(llGbm < llOffset - 0.05, `GBM ${llGbm.toFixed(3)} doit battre l'offset seul ${llOffset.toFixed(3)}`);
});

test("colonnes constantes et données minuscules : pas de NaN, pas de plantage", () => {
  const X = Array.from({ length: 60 }, (_, i) => [i % 2, 7]);
  const y = X.map((r) => r[0]);
  const m = fitGBM(X, y, { trees: 20, depth: 2, lr: 0.3, minLeaf: 5 });
  const p1 = predictGBM(m, [1, 7]), p0 = predictGBM(m, [0, 7]);
  assert.ok(Number.isFinite(p1) && Number.isFinite(p0));
  assert.ok(p1 > p0, "la colonne utile doit être exploitée");
});

test("predictGBM reste dans ]0, 1[ même sur des entrées extrêmes", () => {
  const { X, y } = xorData(500, 21);
  const m = fitGBM(X, y, { trees: 200, depth: 3, lr: 0.3, minLeaf: 5 });
  for (const x of [[-100, 100], [0, 0], [1e9, -1e9]]) {
    const p = predictGBM(m, x);
    assert.ok(p > 0 && p < 1, `p=${p}`);
  }
});

test("fitGBM refuse des tailles incohérentes", () => {
  assert.throws(() => fitGBM([[1], [2]], [1]), /tailles/);
  assert.throws(() => fitGBM([], []), /aucune ligne/);
  assert.throws(() => fitGBM([[1]], [1], { offsets: [0, 0] }), /tailles/);
});

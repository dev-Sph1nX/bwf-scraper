// Tests de la régression logistique et des variables du modèle additif.
//   node --test test/
//
// L'ajustement est vérifié en RETROUVANT des coefficients connus à partir de
// données synthétiques : un test qui se contenterait de comparer à la sortie du
// code ne vérifierait rien.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLogistic, predictLogistic, scoreLogistic, contributions, explain } from "../lib/logistic.mjs";
import { featuresOf, designMatrix, h2hSignal, FEATURE_KEYS, featureLabel } from "../lib/features.mjs";
import { makeRng } from "../lib/metrics.mjs";

const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

// --- Ajustement -----------------------------------------------------------

test("fitLogistic retrouve un coefficient connu sur données synthétiques", () => {
  // On génère y ~ Bernoulli(sigmoid(2 * x)) : le modèle doit trouver un poids
  // nettement positif sur x, et un biais proche de 0.
  const rng = makeRng(11);
  const X = [], y = [];
  for (let i = 0; i < 3000; i++) {
    const x = (rng() - 0.5) * 4;
    X.push([x]);
    y.push(rng() < 1 / (1 + Math.exp(-2 * x)) ? 1 : 0);
  }
  const m = fitLogistic(X, y, { epochs: 4000, lr: 0.5, l2: 0 });
  assert.ok(m.weights[0] > 1.5, `poids trouvé ${m.weights[0].toFixed(2)} doit être franchement positif`);
  assert.ok(Math.abs(m.bias) < 0.3, `biais ${m.bias.toFixed(2)} doit être proche de 0`);
});

test("fitLogistic distingue une variable utile d'une variable de bruit", () => {
  const rng = makeRng(3);
  const X = [], y = [];
  for (let i = 0; i < 3000; i++) {
    const utile = (rng() - 0.5) * 4;
    const bruit = (rng() - 0.5) * 4; // sans lien avec y
    X.push([utile, bruit]);
    y.push(rng() < 1 / (1 + Math.exp(-2 * utile)) ? 1 : 0);
  }
  const m = fitLogistic(X, y, { epochs: 3000, l2: 0, keys: ["utile", "bruit"] });
  assert.ok(Math.abs(m.weights[0]) > 4 * Math.abs(m.weights[1]),
    `utile ${m.weights[0].toFixed(2)} doit dominer bruit ${m.weights[1].toFixed(2)}`);
});

test("la régularisation L2 rétrécit les coefficients", () => {
  const rng = makeRng(5);
  const X = [], y = [];
  for (let i = 0; i < 800; i++) {
    const x = (rng() - 0.5) * 4;
    X.push([x]);
    y.push(rng() < 1 / (1 + Math.exp(-3 * x)) ? 1 : 0);
  }
  const libre = fitLogistic(X, y, { epochs: 2000, l2: 0 });
  const bride = fitLogistic(X, y, { epochs: 2000, l2: 1 });
  assert.ok(Math.abs(bride.weights[0]) < Math.abs(libre.weights[0]),
    `${bride.weights[0].toFixed(2)} doit être plus petit que ${libre.weights[0].toFixed(2)}`);
});

test("fitLogistic converge : le log loss baisse avec les époques", () => {
  const rng = makeRng(9);
  const X = [], y = [];
  for (let i = 0; i < 500; i++) { const x = (rng() - 0.5) * 4; X.push([x]); y.push(x > 0 ? 1 : 0); }
  const court = fitLogistic(X, y, { epochs: 50, l2: 0 });
  const long = fitLogistic(X, y, { epochs: 2000, l2: 0 });
  assert.ok(long.logLoss < court.logLoss, `${long.logLoss.toFixed(4)} < ${court.logLoss.toFixed(4)}`);
});

test("fitLogistic tolère une colonne constante sans produire de NaN", () => {
  // Écart-type nul : la standardisation doit se replier sur 1, pas diviser par 0.
  const X = Array.from({ length: 100 }, (_, i) => [i % 2, 7]);
  const y = X.map((r) => r[0]);
  const m = fitLogistic(X, y, { epochs: 200 });
  assert.ok(Number.isFinite(m.weights[0]) && Number.isFinite(m.weights[1]));
  assert.ok(Number.isFinite(predictLogistic(m, [1, 7])));
});

test("fitLogistic refuse des tailles incohérentes", () => {
  assert.throws(() => fitLogistic([[1], [2]], [1]), /tailles différentes/);
  assert.throws(() => fitLogistic([], []), /aucune ligne/);
});

test("predictLogistic reste dans [0, 1]", () => {
  const m = fitLogistic([[0], [1], [2], [3]], [0, 0, 1, 1], { epochs: 500 });
  for (const x of [-100, 0, 1.5, 100]) {
    const p = predictLogistic(m, [x]);
    assert.ok(p >= 0 && p <= 1, `p=${p} pour x=${x}`);
  }
});

// --- Cascade d'explication ------------------------------------------------

test("la somme des sauts de la cascade égale la probabilité finale", () => {
  // C'est la propriété qui rend le panneau « pourquoi » honnête.
  const m = fitLogistic(
    [[1, 2, 0], [0, 1, 1], [2, 0, 1], [1, 1, 0], [3, 2, 1], [0, 0, 0]],
    [1, 0, 1, 1, 1, 0],
    { epochs: 1000, keys: ["a", "b", "c"] },
  );
  const row = [2, 1, 1];
  const e = explain(m, row);
  const somme = e.base + e.steps.reduce((s, x) => s + x.delta, 0);
  proche(somme, e.final, 1e-12);
  proche(e.final, predictLogistic(m, row), 1e-12);
});

test("la cascade suit l'ordre demandé et n'omet aucune variable", () => {
  const m = fitLogistic([[1, 0], [0, 1], [1, 1], [0, 0]], [1, 0, 1, 0], { epochs: 500, keys: ["x", "z"] });
  const e = explain(m, [1, 1], ["z", "x"]);
  assert.deepEqual(e.steps.map((s) => s.key), ["z", "x"]);
  proche(e.base + e.steps.reduce((s, x) => s + x.delta, 0), e.final, 1e-12);
});

test("la cascade ignore une clé inconnue plutôt que de produire NaN", () => {
  const m = fitLogistic([[1], [0]], [1, 0], { epochs: 300, keys: ["x"] });
  const e = explain(m, [1], ["inconnue", "x"]);
  assert.deepEqual(e.steps.map((s) => s.key), ["x"]);
  assert.ok(Number.isFinite(e.final));
});

test("contributions rend une contribution par variable", () => {
  const m = fitLogistic([[1, 5], [0, 1], [2, 9], [0, 2]], [1, 0, 1, 0], { epochs: 500, keys: ["a", "b"] });
  const c = contributions(m, [1, 5]);
  assert.deepEqual(c.map((x) => x.key), ["a", "b"]);
  // la somme des contributions + biais = la log-cote
  proche(m.bias + c.reduce((s, x) => s + x.contribution, 0), scoreLogistic(m, [1, 5]), 1e-12);
});

// --- Variables -------------------------------------------------------------

const L = (o = {}) => ({
  eloA: 1500, eloB: 1500, formA: 0, formB: 0, h2hA: 0, h2hB: 0,
  loadA: 0, loadB: 0, sets3A: false, sets3B: false,
  daysOffA: 30, daysOffB: 30, bwfRankA: null, bwfRankB: null,
  seedA: null, seedB: null, won: 1, ...o,
});

test("toutes les variables valent 0 pour deux camps identiques", () => {
  const f = featuresOf(L());
  assert.equal(f.length, FEATURE_KEYS.length);
  for (const v of f) proche(v, 0, 1e-12);
});

test("un signal absent vaut 0, pas une valeur inventée", () => {
  // Rang mondial connu d'un seul côté : on ne peut pas comparer.
  const f = featuresOf(L({ bwfRankA: 5, bwfRankB: null }));
  proche(f[FEATURE_KEYS.indexOf("bwf")], 0, 1e-12);
  const g = featuresOf(L({ seedA: 1, seedB: null }));
  proche(g[FEATURE_KEYS.indexOf("seed")], 0, 1e-12);
});

test("un meilleur Elo pour A donne une variable positive", () => {
  const f = featuresOf(L({ eloA: 1700, eloB: 1500 }));
  proche(f[FEATURE_KEYS.indexOf("elo")], 0.5);
});

test("la charge de l'adversaire est un AVANTAGE pour A", () => {
  const f = featuresOf(L({ loadA: 30, loadB: 90 }));
  assert.ok(f[FEATURE_KEYS.indexOf("fresh")] > 0, "B a joué plus : avantage à A");
});

test("un adversaire sortant d'un 3 manches accroît l'avantage de fraîcheur", () => {
  const sans = featuresOf(L({ loadA: 0, loadB: 60 }));
  const avec = featuresOf(L({ loadA: 0, loadB: 60, sets3B: true }));
  const i = FEATURE_KEYS.indexOf("fresh");
  assert.ok(avec[i] > sans[i]);
});

test("le rang mondial est pris en logarithme : 1 vs 5 pèse plus que 100 vs 104", () => {
  const i = FEATURE_KEYS.indexOf("bwf");
  const haut = featuresOf(L({ bwfRankA: 1, bwfRankB: 5 }))[i];
  const bas = featuresOf(L({ bwfRankA: 100, bwfRankB: 104 }))[i];
  assert.ok(haut > 5 * bas, `${haut.toFixed(3)} doit largement dépasser ${bas.toFixed(3)}`);
});

test("le repos est plafonné : un joueur absent 2 ans ne domine pas la variable", () => {
  const i = FEATURE_KEYS.indexOf("rest");
  const un = featuresOf(L({ daysOffA: 60, daysOffB: 30 }))[i];
  const deuxAns = featuresOf(L({ daysOffA: 730, daysOffB: 30 }))[i];
  proche(un, deuxAns, 1e-12);
});

test("h2hSignal pondère une seule confrontation moins qu'une série", () => {
  assert.ok(h2hSignal(1, 0) < h2hSignal(5, 0), "1-0 doit peser moins que 5-0");
  proche(h2hSignal(0, 0), 0, 1e-12);
  proche(h2hSignal(2, 2), 0, 1e-12);
  assert.ok(h2hSignal(0, 3) < 0);
  assert.ok(h2hSignal(1, 0) > 0 && h2hSignal(1, 0) <= 1);
});

test("designMatrix rend une matrice alignée avec la cible", () => {
  const { X, y, keys } = designMatrix([L({ won: 1 }), L({ won: 0 })]);
  assert.equal(X.length, 2);
  assert.deepEqual(y, [1, 0]);
  assert.deepEqual(keys, FEATURE_KEYS);
  assert.equal(X[0].length, FEATURE_KEYS.length);
});

test("l'ORDRE de FEATURES correspond au tableau renvoyé par featuresOf", () => {
  // Une désynchronisation attribuerait silencieusement le poids d'une variable à
  // une autre — l'erreur la plus grave possible ici, et invisible sans ce test.
  // On isole chaque variable : une ligne qui ne fait varier qu'elle doit produire
  // un tableau où SEULE sa position est non nulle.
  const cas = {
    elo: L({ eloA: 1900, eloB: 1500 }),
    form: L({ formA: 50, formB: 0 }),
    h2h: L({ h2hA: 3, h2hB: 0 }),
    fresh: L({ loadA: 0, loadB: 10 }),     // 10 min : sous le seuil de fresh20
    rest: L({ daysOffA: 10, daysOffB: 50 }),
    bwf: L({ bwfRankA: 5, bwfRankB: 50 }),
    seed: L({ seedA: 1, seedB: 8 }),
  };
  for (const [key, row] of Object.entries(cas)) {
    const f = featuresOf(row);
    const i = FEATURE_KEYS.indexOf(key);
    assert.ok(Math.abs(f[i]) > 1e-9, `${key} doit être non nul en position ${i}, obtenu ${f[i]}`);
    f.forEach((v, j) => {
      if (j !== i) assert.ok(Math.abs(v) < 1e-9, `${key} : la position ${j} (${FEATURE_KEYS[j]}) devrait être nulle, obtenu ${v}`);
    });
  }
});

test("fresh20 ne s'active qu'au-delà du seuil, indépendamment de fresh", () => {
  const i20 = FEATURE_KEYS.indexOf("fresh20");
  const iC = FEATURE_KEYS.indexOf("fresh");
  const sous = featuresOf(L({ loadA: 0, loadB: 15 }));
  const au = featuresOf(L({ loadA: 0, loadB: 40 }));
  assert.equal(sous[i20], 0, "15 min : sous le seuil");
  assert.equal(au[i20], 1, "40 min : au-dessus, et normalisé à 1");
  assert.ok(au[iC] > sous[iC], "la variable continue, elle, croît avec l'écart");
});

test("chaque variable a un libellé lisible", () => {
  for (const k of FEATURE_KEYS) {
    assert.ok(featureLabel(k) && featureLabel(k) !== k, `libellé manquant pour ${k}`);
  }
});

test("aucune variable ne produit NaN sur une ligne pleine de null", () => {
  const f = featuresOf({ won: 1 });
  for (const v of f) assert.ok(Number.isFinite(v), `NaN produit : ${JSON.stringify(f)}`);
});

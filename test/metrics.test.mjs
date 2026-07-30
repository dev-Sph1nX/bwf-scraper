// Tests des métriques et des modèles du backtest.
//   node --test test/
//
// Toutes les valeurs attendues sont calculées à la main dans les commentaires :
// un test de métrique qui se contente de comparer à la sortie du code ne
// vérifierait rien.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accuracy, brier, logLoss, upsetRate, sharpness,
  calibration, calibrationError, bootstrapCI, makeRng, overlaps, evaluate, upsetByBand,
} from "../lib/metrics.mjs";
import { MODELS, modelByKey, eloProb, isProvisional, predictAll, commonBase } from "../lib/models.mjs";

const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

// --- Taux de réussite ----------------------------------------------------

test("accuracy compte les prédictions du bon côté de 0,5", () => {
  //  p=0.8 y=1 -> ok | p=0.3 y=0 -> ok | p=0.6 y=0 -> raté | p=0.2 y=1 -> raté
  proche(accuracy([0.8, 0.3, 0.6, 0.2], [1, 0, 0, 1]), 0.5);
});

test("accuracy compte 0,5 pour une prédiction à exactement 0,5", () => {
  proche(accuracy([0.5, 0.5], [1, 0]), 0.5, 1e-12);
  // 3 succès pleins + 1 demi = 3.5 / 4
  proche(accuracy([0.9, 0.9, 0.9, 0.5], [1, 1, 1, 0]), 3.5 / 4);
});

test("accuracy rend null sur un ensemble vide", () => {
  assert.equal(accuracy([], []), null);
});

// --- Brier ---------------------------------------------------------------

test("brier vaut 0 pour une prédiction parfaite et 1 pour l'inverse", () => {
  proche(brier([1, 0], [1, 0]), 0);
  proche(brier([0, 1], [1, 0]), 1);
});

test("brier vaut 0,25 pour un modèle qui dit toujours 0,5", () => {
  // (0.5-1)² = 0.25 et (0.5-0)² = 0.25
  proche(brier([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0]), 0.25);
});

test("brier calculé à la main sur un petit échantillon", () => {
  // (0.8-1)² = 0.04 ; (0.3-0)² = 0.09 ; (0.6-0)² = 0.36  ->  0.49/3
  proche(brier([0.8, 0.3, 0.6], [1, 0, 0]), 0.49 / 3);
});

// --- Log loss ------------------------------------------------------------

test("logLoss vaut ln(2) pour un modèle qui dit toujours 0,5", () => {
  proche(logLoss([0.5, 0.5], [1, 0]), Math.LN2, 1e-12);
});

test("logLoss reste FINI quand un modèle binaire se trompe", () => {
  // Sans bornage, -log(0) serait l'infini et la colonne deviendrait inutilisable
  // pour comparer les modèles « le mieux classé gagne ».
  const v = logLoss([1, 0, 1], [1, 0, 0]);
  assert.ok(Number.isFinite(v), "doit rester fini");
  assert.ok(v > 0);
});

// --- Surprise et netteté -------------------------------------------------

test("upsetRate ignore les prédictions à 0,5 et compte les surprises", () => {
  // p=0.8 y=0 -> surprise | p=0.8 y=1 -> non | p=0.2 y=1 -> surprise | 0.5 ignoré
  proche(upsetRate([0.8, 0.8, 0.2, 0.5], [0, 1, 1, 1]), 2 / 3);
});

test("upsetRate rend null si aucune prédiction n'est tranchée", () => {
  assert.equal(upsetRate([0.5, 0.5], [1, 0]), null);
});

test("upsetByBand sépare les pile-ou-face des vraies surprises", () => {
  // 4 matchs serrés (55 %) dont 2 perdus par le favori -> 50 % de surprises
  // 4 matchs francs (85 %) dont 1 perdu -> 25 % de surprises
  const preds = [0.55, 0.55, 0.55, 0.55, 0.85, 0.85, 0.85, 0.85];
  const out = [1, 1, 0, 0, 1, 1, 1, 0];
  const b = upsetByBand(preds, out);
  const serres = b.find((x) => x.key === "tight");
  const francs = b.find((x) => x.key === "strong");
  proche(serres.upsetRate, 0.5);
  proche(francs.upsetRate, 0.25);
  assert.equal(serres.n, 4);
  assert.equal(francs.n, 4);
  proche(serres.share, 0.5);
});

test("upsetByBand oriente les prédictions sur le favori", () => {
  // p=0.15 avec y=0 signifie que le favori (le camp B, à 85 %) a gagné
  const b = upsetByBand([0.15, 0.85], [0, 1]);
  const francs = b.find((x) => x.key === "strong");
  assert.equal(francs.n, 2, "les deux tombent dans la bande 75-90 %");
  assert.equal(francs.upsetRate, 0, "aucune surprise : les deux favoris ont gagné");
});

test("upsetByBand couvre les 4 bandes sans perdre de match", () => {
  const preds = [0.52, 0.65, 0.80, 0.95];
  const b = upsetByBand(preds, [1, 1, 1, 1]);
  assert.equal(b.length, 4);
  assert.equal(b.reduce((s, x) => s + x.n, 0), 4, "aucun match hors bande");
  assert.deepEqual(b.map((x) => x.n), [1, 1, 1, 1]);
});

test("upsetByBand inclut p=1 dans la dernière bande", () => {
  const b = upsetByBand([1], [1]);
  assert.equal(b.find((x) => x.key === "heavy").n, 1);
});

test("upsetByBand rend null pour une bande vide, sans planter", () => {
  const b = upsetByBand([0.55], [1]);
  assert.equal(b.find((x) => x.key === "heavy").upsetRate, null);
  assert.equal(b.find((x) => x.key === "heavy").n, 0);
});

test("sharpness mesure l'écart moyen à 0,5", () => {
  proche(sharpness([0.5, 1, 0]), (0 + 0.5 + 0.5) / 3);
  proche(sharpness([0.5, 0.5]), 0, 1e-12);
});

// --- Calibration ---------------------------------------------------------

test("calibration replie les prédictions au-dessus de 0,5", () => {
  // p=0.2 avec y=0 équivaut à p=0.8 avec y=1 du point de vue du favori
  const c = calibration([0.2], [0], 10);
  const remplie = c.filter((b) => b.n > 0);
  assert.equal(remplie.length, 1);
  proche(remplie[0].predicted, 0.8);
  assert.equal(remplie[0].observed, 1);
});

test("calibration : un modèle parfaitement calibré a prédit = observé", () => {
  // 10 matchs annoncés à 0,8 dont 8 gagnés par le favori
  const preds = Array(10).fill(0.8);
  const out = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
  const b = calibration(preds, out, 10).find((x) => x.n === 10);
  proche(b.predicted, 0.8);
  proche(b.observed, 0.8);
});

test("calibration place p=1 dans la dernière tranche, pas hors bornes", () => {
  const c = calibration([1], [1], 10);
  assert.equal(c[9].n, 1, "p=1 doit tomber dans la 10e tranche");
  assert.equal(c.reduce((s, b) => s + b.n, 0), 1, "aucune ligne perdue");
});

test("calibrationError vaut 0 pour un modèle parfaitement calibré", () => {
  const preds = Array(10).fill(0.8);
  const out = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
  proche(calibrationError(preds, out, 10), 0, 1e-12);
});

test("calibrationError mesure l'excès de confiance", () => {
  // annonce 0,9 mais n'en gagne que 5 sur 10 -> écart de 0,4
  const c = calibrationError(Array(10).fill(0.9), [1, 1, 1, 1, 1, 0, 0, 0, 0, 0], 10);
  proche(c, 0.4, 1e-12);
});

// --- Bootstrap -----------------------------------------------------------

test("makeRng est déterministe pour une même graine", () => {
  const a = makeRng(7), b = makeRng(7);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.ok(sa.every((v) => v >= 0 && v < 1), "valeurs dans [0,1)");
});

test("makeRng donne des suites différentes pour des graines différentes", () => {
  assert.notDeepEqual([makeRng(1)(), makeRng(1)()], [makeRng(2)(), makeRng(2)()]);
});

test("bootstrapCI est REPRODUCTIBLE : deux appels donnent le même intervalle", () => {
  // Sans cela, un écart entre deux disciplines pourrait apparaître ou
  // disparaître d'une exécution à l'autre.
  const p = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? 0.7 : 0.4));
  const y = Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? 1 : 0));
  const a = bootstrapCI(p, y, accuracy, { draws: 200, seed: 5 });
  const b = bootstrapCI(p, y, accuracy, { draws: 200, seed: 5 });
  assert.deepEqual(a, b);
});

test("bootstrapCI encadre la valeur mesurée", () => {
  const p = Array.from({ length: 300 }, () => 0.8);
  const y = Array.from({ length: 300 }, (_, i) => (i % 5 === 0 ? 0 : 1)); // 80 % de succès
  const ci = bootstrapCI(p, y, accuracy, { draws: 300, seed: 1 });
  proche(ci.value, 0.8, 1e-12);
  assert.ok(ci.lo <= ci.value && ci.value <= ci.hi, `${ci.lo} <= ${ci.value} <= ${ci.hi}`);
  assert.equal(ci.n, 300);
});

test("bootstrapCI resserre l'intervalle quand l'échantillon grandit", () => {
  const faire = (n) => {
    const p = Array.from({ length: n }, () => 0.7);
    const y = Array.from({ length: n }, (_, i) => (i % 10 < 7 ? 1 : 0));
    return bootstrapCI(p, y, accuracy, { draws: 300, seed: 3 });
  };
  const petit = faire(50), grand = faire(2000);
  assert.ok((grand.hi - grand.lo) < (petit.hi - petit.lo), "plus de données = intervalle plus étroit");
});

test("bootstrapCI rend des bornes nulles sur un ensemble vide", () => {
  assert.deepEqual(bootstrapCI([], [], accuracy), { value: null, lo: null, hi: null, n: 0 });
});

test("overlaps repère deux mesures non départageables", () => {
  assert.equal(overlaps({ lo: 0.1, hi: 0.2 }, { lo: 0.15, hi: 0.25 }), true);
  assert.equal(overlaps({ lo: 0.1, hi: 0.2 }, { lo: 0.3, hi: 0.4 }), false);
  assert.equal(overlaps({ lo: null, hi: null }, { lo: 0.3, hi: 0.4 }), false);
});

test("evaluate rend toutes les métriques d'un coup", () => {
  const e = evaluate([0.8, 0.3, 0.6], [1, 0, 0], { draws: 50, seed: 2 });
  assert.equal(e.n, 3);
  assert.ok(e.accuracy.value != null && e.brier.value != null);
  assert.ok(Number.isFinite(e.logLoss));
});

// --- Modèles -------------------------------------------------------------

test("eloProb rend 0,5 à égalité de notes et croît avec l'écart", () => {
  proche(eloProb(1500, 1500), 0.5, 1e-12);
  proche(eloProb(1900, 1500), 1 / (1 + Math.pow(10, -1)), 1e-12); // 400 d'écart -> ~0.909
  assert.ok(eloProb(1600, 1500) > 0.5);
  assert.ok(eloProb(1400, 1500) < 0.5);
});

test("isProvisional marque les entités sous 5 matchs", () => {
  assert.equal(isProvisional(0), true);
  assert.equal(isProvisional(4), true);
  assert.equal(isProvisional(5), false);
  assert.equal(isProvisional(undefined), true);
});

test("le modèle hasard dit toujours 0,5 et ne s'abstient jamais", () => {
  const m = modelByKey("random");
  assert.equal(m.predict({}), 0.5);
  assert.equal(m.predict({ eloA: null }), 0.5);
});

test("le modèle tête de série désigne le mieux placé", () => {
  const m = modelByKey("seed");
  assert.equal(m.predict({ seedA: 1, seedB: 8 }), 1, "A mieux placé");
  assert.equal(m.predict({ seedA: 8, seedB: 1 }), 0);
  assert.equal(m.predict({ seedA: 9, seedB: 10 }), 1, "9e devant 10e — comparaison NUMÉRIQUE");
  assert.equal(m.predict({ seedA: 3, seedB: 3 }), 0.5, "égalité -> 0,5");
  assert.equal(m.predict({ seedA: 1, seedB: null }), null, "s'abstient si l'un n'est pas classé");
  assert.equal(m.predict({ seedA: null, seedB: null }), null);
});

test("le modèle classement mondial désigne le mieux classé", () => {
  const m = modelByKey("bwf");
  assert.equal(m.predict({ bwfRankA: 5, bwfRankB: 40 }), 1);
  assert.equal(m.predict({ bwfRankA: 40, bwfRankB: 5 }), 0);
  assert.equal(m.predict({ bwfRankA: 5, bwfRankB: null }), null);
});

test("le modèle Elo s'abstient si une entité est provisoire", () => {
  const m = modelByKey("elo");
  assert.equal(m.predict({ eloA: 1600, eloB: 1500, nA: 4, nB: 20 }), null, "A provisoire");
  assert.equal(m.predict({ eloA: 1600, eloB: 1500, nA: 20, nB: 2 }), null, "B provisoire");
  proche(m.predict({ eloA: 1600, eloB: 1500, nA: 20, nB: 20 }), eloProb(1600, 1500));
});

test("les modèles binaires sont marqués comme tels", () => {
  assert.equal(modelByKey("seed").binary, true);
  assert.equal(modelByKey("bwf").binary, true);
  assert.equal(modelByKey("elo").binary, false);
  assert.equal(modelByKey("random").binary, false);
});

// --- Socle commun --------------------------------------------------------

const L = (o) => ({ seedA: null, seedB: null, bwfRankA: null, bwfRankB: null, eloA: 1500, eloB: 1500, nA: 20, nB: 20, ...o });

test("predictAll compte la couverture de chaque modèle", () => {
  const rows = [
    L({ seedA: 1, seedB: 2, bwfRankA: 3, bwfRankB: 9 }),  // tous se prononcent
    L({ bwfRankA: 3, bwfRankB: 9 }),                       // pas de tête de série
    L({ nA: 1 }),                                          // Elo provisoire, pas de rang
  ];
  const { preds, coverage } = predictAll(rows, MODELS);
  assert.equal(preds.length, 3);
  assert.equal(coverage.random, 3, "le hasard couvre tout");
  assert.equal(coverage.seed, 1);
  assert.equal(coverage.bwf, 2);
  assert.equal(coverage.elo, 2);
});

test("commonBase ne garde que les lignes où TOUS les modèles se prononcent", () => {
  const rows = [
    L({ seedA: 1, seedB: 2, bwfRankA: 3, bwfRankB: 9 }),
    L({ bwfRankA: 3, bwfRankB: 9 }),
    L({ seedA: 1, seedB: 2, bwfRankA: 3, bwfRankB: 9, nA: 2 }),
  ];
  const { preds } = predictAll(rows, MODELS);
  assert.deepEqual(commonBase(preds, MODELS), [0]);
});

test("commonBase rend un tableau vide si aucun modèle ne couvre tout", () => {
  const { preds } = predictAll([L({})], MODELS);
  assert.deepEqual(commonBase(preds, MODELS), []);
});

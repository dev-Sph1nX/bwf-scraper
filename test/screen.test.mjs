// Tests du criblage des facteurs en isolation.
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hitRate, screenFactor, picksLower, picksHigher, picksLowerBeyond, FACTORS, SKILL_WINDOWS,
} from "../lib/screen.mjs";

const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

// --- Taux de réussite -----------------------------------------------------

test("hitRate compte les fois où le critère désigne le vainqueur", () => {
  const cas = [{ pick: 1, won: 1 }, { pick: 1, won: 0 }, { pick: 0, won: 0 }, { pick: 0, won: 1 }];
  proche(hitRate(cas, { minN: 1, draws: 10 }).rate, 0.5);
});

test("hitRate reconnaît un critère parfait et un critère toujours faux", () => {
  const parfait = Array.from({ length: 200 }, (_, i) => ({ pick: i % 2, won: i % 2 }));
  const faux = Array.from({ length: 200 }, (_, i) => ({ pick: i % 2, won: 1 - (i % 2) }));
  assert.equal(hitRate(parfait, { draws: 200 }).rate, 1);
  assert.equal(hitRate(faux, { draws: 200 }).rate, 0);
});

test("hitRate signale un échantillon trop faible plutôt que d'inventer un intervalle", () => {
  const r = hitRate([{ pick: 1, won: 1 }], { minN: 80 });
  assert.equal(r.tooFew, true);
  assert.equal(r.lo, null);
  assert.equal(r.significant, false);
});

test("hitRate ne déclare PAS significatif un critère à 50 %", () => {
  // 500 cas exactement à 50 % : l'intervalle doit contenir 0,5
  const cas = Array.from({ length: 500 }, (_, i) => ({ pick: 1, won: i % 2 }));
  const r = hitRate(cas, { draws: 1000 });
  proche(r.rate, 0.5, 0.001);
  assert.equal(r.significant, false, "50 % ne doit jamais être déclaré significatif");
  assert.ok(r.lo < 0.5 && r.hi > 0.5);
});

test("hitRate déclare significatif un critère nettement au-dessus de 50 %", () => {
  // 70 % de réussite sur 500 cas
  const cas = Array.from({ length: 500 }, (_, i) => ({ pick: 1, won: i % 10 < 7 ? 1 : 0 }));
  const r = hitRate(cas, { draws: 1000 });
  proche(r.rate, 0.7, 0.001);
  assert.equal(r.significant, true);
  assert.ok(r.lo > 0.5);
});

test("hitRate est reproductible à graine fixe", () => {
  const cas = Array.from({ length: 300 }, (_, i) => ({ pick: 1, won: i % 3 ? 1 : 0 }));
  assert.deepEqual(hitRate(cas, { seed: 7 }), hitRate(cas, { seed: 7 }));
});

// --- Sélecteurs -----------------------------------------------------------

const R = (o) => ({ eloA: 1500, eloB: 1500, won: 1, ...o });

test("picksLower désigne le camp à la valeur la plus basse", () => {
  const p = picksLower((r) => r.loadA, (r) => r.loadB);
  assert.equal(p(R({ loadA: 30, loadB: 90 })), 1, "A a moins joué -> A");
  assert.equal(p(R({ loadA: 90, loadB: 30 })), 0);
  assert.equal(p(R({ loadA: 50, loadB: 50 })), null, "égalité -> pas d'avis");
  assert.equal(p(R({ loadA: 50, loadB: null })), null, "valeur manquante -> pas d'avis");
});

test("picksHigher désigne le camp à la valeur la plus haute", () => {
  const p = picksHigher((r) => r.formA, (r) => r.formB);
  assert.equal(p(R({ formA: 40, formB: -10 })), 1);
  assert.equal(p(R({ formA: -10, formB: 40 })), 0);
  assert.equal(p(R({ formA: 0, formB: 0 })), null);
});

test("picksLowerBeyond ne se prononce qu'au-delà du seuil", () => {
  const p = picksLowerBeyond((r) => r.loadA, (r) => r.loadB, 20);
  assert.equal(p(R({ loadA: 30, loadB: 45 })), null, "15 min d'écart : sous le seuil");
  assert.equal(p(R({ loadA: 30, loadB: 60 })), 1, "30 min d'écart : au-dessus");
  assert.equal(p(R({ loadA: 60, loadB: 30 })), 0);
});

// --- Contrôle du niveau ---------------------------------------------------

test("screenFactor n'utilise QUE les matchs entre niveaux proches", () => {
  const rows = [
    // proche : |1500-1510| = 10 < 30, retenu
    R({ eloA: 1500, eloB: 1510, loadA: 10, loadB: 90, won: 1 }),
    // éloigné : |1500-1900| = 400, EXCLU quelle que soit la fenêtre
    R({ eloA: 1500, eloB: 1900, loadA: 10, loadB: 90, won: 0 }),
  ];
  const res = screenFactor(rows, picksLower((r) => r.loadA, (r) => r.loadB), { windows: [30] });
  assert.equal(res[0].n, 1, "un seul match retenu : le match déséquilibré est écarté");
});

test("screenFactor rend un résultat par fenêtre de niveau", () => {
  const rows = Array.from({ length: 300 }, (_, i) => R({
    eloA: 1500, eloB: 1500 + (i % 100), loadA: 10, loadB: 90, won: 1,
  }));
  const res = screenFactor(rows, picksLower((r) => r.loadA, (r) => r.loadB));
  assert.equal(res.length, SKILL_WINDOWS.length);
  assert.deepEqual(res.map((x) => x.window), SKILL_WINDOWS);
  // une fenêtre plus large retient plus de matchs
  assert.ok(res[2].n > res[0].n);
});

test("screenFactor ignore les lignes sans note Elo", () => {
  const rows = [R({ eloA: null, eloB: 1500, loadA: 10, loadB: 90 })];
  assert.equal(screenFactor(rows, picksLower((r) => r.loadA, (r) => r.loadB))[0].n, 0);
});

test("screenFactor détecte un facteur PARFAIT à niveau égal", () => {
  // le camp le moins chargé gagne toujours
  const rows = Array.from({ length: 200 }, (_, i) => {
    const aFrais = i % 2 === 0;
    return R({ eloA: 1500, eloB: 1500, loadA: aFrais ? 10 : 90, loadB: aFrais ? 90 : 10, won: aFrais ? 1 : 0 });
  });
  const r = screenFactor(rows, picksLower((r) => r.loadA, (r) => r.loadB), { windows: [30] })[0];
  assert.equal(r.rate, 1);
  assert.equal(r.significant, true);
});

test("screenFactor ne détecte RIEN sur un facteur sans lien avec le résultat", () => {
  const rows = Array.from({ length: 600 }, (_, i) => R({
    eloA: 1500, eloB: 1500,
    loadA: i % 2 ? 10 : 90, loadB: i % 2 ? 90 : 10,
    won: i % 4 < 2 ? 1 : 0,   // indépendant de la charge
  }));
  const r = screenFactor(rows, picksLower((r) => r.loadA, (r) => r.loadB), { windows: [30] })[0];
  assert.equal(r.significant, false, "un facteur sans lien ne doit pas ressortir");
});

// --- Catalogue ------------------------------------------------------------

test("chaque facteur du catalogue a une clé, un libellé et un sélecteur", () => {
  assert.ok(FACTORS.length >= 8);
  for (const f of FACTORS) {
    assert.ok(f.key && f.label && typeof f.pick === "function", `facteur incomplet : ${f.key}`);
  }
  assert.equal(new Set(FACTORS.map((f) => f.key)).size, FACTORS.length, "clés en double");
});

test("le facteur « sortait d'un 3 manches » a été retiré du catalogue", () => {
  // Retiré car redondant : 93 % d'accord avec « fraîcheur >= 20 min », et ses
  // matchs propres ne sont pas significatifs. Le garder compterait deux fois la
  // même information.
  assert.equal(FACTORS.find((f) => f.key === "sets3"), undefined);
});

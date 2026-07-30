// Tests de la recalibration des probabilités Elo.
//   node --test test/
//
// L'enjeu n'est pas la précision de prédiction (le gain y est du second ordre)
// mais la SÉCURITÉ de la couche de mise : un favori sous-estimé implique un
// outsider surestimé, et le signe de la valeur attendue s'inverse près du seuil.

import { test } from "node:test";
import assert from "node:assert/strict";
import { recalibrate, stretchFor, STRETCH } from "../lib/calibrate.mjs";

const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

// --- Périmètre de la correction ------------------------------------------

test("seules les disciplines où le défaut est DÉMONTRÉ sont corrigées", () => {
  // MS et MD : l'intervalle de confiance du facteur contient 1, donc rien ne
  // prouve un défaut. Les corriger reviendrait à ajuster du bruit.
  assert.equal(stretchFor("MS"), 1);
  assert.equal(stretchFor("MD"), 1);
  assert.equal(stretchFor("XD"), 1, "XD est à la limite et instable en 2026 : écarté");
  assert.ok(stretchFor("WS") > 1);
  assert.ok(stretchFor("WD") > 1);
  assert.deepEqual(Object.keys(STRETCH).sort(), ["WD", "WS"]);
});

test("une discipline inconnue n'est pas corrigée", () => {
  assert.equal(stretchFor("ZZ"), 1);
  assert.equal(stretchFor(undefined), 1);
  assert.equal(recalibrate(0.7, "ZZ"), 0.7);
});

// --- Comportement de l'étirement -----------------------------------------

test("l'étirement éloigne la probabilité de 50 %", () => {
  const p = recalibrate(0.7, "WS");
  assert.ok(p > 0.7, `${p} doit dépasser 0,70`);
  const q = recalibrate(0.3, "WS");
  assert.ok(q < 0.3, `${q} doit être sous 0,30`);
});

test("l'étirement laisse 50 % inchangé — il ne crée jamais de favori", () => {
  proche(recalibrate(0.5, "WS"), 0.5, 1e-12);
  proche(recalibrate(0.5, "WD"), 0.5, 1e-12);
});

test("l'étirement ne change JAMAIS qui est favori", () => {
  // C'est ce qui garantit un taux de réussite inchangé par construction.
  for (const disc of ["WS", "WD", "MS"]) {
    for (const p of [0.01, 0.2, 0.45, 0.49, 0.51, 0.55, 0.8, 0.99]) {
      const q = recalibrate(p, disc);
      assert.equal(p > 0.5, q > 0.5, `${disc} p=${p} -> ${q} : le camp favori a changé`);
      assert.equal(p < 0.5, q < 0.5, `${disc} p=${p} -> ${q}`);
    }
  }
});

test("l'étirement est symétrique autour de 50 %", () => {
  // recalibrate(p) et recalibrate(1-p) doivent rester complémentaires, sinon
  // les deux camps d'un même match ne sommeraient plus à 1.
  for (const p of [0.6, 0.75, 0.9]) {
    proche(recalibrate(p, "WS") + recalibrate(1 - p, "WS"), 1, 1e-12);
  }
});

test("l'étirement est monotone : plus p est haut, plus le résultat est haut", () => {
  const vals = [0.55, 0.6, 0.7, 0.8, 0.95].map((p) => recalibrate(p, "WS"));
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i] > vals[i - 1]);
});

test("le résultat reste dans [0, 1]", () => {
  for (const p of [0, 0.001, 0.5, 0.999, 1]) {
    for (const disc of ["WS", "WD"]) {
      const q = recalibrate(p, disc);
      assert.ok(q >= 0 && q <= 1, `${disc} p=${p} -> ${q}`);
    }
  }
});

// --- Cas limites ----------------------------------------------------------

test("les certitudes 0 et 1 sont renvoyées telles quelles", () => {
  // Leurs log-cotes sont infinies : les étirer n'aurait aucun sens, et le
  // calcul produirait un NaN qui se propagerait dans les métriques.
  assert.equal(recalibrate(0, "WS"), 0);
  assert.equal(recalibrate(1, "WS"), 1);
});

test("une valeur invalide rend null, pas NaN", () => {
  // Un NaN traverserait les métriques sans lever et corromprait les moyennes.
  assert.equal(recalibrate(NaN, "WS"), null);
  assert.equal(recalibrate(undefined, "WS"), null);
  assert.equal(recalibrate(-0.1, "WS"), null);
  assert.equal(recalibrate(1.5, "WS"), null);
  assert.equal(recalibrate(Infinity, "WS"), null);
});

test("un facteur de 1 renvoie la valeur à l'identique, sans arrondi", () => {
  const p = 0.6234567891;
  assert.equal(recalibrate(p, "MS"), p);
});

// --- L'effet qui motive tout le module -----------------------------------

test("la correction inverse le signe de l'EV sur un outsider marginal", () => {
  // Un outsider à la cote 4,00 a besoin de plus de 25 % pour valoir le pari.
  // En WS, l'Elo brut annoncerait 28 % là où la réalité est plus basse.
  const cote = 4.0;
  const brut = 0.28;
  const corrige = recalibrate(brut, "WS");
  const ev = (p) => cote * p - 1;
  assert.ok(ev(brut) > 0, "l'Elo brut voit une opportunité");
  assert.ok(ev(corrige) < 0, `la correction la fait disparaître (p ${brut} -> ${corrige.toFixed(3)})`);
});

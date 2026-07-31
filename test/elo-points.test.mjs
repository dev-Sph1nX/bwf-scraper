// Tests de l'Elo « à marge de points » (variante, désactivée par défaut).
//   node --test test/elo-points.test.mjs
//
// Idée (propriétaire) : construire la note non pas sur le seul résultat mais
// sur l'AMPLEUR du score en points (21-5 ≠ 21-19). Deux garde-fous :
//   - pointsFactor = 0 (défaut) doit rendre un multiplicateur STRICTEMENT
//     neutre : l'Elo de production ne bouge pas d'un centième ;
//   - l'amortissement anti-autocorrélation (façon FiveThirtyEight) évite que
//     les notes des dominateurs s'envolent : une victoire large du favori
//     annoncé compte moins que la même victoire par l'outsider.

import { test } from "node:test";
import assert from "node:assert/strict";
import { winnerPointShare, pointsMultiplier } from "../lib/elo.mjs";

const score21 = (a1, b1, a2, b2) => [
  { set: 1, home: a1, away: b1 },
  { set: 2, home: a2, away: b2 },
];

// --- Part de points du vainqueur ---------------------------------------------

test("part de points : 21-5, 21-5 -> domination nette", () => {
  const s = winnerPointShare(score21(21, 5, 21, 5), 1);
  assert.ok(Math.abs(s - 42 / 52) < 1e-12);
});

test("part de points : le camp 2 vainqueur lit les colonnes away", () => {
  const s = winnerPointShare(score21(5, 21, 5, 21), 2);
  assert.ok(Math.abs(s - 42 / 52) < 1e-12);
});

test("part de points : score inexploitable -> null", () => {
  assert.equal(winnerPointShare([], 1), null);
  assert.equal(winnerPointShare(null, 1), null);
  assert.equal(winnerPointShare([{ set: 1, home: 21, away: null }], 1), null);
});

// --- Multiplicateur ------------------------------------------------------------

const P = { pointsFactor: 1, pointsRef: 0.07, pointsDamping: false };

test("pointsFactor = 0 (défaut production) -> multiplicateur STRICTEMENT 1", () => {
  assert.equal(pointsMultiplier(0.8, 300, { ...P, pointsFactor: 0 }), 1);
  assert.equal(pointsMultiplier(null, 0, { ...P, pointsFactor: 0 }), 1);
});

test("une domination au-dessus de la référence amplifie, en dessous atténue", () => {
  const gros = pointsMultiplier(0.62, 0, P);   // marge 0,12 > réf 0,07
  const serre = pointsMultiplier(0.52, 0, P);  // marge 0,02 < réf
  assert.ok(gros > 1, `gros = ${gros}`);
  assert.ok(serre < 1, `serré = ${serre}`);
  // à la référence exactement : neutre
  assert.ok(Math.abs(pointsMultiplier(0.57, 0, P) - 1) < 1e-12);
});

test("part de points inconnue -> neutre (une donnée absente ne pénalise pas)", () => {
  assert.equal(pointsMultiplier(null, 0, P), 1);
});

test("le multiplicateur est borné (pas d'explosion sur un 21-0, 21-0)", () => {
  const m = pointsMultiplier(1, 0, { ...P, pointsFactor: 5 });
  assert.ok(m <= 2.5, `m = ${m}`);
  const petit = pointsMultiplier(0.5, 0, { ...P, pointsFactor: 5 });
  assert.ok(petit >= 0.25, `petit = ${petit}`);
});

test("amortissement anti-autocorrélation : même score, favori amorti, outsider amplifié", () => {
  const D = { ...P, pointsDamping: true };
  const favori = pointsMultiplier(0.62, +200, D);   // le vainqueur était favori de 200 pts
  const outsider = pointsMultiplier(0.62, -200, D); // le vainqueur était outsider de 200 pts
  const neutre = pointsMultiplier(0.62, 0, D);
  assert.ok(favori < neutre, `favori ${favori} < neutre ${neutre}`);
  assert.ok(outsider > neutre, `outsider ${outsider} > neutre ${neutre}`);
});

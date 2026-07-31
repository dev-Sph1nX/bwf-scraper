// Valeur attendue d'un pari et meilleures cotes par camp.
//   node --test test/ev.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ev, bestOdd, pointsTotal } from "../lib/ev.mjs";

test("ev : cote 1,58 à 62 % -> négative ; à 68 % -> positive", () => {
  assert.ok(Math.abs(ev(1.58, 0.62) - (-0.0204)) < 1e-4);
  assert.ok(ev(1.58, 0.68) > 0.07);
});

test("ev : cote absente ou proba absente -> null (jamais 0, qui voudrait dire « équitable »)", () => {
  assert.equal(ev(null, 0.62), null);
  assert.equal(ev(1.58, null), null);
  assert.equal(ev(1, 0.62), null); // cote qui ne paie pas
});

test("bestOdd : la meilleure cote du camp, avec son opérateur", () => {
  const books = { betclic: { odd1: 1.52, odd2: 1.9 }, winamax: { odd1: 1.58, odd2: 1.95 }, unibet: { odd1: null, odd2: 2.0 } };
  assert.deepEqual(bestOdd(books, 1), { odd: 1.58, book: "winamax" });
  assert.deepEqual(bestOdd(books, 2), { odd: 2.0, book: "unibet" });
  assert.equal(bestOdd({}, 1), null);
});

test("pointsTotal : somme des points traçables (règle du bouton graphe : actif si ≥ 2)", () => {
  const books = { betclic: { points: [{}, {}] }, unibet: { points: [{}] }, winamax: {} };
  assert.equal(pointsTotal(books), 3);
  assert.equal(pointsTotal({}), 0);
});

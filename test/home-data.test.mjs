// test/home-data.test.mjs
// La carte d'accueil affiche les cotes dans l'ordre BWF (team1 en haut).
//   node --test test/home-data.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { oddsForMatch } from "../lib/home-data.mjs";

const group = {
  key: "73288292",
  books: {
    winamax: { odd1: 1.58, odd2: 2.0, points: [{ at: "t1", odd1: 1.58, odd2: 2.0, impliedP1: 0.55 }] },
    unibet: { odd1: 1.55, odd2: 2.0, points: [] },
  },
};

test("swapped=false : les cotes du groupe sont déjà dans l'ordre BWF", () => {
  const o = oddsForMatch(group, false);
  assert.equal(o.bookKey, "73288292");
  assert.equal(o.books.winamax.odd1, 1.58);
  assert.equal(o.n, 1);
});

test("swapped=true : cotes ET points retournés vers team1 BWF", () => {
  const o = oddsForMatch(group, true);
  assert.equal(o.books.winamax.odd1, 2.0);       // team1 BWF = p2 du groupe
  assert.equal(o.books.winamax.points[0].odd1, 2.0);
  assert.ok(Math.abs(o.books.winamax.points[0].impliedP1 - 0.45) < 1e-9);
});

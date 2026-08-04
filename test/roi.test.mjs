// Tests de lib/roi.mjs : l'étude de rentabilité des pronostics.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bestOddAt, favoriBets, valueBets, disagreementBets,
} from "../lib/roi.mjs";

// Jeux de cotes : flashscore (open+close) et relevé maison (close seule).
const BOOKS_FULL = {
  betclic: { odd1: 1.5, odd2: 2.5, open1: 1.4, open2: 2.8 },
  unibet:  { odd1: 1.55, odd2: 2.4, open1: 1.45, open2: 2.6 },
  winamax: { odd1: 1.48, odd2: 2.6, open1: 1.38, open2: 3.0 },
};
const BOOKS_CLOSE_ONLY = { betclic: { odd1: 1.9, odd2: 1.9 } };

test("bestOddAt : max des bookmakers, par camp et par instant", () => {
  assert.deepEqual(bestOddAt(BOOKS_FULL, 1, "close"), { odd: 1.55, book: "unibet" });
  assert.deepEqual(bestOddAt(BOOKS_FULL, 2, "close"), { odd: 2.6, book: "winamax" });
  assert.deepEqual(bestOddAt(BOOKS_FULL, 2, "open"), { odd: 3.0, book: "winamax" });
});

test("bestOddAt : ouverture absente (relevé maison) -> null ; clôture ok", () => {
  assert.equal(bestOddAt(BOOKS_CLOSE_ONLY, 1, "open"), null);
  assert.deepEqual(bestOddAt(BOOKS_CLOSE_ONLY, 1, "close"), { odd: 1.9, book: "betclic" });
});

test("bestOddAt : restriction à un seul bookmaker", () => {
  assert.deepEqual(bestOddAt(BOOKS_FULL, 1, "close", "betclic"), { odd: 1.5, book: "betclic" });
  assert.equal(bestOddAt(BOOKS_CLOSE_ONLY, 1, "close", "winamax"), null);
});

test("bestOddAt : books vide ou absent -> null", () => {
  assert.equal(bestOddAt({}, 1, "close"), null);
  assert.equal(bestOddAt(undefined, 1, "close"), null);
});

const row = (over = {}) => ({
  prob: 70, pick: 1, winner: 1, books: BOOKS_FULL, ...over,
});

test("favoriBets : gagne -> gain = cote − 1 ; perd -> −1", () => {
  const [win] = favoriBets(row(), "close");
  assert.deepEqual(win, { side: 1, odd: 1.55, book: "unibet", rowProb: 70, won: true, gain: 0.55 });
  const [lose] = favoriBets(row({ winner: 2 }), "close");
  assert.equal(lose.won, false);
  assert.equal(lose.gain, -1);
});

test("favoriBets : pas de cote du pick à cet instant -> aucun pari", () => {
  assert.deepEqual(favoriBets(row({ books: BOOKS_CLOSE_ONLY }), "open"), []);
});

test("valueBets : mise sur l'outsider quand l'EV est positive", () => {
  // prob team1 = 70 % -> team2 = 30 % ; cote 2 de clôture 2.6 -> EV = 0.3×2.6−1 = −0.22 (pas de pari)
  // cote 1 de clôture 1.55 -> EV = 0.7×1.55−1 = 0.085 (pari sur le camp 1)
  const bets = valueBets(row(), "close");
  assert.equal(bets.length, 1);
  assert.equal(bets[0].side, 1);
  assert.ok(Math.abs(bets[0].ev - 0.085) < 1e-9);
});

test("valueBets : peut miser sur les DEUX camps si les cotes sont généreuses", () => {
  const books = { betclic: { odd1: 2.1, odd2: 2.6 } }; // prob 50/50 -> EV 0.05 et 0.30
  const bets = valueBets(row({ prob: 50, books }), "close");
  assert.equal(bets.length, 2);
});

test("valueBets : seuil strict — EV exactement au seuil ne mise pas", () => {
  // Cas choisis pour une arithmétique flottante EXACTE (p = 0,5 divise par 2) :
  const books = { betclic: { odd1: 2.0 } }; // prob 50 -> EV = 0 pile
  assert.deepEqual(valueBets(row({ prob: 50, books }), "close"), []);
  // odd 3.0 × 0.5 = 1.5 exact -> EV = 0.5 pile : pas de pari au seuil 0.5
  assert.equal(valueBets(row({ prob: 50, books: { betclic: { odd1: 3.0 } } }), "close", { threshold: 0.5 }).length, 0);
});

test("valueBets : restriction à un bookmaker", () => {
  const bets = valueBets(row(), "close", { onlyBook: "winamax" }); // odd1 1.48 -> EV 0.036
  assert.equal(bets.length, 1);
  assert.equal(bets[0].book, "winamax");
});

test("disagreementBets : seulement si la meilleure cote du favori dépasse 2", () => {
  assert.deepEqual(disagreementBets(row(), "close"), []); // cote favori 1.55
  const books = { betclic: { odd1: 2.0 } };
  assert.deepEqual(disagreementBets(row({ books }), "close"), []); // 2.0 pile : non
  const [bet] = disagreementBets(row({ books: { betclic: { odd1: 2.1 } } }), "close");
  assert.equal(bet.odd, 2.1);
  assert.equal(bet.side, 1);
});

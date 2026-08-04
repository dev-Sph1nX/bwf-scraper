// Tests de lib/roi.mjs : l'étude de rentabilité des pronostics.
import test from "node:test";
import assert from "node:assert/strict";
import {
  bestOddAt, favoriBets, valueBets, disagreementBets, aggregate,
  computeRoi, EV_THRESHOLDS, BANDS, BOOKS,
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

test("aggregate : liste vide -> zéros et roi/ci null", () => {
  assert.deepEqual(aggregate([]), { n: 0, staked: 0, net: 0, roi: null, ci: null, won: 0 });
});

test("aggregate : net, roi et won exacts", () => {
  const bets = [
    { gain: 0.55, won: true }, { gain: -1, won: false },
    { gain: 1.4, won: true }, { gain: -1, won: false },
  ];
  const a = aggregate(bets);
  assert.equal(a.n, 4);
  assert.equal(a.staked, 4);
  assert.ok(Math.abs(a.net - -0.05) < 1e-9);
  assert.ok(Math.abs(a.roi - -0.0125) < 1e-4);
  assert.equal(a.won, 2);
});

test("aggregate : bootstrap reproductible (graine fixe) et IC autour du ROI", () => {
  const bets = Array.from({ length: 100 }, (_, i) => (
    i % 2 ? { gain: 0.9, won: true } : { gain: -1, won: false }
  ));
  const a = aggregate(bets, { seed: 42 });
  const b = aggregate(bets, { seed: 42 });
  assert.deepEqual(a.ci, b.ci); // même graine -> même IC
  assert.ok(a.ci[0] <= a.roi && a.roi <= a.ci[1]); // l'IC contient le ROI ponctuel
  assert.ok(a.ci[0] < a.ci[1]);
});

test("disagreementBets : seulement si la meilleure cote du favori dépasse 2", () => {
  assert.deepEqual(disagreementBets(row(), "close"), []); // cote favori 1.55
  const books = { betclic: { odd1: 2.0 } };
  assert.deepEqual(disagreementBets(row({ books }), "close"), []); // 2.0 pile : non
  const [bet] = disagreementBets(row({ books: { betclic: { odd1: 2.1 } } }), "close");
  assert.equal(bet.odd, 2.1);
  assert.equal(bet.side, 1);
});

// ---- computeRoi : le rapport complet ----------------------------------------
// Petit jeu : 2 tournois, cotes complètes (open+close) pour rendre tout actif.
const mkRow = (tmtId, i, over = {}) => ({
  tmtId, name: `Tournoi ${tmtId}`, disc: "MS", roundName: "R16",
  matchTime: `2026-03-0${tmtId} 1${i}:00:00`, team1: `A${i}`, team2: `B${i}`,
  prob: 65, pick: 1, winner: i % 2 ? 1 : 2, books: BOOKS_FULL, ...over,
});
const ROWS = [
  ...Array.from({ length: 6 }, (_, i) => mkRow(1, i)),
  ...Array.from({ length: 6 }, (_, i) => mkRow(2, i)),
];

test("computeRoi : écarte les lignes inutilisables", () => {
  const r = computeRoi([
    ...ROWS,
    mkRow(3, 0, { prob: null, pick: null }),  // sans prono
    mkRow(3, 1, { winner: null }),            // sans vainqueur
    mkRow(3, 2, { books: {} }),               // sans cotes
  ]);
  assert.equal(r.totalMatches, ROWS.length);
  assert.equal(r.strategies.favori.tournois.length, 2);
});

test("computeRoi : la somme des tournois = le global (net et n), par stratégie/instant", () => {
  const r = computeRoi(ROWS);
  for (const key of ["favori", "value"]) {
    for (const instant of ["open", "close"]) {
      const t = r.strategies[key].tournois;
      const sumN = t.reduce((s, x) => s + x[instant].n, 0);
      const sumNet = t.reduce((s, x) => s + x[instant].net, 0);
      assert.equal(sumN, r.strategies[key].global[instant].n, `${key}/${instant}`);
      assert.ok(Math.abs(sumNet - r.strategies[key].global[instant].net) < 0.02, `${key}/${instant}`);
    }
  }
});

test("computeRoi : tranches — prob 50 tombe en 50-60, prob 100 en 90-100", () => {
  const rows = [mkRow(1, 0, { prob: 50, pick: 1 }), mkRow(1, 1, { prob: 100, pick: 1 })];
  const r = computeRoi(rows);
  const bandN = (band, instant) => r.bands.find((b) => b.band === band)[instant].n;
  assert.equal(bandN("50-60", "close"), 1);
  assert.equal(bandN("90-100", "close"), 1);
  assert.equal(r.bands.length, BANDS.length);
});

test("computeRoi : tranches — la proba du PICK, pas celle de team1 (pick 2, prob 20 -> 80-90)", () => {
  const r = computeRoi([mkRow(1, 0, { prob: 20, pick: 2, winner: 2 })]);
  assert.equal(r.bands.find((b) => b.band === "80-90").close.n, 1);
});

test("computeRoi : balayage — le volume ne peut que baisser quand le seuil monte", () => {
  const r = computeRoi(ROWS);
  assert.equal(r.evSweep.length, EV_THRESHOLDS.length);
  for (const instant of ["open", "close"]) {
    for (let i = 1; i < r.evSweep.length; i++) {
      assert.ok(r.evSweep[i][instant].n <= r.evSweep[i - 1][instant].n, instant);
    }
  }
  // seuil 0 = la stratégie value elle-même
  assert.equal(r.evSweep[0].close.n, r.strategies.value.global.close.n);
});

test("computeRoi : par bookmaker — le panier commun est inclus dans « tous ses matchs »", () => {
  // un match où seul betclic cote -> exclu du panier commun
  const rows = [...ROWS, mkRow(1, 9, { books: { betclic: { odd1: 1.8, odd2: 2.0 } } })];
  const r = computeRoi(rows);
  assert.equal(r.byBook.length, BOOKS.length);
  const bc = r.byBook.find((b) => b.book === "betclic");
  assert.ok(bc.favori.common.close.n < bc.favori.all.close.n);
  const wina = r.byBook.find((b) => b.book === "winamax");
  assert.equal(wina.favori.common.close.n, wina.favori.all.close.n); // winamax ne cote pas le match ajouté
});

test("computeRoi : le journal des paris est auditable (stratégies, ev sur value)", () => {
  const r = computeRoi(ROWS);
  const strategies = new Set(r.bets.map((b) => b.strategy));
  assert.deepEqual([...strategies].sort(), ["favori", "value"]); // pas de désaccord : cotes favori < 2
  assert.ok(r.bets.filter((b) => b.strategy === "value").every((b) => typeof b.ev === "number"));
  const fav = r.bets.filter((b) => b.strategy === "favori" && b.instant === "close");
  assert.equal(fav.length, r.strategies.favori.global.close.n);
});

test("computeRoi : reproductible (même graine -> mêmes IC)", () => {
  assert.deepEqual(computeRoi(ROWS), computeRoi(ROWS));
});

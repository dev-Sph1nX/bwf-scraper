// Tests du guide de pari « totaux » (lib/guide-totaux.mjs) — application de
// la règle scellée « over sur rel ≤ −2 » (bwf-playground/regle-rel-moins-2).
//   node --test test/guide-totaux.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { guideTotaux, BARRES_TOTAUX, SEUIL_REL } from "../lib/guide-totaux.mjs";

const NOW = "2026-09-10T08:00:00.000Z";
const serie = (extra = {}) => ({
  book: "betclic", bookMatchId: "b1", srId: "73288292",
  tournament: "Open de Chine", discipline: "MS",
  p1: "Kunlavut Vitidsarn", p2: "Shi Yu Qi",
  startUtc: "2026-09-10T12:00:00.000Z", isLive: false,
  totals: [{ n: 75.5, over: 1.85, under: 1.85 }],
  totalsAt: "2026-09-10T06:00:00.000Z",
  points: [],
  ...extra,
});

test("les constantes sont celles du scellé du 2026-08-28 — ne pas « régler »", () => {
  assert.deepEqual(BARRES_TOTAUX, { MS: 77.5, MD: 77.5, XD: 77.5, WS: 75.5, WD: 75.5 });
  assert.equal(SEUIL_REL, -2);
});

test("MS barre 75,5 : rel = −2 pile -> conseil over ; barre 76,5 -> rien", () => {
  const [e] = guideTotaux([serie()], NOW);
  assert.equal(e.nConseils, 1);
  assert.deepEqual(e.lignes, [{ n: 75.5, over: 1.85, under: 1.85, rel: -2, conseil: true }]);

  const [e2] = guideTotaux([serie({ totals: [{ n: 76.5, over: 1.85, under: 1.85 }] })], NOW);
  assert.equal(e2.nConseils, 0);
  assert.equal(e2.lignes[0].conseil, false);
});

test("WS : la barre habituelle est 75,5 -> conseil dès 73,5, pas à 74,5", () => {
  const [e] = guideTotaux([serie({
    discipline: "WS",
    totals: [{ n: 73.5, over: 1.8, under: 1.9 }, { n: 74.5, over: 1.85, under: 1.85 }],
  })], NOW);
  assert.equal(e.barre, 75.5);
  assert.deepEqual(e.lignes.map((l) => l.conseil), [true, false]);
});

test("pas de cote over -> pas de conseil, même à rel ≤ −2 ; discipline inconnue -> rel null", () => {
  const [e] = guideTotaux([serie({ totals: [{ n: 73.5, over: null, under: 1.85 }] })], NOW);
  assert.equal(e.nConseils, 0);
  const [e2] = guideTotaux([serie({ discipline: null })], NOW);
  assert.equal(e2.barre, null);
  assert.deepEqual(e2.lignes[0], { n: 75.5, over: 1.85, under: 1.85, rel: null, conseil: false });
});

test("écartés : autres opérateurs, live, match commencé, série sans totaux", () => {
  const out = guideTotaux([
    serie({ book: "pinnacle" }),
    serie({ isLive: true }),
    serie({ startUtc: "2026-09-10T07:00:00.000Z" }), // déjà commencé à NOW
    serie({ totals: undefined }),
  ], NOW);
  assert.equal(out.length, 0);
});

test("tri : matchs à conseil d'abord, puis heure de match", () => {
  const out = guideTotaux([
    serie({ bookMatchId: "b2", startUtc: "2026-09-10T10:00:00.000Z", totals: [{ n: 78.5, over: 1.85, under: 1.85 }] }),
    serie({ bookMatchId: "b3", startUtc: "2026-09-10T14:00:00.000Z" }),
    serie({ bookMatchId: "b4", startUtc: "2026-09-10T11:00:00.000Z" }),
  ], NOW);
  assert.deepEqual(out.map((e) => [e.startUtc.slice(11, 13), e.nConseils]),
    [["11", 1], ["14", 1], ["10", 0]]);
});

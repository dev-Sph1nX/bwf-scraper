// Tests de l'historisation des cotes.
//   node --test test/
//
// Fonctions pures : les relevés sont fabriqués à la main.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOddsSeries, impliedP1, overround, historyStats, runFileName } from "../lib/odds-history.mjs";

const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);

const M = (o = {}) => ({
  eventId: "E1", date: "2026-08-05", time: "10:00", discipline: "MS",
  tournamentKey: "japan open", league: "BWF World Tour", href: "/x",
  p1: { display: "A" }, p2: { display: "B" }, settled: false,
  odd1: 2.0, odd2: 2.0, ...o,
});
const RUN = (at, matches) => ({ fetchedAt: at, matches });

// --- Probabilité implicite ------------------------------------------------

test("impliedP1 retire la commission du bookmaker", () => {
  // cotes 2,00 / 2,00 -> somme des implicites = 1, donc 50 % chacun
  proche(impliedP1(2, 2), 0.5);
  // cotes 1,50 / 3,00 : 0,667 + 0,333 = 1 exactement
  proche(impliedP1(1.5, 3), (1 / 1.5) / (1 / 1.5 + 1 / 3));
  // avec marge : 1,90 / 1,90 -> somme 1,052, mais après retrait 50/50
  proche(impliedP1(1.9, 1.9), 0.5);
});

test("impliedP1 et son complément somment toujours à 1", () => {
  for (const [a, b] of [[1.2, 5], [1.9, 1.9], [3, 1.4]]) {
    proche(impliedP1(a, b) + impliedP1(b, a), 1);
  }
});

test("impliedP1 rejette les cotes invalides", () => {
  assert.equal(impliedP1(null, 2), null);
  assert.equal(impliedP1(1, 2), null, "une cote de 1 n'a pas de sens");
  assert.equal(impliedP1(0, 2), null);
});

test("overround mesure la commission", () => {
  proche(overround(2, 2), 0, 1e-12);
  proche(overround(1.9, 1.9), 2 / 1.9 - 1);
  assert.ok(overround(1.9, 1.9) > 0.05, "environ 5 % de marge");
  assert.equal(overround(null, 2), null);
});

test("runFileName produit un nom de fichier utilisable", () => {
  const n = runFileName("2026-08-05T10:30:00.000Z");
  assert.equal(n, "2026-08-05T10-30-00-000Z.json");
  assert.ok(!/[:]/.test(n), "pas de deux-points, illégal sur certains systèmes");
});

// --- Construction de la série --------------------------------------------

test("buildOddsSeries crée une entrée par match", () => {
  const s = buildOddsSeries([RUN("2026-08-01T10:00:00Z", [M(), M({ eventId: "E2" })])]);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.eventId).sort(), ["E1", "E2"]);
});

test("buildOddsSeries empile les relevés successifs d'un même match", () => {
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ odd1: 2.0, odd2: 2.0 })]),
    RUN("2026-08-02T10:00:00Z", [M({ odd1: 1.8, odd2: 2.2 })]),
    RUN("2026-08-03T10:00:00Z", [M({ odd1: 1.6, odd2: 2.6 })]),
  ]);
  assert.equal(s[0].readings, 3);
  assert.deepEqual(s[0].points.map((p) => p.odd1), [2.0, 1.8, 1.6]);
  assert.equal(s[0].opening.odd1, 2.0);
  assert.equal(s[0].closing.odd1, 1.6);
  assert.equal(s[0].moved, true);
});

test("buildOddsSeries FUSIONNE les relevés consécutifs identiques", () => {
  // Garder dix fois la même cote alourdirait le fichier et rendrait le graphe
  // illisible sans rien apprendre.
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ odd1: 2.0, odd2: 2.0 })]),
    RUN("2026-08-02T10:00:00Z", [M({ odd1: 2.0, odd2: 2.0 })]),
    RUN("2026-08-03T10:00:00Z", [M({ odd1: 2.0, odd2: 2.0 })]),
  ]);
  assert.equal(s[0].readings, 1, "une seule valeur distincte");
  assert.equal(s[0].points[0].at, "2026-08-01T10:00:00Z", "on garde le PREMIER instant");
  assert.equal(s[0].points[0].lastSeen, "2026-08-03T10:00:00Z", "et jusqu'à quand elle a tenu");
  assert.equal(s[0].moved, false);
});

test("buildOddsSeries distingue un retour à une valeur déjà vue", () => {
  // 2,0 -> 1,8 -> 2,0 : trois points, pas deux. Le mouvement compte.
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ odd1: 2.0 })]),
    RUN("2026-08-02T10:00:00Z", [M({ odd1: 1.8 })]),
    RUN("2026-08-03T10:00:00Z", [M({ odd1: 2.0 })]),
  ]);
  assert.equal(s[0].readings, 3);
});

test("buildOddsSeries ignore les relevés sans cote sans casser la série", () => {
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ odd1: 2.0, odd2: 2.0 })]),
    RUN("2026-08-02T10:00:00Z", [M({ odd1: null, odd2: null })]),
    RUN("2026-08-03T10:00:00Z", [M({ odd1: 1.7, odd2: 2.3 })]),
  ]);
  assert.equal(s[0].readings, 2);
  assert.equal(s[0].closing.odd1, 1.7);
});

test("buildOddsSeries suit le passage de « à venir » à « joué »", () => {
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ settled: false })]),
    RUN("2026-08-06T10:00:00Z", [M({ settled: true, odd1: 1.5, odd2: 2.8 })]),
  ]);
  assert.equal(s[0].settled, true, "les métadonnées suivent le dernier relevé");
});

test("buildOddsSeries calcule la dérive de la probabilité implicite", () => {
  // 2,00/2,00 (50 %) puis 1,50/3,00 (66,7 %) : le marché va VERS le camp 1
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ odd1: 2.0, odd2: 2.0 })]),
    RUN("2026-08-02T10:00:00Z", [M({ odd1: 1.5, odd2: 3.0 })]),
  ]);
  assert.ok(s[0].driftP1 > 0, `dérive ${s[0].driftP1} doit être positive`);
  proche(s[0].driftP1, impliedP1(1.5, 3) - 0.5);
});

test("buildOddsSeries rend une dérive négative quand le marché s'éloigne", () => {
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ odd1: 1.5, odd2: 3.0 })]),
    RUN("2026-08-02T10:00:00Z", [M({ odd1: 2.5, odd2: 1.6 })]),
  ]);
  assert.ok(s[0].driftP1 < 0);
});

test("buildOddsSeries rend une dérive nulle si la cote n'a pas bougé", () => {
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M()]),
    RUN("2026-08-02T10:00:00Z", [M()]),
  ]);
  proche(s[0].driftP1, 0, 1e-12);
});

test("buildOddsSeries rend driftP1 null quand un seul relevé existe", () => {
  const s = buildOddsSeries([RUN("2026-08-01T10:00:00Z", [M()])]);
  proche(s[0].driftP1, 0, 1e-12);
  assert.equal(s[0].readings, 1);
  assert.equal(s[0].moved, false);
});

test("buildOddsSeries trie les matchs par date et heure", () => {
  const s = buildOddsSeries([RUN("2026-08-01T10:00:00Z", [
    M({ eventId: "tard", date: "2026-08-06", time: "14:00" }),
    M({ eventId: "tot", date: "2026-08-05", time: "09:00" }),
    M({ eventId: "milieu", date: "2026-08-06", time: "09:00" }),
  ])]);
  assert.deepEqual(s.map((x) => x.eventId), ["tot", "milieu", "tard"]);
});

test("buildOddsSeries ignore les lignes sans eventId", () => {
  const s = buildOddsSeries([RUN("2026-08-01T10:00:00Z", [M({ eventId: null })])]);
  assert.equal(s.length, 0);
});

test("buildOddsSeries tolère un relevé vide", () => {
  assert.deepEqual(buildOddsSeries([RUN("2026-08-01T10:00:00Z", [])]), []);
  assert.deepEqual(buildOddsSeries([]), []);
});

// --- Statistiques ---------------------------------------------------------

test("historyStats résume la couverture", () => {
  const s = buildOddsSeries([
    RUN("2026-08-01T10:00:00Z", [M({ eventId: "A", odd1: 2, odd2: 2 }), M({ eventId: "B", odd1: null, odd2: null })]),
    RUN("2026-08-02T10:00:00Z", [M({ eventId: "A", odd1: 1.7, odd2: 2.3 })]),
  ]);
  const st = historyStats(s);
  assert.equal(st.events, 2);
  assert.equal(st.withOdds, 1, "B n'a jamais eu de cote");
  assert.equal(st.moved, 1);
  assert.equal(st.readingsMax, 2);
  assert.ok(st.meanAbsDrift > 0);
});

test("historyStats ne plante pas sur une série vide", () => {
  const st = historyStats([]);
  assert.equal(st.events, 0);
  assert.equal(st.meanAbsDrift, null);
  assert.equal(st.meanOverround, null);
});

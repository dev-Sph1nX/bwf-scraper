// Tests de l'historisation des cotes bookmakers (data/books/runs/).
//   node --test test/books-history.test.mjs
//
// Même philosophie que lib/odds-history.mjs (relevés append-only → séries),
// mais la clé d'un match est (book, bookMatchId), et les lignes d'un même
// match chez plusieurs opérateurs se regroupent par identifiant Sportradar.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBookSeries, groupBooks } from "../lib/books-history.mjs";

const ligne = (book, id, srId, odd1, odd2, extra = {}) => ({
  book, bookMatchId: id, srId,
  tournament: "Open de Taipei", discipline: "MS",
  p1: extra.p1 ?? "J.Hoh", p2: extra.p2 ?? "TB.Yoo",
  odd1, odd2, startUtc: "2026-07-31T11:30:00.000Z", isLive: false,
  ...extra,
});

const run = (fetchedAt, rowsParBook) => ({
  fetchedAt,
  books: Object.fromEntries(Object.entries(rowsParBook).map(([b, rows]) => [b, { complete: true, rows }])),
});

test("série : relevés consécutifs identiques fusionnés, ouverture et clôture", () => {
  const runs = [
    run("2026-07-31T08:00:00Z", { unibet: [ligne("unibet", "e1", "73288292", 1.5, 2.4)] }),
    run("2026-07-31T09:00:00Z", { unibet: [ligne("unibet", "e1", "73288292", 1.5, 2.4)] }),
    run("2026-07-31T10:00:00Z", { unibet: [ligne("unibet", "e1", "73288292", 1.58, 2.0)] }),
  ];
  const [s] = buildBookSeries(runs);
  assert.equal(s.book, "unibet");
  assert.equal(s.readings, 2); // 3 relevés mais 2 valeurs distinctes
  assert.equal(s.opening.odd1, 1.5);
  assert.equal(s.opening.lastSeen, "2026-07-31T09:00:00Z"); // la valeur a tenu 2 relevés
  assert.equal(s.closing.odd1, 1.58);
  assert.equal(s.moved, true);
});

test("groupement par srId : un match, trois opérateurs, noms pris chez Winamax", () => {
  const runs = [
    run("2026-07-31T10:00:00Z", {
      unibet: [ligne("unibet", "e1", "73288292", 1.55, 2.0, { p1: "J.Hoh", p2: "TB.Yoo" })],
      betclic: [ligne("betclic", "b1", "73288292", 1.52, 1.9, { p1: "Justin Hoh", p2: "Bin Tae Yoo" })],
      winamax: [ligne("winamax", "73288292", "73288292", 1.58, 2.0, { p1: "Justin Hoh", p2: "Tae Bin Yoo" })],
    }),
  ];
  const groups = groupBooks(buildBookSeries(runs));
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.key, "73288292");
  // Winamax porte les noms COMPLETS -> c'est lui qui nomme le groupe.
  assert.equal(g.p1, "Justin Hoh");
  assert.equal(g.p2, "Tae Bin Yoo");
  assert.deepEqual(Object.keys(g.books).sort(), ["betclic", "unibet", "winamax"]);
  assert.equal(g.books.betclic.closing.odd1, 1.52);
  assert.equal(g.books.unibet.closing.odd2, 2.0);
});

test("les cotes LIVE ne rentrent pas dans les séries (la clôture = dernier prématch)", () => {
  // À un relevé toutes les 2 h on ne peut pas suivre du live : une cote prise
  // pendant le match écraserait la « cote de clôture », qui doit être la
  // dernière valeur d'AVANT match (c'est elle qu'on compare au modèle).
  const runs = [
    run("2026-07-31T08:00:00Z", { unibet: [ligne("unibet", "e1", "73288292", 1.5, 2.4)] }),
    run("2026-07-31T12:00:00Z", { unibet: [ligne("unibet", "e1", "73288292", 5.0, 1.05, { isLive: true })] }),
  ];
  const [s] = buildBookSeries(runs);
  assert.equal(s.readings, 1);          // le point live est ignoré
  assert.equal(s.closing.odd1, 1.5);    // la clôture reste le dernier prématch
  assert.equal(s.isLive, true);         // …mais la métadonnée, elle, suit le relevé
});

test("chaque opérateur du groupe garde SON libellé de tournoi (vue brute fidèle)", () => {
  const runs = [
    run("2026-07-31T10:00:00Z", {
      unibet: [ligne("unibet", "e1", "73288292", 1.55, 2.0, { tournament: "Taipei Open" })],
      winamax: [ligne("winamax", "73288292", "73288292", 1.58, 2.0, { tournament: "Open de Taipei", p1: "Justin Hoh", p2: "Tae Bin Yoo" })],
    }),
  ];
  const [g] = groupBooks(buildBookSeries(runs));
  assert.equal(g.tournament, "Open de Taipei");        // le groupe = source préférée
  assert.equal(g.books.unibet.tournament, "Taipei Open"); // le brut = tel qu'affiché
});

test("sans srId : pas de fusion accidentelle, clé de repli book:bookMatchId", () => {
  const runs = [
    run("2026-07-31T10:00:00Z", {
      unibet: [ligne("unibet", "e9", null, 1.8, 1.8)],
      betclic: [ligne("betclic", "b9", null, 1.85, 1.75)],
    }),
  ];
  const groups = groupBooks(buildBookSeries(runs));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.key).sort(), ["betclic:b9", "unibet:e9"]);
});

test("l'orientation des cotes suit p1/p2 de CHAQUE opérateur (pas d'inversion silencieuse)", () => {
  // Unibet affiche Yoo en premier : ses cotes sont dans SON ordre. Le groupe
  // expose l'ordre de référence (Winamax) et le drapeau swapped pour l'autre.
  const runs = [
    run("2026-07-31T10:00:00Z", {
      unibet: [ligne("unibet", "e1", "73288292", 2.0, 1.55, { p1: "TB.Yoo", p2: "J.Hoh" })],
      winamax: [ligne("winamax", "73288292", "73288292", 1.58, 2.0, { p1: "Justin Hoh", p2: "Tae Bin Yoo" })],
    }),
  ];
  const [g] = groupBooks(buildBookSeries(runs));
  assert.equal(g.p1, "Justin Hoh");
  assert.equal(g.books.winamax.swapped, false);
  assert.equal(g.books.unibet.swapped, true); // Yoo d'abord chez Unibet
  // Après réorientation, odd1 du groupe = cote de Hoh chez les deux.
  assert.equal(g.books.winamax.odd1, 1.58);
  assert.equal(g.books.unibet.odd1, 1.55);
  // …et la probabilité implicite des points suit la réorientation : Hoh est
  // favori (cote 1,55 contre 2,0), sa proba implicite dépasse 50 % chez les
  // DEUX opérateurs. Sans ce retournement, un graphe tracerait le mauvais camp.
  assert.ok(g.books.winamax.points[0].impliedP1 > 0.5);
  assert.ok(g.books.unibet.points[0].impliedP1 > 0.5, `unibet impliedP1 = ${g.books.unibet.points[0].impliedP1}`);
});

test("la dérive (driftP1) d'un opérateur inversé est réorientée elle aussi", () => {
  // Chez Unibet (Yoo listé en premier), la cote de Yoo passe de 1.8 à 2.2 :
  // le marché se déplace VERS Hoh. Dans l'ordre du groupe (Hoh = camp 1),
  // driftP1 doit donc être POSITIF.
  const runs = [
    run("2026-07-31T08:00:00Z", {
      unibet: [ligne("unibet", "e1", "73288292", 1.8, 1.9, { p1: "TB.Yoo", p2: "J.Hoh" })],
      winamax: [ligne("winamax", "73288292", "73288292", 1.9, 1.8, { p1: "Justin Hoh", p2: "Tae Bin Yoo" })],
    }),
    run("2026-07-31T10:00:00Z", {
      unibet: [ligne("unibet", "e1", "73288292", 2.2, 1.6, { p1: "TB.Yoo", p2: "J.Hoh" })],
      winamax: [ligne("winamax", "73288292", "73288292", 1.6, 2.2, { p1: "Justin Hoh", p2: "Tae Bin Yoo" })],
    }),
  ];
  const [g] = groupBooks(buildBookSeries(runs));
  assert.ok(g.books.winamax.driftP1 > 0, `winamax driftP1 = ${g.books.winamax.driftP1}`);
  assert.ok(g.books.unibet.driftP1 > 0, `unibet driftP1 = ${g.books.unibet.driftP1}`);
});

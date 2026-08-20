// Tests de la jointure des cotes historiques Flashscore vers les matchs BWF.
//   node --test test/flashscore-join.test.mjs
//
// La clé du rapprochement est l'empreinte de score (points exacts de chaque
// manche), orientable : ces tests vérifient l'orientation des cotes dans les
// deux sens, et surtout les refus — un rapprochement douteux (deux candidats,
// noms étrangers, plus d'un jour d'écart) doit être abandonné, jamais deviné.

import { test } from "node:test";
import assert from "node:assert/strict";
import { joinFlashscore } from "../lib/flashscore-join.mjs";

const fsFile = (matches) => ({ tournamentSlug: "open-test", matches });

const fsMatch = (extra = {}) => ({
  fsId: "abc12345",
  disc: "MS",
  startUtc: "2026-01-07T01:05:00.000Z", // 09:05 locale en Asie : jour BWF = 2026-01-07
  home: { name: "Lu G. Z." },
  away: { name: "Ng Ka L. A." },
  sets: [{ home: 21, away: 19 }, { home: 21, away: 15 }],
  odds: { betclic: { home: { opening: 1.5, closing: 1.44 }, away: { opening: 2.6, closing: 2.7 } } },
  ...extra,
});

const bwfRow = (extra = {}) => ({
  tmtId: 5001, disc: "MS", day: "2026-01-07",
  name1: "LU Guang Zu", name2: "NG Ka Long Angus",
  sets: [{ home: 21, away: 19 }, { home: 21, away: 15 }],
  a: "111", b: "222",
  ...extra,
});

test("jointure directe : cotes orientées team1/team2, clé au bon schéma", () => {
  const { joined, stats } = joinFlashscore([fsFile([fsMatch()])], [bwfRow()]);
  assert.equal(stats.joined, 1);
  const odds = joined.get("5001|MS|2026-01-07|111|222");
  assert.ok(odds, "clé tmtId|disc|jour|a|b attendue");
  assert.equal(odds.books.betclic.odd1, 1.44);  // clôture du home FS = notre team1
  assert.equal(odds.books.betclic.odd2, 2.7);
  assert.equal(odds.books.betclic.open1, 1.5);
  assert.equal(odds.via, "flashscore");
});

test("jointure inversée : le home Flashscore est notre team2, cotes retournées", () => {
  // Chez nous, l'affiche est dans l'autre sens : team1 = Ng, qui a PERDU 19-21, 15-21.
  const bwf = bwfRow({
    name1: "NG Ka Long Angus", name2: "LU Guang Zu",
    sets: [{ home: 19, away: 21 }, { home: 15, away: 21 }],
    a: "222", b: "111",
  });
  const { joined, stats } = joinFlashscore([fsFile([fsMatch()])], [bwf]);
  assert.equal(stats.joined, 1);
  const odds = joined.get("5001|MS|2026-01-07|222|111");
  assert.equal(odds.books.betclic.odd1, 2.7);   // notre team1 = le away FS
  assert.equal(odds.books.betclic.odd2, 1.44);
  assert.equal(odds.books.betclic.open1, 2.6);
});

test("l'orientation retenue est publiée : les marchés orientés d'ailleurs en dépendent", () => {
  // Le score exact (2-0 / 0-2) vit dans data/flashscore/sets/, en orientation
  // Flashscore. Sans `swap`, un consommateur alignerait « 2-0 » sur notre team1
  // alors qu'il décrit le home Flashscore : c'est notre team2 quand swap=true.
  const direct = joinFlashscore([fsFile([fsMatch()])], [bwfRow()]);
  assert.equal(direct.joined.get("5001|MS|2026-01-07|111|222").swap, false);

  const inverse = joinFlashscore([fsFile([fsMatch()])], [bwfRow({
    name1: "NG Ka Long Angus", name2: "LU Guang Zu",
    sets: [{ home: 19, away: 21 }, { home: 15, away: 21 }],
    a: "222", b: "111",
  })]);
  assert.equal(inverse.joined.get("5001|MS|2026-01-07|222|111").swap, true);
});

test("deux candidats au même score le même jour -> ambigu, pas de jointure", () => {
  // Même empreinte, même jour, et les deux passent le filtre des noms (les
  // deux affiches partagent le nom « Lu ») : on doit refuser de choisir.
  const rows = [
    bwfRow(),
    bwfRow({ name1: "LU Ming", name2: "NG Tze Yong", a: "333", b: "444" }),
  ];
  const { stats } = joinFlashscore([fsFile([fsMatch()])], rows);
  assert.equal(stats.joined, 0);
  assert.equal(stats.ambiguous, 1);
});

test("même score mais noms étrangers -> pas de jointure", () => {
  const bwf = bwfRow({ name1: "Viktor AXELSEN", name2: "Kean Yew LOH" });
  const { stats } = joinFlashscore([fsFile([fsMatch()])], [bwf]);
  assert.equal(stats.joined, 0);
  assert.equal(stats.unmatched, 1);
});

test("plus d'un jour d'écart -> pas de jointure (la fenêtre ±1 couvre les fuseaux)", () => {
  const { stats: ok } = joinFlashscore([fsFile([fsMatch()])], [bwfRow({ day: "2026-01-08" })]);
  assert.equal(ok.joined, 1, "±1 jour doit passer (heure locale vs UTC)");
  const { stats: ko } = joinFlashscore([fsFile([fsMatch()])], [bwfRow({ day: "2026-01-09" })]);
  assert.equal(ko.joined, 0);
  assert.equal(ko.unmatched, 1);
});

test("paires : un nom de famille partagé par côté suffit (noms abrégés)", () => {
  const fs = fsMatch({
    disc: "MD",
    home: { name: "Carnando L. R./Marthin D." },
    away: { name: "Chia A./Tai A." },
  });
  const bwf = bwfRow({
    disc: "MD",
    name1: "Leo Rolly CARNANDO / Daniel MARTHIN",
    name2: "Aaron CHIA / Aaron TAI",
    a: "pair:1-2", b: "pair:3-4",
  });
  const { joined, stats } = joinFlashscore([fsFile([fs])], [bwf]);
  assert.equal(stats.joined, 1);
  assert.ok(joined.has("5001|MD|2026-01-07|pair:1-2|pair:3-4"));
});

test("un bookmaker sans clôture complète est écarté ; sans aucun -> non joint", () => {
  const fs = fsMatch({
    odds: {
      betclic: { home: { opening: 1.5, closing: null }, away: { opening: 2.6, closing: 2.7 } },
      winamax: { home: { opening: 1.48, closing: 1.42 }, away: { opening: 2.7, closing: 2.8 } },
    },
  });
  const { joined } = joinFlashscore([fsFile([fs])], [bwfRow()]);
  const odds = joined.get("5001|MS|2026-01-07|111|222");
  assert.ok(odds && !odds.books.betclic && odds.books.winamax, "betclic incomplet écarté, winamax gardé");

  const fsVide = fsMatch({ odds: { betclic: { home: { opening: 1.5, closing: null }, away: { opening: 2.6, closing: 2.7 } } } });
  const { stats } = joinFlashscore([fsFile([fsVide])], [bwfRow()]);
  assert.equal(stats.joined, 0);
  assert.equal(stats.unmatched, 1);
});

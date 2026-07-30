// Tests de la construction des séries de classement mondial.
//   node --test test/
//
// Fonctions pures : les publications sont fabriquées à la main.

import { test } from "node:test";
import assert from "node:assert/strict";
import { entityKeyOf, buildWorldMap, buildPlayerRankHistory } from "../lib/rank-history.mjs";

const L = (rank, points, players, extra = {}) => ({
  rank, rankPrevious: rank, rankChange: 0, points, tournaments: 10, players, ...extra,
});
const J = (id, name = `J${id}`) => ({ id: String(id), slug: `j-${id}`, name, country: "France" });

const PUB = (date, disciplines) => ({ publicationId: 1000, date, week: 1, year: 2025, disciplines });

// --- Clés d'entité --------------------------------------------------------

test("entityKeyOf produit p:<id> en simple", () => {
  assert.equal(entityKeyOf([J(64032)]), "p:64032");
});

test("entityKeyOf produit pair:<ids triés> en double, quel que soit l'ordre", () => {
  assert.equal(entityKeyOf([J(222), J(111)]), "pair:111-222");
  assert.equal(entityKeyOf([J(111), J(222)]), "pair:111-222");
});

test("entityKeyOf trie les ids comme des chaînes, comme build-data.mjs", () => {
  // Cohérence indispensable : build-data fait players.map(String).sort()
  assert.equal(entityKeyOf([J(9), J(10)]), "pair:10-9");
});

// --- Carte du classement courant -----------------------------------------

test("buildWorldMap indexe par clé d'entité et par discipline", () => {
  const pub = PUB("2025-06-10", {
    MS: [L(1, 97179, [J(64032)]), L(2, 90000, [J(57945)])],
    MD: [L(1, 84210, [J(111), J(222)])],
  });
  const wm = buildWorldMap(pub);
  assert.equal(wm.MS.get("p:64032").rank, 1);
  assert.equal(wm.MS.get("p:64032").points, 97179);
  assert.equal(wm.MS.get("p:57945").rank, 2);
  assert.equal(wm.MD.get("pair:111-222").rank, 1);
  assert.equal(wm.MS.get("p:999"), undefined);
});

test("buildWorldMap tolère une publication sans disciplines", () => {
  assert.deepEqual(buildWorldMap({ date: "2025-06-10" }), {});
});

// --- Série par joueur ----------------------------------------------------

test("buildPlayerRankHistory produit une entrée par semaine et par discipline", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", { MS: [L(12, 54320, [J(1)])] }),
    PUB("2025-06-17", { MS: [L(11, 55100, [J(1)])] }),
  ]);
  assert.deepEqual(h["1"], [
    { t: "2025-06-10", disc: "MS", rank: 12, points: 54320, key: "p:1" },
    { t: "2025-06-17", disc: "MS", rank: 11, points: 55100, key: "p:1" },
  ]);
});

test("buildPlayerRankHistory rattache les deux joueurs d'une paire", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", { MD: [L(3, 84210, [J(111), J(222)])] }),
  ]);
  assert.equal(h["111"][0].rank, 3);
  assert.equal(h["222"][0].rank, 3);
  assert.equal(h["111"][0].key, "pair:111-222");
  assert.equal(h["111"][0].disc, "MD");
});

test("buildPlayerRankHistory sépare les disciplines d'un même joueur", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", {
      MD: [L(3, 84210, [J(111), J(222)])],
      XD: [L(8, 61000, [J(111), J(333)])],
    }),
  ]);
  const discs = h["111"].map((p) => p.disc).sort();
  assert.deepEqual(discs, ["MD", "XD"]);
  assert.equal(h["111"].find((p) => p.disc === "XD").rank, 8);
});

test("buildPlayerRankHistory garde le meilleur rang si un joueur a deux paires la même semaine", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", {
      MD: [L(3, 84210, [J(111), J(222)]), L(40, 20000, [J(111), J(444)])],
    }),
  ]);
  assert.equal(h["111"].length, 1, "une seule entrée par (semaine, discipline)");
  assert.equal(h["111"][0].rank, 3, "le meilleur rang gagne");
  assert.equal(h["111"][0].key, "pair:111-222");
  assert.equal(h["222"][0].rank, 3);
  assert.equal(h["444"][0].rank, 40, "le partenaire de l'autre paire garde SON rang");
});

test("buildPlayerRankHistory laisse un TROU quand le joueur sort du top", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", { MS: [L(240, 9000, [J(1)])] }),
    PUB("2025-06-17", { MS: [] }),                       // sorti du top 250
    PUB("2025-06-24", { MS: [L(238, 9500, [J(1)])] }),
  ]);
  assert.equal(h["1"].length, 2, "aucune entrée inventée pour la semaine manquante");
  assert.deepEqual(h["1"].map((p) => p.t), ["2025-06-10", "2025-06-24"]);
});

test("buildPlayerRankHistory trie chronologiquement", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-24", { MS: [L(10, 1, [J(1)])] }),
    PUB("2025-06-10", { MS: [L(12, 1, [J(1)])] }),
    PUB("2025-06-17", { MS: [L(11, 1, [J(1)])] }),
  ]);
  assert.deepEqual(h["1"].map((p) => p.t), ["2025-06-10", "2025-06-17", "2025-06-24"]);
});

test("buildPlayerRankHistory renvoie un objet vide sans publication", () => {
  assert.deepEqual(buildPlayerRankHistory([]), {});
});

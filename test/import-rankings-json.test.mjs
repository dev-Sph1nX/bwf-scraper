// Mapping du JSON de classements 2022/2023 vers le format du store
// (data/rankings/YYYY-MM-DD.json), tel que le lisent lib/rank-history.mjs et
// build-data.mjs.
//
// Le point sensible est la CLÉ D'ENTITÉ : `buildWorldMap` indexe chaque ligne
// par `entityKeyOf(row.players)`. Un `players` mal formé ne provoque aucune
// erreur — il produit silencieusement une clé qui ne rejoindra jamais l'Elo.
// D'où les assertions sur la clé, pas seulement sur la forme.

import test from "node:test";
import assert from "node:assert/strict";
import { publicationFromWeek, rowsFromEntries } from "../tools/import-rankings-json.mjs";
import { entityKeyOf, buildWorldMap, buildPlayerRankHistory } from "../lib/rank-history.mjs";

const META = { year: 2022, rankId: 2, depth: 250, fetchedAt: "2026-08-20T00:00:00.000Z", source: "json-2022-2023" };

// Une semaine réduite : un simple, un double, un mixte. Champs exactement ceux
// du fichier source (vérifiés sur bwf_rankings_2022.json).
const SEMAINE = {
  week: 1,
  date: "2022-01-04",
  categories: {
    MS: [
      { rank: 1, bwf_id: "25831", last_name: "AXELSEN", first_name: "Viktor", country: "DEN", points: 116779, tournaments: 32 },
      { rank: 2, bwf_id: "89785", last_name: "MOMOTA", first_name: "Kento", country: "JPN", points: 112210, tournaments: 22 },
    ],
    MD: [
      {
        rank: 1,
        p1_bwf_id: "26394", p1_last_name: "GIDEON", p1_first_name: "Marcus Fernaldi", p1_country: "INA",
        p2_bwf_id: "80057", p2_last_name: "SUKAMULJO", p2_first_name: "Kevin Sanjaya", p2_country: "INA",
        points: 111827, tournaments: 29,
      },
    ],
    XD: [
      {
        rank: 1,
        p1_bwf_id: "61731", p1_last_name: "PUAVARANUKROH", p1_first_name: "Dechapol", p1_country: "THA",
        p2_bwf_id: "67158", p2_last_name: "TAERATTANACHAI", p2_first_name: "Sapsiree", p2_country: "THA",
        points: 115400, tournaments: 30,
      },
    ],
  },
};

test("un simple donne UNE entrée players, nom au format « Prénom NOM »", () => {
  const rows = rowsFromEntries("MS", SEMAINE.categories.MS);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    rank: 1,
    rankPrevious: null,
    rankChange: null,
    points: 116779,
    tournaments: 32,
    players: [{ id: "25831", slug: null, name: "Viktor AXELSEN", country: "DEN" }],
  });
});

test("un double donne DEUX entrées players, dans l'ordre p1 puis p2", () => {
  const [row] = rowsFromEntries("MD", SEMAINE.categories.MD);
  assert.equal(row.players.length, 2);
  assert.deepEqual(row.players.map((p) => p.id), ["26394", "80057"]);
  assert.deepEqual(row.players.map((p) => p.name), ["Marcus Fernaldi GIDEON", "Kevin Sanjaya SUKAMULJO"]);
  assert.deepEqual(row.players.map((p) => p.country), ["INA", "INA"]);
});

test("rankPrevious et rankChange sont null : la source ne les porte pas", () => {
  // Les inventer (0, ou le rang courant) ferait mentir les flèches de variation
  // de l'app sur deux saisons entières.
  const toutes = ["MS", "MD", "XD"].flatMap((d) => rowsFromEntries(d, SEMAINE.categories[d]));
  for (const r of toutes) {
    assert.equal(r.rankPrevious, null);
    assert.equal(r.rankChange, null);
  }
});

test("la publication porte l'identité et la provenance attendues", () => {
  const pub = publicationFromWeek(SEMAINE, META);
  assert.equal(pub.publicationId, null, "aucun publicationId BWF : la source n'en a pas");
  assert.equal(pub.date, "2022-01-04");
  assert.equal(pub.week, 1);
  assert.equal(pub.year, 2022);
  assert.equal(pub.rankId, 2);
  assert.equal(pub.depth, 250);
  assert.equal(pub.source, "json-2022-2023");
  assert.deepEqual(Object.keys(pub.disciplines).sort(), ["MD", "MS", "XD"]);
});

test("la clé d'entité produite est celle qu'attend l'Elo", () => {
  const pub = publicationFromWeek(SEMAINE, META);
  const monde = buildWorldMap(pub);
  assert.deepEqual(monde.MS.get("p:25831"), { rank: 1, points: 116779 });
  // Clé de paire : identifiants TRIÉS, donc "26394-80057" et non l'ordre p1/p2.
  assert.deepEqual(monde.MD.get("pair:26394-80057"), { rank: 1, points: 111827 });
  assert.equal(entityKeyOf(pub.disciplines.XD[0].players), "pair:61731-67158");
});

test("la même clé qu'une publication déjà en store : le joueur se rejoint", () => {
  // Axelsen est `p:25831` dans data/rankings/2024-01-02.json (source csv). Si
  // l'import produisait une autre clé, l'historique 2022 resterait orphelin de
  // celui de 2024 sans qu'aucun test ni build ne le signale.
  const pub = publicationFromWeek(SEMAINE, META);
  const dejaEnStore = {
    rank: 1, rankPrevious: null, rankChange: null, points: 105655, tournaments: 16,
    players: [{ id: "25831", slug: null, name: "Viktor AXELSEN", country: "DEN" }],
  };
  assert.equal(entityKeyOf(pub.disciplines.MS[0].players), entityKeyOf(dejaEnStore.players));
});

test("buildPlayerRankHistory chaîne l'import et le store existant", () => {
  const importee = publicationFromWeek(SEMAINE, META);
  const enStore = {
    publicationId: null, date: "2024-01-02", week: 1, year: 2024, rankId: 2, depth: 250, source: "csv",
    disciplines: {
      MS: [{
        rank: 1, rankPrevious: null, rankChange: null, points: 105655, tournaments: 16,
        players: [{ id: "25831", slug: null, name: "Viktor AXELSEN", country: "DEN" }],
      }],
    },
  };
  const hist = buildPlayerRankHistory([importee, enStore]);
  const axelsen = hist["25831"];
  assert.equal(axelsen.length, 2, "une entrée par semaine, sans doublon ni trou inventé");
  assert.deepEqual(axelsen.map((e) => e.t), ["2022-01-04", "2024-01-02"]);
});

test("un pays ou prénom vide ne fabrique pas d'espace parasite dans le nom", () => {
  // Aucune occurrence dans les deux fichiers sources (vérifié), mais un nom
  // « " AXELSEN" » casserait silencieusement l'affichage.
  const rows = rowsFromEntries("WS", [
    { rank: 9, bwf_id: "1", last_name: "TAI", first_name: "", country: "TPE", points: 10, tournaments: 1 },
  ]);
  assert.equal(rows[0].players[0].name, "TAI");
});

// Amorçage de l'Elo : conversion d'une publication du classement mondial en
// { discipline -> Map(clé d'entité -> rang) }, consommée par build-data.mjs et
// backtest.mjs via `seedEloByRank`.
//
// L'enjeu est la CLÉ. Si elle diverge de celle de l'Elo, l'amorçage ne
// s'applique à personne : tout le monde démarre à `seedBottom` et rien ne
// signale l'erreur — le build reste vert, seuls les Elo de 2022 sont faux.
// D'où l'assertion croisée avec `entityKeyOf`.

import test from "node:test";
import assert from "node:assert/strict";
import { initialRanksFromPublication } from "../lib/seeds.mjs";
import { entityKeyOf } from "../lib/rank-history.mjs";
import { seedEloByRank, PARAMS } from "../lib/elo.mjs";

const joueur = (id) => ({ id, slug: null, name: `J${id}`, country: "FRA" });
const ligne = (rank, ids) => ({ rank, rankPrevious: null, rankChange: null, points: 1000 - rank, tournaments: 10, players: ids.map(joueur) });

const PUB = {
  publicationId: null,
  date: "2022-01-04",
  week: 1,
  year: 2022,
  disciplines: {
    MS: [ligne(1, ["25831"]), ligne(2, ["89785"]), ligne(61, ["11111"])],
    // Ordre p1/p2 inversé par rapport au tri : la clé doit rester la même.
    MD: [ligne(1, ["80057", "26394"])],
    WD: [],
  },
};

test("un simple donne p:<id> -> rang", () => {
  const init = initialRanksFromPublication(PUB);
  assert.equal(init.MS.get("p:25831"), 1);
  assert.equal(init.MS.get("p:89785"), 2);
});

test("un double donne pair:<ids triés> -> rang, quel que soit l'ordre source", () => {
  const init = initialRanksFromPublication(PUB);
  assert.equal(init.MD.get("pair:26394-80057"), 1);
  assert.equal(init.MD.get("pair:80057-26394"), undefined, "l'ordre source ne doit pas fuiter dans la clé");
});

test("la clé est exactement celle de l'Elo (entityKeyOf)", () => {
  const init = initialRanksFromPublication(PUB);
  for (const [disc, rows] of Object.entries(PUB.disciplines)) {
    for (const row of rows) {
      assert.equal(init[disc].get(entityKeyOf(row.players)), row.rank, `${disc} rang ${row.rank}`);
    }
  }
});

test("les rangs au-delà de seedTopN sont conservés tels quels", () => {
  // Le plafonnement est la responsabilité de `seedEloByRank`, pas celle de
  // l'amorçage : ce module ne doit rien filtrer, sinon on ne pourrait plus
  // monter `seedTopN` sans le retoucher.
  const init = initialRanksFromPublication(PUB);
  assert.equal(init.MS.get("p:11111"), 61);
  assert.ok(61 > PARAMS.seedTopN);
  assert.equal(seedEloByRank(init.MS.get("p:11111")), PARAMS.seedBottom);
});

test("une discipline vide donne une Map vide, pas une absence", () => {
  const init = initialRanksFromPublication(PUB);
  assert.ok(init.WD instanceof Map);
  assert.equal(init.WD.size, 0);
});

test("une publication absente ou sans disciplines ne jette pas", () => {
  assert.deepEqual(initialRanksFromPublication(null), {});
  assert.deepEqual(initialRanksFromPublication({}), {});
  assert.deepEqual(initialRanksFromPublication({ disciplines: {} }), {});
});

test("une ligne sans joueurs est ignorée, pas transformée en clé vide", () => {
  const init = initialRanksFromPublication({
    disciplines: { MS: [{ rank: 1, players: [] }, ligne(2, ["42"])] },
  });
  assert.equal(init.MS.size, 1);
  assert.equal(init.MS.get("p:42"), 2);
});

test("à rang égal sur deux entités, chacune garde son amorçage", () => {
  // Les ex aequo existent réellement dans les publications BWF (deux entités au
  // rang 250). Aucune ne doit écraser l'autre.
  const init = initialRanksFromPublication({
    disciplines: { WS: [ligne(7, ["1"]), ligne(7, ["2"])] },
  });
  assert.equal(init.WS.size, 2);
  assert.equal(init.WS.get("p:1"), 7);
  assert.equal(init.WS.get("p:2"), 7);
});

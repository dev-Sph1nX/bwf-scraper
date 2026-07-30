// Tests du parsing des réponses vue-rankingtable.
//   node --test test/
//
// Le client est simulé : aucune requête réseau. La forme des réponses vient
// d'un vrai appel à l'API (sondes du 2026-07-30).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normRow, fetchTable, fetchPublication, probeTotal, currentPublicationId,
  WR_CAT, DEFAULT_DEPTH,
} from "../lib/rankings.mjs";

// Ligne simple telle que renvoyée par l'API (champs non utilisés omis).
const ligneSimple = {
  ranking_publication_id: 3821,
  rank: 1, rank_previous: 2, rank_change: 1,
  points: "97179.0000", tournaments: 18,
  player1_id: 64032, player2_id: null,
  player1_model: { slug: "kunlavut-vitidsarn", name_display_bold: "<b>Kunlavut</b> VITIDSARN" },
  p1_country_model: { name: "Thailand" },
};

const ligneDouble = {
  rank: 3, rank_previous: 3, rank_change: 0,
  points: "84210.5000", tournaments: 15,
  player1_id: 111, player2_id: 222,
  player1_model: { slug: "a-un", name_display_bold: "<b>A</b> UN" },
  player2_model: { slug: "b-deux", name_display_bold: "<b>B</b> DEUX" },
  p1_country_model: { name: "Malaysia" },
  p2_country_model: { name: "Malaysia" },
};

/**
 * Faux client. `pages` est une fonction (params) -> réponse API.
 * Enregistre les URLs demandées dans `client.urls`.
 */
const fauxClient = (repondre) => {
  const urls = [];
  return {
    urls,
    async getJson(url) {
      urls.push(url);
      return repondre(new URL(url).searchParams);
    },
  };
};

const reponse = (rows, { total = rows.length, perPage = 250, lastPage = 1 } = {}) => ({
  results: { data: rows, total, per_page: perPage, last_page: lastPage, current_page: 1 },
  drawCount: 1,
});

// --- normRow --------------------------------------------------------------

test("normRow convertit les points en nombre", () => {
  assert.equal(normRow(ligneSimple).points, 97179);
  assert.equal(typeof normRow(ligneSimple).points, "number");
  assert.equal(normRow(ligneDouble).points, 84210.5);
});

test("normRow conserve rankPrevious et rankChange", () => {
  const r = normRow(ligneSimple);
  assert.equal(r.rank, 1);
  assert.equal(r.rankPrevious, 2);
  assert.equal(r.rankChange, 1);
});

test("normRow retire les balises HTML des noms", () => {
  assert.equal(normRow(ligneSimple).players[0].name, "Kunlavut VITIDSARN");
});

test("normRow rend un seul joueur en simple, deux en double", () => {
  assert.equal(normRow(ligneSimple).players.length, 1);
  const d = normRow(ligneDouble);
  assert.equal(d.players.length, 2);
  assert.deepEqual(d.players.map((p) => p.id), ["111", "222"]);
  assert.equal(d.players[1].country, "Malaysia");
});

test("normRow rend les ids en chaîne (espace d'ids partagé avec les draws)", () => {
  assert.equal(normRow(ligneSimple).players[0].id, "64032");
  assert.equal(typeof normRow(ligneSimple).players[0].id, "string");
});

test("normRow tolère l'absence de pays ou de slug", () => {
  const r = normRow({ rank: 9, points: "1.0", player1_id: 7, player1_model: {}, });
  assert.equal(r.players[0].country, null);
  assert.equal(r.players[0].slug, null);
});

// --- fetchTable -----------------------------------------------------------

test("fetchTable demande la profondeur voulue en une requête si l'API l'honore", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ ...ligneSimple, rank: i + 1 }));
  const client = fauxClient(() => reponse(rows, { total: 1898, perPage: 250 }));
  const out = await fetchTable(client, { catId: 6, doubles: false, publicationId: 3821, depth: 250 });
  assert.equal(out.length, 250);
  assert.equal(client.urls.length, 1, "une seule requête suffit");
  assert.match(client.urls[0], /pageKey=250/);
  assert.match(client.urls[0], /publicationId=3821/);
  assert.match(client.urls[0], /catId=6/);
  assert.match(client.urls[0], /doubles=false/);
});

test("fetchTable repagine si l'API plafonne per_page à 100", async () => {
  const client = fauxClient((params) => {
    const page = Number(params.get("page"));
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...ligneSimple, rank: (page - 1) * 100 + i + 1 }));
    return reponse(rows, { total: 1898, perPage: 100, lastPage: 19 });
  });
  const out = await fetchTable(client, { catId: 6, doubles: false, publicationId: 3821, depth: 250 });
  assert.equal(out.length, 250, "tronqué à la profondeur demandée");
  assert.equal(client.urls.length, 3, "3 pages de 100 pour atteindre 250");
  assert.equal(out[0].rank, 1);
  assert.equal(out[249].rank, 250);
});

test("fetchTable s'arrête au total quand la discipline compte moins que la profondeur", async () => {
  const rows = Array.from({ length: 42 }, (_, i) => ({ ...ligneSimple, rank: i + 1 }));
  const client = fauxClient(() => reponse(rows, { total: 42, perPage: 250 }));
  const out = await fetchTable(client, { catId: 10, doubles: true, publicationId: 3821, depth: 250 });
  assert.equal(out.length, 42);
  assert.equal(client.urls.length, 1, "ne doit pas boucler sur une page vide");
});

test("fetchTable renvoie un tableau vide pour une publication inexistante", async () => {
  const client = fauxClient(() => reponse([], { total: 0 }));
  const out = await fetchTable(client, { catId: 6, doubles: false, publicationId: 3849, depth: 250 });
  assert.deepEqual(out, []);
});

test("fetchTable marque doubles=true pour les disciplines de double", async () => {
  const client = fauxClient(() => reponse([ligneDouble], { total: 1 }));
  await fetchTable(client, { catId: 8, doubles: true, publicationId: 3821, depth: 250 });
  assert.match(client.urls[0], /doubles=true/);
});

// --- fetchPublication -----------------------------------------------------

test("fetchPublication récupère les 5 disciplines et rend les métadonnées", async () => {
  const client = fauxClient((params) => {
    const doubles = params.get("doubles") === "true";
    return reponse([doubles ? ligneDouble : ligneSimple], { total: 1 });
  });
  const vues = [];
  const pub = await fetchPublication(client, {
    publicationId: 3821, depth: 250, onProgress: (c, n) => vues.push([c, n]),
  });
  assert.equal(pub.publicationId, 3821);
  assert.equal(pub.rankId, 2);
  assert.equal(pub.depth, 250);
  assert.ok(pub.fetchedAt, "fetchedAt renseigné");
  assert.deepEqual(Object.keys(pub.disciplines), ["MS", "WS", "MD", "WD", "XD"]);
  assert.equal(pub.disciplines.MD[0].players.length, 2, "MD est bien traité en double");
  assert.equal(pub.disciplines.MS[0].players.length, 1);
  assert.equal(vues.length, 5, "onProgress appelé une fois par discipline");
});

test("fetchPublication utilise la profondeur par défaut de 250", async () => {
  assert.equal(DEFAULT_DEPTH, 250);
  const client = fauxClient(() => reponse([ligneSimple], { total: 1 }));
  const pub = await fetchPublication(client, { publicationId: 3821 });
  assert.equal(pub.depth, 250);
});

test("les catId des disciplines sont ceux du classement mondial (rankId=2)", () => {
  assert.deepEqual(WR_CAT, { MS: 6, WS: 7, MD: 8, WD: 9, XD: 10 });
});

// --- Sondes ---------------------------------------------------------------

test("probeTotal ne demande qu'une ligne et renvoie le total", async () => {
  const client = fauxClient(() => reponse([ligneSimple], { total: 1898 }));
  assert.equal(await probeTotal(client, 3821), 1898);
  assert.match(client.urls[0], /pageKey=1/);
});

test("probeTotal renvoie 0 pour une publication vide", async () => {
  const client = fauxClient(() => reponse([], { total: 0 }));
  assert.equal(await probeTotal(client, 3849), 0);
});

test("currentPublicationId lit l'id réel derrière publicationId=0", async () => {
  const client = fauxClient(() => reponse([{ ...ligneSimple, ranking_publication_id: 4402 }], { total: 2117 }));
  assert.equal(await currentPublicationId(client), 4402);
  assert.match(client.urls[0], /publicationId=0/);
});

test("currentPublicationId renvoie null si la réponse est vide", async () => {
  const client = fauxClient(() => reponse([], { total: 0 }));
  assert.equal(await currentPublicationId(client), null);
});

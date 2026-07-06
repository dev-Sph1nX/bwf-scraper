// lib/rankings.mjs
// Récupère le CLASSEMENT MONDIAL officiel BWF (World Rankings) par discipline,
// via le même BwfClient (Playwright) que le reste du scraper.
//
// Endpoint : GET /api/vue-rankingtable?rankId=2&catId=<X>&publicationId=0&doubles=<bool>&pageKey=100&page=<n>&drawCount=1
//   rankId=2  -> World Rankings (classement mondial officiel, à comparer à l'Elo)
//   catId     -> discipline (mapping propre à rankId=2)
//   doubles   -> false pour MS/WS, true pour MD/WD/XD
//   publicationId=0 -> dernière semaine publiée
//
// Les ids joueurs (player1_id/player2_id) sont dans le MÊME espace que nos ids
// de draws (donc que les clés Elo), ce qui permet un matching direct.

import { BwfClient } from "./client.mjs";

const BASE = "https://extranet-lv.bwfbadminton.com/api";
const WR_CAT = { MS: 6, WS: 7, MD: 8, WD: 9, XD: 10 }; // rankId=2
const DOUBLES = new Set(["MD", "WD", "XD"]);
const MAX_PAGES = 30; // garde-fou (100/page => jusqu'à 3000 entités/discipline)

const stripTags = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function normRow(r) {
  const players = [];
  if (r.player1_id) players.push({
    id: String(r.player1_id), slug: r.player1_model?.slug ?? null,
    name: stripTags(r.player1_model?.name_display_bold) || null,
    country: r.p1_country_model?.name ?? null,
  });
  if (r.player2_id) players.push({
    id: String(r.player2_id), slug: r.player2_model?.slug ?? null,
    name: stripTags(r.player2_model?.name_display_bold) || null,
    country: r.p2_country_model?.name ?? null,
  });
  return {
    rank: r.rank,
    points: Number(r.points),
    tournaments: r.tournaments ?? null,
    players,
  };
}

async function fetchTable(client, catId, doubles) {
  const out = [];
  let page = 1, lastPage = 1;
  do {
    const p = new URLSearchParams({
      rankId: "2", catId: String(catId), publicationId: "0",
      doubles: String(doubles), searchKey: "", pageKey: "100",
      page: String(page), drawCount: "1",
    });
    const json = await client.getJson(`${BASE}/vue-rankingtable?${p}`);
    const res = json.results ?? json.data?.results ?? json;
    const rows = res.data ?? [];
    lastPage = Math.min(res.last_page ?? 1, MAX_PAGES);
    for (const r of rows) out.push(normRow(r));
    page++;
  } while (page <= lastPage);
  return out;
}

/**
 * Récupère le classement mondial des 5 disciplines.
 * @returns {Promise<{rankId:2, fetchedAt:string, disciplines:Record<string,Array>}>}
 */
export async function fetchWorldRankings({ onProgress } = {}) {
  const client = await new BwfClient().start();
  try {
    const disciplines = {};
    for (const [code, catId] of Object.entries(WR_CAT)) {
      disciplines[code] = await fetchTable(client, catId, DOUBLES.has(code));
      onProgress?.(code, disciplines[code].length);
    }
    return { rankId: 2, fetchedAt: new Date().toISOString(), disciplines };
  } finally {
    await client.close();
  }
}

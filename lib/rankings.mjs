// lib/rankings.mjs
// Récupère une PUBLICATION du classement mondial officiel BWF (World Rankings).
//
// Endpoint : GET /api/vue-rankingtable
//   rankId=2        -> World Rankings (classement officiel, à comparer à l'Elo)
//   catId           -> discipline (mapping propre à rankId=2, cf. WR_CAT)
//   doubles         -> false pour MS/WS, true pour MD/WD/XD
//   publicationId   -> 0 = dernière publiée ; sinon une semaine précise
//
// La réponse ne contient AUCUNE date : le seul repère temporel est
// `ranking_publication_id`. La datation est faite par lib/publications.mjs.
//
// Les ids joueurs (player1_id/player2_id) sont dans le MÊME espace que nos ids
// de draws (donc que les clés Elo), ce qui permet un matching direct.

const BASE = "https://extranet-lv.bwfbadminton.com/api";

/** Discipline -> catId, pour rankId=2. */
export const WR_CAT = { MS: 6, WS: 7, MD: 8, WD: 9, XD: 10 };
const DOUBLES = new Set(["MD", "WD", "XD"]);

/** Profondeur retenue par discipline : couvre tous les joueurs du World Tour. */
export const DEFAULT_DEPTH = 250;

const MAX_PAGES = 30; // garde-fou anti-boucle

const stripTags = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function url(params) {
  return `${BASE}/vue-rankingtable?${new URLSearchParams(params)}`;
}

function baseParams({ catId, doubles, publicationId, pageKey, page }) {
  return {
    rankId: "2",
    catId: String(catId),
    publicationId: String(publicationId),
    doubles: String(doubles),
    searchKey: "",
    pageKey: String(pageKey),
    page: String(page),
    drawCount: "1",
  };
}

const unwrap = (json) => json?.results ?? json?.data?.results ?? json ?? {};

/** Normalise une ligne d'API vers notre forme compacte. */
export function normRow(r) {
  const players = [];
  if (r.player1_id) players.push({
    id: String(r.player1_id),
    slug: r.player1_model?.slug ?? null,
    name: stripTags(r.player1_model?.name_display_bold) || null,
    country: r.p1_country_model?.name ?? null,
  });
  if (r.player2_id) players.push({
    id: String(r.player2_id),
    slug: r.player2_model?.slug ?? null,
    name: stripTags(r.player2_model?.name_display_bold) || null,
    country: r.p2_country_model?.name ?? null,
  });
  return {
    rank: r.rank,
    rankPrevious: r.rank_previous ?? null,
    rankChange: r.rank_change ?? null,
    points: Number(r.points),
    tournaments: r.tournaments ?? null,
    players,
  };
}

/**
 * Récupère le top `depth` d'une discipline pour une publication.
 *
 * On demande `pageKey=depth` : si l'API l'honore, une seule requête suffit ; si
 * elle plafonne `per_page` (100 observé), la boucle repagine automatiquement.
 */
export async function fetchTable(client, { catId, doubles, publicationId, depth = DEFAULT_DEPTH }) {
  const out = [];
  let page = 1;
  let total = null;
  let lastPage = 1;

  do {
    const json = await client.getJson(url(baseParams({ catId, doubles, publicationId, pageKey: depth, page })));
    const res = unwrap(json);
    const rows = res.data ?? [];
    if (total == null) total = res.total ?? rows.length;
    lastPage = Math.min(res.last_page ?? 1, MAX_PAGES);

    if (!rows.length) break;
    for (const r of rows) {
      if (out.length >= depth) break;
      out.push(normRow(r));
    }
    page++;
  } while (out.length < Math.min(depth, total) && page <= lastPage);

  return out;
}

/** Récupère les 5 disciplines d'une publication. */
export async function fetchPublication(client, { publicationId, depth = DEFAULT_DEPTH, onProgress } = {}) {
  const disciplines = {};
  for (const [code, catId] of Object.entries(WR_CAT)) {
    disciplines[code] = await fetchTable(client, {
      catId, doubles: DOUBLES.has(code), publicationId, depth,
    });
    onProgress?.(code, disciplines[code].length);
  }
  return {
    publicationId,
    rankId: 2,
    depth,
    fetchedAt: new Date().toISOString(),
    disciplines,
  };
}

/** Nombre de lignes d'une publication (sonde de découverte, 1 ligne demandée). */
export async function probeTotal(client, publicationId) {
  const json = await client.getJson(url(baseParams({
    catId: WR_CAT.MS, doubles: false, publicationId, pageKey: 1, page: 1,
  })));
  return unwrap(json).total ?? 0;
}

/** Id réel de la publication courante, lu dans les lignes de publicationId=0. */
export async function currentPublicationId(client) {
  const json = await client.getJson(url(baseParams({
    catId: WR_CAT.MS, doubles: false, publicationId: 0, pageKey: 1, page: 1,
  })));
  const rows = unwrap(json).data ?? [];
  return rows[0]?.ranking_publication_id ?? null;
}

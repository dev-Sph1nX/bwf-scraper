// lib/api.mjs
// Fonctions métier au-dessus de BwfClient : chaque fonction construit l'URL
// de l'endpoint BWF correspondant et renvoie le JSON typé.
//
// Voir types.ts pour la forme des réponses.

const BASE = "https://extranet-lv.bwfbadminton.com/api";

// Catégories World Tour (Super 1000 -> 300, etc.).
const YEAR_CATEGORIES = ["22", "23", "24", "25", "26"];

/**
 * Calendrier annuel des tournois, groupés par mois.
 * @param {import("./client.mjs").BwfClient} client
 * @param {number|string} year
 * @returns {Promise<import("../types.ts").YearTournamentsResponse>}
 */
export function fetchYear(client, year) {
  const p = new URLSearchParams();
  p.set("year", String(year));
  for (const c of YEAR_CATEGORIES) p.append("category[]", c);
  p.set("state", "all");
  return client.getJson(`${BASE}/vue-grouped-year-tournaments?${p}`);
}

/**
 * Liste des tableaux (disciplines) d'un tournoi.
 * @param {import("./client.mjs").BwfClient} client
 * @param {number|string} tmtId  id numérique du tournoi
 * @returns {Promise<import("../types.ts").TournamentDrawsResponse>}
 */
export function fetchDraws(client, tmtId) {
  const p = new URLSearchParams({ tmtTab: "draw", tmtId: String(tmtId) });
  return client.getJson(`${BASE}/vue-tournament-draws?${p}`);
}

/**
 * Contenu d'un tableau : grille + tous les matchs.
 * @param {import("./client.mjs").BwfClient} client
 * @param {number|string} tmtId
 * @param {number|string} drawId
 * @returns {Promise<import("../types.ts").BwfDrawResponse>}
 */
export function fetchDraw(client, tmtId, drawId) {
  const p = new URLSearchParams({
    tmtTab: "draw",
    tmtId: String(tmtId),
    drawId: String(drawId),
  });
  return client.getJson(`${BASE}/vue-tournament-draw-data?${p}`);
}

/** Toutes les disciplines d'un tournoi (tmtId + liste des tournois de l'année). */
export function flattenTournaments(year) {
  return (year.results ?? []).flatMap((m) => m.tournaments);
}

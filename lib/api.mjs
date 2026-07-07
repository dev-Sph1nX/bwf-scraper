// lib/api.mjs
// Fonctions métier au-dessus de BwfClient : chaque fonction construit l'URL
// de l'endpoint BWF correspondant et renvoie le JSON typé.
//
// Voir types.ts pour la forme des réponses.

const BASE = "https://extranet-lv.bwfbadminton.com/api";

// Catégories BWF suivies (codes `tournament_category_id`) :
//   20 = Grade 1 Individuel  -> Championnats du monde ET Jeux Olympiques
//   22 = World Tour Finals
//   23..26 = World Tour Super 1000 / 750 / 500 / 300
// On reste sur les épreuves INDIVIDUELLES de l'élite : pas d'événements par
// équipes (id 21 : Thomas/Uber/Sudirman — autre modèle de données), pas de
// Super 100 / Junior / Para / International (hors périmètre).
const TRACKED_CATEGORIES = ["20", "22", "23", "24", "25", "26"];

/**
 * Calendrier annuel des tournois, groupés par mois.
 * @param {import("./client.mjs").BwfClient} client
 * @param {number|string} year
 * @returns {Promise<import("../types.ts").YearTournamentsResponse>}
 */
export function fetchYear(client, year) {
  const p = new URLSearchParams();
  p.set("year", String(year));
  for (const c of TRACKED_CATEGORIES) p.append("category[]", c);
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

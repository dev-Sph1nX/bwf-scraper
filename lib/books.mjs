// lib/books.mjs
// Socle commun des scrapers de bookmakers français (Betclic, Unibet, Winamax).
//
// Les trois sites servent leurs cotes badminton en HTTP pur (vérifié le
// 2026-07-31) : pas de navigateur, pas de cookie. On garde un User-Agent de
// navigateur réaliste — un UA nu type "node" est le premier critère de blocage.
//
// LIGNE NORMALISÉE commune aux trois parseurs :
//   { book, bookMatchId, srId, tournament, discipline, p1, p2,
//     odd1, odd2, startUtc, isLive }
// `srId` est l'identifiant Sportradar du match, présent chez les TROIS
// opérateurs (widgets Betclic, stats.id Unibet, matchId Winamax) : il permet de
// joindre les cotes d'un même match entre bookmakers sans aucun rapprochement
// de noms. Le rapprochement flou ne reste nécessaire que vers les matchs BWF.

export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept-Language": "fr-FR,fr;q=0.9",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
};

/** GET texte avec les en-têtes navigateur ; jette si statut non-2xx. */
export async function fetchText(url, extraHeaders = {}) {
  const resp = await fetch(url, { headers: { ...BROWSER_HEADERS, ...extraHeaders }, redirect: "follow" });
  if (!resp.ok) throw new Error(`${url} -> HTTP ${resp.status}`);
  return resp.text();
}

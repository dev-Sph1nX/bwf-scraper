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

// --- Marché « nombre de sets » (prématch) ------------------------------------
//
// EXTENSION OPTIONNELLE de la ligne normalisée : quand l'opérateur cote le
// nombre de sets du match (badminton = best of 3), la ligne gagne un champ
//   sets: { market, odd2, odd3, scores? }
//     market : libellé du marché tel qu'affiché chez l'opérateur ;
//     odd2   : cote « match en 2 sets » ;
//     odd3   : cote « match en 3 sets » ;
//     scores : (repli Betclic) cotes par score exact en sets {"2-0": …, "2-1": …}
//              quand seul le marché « Score final (sets) » est coté.
// Champ ABSENT si le marché n'est pas coté : les lecteurs existants
// (lib/books-history.mjs, build-data.mjs) ne lisent que des champs nommés et
// ignorent celui-ci — les relevés antérieurs restent valides tels quels.
//
// --- Marché « total de points » (prématch) -----------------------------------
//
// DEUXIÈME EXTENSION OPTIONNELLE, même contrat : quand l'opérateur cote le
// total de points du match, la ligne gagne un champ
//   totals: [{n, over, under}]   (trié par barre, cote ≤ 1 -> null)
// Même schéma que Pinnacle (lib/book-pinnacle.mjs), pour comparer les deux.
// Betclic seul le cote côté opérateurs français (depuis déc. 2024). Ce champ
// alimente le guide de pari du site (règle scellée « over sur rel ≤ −2 » du
// bureau d'études bwf-playground, dossier regle-rel-moins-2/).

/**
 * Déduit {odd2, odd3} d'issues étiquetées. Comprend les deux formes vues chez
 * les opérateurs : « 2 » / « 3 » (nombre exact) et « Plus/Moins de 2,5 »
 * (over/under, équivalent strict en best of 3). Cote ≤ 1 neutralisée, comme
 * partout ailleurs.
 * @param {Array<{label: string, odd: number}>} outcomes
 * @returns {{odd2: number|null, odd3: number|null}|null} null si rien de lisible
 */
export function setsFromOutcomes(outcomes) {
  let odd2 = null, odd3 = null;
  for (const { label, odd } of outcomes || []) {
    if (!(Number.isFinite(odd) && odd > 1)) continue;
    const l = String(label || "").trim().toLowerCase();
    if (/^2(\s*(sets?|manches?))?$/.test(l) || /^moins de 2[,.]5$/.test(l)) odd2 = odd;
    else if (/^3(\s*(sets?|manches?))?$/.test(l) || /^plus de 2[,.]5$/.test(l)) odd3 = odd;
  }
  return odd2 != null || odd3 != null ? { odd2, odd3 } : null;
}

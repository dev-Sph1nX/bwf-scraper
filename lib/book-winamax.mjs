// lib/book-winamax.mjs
// Cotes badminton Winamax, lues dans le PRELOADED_STATE embarqué du HTML.
//
// GET https://www.winamax.fr/paris-sportifs/sports/31 (31 = badminton) sert un
// HTML contenant `PRELOADED_STATE = {...}` : matchs, marchés, cotes, issues,
// tournois — tout le nécessaire, sans exécuter de JavaScript. Aucune API JSON
// publique n'existe ; le temps réel passe par socket.io, inutile en prématch.
//
// La page /sports/31 contient TOUS les matchs badminton cotés (vérifié contre
// les pages tournoi), et fournit son propre témoin : sports["31"].mainMatchCount.
// On expose donc `complete` pour détecter un futur changement de comportement.
//
// PIÈGE : l'objet fait ~200 Ko avec des accolades imbriquées — une regex
// non-gourmande s'arrête trop tôt. On balaie à accolades équilibrées.

import { fetchText, setsFromOutcomes } from "./books.mjs";

const PAGE_URL = "https://www.winamax.fr/paris-sportifs/sports/31";
const SPORT_BADMINTON = 31;
const MATCH_URL = (id) => `https://www.winamax.fr/paris-sportifs/match/${id}`;

/** Extrait l'objet PRELOADED_STATE du HTML (balayage à accolades équilibrées). */
export function extractPreloadedState(html) {
  const s = String(html);
  const at = s.indexOf("PRELOADED_STATE");
  if (at < 0) throw new Error("Winamax : PRELOADED_STATE introuvable dans la page");
  const start = s.indexOf("{", at);
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error("Winamax : PRELOADED_STATE tronqué (accolades non refermées)");
}

// "Simples Hommes" / "Doubles Femmes"… -> discipline BWF.
const TOURNAMENT_RULES = [
  [/^doubles?\s+mixtes?/i, "XD"],
  [/^doubles?\s+hommes/i, "MD"],
  [/^doubles?\s+(femmes|dames)/i, "WD"],
  [/^simples?\s+hommes/i, "MS"],
  [/^simples?\s+(femmes|dames)/i, "WS"],
];

function disciplineOf(tournamentName) {
  for (const [re, code] of TOURNAMENT_RULES) if (re.test(tournamentName || "")) return code;
  return null;
}

/**
 * Transforme le PRELOADED_STATE en lignes normalisées.
 * Chaîne suivie : match.mainBetId -> bets[id].outcomes[] -> odds/outcomes[oid].
 * @returns {{rows: object[], expectedCount: number|null, complete: boolean|null}}
 */
export function parseWinamaxState(state) {
  const { matches = {}, bets = {}, odds = {}, outcomes = {}, tournaments = {}, categories = {} } = state || {};
  const rows = [];
  let seen = 0;
  for (const [id, m] of Object.entries(matches)) {
    if (m?.sportId !== SPORT_BADMINTON) continue;
    seen++;
    const bet = bets[String(m.mainBetId)];
    if (!bet || !Array.isArray(bet.outcomes) || bet.outcomes.length !== 2) continue;
    // PIÈGE (vu en live) : pendant un match, mainBetId peut pointer un marché
    // de set (« 2e set - Vainqueur »). On n'accepte que le vainqueur du MATCH
    // (marketId 186), sinon on enregistrerait des cotes fausses.
    if (bet.marketId !== 186 && bet.betTitle !== "Vainqueur") continue;
    const [o1, o2] = bet.outcomes.map(String);
    const tournamentName = tournaments[String(m.tournamentId)]?.tournamentName || "";
    const odd = (oid) => (Number.isFinite(odds[oid]) && odds[oid] > 1 ? odds[oid] : null);
    rows.push({
      book: "winamax",
      bookMatchId: String(id),
      // L'id de match Winamax EST l'id Sportradar (recoupé avec Betclic/Unibet).
      srId: String(id),
      tournament: categories[String(m.categoryId)]?.categoryName || tournamentName || null,
      discipline: disciplineOf(tournamentName),
      // Noms complets (les labels d'issue sont abrégés : "J. Hoh").
      p1: m.competitor1Name || outcomes[o1]?.label || null,
      p2: m.competitor2Name || outcomes[o2]?.label || null,
      odd1: odd(o1),
      odd2: odd(o2),
      startUtc: m.matchStart ? new Date(m.matchStart * 1000).toISOString() : null,
      isLive: m.status === "LIVE",
    });
  }
  const expectedCount = state?.sports?.[String(SPORT_BADMINTON)]?.mainMatchCount ?? null;
  return {
    rows,
    expectedCount,
    // La couverture se juge sur les matchs VUS : un match sans marché
    // « Vainqueur » ouvert (suspendu, quasi fini) est normal et ne signale
    // pas un défaut de scrape.
    complete: expectedCount == null ? null : seen >= expectedCount,
  };
}

/** Récupère toutes les cotes badminton Winamax. */
export async function fetchWinamax() {
  const { rows, complete } = parseWinamaxState(extractPreloadedState(await fetchText(PAGE_URL)));
  return { rows, complete: complete !== false };
}

// --- Marché « nombre de sets » ------------------------------------------------
//
// La page SPORT ne porte QUE le marché principal (1 bet par match, marketId
// 186 « Vainqueur » — vérifié le 2026-08-10 sur le tennis : 25 bets pour 27
// matchs). Le marché des sets vit sur la page MATCH
// (/paris-sportifs/match/<id>), dont le PRELOADED_STATE liste TOUS les bets du
// match. Deux formes y coexistent (relevé tennis 2026-08-10) :
//   - marketId 196 « Nombre exact de sets », issues « 2 » / « 3 » (préférée) ;
//   - marketId 314 « Nombre de sets », issues « Plus/Moins de 2,5 »
//     (équivalent strict en best of 3).

const MARKET_EXACT_SETS = 196;
const MARKET_OVER_UNDER_SETS = 314;

/**
 * Extrait le marché « nombre de sets » d'un PRELOADED_STATE de page match.
 * @returns {{market: string, odd2: number|null, odd3: number|null}|null}
 */
export function parseWinamaxMatchSets(state, matchId) {
  const bets = Object.values(state?.bets || {}).filter(
    (b) => String(b?.matchId) === String(matchId),
  );
  const outcomesOf = (bet) => (bet.outcomes || []).map((oid) => ({
    label: state?.outcomes?.[String(oid)]?.label,
    odd: state?.odds?.[String(oid)],
  }));
  const candidates = [
    // nombre EXACT de sets d'abord : issues « 2 »/« 3 », sans ambiguïté
    (b) => b.marketId === MARKET_EXACT_SETS || /^nombre exact de (sets|manches)/i.test(b.betTitle || ""),
    // sinon l'over/under 2,5 (une seule ligne possible en best of 3)
    (b) => (b.marketId === MARKET_OVER_UNDER_SETS || /^nombre de (sets|manches)/i.test(b.betTitle || ""))
      && (!b.specialBetValue || /total=2\.5/.test(String(b.specialBetValue))),
  ];
  for (const pick of candidates) {
    const bet = bets.find(pick);
    if (!bet) continue;
    const sets = setsFromOutcomes(outcomesOf(bet));
    if (sets) return { market: bet.betTitle || "Nombre de sets", ...sets };
  }
  return null;
}

/**
 * Complète les lignes prématch avec le marché « nombre de sets » (champ
 * `sets`, voir lib/books.mjs). BEST-EFFORT : un match sans marché ou une page
 * illisible est simplement sauté — le relevé du vainqueur n'en dépend jamais.
 * @param {object[]} rows lignes prématch de fetchWinamax (mutées en place)
 * @returns {Promise<number>} nombre de lignes enrichies
 */
export async function enrichWinamaxSets(rows, _ctx, { pauseMs = 600, maxMatches = 40 } = {}) {
  let n = 0;
  for (const row of (rows || []).slice(0, maxMatches)) {
    await new Promise((r) => setTimeout(r, pauseMs)); // on reste courtois
    try {
      const state = extractPreloadedState(await fetchText(MATCH_URL(row.bookMatchId)));
      const sets = parseWinamaxMatchSets(state, row.bookMatchId);
      if (sets) { row.sets = sets; n++; }
    } catch { /* page match indisponible : on garde la ligne vainqueur telle quelle */ }
  }
  return n;
}

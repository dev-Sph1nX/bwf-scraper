// lib/book-unibet.mjs
// Cotes badminton Unibet.fr via son API JSON "lvs-api".
//
// Deux requêtes HTTP pures suffisent :
//   1. la page /paris-badminton contient un token anonyme NON EXPIRANT
//      ("pselNonExpiringHsToken") — on le ré-extrait à chaque passage quand
//      même, au cas où il tournerait un jour ;
//   2. GET /lvs-api/next/<n>/p5000 avec l'en-tête X-LVS-HSToken. p5000 est le
//      nœud « Badminton » de leur arbre sportif (vérifié dans la nav embarquée
//      de la page). Ce flux renvoie les événements à venir avec UN marché
//      chacun : le "top market", toujours « Face à Face » (markettypeId 8500).
//
// PIÈGES du flux : prix décimaux à virgule française ("1,15"), dates au format
// compact AAMMJJHHMM en UTC ("2607311130" = 2026-07-31 11:30 UTC), n plafonné
// à 100 (au-delà : 404), pagination par pageIndex.

import { fetchText } from "./books.mjs";

const PAGE_URL = "https://www.unibet.fr/paris-badminton";
const NODE_BADMINTON = "p5000";
const MARKET_FACE_A_FACE = 8500;
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // garde-fou : 1000 événements badminton n'arrivent jamais

/** Token anonyme lisible dans le HTML de n'importe quelle page Unibet. */
export function extractUnibetToken(html) {
  const m = String(html).match(/"pselNonExpiringHsToken"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error("Unibet : token pselNonExpiringHsToken introuvable dans la page");
  return m[1];
}

/** "2607311135" (AAMMJJHHMM, UTC) -> "2026-07-31T11:35:00.000Z" */
export function decodeUnibetStart(s) {
  const m = String(s || "").match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi] = m;
  return `20${yy}-${mo}-${dd}T${hh}:${mi}:00.000Z`;
}

/** "1,15" -> 1.15 (null si illisible ou ≤ 1). */
function decodePrice(s) {
  const v = Number.parseFloat(String(s ?? "").replace(",", "."));
  return Number.isFinite(v) && v > 1 ? v : null;
}

// Suffixe de ligue -> discipline ("Taipei Open DH" → MD). Les doubles d'abord.
const SUFFIX_RULES = [
  [/\s+dx$/i, "XD"],
  [/\s+dh$/i, "MD"],
  [/\s+df$/i, "WD"],
  [/\s+h$/i, "MS"],
  [/\s+f$/i, "WS"],
];

function splitLeague(pdesc) {
  const s = String(pdesc || "").trim();
  for (const [re, code] of SUFFIX_RULES) {
    if (re.test(s)) return { tournament: s.replace(re, "").trim(), discipline: code };
  }
  return { tournament: s, discipline: null };
}

/**
 * Analyse la réponse lvs-api (graphe plat parent→enfant : p=ligue, e/l=événement,
 * m=marché, o=issue).
 * @param {{items: object}} lvs
 * @returns {object[]} lignes normalisées
 */
export function parseUnibetLvs(lvs) {
  const items = lvs?.items || {};
  // marchés « Face à Face » indexés par événement parent
  const marketByEvent = new Map();
  for (const [k, v] of Object.entries(items)) {
    if (k.startsWith("m") && v?.markettypeId === MARKET_FACE_A_FACE) marketByEvent.set(v.parent, k);
  }
  // issues groupées par marché parent, ordonnées par pos
  const outcomesByMarket = new Map();
  for (const [k, v] of Object.entries(items)) {
    if (!k.startsWith("o") || !v?.parent) continue;
    const list = outcomesByMarket.get(v.parent) || [];
    list.push(v);
    outcomesByMarket.set(v.parent, list);
  }

  const rows = [];
  for (const [k, v] of Object.entries(items)) {
    const isEvent = (k.startsWith("e") || k.startsWith("l")) && v?.eType === "G";
    if (!isEvent || v.code !== "BADM") continue;
    const marketId = marketByEvent.get(k);
    const outs = (outcomesByMarket.get(marketId) || []).sort((a, b) => (a.pos || 0) - (b.pos || 0));
    const { tournament, discipline } = splitLeague(v.pdesc);
    rows.push({
      book: "unibet",
      bookMatchId: k,
      srId: v.stats?.provider === "BR" && v.stats?.id ? String(v.stats.id) : null,
      tournament,
      discipline,
      p1: outs[0]?.desc ?? v.a ?? null,
      p2: outs[1]?.desc ?? v.b ?? null,
      odd1: decodePrice(outs[0]?.price),
      odd2: decodePrice(outs[1]?.price),
      startUtc: decodeUnibetStart(v.start),
      isLive: k.startsWith("l"),
    });
  }
  return rows;
}

/**
 * Récupère toutes les cotes badminton Unibet (pagination incluse).
 * @returns {Promise<{rows: object[], complete: boolean}>}
 */
export async function fetchUnibet({ pauseMs = 500 } = {}) {
  const token = extractUnibetToken(await fetchText(PAGE_URL));
  const rows = [];
  let expected = Infinity;
  for (let page = 0; page < MAX_PAGES && rows.length < expected; page++) {
    if (page > 0) await new Promise((r) => setTimeout(r, pauseMs));
    const url =
      `https://www.unibet.fr/lvs-api/next/${PAGE_SIZE}/${NODE_BADMINTON}` +
      `?lineId=1&originId=3&pageIndex=${page}`;
    const lvs = JSON.parse(await fetchText(url, { "X-LVS-HSToken": token }));
    expected = lvs.numberOfEvents ?? expected;
    const batch = parseUnibetLvs(lvs);
    if (!batch.length) break;
    rows.push(...batch);
  }
  return { rows, complete: !Number.isFinite(expected) || rows.length >= expected };
}

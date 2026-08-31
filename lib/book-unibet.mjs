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

import { fetchText, setsFromOutcomes } from "./books.mjs";

const PAGE_URL = "https://www.unibet.fr/paris-badminton";
// PIÈGE (constaté pendant le Korea Masters 2026) : /paris-badminton disparaît
// (404) dès qu'Unibet n'a plus d'événement badminton dans son arbre — le token
// se lit alors sur n'importe quelle autre page, l'accueil en dernier recours.
const TOKEN_PAGES = [PAGE_URL, "https://www.unibet.fr/"];
const SITE = "https://www.unibet.fr";
const SPORT_PATH = "paris-badminton"; // segment sport des URL de pages match
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

/** "Toronto DF" -> "toronto-df" (même règle que les URL du site). */
export function slugifyUnibet(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // accents
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Chemins relatifs des pages match (sans le segment sport), reconstruits
 * depuis le même flux lvs que parseUnibetLvs : catégorie/ligue/id/slug —
 * vérifié identique aux hrefs que le site rend (tennis, 2026-08-10). Les
 * slugs ne sont PAS libres (404 sinon), d'où cette reconstruction exacte.
 * @param {{items: object}} lvs
 * @returns {Map<string, string>} bookMatchId -> "categorie/ligue/id/slug"
 */
export function unibetMatchPaths(lvs) {
  const paths = new Map();
  for (const [k, v] of Object.entries(lvs?.items || {})) {
    const isEvent = (k.startsWith("e") || k.startsWith("l")) && v?.eType === "G";
    if (!isEvent) continue;
    const cat = slugifyUnibet(v?.path?.Category);
    const league = slugifyUnibet(v?.path?.League ?? v?.pdesc);
    const slug = slugifyUnibet(v?.desc);
    if (cat && league && slug) paths.set(k, `${cat}/${league}/${k.slice(1)}/${slug}`);
  }
  return paths;
}

/**
 * Récupère toutes les cotes badminton Unibet (pagination incluse).
 * @returns {Promise<{rows: object[], complete: boolean, ctx: Map<string,string>}>}
 *   `ctx` : bookMatchId -> chemin relatif de la page match (pour l'enrichissement
 *   « nombre de sets ») — jamais écrit dans les relevés.
 */
export async function fetchUnibet({ pauseMs = 500 } = {}) {
  let token = null, tokenErr = null;
  for (const page of TOKEN_PAGES) {
    try { token = extractUnibetToken(await fetchText(page)); break; }
    catch (err) { tokenErr = err; await new Promise((r) => setTimeout(r, pauseMs)); }
  }
  if (!token) throw tokenErr;
  const rows = [];
  const ctx = new Map();
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
    for (const [id, path] of unibetMatchPaths(lvs)) ctx.set(id, `${SPORT_PATH}/${path}`);
  }
  return { rows, complete: !Number.isFinite(expected) || rows.length >= expected, ctx };
}

// --- Marché « nombre de sets » ------------------------------------------------
//
// Le flux lvs `next` ne porte que le top market « Face à Face ». Le marché des
// sets se lit sur la page MATCH, rendue côté serveur : chaque marché y est une
// carte `<div class="psel-market-card">` avec un titre
// (psel-title-market__label, ex. « Nombre de sets dans le match - Match ») et
// des issues (psel-outcome__label « 2 sets » / psel-outcome__data « 1,49 ») —
// relevé tennis du 2026-08-10. Pas de JSON embarqué : on lit ce HTML.

/**
 * Cartes de marché d'une page match Unibet.
 * @param {string} html
 * @returns {Array<{title: string, outcomes: Array<{label: string, odd: number|null}>}>}
 */
export function parseUnibetMarketCards(html) {
  const cards = [];
  const blocks = String(html).split('<div class="psel-market-card"');
  for (const block of blocks.slice(1)) {
    const t = block.match(/psel-title-market__label"[^>]*>([^<]+)</);
    if (!t) continue;
    const outcomes = [];
    for (const o of block.matchAll(
      /psel-outcome__label">([^<]*)<\/span>(?:<!---->)*<span class="psel-outcome__data">([^<]*)</g,
    )) {
      outcomes.push({ label: o[1].trim(), odd: decodePrice(o[2]) });
    }
    cards.push({ title: t[1].trim(), outcomes });
  }
  return cards;
}

/**
 * Déduit le marché « nombre de sets » des cartes d'une page match.
 * @returns {{market: string, odd2: number|null, odd3: number|null}|null}
 */
export function setsFromUnibetCards(cards) {
  for (const card of cards || []) {
    if (!/nombre de (sets|manches)/i.test(card.title || "")) continue;
    const sets = setsFromOutcomes(card.outcomes);
    if (sets) return { market: card.title, ...sets };
  }
  return null;
}

/**
 * Complète les lignes prématch avec le marché « nombre de sets » (champ
 * `sets`, voir lib/books.mjs). BEST-EFFORT : ligne sans chemin connu ou page
 * illisible sautée — le relevé du vainqueur n'en dépend jamais.
 * @param {object[]} rows lignes prématch de fetchUnibet (mutées en place)
 * @param {Map<string,string>} ctx bookMatchId -> chemin relatif (fetchUnibet)
 * @returns {Promise<number>} nombre de lignes enrichies
 */
export async function enrichUnibetSets(rows, ctx, { pauseMs = 600, maxMatches = 57, site = SITE } = {}) {
  let n = 0;
  for (const row of (rows || []).slice(0, maxMatches)) {
    const path = ctx?.get?.(row.bookMatchId);
    if (!path) continue;
    await new Promise((r) => setTimeout(r, pauseMs)); // on reste courtois
    try {
      const sets = setsFromUnibetCards(parseUnibetMarketCards(await fetchText(`${site}/${path}`)));
      if (sets) { row.sets = sets; n++; }
    } catch { /* page match indisponible : on garde la ligne vainqueur telle quelle */ }
  }
  return n;
}

// lib/book-pinnacle.mjs
// Cotes badminton Pinnacle — RÉFÉRENCE DE MESURE, PAS UN OPÉRATEUR MISABLE.
//
// POURQUOI (2026-08-18, journal §10.9) : le diagnostic final du projet est que
// notre CLV prouvée (+3,1 %) est battue partout par la marge des books
// français (≥ 6 % même sur les gros favoris). La ligne Pinnacle est la
// référence mondiale (marge badminton ~4-6 %, gagnants non limités) : la
// question ouverte est « bat-on AUSSI la clôture Pinnacle ? ». On collecte donc
// ses cotes dans les relevés bi-horaires pour pouvoir mesurer, après quelques
// tournois, la CLV contre SA clôture. Aucun compte, aucun pari : lecture de
// cotes publiques. Pinnacle n'est pas agréé ANJ : ses cotes ne doivent JAMAIS
// entrer dans « la meilleure cote » affichée ou le ROI misable (le filtre est
// dans build-data, qui ne verse que les books de lib/roi.mjs BOOKS).
//
// SOURCE : l'API invitée du site (guest.api.arcadia.pinnacle.com), JSON pur,
// deux appels : la liste des matchups (sport 1 = badminton) et les marchés
// « straight » du sport. La clé d'API publique vit dans la config du site
// (https://www.pinnacle.com/config/app.json -> api.haywire.apiKey) et TOURNE
// de temps en temps : on la lit à chaque relevé, avec repli sur la dernière
// connue. Cotes au format AMÉRICAIN (+106 / −124), converties en décimal.
//
// PIÈGE constaté à la construction (nuit du 18/08, Mondiaux en cours) :
// matchupCount badminton = 0 alors que le tennis en a 189 — Pinnacle semble
// n'ouvrir le badminton que peu avant les matchs (courant pour les petits
// sports), ou l'a délisté. Le relevé bi-horaire tranchera : la forme des
// réponses est validée sur le TENNIS (fixtures de test), les spécificités
// badminton (nom des ligues -> discipline) restent à confirmer à la première
// capture réelle — check-list en fin de fichier.

import { BROWSER_HEADERS } from "./books.mjs";

const CONFIG_URL = "https://www.pinnacle.com/config/app.json";
const API = "https://guest.api.arcadia.pinnacle.com/0.1";
const SPORT_BADMINTON = 1;
// Dernière clé publique constatée (2026-08-18) — repli si la config est illisible.
const FALLBACK_KEY = "CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R";

async function getJson(url, headers = {}) {
  const resp = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: "application/json", ...headers } });
  if (!resp.ok) throw new Error(`${url} -> HTTP ${resp.status}`);
  return resp.json();
}

/** Clé d'API publique courante, lue dans la config du site (elle tourne). */
export async function fetchPinnacleKey() {
  try {
    const cfg = await getJson(CONFIG_URL);
    const key = cfg?.api?.haywire?.apiKey;
    if (typeof key === "string" && key.length >= 16) return key;
  } catch { /* config illisible : repli */ }
  return FALLBACK_KEY;
}

/** Cote américaine -> décimale (+106 -> 2.06 ; −124 -> 1.806). */
export function americanToDecimal(am) {
  const a = Number(am);
  if (!Number.isFinite(a) || a === 0) return null;
  const dec = a > 0 ? 1 + a / 100 : 1 + 100 / -a;
  return Math.round(dec * 1000) / 1000;
}

// Nom de ligue -> discipline BWF. Libellés badminton Pinnacle NON confirmés
// (extrapolés des conventions anglophones) : à valider à la première capture.
// PIÈGE (attrapé par le test) : « Women's Singles » CONTIENT « men's singles »
// — les règles féminines passent d'abord, et les masculines exigent une
// frontière de mot (\bmen ne matche pas au milieu de « women »).
const DISCIPLINE_RULES = [
  [/women'?s?\s+doubles|ladies'?\s+doubles|\bWD\b/i, "WD"],
  [/mixed\s+doubles|\bXD\b/i, "XD"],
  [/\bmen'?s?\s+doubles|\bMD\b/i, "MD"],
  [/women'?s?\s+singles|ladies'?\s+singles|\bWS\b/i, "WS"],
  [/\bmen'?s?\s+singles|\bMS\b/i, "MS"],
];
export function disciplineOfLeague(name) {
  for (const [re, code] of DISCIPLINE_RULES) if (re.test(name || "")) return code;
  return null;
}

/**
 * Assemble matchups + marchés en lignes normalisées (schéma de lib/books.mjs).
 * Champs en plus, propres à la mesure :
 *   maxStake : limite de mise du marché vainqueur (USD) — la « confiance » de
 *              Pinnacle dans sa propre ligne, précieuse pour l'analyse ;
 *   totals   : lignes over/under de points [{n, over, under}] — collectées car
 *              servies par le même appel (leçon §6 : tout garder, filtrer à
 *              l'analyse ; le marché des points est le moins chargé mesuré).
 * Exportée pure pour les tests (fixtures tennis).
 */
export function parsePinnacle(matchups, markets) {
  const parMatchup = new Map();
  for (const mk of markets || []) {
    if (mk.period !== 0 || mk.status === "suspended") continue;
    const e = parMatchup.get(mk.matchupId) || {};
    if (mk.type === "moneyline" && !mk.isAlternate) e.moneyline = mk;
    else if (mk.type === "total") (e.totals ??= []).push(mk);
    parMatchup.set(mk.matchupId, e);
  }

  const rows = [];
  for (const m of matchups || []) {
    if (m.parentId) continue; // sous-marché d'un matchup parent (spéciaux)
    const home = (m.participants || []).find((p) => p.alignment === "home");
    const away = (m.participants || []).find((p) => p.alignment === "away");
    if (!home?.name || !away?.name) continue;
    const mk = parMatchup.get(m.id);
    const prix = Object.fromEntries((mk?.moneyline?.prices || []).map((p) => [p.designation, americanToDecimal(p.price)]));
    if (!(prix.home > 1) || !(prix.away > 1)) continue; // pas de vainqueur coté : ligne inutile
    const totals = (mk?.totals || [])
      .map((t) => {
        const par = Object.fromEntries((t.prices || []).map((p) => [p.designation, americanToDecimal(p.price)]));
        const n = Number(t.prices?.[0]?.points ?? t.points);
        return Number.isFinite(n) && par.over > 1 && par.under > 1 ? { n, over: par.over, under: par.under } : null;
      })
      .filter(Boolean);
    rows.push({
      book: "pinnacle",
      bookMatchId: String(m.id),
      srId: null, // Pinnacle n'expose pas d'id Sportradar : jointure par noms
      tournament: m.league?.name ?? null,
      discipline: disciplineOfLeague(m.league?.name),
      p1: home.name,
      p2: away.name,
      odd1: prix.home,
      odd2: prix.away,
      startUtc: m.startTime ? new Date(m.startTime).toISOString() : null,
      isLive: !!m.isLive,
      maxStake: mk?.moneyline?.limits?.find((l) => l.type === "maxRiskStake")?.amount ?? null,
      ...(totals.length ? { totals } : {}),
    });
  }
  return rows;
}

/** Récupère toutes les cotes badminton Pinnacle (2 appels JSON). */
export async function fetchPinnacle() {
  const key = await fetchPinnacleKey();
  const h = { "X-API-Key": key };
  const matchups = await getJson(`${API}/sports/${SPORT_BADMINTON}/matchups?withSpecials=false`, h);
  // Zéro matchup = zéro marché à demander (et l'appel marchés sur un sport
  // vide peut renvoyer une erreur) : relevé vide propre, comme le hors-saison.
  if (!Array.isArray(matchups) || !matchups.length) return { rows: [], complete: true };
  const markets = await getJson(`${API}/sports/${SPORT_BADMINTON}/markets/straight?primaryOnly=false&withSpecials=false`, h);
  return { rows: parsePinnacle(matchups, markets), complete: true };
}

// CHECK-LIST première capture badminton réelle (à dérouler puis consigner
// dans docs/verif-cotes-sets.md ou le journal) :
// 1. `node scrape-books.mjs` pendant une fenêtre où pinnacle.com liste du
//    badminton — noter l'HEURE d'ouverture des lignes vs nos books FR.
// 2. Noter les noms de ligues réels et vérifier disciplineOfLeague dessus.
// 3. Vérifier l'orientation home/away contre le site (2-3 matchs).
// 4. Vérifier la jointure par noms vers les matchs BWF (books-match) : les
//    noms Pinnacle sont-ils « Prénom Nom » complets ?
// 5. Regarder maxStake : des limites minuscules (< 200 $) diraient que la
//    ligne badminton est décorative, pas une vraie référence.

// lib/book-betclic.mjs
// Cotes badminton Betclic, lues dans le rendu serveur (Angular SSR).
//
// La page https://www.betclic.fr/badminton-sbadminton embarque un
// <script id="ng-state"> : le cache de transfert Angular, où figurent les
// réponses gRPC que le serveur a déjà faites pour rendre la page — dont la
// liste des matchs avec cotes, DÉJÀ décodée en JSON. Interroger l'API
// directement n'est pas possible simplement : c'est du gRPC-web binaire, et
// l'ancienne API REST publique (offer.cdn.begmedia.com) n'existe plus.
//
// PIÈGE : les clés du cache ("grpc:<hachage>") changent à chaque build de
// Betclic. On identifie donc les entrées par la FORME de leur contenu
// (payload.matches / payload.sports), jamais par leur clé.
//
// PIÈGE : la page sport est plafonnée (~20 matchs) mais `totalCount` annonce le
// vrai total ; si ça dépasse, on complète via les pages compétition listées
// dans la même ng-state, et on fusionne par matchId.

import { fetchText, setsFromOutcomes } from "./books.mjs";

const PAGE_URL = "https://www.betclic.fr/badminton-sbadminton";

// Discipline déduite du suffixe du nom de compétition ("Open de Chine Taipei
// Doubles H." → MD). Les doubles se testent avant les simples, sinon
// "Doubles H." matcherait la règle "H.".
const DISCIPLINE_RULES = [
  [/\s+doubles\s+mixtes?\.?$|\s+doubles\s+mx?\.?$/i, "XD"],
  [/\s+doubles\s+h\.?$/i, "MD"],
  [/\s+doubles\s+f\.?$/i, "WD"],
  [/\s+h\.?$/i, "MS"],
  [/\s+f\.?$/i, "WS"],
];

/** "Open de Chine Taipei Doubles H." -> { tournament, discipline } */
export function splitCompetitionName(name) {
  const s = String(name || "").trim();
  for (const [re, code] of DISCIPLINE_RULES) {
    if (re.test(s)) return { tournament: s.replace(re, "").trim(), discipline: code };
  }
  return { tournament: s, discipline: null };
}

/** Id Sportradar du match, porté par les widgets de stats. */
function sportradarId(match) {
  for (const w of match.widgets || []) {
    const sr = w?.widget?.sportradarWidget;
    if (sr?.externalMatchRef) return String(sr.externalMatchRef);
  }
  return null;
}

function toRow(match) {
  const [c1, c2] = match.contestants || [];
  const sels = match.market?.mainSelections || [];
  if (!c1 || !c2) return null;
  if (match.market?.isOutright) return null; // "vainqueur du tournoi", pas un match
  // Une cote ≤ 1 ne paie pas (marché suspendu/quasi réglé) : même règle que
  // les parseurs Unibet et Winamax, on la neutralise.
  const odd = (i) => (Number.isFinite(sels[i]?.odds) && sels[i].odds > 1 ? sels[i].odds : null);
  const { tournament, discipline } = splitCompetitionName(match.competition?.name);
  return {
    book: "betclic",
    bookMatchId: String(match.matchId),
    srId: sportradarId(match),
    tournament,
    discipline,
    p1: c1.name,
    p2: c2.name,
    odd1: odd(0),
    odd2: odd(1),
    startUtc: match.matchDateUtc ? new Date(match.matchDateUtc).toISOString() : null,
    isLive: !!match.isLive,
  };
}

/**
 * Analyse une page Betclic rendue par le serveur.
 * @param {string} html
 * @returns {{rows: object[], totalCount: number, competitions: {id: string, name: string}[]}}
 */
export function parseBetclicPage(html) {
  const m = html.match(/<script id="ng-state" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error("Betclic : ng-state introuvable — le rendu SSR a changé");
  const state = JSON.parse(m[1]);

  let payload = null;
  let competitions = [];
  let sports = null; // liste des sports vue dans le ng-state (si présente)
  for (const v of Object.values(state)) {
    const p = v?.response?.payload;
    if (!p || typeof p !== "object") continue;
    if (Array.isArray(p.matches)) payload = p;
    if (Array.isArray(p.sports)) {
      sports = p.sports;
      const bad = p.sports.find((s) => s?.sportCode === "badminton");
      if (bad?.competitions?.length) {
        competitions = bad.competitions.map((c) => ({ id: String(c.competitionId), name: c.competitionName }));
      }
    }
  }
  if (!payload) {
    // HORS SAISON (constaté le 2026-08-10) : la page répond, le ng-state porte
    // la liste des sports… où le badminton N'EST PLUS LISTÉ — Betclic délisté
    // le sport sans événement. Zéro match est alors la bonne lecture, pas une
    // erreur. On ne conclut ainsi QUE sur cette signature précise : sans liste
    // de sports du tout, c'est un vrai changement de format et on jette.
    if (sports && !sports.some((s) => s?.sportCode === "badminton")) {
      return { rows: [], totalCount: 0, competitions: [] };
    }
    throw new Error("Betclic : aucun payload de matchs dans ng-state");
  }

  const rows = payload.matches.map(toRow).filter(Boolean);
  return { rows, totalCount: payload.totalCount ?? rows.length, competitions };
}

/**
 * Récupère toutes les cotes badminton Betclic (avec complément par compétition
 * si la page sport est tronquée).
 * @returns {Promise<{rows: object[], complete: boolean}>}
 */
export async function fetchBetclic({ pauseMs = 500 } = {}) {
  const first = parseBetclicPage(await fetchText(PAGE_URL));
  const byId = new Map(first.rows.map((r) => [r.bookMatchId, r]));

  if (first.totalCount > first.rows.length) {
    for (const comp of first.competitions) {
      await new Promise((r) => setTimeout(r, pauseMs)); // on reste courtois
      try {
        // Le slug avant "-c<id>" est libre : Betclic répond par une 301 vers
        // l'URL canonique, que fetch suit.
        const page = parseBetclicPage(await fetchText(`${PAGE_URL}/x-c${comp.id}`));
        for (const r of page.rows) byId.set(r.bookMatchId, r);
      } catch (err) {
        console.warn(`Betclic : compétition ${comp.id} illisible : ${err.message}`);
      }
    }
  }
  const rows = [...byId.values()];
  return { rows, complete: rows.length >= first.totalCount };
}

// --- Marché « nombre de sets » ------------------------------------------------
//
// La page SPORT ne sert que le marché principal (`match.market`, tableau
// `markets` vide — vérifié le 2026-08-10 sur le tennis). Les autres marchés
// sont dans le ng-state de la page MATCH, sous payload.match.subCategories[]
// .markets[] : cotes dans `mainSelections` (layout 8) ou dans
// `selectionMatrix[].selections[].selectionOneof.selection` (layout 1).
//
// URL de page match : Betclic route par le SEUL id de match et répond par une
// 301 vers l'URL canonique — `<sport>/x-c1/x-m<matchId>` suffit (vérifié :
// x-c999 fonctionne, l'id de compétition est ignoré).
//
// PIÈGE : seul l'onglet « Le Top » est rendu en SSR. Sur le tennis, il ne
// contient PAS de marché « Nombre de sets » nommé ainsi, mais deux équivalents
// exacts en best of 3 : « Les deux joueurs gagnent un set » (Non = 2 sets,
// Oui = 3 sets) et « Score final (sets) » (2-0/0-2/2-1/1-2). On tente les
// trois formes, de la plus directe à la plus indirecte.

/**
 * Marchés de la page match (nom + issues aplaties), quel que soit le layout.
 * @param {string} html page match rendue par le serveur
 * @returns {Array<{name: string, selections: Array<{label: string, odd: number|null}>}>}
 */
export function parseBetclicMatchMarkets(html) {
  const m = html.match(/<script id="ng-state" type="application\/json">(.*?)<\/script>/s);
  if (!m) throw new Error("Betclic : ng-state introuvable — le rendu SSR a changé");
  const state = JSON.parse(m[1]);
  for (const v of Object.values(state)) {
    const mt = v?.response?.payload?.match;
    if (!mt?.subCategories) continue;
    const flat = (mk) => (mk.mainSelections?.length
      ? mk.mainSelections
      : (mk.selectionMatrix || []).flatMap((r) =>
          (r.selections || []).map((s) => s?.selectionOneof?.selection).filter(Boolean)));
    return mt.subCategories.flatMap((sc) => sc.markets || []).map((mk) => ({
      name: mk.name,
      selections: flat(mk).map((s) => ({
        label: s.name,
        odd: Number.isFinite(s.odds) && s.odds > 1 ? s.odds : null,
      })),
    }));
  }
  throw new Error("Betclic : payload de page match introuvable dans ng-state");
}

/**
 * Déduit le marché « nombre de sets » des marchés d'une page match.
 * @returns {{market: string, odd2: number|null, odd3: number|null, scores?: object}|null}
 */
export function setsFromBetclicMarkets(markets) {
  // 1) marché direct, si Betclic le nomme ainsi au badminton
  for (const mk of markets || []) {
    if (!/^nombre (exact )?de (sets|manches)/i.test(mk.name || "")) continue;
    const sets = setsFromOutcomes(mk.selections.map((s) => ({ label: s.label, odd: s.odd })));
    if (sets) return { market: mk.name, ...sets };
  }
  // 2) « Les deux joueurs gagnent un set » : équivalence EXACTE en best of 3
  //    (Non = match en 2 sets, Oui = match en 3 sets)
  for (const mk of markets || []) {
    if (!/^les deux .*gagnent (au moins )?(un set|une manche)/i.test(mk.name || "")) continue;
    const oui = mk.selections.find((s) => /^oui$/i.test(s.label || ""))?.odd ?? null;
    const non = mk.selections.find((s) => /^non$/i.test(s.label || ""))?.odd ?? null;
    if (oui != null || non != null) return { market: mk.name, odd2: non, odd3: oui };
  }
  // 3) repli : « Score final (sets) » — on garde les cotes par score exact
  //    telles que cotées (recombiner 2-0+0-2 en « 2 sets » serait une cote
  //    SYNTHÉTIQUE, pas une cote offerte : on ne l'invente pas).
  for (const mk of markets || []) {
    if (!/^score (final|exact) \((sets|manches)\)/i.test(mk.name || "")) continue;
    const scores = {};
    for (const s of mk.selections) {
      const sc = String(s.label || "").match(/^(\d)\s*-\s*(\d)$/);
      if (sc && s.odd != null) scores[`${sc[1]}-${sc[2]}`] = s.odd;
    }
    if (Object.keys(scores).length) return { market: mk.name, odd2: null, odd3: null, scores };
  }
  return null;
}

/**
 * Complète les lignes prématch avec le marché « nombre de sets » (champ
 * `sets`, voir lib/books.mjs). BEST-EFFORT : toute page match illisible est
 * sautée — le relevé du vainqueur n'en dépend jamais.
 * @param {object[]} rows lignes prématch de fetchBetclic (mutées en place)
 * @returns {Promise<number>} nombre de lignes enrichies
 */
export async function enrichBetclicSets(rows, _ctx, { pauseMs = 600, maxMatches = 40, baseUrl = PAGE_URL } = {}) {
  let n = 0;
  for (const row of (rows || []).slice(0, maxMatches)) {
    await new Promise((r) => setTimeout(r, pauseMs)); // on reste courtois
    try {
      const markets = parseBetclicMatchMarkets(await fetchText(`${baseUrl}/x-c1/x-m${row.bookMatchId}`));
      const sets = setsFromBetclicMarkets(markets);
      if (sets) { row.sets = sets; n++; }
    } catch { /* page match indisponible : on garde la ligne vainqueur telle quelle */ }
  }
  return n;
}

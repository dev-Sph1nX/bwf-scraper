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

import { fetchText } from "./books.mjs";

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
  for (const v of Object.values(state)) {
    const p = v?.response?.payload;
    if (!p || typeof p !== "object") continue;
    if (Array.isArray(p.matches)) payload = p;
    if (Array.isArray(p.sports)) {
      const bad = p.sports.find((s) => s?.sportCode === "badminton");
      if (bad?.competitions?.length) {
        competitions = bad.competitions.map((c) => ({ id: String(c.competitionId), name: c.competitionName }));
      }
    }
  }
  if (!payload) throw new Error("Betclic : aucun payload de matchs dans ng-state");

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

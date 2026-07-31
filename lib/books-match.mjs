// lib/books-match.mjs
// Appariement des groupes de cotes bookmakers avec les matchs BWF.
//
// Module PUR, même philosophie que lib/odds-match.mjs : une cote absente vaut
// mieux qu'une cote fausse — tout doute part dans `ambiguous`.
//
// Différence assumée avec oddsportal : les bookmakers français TRADUISENT les
// noms de tournoi (« Open de Chine Taipei » pour « Taipei Open 2026 »), donc
// l'exigence « tous les tokens opérateur présents côté BWF » ne peut pas
// tenir. À la place, le pool de candidats se restreint par :
//   - la DISCIPLINE (déduite chez chaque opérateur, fiable) ;
//   - la PROXIMITÉ DE DATE : les cotes portent l'heure UTC du match, la BWF
//     l'heure locale du lieu — on tolère donc ±1 jour calendaire.
// La décision finale reste portée par le score de joueurs (mêmes fonctions et
// seuils que lib/odds-match.mjs).

import { teamScore, playerScore } from "./odds-match.mjs";
import { parseParticipant } from "./odds.mjs";

// Mêmes seuils que lib/odds-match.mjs (non exportés là-bas, dupliqués À
// L'IDENTIQUE ici : s'ils divergent un jour, c'est un choix à documenter).
const MIN_PLAYER = 60;
const MIN_MARGIN = 20;

/**
 * Remet un nom bookmaker au format qu'attend parseDisplayName (initiales EN
 * QUEUE, à la oddsportal). Les bookmakers écrivent les initiales EN TÊTE,
 * souvent collées au nom : "A.Chia", "H.C.Chiu", "TC.Chou", "L. R. Carnando".
 * Sans cette remise en forme, aucun double ne s'appariait (constaté).
 * "H.C.Chiu" -> "Chiu H. C." ; "Justin Hoh" -> inchangé.
 */
export function reorderInitials(name) {
  let rest = String(name || "").trim();
  const initiales = [];
  for (;;) {
    // un groupe d'initiales en tête : 1-3 lettres suivies d'un point ("A.",
    // "TC."), éventuellement collé à la suite du nom
    const m = rest.match(/^([A-Za-z]{1,3})\.[\s-]*(.+)$/);
    if (!m || m[1].length >= 2 && !m[2].match(/^[A-Z]/)) break;
    initiales.push(...m[1].split("").map((c) => `${c.toUpperCase()}.`));
    rest = m[2].trim();
  }
  return initiales.length ? `${rest} ${initiales.join(" ")}` : rest;
}

/** Camp bookmaker au format attendu par teamScore (pas de slug ni d'iso2). */
function sideOf(name) {
  const remis = String(name || "").split("/").map((p) => reorderInitials(p.trim())).join("/");
  return { display: remis, iso2: null, slug: null, players: parseParticipant(remis) };
}

/** "2026-07-31 19:30:00" ou "2026-07-31T11:30:00Z" -> jour "2026-07-31". */
const dayOf = (s) => String(s || "").slice(0, 10);

/** Écart en jours calendaires entre deux dates ISO (heure ignorée). */
function dayGap(aIso, bIso) {
  const a = Date.parse(dayOf(aIso)), b = Date.parse(dayOf(bIso));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86_400_000;
}

function pair(a, b) {
  return a < 0 || b < 0 ? null : a + b;
}

/**
 * Apparie des groupes de cotes bookmakers avec des matchs BWF.
 *
 * @param {object[]} bwfCandidates matchs BWF (tournamentName, eventName,
 *   matchTime, team1/team2 avec players[{lastName, firstName, countryCode}])
 * @param {object[]} groups groupes issus de groupBooks (p1/p2 = noms de la
 *   meilleure source, startUtc, discipline)
 * @returns {{matched: Array, ambiguous: Array, unmatched: Array, stats: object}}
 */
export function matchBooks(bwfCandidates, groups) {
  const matched = [], ambiguous = [], unmatched = [];
  const usedBwf = new Set();

  for (const g of groups) {
    const p1 = sideOf(g.p1), p2 = sideOf(g.p2);
    const pool = bwfCandidates.filter(
      (c) => c.eventName === g.discipline && dayGap(c.matchTime, g.startUtc) <= 1,
    );

    // Meilleure des deux orientations pour chaque candidat (l'ordre d'affichage
    // des opérateurs suit en général le camp « domicile » Sportradar, mais rien
    // ne le garantit côté BWF).
    const scored = [];
    for (const c of pool) {
      const direct = pair(teamScore(c.team1, p1), teamScore(c.team2, p2));
      const croise = pair(teamScore(c.team1, p2), teamScore(c.team2, p1));
      if (direct == null && croise == null) continue;
      if (croise == null || (direct != null && direct >= croise)) scored.push({ c, score: direct, swapped: false });
      else scored.push({ c, score: croise, swapped: true });
    }
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1];
    if (!best) { unmatched.push(g); continue; }
    if (second && best.score - second.score < MIN_MARGIN) {
      ambiguous.push({
        group: g,
        candidates: scored.slice(0, 3).map((s) => ({ bwf: s.c, score: s.score, swapped: s.swapped })),
      });
      continue;
    }
    const cle = `${best.c.tournamentName}|${best.c.eventName}|${best.c.a}|${best.c.b}`;
    if (usedBwf.has(cle)) { ambiguous.push({ group: g, candidates: [{ bwf: best.c, score: best.score, swapped: best.swapped }] }); continue; }
    usedBwf.add(cle);
    matched.push({ group: g, bwf: best.c, score: best.score, swapped: best.swapped });
  }

  return {
    matched, ambiguous, unmatched,
    stats: {
      groups: groups.length,
      matched: matched.length,
      ambiguous: ambiguous.length,
      unmatched: unmatched.length,
    },
  };
}

// Exposé pour d'éventuels réglages mesurés ; mêmes valeurs que odds-match.
export { MIN_PLAYER, MIN_MARGIN, playerScore };

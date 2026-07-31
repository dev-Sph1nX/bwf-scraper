// lib/elo.mjs
// Moteur de classement Elo (façon échecs) calculé à partir des matchs scrapés.
//
// Objectif : mesurer la FORME DU MOMENT de chaque compétiteur, là où le classement
// mondial BWF (système des 6 meilleures perfs) est trop inerte.
//
// Un Elo est calculé PAR DISCIPLINE (MS/WS/MD/WD/XD), car un joueur de simple et
// une paire de double ne se comparent pas :
//   - Simple (MS, WS)   -> l'entité notée est le JOUEUR.
//   - Double (MD, WD, XD) -> l'entité notée est la PAIRE (choix produit assumé :
//     on note l'association telle qu'elle joue, pas les joueurs séparément).
//
// La probabilité qu'une entité A batte B se déduit ensuite de l'écart Elo :
//   P(A) = 1 / (1 + 10^((Rb - Ra) / 400))
// C'est cette probabilité qui alimente le prédicteur tête-à-tête.

import * as store from "./store.mjs";

// ----- Paramètres du modèle (réglés pour la réactivité = refléter la forme) -----
const BASE_PARAMS = {
  initial: 1500,        // Elo de départ
  k: 32,                // facteur K standard (échecs)
  kProvisional: 48,     // K plus fort tant que l'entité a peu de matchs (convergence rapide)
  provisionalMatches: 5,// en dessous : ratings "provisoires"
  threeSetMultiplier: 0.85, // un match gagné en 3 manches informe un peu moins qu'un 2-0
  // --- Variante « marge de points » (Elo-bis, mesure en cours) ---
  // 0 = DÉSACTIVÉ : l'Elo de production ignore l'ampleur du score en points.
  // > 0 : la mise à jour est modulée par la domination aux points du vainqueur
  // (21-5 pèse plus que 21-19), cf. pointsMultiplier plus bas.
  pointsFactor: 0,
  pointsRef: 0.07,      // marge de référence (part du vainqueur − 0,5) jugée « normale »
  pointsDamping: true,  // amortissement anti-autocorrélation façon FiveThirtyEight
  formWindow: 5,        // "forme" = variation d'Elo sur les N derniers matchs
  // Seed initial depuis le classement mondial (linéaire par rang sur le top N)
  seedTop: 1750,        // Elo de départ du #1 mondial
  seedBottom: 1350,     // Elo de départ du #seedTopN (et défaut au-delà / non-classé)
  seedTopN: 60,
  scale: 400,            // échelle Elo -> probabilité (400 = convention des échecs)
};

/** Paramètres par défaut. Surchargeables via computeElo(…, { params }). */
export const PARAMS = BASE_PARAMS;

/** Elo de départ déduit du rang mondial initial (linéaire top-N, plat au-delà). */
export function seedEloByRank(rank) {
  if (!rank || rank > PARAMS.seedTopN) return PARAMS.seedBottom;
  return Math.round(PARAMS.seedTop - (rank - 1) * (PARAMS.seedTop - PARAMS.seedBottom) / (PARAMS.seedTopN - 1));
}

const SINGLES = new Set(["MS", "WS"]);
const DISCIPLINES = {
  MS: "Simple messieurs",
  WS: "Simple dames",
  MD: "Double messieurs",
  WD: "Double dames",
  XD: "Double mixte",
};

const isSingles = (evt) => SINGLES.has(evt);

// Clé d'entité stable : joueur seul en simple, paire triée en double.
function entityKey(discipline, players) {
  const ids = players.map((p) => String(p.id)).sort();
  return isSingles(discipline) ? `p:${ids[0]}` : `pair:${ids.join("-")}`;
}

// Métadonnées d'affichage d'une entité (avatar, drapeau, nom).
function entityMeta(discipline, players) {
  const list = players.map((p) => ({
    id: String(p.id),
    name: p.nameDisplay,
    slug: p.slug ?? null,
    country: p.countryCode ?? null,
    flag: p.countryFlagUrl ?? null,
    avatar: p.avatar?.thumbnailUrl ?? null,
  }));
  const countries = [...new Set(list.map((p) => p.country).filter(Boolean))];
  return {
    type: isSingles(discipline) ? "player" : "pair",
    players: list,
    name: list.map((p) => p.name).join(" / "),
    country: countries.length === 1 ? countries[0] : countries.join("/") || null,
  };
}

// Multiplicateur de marge : un 2-0 pèse plus qu'un 2-1.
// `mult` est passé en argument et non lu depuis les paramètres du module, sinon
// une surcharge de threeSetMultiplier resterait sans effet (cette fonction est
// définie hors de computeElo).
function marginMultiplier(score, mult) {
  if (!Array.isArray(score) || score.length === 0) return 1;
  let winnerSets = 0, loserSets = 0;
  for (const s of score) {
    if (s.home > s.away) winnerSets++;
    else if (s.away > s.home) loserSets++;
  }
  // best-of-3 : 2-1 => match serré, moins d'information.
  return loserSets >= 1 ? mult : 1;
}

/**
 * Part des points marqués par le VAINQUEUR sur l'ensemble du match.
 * 21-5, 21-5 -> 0,81 (écrasement) ; 22-20, 21-19 -> ~0,52 (arraché).
 * @param {Array<{home:number, away:number}>} score
 * @param {1|2} winner
 * @returns {number|null} null si le score est inexploitable
 */
export function winnerPointShare(score, winner) {
  if (!Array.isArray(score) || score.length === 0) return null;
  let home = 0, away = 0;
  for (const s of score) {
    if (!Number.isFinite(s?.home) || !Number.isFinite(s?.away)) return null;
    home += s.home; away += s.away;
  }
  if (home + away <= 0) return null;
  return winner === 1 ? home / (home + away) : away / (home + away);
}

/**
 * Multiplicateur de mise à jour selon la marge de POINTS (variante Elo-bis).
 *
 * Neutre (=1) si pointsFactor vaut 0 — c'est le réglage de production — ou si
 * la part de points est inconnue (une donnée absente ne pénalise personne).
 *
 * Sinon : linéaire autour de la marge de référence (marge = part du vainqueur
 * − 0,5). Une domination au-dessus de la référence amplifie la mise à jour, un
 * match arraché l'atténue. Borné à [0,25 ; 2,5] pour qu'aucun score extrême ne
 * fasse exploser une note.
 *
 * `gapWinner` (Elo du vainqueur − Elo du vaincu, AVANT match) alimente
 * l'amortissement anti-autocorrélation de FiveThirtyEight : les dominants
 * gagnent gros match après match, et sans ce frein leur note s'envole en
 * sur-confiance. Une victoire large du favori annoncé apporte peu d'information
 * nouvelle ; la même victoire par l'outsider en apporte beaucoup.
 *
 * @param {number|null} share  part de points du vainqueur (winnerPointShare)
 * @param {number} gapWinner   écart d'Elo d'avant match, signé, côté vainqueur
 * @param {{pointsFactor:number, pointsRef:number, pointsDamping:boolean}} params
 */
export function pointsMultiplier(share, gapWinner, { pointsFactor, pointsRef, pointsDamping }) {
  if (!pointsFactor || share == null) return 1;
  const marge = Math.max(0, share - 0.5);
  let mult = 1 + pointsFactor * ((marge - pointsRef) / pointsRef);
  if (pointsDamping) mult *= 2.2 / ((gapWinner || 0) * 0.001 + 2.2);
  return Math.min(2.5, Math.max(0.25, mult));
}

// Échelle de conversion écart de notes -> probabilité. 400 est la valeur des
// échecs, reprise par convention et jamais mesurée pour le badminton : c'est un
// paramètre à part entière, et le plus influent sur la calibration (plus il est
// petit, plus les probabilités sont tranchées).
const expectedWith = (scale) => (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / scale));
const expected = expectedWith(400);

/**
 * Calcule les classements Elo de l'année.
 *
 * @param {number|number[]} years
 * @param {Record<string, Map<string, number>>} [seeds]  Elo de départ par entité
 * @param {{onMatch?: (ctx: object) => void}} [options]
 *
 * `options.onMatch` est appelé pour chaque match retenu, **avant** que la mise à
 * jour ne soit appliquée : l'état des deux entités y est donc intégralement
 * d'AVANT match (note, nombre de matchs, dernier match joué, historique). C'est
 * ce qui permet au backtest de constituer son jeu de données sans réimplémenter
 * cette boucle — deux passes chronologiques concurrentes finiraient par diverger,
 * et le backtest mesurerait alors autre chose que ce que l'application affiche.
 * Le crochet ne doit rien muter : il reçoit les objets d'état par référence.
 *
 * @returns {object} structure prête à sérialiser dans elo/ranking.json
 */
export async function computeElo(years, seeds, { onMatch, params: override } = {}) {
  // Les paramètres sont surchargeables pour permettre leur RÉGLAGE mesuré : ils
  // ont tous été choisis à la main au démarrage du projet et jamais évalués.
  // Sans surcharge, le comportement est identique à PARAMS.
  const PARAMS = override ? { ...BASE_PARAMS, ...override } : BASE_PARAMS;
  const expected = expectedWith(PARAMS.scale);
  // Accepte une année seule ou une liste : l'Elo se déroule en continu sur
  // tout l'historique fourni (les ratings se transmettent d'une saison à l'autre).
  // seeds (optionnel) = { discipline: Map(cléEntité -> Elo de départ) }.
  const hasSeeds = seeds && Object.keys(seeds).length > 0;
  const yearList = (Array.isArray(years) ? years : [years]).slice().sort((a, b) => a - b);
  const all = [];
  for (const y of yearList) all.push(...(await store.listAllMatches(y)));

  // Tri chronologique : les matchs sans horodatage passent en dernier.
  all.sort((a, b) =>
    (a.match.matchTime || "9999").localeCompare(b.match.matchTime || "9999")
  );

  // discipline -> Map(entityKey -> état)
  const tables = {};
  for (const code of Object.keys(DISCIPLINES)) tables[code] = new Map();

  // Historique de cote PAR JOUEUR : l'Elo de l'entité dans laquelle il joue,
  // match après match (son Elo perso en simple, l'Elo de sa paire en double).
  const playerHistory = {};

  let processed = 0, skipped = 0;

  for (const { tmtId, drawId, match } of all) {
    const disc = match.eventName;
    if (!DISCIPLINES[disc]) { skipped++; continue; }
    if (match.winner !== 1 && match.winner !== 2) { skipped++; continue; }

    const p1 = match.team1?.players ?? [];
    const p2 = match.team2?.players ?? [];
    const need = isSingles(disc) ? 1 : 2;
    if (p1.length < need || p2.length < need) { skipped++; continue; }

    const table = tables[disc];
    const k1 = entityKey(disc, p1);
    const k2 = entityKey(disc, p2);

    const ensure = (key, players) => {
      let e = table.get(key);
      if (!e) {
        const start = hasSeeds ? (seeds[disc]?.get(key) ?? PARAMS.seedBottom) : PARAMS.initial;
        e = { key, ...entityMeta(disc, players), rating: start,
              matches: 0, wins: 0, losses: 0, peak: start,
              history: [], lastPlayed: null };
        table.set(key, e);
      } else {
        // Rafraîchit les métadonnées (nom/avatar les plus récents).
        Object.assign(e, entityMeta(disc, players), { key, rating: e.rating,
          matches: e.matches, wins: e.wins, losses: e.losses, peak: e.peak,
          history: e.history, lastPlayed: e.lastPlayed });
      }
      return e;
    };

    const e1 = ensure(k1, p1);
    const e2 = ensure(k2, p2);

    const exp1 = expected(e1.rating, e2.rating);
    const s1 = match.winner === 1 ? 1 : 0;
    // Multiplicateur de manches (2-1 pèse moins qu'un 2-0)…
    let mult = marginMultiplier(match.score, PARAMS.threeSetMultiplier);
    // …et, si la variante Elo-bis est activée (pointsFactor > 0), modulation
    // par la marge de POINTS du vainqueur. Neutre en production.
    if (PARAMS.pointsFactor) {
      const gapWinner = s1 === 1 ? e1.rating - e2.rating : e2.rating - e1.rating;
      mult *= pointsMultiplier(winnerPointShare(match.score, match.winner), gapWinner, PARAMS);
    }
    const kOf = (e) => (e.matches < PARAMS.provisionalMatches ? PARAMS.kProvisional : PARAMS.k) * mult;

    const d1 = kOf(e1) * (s1 - exp1);
    const d2 = kOf(e2) * ((1 - s1) - (1 - exp1));

    // Crochet d'AVANT match : rien n'a encore été muté, e1/e2 portent donc
    // l'état des entités tel qu'il était à l'instant du match. Placé ici et
    // pas plus bas : dès la ligne suivante, rating/matches/lastPlayed/history
    // sont modifiés et l'information deviendrait postérieure au match.
    onMatch?.({
      tmtId, drawId, disc, match,
      won: s1,                       // 1 si team1 gagne
      a: { key: k1, players: p1, entity: e1 },
      b: { key: k2, players: p2, entity: e2 },
    });

    e1.rating += d1; e2.rating += d2;
    e1.matches++; e2.matches++;
    if (s1 === 1) { e1.wins++; e2.losses++; } else { e1.losses++; e2.wins++; }
    e1.peak = Math.max(e1.peak, e1.rating);
    e2.peak = Math.max(e2.peak, e2.rating);
    const when = match.matchTime || null;
    e1.lastPlayed = when; e2.lastPlayed = when;
    const n1 = p1.map((p) => p.nameDisplay).join(" / ");
    const n2 = p2.map((p) => p.nameDisplay).join(" / ");
    const tmtName = match.tournamentName || null;
    const rnd = match.roundName || null;
    // Historique enrichi de l'entité (sert au graphe de la fiche paire et à la forme).
    e1.history.push({ t: when, r: Math.round(e1.rating), d: Math.round(d1), disc, tmtId, tmt: tmtName, round: rnd, won: s1 === 1, opp: n2, vs: e2.key });
    e2.history.push({ t: when, r: Math.round(e2.rating), d: Math.round(d2), disc, tmtId, tmt: tmtName, round: rnd, won: s1 === 0, opp: n1, vs: e1.key });
    for (const pl of p1) (playerHistory[String(pl.id)] ??= []).push({ t: when, r: Math.round(e1.rating), d: Math.round(d1), disc, won: s1 === 1, tmtId, tmt: tmtName, round: rnd, opp: n2 });
    for (const pl of p2) (playerHistory[String(pl.id)] ??= []).push({ t: when, r: Math.round(e2.rating), d: Math.round(d2), disc, won: s1 === 0, tmtId, tmt: tmtName, round: rnd, opp: n1 });
    processed++;
  }

  // Variation de forme = somme des deltas sur les N derniers matchs.
  const formOf = (e) => {
    const recent = e.history.slice(-PARAMS.formWindow);
    return Math.round(recent.reduce((sum, h) => sum + h.d, 0));
  };

  const disciplines = {};
  for (const [code, label] of Object.entries(DISCIPLINES)) {
    const entities = [...tables[code].values()]
      .sort((a, b) => b.rating - a.rating)
      .map((e, i) => ({
        rank: i + 1,
        key: e.key,
        type: e.type,
        name: e.name,
        country: e.country,
        players: e.players,
        rating: Math.round(e.rating),
        peak: Math.round(e.peak),
        matches: e.matches,
        wins: e.wins,
        losses: e.losses,
        provisional: e.matches < PARAMS.provisionalMatches,
        form: formOf(e),
        lastPlayed: e.lastPlayed,
      }));
    disciplines[code] = { code, label, type: isSingles(code) ? "player" : "pair", entities };
  }

  // Historique de cote PAR PAIRE (double uniquement) : l'Elo de l'association,
  // match après match — alimente le graphe de la fiche paire.
  const pairHistory = {};
  for (const code of Object.keys(DISCIPLINES)) {
    if (isSingles(code)) continue;
    for (const e of tables[code].values()) pairHistory[e.key] = e.history;
  }

  return {
    year: yearList[yearList.length - 1],
    years: yearList,
    generatedAt: new Date().toISOString(),
    params: PARAMS,
    stats: { processed, skipped },
    disciplines,
    playerHistory,
    pairHistory,
  };
}

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
export const PARAMS = {
  initial: 1500,        // Elo de départ
  k: 32,                // facteur K standard (échecs)
  kProvisional: 48,     // K plus fort tant que l'entité a peu de matchs (convergence rapide)
  provisionalMatches: 5,// en dessous : ratings "provisoires"
  threeSetMultiplier: 0.85, // un match gagné en 3 manches informe un peu moins qu'un 2-0
  formWindow: 5,        // "forme" = variation d'Elo sur les N derniers matchs
};

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
function marginMultiplier(score) {
  if (!Array.isArray(score) || score.length === 0) return 1;
  let winnerSets = 0, loserSets = 0;
  for (const s of score) {
    if (s.home > s.away) winnerSets++;
    else if (s.away > s.home) loserSets++;
  }
  // best-of-3 : 2-1 => match serré, moins d'information.
  return loserSets >= 1 ? PARAMS.threeSetMultiplier : 1;
}

const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

/**
 * Calcule les classements Elo de l'année.
 * @returns {object} structure prête à sérialiser dans elo/ranking.json
 */
export async function computeElo(years) {
  // Accepte une année seule ou une liste : l'Elo se déroule en continu sur
  // tout l'historique fourni (les ratings se transmettent d'une saison à l'autre).
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

  for (const { tmtId, match } of all) {
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
        e = { key, ...entityMeta(disc, players), rating: PARAMS.initial,
              matches: 0, wins: 0, losses: 0, peak: PARAMS.initial,
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
    const mult = marginMultiplier(match.score);
    const kOf = (e) => (e.matches < PARAMS.provisionalMatches ? PARAMS.kProvisional : PARAMS.k) * mult;

    const d1 = kOf(e1) * (s1 - exp1);
    const d2 = kOf(e2) * ((1 - s1) - (1 - exp1));

    e1.rating += d1; e2.rating += d2;
    e1.matches++; e2.matches++;
    if (s1 === 1) { e1.wins++; e2.losses++; } else { e1.losses++; e2.wins++; }
    e1.peak = Math.max(e1.peak, e1.rating);
    e2.peak = Math.max(e2.peak, e2.rating);
    const when = match.matchTime || null;
    e1.lastPlayed = when; e2.lastPlayed = when;
    e1.history.push({ t: when, r: Math.round(e1.rating), d: Math.round(d1), tmtId, won: s1 === 1, vs: e2.key });
    e2.history.push({ t: when, r: Math.round(e2.rating), d: Math.round(d2), tmtId, won: s1 === 0, vs: e1.key });
    for (const pl of p1) (playerHistory[String(pl.id)] ??= []).push({ t: when, r: Math.round(e1.rating), disc, won: s1 === 1, tmtId });
    for (const pl of p2) (playerHistory[String(pl.id)] ??= []).push({ t: when, r: Math.round(e2.rating), disc, won: s1 === 0, tmtId });
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

  return {
    year: yearList[yearList.length - 1],
    years: yearList,
    generatedAt: new Date().toISOString(),
    params: PARAMS,
    stats: { processed, skipped },
    disciplines,
    playerHistory,
  };
}

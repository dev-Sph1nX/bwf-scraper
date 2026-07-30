// lib/rank-history.mjs
// Construit les séries exploitables à partir des publications hebdomadaires
// stockées dans data/rankings/.
//
// Deux sorties :
//   - buildWorldMap(publication)      -> le classement d'UNE semaine, indexé par
//                                        clé d'entité (remplace l'ancien instantané unique)
//   - buildPlayerRankHistory(pubs)    -> la série temporelle par JOUEUR
//
// Convention de clé identique à build-data.mjs et lib/elo.mjs :
//   simple : p:<id>            double : pair:<id1>-<id2> (ids triés en chaînes)

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Clé d'entité (joueur seul ou paire), même convention que l'Elo. */
export function entityKeyOf(players) {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length === 1 ? `p:${ids[0]}` : `pair:${ids.join("-")}`;
}

/** Classement d'une publication, indexé discipline -> Map(clé -> {rank, points}). */
export function buildWorldMap(publication) {
  const out = {};
  for (const [disc, rows] of Object.entries(publication?.disciplines || {})) {
    const m = new Map();
    for (const row of rows) {
      m.set(entityKeyOf(row.players), { rank: row.rank, points: row.points });
    }
    out[disc] = m;
  }
  return out;
}

/**
 * Série temporelle du classement mondial par joueur.
 *
 * Une entrée par (semaine, discipline). Un joueur engagé dans deux paires la
 * même semaine ne garde que son MEILLEUR rang — sinon la courbe aurait deux
 * points au même instant. Aucune entrée n'est inventée pour une semaine où le
 * joueur est absent : le trou est significatif (sortie du top).
 */
export function buildPlayerRankHistory(publications) {
  const out = {};

  for (const pub of publications) {
    for (const [disc, rows] of Object.entries(pub?.disciplines || {})) {
      // meilleur rang de la semaine, par joueur
      const best = new Map(); // playerId -> row
      for (const row of rows) {
        for (const pl of row.players) {
          const id = String(pl.id);
          const prev = best.get(id);
          if (!prev || row.rank < prev.rank) best.set(id, row);
        }
      }
      for (const [id, row] of best) {
        (out[id] ??= []).push({
          t: pub.date,
          disc,
          rank: row.rank,
          points: row.points,
          key: entityKeyOf(row.players),
        });
      }
    }
  }

  for (const id of Object.keys(out)) {
    out[id].sort((a, b) => a.t.localeCompare(b.t) || a.disc.localeCompare(b.disc));
  }
  return out;
}

/** Charge toutes les publications d'un répertoire, triées par date croissante. */
export async function loadPublications(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const out = [];
  for (const n of files) {
    out.push(JSON.parse(await readFile(join(dir, n), "utf8")));
  }
  return out;
}

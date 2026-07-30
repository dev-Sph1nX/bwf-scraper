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

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
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

/**
 * Nombre de lignes toutes disciplines confondues (0 si publication vide ou
 * absente). Sert à distinguer une vraie publication d'un `total: 0, data: []`
 * renvoyé en HTTP 200 par vue-rankingtable pour un `publicationId` qu'elle ne
 * sert plus (cf. `savePublication` ci-dessous et build-data.mjs).
 */
export function publicationTotal(pub) {
  return Object.values(pub?.disciplines || {}).reduce((sum, rows) => sum + (rows?.length || 0), 0);
}

/**
 * Écrit le fichier d'une publication (une par semaine) au format lu par
 * `loadPublications`/`buildWorldMap`/`buildPlayerRankHistory` ci-dessus. Point
 * d'écriture UNIQUE, partagé par fetch-rankings.mjs et backfill-rankings.mjs,
 * pour que le format ne puisse pas diverger entre les deux writers.
 *
 * Refuse d'écrire une publication VIDE (0 ligne sur les 5 disciplines) :
 * l'API répond parfois `total: 0, data: []` en HTTP 200 sans erreur pour un
 * `publicationId` qu'elle ne sert pas (ou plus). Écrire quand même figerait un
 * fichier vide dont l'existence est le SEUL critère d'idempotence des deux
 * scripts appelants : la publication ne serait alors plus jamais retentée, et
 * build-data.mjs prendrait cette publication vide pour la dernière connue
 * (rang mondial et points nuls sur toutes les entités Elo, silencieusement et
 * pour toujours). En refusant ici, l'appelant journalise le refus et le run
 * suivant reprend naturellement cette publication comme manquante.
 *
 * @param {string} dir       répertoire data/rankings
 * @param {{publicationId:number, date:string, week:number, year:number}} pub
 *   entrée de l'index (identité + datation de la publication)
 * @param {{rankId:number, depth:number, fetchedAt:string, disciplines:object}} data
 *   résultat de `fetchPublication` (lib/rankings.mjs)
 * @returns {Promise<boolean>} true si écrit, false si refusé (publication vide)
 */
export async function savePublication(dir, pub, data) {
  if (publicationTotal(data) === 0) return false;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${pub.date}.json`), JSON.stringify({
    publicationId: pub.publicationId,
    date: pub.date,
    week: pub.week,
    year: pub.year,
    rankId: data.rankId,
    depth: data.depth,
    fetchedAt: data.fetchedAt,
    disciplines: data.disciplines,
  }), "utf8");
  return true;
}

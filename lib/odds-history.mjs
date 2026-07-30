// lib/odds-history.mjs
// Historisation des cotes : reconstitue l'évolution de chaque match dans le temps
// à partir de relevés successifs.
//
// POURQUOI. L'ancien stockage écrasait `data/odds/<date>.json` à chaque passage :
// on ne gardait que la dernière photo, et toute l'évolution était perdue. Or
// c'est justement l'évolution qui porte l'information :
//
//   - la COTE DE CLÔTURE (la dernière avant le match) est la référence du
//     marché, celle qui intègre toute l'information disponible. C'est le seul
//     étalon qui dise si notre modèle bat les bookmakers — donc s'il peut
//     rapporter de l'argent. Battre le hasard ou le classement officiel ne
//     suffit pas : le bookmaker prend 8,6 % de commission.
//   - le SENS DU MOUVEMENT entre l'ouverture et la clôture dit ce que le marché
//     a appris entre-temps. Un pari pris avant que la cote ne se resserre est un
//     pari où l'on a vu juste avant les autres (c'est la Closing Line Value).
//
// STOCKAGE. Un fichier par passage dans `data/odds/runs/<horodatage>.json`,
// jamais réécrit. L'append-only est structurel, pas une convention : un fichier
// nommé par l'instant du relevé ne peut pas entrer en collision avec un autre.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Nom de fichier d'un passage, à partir de son horodatage ISO. */
export const runFileName = (fetchedAt) => `${String(fetchedAt).replace(/[:.]/g, "-")}.json`;

/**
 * Probabilité implicite du camp 1, commission du bookmaker retirée.
 *
 * Sans ce retrait, la somme des probabilités des deux camps dépasse 100 % (8,6 %
 * de marge mesurée sur nos données) et toute comparaison à notre modèle serait
 * biaisée en faveur du bookmaker.
 */
export function impliedP1(odd1, odd2) {
  if (!(odd1 > 1) || !(odd2 > 1)) return null;
  const i1 = 1 / odd1, i2 = 1 / odd2;
  return i1 / (i1 + i2);
}

/** Commission du bookmaker (overround) : 0,086 = 8,6 %. */
export function overround(odd1, odd2) {
  if (!(odd1 > 1) || !(odd2 > 1)) return null;
  return 1 / odd1 + 1 / odd2 - 1;
}

/** Charge tous les relevés d'un répertoire, triés du plus ancien au plus récent. */
export async function loadRuns(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const runs = [];
  for (const n of names.filter((x) => x.endsWith(".json")).sort()) {
    const r = JSON.parse(await readFile(join(dir, n), "utf8"));
    if (r?.fetchedAt) runs.push(r);
  }
  return runs.sort((a, b) => String(a.fetchedAt).localeCompare(String(b.fetchedAt)));
}

/**
 * Reconstitue la série temporelle de chaque match.
 *
 * Les relevés consécutifs IDENTIQUES sont fusionnés en un seul point : garder
 * dix fois la même cote alourdirait le fichier et rendrait le graphe illisible,
 * sans rien apprendre. On conserve l'instant du premier relevé de cette valeur
 * (le moment où la cote a pris cette valeur) et `lastSeen` (jusqu'à quand elle a
 * tenu).
 *
 * @param {Array<{fetchedAt:string, matches:Array}>} runs  triés par date croissante
 * @returns {Array<object>} une entrée par eventId
 */
export function buildOddsSeries(runs) {
  const parEvent = new Map();

  for (const run of runs) {
    for (const m of run.matches || []) {
      if (!m.eventId) continue;
      let e = parEvent.get(m.eventId);
      if (!e) {
        e = {
          eventId: m.eventId, date: m.date, time: m.time,
          discipline: m.discipline, tournamentKey: m.tournamentKey, league: m.league,
          href: m.href, p1: m.p1, p2: m.p2, settled: !!m.settled,
          points: [],
        };
        parEvent.set(m.eventId, e);
      }
      // Les métadonnées suivent le dernier relevé : un match « à venir » devient
      // « joué », et l'horaire peut être précisé entre-temps.
      e.settled = !!m.settled;
      if (m.time) e.time = m.time;
      if (m.date) e.date = m.date;

      if (m.odd1 == null || m.odd2 == null) continue;
      const dernier = e.points[e.points.length - 1];
      if (dernier && dernier.odd1 === m.odd1 && dernier.odd2 === m.odd2) {
        dernier.lastSeen = run.fetchedAt;   // même cote : on prolonge
        continue;
      }
      e.points.push({
        at: run.fetchedAt, lastSeen: run.fetchedAt,
        odd1: m.odd1, odd2: m.odd2,
        impliedP1: impliedP1(m.odd1, m.odd2),
      });
    }
  }

  const out = [];
  for (const e of parEvent.values()) {
    const pts = e.points;
    const ouverture = pts[0] ?? null;
    const cloture = pts[pts.length - 1] ?? null;
    out.push({
      ...e,
      readings: pts.length,
      opening: ouverture,
      closing: cloture,
      moved: pts.length > 1,
      // Dérive de la probabilité implicite du camp 1, de l'ouverture à la
      // clôture. Positive = le marché s'est déplacé VERS le camp 1.
      driftP1: ouverture && cloture && ouverture.impliedP1 != null && cloture.impliedP1 != null
        ? cloture.impliedP1 - ouverture.impliedP1
        : null,
      overround: cloture ? overround(cloture.odd1, cloture.odd2) : null,
    });
  }
  return out.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

/** Statistiques de couverture de l'historique. */
export function historyStats(series) {
  const avecCote = series.filter((s) => s.readings > 0);
  const bouge = series.filter((s) => s.moved);
  const derives = bouge.map((s) => s.driftP1).filter((v) => v != null);
  return {
    events: series.length,
    withOdds: avecCote.length,
    moved: bouge.length,
    settled: series.filter((s) => s.settled).length,
    readingsTotal: series.reduce((a, s) => a + s.readings, 0),
    readingsMax: series.reduce((a, s) => Math.max(a, s.readings), 0),
    meanAbsDrift: derives.length ? derives.reduce((a, v) => a + Math.abs(v), 0) / derives.length : null,
    meanOverround: (() => {
      const o = series.map((s) => s.overround).filter((v) => v != null);
      return o.length ? o.reduce((a, v) => a + v, 0) / o.length : null;
    })(),
  };
}

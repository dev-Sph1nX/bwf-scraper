// lib/views.mjs
// Construit les "vues" (objets JSON) affichées par le front, à partir du store.
// Partagé par server.mjs (mode local dynamique) et build-static.mjs (export statique).

import * as store from "./store.mjs";

export function flatten(yearData) {
  return (yearData?.results ?? []).flatMap((m) => m.tournaments);
}

// Index joueur -> ses matchs, à partir de tous les fichiers stockés.
export async function buildPlayerIndex(year) {
  const all = await store.listAllMatches(year);
  const index = new Map();
  for (const { tmtId, drawId, match } of all) {
    for (const teamKey of ["team1", "team2"]) {
      const team = match[teamKey];
      for (const pl of team?.players ?? []) {
        let entry = index.get(pl.id);
        if (!entry) {
          entry = { id: pl.id, nameDisplay: pl.nameDisplay, countryCode: pl.countryCode, slug: pl.slug, matches: [] };
          index.set(pl.id, entry);
        }
        entry.matches.push({
          tmtId,
          drawId,
          tournamentName: match.tournamentName,
          eventName: match.eventName,
          roundName: match.roundName,
          matchTime: match.matchTime,
          side: teamKey,
          won: (teamKey === "team1" && match.winner === 1) || (teamKey === "team2" && match.winner === 2),
          team1: match.team1,
          team2: match.team2,
          score: match.score,
          winner: match.winner,
        });
      }
    }
  }
  return index;
}

export async function getSummary(year) {
  const yearData = await store.getYear(year);
  const manifest = await store.getManifest();

  let tournamentsTotal = 0;
  const downloadedList = [];
  if (yearData) {
    const tournaments = flatten(yearData);
    tournamentsTotal = tournaments.length;
    for (const t of tournaments) {
      const draws = await store.getDraws(year, t.id);
      if (!draws) continue;
      let drawCount = 0, matchCount = 0;
      for (const d of draws.results) {
        const meta = await store.drawMeta(year, t.id, d.value);
        if (meta) { drawCount++; matchCount += meta.matchCount ?? 0; }
      }
      if (drawCount > 0) downloadedList.push({ id: t.id, name: t.name, drawCount, matchCount });
    }
  }
  const allMatches = await store.listAllMatches(year);
  const index = await buildPlayerIndex(year);
  const lastRun = await store.getLastRun(year);

  // Plage temporelle + répartition par discipline (pour la page Données)
  let firstMatch = null, lastMatch = null;
  const matchesByDiscipline = {};
  for (const { match } of allMatches) {
    const t = match.matchTime;
    if (t) {
      if (!firstMatch || t < firstMatch) firstMatch = t;
      if (!lastMatch || t > lastMatch) lastMatch = t;
    }
    const d = match.eventName;
    if (d) matchesByDiscipline[d] = (matchesByDiscipline[d] || 0) + 1;
  }

  return {
    year,
    lastUpdate: manifest.years?.[year]?.fetchedAt ?? null,
    tournamentsTotal,
    tournamentsDownloaded: downloadedList.length,
    downloadedList,
    matchCount: allMatches.length,
    playerCount: index.size,
    firstMatch,
    lastMatch,
    matchesByDiscipline,
    lastRun,
  };
}

export async function getStatus(year) {
  const yearData = await store.getYear(year);
  if (!yearData) return { year, tournaments: [] };
  const tournaments = [];
  for (const t of flatten(yearData)) {
    const draws = await store.getDraws(year, t.id);
    let drawCount = 0, matchCount = 0;
    if (draws) {
      for (const d of draws.results) {
        const meta = await store.drawMeta(year, t.id, d.value);
        if (meta) { drawCount++; matchCount += meta.matchCount ?? 0; }
      }
    }
    tournaments.push({
      id: t.id, name: t.name, date: t.date, category: t.category,
      country: t.country, flag_url: t.flag_url, live_status: t.live_status,
      statusLabel: t.status?.label ?? "",
      drawsTotal: draws ? draws.results.length : 0, drawCount, matchCount,
    });
  }
  return { year, tournaments };
}

export async function getPlayersList(year) {
  const index = await buildPlayerIndex(year);
  const players = [...index.values()]
    .map((p) => ({ id: p.id, nameDisplay: p.nameDisplay, countryCode: p.countryCode, slug: p.slug, matchCount: p.matches.length }))
    .sort((a, b) => b.matchCount - a.matchCount);
  return { year, players };
}

export async function getPlayer(year, id) {
  const index = await buildPlayerIndex(year);
  const p = index.get(String(id));
  if (!p) return null;
  return { year, player: { id: p.id, nameDisplay: p.nameDisplay, countryCode: p.countryCode, slug: p.slug }, matches: p.matches };
}

export async function getTournament(year, tmtId) {
  const yearData = await store.getYear(year);
  const info = yearData ? flatten(yearData).find((t) => t.id === Number(tmtId)) ?? null : null;
  const draws = await store.getDraws(year, tmtId);
  const disciplines = [];
  if (draws) {
    for (const d of draws.results) {
      const data = await store.getDraw(year, tmtId, d.value);
      disciplines.push({
        drawId: d.value, label: d.text, size: d.size, stage: d.stage_name,
        doubles: d.doubles,
        results: data ? data.results ?? {} : {},
        matchCount: data ? (data.matches ?? []).length : 0,
      });
    }
  }
  return { year, tmtId: Number(tmtId), info, disciplines };
}

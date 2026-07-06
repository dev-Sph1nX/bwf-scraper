// build-data.mjs
// Génère les fichiers JSON statiques consommés par l'app React, à partir du
// store (dossier data/). Écrit dans web/public/data/.
//
// MULTI-ANNÉES : agrège toutes les saisons présentes dans data/<year>.
//   - Elo calculé sur tout l'historique (les ratings se transmettent).
//   - Listes joueurs / tournois navigables sur toutes les saisons.
//   - Comparaison Elo ↔ classement mondial officiel BWF (si dispo).
//
//   node build-data.mjs

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as views from "./lib/views.mjs";
import * as store from "./lib/store.mjs";
import { computeElo } from "./lib/elo.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "web", "public", "data");

async function write(rel, obj) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj), "utf8");
}

const years = await store.listYears();
if (!years.length) years.push(Number(process.argv[2]) || new Date().getFullYear());
const latestYear = years[years.length - 1];
console.log(`Génération multi-années : ${years.join(", ")}`);

await rm(OUT, { recursive: true, force: true });

// ===== 1) Elo sur tout l'historique =====
const elo = await computeElo(years);
const { playerHistory, ...ranking } = elo;

// ===== 2) Classement mondial officiel BWF + comparaison =====
let worldMeta = null;
const worldMap = {}; // disc -> Map(entityKey -> {rank, points})
const wrPath = join(ROOT, "data", String(latestYear), "rankings", "world.json");
if (existsSync(wrPath)) {
  const wr = JSON.parse(await readFile(wrPath, "utf8"));
  worldMeta = { fetchedAt: wr.fetchedAt };
  for (const [disc, rows] of Object.entries(wr.disciplines || {})) {
    const m = new Map();
    for (const row of rows) {
      const ids = row.players.map((p) => String(p.id)).sort();
      const key = ids.length === 1 ? `p:${ids[0]}` : `pair:${ids.join("-")}`;
      m.set(key, { rank: row.rank, points: row.points });
    }
    worldMap[disc] = m;
  }
}

// Enrichit chaque entité Elo de son rang mondial + construit la comparaison par joueur
const playerCompare = {}; // id -> [{disc, eloRank, eloRating, matches, bwfRank, bwfPoints}]
for (const [disc, d] of Object.entries(ranking.disciplines)) {
  const wm = worldMap[disc];
  for (const e of d.entities) {
    const bwf = wm?.get(e.key) || null;
    e.bwfRank = bwf?.rank ?? null;
    e.bwfPoints = bwf?.points ?? null;
    for (const p of e.players) {
      (playerCompare[p.id] ??= []).push({
        disc, key: e.key, name: e.name,
        eloRank: e.rank, eloRating: e.rating, matches: e.matches,
        bwfRank: e.bwfRank, bwfPoints: e.bwfPoints,
      });
    }
  }
}
ranking.worldRanking = worldMeta;
await write("elo/ranking.json", ranking);
console.log(`   Elo : ${ranking.stats.processed} matchs — classement mondial : ${worldMeta ? "intégré" : "absent"}`);

// ===== 3) Index joueur fusionné (UNE lecture par année) + stats =====
const index = new Map(); // id -> {id, nameDisplay, countryCode, slug, matches:[], years:Set}
const byDiscipline = {};
let firstMatch = null, lastMatch = null;
const yearMatchCount = {};

for (const y of years) {
  const all = await store.listAllMatches(y);
  yearMatchCount[y] = all.length;
  for (const { tmtId, drawId, match } of all) {
    const t = match.matchTime;
    if (t) { if (!firstMatch || t < firstMatch) firstMatch = t; if (!lastMatch || t > lastMatch) lastMatch = t; }
    if (match.eventName) byDiscipline[match.eventName] = (byDiscipline[match.eventName] || 0) + 1;
    for (const teamKey of ["team1", "team2"]) {
      for (const pl of match[teamKey]?.players ?? []) {
        let e = index.get(pl.id);
        if (!e) { e = { id: pl.id, nameDisplay: pl.nameDisplay, countryCode: pl.countryCode, slug: pl.slug, matches: [], years: new Set() }; index.set(pl.id, e); }
        e.matches.push({
          tmtId, drawId, tournamentName: match.tournamentName, eventName: match.eventName,
          roundName: match.roundName, matchTime: match.matchTime, side: teamKey,
          won: (teamKey === "team1" && match.winner === 1) || (teamKey === "team2" && match.winner === 2),
          team1: match.team1, team2: match.team2, score: match.score, winner: match.winner, year: y,
        });
        e.years.add(y);
        e.nameDisplay = pl.nameDisplay; e.countryCode = pl.countryCode; e.slug = pl.slug;
      }
    }
  }
}

// ===== 4) players.json + fiches joueurs =====
const playersList = [];
let pCount = 0;
for (const e of index.values()) {
  const yrs = [...e.years].sort();
  playersList.push({ id: e.id, nameDisplay: e.nameDisplay, countryCode: e.countryCode, slug: e.slug, matchCount: e.matches.length, years: yrs });
  await write(`player/${e.id}.json`, {
    years: yrs,
    player: { id: e.id, nameDisplay: e.nameDisplay, countryCode: e.countryCode, slug: e.slug },
    matches: e.matches,
    elo: playerHistory[e.id] || [],
    comparison: playerCompare[e.id] || [],
  });
  pCount++;
}
playersList.sort((a, b) => b.matchCount - a.matchCount);
await write("players.json", { years, players: playersList });

// ===== 5) Tournois (toutes saisons) : status.json + fiches tournoi =====
const allTournaments = [];
let tCount = 0, tournamentsTotal = 0, tournamentsDownloaded = 0;
const byYear = [];
for (const y of years) {
  const status = await views.getStatus(y);
  let dl = 0;
  for (const t of status.tournaments) {
    allTournaments.push({ ...t, year: y });
    if (t.matchCount > 0) { await write(`tournament/${t.id}.json`, await views.getTournament(y, t.id)); tCount++; dl++; }
  }
  tournamentsTotal += status.tournaments.length;
  tournamentsDownloaded += dl;
  byYear.push({ year: y, matchCount: yearMatchCount[y] || 0, tournaments: dl });
}
await write("status.json", { years, tournaments: allTournaments });

// ===== 6) summary.json (agrégat multi-années) =====
const manifest = await store.getManifest();
await write("summary.json", {
  years, latestYear,
  lastUpdate: manifest.years?.[latestYear]?.fetchedAt ?? null,
  matchCount: Object.values(yearMatchCount).reduce((a, b) => a + b, 0),
  playerCount: index.size,
  tournamentsDownloaded, tournamentsTotal,
  firstMatch, lastMatch,
  matchesByDiscipline: byDiscipline,
  byYear,
  worldRanking: worldMeta,
});

console.log(`✅ ${tCount} tournois, ${pCount} joueurs, saisons ${years.join(", ")}`);

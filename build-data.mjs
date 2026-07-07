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
import { computeElo, seedEloByRank } from "./lib/elo.mjs";
import { loadInitialRanks } from "./lib/seeds.mjs";

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

// ===== 1) Elo sur tout l'historique (seedé par le classement mondial initial) =====
const initRanks = loadInitialRanks();
const seeds = {};
let seededCount = 0;
for (const [disc, m] of Object.entries(initRanks)) {
  const sm = new Map();
  for (const [key, rank] of m) { sm.set(key, seedEloByRank(rank)); seededCount++; }
  seeds[disc] = sm;
}
console.log(`   Seed initial : ${seededCount} entités depuis le classement mondial (data/seeds/)`);
const elo = await computeElo(years, seeds);
const { playerHistory, pairHistory, ...ranking } = elo;

const DOUBLES = new Set(["MD", "WD", "XD"]);
const pairKeyOf = (players) => `pair:${players.map((p) => String(p.id)).sort().join("-")}`;

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
      const partner = e.players.filter((x) => String(x.id) !== String(p.id)).map((x) => x.name).join(" / ") || null;
      (playerCompare[p.id] ??= []).push({
        disc, key: e.key, name: e.name, partner,
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
const pairMatchIndex = new Map(); // cléPaire -> matchs joués ENSEMBLE (perspective de l'équipe)
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
      const players = match[teamKey]?.players ?? [];
      const won = (teamKey === "team1" && match.winner === 1) || (teamKey === "team2" && match.winner === 2);
      const entry = {
        tmtId, drawId, tournamentName: match.tournamentName, eventName: match.eventName,
        roundName: match.roundName, matchTime: match.matchTime, side: teamKey, won,
        team1: match.team1, team2: match.team2, score: match.score, winner: match.winner, year: y,
      };
      for (const pl of players) {
        let e = index.get(pl.id);
        if (!e) { e = { id: pl.id, nameDisplay: pl.nameDisplay, countryCode: pl.countryCode, slug: pl.slug, matches: [], years: new Set() }; index.set(pl.id, e); }
        e.matches.push(entry);
        e.years.add(y);
        e.nameDisplay = pl.nameDisplay; e.countryCode = pl.countryCode; e.slug = pl.slug;
      }
      // Match de paire = double avec 2 joueurs sur la même équipe.
      if (DOUBLES.has(match.eventName) && players.length >= 2) {
        const key = pairKeyOf(players);
        let arr = pairMatchIndex.get(key);
        if (!arr) { arr = []; pairMatchIndex.set(key, arr); }
        arr.push(entry);
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

// ===== 4b) Fiches paires (double) : résultats réalisés ENSEMBLE =====
let pairCount = 0;
for (const disc of DOUBLES) {
  const d = ranking.disciplines[disc];
  if (!d) continue;
  for (const e of d.entities) {
    const matchList = (pairMatchIndex.get(e.key) || [])
      .slice()
      .sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || ""));
    const yrs = [...new Set(matchList.map((m) => m.year))].sort();
    await write(`pair/${e.key.slice(5)}.json`, {
      key: e.key,
      disc,
      discLabel: d.label,
      players: e.players,
      country: e.country,
      years: yrs,
      rank: e.rank, rating: e.rating, peak: e.peak,
      matches: e.matches, wins: e.wins, losses: e.losses,
      provisional: e.provisional, form: e.form,
      bwfRank: e.bwfRank ?? null, bwfPoints: e.bwfPoints ?? null,
      elo: pairHistory[e.key] || [],
      matchList,
    });
    pairCount++;
  }
}
console.log(`   Paires : ${pairCount} fiches`);

// ===== 5) Tournois (toutes saisons) : status.json + fiches tournoi =====
const allTournaments = [];
const upcomingMatches = []; // matchs prévus (non joués) des tournois à venir / en cours
let tCount = 0, tournamentsTotal = 0, tournamentsDownloaded = 0;
const byYear = [];

const teamLite = (team, seed) => ({
  players: (team?.players || []).map((p) => ({ id: String(p.id), nameDisplay: p.nameDisplay, countryFlagUrl: p.countryFlagUrl })),
  country: team?.countryCode || null,
  seed: seed || null,
});
const entityId = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
};
// Probabilité de victoire de A selon l'écart Elo (même formule que le prédicteur).
const winProb = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
// Lookup Elo par discipline (clé = même schéma que entityId) pour enrichir les matchs à venir.
const eloLookup = {};
for (const [disc, d] of Object.entries(ranking.disciplines)) {
  const m = new Map();
  for (const e of d.entities) m.set(entityId(e.players), e);
  eloLookup[disc] = m;
}
// Ajoute cote Elo / rang mondial / forme à une équipe (si l'entité est classée).
const withElo = (team, entity) => ({
  ...team,
  elo: entity?.rating ?? null,
  bwfRank: entity?.bwfRank ?? null,
  form: entity?.form ?? null,
});

// ===== Score d'intérêt d'un match à venir (analyse "value") =====
// Idée : la valeur d'un pari vient de l'écart entre notre proba (Elo/forme) et le
// consensus (classement mondial), pondéré par la fiabilité de notre Elo, plus des
// signaux concrets (H2H contradictoire, momentum, sous-cotation).
const NOW_MS = Date.parse(ranking.generatedAt) || Date.now();
const recency = (lastPlayed) => {
  const t = lastPlayed ? Date.parse(lastPlayed.replace(" ", "T")) : NaN;
  if (!Number.isFinite(t)) return 0.6;
  const days = (NOW_MS - t) / 86400000;
  if (days <= 75) return 1;
  if (days >= 250) return 0.4;
  return 1 - 0.6 * (days - 75) / 175;
};
// Fiabilité de l'Elo d'une entité (0..1) : provisoire, échantillon, fraîcheur.
const reliability = (e) => (e.provisional ? 0.5 : 1) * Math.min(1, Math.max(0.3, (e.matches || 0) / 25)) * recency(e.lastPlayed);
// Consensus = ratio des points mondiaux (Bradley-Terry grossier).
const pRankOf = (ea, eb) => {
  const pa = ea?.bwfPoints, pb = eb?.bwfPoints;
  return pa > 0 && pb > 0 ? pa / (pa + pb) : null;
};
// Bilan des confrontations directes entre 2 entités dans une discipline.
function h2hRecord(aKey, ea, eb, disc) {
  const idsA = ea.players.map((p) => String(p.id));
  const idsB = eb.players.map((p) => String(p.id)).sort().join("-");
  const arr = idsA.length > 1 ? (pairMatchIndex.get(aKey) || []) : (index.get(idsA[0])?.matches || []);
  let w = 0, l = 0;
  for (const m of arr) {
    if (m.eventName !== disc) continue;
    const oppSide = m.side === "team1" ? "team2" : "team1";
    const oppIds = (m[oppSide]?.players || []).map((p) => String(p.id)).sort().join("-");
    if (oppIds === idsB) (m.won ? w++ : l++);
  }
  return { w, l, n: w + l };
}
// Score 0..100 + tags + raisons lisibles. probTeam1 = proba Elo de team1 (0..100).
function interestOf(ea, eb, probTeam1, aKey, bKey, disc, name1, name2) {
  if (!ea || !eb || probTeam1 == null) return { score: 0, tags: [], reasons: [] };
  const pForm1 = probTeam1 / 100;
  const reasons = [], tags = [];
  let score = 0;

  if (Math.abs(pForm1 - 0.5) <= 0.07) tags.push("close");
  if (ea.bwfRank && eb.bwfRank && ea.bwfRank <= 16 && eb.bwfRank <= 16) tags.push("clash");

  const pRank1 = pRankOf(ea, eb);
  const conf = Math.min(reliability(ea), reliability(eb));
  if (pRank1 != null) {
    const underIsT1 = (ea.bwfRank ?? 9999) > (eb.bwfRank ?? 9999);
    const under = underIsT1 ? ea : eb, fav = underIsT1 ? eb : ea;
    const underName = underIsT1 ? name1 : name2, favName = underIsT1 ? name2 : name1;
    const pFormUnder = underIsT1 ? pForm1 : 1 - pForm1;
    const divergence = Math.abs(pForm1 - pRank1); // écart proba forme ↔ consensus
    score += Math.min(1, divergence / 0.35) * conf * 60;
    if (pFormUnder >= 0.42 && conf >= 0.45) {
      tags.push("upset");
      reasons.push(`Notre Elo donne ${Math.round(pFormUnder * 100)}% à ${underName}${under.bwfRank ? ` (#${under.bwfRank} mondial)` : ""}`);
    }
    if ((fav.form ?? 0) < -15 && (under.form ?? 0) > 15) {
      score += 12;
      reasons.push(`${favName} en perte de vitesse, ${underName} en forme`);
    }
    if (under.rank && under.bwfRank && under.rank <= under.bwfRank - 8) {
      score += 10;
      reasons.push(`${underName} #${under.rank} à l'Elo mais #${under.bwfRank} mondial`);
    }
    const h = h2hRecord(aKey, ea, eb, disc);
    if (h.n >= 2) {
      const uW = underIsT1 ? h.w : h.l, fW = underIsT1 ? h.l : h.w;
      if (uW > fW) {
        score += 18 * Math.min(1, h.n / 3);
        reasons.push(`${underName} mène ${uW}-${fW} en confrontations directes`);
      }
    }
  }
  if (tags.includes("close")) score += 8;
  return { score: Math.round(Math.min(100, score)), tags: [...new Set(tags)], reasons };
}

for (const y of years) {
  const status = await views.getStatus(y);
  let dl = 0;
  for (const t of status.tournaments) {
    // JO : source HTML non scrapée (cf. updater) → exclus du calendrier pour ne
    // pas laisser de fiche vide. À réactiver si un parseur dédié est ajouté.
    if (/olympic/i.test(t.name)) continue;
    allTournaments.push({ ...t, year: y });
    if (t.matchCount > 0) {
      const tv = await views.getTournament(y, t.id);
      await write(`tournament/${t.id}.json`, tv);
      tCount++; dl++;

      // Matchs à venir : affiches connues (2 équipes) mais non jouées, hors tournois terminés.
      if (t.live_status !== "post") {
        for (const disc of tv.disciplines) {
          for (const cell of Object.values(disc.results || {})) {
            const m = cell?.match;
            if (!m || m.winner !== 0) continue;
            const p1 = m.team1?.players || [], p2 = m.team2?.players || [];
            if (p1.length === 0 || p2.length === 0) continue;
            const a = entityId(p1), b = entityId(p2);
            const ea = eloLookup[m.eventName]?.get(a) || null;
            const eb = eloLookup[m.eventName]?.get(b) || null;
            const prob = ea && eb ? Math.round(winProb(ea.rating, eb.rating) * 100) : null;
            const name1 = p1.map((p) => p.nameDisplay).join(" / ");
            const name2 = p2.map((p) => p.nameDisplay).join(" / ");
            const interest = interestOf(ea, eb, prob, a, b, m.eventName, name1, name2);
            upcomingMatches.push({
              tmtId: t.id, tournamentName: t.name, year: y,
              startDate: t.start_date || null, endDate: t.end_date || null,
              date: t.date, category: t.category, flag_url: t.flag_url, live_status: t.live_status,
              eventName: m.eventName, roundName: m.roundName,
              team1: withElo(teamLite(m.team1, m.team1seed), ea),
              team2: withElo(teamLite(m.team2, m.team2seed), eb),
              a, b,
              // Proba de victoire de team1 (null si l'une des deux n'est pas classée).
              prob,
              score: interest.score, tags: interest.tags, reasons: interest.reasons,
            });
          }
        }
      }
    }
  }
  tournamentsTotal += status.tournaments.length;
  tournamentsDownloaded += dl;
  byYear.push({ year: y, matchCount: yearMatchCount[y] || 0, tournaments: dl });
}
await write("status.json", { years, tournaments: allTournaments });
await write("upcoming-matches.json", { generatedAt: ranking.generatedAt, matches: upcomingMatches });
console.log(`   Matchs à venir : ${upcomingMatches.length}`);

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

// ===== 7) updates.json : historique des mises à jour (regroupé par jour de récup) =====
// Source = manifest.draws (fetchedAt + matchCount par draw). On somme les matchs
// par tournoi et par journée. Limite : un tournoi live re-téléchargé plusieurs
// jours n'apparaît qu'à sa dernière récup (le manifest écrase le fetchedAt).
const tmtNameById = new Map(allTournaments.map((t) => [String(t.id), t.name]));
const byDay = new Map(); // jour (YYYY-MM-DD) -> Map(tmtId -> {id, name, year, matches, status, lastFetched})
for (const [key, meta] of Object.entries(manifest.draws || {})) {
  if (!meta?.fetchedAt) continue;
  const [y, tmtId] = key.split("/");
  const day = meta.fetchedAt.slice(0, 10);
  let dayMap = byDay.get(day);
  if (!dayMap) { dayMap = new Map(); byDay.set(day, dayMap); }
  let t = dayMap.get(tmtId);
  if (!t) {
    t = { id: Number(tmtId), name: tmtNameById.get(tmtId) || `Tournoi ${tmtId}`, year: Number(y), matches: 0, status: meta.tournamentStatus ?? null, lastFetched: meta.fetchedAt };
    dayMap.set(tmtId, t);
  }
  t.matches += meta.matchCount || 0;
  if (meta.fetchedAt > t.lastFetched) { t.lastFetched = meta.fetchedAt; t.status = meta.tournamentStatus ?? t.status; }
}
const updates = [...byDay.entries()]
  .map(([day, tmts]) => {
    const tournaments = [...tmts.values()].sort((a, b) => b.matches - a.matches);
    return {
      day,
      tournamentCount: tournaments.length,
      matchTotal: tournaments.reduce((sum, t) => sum + t.matches, 0),
      tournaments,
    };
  });

// Jours où le scraper a tourné mais qui n'apparaissent pas dans la timeline des
// draws (rien de neuf, OU re-fetch d'un tournoi live dont l'horodatage a depuis
// « glissé » vers un jour ultérieur). On complète depuis le journal des runs pour
// un vrai suivi quotidien. Les totaux du run-log donnent le libellé exact :
//   - aucun match récupéré  -> jour « à vide »
//   - des matchs récupérés  -> résumé chiffré (détail par tournoi indisponible)
const daysWithData = new Set(updates.map((u) => u.day));
const runByDay = new Map(); // jour -> { matches, tournaments } cumulés sur les runs du jour
for (const r of await store.getRunLog()) {
  const day = (r.finishedAt || "").slice(0, 10);
  if (!day || daysWithData.has(day)) continue;
  const agg = runByDay.get(day) || { matches: 0, tournaments: 0 };
  agg.matches += r.matches || 0;
  agg.tournaments += r.tournamentsTouched || 0;
  runByDay.set(day, agg);
}
for (const [day, agg] of runByDay) {
  updates.push(agg.matches > 0
    ? { day, tournamentCount: agg.tournaments, matchTotal: agg.matches, tournaments: [], partial: true }
    : { day, tournamentCount: 0, matchTotal: 0, tournaments: [], empty: true });
}

updates.sort((a, b) => b.day.localeCompare(a.day));
updates.splice(60);
await write("updates.json", { generatedAt: ranking.generatedAt, updates });

console.log(`✅ ${tCount} tournois, ${pCount} joueurs, ${updates.length} jours de MAJ, saisons ${years.join(", ")}`);

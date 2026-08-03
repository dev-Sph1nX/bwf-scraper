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

import { mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as views from "./lib/views.mjs";
import * as store from "./lib/store.mjs";
import { computeElo, seedEloByRank } from "./lib/elo.mjs";
import { loadInitialRanks } from "./lib/seeds.mjs";
import { loadBookRuns, buildBookSeries, groupBooks } from "./lib/books-history.mjs";
import { matchBooks } from "./lib/books-match.mjs";
import { loadPublications, buildWorldMap, buildPlayerRankHistory, publicationTotal } from "./lib/rank-history.mjs";
import { recalibrate } from "./lib/calibrate.mjs";
import { ev, bestOdd } from "./lib/ev.mjs";
import { oddsForMatch } from "./lib/home-data.mjs";
import { eloProb, isProvisional } from "./lib/models.mjs";
import { isWalkover } from "./lib/dataset.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "web", "public", "data");

// Manifeste des écritures, exporté en fin de build dans health.json : les
// fichiers de premier niveau un par un, les dossiers (player/, pair/…) agrégés.
const written = [];
async function write(rel, obj) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(obj);
  await writeFile(path, json, "utf8");
  written.push({ name: rel, bytes: Buffer.byteLength(json, "utf8") });
}

const years = await store.listYears();
if (!years.length) years.push(Number(process.argv[2]) || new Date().getFullYear());
const latestYear = years[years.length - 1];
console.log(`Génération multi-années : ${years.join(", ")}`);

// On repart d'un dossier propre : les dérivés sont tous régénérés ici.
// ATTENTION : cela supprime AUSSI backtest.json, produit par backtest.mjs qui est
// un script séparé. Il doit donc toujours être relancé APRÈS build-data, sans quoi
// la page /fiabilite reste vide. C'est câblé dans `npm run refresh` et dans le
// workflow ; ce commentaire est là pour qui ajouterait un autre producteur.
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

// Équipe allégée pour l'affichage (matchs à venir, pronostics par tournoi).
const teamLite = (team, seed) => ({
  players: (team?.players || []).map((p) => ({ id: String(p.id), nameDisplay: p.nameDisplay, countryFlagUrl: p.countryFlagUrl })),
  country: team?.countryCode || null,
  seed: seed || null,
});
const entityId = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
};

// ===== 1b) Pronostics rétrospectifs, collectés PENDANT le calcul de l'Elo =====
// Le crochet onMatch de computeElo (cf. lib/elo.mjs) livre l'état des deux camps
// d'AVANT chaque match : on fige ici la probabilité que l'app aurait affichée à
// l'époque — même modèle que le prédicteur et que le backtest (« Elo
// recalibré »), même règle d'abstention (aucun prono si un camp est provisoire).
// Les forfaits sont listés (le tableau les montre) mais jamais pronostiqués :
// ce n'est pas un match à prédire.
const pronosByTmt = new Map(); // tmtId -> entrées de matchs joués
const collectProno = ({ tmtId, disc, match, a, b }) => {
  const walkover = isWalkover(match);
  const p = walkover || isProvisional(a.entity.matches) || isProvisional(b.entity.matches)
    ? null
    : recalibrate(eloProb(a.entity.rating, b.entity.rating), disc);
  let arr = pronosByTmt.get(tmtId);
  if (!arr) pronosByTmt.set(tmtId, (arr = []));
  arr.push({
    disc, roundName: match.roundName || null, matchTime: match.matchTime || null,
    team1: teamLite(match.team1, match.team1seed),
    team2: teamLite(match.team2, match.team2seed),
    a: entityId(match.team1.players), b: entityId(match.team2.players),
    score: match.score || null, winner: match.winner,
    walkover, status: walkover ? (match.scoreStatusValue || null) : null,
    // Proba (team1) et camp prédit, calculés sur la valeur NON arrondie : un
    // 49,6 % arrondi à 50 désignerait le mauvais favori.
    prob: p == null ? null : Math.round(p * 100),
    pick: p == null ? null : (p >= 0.5 ? 1 : 2),
    ok: p == null ? null : ((p >= 0.5 ? 1 : 2) === match.winner),
  });
};
const elo = await computeElo(years, seeds, { onMatch: collectProno });
const { playerHistory, pairHistory, ...ranking } = elo;

const DOUBLES = new Set(["MD", "WD", "XD"]);
const pairKeyOf = (players) => `pair:${players.map((p) => String(p.id)).sort().join("-")}`;

// ===== 2) Classement mondial officiel BWF + comparaison =====
// Source : la série hebdomadaire de data/rankings/ (cf. backfill-rankings.mjs).
// La publication la plus récente joue le rôle de l'ancien instantané unique ;
// les précédentes alimentent la série worldRank des fiches joueurs.
const publications = await loadPublications(join(ROOT, "data", "rankings"));
// La dernière publication du répertoire n'est pas forcément exploitable : une
// publication VIDE (les 5 disciplines à 0 ligne) a pu être archivée avant que
// savePublication (lib/rank-history.mjs) ne refuse ce cas — l'API répond
// parfois total:0/data:[] en HTTP 200 pour un publicationId qu'elle ne sert
// pas. La prendre en aveugle viderait bwfRank/bwfPoints sur TOUTES les
// entités Elo (silencieusement, et de façon permanente tant que la publication
// suivante n'est pas plus récente). On retient donc la dernière NON vide.
let latestPub = null, publicationsVides = 0;
for (let i = publications.length - 1; i >= 0; i--) {
  if (publicationTotal(publications[i]) > 0) { latestPub = publications[i]; break; }
  publicationsVides++;
}
if (publicationsVides > 0) {
  console.log(
    `   ⚠️  ${publicationsVides} publication(s) vide(s) ignorée(s) en fin de série ` +
    `(dernière retenue : ${latestPub ? latestPub.date : "aucune"}).`,
  );
}
const playerRankHistory = buildPlayerRankHistory(publications);

let worldMeta = null;
let worldMap = {}; // disc -> Map(entityKey -> {rank, points})
if (latestPub) {
  worldMeta = {
    fetchedAt: latestPub.fetchedAt,
    date: latestPub.date,
    publicationId: latestPub.publicationId,
    week: latestPub.week,
    year: latestPub.year,
    depth: latestPub.depth,
    weeks: publications.length,
    firstDate: publications[0].date,
  };
  worldMap = buildWorldMap(latestPub);
}
console.log(
  `   Classement mondial : ${publications.length} publications` +
  (latestPub ? ` (${publications[0].date} → ${latestPub.date})` : " — aucune"),
);

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
const pairUpcomingIndex = new Map(); // cléPaire -> matchs à venir (non joués)
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
    // Match joué (résultat acté) vs à venir (winner 0). Les matchs à venir ne
    // doivent PAS entrer dans l'historique (stats, H2H, derniers tournois) : on
    // les range à part, par joueur/paire, pour un encart dédié.
    const played = match.winner === 1 || match.winner === 2;
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
        if (!e) { e = { id: pl.id, nameDisplay: pl.nameDisplay, countryCode: pl.countryCode, slug: pl.slug, matches: [], upcoming: [], years: new Set() }; index.set(pl.id, e); }
        (played ? e.matches : e.upcoming).push(entry);
        e.nameDisplay = pl.nameDisplay; e.countryCode = pl.countryCode; e.slug = pl.slug;
        if (played) e.years.add(y);
      }
      // Match de paire = double avec 2 joueurs sur la même équipe.
      if (DOUBLES.has(match.eventName) && players.length >= 2) {
        const key = pairKeyOf(players);
        if (played) {
          let arr = pairMatchIndex.get(key);
          if (!arr) { arr = []; pairMatchIndex.set(key, arr); }
          arr.push(entry);
        } else {
          let arr = pairUpcomingIndex.get(key);
          if (!arr) { arr = []; pairUpcomingIndex.set(key, arr); }
          arr.push(entry);
        }
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
    upcoming: (e.upcoming || []).slice().sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || "")),
    elo: playerHistory[e.id] || [],
    worldRank: playerRankHistory[e.id] || [],
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
      upcoming: (pairUpcomingIndex.get(e.key) || []).slice().sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || "")),
    });
    pairCount++;
  }
}
console.log(`   Paires : ${pairCount} fiches`);

// ===== 5) Tournois (toutes saisons) : status.json + fiches tournoi =====
const allTournaments = [];
const upcomingMatches = []; // matchs prévus (non joués) des tournois à venir / en cours
// Même population, mais avec les noms complets (lastName/firstName/slug) que
// `teamLite` ne conserve pas : nécessaires à l'appariement avec les cotes. Liste
// séparée pour ne rien changer à upcoming-matches.json.
const oddsCandidates = [];
// Matchs JOUÉS récents, candidats eux aussi à l'appariement des cotes. Deux
// usages : classer correctement une cote dont le match a eu lieu (le drapeau
// `settled` d'oddsportal, figé au relevé, ne suffit pas — il dit encore « à
// venir » pour un match joué depuis), et fournir la matière de la comparaison au
// marché, puisque la dernière cote d'un match joué approche sa cote de clôture.
const playedCandidates = [];
const RECENT_DAYS = 30;   // au-delà, l'historique des cotes n'existe pas encore
let tCount = 0, tournamentsTotal = 0, tournamentsDownloaded = 0;
const byYear = [];
// Tournois dont la fiche a été écrite : seuls eux reçoivent un fichier de
// pronostics (les JO, exclus du calendrier, sont pourtant vus par le crochet).
const writtenTmtIds = new Set();

// Joueur tel qu'attendu par lib/odds-match.mjs : le nom de famille et le prénom
// séparés sont ce qui permet de recoller "Prannoy H. S." à "H. S. PRANNOY".
const playerForOdds = (p) => ({
  id: String(p.id), nameDisplay: p.nameDisplay,
  lastName: p.lastName || null, firstName: p.firstName || null,
  slug: p.slug || null, countryCode: p.countryCode || null,
});

// (teamLite et entityId sont définis plus haut, avant le calcul de l'Elo : le
// collecteur de pronostics en a besoin pendant computeElo.)
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
  eloRank: entity?.rank ?? null,
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
// Score 0..100 + tags + raisons. probTeam1 = proba Elo de team1 (0..100).
// Deux signaux exploitables :
//   value  (contre-pronostic) : écart de classement mondial >= 10 ET notre Elo
//           donne >= 45% à l'outsider (avec une fiabilité suffisante).
//   bogey  (bête noire) : l'outsider mène les confrontations directes (>=2),
//           et notre Elo lui donne >= 40%.
const GAP_MIN = 10, PUNDER_VALUE = 0.45, PUNDER_BOGEY = 0.40, CONF_MIN = 0.45;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
function interestOf(ea, eb, probTeam1, aKey, bKey, disc, name1, name2) {
  if (!ea || !eb || probTeam1 == null || !ea.bwfRank || !eb.bwfRank) return { score: 0, tags: [], reasons: [] };
  const pForm1 = probTeam1 / 100;
  const conf = Math.min(reliability(ea), reliability(eb));
  const underIsT1 = ea.bwfRank > eb.bwfRank;
  const under = underIsT1 ? ea : eb, fav = underIsT1 ? eb : ea;
  const underName = underIsT1 ? name1 : name2, favName = underIsT1 ? name2 : name1;
  const pUnder = underIsT1 ? pForm1 : 1 - pForm1;
  const gap = Math.abs(ea.bwfRank - eb.bwfRank);

  const reasons = [], tags = [];
  // Cœur : proba Elo de l'outsider × ampleur de l'écart de classement × fiabilité.
  let score = clamp01((pUnder - 0.35) / 0.20) * clamp01(gap / 25) * conf * 70;

  if (conf >= CONF_MIN && gap >= GAP_MIN && pUnder >= PUNDER_VALUE) {
    tags.push("value");
    reasons.push(`Notre Elo donne ${Math.round(pUnder * 100)}% à ${underName} (#${under.bwfRank} mondial), pourtant donné outsider par le classement (#${fav.bwfRank}).`);
  }

  const h = h2hRecord(aKey, ea, eb, disc);
  const uW = underIsT1 ? h.w : h.l, fW = underIsT1 ? h.l : h.w;
  if (h.n >= 2 && uW > fW) {
    score += 18 * Math.min(1, h.n / 3);
    reasons.push(`${underName} (#${under.bwfRank}) mène ${uW}-${fW} en confrontations directes face à ${favName}.`);
    if (conf >= CONF_MIN && pUnder >= PUNDER_BOGEY) tags.push("bogey");
  }
  // Bonus corroborants (affinent le tri, ne suffisent pas à flagger seuls).
  if ((fav.form ?? 0) < -15 && (under.form ?? 0) > 15) {
    score += 8;
    reasons.push(`${favName} en perte de vitesse, ${underName} en forme.`);
  }
  if (under.rank && under.rank <= under.bwfRank - 8) {
    score += 7;
    reasons.push(`${underName} est #${under.rank} à notre Elo pour #${under.bwfRank} au mondial (sous-coté).`);
  }
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
      writtenTmtIds.add(t.id);
      tCount++; dl++;

      // Matchs JOUÉS récents (tous tournois, y compris terminés).
      {
        const fin = t.end_date || t.start_date || null;
        const recent = fin && (Date.now() - Date.parse(fin)) < RECENT_DAYS * 864e5;
        if (recent) {
          for (const disc of tv.disciplines) {
            for (const cell of Object.values(disc.results || {})) {
              const m = cell?.match;
              if (!m || (m.winner !== 1 && m.winner !== 2)) continue;
              const p1 = m.team1?.players || [], p2 = m.team2?.players || [];
              if (!p1.length || !p2.length) continue;
              playedCandidates.push({
                tmtId: t.id, tournamentName: t.name, year: y,
                eventName: m.eventName, roundName: m.roundName, matchTime: m.matchTime || null,
                team1: { players: p1.map(playerForOdds) },
                team2: { players: p2.map(playerForOdds) },
                winner: m.winner,
              });
            }
          }
        }
      }

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
            // Proba calibrée (étirement par discipline, cf. lib/calibrate.mjs) :
            // c'est elle, jamais la proba brute, qui sert de base à l'EV des cotes.
            const probCal = prob == null ? null : Math.round(recalibrate(prob / 100, m.eventName) * 100);
            const name1 = p1.map((p) => p.nameDisplay).join(" / ");
            const name2 = p2.map((p) => p.nameDisplay).join(" / ");
            const interest = interestOf(ea, eb, prob, a, b, m.eventName, name1, name2);
            upcomingMatches.push({
              tmtId: t.id, tournamentName: t.name, year: y,
              startDate: t.start_date || null, endDate: t.end_date || null,
              date: t.date, category: t.category, flag_url: t.flag_url, live_status: t.live_status,
              eventName: m.eventName, roundName: m.roundName,
              // Tableau exact (« MS - Qualification » vs « MS ») : le filtre de
              // l'accueil reprend la granularité des onglets de la page tournoi.
              drawName: disc.label || m.eventName,
              team1: withElo(teamLite(m.team1, m.team1seed), ea),
              team2: withElo(teamLite(m.team2, m.team2seed), eb),
              a, b,
              // Proba de victoire de team1 (null si l'une des deux n'est pas classée).
              prob, probCal,
              score: interest.score, tags: interest.tags, reasons: interest.reasons,
            });
            // Relie ce candidat de cotes à l'entrée upcoming qu'on vient de pousser
            // (même itération) : permet d'embarquer les cotes appariées plus loin.
            oddsCandidates.push({
              tmtId: t.id, tournamentName: t.name, year: y,
              eventName: m.eventName, roundName: m.roundName, matchTime: m.matchTime || null,
              team1: { players: p1.map(playerForOdds) },
              team2: { players: p2.map(playerForOdds) },
              a, b, prob,
              uIdx: upcomingMatches.length - 1,
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
console.log(`   Matchs à venir : ${upcomingMatches.length}`);

// ===== Cotes oddsportal : RETIRÉ (2026-07-31) =====
// L'audit oddsportal (odds-report.json, odds-history.json) a été retiré au
// profit des bookmakers FR ci-dessous : cotes par opérateur nommé, réellement
// misables, jointes par identifiant Sportradar. L'historique déjà relevé reste
// archivé dans data/odds/runs/ (append-only, jamais réécrit).

// ===== Cotes par OPÉRATEUR (Betclic, Unibet, Winamax) =====
// Source : les relevés append-only de data/books/runs/ (scrape-books.mjs).
// Un même match est joint entre opérateurs par son identifiant Sportradar
// (exact), puis rapproché des matchs BWF par discipline + date + noms — au
// moindre doute, pas d'appariement (l'audit montre les cas douteux).
let bookRunsHealth = [];
// Cotes de clôture des matchs JOUÉS appariés, pour les pronostics par tournoi.
// Clé : tmtId|discipline|jour|entité1|entité2 (le jour départage deux
// rencontres des mêmes adversaires dans un même tournoi, ex. poule puis finale).
const oddsByPlayed = new Map();
{
  const runs = await loadBookRuns(join(ROOT, "data", "books", "runs"));
  // Détail de chaque passage du scraper de cotes, pour la page /sante : combien
  // de lignes par opérateur, et l'erreur exacte en cas d'échec (ex. HTTP 403).
  // Ces infos vivent dans les fichiers bruts mais n'étaient pas exportées.
  // 84 relevés = ~7 jours à un passage toutes les 2 h : de quoi alimenter le
  // filtre par jour de la page /sante sans gonfler le build (~5 ko le fichier).
  bookRunsHealth = await Promise.all(runs.slice(-84).map(async (r) => {
    const books = {};
    for (const b of new Set([...Object.keys(r.books || {}), ...Object.keys(r.errors || {})])) {
      const d = r.books?.[b];
      books[b] = {
        rows: d ? (d.rows || []).length : null,
        complete: d ? d.complete !== false : false,
        error: r.errors?.[b] ?? null,
      };
    }
    // Copie du relevé BRUT dans les données servies : la page /sante l'affiche
    // tel quel (ligne par ligne, ce que le scraper a réellement récupéré).
    // Nom de fichier = celui de data/books/runs/ (fetchedAt, ':' et '.' -> '-').
    const file = `books/runs/${r.fetchedAt.replace(/[:.]/g, "-")}.json`;
    await write(file, r);
    return { fetchedAt: r.fetchedAt, file, books };
  }));
  bookRunsHealth.reverse();
  const series = buildBookSeries(runs);
  const groups = groupBooks(series);
  // Les matchs joués récents sont candidats aussi : une cote dont on connaît
  // l'issue reste la matière de la comparaison au marché (cote de clôture).
  const candidats = [
    ...oddsCandidates.map((c) => ({ ...c, played: false })),
    ...playedCandidates.map((c) => ({ ...c, played: true })),
  ];
  const res = matchBooks(candidats, groups);

  // Embarque les cotes appariées dans les matchs à venir : la carte d'accueil
  // lit UN seul fichier, orienté team1/team2, avec l'EV déjà calculée.
  for (const m of res.matched) {
    const i = m.bwf.uIdx;
    if (i == null || m.bwf.played) continue;
    const u = upcomingMatches[i];
    const o = oddsForMatch(m.group, m.swapped);
    const p1 = u.probCal == null ? null : u.probCal / 100;
    const b1 = bestOdd(o.books, 1), b2 = bestOdd(o.books, 2);
    u.odds = {
      ...o,
      ev1: p1 == null || !b1 ? null : ev(b1.odd, p1),
      ev2: p1 == null || !b2 ? null : ev(b2.odd, 1 - p1),
    };
  }
  await write("upcoming-matches.json", { generatedAt: ranking.generatedAt, matches: upcomingMatches });

  const names = (team) => (team?.players || []).map((p) => p.nameDisplay).join(" / ");

  // Alimente la table des cotes des matchs joués (jointure vers les pronostics).
  for (const m of res.matched) {
    if (!m.bwf.played) continue;
    const day = String(m.bwf.matchTime || "").slice(0, 10);
    const k = `${m.bwf.tmtId}|${m.bwf.eventName}|${day}|${entityId(m.bwf.team1.players)}|${entityId(m.bwf.team2.players)}`;
    const o = oddsForMatch(m.group, m.swapped);
    const books = {};
    // Seules les cotes de clôture sont retenues (odd1/odd2, orientées team1/team2) :
    // les séries complètes restent dans books-report.json. Un opérateur sans
    // couple de cotes complet (relevé passé en live, marché fermé) est écarté —
    // sans quoi le tournoi afficherait « avec cotes » pour des cases vides.
    for (const [op, b] of Object.entries(o.books)) {
      if (b.odd1 != null && b.odd2 != null) books[op] = { odd1: b.odd1, odd2: b.odd2 };
    }
    if (Object.keys(books).length) oddsByPlayed.set(k, { books, startUtc: o.startUtc });
  }

  const bwfOf = new Map(res.matched.map((m) => [m.group.key, m]));
  const perBook = {};
  for (const g of groups) {
    for (const [book, b] of Object.entries(g.books)) {
      const st = (perBook[book] ||= { lines: 0, withOdds: 0, readingsTotal: 0 });
      st.lines++;
      if (b.odd1 != null && b.odd2 != null) st.withOdds++;
      st.readingsTotal += b.readings;
    }
  }

  await write("books-report.json", {
    generatedAt: new Date().toISOString(),
    runs: runs.map((r) => r.fetchedAt),
    stats: { ...res.stats, perBook },
    matches: groups.map((g) => {
      const m = bwfOf.get(g.key);
      return {
        ...g,
        bwf: m
          ? {
              tournamentName: m.bwf.tournamentName, roundName: m.bwf.roundName,
              discipline: m.bwf.eventName, matchTime: m.bwf.matchTime,
              bwf1: names(m.bwf.team1), bwf2: names(m.bwf.team2),
              prob: m.bwf.prob ?? null, played: !!m.bwf.played, winner: m.bwf.winner ?? null,
              // true si p1 du groupe correspond à team2 BWF : permet d'aligner
              // les colonnes de cotes sur team1/team2 côté interface.
              swapped: m.swapped, score: m.score,
            }
          : null,
      };
    }),
    ambiguous: res.ambiguous.map((x) => ({
      key: x.group.key, p1: x.group.p1, p2: x.group.p2,
      tournament: x.group.tournament, discipline: x.group.discipline, startUtc: x.group.startUtc,
      candidates: x.candidates.map((c) => ({
        tournamentName: c.bwf.tournamentName, roundName: c.bwf.roundName,
        bwf1: names(c.bwf.team1), bwf2: names(c.bwf.team2), score: c.score,
      })),
    })),
  });
  console.log(
    `   Bookmakers : ${groups.length} matchs (${runs.length} relevés), ` +
      `${res.stats.matched} appariés BWF, ${res.stats.ambiguous} ambigus, ${res.stats.unmatched} orphelins`
  );
}

// ===== 5b) Pronostics par tournoi : pronos/<tmtId>.json =====
// Un fichier par tournoi téléchargé : la liste chronologique de ses matchs
// joués, chacun avec la proba d'avant match, le verdict (bon/mauvais prono) et
// les cotes de clôture quand un bookmaker a été apparié (matchs récents
// uniquement — l'historique de cotes n'existe que depuis fin juillet 2026).
let pronoFiles = 0, pronoMatches = 0;
for (const [tmtId, list] of pronosByTmt) {
  if (!writtenTmtIds.has(tmtId)) continue;
  list.sort((x, y) => (x.matchTime || "").localeCompare(y.matchTime || ""));
  let predicted = 0, correct = 0, withOdds = 0, walkovers = 0;
  for (const e of list) {
    const day = String(e.matchTime || "").slice(0, 10);
    const odds = oddsByPlayed.get(`${tmtId}|${e.disc}|${day}|${e.a}|${e.b}`);
    if (odds) { e.odds = odds; withOdds++; }
    if (e.walkover) walkovers++;
    if (e.ok != null) { predicted++; if (e.ok) correct++; }
  }
  await write(`pronos/${tmtId}.json`, {
    tmtId,
    generatedAt: ranking.generatedAt,
    stats: { total: list.length, walkovers, predicted, correct, withOdds },
    matches: list,
  });
  pronoFiles++; pronoMatches += list.length;
}
console.log(`   Pronostics : ${pronoFiles} tournois, ${pronoMatches} matchs joués`);

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

// ===== 8) health.json : manifeste du build, pour la page /sante =====
// Écrit en DERNIER pour recenser toutes les écritures ci-dessus. Les fichiers
// par entité (player/, pair/…) sont agrégés en compteurs. backtest.json est
// produit par backtest.mjs APRÈS ce script : il n'apparaît pas ici, la page
// /sante le teste directement côté navigateur.
{
  const topFiles = [];
  const dirs = new Map(); // "player" -> { count, bytes }
  for (const f of written) {
    const slash = f.name.indexOf("/");
    if (slash === -1) { topFiles.push(f); continue; }
    const dir = f.name.slice(0, slash);
    const agg = dirs.get(dir) || { count: 0, bytes: 0 };
    agg.count++; agg.bytes += f.bytes;
    dirs.set(dir, agg);
  }
  await write("health.json", {
    generatedAt: new Date().toISOString(),
    files: topFiles,
    dirs: [...dirs.entries()].map(([name, a]) => ({ name, ...a })),
    bookRuns: bookRunsHealth,
  });
}

console.log(`✅ ${tCount} tournois, ${pCount} joueurs, ${updates.length} jours de MAJ, saisons ${years.join(", ")}`);

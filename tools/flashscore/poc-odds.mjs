// tools/flashscore/poc-odds.mjs
// PREUVE DE CONCEPT — cotes historiques Flashscore pour un tournoi BWF.
//
//   node tools/flashscore/poc-odds.mjs taipei-open
//
// Récupère, pour chaque tableau du tournoi (MS/WS/MD/WD/XD), les matchs à
// partir des quarts de finale et leurs cotes vainqueur (ouverture + clôture)
// par bookmaker. Écrit data/flashscore/poc/<slug>.json pour vérification.
//
// COMMENT ÇA MARCHE (méthodes validées le 2026-08-03) :
//   1. La page « résultats » de chaque catégorie embarque la liste complète
//      des matchs dans `cjs.initialFeeds["summary-results"]` (format ¬/÷ :
//      AA=id du match, ER=tour, JA/JB=id des participants, AE/AF=noms,
//      AD=horodatage, AS=vainqueur, BA..BF=points des manches).
//   2. Les cotes viennent du GraphQL public de Flashscore :
//      https://global.ds.lsapp.eu/pq_graphql?_hash=oce&eventId=<id>&projectId=16
//      -> `findOddsByEventId` : par bookmaker, marché HOME_AWAY avec `opening`
//      et `value` (dernière cote = clôture pour un match joué). Les
//      `eventParticipantId` correspondent EXACTEMENT aux JA/JB du point 1 :
//      l'orientation des cotes est déterministe, aucun rapprochement flou.
//
// Politesse : requêtes séquentielles, ~1 s d'intervalle, User-Agent réel.

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SLUG = process.argv[2] || "taipei-open";
const OUT = join(ROOT, "data", "flashscore", "poc", `${SLUG}.json`);

// Catégories Flashscore -> code discipline BWF.
const CATS = [
  ["bwf-world-tour-hommes", "MS"],
  ["bwf-world-tour-femmes", "WS"],
  ["bwf-world-tour-doubles-hommes", "MD"],
  ["bwf-world-tour-doubles-femmes", "WD"],
  ["bwf-world-tour-doubles-mixtes", "XD"],
];
// Tours retenus pour la preuve de concept (les cotes n'existent en général
// qu'à partir des quarts sur les Super 300).
const ROUNDS = new Set(["Quarts de finale", "Demi-finales", "Finale"]);

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeout = 180_000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.text();
}

// Décode le feed embarqué : blocs de paires clé÷valeur séparées par ¬,
// un match par segment commençant par AA÷.
function parseSummaryFeed(html) {
  const m = html.match(/initialFeeds\["summary-results"\]\s*=\s*\{\s*data:\s*`([^`]*)`/);
  if (!m) return [];
  const rows = [];
  for (const seg of m[1].split("~")) {
    if (!seg.startsWith("AA÷")) continue;
    const kv = {};
    for (const pair of seg.split("¬")) {
      const i = pair.indexOf("÷");
      if (i > 0) kv[pair.slice(0, i)] = pair.slice(i + 1);
    }
    rows.push(kv);
  }
  return rows;
}

// Manches "21-19, 11-21, 12-21" depuis BA/BB (m1), BC/BD (m2), BE/BF (m3).
const setsOf = (kv) => {
  const sets = [];
  for (const [h, a] of [["BA", "BB"], ["BC", "BD"], ["BE", "BF"]]) {
    if (kv[h] != null && kv[a] != null) sets.push({ home: Number(kv[h]), away: Number(kv[a]) });
  }
  return sets;
};

async function oddsOf(eventId) {
  const url = `https://global.ds.lsapp.eu/pq_graphql?_hash=oce&eventId=${eventId}&projectId=16&geoIpCode=FR&geoIpSubdivisionCode=IDF`;
  const j = JSON.parse(await get(url, { timeout: 30_000 }));
  const oc = j?.data?.findOddsByEventId;
  if (!oc) return null;
  const bookName = new Map((oc.settings?.bookmakers || []).map((b) => [b.bookmaker.id, b.bookmaker.name]));
  const out = {};
  for (const o of oc.odds || []) {
    if (o.bettingType !== "HOME_AWAY" || o.bettingScope !== "FULL_TIME") continue;
    const sides = {};
    for (const item of o.odds || []) {
      sides[item.eventParticipantId] = { opening: Number(item.opening) || null, closing: Number(item.value) || null };
    }
    out[bookName.get(o.bookmakerId) || `bookmaker#${o.bookmakerId}`] = sides;
  }
  return Object.keys(out).length ? out : null;
}

const matches = [];
let pagesOk = 0;
for (const [cat, disc] of CATS) {
  const url = `https://www.flashscore.fr/badminton/${cat}/${SLUG}/resultats/`;
  let html;
  try {
    html = await get(url);
  } catch (e) {
    console.log(`— ${disc} : page absente ou injoignable (${e.message.slice(0, 60)})`);
    continue;
  }
  pagesOk++;
  const rows = parseSummaryFeed(html).filter((kv) => ROUNDS.has(kv.ER));
  console.log(`📄 ${disc} (${cat}) : ${rows.length} matchs à partir des quarts`);
  for (const kv of rows) {
    await pause(1000);
    let odds = null, oddsErr = null;
    try {
      const raw = await oddsOf(kv.AA);
      if (raw) {
        // Réoriente chaque bookmaker vers home/away via JA/JB (exact).
        odds = {};
        for (const [book, sides] of Object.entries(raw)) {
          odds[book] = { home: sides[kv.JA] || null, away: sides[kv.JB] || null };
        }
      }
    } catch (e) {
      oddsErr = String(e.message || e).slice(0, 80);
    }
    matches.push({
      fsId: kv.AA,
      disc,
      round: kv.ER,
      startUtc: kv.AD ? new Date(Number(kv.AD) * 1000).toISOString() : null,
      home: { name: kv.AE, country: kv.FU || null, fsParticipantId: kv.JA },
      away: { name: kv.AF, country: kv.FV || null, fsParticipantId: kv.JB },
      winner: kv.AS === "1" ? "home" : kv.AS === "2" ? "away" : null,
      sets: setsOf(kv),
      odds,
      ...(oddsErr ? { oddsError: oddsErr } : {}),
    });
    const n = odds ? Object.keys(odds).length : 0;
    console.log(`   ${kv.ER.padEnd(16)} ${kv.AE} vs ${kv.AF} — ${n} bookmaker${n > 1 ? "s" : ""}${oddsErr ? ` (erreur: ${oddsErr})` : ""}`);
  }
}

matches.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
const withOdds = matches.filter((m) => m.odds).length;
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({
  source: "flashscore.fr (feed embarqué + GraphQL oce)",
  fetchedAt: new Date().toISOString(),
  tournamentSlug: SLUG,
  rounds: [...ROUNDS],
  stats: { pages: pagesOk, matches: matches.length, withOdds },
  matches,
}, null, 1));
console.log(`\n✅ ${matches.length} matchs (${withOdds} avec cotes) -> ${OUT}`);

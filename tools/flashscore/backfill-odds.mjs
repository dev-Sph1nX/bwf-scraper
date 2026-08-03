// tools/flashscore/backfill-odds.mjs
// Backfill des cotes historiques Flashscore pour les tournois BWF World Tour.
//
//   node tools/flashscore/backfill-odds.mjs                 # tout le calendrier
//   node tools/flashscore/backfill-odds.mjs taipei-open …   # un/des tournoi(s) précis
//   node tools/flashscore/backfill-odds.mjs --skip-existing # reprend un backfill interrompu
//
// Écrit un fichier par tournoi dans data/flashscore/odds/<slug>.json : tous les
// matchs joués dont AU MOINS un bookmaker retenu (Winamax, Betclic, Unibet —
// choix validé le 2026-08-03) publie une cote vainqueur, avec ouverture et
// clôture par camp. Un index data/flashscore/odds/_index.json récapitule.
//
// MÉTHODES (validées par tools/flashscore/poc-odds.mjs, cf. son en-tête) :
//   - découverte des tournois : page /badminton/calendrier/bwf/ rendue dans un
//     vrai navigateur (le HTML statique n'expose qu'une partie des liens) ;
//   - liste des matchs : feed embarqué `initialFeeds["summary-results"]` de la
//     page résultats de chaque catégorie (5 catégories = 5 tableaux MS/WS/MD/WD/XD) ;
//   - cotes : GraphQL public `_hash=oce`, orientation EXACTE par
//     eventParticipantId (JA/JB du feed).
//
// Politesse : séquentiel, ~0,5 s entre appels de cotes, User-Agent réel.

import { mkdir, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "data", "flashscore", "odds");

const args = process.argv.slice(2);
const SKIP_EXISTING = args.includes("--skip-existing");
const ONLY = args.filter((a) => !a.startsWith("--"));

// Plancher du backfill (demande du 2026-08-03) : la saison 2026 commence à
// l'Open de Malaisie (06-11 janvier). Les pages « résultats » des ligues dont
// l'édition courante est antérieure (World Tour Finals de déc. 2025, Masters
// de Chine de nov. 2025) sont ainsi neutralisées sans liste noire à entretenir.
const START_UTC = "2026-01-06";

// Bookmakers retenus (les seuls misables pour nous) ; le nom Flashscore varie
// (« Betclic.fr », « Winamax »…), on normalise vers les clés de data/books/.
const BOOK_KEY = (name) => {
  const n = String(name).toLowerCase();
  if (n.includes("betclic")) return "betclic";
  if (n.includes("winamax")) return "winamax";
  if (n.includes("unibet")) return "unibet";
  return null;
};

const CATS = [
  ["bwf-world-tour-hommes", "MS"],
  ["bwf-world-tour-femmes", "WS"],
  ["bwf-world-tour-doubles-hommes", "MD"],
  ["bwf-world-tour-doubles-femmes", "WD"],
  ["bwf-world-tour-doubles-mixtes", "XD"],
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeout = 180_000 } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---- Découverte des tournois depuis le calendrier (navigateur) --------------
// La page /calendrier/bwf/ affiche la saison complète de la catégorie
// « hommes » (une ligne par tournoi, lien vers la ligue) ; il faut accepter le
// bandeau cookies pour que le contenu se rende. Les slugs sont COMMUNS aux 5
// catégories (taipei-open existe en hommes/femmes/doubles/mixte) : la liste
// « hommes » suffit, backfillTournament essaie ensuite chaque catégorie.
async function discoverSlugs() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto("https://www.flashscore.fr/badminton/calendrier/bwf/", { waitUntil: "domcontentloaded", timeout: 180_000 });
    try { await page.click("#onetrust-accept-btn-handler", { timeout: 8_000 }); } catch { /* pas de bandeau */ }
    await page.waitForTimeout(3_000);
    const hrefs = await page.$$eval('a[href*="/badminton/bwf-world-tour-"]', (as) => as.map((a) => a.getAttribute("href")));
    const slugs = new Set();
    for (const h of hrefs) {
      const m = String(h).match(/\/badminton\/bwf-world-tour-(?:hommes|femmes|doubles-hommes|doubles-femmes|doubles-mixtes)\/([a-z0-9-]+)\/?$/);
      if (m) slugs.add(m[1]);
    }
    return [...slugs].sort();
  } finally {
    await browser.close();
  }
}

// ---- Parse du feed embarqué (cf. poc-odds.mjs) -------------------------------
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
    const key = BOOK_KEY(bookName.get(o.bookmakerId));
    if (!key) continue; // bookmaker hors liste retenue
    const sides = {};
    for (const item of o.odds || []) {
      sides[item.eventParticipantId] = { opening: Number(item.opening) || null, closing: Number(item.value) || null };
    }
    out[key] = sides;
  }
  return Object.keys(out).length ? out : null;
}

async function backfillTournament(slug) {
  const matches = [];
  let scanned = 0;
  for (const [cat, disc] of CATS) {
    let html;
    try {
      html = await get(`https://www.flashscore.fr/badminton/${cat}/${slug}/resultats/`);
    } catch (e) {
      console.log(`   — ${disc} : ${e.message}`);
      continue;
    }
    const rows = parseSummaryFeed(html)
      .filter((kv) => kv.AS === "1" || kv.AS === "2") // matchs décidés
      .filter((kv) => kv.AD && new Date(Number(kv.AD) * 1000).toISOString() >= START_UTC); // saison 2026
    for (const kv of rows) {
      scanned++;
      await pause(500);
      let odds = null, oddsErr = null;
      try {
        const raw = await oddsOf(kv.AA);
        if (raw) {
          odds = {};
          for (const [book, sides] of Object.entries(raw)) {
            odds[book] = { home: sides[kv.JA] || null, away: sides[kv.JB] || null };
          }
        }
      } catch (e) {
        oddsErr = String(e.message || e).slice(0, 80);
        console.log(`   ⚠ cotes ${kv.AA} (${kv.AE} vs ${kv.AF}) : ${oddsErr}`);
      }
      if (!odds) continue; // sans cote retenue, le match ne sert pas au backfill
      matches.push({
        fsId: kv.AA,
        disc,
        round: kv.ER || null,
        startUtc: kv.AD ? new Date(Number(kv.AD) * 1000).toISOString() : null,
        home: { name: kv.AE, country: kv.FU || null, fsParticipantId: kv.JA },
        away: { name: kv.AF, country: kv.FV || null, fsParticipantId: kv.JB },
        winner: kv.AS === "1" ? "home" : "away",
        sets: setsOf(kv),
        odds,
      });
    }
  }
  matches.sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
  return { scanned, matches };
}

// ---- Boucle principale -------------------------------------------------------
const slugs = ONLY.length ? ONLY : await discoverSlugs();
console.log(`🎯 ${slugs.length} tournoi(s) : ${slugs.join(", ")}`);
await mkdir(OUT_DIR, { recursive: true });

const index = [];
for (const slug of slugs) {
  const file = join(OUT_DIR, `${slug}.json`);
  if (SKIP_EXISTING && await access(file).then(() => true, () => false)) {
    console.log(`⏭  ${slug} : déjà présent`);
    continue;
  }
  console.log(`\n📥 ${slug}…`);
  const { scanned, matches } = await backfillTournament(slug);
  const from = matches[0]?.startUtc?.slice(0, 10) ?? null;
  const to = matches[matches.length - 1]?.startUtc?.slice(0, 10) ?? null;
  await writeFile(file, JSON.stringify({
    source: "flashscore.fr (feed embarqué + GraphQL oce)",
    fetchedAt: new Date().toISOString(),
    tournamentSlug: slug,
    books: ["betclic", "unibet", "winamax"],
    stats: { scanned, withOdds: matches.length, from, to },
    matches,
  }, null, 1));
  index.push({ slug, scanned, withOdds: matches.length, from, to });
  console.log(`   ✅ ${matches.length}/${scanned} matchs avec cotes (${from ?? "?"} → ${to ?? "?"})`);
}
if (!ONLY.length) {
  await writeFile(join(OUT_DIR, "_index.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), tournaments: index }, null, 1));
}
console.log(`\n✅ terminé — ${index.reduce((s, t) => s + t.withOdds, 0)} matchs avec cotes sur ${index.length} tournoi(s) -> ${OUT_DIR}`);

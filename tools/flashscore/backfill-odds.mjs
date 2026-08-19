// tools/flashscore/backfill-odds.mjs
// Backfill des cotes historiques Flashscore pour les tournois BWF World Tour.
//
//   node tools/flashscore/backfill-odds.mjs                 # tout le calendrier (saison courante)
//   node tools/flashscore/backfill-odds.mjs taipei-open …   # un/des tournoi(s) précis
//   node tools/flashscore/backfill-odds.mjs --skip-existing # reprend un backfill interrompu
//   node tools/flashscore/backfill-odds.mjs --seasons=2024,2025            # archives
//   node tools/flashscore/backfill-odds.mjs --seasons=2024 open-de-malaisie # une ligue précise
//   node tools/flashscore/backfill-odds.mjs --from=2025-01-01 --to=2026-01-06 --suffix=-2025 hylo-open …
//     ^ cas des tournois d'automne dont l'édition N-1 est ENCORE la page
//       « courante » de la ligue (pas de lien -2025 en archive tant que
//       l'édition suivante n'a pas commencé) : on scrape la page sans suffixe
//       sur une fenêtre de dates et on écrit <slug><suffix>.json.
//
// Écrit un fichier par tournoi dans data/flashscore/odds/<slug>.json : tous les
// matchs joués dont AU MOINS un bookmaker retenu (Winamax, Betclic, Unibet —
// choix validé le 2026-08-03) publie une cote vainqueur, avec ouverture et
// clôture par camp. Un index data/flashscore/odds/_index.json récapitule.
//
// MÉTHODES (validées par tools/flashscore/poc-odds.mjs, cf. son en-tête) :
//   - découverte des tournois : page /badminton/calendrier/bwf/ rendue dans un
//     vrai navigateur (le HTML statique n'expose qu'une partie des liens) ;
//   - éditions passées (--seasons) : pages /archives/ de chaque ligue, en HTTP
//     pur (les liens `<slug>-2024` y sont dans le HTML statique, échappés
//     `\/badminton\/...`) ; découverte élargie par les liens de ligues croisés
//     sur ces mêmes pages (couvre les tournois absents du calendrier courant) ;
//   - liste des matchs : feeds embarqués `initialFeeds["summary-results"]` ET
//     `initialFeeds['results']` de la page résultats de chaque catégorie —
//     union par id d'événement, car sur les pages d'archives le premier est
//     tronqué (constaté le 2026-08-04 : 23/31 matchs sur open-de-malaisie-2024) ;
//   - cotes : GraphQL public `_hash=oce`, orientation EXACTE par
//     eventParticipantId (JA/JB du feed). Vérifié le 2026-08-04 : l'endpoint
//     sert encore ouverture + clôture pour les matchs de janvier 2024.
//
// Politesse : séquentiel, ~0,5 s entre appels de cotes, User-Agent réel.

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(ROOT, "data", "flashscore", "odds");

const args = process.argv.slice(2);
const SKIP_EXISTING = args.includes("--skip-existing");
const SEASONS = (args.find((a) => a.startsWith("--seasons=")) || "")
  .split("=")[1]?.split(",").map(Number).filter(Boolean) ?? [];
const FROM = (args.find((a) => a.startsWith("--from=")) || "").split("=")[1] || null;
const TO = (args.find((a) => a.startsWith("--to=")) || "").split("=")[1] || null;
const SUFFIX = (args.find((a) => a.startsWith("--suffix=")) || "").split("=")[1] || "";
const ONLY = args.filter((a) => !a.startsWith("--"));

// Plancher du backfill (demande du 2026-08-03) : la saison 2026 commence à
// l'Open de Malaisie (06-11 janvier). Les pages « résultats » des ligues dont
// l'édition courante est antérieure (World Tour Finals de déc. 2025, Masters
// de Chine de nov. 2025) sont ainsi neutralisées sans liste noire à entretenir.
const START_UTC = "2026-01-06";

// Bookmakers retenus (les seuls misables pour nous) ; le nom Flashscore varie
// (« Betclic.fr », « Winamax »…), on normalise vers les clés de data/books/.
// Opérateurs retenus à la COLLECTE. Les trois premiers sont misables ;
// bwin et NetBet sont des cotes de RÉFÉRENCE — écartés du périmètre de pari le
// 2026-08-18 (§10.5 : +2,5 points de péage, sans renverser l'économie), mais
// conservés comme base de travail statistique sur les saisons passées
// (décision du propriétaire, 2026-08-19). Motif identique à Pinnacle
// (lib/book-pinnacle.mjs) et leçon §10.5 « collecter tout, filtrer à
// l'analyse » : sur 2022, 8 tournois n'ont de cotes QUE chez ces deux-là, les
// jeter à la collecte revenait à perdre ~1 200 matchs mesurables.
// LE FILTRE MISABLE EST DANS build-data (lib/roi.mjs BOOKS) : ces cotes
// n'entrent jamais dans « la meilleure cote » ni dans le ROI.
const MISABLES = ["betclic", "winamax", "unibet"];
const REFERENCE = ["bwin", "netbet"];
const BOOK_KEY = (name) => {
  const n = String(name).toLowerCase();
  if (n.includes("betclic")) return "betclic";
  if (n.includes("winamax")) return "winamax";
  if (n.includes("unibet")) return "unibet";
  if (n.includes("bwin")) return "bwin";
  if (n.includes("netbet")) return "netbet";
  return null;
};

// Catégories Flashscore -> nos disciplines. Surchargables par --cats=… : les
// Mondiaux, par exemple, vivent sous `bwf-masculin/championnats-du-monde` et
// non sous `bwf-world-tour-*` (--cats=bwf-masculin:MS,bwf-feminin:WS,…).
const CATS = (args.find((a) => a.startsWith("--cats=")) || "")
  .split("=")[1]?.split(",").map((x) => x.split(":")) ?? [
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

// ---- Découverte des éditions passées (pages /archives/, HTTP pur) -----------
// Chaque ligue liste ses éditions (`open-de-malaisie-2024`…) dans le HTML
// statique de sa page archives, sous forme échappée `\/badminton\/…`. Ces mêmes
// pages exposent des liens vers d'autres ligues : on les crawle aussi (BFS),
// pour attraper les tournois absents du calendrier courant (ex. le Masters de
// Corée). Un renommage entre saisons n'est pas un problème : on prend tout slug
// suffixé -<année> trouvé sur la page, quel que soit le nom de la ligue.
async function discoverEditions(seedSlugs, seasons, { expand = true } = {}) {
  const editionRe = new RegExp(
    `\\\\?/badminton\\\\?/bwf-world-tour-hommes\\\\?/([a-z0-9-]+-(?:${seasons.join("|")}))\\\\?/`,
    "g",
  );
  const leagueRe = /\\?\/badminton\\?\/bwf-world-tour-(?:hommes|femmes|doubles-hommes|doubles-femmes|doubles-mixtes)\\?\/([a-z0-9-]+)\\?\//g;
  const queue = [...seedSlugs];
  const seen = new Set(queue);
  const editions = new Set();
  while (queue.length) {
    const slug = queue.shift();
    let html;
    try {
      html = await get(`https://www.flashscore.fr/badminton/bwf-world-tour-hommes/${slug}/archives/`);
    } catch (e) {
      console.log(`   — archives ${slug} : ${e.message}`);
      continue;
    }
    for (const m of html.matchAll(editionRe)) editions.add(m[1]);
    if (expand) {
      for (const m of html.matchAll(leagueRe)) {
        const s = m[1];
        if (/-20\d{2}$/.test(s)) continue; // une édition datée, pas une ligue
        if (!seen.has(s)) { seen.add(s); queue.push(s); }
      }
    }
    await pause(300);
  }
  console.log(`   (${seen.size} ligues visitées)`);
  return [...editions].sort();
}

// ---- Parse des feeds embarqués (cf. poc-odds.mjs) ----------------------------
// Union `summary-results` + `results` par id d'événement : les deux portent les
// mêmes champs (AA, AD, JA/JB, AE/AF, AS, ER, BA-BF…), mais sur les pages
// d'archives le premier est tronqué et seul le second est complet.
function parseSummaryFeed(html) {
  const rows = new Map();
  for (const re of [
    /initialFeeds\["summary-results"\]\s*=\s*\{\s*data:\s*`([^`]*)`/,
    /initialFeeds\['results'\]\s*=\s*\{\s*data:\s*`([^`]*)`/,
  ]) {
    const m = html.match(re);
    if (!m) continue;
    for (const seg of m[1].split("~")) {
      if (!seg.startsWith("AA÷")) continue;
      const kv = {};
      for (const pair of seg.split("¬")) {
        const i = pair.indexOf("÷");
        if (i > 0) kv[pair.slice(0, i)] = pair.slice(i + 1);
      }
      if (kv.AA && !rows.has(kv.AA)) rows.set(kv.AA, kv);
    }
  }
  return [...rows.values()];
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

async function backfillTournament(slug, { fromUtc = START_UTC, toUtc = null } = {}) {
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
      .filter((kv) => {
        if (!kv.AD) return false;
        const iso = new Date(Number(kv.AD) * 1000).toISOString();
        return iso >= fromUtc && (!toUtc || iso < toUtc);
      });
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
// Cibles : la saison courante (défaut), ou les éditions archivées (--seasons=…),
// chacune bornée à son année civile pour ne pas mordre sur la saison voisine.
let targets;
if (SEASONS.length) {
  let seeds = ONLY;
  if (!seeds.length) {
    seeds = await readFile(join(OUT_DIR, "_index.json"), "utf8")
      .then((s) => JSON.parse(s).tournaments.map((t) => t.slug).filter((x) => !/-20\d{2}$/.test(x)))
      .catch(() => null);
    if (!seeds?.length) seeds = await discoverSlugs();
  }
  console.log(`🔎 archives ${SEASONS.join(", ")} depuis ${seeds.length} ligue(s)…`);
  const editions = await discoverEditions(seeds, SEASONS, { expand: !ONLY.length });
  targets = editions.map((slug) => {
    const year = Number(slug.match(/-(\d{4})$/)[1]);
    return { slug, window: { fromUtc: `${year}-01-01`, toUtc: `${year + 1}-01-01` } };
  });
} else {
  const slugs = ONLY.length ? ONLY : await discoverSlugs();
  targets = slugs.map((slug) => ({
    slug: slug + SUFFIX, // nom du fichier de sortie
    page: slug,          // slug de la page à scraper
    window: { ...(FROM && { fromUtc: FROM }), ...(TO && { toUtc: TO }) },
  }));
}
console.log(`🎯 ${targets.length} tournoi(s) : ${targets.map((t) => t.slug).join(", ")}`);
await mkdir(OUT_DIR, { recursive: true });

const index = [];
for (const { slug, page = slug, window } of targets) {
  const file = join(OUT_DIR, `${slug}.json`);
  if (SKIP_EXISTING && await access(file).then(() => true, () => false)) {
    console.log(`⏭  ${slug} : déjà présent`);
    continue;
  }
  console.log(`\n📥 ${slug}…`);
  const { scanned, matches } = await backfillTournament(page, window);
  const from = matches[0]?.startUtc?.slice(0, 10) ?? null;
  const to = matches[matches.length - 1]?.startUtc?.slice(0, 10) ?? null;
  // `books` DÉCRIT LE CONTENU RÉEL du fichier, il n'est pas une liste figée :
  // depuis l'ouverture aux cotes de référence (2026-08-19), un tournoi peut
  // n'être coté QUE par bwin/NetBet — une liste en dur annonçait alors trois
  // opérateurs absents. `booksReference` isole ceux qui ne sont jamais misables.
  const presents = [...new Set(matches.flatMap((m) => Object.keys(m.odds || {})))].sort();
  await writeFile(file, JSON.stringify({
    source: "flashscore.fr (feed embarqué + GraphQL oce)",
    fetchedAt: new Date().toISOString(),
    tournamentSlug: slug,
    books: presents,
    booksReference: presents.filter((o) => REFERENCE.includes(o)),
    stats: { scanned, withOdds: matches.length, from, to },
    matches,
  }, null, 1));
  index.push({ slug, scanned, withOdds: matches.length, from, to });
  console.log(`   ✅ ${matches.length}/${scanned} matchs avec cotes (${from ?? "?"} → ${to ?? "?"})`);
}
// L'index est FUSIONNÉ (jamais réécrit à blanc) : les éditions archivées et la
// saison courante cohabitent, chaque run ne met à jour que ses propres slugs.
if (index.length) {
  const prev = await readFile(join(OUT_DIR, "_index.json"), "utf8").then(JSON.parse).catch(() => ({ tournaments: [] }));
  const by = new Map((prev.tournaments || []).map((t) => [t.slug, t]));
  for (const t of index) by.set(t.slug, t);
  await writeFile(join(OUT_DIR, "_index.json"), JSON.stringify({
    fetchedAt: new Date().toISOString(),
    tournaments: [...by.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
  }, null, 1));
}
console.log(`\n✅ terminé — ${index.reduce((s, t) => s + t.withOdds, 0)} matchs avec cotes sur ${index.length} tournoi(s) -> ${OUT_DIR}`);

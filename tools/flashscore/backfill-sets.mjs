// tools/flashscore/backfill-sets.mjs
// Backfill des cotes HISTORIQUES du marché « nombre de sets », depuis le même
// GraphQL Flashscore que les cotes vainqueur.
//
//   node tools/flashscore/backfill-sets.mjs                  # tous les tournois déjà backfillés
//   node tools/flashscore/backfill-sets.mjs championnats-du-monde-2025
//   node tools/flashscore/backfill-sets.mjs --skip-existing  # reprend une collecte interrompue
//
// POURQUOI un outil séparé de backfill-odds.mjs : celui-ci est validé et coûte
// un navigateur Playwright (découverte des tournois, listes de matchs). Ici
// tout est déjà connu — data/flashscore/odds/<slug>.json porte le fsId, le
// score en sets et la date de chaque match. Il ne reste qu'un appel GraphQL par
// match. On n'y touche donc pas et on écrit à côté, dans
// data/flashscore/sets/<slug>.json.
//
// CE QU'ON RÉCUPÈRE. L'appel `_hash=oce` sert plusieurs familles de paris ;
// backfill-odds.mjs ne gardait que `HOME_AWAY` (vainqueur) et jetait le reste
// (l. 197). Or il porte aussi, avec OUVERTURE et CLÔTURE par bookmaker :
//   - CORRECT_SCORE  : le score exact en sets ("2:0", "2:1", "1:2", "0:2")
//                      — c'est le marché des sets, sous la forme que Betclic
//                      appelle « Score final (sets) » ;
//   - OVER_UNDER     : au badminton c'est un total de POINTS (73,5 / 74,5…),
//                      PAS de sets. Conservé tel quel : c'est une autre famille
//                      de paris, potentiellement mesurable plus tard, et le
//                      collecter maintenant évite un second passage complet.
//
// ON NE RECOMBINE RIEN À L'ÉCRITURE (même règle que lib/books.mjs) : les cotes
// par score sont stockées telles qu'offertes. C'est à l'analyse de décider ce
// qu'elle en fait — « match en 3 sets » se joue en misant 2:1 ET 1:2, ce qui a
// un prix combiné réel mais n'est pas une cote unique offerte.
//
// Politesse : séquentiel, pause de 500 ms, User-Agent réel — comme le backfill
// vainqueur qui a déjà traversé ces mêmes matchs.

import { mkdir, writeFile, readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC_DIR = join(ROOT, "data", "flashscore", "odds");
const OUT_DIR = join(ROOT, "data", "flashscore", "sets");

const args = process.argv.slice(2);
const SKIP_EXISTING = args.includes("--skip-existing");
const ONLY = args.filter((a) => !a.startsWith("--"));

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

// Opérateurs retenus à la COLLECTE — les 3 misables, plus bwin et NetBet comme
// cotes de RÉFÉRENCE (décision du propriétaire du 2026-08-19, motif identique à
// backfill-odds.mjs et à Pinnacle : « collecter tout, filtrer à l'analyse »,
// §10.5). Sur les saisons anciennes ils sont parfois les SEULS à coter.
//
// LES ANALYSES DOIVENT FILTRER. Elles le font déjà : mesure-roi-sets.mjs,
// mesure-gymnase-prix-sets.mjs et mesure-rentabilite-gymnase.mjs ont leur
// constante OPERATEURS à 3 ; mesure-total-points.mjs a reçu le même filtre le
// 2026-08-19 (il parcourait tous les opérateurs). Toute NOUVELLE analyse de ces
// données doit décider explicitement ce qu'elle inclut.
const BOOK_KEY = (name) => {
  const n = String(name).toLowerCase();
  if (n.includes("betclic")) return "betclic";
  if (n.includes("winamax")) return "winamax";
  if (n.includes("unibet")) return "unibet";
  if (n.includes("bwin")) return "bwin";
  if (n.includes("netbet")) return "netbet";
  return null;
};

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, essais = 3) {
  for (let i = 1; i <= essais; i++) {
    try {
      const resp = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      if (i === essais) throw e;
      await pause(1500 * i); // le GraphQL renvoie parfois un 5xx passager
    }
  }
}

/**
 * Cotes « sets » d'un match : par bookmaker retenu, les cotes par score exact
 * (ouverture + clôture) et, à part, le total de points.
 * @returns {{scores: object, points: object}|null}
 */
export function extraireMarches(reponse) {
  const oc = reponse?.data?.findOddsByEventId;
  if (!oc) return null;
  const nom = new Map((oc.settings?.bookmakers || []).map((b) => [b.bookmaker.id, b.bookmaker.name]));
  const scores = {};
  const points = {};
  for (const o of oc.odds || []) {
    if (o.bettingScope !== "FULL_TIME") continue;
    const key = BOOK_KEY(nom.get(o.bookmakerId));
    if (!key) continue;
    if (o.bettingType === "CORRECT_SCORE") {
      const parScore = {};
      for (const it of o.odds || []) {
        if (!it.score) continue;
        parScore[String(it.score).replace(":", "-")] = {
          opening: Number(it.opening) || null,
          closing: Number(it.value) || null,
        };
      }
      if (Object.keys(parScore).length) scores[key] = parScore;
    } else if (o.bettingType === "OVER_UNDER") {
      const lignes = [];
      for (const it of o.odds || []) {
        const h = it.handicap;
        if (!h) continue;
        lignes.push({
          total: Number(h.value),
          type: h.type || null, // POINTS au badminton
          selection: it.selection, // OVER / UNDER
          opening: Number(it.opening) || null,
          closing: Number(it.value) || null,
        });
      }
      if (lignes.length) points[key] = lignes;
    }
  }
  if (!Object.keys(scores).length && !Object.keys(points).length) return null;
  return { scores, points };
}

async function existe(p) {
  try { await access(p); return true; } catch { return false; }
}

async function collecte(slug) {
  const src = JSON.parse(await readFile(join(SRC_DIR, `${slug}.json`), "utf8"));
  const matchs = (src.matches || []).filter((m) => m.fsId);
  const out = [];
  let avecScores = 0;
  for (const [i, m] of matchs.entries()) {
    let marches = null;
    try {
      marches = extraireMarches(await getJson(
        `https://global.ds.lsapp.eu/pq_graphql?_hash=oce&eventId=${m.fsId}` +
        `&projectId=16&geoIpCode=FR&geoIpSubdivisionCode=IDF`,
      ));
    } catch {
      marches = null; // match sans cotes archivées : normal, on le note à null
    }
    if (marches?.scores && Object.keys(marches.scores).length) avecScores++;
    out.push({
      fsId: m.fsId,
      startUtc: m.startUtc,
      disc: m.disc,
      round: m.round,
      home: m.home?.name ?? null,
      away: m.away?.name ?? null,
      // le RÉSULTAT du marché, déjà présent dans le backfill vainqueur
      nbSets: Array.isArray(m.sets) ? m.sets.length : null,
      sets: m.sets ?? null,
      winner: m.winner ?? null,
      scores: marches?.scores ?? null,
      points: marches?.points ?? null,
    });
    if ((i + 1) % 25 === 0) process.stdout.write(`      ${i + 1}/${matchs.length}\r`);
    await pause(500); // on reste courtois
  }
  await writeFile(
    join(OUT_DIR, `${slug}.json`),
    JSON.stringify({
      source: "flashscore.fr (GraphQL oce — CORRECT_SCORE + OVER_UNDER)",
      fetchedAt: new Date().toISOString(),
      tournamentSlug: slug,
      stats: { matchs: out.length, avecScores },
      matches: out,
    }, null, 1) + "\n",
  );
  return { n: out.length, avecScores };
}

await mkdir(OUT_DIR, { recursive: true });
const slugs = ONLY.length
  ? ONLY
  : (await readdir(SRC_DIR)).filter((f) => f.endsWith(".json") && f !== "_index.json").map((f) => f.slice(0, -5));

console.log(`Collecte des cotes « sets » — ${slugs.length} tournois`);
let totalMatchs = 0, totalScores = 0;
for (const slug of slugs) {
  if (SKIP_EXISTING && await existe(join(OUT_DIR, `${slug}.json`))) {
    console.log(`   ⏭  ${slug} (déjà collecté)`);
    continue;
  }
  try {
    const { n, avecScores } = await collecte(slug);
    totalMatchs += n; totalScores += avecScores;
    console.log(`   ✅ ${slug.padEnd(38)} ${String(avecScores).padStart(4)}/${String(n).padEnd(4)} matchs avec cotes de sets`);
  } catch (e) {
    console.log(`   ⚠  ${slug} : ${e.message}`);
  }
}
console.log(`\nTotal : ${totalScores}/${totalMatchs} matchs avec cotes « score exact en sets ».`);

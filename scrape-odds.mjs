// scrape-odds.mjs
// Récupère les cotes badminton BWF sur oddsportal et les écrit dans data/odds/.
//
//   node scrape-odds.mjs                 # aujourd'hui + 4 jours
//   node scrape-odds.mjs 2026-07-30      # une date précise
//   node scrape-odds.mjs 2026-07-30 5    # 5 dates à partir de celle-ci

import fs from "node:fs/promises";
import path from "node:path";
import { OddsClient, dateRange } from "./lib/odds.mjs";
import { runFileName } from "./lib/odds-history.mjs";

// APPEND-ONLY : un fichier par passage, nommé par l'instant du relevé, jamais
// réécrit. L'ancien stockage écrasait data/odds/<date>.json à chaque passage et
// ne gardait que la dernière photo — toute l'évolution de la cote était perdue.
// Or c'est l'évolution qui porte l'information : la cote de CLÔTURE est la
// référence du marché (le seul étalon qui dise si notre modèle peut rapporter),
// et le SENS DU MOUVEMENT dit ce que le marché a appris entre-temps.
const OUT_DIR = path.join("data", "odds", "runs");
const DEFAULT_DAYS = 5; // aujourd'hui + 4

const arg = process.argv[2];
const start = /^\d{4}-\d{2}-\d{2}$/.test(arg || "") ? arg : new Date().toISOString().slice(0, 10);
const days = Number(process.argv[3]) || (arg && !/^\d{4}-\d{2}-\d{2}$/.test(arg) ? Number(arg) : DEFAULT_DAYS);
const dates = dateRange(start, days);

await fs.mkdir(OUT_DIR, { recursive: true });

const client = await new OddsClient().start();
const fetchedAt = new Date().toISOString();
const toutes = [];
let total = 0, bwfTotal = 0;
try {
  for (const [i, date] of dates.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2000)); // on reste courtois
    let rows;
    try {
      rows = await client.fetchDate(date);
    } catch (err) {
      console.log(`⚠ ${date} : ${err.message}`);
      continue;
    }
    total += rows.length;
    // On ne garde que le circuit BWF (écarte ligues nationales, exhibitions…).
    const bwf = rows.filter((r) => /\bBWF\b/i.test(r.league || ""));
    bwfTotal += bwf.length;

    const withOdds = bwf.filter((r) => r.odd1 != null).length;
    const settled = bwf.filter((r) => r.settled).length;
    const noSlug = bwf.filter((r) => !r.p1.slug || !r.p2.slug).length;
    const leagues = [...new Set(bwf.map((r) => r.league))];

    toutes.push(...bwf);
    console.log(
      `📅 ${date} — ${bwf.length} matchs BWF (${withOdds} avec cote, ${settled} déjà joués, ${noSlug} sans slug) / ${rows.length} badminton`
    );
    for (const l of leagues) {
      const n = bwf.filter((r) => r.league === l).length;
      console.log(`     · ${l} — ${n}`);
    }
  }
} finally {
  await client.close();
}

// Une seule écriture, en fin de passage : le fichier est immuable et son nom ne
// peut pas entrer en collision avec un autre relevé.
if (toutes.length) {
  await fs.writeFile(
    path.join(OUT_DIR, runFileName(fetchedAt)),
    JSON.stringify({ fetchedAt, dates, matches: toutes }, null, 1),
  );
  console.log(`\n✅ ${bwfTotal} matchs BWF -> ${OUT_DIR}/${runFileName(fetchedAt)}`);
} else {
  console.log(`\n⚠ aucun match BWF : aucun fichier écrit (on ne crée pas de relevé vide).`);
}
console.log(`   (${total} matchs badminton vus au total)`);
if (bwfTotal === 0) {
  console.error("❌ Aucune ligne récupérée : DOM changé ou blocage. Vérifier avant de committer.");
  process.exitCode = 1;
}

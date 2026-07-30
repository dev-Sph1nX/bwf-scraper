// import-csv-rankings.mjs
// ONE-SHOT : importe les classements mondiaux BWF fournis en CSV vers le même
// format que l'historique scrapé (data/rankings/<date>.json).
//
//   node import-csv-rankings.mjs                       # depuis ~/Documents/bwf-data/csv
//   node import-csv-rankings.mjs <répertoire>          # autre source
//   node import-csv-rankings.mjs --dry-run             # n'écrit rien, valide seulement
//   node import-csv-rankings.mjs --force               # réécrit les fichiers existants
//
// Pourquoi : l'API BWF n'expose que 60 semaines glissantes. Ces CSV couvrent la
// période antérieure (2024-W01 → 2025-W23), ce qui porte l'historique du
// classement à toute la période des matchs scrapés et rend calculable le
// baseline « le mieux classé gagne » du backtest sur ~13 600 matchs au lieu de
// ~5 700.
//
// Le script REFUSE d'écraser une publication venue de l'API (source "api") :
// celle-ci est plus riche, son rankPrevious connaît les rangs au-delà du top 250.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRankingCsv, weekDateChain, withRankChanges } from "./lib/csv-rankings.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEST = join(ROOT, "data", "rankings");
const DISCIPLINES = { MS: false, WS: false, MD: true, WD: true, XD: true }; // -> doubles ?
const DEPTH = 250;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const FORCE = args.includes("--force");
const SRC = args.find((a) => !a.startsWith("--")) || join(homedir(), "Documents", "bwf-data", "csv");

console.log(`Source : ${SRC}`);
if (DRY) console.log("--dry-run : aucune écriture.\n");

// ---- 1) Inventaire ---------------------------------------------------------
const fichiers = (await readdir(SRC)).filter((f) => /^\d{4}-W\d{2}_[A-Z]{2}\.csv$/.test(f));
if (!fichiers.length) {
  console.error(`❌ aucun fichier au format AAAA-Wnn_XX.csv dans ${SRC}`);
  process.exit(1);
}

const parSemaine = new Map(); // "2024-W01" -> { MS: "chemin", … }
for (const f of fichiers) {
  const [semaine, reste] = f.split("_");
  const disc = reste.replace(".csv", "");
  if (!(disc in DISCIPLINES)) continue;
  (parSemaine.get(semaine) ?? parSemaine.set(semaine, {}).get(semaine))[disc] = join(SRC, f);
}

const semaines = [...parSemaine.keys()].sort();
console.log(`${fichiers.length} fichiers, ${semaines.length} semaines (${semaines[0]} → ${semaines.at(-1)}).`);

// Garde-fou : chaque semaine doit avoir ses 5 disciplines, sinon la comparaison
// d'une semaine à l'autre produirait de faux « entrants » sur la discipline absente.
const incompletes = semaines.filter((s) => Object.keys(parSemaine.get(s)).length !== 5);
if (incompletes.length) {
  console.error(`❌ ${incompletes.length} semaine(s) incomplète(s) : ${incompletes.slice(0, 5).join(", ")}`);
  console.error("   Chaque semaine doit avoir MS, WS, MD, WD et XD.");
  process.exit(1);
}

// ---- 2) Datation -----------------------------------------------------------
let chaine;
try {
  chaine = weekDateChain(semaines);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
console.log(`Dates : ${chaine[0].date} → ${chaine.at(-1).date} (toutes des mardis, sans doublon).`);

// Raccord avec l'historique de l'API : la semaine suivant la dernière du lot CSV
// doit être exactement la première publication de l'API. C'est le contrôle qui
// valide l'ancre de datation de bout en bout.
const index = join(DEST, "publications.json");
if (existsSync(index)) {
  const pubs = JSON.parse(await readFile(index, "utf8")).publications;
  const premiereApi = pubs[0]?.date;
  const suivante = new Date(`${chaine.at(-1).date}T00:00:00Z`);
  suivante.setUTCDate(suivante.getUTCDate() + 7);
  const attendue = suivante.toISOString().slice(0, 10);
  if (premiereApi && attendue !== premiereApi) {
    console.error(`❌ raccord rompu : après ${chaine.at(-1).date} on attend ${attendue}, l'API commence le ${premiereApi}`);
    console.error("   L'ancre de datation est fausse ou une semaine manque. Rien n'est écrit.");
    process.exit(1);
  }
  console.log(`Raccord avec l'API : ${chaine.at(-1).date} + 7 j = ${attendue} = première publication API ✅`);
}

// ---- 3) Lecture et parsing -------------------------------------------------
const publications = [];
for (const { week, date, weekNumber, year } of chaine) {
  const chemins = parSemaine.get(week);
  const disciplines = {};
  for (const [disc, doubles] of Object.entries(DISCIPLINES)) {
    try {
      disciplines[disc] = parseRankingCsv(await readFile(chemins[disc], "utf8"), { doubles });
    } catch (e) {
      console.error(`❌ ${week} ${disc} : ${e.message}`);
      process.exit(1);
    }
  }
  publications.push({ week, date, weekNumber, year, disciplines });
}
const lignes = publications.reduce((a, p) => a + Object.values(p.disciplines).reduce((b, r) => b + r.length, 0), 0);
console.log(`Parsé : ${lignes} lignes sur ${publications.length} publications.`);

// ---- 4) Variations de rang -------------------------------------------------
withRankChanges(publications);
let calcules = 0, inconnus = 0;
for (const p of publications.slice(1)) {
  for (const rows of Object.values(p.disciplines)) {
    for (const r of rows) (r.rankPrevious == null ? inconnus++ : calcules++);
  }
}
const pct = (inconnus / (calcules + inconnus) * 100).toFixed(2);
console.log(`Variations : ${calcules} calculées, ${inconnus} inconnues (${pct} % — entités absentes la semaine d'avant).`);

// ---- 5) Écriture -----------------------------------------------------------
let ecrits = 0, sautes = 0, refuses = 0;
for (const p of publications) {
  const chemin = join(DEST, `${p.date}.json`);

  if (existsSync(chemin)) {
    const existant = JSON.parse(await readFile(chemin, "utf8"));
    if (existant.source !== "csv") {
      console.error(`❌ ${p.date}.json existe et ne vient pas des CSV (source: ${existant.source ?? "api"}).`);
      console.error("   Une publication de l'API est plus riche : refus d'écraser.");
      refuses++;
      continue;
    }
    if (!FORCE) { sautes++; continue; }
  }

  if (DRY) { ecrits++; continue; }
  await writeFile(chemin, JSON.stringify({
    publicationId: null,          // les CSV ne portent pas l'identifiant BWF
    date: p.date,
    week: p.weekNumber,
    year: p.year,
    source: "csv",                // trace la provenance : rankPrevious est plafonné à 250
    rankId: 2,
    depth: DEPTH,
    fetchedAt: new Date().toISOString(),
    disciplines: p.disciplines,
  }), "utf8");
  ecrits++;
}

if (refuses) {
  console.error(`\n❌ ${refuses} publication(s) refusée(s). Rien d'autre n'a été modifié.`);
  process.exit(1);
}
console.log(`\n✅ ${DRY ? "[dry-run] " : ""}${ecrits} écrites, ${sautes} déjà présentes.`);
console.log(`   Historique total : ${ecrits + sautes} semaines CSV + les publications de l'API.`);

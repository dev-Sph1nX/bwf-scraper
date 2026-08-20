// Import des classements mondiaux BWF 2022 et 2023 depuis un JSON externe vers
// le store data/rankings/.
//
//   node tools/import-rankings-json.mjs <fichier.json> [autre.json ...]
//   node tools/import-rankings-json.mjs --dry-run <fichier.json>
//
// SCRIPT ONE-SHOT. Le store démarrait à 2024-01-02 alors que data/2022/ et
// data/2023/ contenaient déjà les tournois : l'Elo tournait donc sur deux
// saisons sans rang mondial. Une fois les 104 publications écrites et
// commitées, ce script n'a plus d'objet (les fichiers sources vivent hors du
// dépôt) — il est supprimable.
//
// FORMAT SOURCE (une semaine) :
//   { week, date, categories: { MS: [...], WS, MD, WD, XD } }
// Simples  : { rank, bwf_id, last_name, first_name, country, points, tournaments }
// Doubles  : { rank, p1_bwf_id, p1_last_name, ..., p2_bwf_id, ..., points, tournaments }
//
// ÉCRITURE EN DIRECT, pas via `savePublication` (lib/rank-history.mjs), pour
// deux raisons : ce point d'écriture ne porte pas le champ `source` qui trace
// la provenance, et surtout un import jetable n'a aucune raison de faire
// bouger un module de la chaîne récurrente (fetch-rankings). Le format écrit
// ici est verrouillé par test/import-rankings-json.test.mjs, qui le fait
// consommer par buildWorldMap et buildPlayerRankHistory.

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "data", "rankings");

/** Disciplines à un seul joueur ; les autres portent une paire. */
const SIMPLES = new Set(["MS", "WS"]);

/** Profondeur DEMANDÉE à la source. Le nombre de lignes réellement servies
 *  varie (247 à 255) à cause des ex aequo au rang 250 — même convention que
 *  les publications déjà en store. */
const DEPTH = 250;

/** `rankId` du classement mondial, seule valeur présente dans le store. */
const RANK_ID = 2;

/** Marqueur de provenance, lu par le garde-fou d'écrasement ci-dessous. */
const SOURCE = "json-2022-2023";

/** « Prénom NOM », en ignorant une partie vide plutôt qu'en soudant un espace. */
function nomComplet(prenom, nom) {
  return [prenom, nom].map((s) => String(s ?? "").trim()).filter(Boolean).join(" ");
}

function joueur(id, prenom, nom, pays) {
  return { id: String(id), slug: null, name: nomComplet(prenom, nom), country: pays ?? null };
}

/**
 * Lignes d'une discipline au format du store.
 *
 * `rankPrevious` et `rankChange` restent à `null` : la source ne les porte
 * pas. Les déduire de la semaine précédente serait tentant, mais la première
 * semaine importée n'a pas de précédente et une valeur inventée alimenterait
 * les flèches de variation de l'app sur deux saisons entières.
 *
 * @param {string} disc code discipline (MS, WS, MD, WD, XD)
 * @param {object[]} entries lignes brutes de la source
 */
export function rowsFromEntries(disc, entries) {
  return (entries ?? []).map((e) => ({
    rank: e.rank,
    rankPrevious: null,
    rankChange: null,
    points: e.points,
    tournaments: e.tournaments,
    players: SIMPLES.has(disc)
      ? [joueur(e.bwf_id, e.first_name, e.last_name, e.country)]
      : [
          joueur(e.p1_bwf_id, e.p1_first_name, e.p1_last_name, e.p1_country),
          joueur(e.p2_bwf_id, e.p2_first_name, e.p2_last_name, e.p2_country),
        ],
  }));
}

/**
 * Publication complète (un fichier data/rankings/YYYY-MM-DD.json).
 *
 * @param {{week:number, date:string, categories:object}} week semaine source
 * @param {{year:number, rankId:number, depth:number, fetchedAt:string, source:string}} meta
 */
export function publicationFromWeek(week, meta) {
  const disciplines = {};
  for (const [disc, entries] of Object.entries(week.categories ?? {})) {
    disciplines[disc] = rowsFromEntries(disc, entries);
  }
  return {
    publicationId: null, // la source n'expose aucun identifiant de publication BWF
    date: week.date,
    week: week.week,
    year: meta.year,
    rankId: meta.rankId,
    depth: meta.depth,
    fetchedAt: meta.fetchedAt,
    source: meta.source,
    disciplines,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fichiers = args.filter((a) => !a.startsWith("--"));

  if (fichiers.length === 0) {
    console.error("usage: node tools/import-rankings-json.mjs [--dry-run] <fichier.json> [...]");
    process.exit(1);
  }

  await mkdir(DIR, { recursive: true });
  const existants = new Set(
    (await readdir(DIR).catch(() => [])).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
  );

  const fetchedAt = new Date().toISOString();
  let ecrits = 0;
  let ignores = 0;

  for (const chemin of fichiers) {
    const src = JSON.parse(await readFile(chemin, "utf8"));
    console.log(`\n📥 ${chemin} — ${src.year}, ${src.weeks?.length ?? 0} semaines`);

    for (const week of src.weeks ?? []) {
      const nom = `${week.date}.json`;

      // Garde-fou : on n'écrase JAMAIS une publication existante. Celles venues
      // de l'API BWF portent rankPrevious/rankChange réels et un publicationId ;
      // les remplacer par un import appauvri serait une perte silencieuse.
      if (existants.has(nom)) {
        const dejaLa = JSON.parse(await readFile(join(DIR, nom), "utf8"));
        console.log(`   ⏭  ${nom} existe déjà (source: ${dejaLa.source ?? "api"}) — ignoré`);
        ignores++;
        continue;
      }

      const pub = publicationFromWeek(week, {
        year: src.year ?? Number(week.date.slice(0, 4)),
        rankId: RANK_ID,
        depth: DEPTH,
        fetchedAt,
        source: SOURCE,
      });

      const lignes = Object.values(pub.disciplines).reduce((n, r) => n + r.length, 0);
      if (lignes === 0) {
        console.log(`   ⚠  ${nom} : 0 ligne sur les 5 disciplines — non écrit`);
        continue;
      }

      if (!dryRun) await writeFile(join(DIR, nom), JSON.stringify(pub), "utf8");
      existants.add(nom);
      ecrits++;
      if (week.week === 1 || week.week % 13 === 0) {
        console.log(`   ✓ ${nom} — semaine ${week.week}, ${lignes} lignes`);
      }
    }
  }

  console.log(`\n${dryRun ? "[dry-run] " : ""}${ecrits} publication(s) écrite(s), ${ignores} ignorée(s).`);
}

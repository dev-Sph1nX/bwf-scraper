// fetch-rankings.mjs
// Télécharge le classement mondial officiel BWF (5 disciplines) et le stocke
// dans data/<year>/rankings/world.json. À lancer pour l'année courante.
//
//   node fetch-rankings.mjs            # année courante, refetch SEULEMENT si la
//                                      # publication de la semaine n'est pas déjà là
//   node fetch-rankings.mjs 2026       # année précisée
//   node fetch-rankings.mjs --force    # force le re-téléchargement
//
// Pourquoi conditionnel : la BWF ne publie le classement mondial qu'une fois par
// semaine (le mardi). Le workflow tourne tous les jours ; inutile de re-télécharger
// chaque jour. On se cale sur le MERCREDI (un jour de marge après la publication du
// mardi) : on ne refetch que si le classement en cache est antérieur au dernier
// mercredi. Au pire 1 jour de retard, mais on est sûr d'avoir la nouvelle publication.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWorldRankings } from "./lib/rankings.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const YEAR = Number(args.find((a) => /^\d{4}$/.test(a))) || new Date().getFullYear();

const path = join(ROOT, "data", String(YEAR), "rankings", "world.json");

// Dernier mercredi 00:00 UTC (inclus si on est mercredi).
function lastWednesdayUTC(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const diff = (d.getUTCDay() - 3 + 7) % 7; // 3 = mercredi
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

// Décide s'il faut re-télécharger : oui si aucun cache, ou si le cache est
// antérieur au dernier mercredi (⇒ nouvelle publication hebdo disponible).
let prev = null;
if (existsSync(path)) {
  try { prev = JSON.parse(await readFile(path, "utf8")); } catch { prev = null; }
}
const prevAt = prev?.fetchedAt ? new Date(prev.fetchedAt) : null;
const anchor = lastWednesdayUTC();
const fresh = prevAt && prevAt >= anchor;

if (prevAt) console.log(`Classement en cache : dernière MAJ ${prevAt.toISOString()}`);
else console.log("Classement en cache : aucun.");

if (fresh && !FORCE) {
  console.log(`⏭  Déjà à jour pour cette semaine (≥ ${anchor.toISOString().slice(0, 10)}). Pas de re-téléchargement.`);
  console.log("   (Forcer avec : node fetch-rankings.mjs --force)");
  process.exit(0);
}

console.log(`Classement mondial BWF (${YEAR})${FORCE ? " — forcé" : ""}…`);
const data = await fetchWorldRankings({ onProgress: (c, n) => console.log(`   ✓ ${c} — ${n} entités`) });

await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(data), "utf8");
console.log(`✅ écrit -> ${path} (fetchedAt ${data.fetchedAt})`);

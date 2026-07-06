// fetch-rankings.mjs
// Télécharge le classement mondial officiel BWF (5 disciplines) et le stocke
// dans data/<year>/rankings/world.json. À lancer pour l'année courante.
//
//   node fetch-rankings.mjs        # année courante (2026)
//   node fetch-rankings.mjs 2026

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWorldRankings } from "./lib/rankings.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const YEAR = Number(process.argv[2]) || new Date().getFullYear();

console.log(`Classement mondial BWF (${YEAR})…`);
const data = await fetchWorldRankings({ onProgress: (c, n) => console.log(`   ✓ ${c} — ${n} entités`) });

const path = join(ROOT, "data", String(YEAR), "rankings", "world.json");
await mkdir(dirname(path), { recursive: true });
await writeFile(path, JSON.stringify(data), "utf8");
console.log(`✅ écrit -> ${path}`);

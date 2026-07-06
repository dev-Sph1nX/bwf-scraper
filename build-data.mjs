// build-data.mjs
// Génère les fichiers JSON statiques consommés par l'app React,
// à partir du store (dossier data/). Écrit dans web/public/data/.
//
//   node build-data.mjs           # année 2026 (défaut)
//   node build-data.mjs 2026

import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as views from "./lib/views.mjs";
import { computeElo } from "./lib/elo.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "web", "public", "data");
const YEAR = Number(process.argv[2]) || 2026;

async function write(rel, obj) {
  const path = join(OUT, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(obj), "utf8");
}

console.log(`Génération des données statiques (${YEAR})...`);
await rm(OUT, { recursive: true, force: true });

// Vues globales
await write("summary.json", await views.getSummary(YEAR));
const status = await views.getStatus(YEAR);
await write("status.json", status);
const players = await views.getPlayersList(YEAR);
await write("players.json", players);

// Classement Elo (forme du moment) — par discipline
const elo = await computeElo(YEAR);
const { playerHistory, ...ranking } = elo;
await write("elo/ranking.json", ranking);
console.log(`   Elo : ${ranking.stats.processed} matchs traités, ${ranking.stats.skipped} ignorés`);

// Une page par tournoi (ceux qui ont des données)
let tCount = 0;
for (const t of status.tournaments) {
  if (t.matchCount > 0) {
    await write(`tournament/${t.id}.json`, await views.getTournament(YEAR, t.id));
    tCount++;
  }
}

// Une page par joueur
let pCount = 0;
for (const p of players.players) {
  const detail = await views.getPlayer(YEAR, p.id);
  if (detail) {
    detail.elo = playerHistory[p.id] || [];
    await write(`player/${p.id}.json`, detail);
    pCount++;
  }
}

console.log(`✅ ${tCount} tournois, ${pCount} joueurs écrits dans web/public/data/`);

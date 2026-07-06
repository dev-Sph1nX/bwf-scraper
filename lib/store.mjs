// lib/store.mjs
// Persistance sur disque + "manifeste" qui mémorise ce qui a déjà été
// téléchargé (pour ne pas re-télécharger inutilement).
//
// Arborescence des données :
//   data/manifest.json                       -> métadonnées (dates, statuts)
//   data/<year>/tournaments.json             -> calendrier de l'année
//   data/<year>/<tmtId>/draws.json           -> disciplines d'un tournoi
//   data/<year>/<tmtId>/draw-<drawId>.json   -> un tableau + ses matchs

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(ROOT, "data");
const MANIFEST_PATH = join(DATA_DIR, "manifest.json");

// --- utilitaires fichiers ---
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

// --- manifeste (chargé une fois, gardé en mémoire) ---
let manifest = null;
async function loadManifest() {
  if (manifest) return manifest;
  manifest = existsSync(MANIFEST_PATH) ? await readJson(MANIFEST_PATH) : { years: {}, draws: {} };
  manifest.years ??= {};
  manifest.draws ??= {};
  return manifest;
}
async function saveManifest() {
  await writeJson(MANIFEST_PATH, manifest);
}

const drawKey = (year, tmtId, drawId) => `${year}/${tmtId}/${drawId}`;

// --- chemins ---
const yearPath = (year) => join(DATA_DIR, String(year), "tournaments.json");
const drawsPath = (year, tmtId) => join(DATA_DIR, String(year), String(tmtId), "draws.json");
const drawPath = (year, tmtId, drawId) =>
  join(DATA_DIR, String(year), String(tmtId), `draw-${drawId}.json`);

// --- ISO time sans Date.now() interdit ? On a le droit ici (hors workflow). ---
const now = () => new Date().toISOString();

// ===== Année (calendrier) =====
export async function saveYear(year, data) {
  await writeJson(yearPath(year), data);
  const m = await loadManifest();
  m.years[year] = { fetchedAt: now(), tournamentCount: (data.results ?? []).flatMap((x) => x.tournaments).length };
  await saveManifest();
}
export async function getYear(year) {
  return existsSync(yearPath(year)) ? readJson(yearPath(year)) : null;
}
export async function hasYear(year) {
  return existsSync(yearPath(year));
}

// ===== Draws (disciplines d'un tournoi) =====
export async function saveDraws(year, tmtId, data) {
  await writeJson(drawsPath(year, tmtId), data);
}
export async function getDraws(year, tmtId) {
  return existsSync(drawsPath(year, tmtId)) ? readJson(drawsPath(year, tmtId)) : null;
}
export async function hasDraws(year, tmtId) {
  return existsSync(drawsPath(year, tmtId));
}

// ===== Draw (un tableau + ses matchs) =====
export async function saveDraw(year, tmtId, drawId, data, tournamentStatus) {
  await writeJson(drawPath(year, tmtId, drawId), data);
  const m = await loadManifest();
  m.draws[drawKey(year, tmtId, drawId)] = {
    fetchedAt: now(),
    matchCount: (data.matches ?? []).length,
    tournamentStatus: tournamentStatus ?? null,
  };
  await saveManifest();
}
export async function getDraw(year, tmtId, drawId) {
  return existsSync(drawPath(year, tmtId, drawId)) ? readJson(drawPath(year, tmtId, drawId)) : null;
}
export async function hasDraw(year, tmtId, drawId) {
  return existsSync(drawPath(year, tmtId, drawId));
}
export async function drawMeta(year, tmtId, drawId) {
  const m = await loadManifest();
  return m.draws[drawKey(year, tmtId, drawId)] ?? null;
}

// ===== Lecture agrégée =====
/** Renvoie tous les matchs stockés d'une année, enrichis de leur contexte. */
export async function listAllMatches(year) {
  const out = [];
  const base = join(DATA_DIR, String(year));
  if (!existsSync(base)) return out;
  const tmtDirs = (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory());
  for (const dir of tmtDirs) {
    const tmtId = dir.name;
    const files = (await readdir(join(base, tmtId))).filter((f) => f.startsWith("draw-"));
    for (const file of files) {
      const drawId = file.slice("draw-".length, -".json".length);
      const data = await readJson(join(base, tmtId, file));
      for (const match of data.matches ?? []) {
        out.push({ year: Number(year), tmtId: Number(tmtId), drawId, match });
      }
    }
  }
  return out;
}

export async function getManifest() {
  return loadManifest();
}

/** Années présentes dans le store (dossiers data/<year>). */
export async function listYears() {
  if (!existsSync(DATA_DIR)) return [];
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  return entries
    .filter((d) => d.isDirectory() && /^\d{4}$/.test(d.name))
    .map((d) => Number(d.name))
    .sort((a, b) => a - b);
}

// ===== Récapitulatif du dernier téléchargement =====
export async function saveLastRun(year, record) {
  const m = await loadManifest();
  m.lastRun ??= {};
  m.lastRun[year] = record;
  await saveManifest();
}
export async function getLastRun(year) {
  const m = await loadManifest();
  return m.lastRun?.[year] ?? null;
}

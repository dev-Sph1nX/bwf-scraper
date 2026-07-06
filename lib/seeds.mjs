// lib/seeds.mjs
// Charge le classement mondial initial (début de fenêtre de données) depuis les
// CSV de data/seeds/, pour seeder l'Elo de départ des joueurs/paires.
//
// Chaque CSV = top 60 d'une discipline à une date donnée. Colonnes :
//   simple : Ranking, BWF ID, Last, First, Country, Points, Tour
//   double : Ranking, P1 BWF ID, ..., P2 BWF ID, ..., Points, Tour

import { readFileSync, readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_DIR = join(ROOT, "data", "seeds");

const DISC_BY_NAME = {
  Simple_Hommes: "MS", Simple_Dames: "WS",
  Double_Hommes: "MD", Double_Dames: "WD", Double_Mixte: "XD",
};
const SINGLES = new Set(["MS", "WS"]);

/** { discipline: Map(cléEntité -> rang mondial initial) } */
export function loadInitialRanks() {
  const out = {};
  if (!existsSync(SEED_DIR)) return out;
  for (const f of readdirSync(SEED_DIR)) {
    if (!f.endsWith(".csv")) continue;
    const disc = Object.entries(DISC_BY_NAME).find(([n]) => f.includes(n))?.[1];
    if (!disc) continue;
    const m = out[disc] ??= new Map();
    const lines = readFileSync(join(SEED_DIR, f), "utf8").trim().split(/\r?\n/).slice(1);
    for (const line of lines) {
      const c = line.split(",");
      const rank = Number(c[0]);
      if (!rank) continue;
      if (SINGLES.has(disc)) {
        m.set(`p:${c[1]}`, rank);
      } else {
        const ids = [String(c[1]), String(c[5])].sort();
        m.set(`pair:${ids.join("-")}`, rank);
      }
    }
  }
  return out;
}

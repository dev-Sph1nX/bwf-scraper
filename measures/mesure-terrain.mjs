// measures/mesure-terrain.mjs
// MESURE : jouer « à domicile » (pays du joueur = pays du tournoi) aide-t-il ?
//
//   node measures/mesure-terrain.mjs
//
// Deux tests complémentaires :
//
// 1. CONDITIONNEL — victoires observées du camp à domicile vs attendues par
//    l'Elo d'avant match. Lisible, mais dépend de la calibration de l'Elo (or
//    il est « trop timide », §1.3 du journal) : à prendre comme indication.
// 2. ISOLATION À NIVEAU CONTRÔLÉ (la méthode de référence du projet) — matchs
//    entre entités d'Elo quasi identique, un seul camp à domicile : tout écart
//    à 50 % est imputable au facteur. Aucune hypothèse de calibration.
//
// Résultat du 2026-07-31 : +2,2 pts conditionnel (z = 2,0) ; en isolation
// 55,6 % à |ΔElo| ≤ 50 (z = 2,1) et 55,5 % à ≤ 100 (z = 2,8). Effet réel,
// ≈ 16 points d'Elo, concentré sur le SIMPLE. Ne touche que ~12 % des matchs.

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();

// Code pays du tournoi, extrait du drapeau (le champ texte est un nom anglais).
const meta = new Map();
for (const y of years) {
  try {
    const t = JSON.parse(await readFile(join(ROOT, "data", String(y), "tournaments.json"), "utf8"));
    for (const m of (Array.isArray(t) ? t : t.results ?? []))
      for (const tt of m.tournaments ?? [])
        meta.set(Number(tt.id), /\/([A-Z]{3})\.png/.exec(tt.flag_url || "")?.[1] ?? null);
  } catch {}
}

const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, won, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (a.entity.matches < 5 || b.entity.matches < 5) return; // Elo non provisoire
    const cc = meta.get(Number(tmtId));
    if (!cc) return;
    const homeA = a.players.every((p) => p.countryCode === cc);
    const homeB = b.players.every((p) => p.countryCode === cc);
    if (homeA === homeB) return; // il faut EXACTEMENT un camp à domicile
    rows.push({
      disc, won,
      homeA,
      gap: Math.abs(a.entity.rating - b.entity.rating),
      pA: 1 / (1 + 10 ** ((b.entity.rating - a.entity.rating) / 400)),
    });
  },
});
console.log(`Matchs avec un seul camp à domicile (Elo non provisoire des 2 côtés) : ${rows.length}`);

// --- 1) Conditionnel : observé vs attendu par l'Elo ---------------------------
let obs = 0, exp = 0, varSum = 0;
for (const r of rows) {
  const pHome = r.homeA ? r.pA : 1 - r.pA;
  obs += r.homeA ? r.won : 1 - r.won;
  exp += pHome; varSum += pHome * (1 - pHome);
}
const pbar = exp / rows.length;
const dPdElo = (Math.LN10 / 400) * pbar * (1 - pbar); // pente proba/Elo au voisinage
console.log(`\nConditionnel : domicile gagne ${(100 * obs / rows.length).toFixed(1)} % vs ${(100 * pbar).toFixed(1)} % attendus par l'Elo`);
console.log(`→ excès ${(100 * (obs - exp) / rows.length).toFixed(2)} pt, z = ${((obs - exp) / Math.sqrt(varSum)).toFixed(2)}, ≈ ${((obs - exp) / rows.length / dPdElo).toFixed(0)} points d'Elo`);
for (const disc of ["MS", "WS", "MD", "WD", "XD"]) {
  const rs = rows.filter((r) => r.disc === disc);
  if (rs.length < 50) continue;
  let o = 0, e = 0, v = 0;
  for (const r of rs) {
    const p = r.homeA ? r.pA : 1 - r.pA;
    o += r.homeA ? r.won : 1 - r.won; e += p; v += p * (1 - p);
  }
  console.log(`  ${disc} : n=${rs.length}, ${(100 * o / rs.length).toFixed(1)} % vs ${(100 * e / rs.length).toFixed(1)} %, z=${((o - e) / Math.sqrt(v)).toFixed(2)}`);
}

// --- 2) Isolation à niveau contrôlé (référence) --------------------------------
console.log("\nIsolation à niveau contrôlé (référence 50 %) :");
for (const lim of [50, 100]) {
  const rs = rows.filter((r) => r.gap <= lim);
  const w = rs.reduce((s, r) => s + (r.homeA ? r.won : 1 - r.won), 0);
  const p = w / rs.length, se = Math.sqrt(0.25 / rs.length);
  console.log(`  |ΔElo| ≤ ${lim} : ${rs.length} matchs, domicile gagne ${(100 * p).toFixed(1)} %, z = ${((p - 0.5) / se).toFixed(2)}`);
}

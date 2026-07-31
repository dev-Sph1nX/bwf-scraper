// measures/mesure-gymnase-3sets.mjs
// MESURE : certains gymnases produisent-ils plus (ou moins) de matchs en 3 sets ?
//
//   node measures/mesure-gymnase-3sets.mjs
//
// Intuition d'origine (propriétaire) : dans certaines salles, un côté du
// terrain est défavorisé (courants d'air) → les joueurs y jouent moins bien →
// plus de matchs accrochés en 3 sets. Le marché « le match ira-t-il en 3
// sets ? » existe chez les bookmakers : un effet stable serait exploitable.
//
// MÉTHODE.
// 1. Pour chaque match joué : lieu (ville du tournoi), discipline, 3 sets ou
//    non, et écart d'Elo AVANT match (crochet onMatch — mêmes garanties
//    anti-fuite que le backtest).
// 2. Contrôle du facteur évident (des affiches serrées → plus de 3 sets) : le
//    taux attendu d'un gymnase est la somme, sur ses matchs, du taux global de
//    3 sets de la case (tranche d'écart Elo de 50 × discipline). Nonparamétrique,
//    aucune hypothèse de calibration.
// 3. z par gymnase = (observé − attendu) / écart-type binomial. Sous « aucun
//    effet gymnase », les z ~ N(0,1) : on teste la sur-dispersion (Σz² vs χ²).
// 4. PERSISTANCE année N → N+1 : la seule chose qui rende le signal pariable.
//
// Résultat du 2026-07-31 (13 368 matchs, 35 lieux ≥ 60 matchs) : sur-dispersion
// ≈ 6 σ, persistance r = 0,42 — effet réel et stable. Détail dans
// docs/journal-des-mesures.md.

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover, wentThreeSets } from "../lib/dataset.mjs";
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

// Lieu normalisé (accents, ", ,", "City"…) : les éditions successives du même
// tournoi se regroupent, et "Orléans"/"Orleans" ne comptent qu'un gymnase.
const norm = (s) =>
  String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\bcity\b/g, "").replace(/[,\s]+/g, " ").trim();
const meta = new Map();
for (const y of years) {
  try {
    const t = JSON.parse(await readFile(join(ROOT, "data", String(y), "tournaments.json"), "utf8"));
    for (const m of (Array.isArray(t) ? t : t.results ?? []))
      for (const tt of m.tournaments ?? [])
        meta.set(Number(tt.id), norm(tt.location || tt.country || `t${tt.id}`));
  } catch {}
}

const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || match.score.length < 2) return;
    rows.push({
      venue: meta.get(Number(tmtId)) ?? `t${tmtId}`,
      disc,
      year: Number(String(match.matchTime).slice(0, 4)),
      three: wentThreeSets(match.score) ? 1 : 0,
      gap: Math.abs(a.entity.rating - b.entity.rating),
    });
  },
});

// Taux attendu par case (tranche d'écart Elo de 50 × discipline).
const bandOf = (gap) => Math.min(6, Math.floor(gap / 50));
const cell = new Map();
for (const r of rows) {
  const c = `${bandOf(r.gap)}|${r.disc}`;
  const s = cell.get(c) || { n: 0, k: 0 };
  s.n++; s.k += r.three; cell.set(c, s);
}
const expectedOf = (r) => { const s = cell.get(`${bandOf(r.gap)}|${r.disc}`); return s.k / s.n; };

const venues = new Map();
for (const r of rows) {
  const s = venues.get(r.venue) || { n: 0, obs: 0, exp: 0, varSum: 0, byYear: new Map() };
  const p = expectedOf(r);
  s.n++; s.obs += r.three; s.exp += p; s.varSum += p * (1 - p);
  const yy = s.byYear.get(r.year) || { n: 0, obs: 0, exp: 0 };
  yy.n++; yy.obs += r.three; yy.exp += p; s.byYear.set(r.year, yy);
  venues.set(r.venue, s);
}

const global = rows.reduce((s, r) => s + r.three, 0) / rows.length;
console.log(`Matchs : ${rows.length} | taux global de 3 sets : ${(global * 100).toFixed(1)} %`);

const scored = [...venues.entries()].filter(([, s]) => s.n >= 60)
  .map(([v, s]) => ({ venue: v, n: s.n, rate: s.obs / s.n, expRate: s.exp / s.n, z: (s.obs - s.exp) / Math.sqrt(s.varSum) }))
  .sort((x, y) => y.z - x.z);
console.log("\nGymnase (lieu, ≥60 matchs) | n | 3 sets obs. | attendu | z");
for (const s of scored) {
  console.log(`${s.venue.padEnd(28)} ${String(s.n).padStart(5)}  ${(s.rate * 100).toFixed(1).padStart(5)} %  ${(s.expRate * 100).toFixed(1).padStart(5)} %  ${s.z.toFixed(2).padStart(6)}`);
}
const chi2 = scored.reduce((s, x) => s + x.z * x.z, 0), df = scored.length;
console.log(`\nSur-dispersion : Σz² = ${chi2.toFixed(1)} pour ${df} gymnases → ${((chi2 - df) / Math.sqrt(2 * df)).toFixed(2)} σ au-dessus de « aucun effet »`);

// Persistance N → N+1 (même lieu, ≥40 matchs chaque année).
const paires = [];
for (const [, s] of venues) {
  const ys = [...s.byYear.keys()].sort();
  for (let i = 0; i + 1 < ys.length; i++) {
    const a = s.byYear.get(ys[i]), b = s.byYear.get(ys[i + 1]);
    if (ys[i + 1] === ys[i] + 1 && a.n >= 40 && b.n >= 40)
      paires.push({ ra: (a.obs - a.exp) / a.n, rb: (b.obs - b.exp) / b.n });
  }
}
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
if (paires.length >= 5) {
  const xa = paires.map((p) => p.ra), xb = paires.map((p) => p.rb);
  const ma = mean(xa), mb = mean(xb);
  const r = mean(paires.map((p) => (p.ra - ma) * (p.rb - mb))) /
    (Math.sqrt(mean(xa.map((x) => (x - ma) ** 2))) * Math.sqrt(mean(xb.map((x) => (x - mb) ** 2))));
  console.log(`Persistance : ${paires.length} paires d'années consécutives, r = ${r.toFixed(3)} (≈0 = non pariable ; >0,3 = stable)`);
} else {
  console.log(`Persistance : ${paires.length} paires seulement — pas assez pour conclure.`);
}

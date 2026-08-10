// measures/mesure-calibration-tranches.mjs
// MESURE (lot C n° 0, « là où le modèle saigne ») : la calibration du modèle de
// PRODUCTION (Elo recalibré), décomposée par tranche de confiance × discipline.
//
//   node measures/mesure-calibration-tranches.mjs
//   node measures/mesure-calibration-tranches.mjs --annees=2025,2026
//   node measures/mesure-calibration-tranches.mjs --paries   # restreint aux matchs avec cotes
//
// Question : la tranche 70-80 % perd deux fois plus que les autres en ROI —
// est-ce un défaut de calibration LOCALISÉ (un « 75 % » annoncé qui ne vaudrait
// que ~68-70 % en réalité), et dans quelles disciplines ? Le correctif §1.3
// n'a été appliqué qu'aux disciplines féminines (WS/WD) ; MS et XD, les pires
// en ROI (§8.1), sont restées sans correction.
//
// Méthode : prédictions walk-forward (crochet d'avant match de lib/elo.mjs,
// aucune fuite), probabilité REPLIÉE sur le favori (p ≥ 50 %), 5 tranches de
// 10 points × 5 disciplines. Dans chaque case : proba annoncée moyenne vs
// fréquence observée, avec IC 95 % BINOMIAL (Wilson) sur la fréquence. Une
// case est marquée « défaut » si la proba annoncée sort de l'IC observé.
//
// GARDE-FOU de lecture : 25 cases testées à 95 % ≈ 1 fausse alerte attendue
// par hasard. Ne conclure que sur les cases nettes ou les motifs cohérents
// (même signe sur plusieurs tranches d'une discipline).

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { eloProb, isProvisional } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : null;
};
const ANNEES = arg("annees") ? arg("annees").split(",").map(Number) : null;
const PARIES = process.argv.includes("--paries");

// ---- 1) Prédictions walk-forward (mêmes lignes que le banc d'essai) ---------
const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();
const entityId = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
};
const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (isProvisional(a.entity.matches) || isProvisional(b.entity.matches)) return;
    rows.push({
      tmtId, disc,
      year: Number(String(match.matchTime).slice(0, 4)),
      day: String(match.matchTime).slice(0, 10),
      a: entityId(a.players), b: entityId(b.players),
      winner: match.winner,
      pBrut: eloProb(a.entity.rating, b.entity.rating),
      pProd: recalibrate(eloProb(a.entity.rating, b.entity.rating), disc),
    });
  },
});

let sel = ANNEES ? rows.filter((r) => ANNEES.includes(r.year)) : rows;

// Option --paries : mêmes matchs que l'étude ROI (intersection prono + cotes),
// via la jointure de production (web/public/data/pronos/*.json, cf. banc d'essai).
if (PARIES) {
  const dir = join(ROOT, "web", "public", "data", "pronos");
  const withOdds = new Set();
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(await readFile(join(dir, f), "utf8"));
    for (const m of j.matches || []) {
      if (m.odds?.books) withOdds.add(`${j.tmtId}|${m.disc}|${String(m.matchTime || "").slice(0, 10)}|${m.a}|${m.b}`);
    }
  }
  sel = sel.filter((r) => withOdds.has(`${r.tmtId}|${r.disc}|${r.day}|${r.a}|${r.b}`));
}

console.log(
  `Calibration par tranche × discipline — modèle de production (Elo recalibré)\n` +
  `${sel.length} matchs walk-forward` +
  (ANNEES ? `, années ${ANNEES.join(",")}` : ` (${years.join(", ")})`) +
  (PARIES ? ", restreints aux matchs AVEC COTES (le terrain de l'étude ROI)" : "") + "\n",
);

// ---- 2) Cases tranche × discipline ------------------------------------------
const BANDS = ["50-60", "60-70", "70-80", "80-90", "90-100"];
const DISCS = ["MS", "WS", "MD", "WD", "XD"];
const bandOf = (pFav) => BANDS[Math.min(Math.floor((pFav - 0.5) / 0.1), BANDS.length - 1)];

/** IC 95 % de Wilson sur une fréquence binomiale (k succès sur n). */
function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n, z2 = z * z;
  const den = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const marge = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [(centre - marge) / den, (centre + marge) / den];
}

function cellsOf(pKey) {
  // case `${disc}|${band}` + marges `*|${band}` et `${disc}|*`
  const acc = new Map();
  const add = (key, pFav, won) => {
    let c = acc.get(key);
    if (!c) acc.set(key, (c = { n: 0, sumP: 0, k: 0 }));
    c.n++; c.sumP += pFav; c.k += won;
  };
  for (const r of sel) {
    const p = r[pKey];
    const pFav = p >= 0.5 ? p : 1 - p;
    const won = (p >= 0.5 ? 1 : 2) === r.winner ? 1 : 0;
    const b = bandOf(pFav);
    add(`${r.disc}|${b}`, pFav, won);
    add(`*|${b}`, pFav, won);
    add(`${r.disc}|*`, pFav, won);
  }
  return acc;
}

const fmt = (v, d = 1) => (v == null ? "  —  " : (v * 100).toFixed(d) + " %");
function printTable(pKey, titre) {
  const acc = cellsOf(pKey);
  console.log(`=== ${titre} ===`);
  console.log("annoncé = proba moyenne du favori ; observé = fréquence de victoire du favori ; [IC] = Wilson 95 %");
  console.log("⚠️ = l'annoncé sort de l'IC observé (défaut de calibration significatif à 95 %)\n");
  const head = ["", ...BANDS, "toutes"].map((h, i) => h.padEnd(i ? 26 : 4)).join("");
  console.log(head);
  const defauts = [];
  for (const disc of [...DISCS, "*"]) {
    const cells = [...BANDS, "*"].map((b) => {
      const c = acc.get(`${disc}|${b}`);
      if (!c || c.n < 10) return "—".padEnd(26);
      const annonce = c.sumP / c.n, obs = c.k / c.n;
      const [lo, hi] = wilson(c.k, c.n);
      const off = annonce < lo || annonce > hi;
      if (off && disc !== "*" && b !== "*") defauts.push({ disc, b, annonce, obs, lo, hi, n: c.n });
      const s = `${fmt(annonce)}→${fmt(obs)} n=${c.n}${off ? "⚠️" : ""}`;
      return s.padEnd(26);
    });
    console.log((disc === "*" ? "TOUT" : disc).padEnd(4) + cells.join(""));
  }
  console.log();
  return defauts;
}

const defProd = printTable("pProd", "MODÈLE DE PRODUCTION (Elo recalibré : étirement WS 1,50 / WD 1,31)");
printTable("pBrut", "CONTRÔLE : Elo brut (avant recalibration) — pour situer ce que §1.3 a déjà corrigé");

// ---- 3) Résumé des défauts significatifs ------------------------------------
console.log("=== Cases en défaut significatif (production) ===");
if (!defProd.length) console.log("aucune");
for (const d of defProd) {
  const sens = d.obs > d.annonce ? "TIMIDE (favori sous-estimé)" : "SUR-CONFIANT (favori surestimé)";
  console.log(
    `  ${d.disc} ${d.b} : annoncé ${fmt(d.annonce)}, observé ${fmt(d.obs)} ` +
    `IC [${fmt(d.lo)} ; ${fmt(d.hi)}] n=${d.n} → ${sens}`,
  );
}
console.log(
  "\nRappel : 25 cases testées à 95 % ≈ 1 fausse alerte attendue par hasard. " +
  "Chercher les MOTIFS (plusieurs tranches d'une même discipline dans le même sens), pas les cases isolées.",
);

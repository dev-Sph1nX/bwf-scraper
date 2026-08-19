// measures/mesure-roi-modele.mjs
// BANC D'ESSAI DU MODÈLE — implémente le protocole FIGÉ de docs/banc-essai-modele.md.
// C'est LA méthode d'évaluation de toute modification du modèle.
//
//   node measures/mesure-roi-modele.mjs                    # table par défaut (réf + elo-brut)
//   node measures/mesure-roi-modele.mjs --toutes           # inclut les variantes désactivées
//   node measures/mesure-roi-modele.mjs --variantes=a,b    # active des variantes par clé
//   node measures/mesure-roi-modele.mjs --annees=2025,2026 # juge sur ces années seulement
//   node measures/mesure-roi-modele.mjs --devig=power      # dé-vig : mult (défaut) | power | shin
//
// PRÉREQUIS : `npm run build-data` (le banc lit web/public/data/pronos/*.json,
// qui porte la jointure prono ↔ cotes de production — la même que roi.json).
//
// Le protocole, en une phrase : mêmes matchs pour toutes les variantes
// (intersection prono + cotes), probas d'AVANT match (walk-forward, aucune
// fuite), graine 42 partout, référence = modèle de production (elo-recalibré).
//
// Les 4 métriques + 2 garde-fous :
//   M0  Δlog-loss vs marché : log loss du modèle − log loss des probas du
//       marché dé-viggées (clôture). Négatif = on prédit MIEUX que le marché.
//       Calculé globalement ET sur le sous-ensemble des matchs pariés.
//   M1  EV vs clôture dé-viggée (LE juge d'entraînement) : pour chaque pari
//       value (EV>0, meilleure cote de clôture), proba_marché × cote_prise − 1.
//       C'est un ROI en centimes par euro SANS bruit de résultat.
//   M2  CLV des paris value à l'ouverture (à surveiller) : cote prise à
//       l'ouverture / meilleure cote de clôture du même camp − 1.
//   M3  ΔROI réel APPARIÉ vs référence (LE juge de décision) : différence de
//       gain match par match sur les MÊMES matchs, IC bootstrap (graine 42).
//   Garde-fous : log loss absolu + erreur de calibration (anti-copie du marché).
//
// Règle de décision : entraîner sur M1, surveiller M2, décider avec M3.
//
// AJOUTER UNE VARIANTE : une entrée dans VARIANTES ci-dessous — `p(row)` rend
// la proba (team1) d'avant match à partir de la ligne (eloA/eloB/disc/year/t…),
// `prepare(rows)` (optionnel) ajuste ses paramètres en RESPECTANT la marche
// avant (n'utiliser pour un match que des données strictement antérieures).
// Prochaines candidates prévues : facteur âge, Elo à marge de points.

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { eloProb, isProvisional } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { valueBets, favoriBets, bestOddAt, aggregate } from "../lib/roi.mjs";
import { logLoss, calibrationError, makeRng } from "../lib/metrics.mjs";
import { varianteTerrain } from "./variante-terrain.mjs";
import { VARIANTES_ELO_POINTS } from "./variante-elo-points.mjs";
import { makeVarianteAge } from "./variante-age.mjs";
import { makeVarianteHand } from "./variante-hand.mjs";
import { makeVariantesCombinees } from "./variante-combinee.mjs";
import { makeVariantesArbres } from "./variante-arbres.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEED = 42;
const DRAWS = 1000;

// ---- Options en ligne de commande -------------------------------------------
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : null;
};
const DEVIG = arg("devig") || "mult";
const ANNEES = arg("annees") ? arg("annees").split(",").map(Number) : null;
const ACTIVEES = new Set((arg("variantes") || "").split(",").filter(Boolean));
const TOUTES = process.argv.includes("--toutes");

// ==============================================================================
// 1) Probas d'avant match : UNE passe Elo chronologique (walk-forward).
//    Le crochet onMatch de lib/elo.mjs est appelé AVANT la mise à jour des
//    notes : eloA/eloB sont donc l'état d'avant match, comme en production.
// ==============================================================================
console.log("Banc d'essai du modèle — protocole docs/banc-essai-modele.md");
console.log("1) Rejeu walk-forward de l'historique (probas d'avant match)…");

const entityId = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
};

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();

// Toutes les lignes prédictibles (même sans cotes) : les variantes qui
// s'ajustent en marche avant (prepare) ont besoin du maximum de matchs.
const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (isProvisional(a.entity.matches) || isProvisional(b.entity.matches)) return;
    rows.push({
      tmtId, disc,
      t: match.matchTime,
      year: Number(String(match.matchTime).slice(0, 4)),
      day: String(match.matchTime).slice(0, 10),
      a: entityId(a.players), b: entityId(b.players),
      winner: match.winner,
      eloA: a.entity.rating, eloB: b.entity.rating,
    });
  },
});
console.log(`   ${rows.length} matchs prédictibles (${years.join(", ")}).`);

// ==============================================================================
// 2) Cotes : la jointure de PRODUCTION (web/public/data/pronos/*.json, écrite
//    par build-data). On ne la réimplémente pas : même intersection que roi.json.
// ==============================================================================
console.log("2) Lecture des cotes appariées (jointure de production)…");
const PRONOS_DIR = join(ROOT, "web", "public", "data", "pronos");
let pronoFiles;
try {
  pronoFiles = (await readdir(PRONOS_DIR)).filter((f) => f.endsWith(".json"));
} catch {
  console.error(
    "\n❌ web/public/data/pronos/ introuvable : lancer d'abord `npm run build-data`\n" +
    "   (le banc réutilise la jointure prono ↔ cotes de production, il ne la duplique pas).",
  );
  process.exit(1);
}
const oddsByKey = new Map(); // tmtId|disc|jour|a|b -> { books, prodProb }
for (const f of pronoFiles) {
  const j = JSON.parse(await readFile(join(PRONOS_DIR, f), "utf8"));
  for (const m of j.matches || []) {
    if (!m.odds?.books) continue;
    const day = String(m.matchTime || "").slice(0, 10);
    oddsByKey.set(`${j.tmtId}|${m.disc}|${day}|${m.a}|${m.b}`, {
      books: m.odds.books, prodProb: m.prob ?? null,
    });
  }
}
console.log(`   ${oddsByKey.size} matchs joués avec cotes (${pronoFiles.length} tournois).`);

// ==============================================================================
// 3) Le socle du banc : intersection prono + cotes (+ filtre --annees éventuel).
//    Vérification anti-fuite : la proba de production relue dans pronos/*.json
//    doit être EXACTEMENT celle que notre rejeu recalcule (au pourcent près,
//    c'est l'arrondi de production). Un écart = les deux passes divergent.
// ==============================================================================
let base = [];
let mismatches = 0;
for (const r of rows) {
  const o = oddsByKey.get(`${r.tmtId}|${r.disc}|${r.day}|${r.a}|${r.b}`);
  if (!o) continue;
  if (o.prodProb != null) {
    const pProd = Math.round(recalibrate(eloProb(r.eloA, r.eloB), r.disc) * 100);
    if (pProd !== o.prodProb) mismatches++;
  }
  base.push({ ...r, books: o.books });
}
if (ANNEES) base = base.filter((r) => ANNEES.includes(r.year));
console.log(
  `3) Socle du banc : ${base.length} matchs prono + cotes` +
  (ANNEES ? ` (années jugées : ${ANNEES.join(", ")})` : "") +
  ` — parité prod : ${mismatches === 0 ? "OK (0 écart)" : `⚠️ ${mismatches} écarts de proba`}`,
);
if (mismatches > base.length * 0.01) {
  console.error("❌ Trop d'écarts avec la production : relancer `npm run build-data` (données plus récentes que la jointure).");
  process.exit(1);
}

// ==============================================================================
// 4) Dé-vig : retirer la marge du bookmaker des cotes de clôture pour obtenir
//    la probabilité du marché. Les cotes publiées somment à > 100 % en probas
//    implicites (l'excédent EST la marge, ~6-9 % ici).
//    - mult  : chaque proba implicite divisée par la somme (standard, défaut) ;
//    - power : (1/o1)^k + (1/o2)^k = 1 — charge plus de marge sur l'outsider ;
//    - shin  : modèle de Shin (parieurs informés) — même correction, autre voie.
//    La proba marché d'un match = moyenne des dé-vigs des books qui cotent les
//    deux camps à la clôture (la moyenne lisse les erreurs d'un book isolé ;
//    prendre la MEILLEURE cote de chaque camp sous-estimerait la marge).
// ==============================================================================
const devigOne = {
  mult(o1, o2) {
    const i1 = 1 / o1, i2 = 1 / o2;
    return i1 / (i1 + i2);
  },
  power(o1, o2) {
    const i1 = 1 / o1, i2 = 1 / o2;
    let lo = 0.3, hi = 5; // (1/o)^k : somme décroissante en k
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      (Math.pow(i1, mid) + Math.pow(i2, mid) > 1) ? (lo = mid) : (hi = mid);
    }
    return Math.pow(i1, (lo + hi) / 2);
  },
  shin(o1, o2) {
    const pi1 = 1 / o1, pi2 = 1 / o2, s = pi1 + pi2;
    const g = (z, pi) => (Math.sqrt(z * z + 4 * (1 - z) * (pi * pi) / s) - z) / (2 * (1 - z));
    let lo = 0, hi = 0.5; // somme décroissante en z ; z=0 -> somme = sqrt(s) > 1
    for (let it = 0; it < 80; it++) {
      const mid = (lo + hi) / 2;
      (g(mid, pi1) + g(mid, pi2) > 1) ? (lo = mid) : (hi = mid);
    }
    return g((lo + hi) / 2, pi1);
  },
};
if (!devigOne[DEVIG]) { console.error(`❌ --devig=${DEVIG} inconnu (mult|power|shin)`); process.exit(1); }

/** Proba marché (team1) dé-viggée depuis la clôture ; null si aucun book complet. */
function marketProb(books, method) {
  let s = 0, n = 0;
  for (const b of Object.values(books || {})) {
    if (!(b.odd1 > 1) || !(b.odd2 > 1)) continue;
    s += devigOne[method](b.odd1, b.odd2); n++;
  }
  return n ? s / n : null;
}
for (const r of base) {
  r.q = marketProb(r.books, DEVIG);            // méthode choisie (table principale)
  r.qMult = DEVIG === "mult" ? r.q : marketProb(r.books, "mult");
  r.qPower = DEVIG === "power" ? r.q : marketProb(r.books, "power");
  r.qShin = DEVIG === "shin" ? r.q : marketProb(r.books, "shin");
}
base = base.filter((r) => r.q != null); // sans proba marché, M0/M1 impossibles

// ==============================================================================
// 5) Les VARIANTES : chacune est une fonction ligne -> proba (team1).
//    `actif: false` = variante d'étude, à activer via --variantes= ou --toutes.
// ==============================================================================

/**
 * Étirement des log-cotes ajusté en MARCHE AVANT, par discipline : pour les
 * matchs de l'année Y, le facteur est ajusté sur les années STRICTEMENT
 * antérieures (aucune fuite — contrairement au facteur de production, figé
 * après coup sur 2024-2026 entier). 2024 reste sans correction (rien d'antérieur).
 * Le facteur n'est APPLIQUÉ que si son IC bootstrap (200 tirages, graine 42)
 * exclut 1 — même règle de prudence que lib/calibrate.mjs.
 */
function fitStretchWalkForward(allRows, { discs = ["MS", "WS", "MD", "WD", "XD"], gate = true } = {}) {
  // Ajustement 1-D par maximum de vraisemblance (Newton) : won ~ sigmoid(s·logit(p)).
  const fit = (zs, ys) => {
    let s = 1;
    for (let it = 0; it < 25; it++) {
      let g = 0, h = 0;
      for (let i = 0; i < zs.length; i++) {
        const e = 1 / (1 + Math.exp(-s * zs[i]));
        g += (ys[i] - e) * zs[i];
        h -= e * (1 - e) * zs[i] * zs[i];
      }
      const step = g / h;
      s -= step;
      if (Math.abs(step) < 1e-8) break;
    }
    return Math.min(4, Math.max(0.25, s));
  };
  const table = new Map(); // `${disc}|${year}` -> facteur appliqué
  const detail = [];
  const yearsSeen = [...new Set(allRows.map((r) => r.year))].sort();
  for (const disc of discs) {
    const dRows = allRows.filter((r) => r.disc === disc);
    for (const Y of yearsSeen) {
      const past = dRows.filter((r) => r.year < Y);
      if (past.length < 300) { table.set(`${disc}|${Y}`, 1); continue; }
      const zs = past.map((r) => {
        const p = Math.min(1 - 1e-9, Math.max(1e-9, eloProb(r.eloA, r.eloB)));
        return Math.log(p / (1 - p));
      });
      const ys = past.map((r) => (r.winner === 1 ? 1 : 0));
      const s = fit(zs, ys);
      let applied = s, lo = null, hi = null;
      if (gate) {
        const rng = makeRng(SEED);
        const boots = [];
        const bz = new Array(zs.length), by = new Array(zs.length);
        for (let d = 0; d < 200; d++) {
          for (let i = 0; i < zs.length; i++) {
            const j = (rng() * zs.length) | 0;
            bz[i] = zs[j]; by[i] = ys[j];
          }
          boots.push(fit(bz, by));
        }
        boots.sort((x, y) => x - y);
        lo = boots[Math.floor(0.025 * boots.length)];
        hi = boots[Math.floor(0.975 * boots.length)];
        if (lo <= 1 && hi >= 1) applied = 1; // 1 dans l'IC : rien de prouvé, pas de correction
      }
      table.set(`${disc}|${Y}`, applied);
      detail.push({ disc, year: Y, n: past.length, fit: s, lo, hi, applied });
    }
  }
  return { table, detail };
}

const stretchP = (p, s) => {
  if (s === 1 || p <= 1e-9 || p >= 1 - 1e-9) return p;
  const z = Math.log(p / (1 - p));
  return 1 / (1 + Math.exp(-s * z));
};

const VARIANTES = [
  {
    key: "elo-recalibre", label: "elo-recalibré (réf)", ref: true, actif: true,
    // Production : Elo + étirement WS 1,50 / WD 1,31 (lib/calibrate.mjs).
    p: (r) => recalibrate(eloProb(r.eloA, r.eloB), r.disc),
  },
  {
    key: "elo-brut", label: "elo-brut", actif: true,
    // Contrôle de cohérence : sans la recalibration §1.3, il DOIT être moins bon
    // (log loss, calibration) — s'il ne l'est pas, le banc est cassé.
    p: (r) => eloProb(r.eloA, r.eloB),
  },
  {
    key: "recal-wf-5disc", label: "recal-wf-5disc", actif: false,
    // Correctif candidat du lot C n°0 : étirement par discipline sur les 5
    // disciplines, ajusté en MARCHE AVANT (année N corrigée avec les années
    // < N), appliqué seulement si l'IC exclut 1. Sans fuite, contrairement au
    // facteur de production. À juger sur --annees=2025,2026 (2024 n'a pas
    // d'antériorité pour s'ajuster).
    prepare(allRows) {
      const { table, detail } = fitStretchWalkForward(allRows);
      this._table = table; this._detail = detail;
    },
    p(r) { return stretchP(eloProb(r.eloA, r.eloB), this._table.get(`${r.disc}|${r.year}`) ?? 1); },
  },
  // Avantage du terrain (journal §2.6, étapes 2-3) : bonus Elo au camp à
  // domicile, SIMPLE seulement, ajusté en marche avant (année N sur années < N,
  // appliqué si l'IC exclut 0). Logique : measures/variante-terrain.mjs.
  // À juger sur --annees=2025,2026 (2024 sans antériorité, donc sans bonus).
  varianteTerrain,
  // Elo-bis à marge de points (journal §2.8, lot C n°0) : un 21-5 met à jour
  // la note plus fort qu'un 21-19 (pointsFactor 1,5 + amorti, config figée en
  // §2.8). Deux formes — brute, et recalibrée en marche avant (motif
  // recal-wf-5disc) pour une comparaison loyale à la référence recalibrée.
  // Logique : measures/variante-elo-points.mjs.
  ...VARIANTES_ELO_POINTS,
  // Facteur âge (lot C n°0) : terme b × écart d'âge (années, au jour du match ;
  // en double : moyenne de la paire) ajouté au logit de la proba de production,
  // b ajusté par discipline en marche avant (année N sur années < N, appliqué
  // si l'IC exclut 0). Logique et mesure descriptive : measures/variante-age.mjs.
  // À juger sur --annees=2025,2026 (2024 sans antériorité, donc sans correction).
  makeVarianteAge(),
  // Facteur main dominante — gaucher (lot C n° 2) : terme b × écart de
  // gaucherie (nombre de gauchers camp A − camp B) ajouté au logit de la proba
  // de production, b ajusté par discipline en marche avant (année N sur
  // années < N, appliqué si l'IC exclut 0) ; main inconnue = aucun ajustement.
  // Logique et mesure descriptive : measures/variante-hand.mjs.
  // À juger sur --annees=2025,2026 (2024 sans antériorité, donc sans correction).
  makeVarianteHand(),
  // Variantes COMBINÉES (2026-08-18) : âge + terrain (+ marge de points)
  // assemblés sur le logit, chaque facteur gardant son verrou marche-avant.
  // L'hypothèse : des facteurs non départageables SEULS le deviennent ENSEMBLE.
  // Logique : measures/variante-combinee.mjs. À juger sur --annees=2025,2026.
  ...makeVariantesCombinees(),
  // Variantes ARBRES BOOSTÉS (2026-08-19) : GBM maison (measures/gbm.mjs) sur
  // toutes les features mesurées, un modèle par année entraîné en marche avant.
  // Le test définitif « du ML non linéaire améliorerait-il la prédiction ? ».
  // Logique : measures/variante-arbres.mjs. À juger sur --annees=2025,2026.
  ...makeVariantesArbres(),
];

const actives = VARIANTES.filter((v) => v.ref || v.actif || TOUTES || ACTIVEES.has(v.key));
for (const v of actives) v.prepare?.(rows);

// Facteurs appliqués par les variantes walk-forward, pour lecture (transparence).
for (const v of actives) {
  if (!v._detail) continue;
  console.log(`\n   Facteurs de « ${v.label} » (ajustés sur les années antérieures, appliqués si IC exclut 1) :`);
  for (const d of v._detail) {
    console.log(
      `     ${d.disc} ${d.year} : ajusté ${d.fit.toFixed(2)} ` +
      `IC [${d.lo?.toFixed(2)} ; ${d.hi?.toFixed(2)}] sur n=${d.n} -> appliqué ${d.applied === 1 ? "1 (aucune correction)" : d.applied.toFixed(2)}`,
    );
  }
}

// ==============================================================================
// 6) Mêmes matchs pour toutes : on ne garde que les lignes où TOUTES les
//    variantes actives se prononcent (protocole).
// ==============================================================================
const judged = base.filter((r) => actives.every((v) => {
  const p = v.p(r);
  return p != null && Number.isFinite(p);
}));
console.log(`\n4) Matchs jugés (toutes variantes se prononcent) : ${judged.length}`);

// ==============================================================================
// 7) Calcul des métriques par variante.
//    Stratégie de pari du banc = « value » de lib/roi.mjs : 1 € sur chaque camp
//    dont EV = meilleure cote × p − 1 > 0 (la couche de mise réelle). La
//    stratégie « favori » est donnée en contrôle de non-régression plus bas.
// ==============================================================================

/** IC 95 % bootstrap sur la moyenne (graine fixe). */
function ciMean(values, { draws = DRAWS, seed = SEED } = {}) {
  const n = values.length;
  if (!n) return null;
  const rng = makeRng(seed);
  const means = new Array(draws);
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[(rng() * n) | 0];
    means[d] = s / n;
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * (draws - 1))], means[Math.ceil(0.975 * (draws - 1))]];
}
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Lignes au format lib/roi.mjs pour une variante (proba arrondie au pourcent,
 *  comme en production : les décisions de mise de l'app se prennent sur cet
 *  arrondi ; les métriques de probabilité (M0, garde-fous) gardent p exact). */
function roiRowsOf(v) {
  return judged.map((r) => {
    const p = v.p(r);
    return {
      prob: Math.round(p * 100),
      pick: p >= 0.5 ? 1 : 2,
      winner: r.winner, books: r.books,
      praw: p, base: r,
    };
  });
}

function metricsOf(v) {
  const vRows = roiRowsOf(v);
  const y01 = judged.map((r) => (r.winner === 1 ? 1 : 0));
  const praw = vRows.map((x) => x.praw);

  // --- garde-fous : log loss absolu + calibration (sur p exact) ---
  const ll = logLoss(praw, y01);
  const calErr = calibrationError(praw, y01);

  // --- M0 : Δlog-loss vs marché dé-viggé (global) ---
  const llMarket = logLoss(judged.map((r) => r.q), y01);
  const m0Global = ll - llMarket;

  // --- paris value à la clôture (jugés par M1 et M3) ---
  const closeBets = [];   // { i (indice match), side, odd, gain }
  const perMatchGain = new Array(judged.length).fill(0);
  const perMatchStake = new Array(judged.length).fill(0);
  vRows.forEach((row, i) => {
    for (const b of valueBets(row, "close")) {
      closeBets.push({ i, side: b.side, odd: b.odd, gain: b.gain });
      perMatchGain[i] += b.gain;
      perMatchStake[i] += 1;
    }
  });

  // M0 restreint aux matchs pariés (là où ça compte)
  const betIdx = [...new Set(closeBets.map((b) => b.i))];
  const m0Bets = betIdx.length
    ? logLoss(betIdx.map((i) => praw[i]), betIdx.map((i) => y01[i])) -
      logLoss(betIdx.map((i) => judged[i].q), betIdx.map((i) => y01[i]))
    : null;

  // --- M1 : EV des paris contre la clôture dé-viggée ---
  const evOf = (b, qKey = "q") => {
    const q = judged[b.i][qKey];
    return (b.side === 1 ? q : 1 - q) * b.odd - 1;
  };
  const m1Values = closeBets.map((b) => evOf(b));
  const m1 = mean(m1Values);
  const m1CI = ciMean(m1Values);
  // sensibilité au dé-vig (si le classement des variantes en dépend : louche)
  const m1Sens = {
    mult: mean(closeBets.map((b) => evOf(b, "qMult"))),
    power: mean(closeBets.map((b) => evOf(b, "qPower"))),
    shin: mean(closeBets.map((b) => evOf(b, "qShin"))),
  };

  // --- M2 : CLV des paris value pris à l'OUVERTURE ---
  const clvValues = [];
  const openBets = { n: 0, gains: [] };
  vRows.forEach((row, i) => {
    for (const b of valueBets(row, "open")) {
      openBets.n++; openBets.gains.push(b.gain);
      const close = bestOddAt(row.books, b.side, "close");
      if (close) clvValues.push(b.odd / close.odd - 1);
    }
  });
  const m2 = mean(clvValues);
  const m2CI = ciMean(clvValues);

  // --- ROI réel absolu (informatif ; M3 = comparaison appariée, plus loin) ---
  const roiAbs = aggregate(closeBets.map((b) => ({ gain: b.gain, won: b.gain > 0 })));
  const roiOpen = aggregate(openBets.gains.map((g) => ({ gain: g, won: g > 0 })));

  return {
    v, ll, calErr, m0Global, m0Bets, m1, m1CI, m1Sens, m2, m2CI,
    nCloseBets: closeBets.length, nOpenBets: openBets.n, nClv: clvValues.length,
    perMatchGain, perMatchStake, roiAbs, roiOpen,
  };
}

const results = actives.map(metricsOf);
const ref = results.find((r) => r.v.ref);

// --- M3 : ΔROI apparié vs référence, bootstrap sur les MATCHS (graine 42) ---
// On rééchantillonne les matchs (pas les paris) : les deux variantes sont
// évaluées sur le MÊME tirage, donc les paris identiques et la chance commune
// s'annulent — c'est ce qui rend la comparaison tranchante.
function m3Of(res) {
  if (res === ref) return { delta: 0, ci: null };
  const n = judged.length;
  const roiFrom = (g, s, idx) => {
    let G = 0, S = 0;
    for (const i of idx) { G += g[i]; S += s[i]; }
    return S ? G / S : null;
  };
  const all = [...Array(n).keys()];
  const point =
    (roiFrom(res.perMatchGain, res.perMatchStake, all) ?? 0) -
    (roiFrom(ref.perMatchGain, ref.perMatchStake, all) ?? 0);
  const rng = makeRng(SEED);
  const diffs = [];
  const idx = new Array(n);
  for (let d = 0; d < DRAWS; d++) {
    for (let i = 0; i < n; i++) idx[i] = (rng() * n) | 0;
    const a = roiFrom(res.perMatchGain, res.perMatchStake, idx);
    const b = roiFrom(ref.perMatchGain, ref.perMatchStake, idx);
    if (a != null && b != null) diffs.push(a - b);
  }
  diffs.sort((x, y) => x - y);
  return {
    delta: point,
    ci: [diffs[Math.floor(0.025 * (diffs.length - 1))], diffs[Math.ceil(0.975 * (diffs.length - 1))]],
  };
}
for (const res of results) res.m3 = m3Of(res);

// ==============================================================================
// 8) Sortie : le tableau du protocole, puis les lectures et vérifications.
// ==============================================================================
const pct = (v, d = 2) => (v == null ? "    —" : ((v >= 0 ? "+" : "") + (v * 100).toFixed(d) + " %"));
const pt = (v) => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + " pt");
const num = (v, d = 4) => (v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(d));

console.log(`\n=== BANC D'ESSAI (dé-vig : ${DEVIG} ; graine ${SEED} ; ${judged.length} matchs, stratégie value EV>0) ===\n`);
const head = ["modèle", "M0 Δll global", "M0 Δll paris", "M1 EV/clôture", "M2 CLV ouv.", "M3 ΔROI vs réf [IC]", "logloss", "calib."];
const widths = [22, 14, 13, 22, 22, 26, 8, 7];
console.log(head.map((h, i) => h.padEnd(widths[i])).join(" "));
for (const r of results) {
  const cells = [
    r.v.label,
    num(r.m0Global),
    num(r.m0Bets),
    `${pct(r.m1)} [${pct(r.m1CI?.[0], 1)};${pct(r.m1CI?.[1], 1)}]`,
    `${pct(r.m2)} [${pct(r.m2CI?.[0], 1)};${pct(r.m2CI?.[1], 1)}]`,
    r.v.ref ? "(référence)" : `${pt(r.m3.delta)} [${pt(r.m3.ci?.[0])} ; ${pt(r.m3.ci?.[1])}]`,
    r.ll.toFixed(4),
    (r.calErr * 100).toFixed(1) + " pt",
  ];
  console.log(cells.map((c, i) => String(c).padEnd(widths[i])).join(" "));
}
console.log(`
Lecture :
  M0 Δll  : log loss modèle − log loss marché dé-viggé. NÉGATIF = meilleur que le
            marché (rarissime) ; moins positif = on s'en rapproche. « paris » = sur
            les seuls matchs où la variante mise.
  M1      : espérance moyenne des paris si la proba du marché à la clôture est la
            vérité. C'est le prix payé à la marge du book, moins la valeur trouvée.
            Objectif d'entraînement : la faire MONTER.
  M2      : les cotes prises à l'ouverture battent-elles la clôture ? Positif = le
            marché nous donne raison après coup.
  M3      : le juge de décision. ROI réel de la variante − ROI réel de la référence,
            sur les mêmes matchs (bootstrap apparié). On n'adopte que si l'IC
            exclut 0 (ou, à défaut, ne contient que du positif défendable).
  Garde-fous : un log loss ou une calibration qui se dégradent = variante qui
            « triche » (copie le marché ou sur-affirme) même si M1/M2 montent.`);

console.log("\n--- Sensibilité au dé-vig (M1 par méthode ; si le CLASSEMENT change, creuser) ---");
for (const r of results) {
  console.log(
    `  ${r.v.label.padEnd(22)} mult ${pct(r.m1Sens.mult)}   power ${pct(r.m1Sens.power)}   shin ${pct(r.m1Sens.shin)}`,
  );
}

console.log("\n--- Contexte (informatif) : ROI réels absolus (mise plate 1 €, IC bootstrap) ---");
for (const r of results) {
  console.log(
    `  ${r.v.label.padEnd(22)} value clôture ${pct(r.roiAbs.roi)} [${pct(r.roiAbs.ci?.[0], 1)};${pct(r.roiAbs.ci?.[1], 1)}] (${r.roiAbs.n} paris)` +
    `   value ouverture ${pct(r.roiOpen.roi)} (${r.roiOpen.n} paris)`,
  );
}

// ==============================================================================
// 9) Non-régression : la référence doit retomber sur les chiffres publiés
//    (journal §8/§8.2/§8.4 et roi.json). Stratégies favori/value de lib/roi.mjs.
// ==============================================================================
if (!ANNEES && ref) {
  console.log("\n--- Non-régression (référence vs web/public/data/roi.json) ---");
  const refRows = roiRowsOf(ref.v);
  const fav = aggregate(refRows.flatMap((r) => favoriBets(r, "close")));
  console.log(`  favori clôture : ROI ${pct(fav.roi)} (${fav.n} paris)`);
  console.log(`  value  clôture : ROI ${pct(ref.roiAbs.roi)} (${ref.roiAbs.n} paris)`);
  console.log(`  CLV value ouverture : ${pct(ref.m2)} sur ${ref.nClv} paris`);
  // CLV 2026 seul, comparable au +3,11 % du journal §8.2 (mesuré sur 2026)
  const clv26 = [];
  refRows.forEach((row) => {
    if (row.base.year !== 2026) return;
    for (const b of valueBets(row, "open")) {
      const c = bestOddAt(row.books, b.side, "close");
      if (c) clv26.push(b.odd / c.odd - 1);
    }
  });
  console.log(`  CLV value ouverture, 2026 seul : ${pct(mean(clv26))} sur ${clv26.length} paris (journal §8.2 : +3,11 % sur 761)`);
  try {
    const roiJson = JSON.parse(await readFile(join(ROOT, "web", "public", "data", "roi.json"), "utf8"));
    const attendu = {
      "favori clôture": [roiJson.strategies.favori.global.close.roi, fav.roi],
      "value clôture": [roiJson.strategies.value.global.close.roi, ref.roiAbs.roi],
      "CLV value": [roiJson.clv.value.avg, ref.m2],
    };
    for (const [k, [a, b]] of Object.entries(attendu)) {
      const ok = Math.abs(a - b) < 0.005;
      console.log(`  vs roi.json — ${k} : ${pct(a)} attendu, ${pct(b)} obtenu ${ok ? "✅" : "❌ ÉCART, creuser"}`);
    }
  } catch { console.log("  (roi.json absent : comparaison ignorée)"); }
}

console.log(`\nRègle de décision : entraîner sur M1, surveiller M2, décider avec M3 (IC hors de 0).
Protocole complet : docs/banc-essai-modele.md`);

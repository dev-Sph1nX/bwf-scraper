// measures/variante-terrain.mjs
// AVANTAGE DU TERRAIN — étapes 2 (apport marginal) et 3 (hors échantillon).
// L'étape 1 (isolation) est au journal §2.6 : +2,2 pt conditionnel, ≈ 16 points
// d'Elo, prouvé en SIMPLE seulement (~12 % des matchs concernés).
//
// Deux usages :
//   node measures/variante-terrain.mjs      → ÉTAPE 2 : à Elo connu, le facteur
//       « domicile » apporte-t-il encore de l'information ? Ajustement conjoint
//       par maximum de vraisemblance (régression logistique à pente Elo fixée),
//       bonus H en points d'Elo + IC bootstrap, Δ log loss apparié.
//   import { varianteTerrain } …            → ÉTAPE 3 : la variante `elo-terrain`
//       du banc d'essai (measures/mesure-roi-modele.mjs). H est ajusté en MARCHE
//       AVANT (motif recal-wf-5disc : l'année N n'utilise que les années < N,
//       aucune fuite ; 2024 reste sans bonus faute d'antériorité) et n'est
//       APPLIQUÉ que si son IC bootstrap (200 tirages, graine 42) exclut 0.
//       Juger sur --annees=2025,2026 : node measures/mesure-roi-modele.mjs \
//         --variantes=elo-terrain --annees=2025,2026
//
// Définition du « jouer à domicile » — IDENTIQUE à mesure-terrain.mjs (étape 1),
// pour rester comparable : tous les joueurs du camp ont le code pays du tournoi
// (code extrait du drapeau, le champ texte étant un nom anglais), et il faut
// EXACTEMENT un camp à domicile. Le bonus ne s'applique qu'en SIMPLE (MS/WS),
// puisque §2.6 n'a prouvé l'effet qu'en simple.
//
// Mécanisme de la variante : Elo du camp à domicile + H points, puis la chaîne
// de production inchangée (eloProb + recalibrate). H > 0 déplace la proba vers
// le camp local sans toucher aux 88 % de matchs sans camp à domicile.

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { eloProb } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { makeRng, logLoss } from "../lib/metrics.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = 42;
const K = Math.LN10 / 400; // pente de la sigmoïde Elo en logit par point d'Elo
const SINGLES = new Set(["MS", "WS"]);

// ==============================================================================
// 1) Carte « qui joue à domicile », chargée au chargement du module (le banc
//    appelle prepare() de façon synchrone). Clé = celle du banc :
//    tmtId|disc|jour|entitéA|entitéB (ids triés). Valeur = +1 (team1 à
//    domicile), −1 (team2). Les matchs sans camp à domicile n'y figurent pas.
// ==============================================================================
const entityId = (players) => {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
};

const years = await store.listYears();

// Code pays du tournoi, extrait du drapeau (comme mesure-terrain.mjs).
const tmtCountry = new Map();
for (const y of years) {
  try {
    const t = JSON.parse(await readFile(join(ROOT, "data", String(y), "tournaments.json"), "utf8"));
    for (const m of (Array.isArray(t) ? t : t.results ?? []))
      for (const tt of m.tournaments ?? [])
        tmtCountry.set(Number(tt.id), /\/([A-Z]{3})\.png/.exec(tt.flag_url || "")?.[1] ?? null);
  } catch {}
}

const HOME = new Map(); // clé banc -> +1 | -1
{
  const init = loadInitialRanks();
  const seeds = {};
  for (const [disc, m] of Object.entries(init)) {
    const sm = new Map();
    for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
    seeds[disc] = sm;
  }
  await computeElo(years, seeds, {
    onMatch: ({ tmtId, disc, match, a, b }) => {
      if (isWalkover(match) || !match.matchTime) return;
      const cc = tmtCountry.get(Number(tmtId));
      if (!cc) return;
      const homeA = a.players.every((p) => p.countryCode === cc);
      const homeB = b.players.every((p) => p.countryCode === cc);
      if (homeA === homeB) return; // il faut EXACTEMENT un camp à domicile
      const day = String(match.matchTime).slice(0, 10);
      HOME.set(`${tmtId}|${disc}|${day}|${entityId(a.players)}|${entityId(b.players)}`, homeA ? 1 : -1);
    },
  });
}

const homeSign = (r) => HOME.get(`${r.tmtId}|${r.disc}|${r.day}|${r.a}|${r.b}`) ?? 0;

// ==============================================================================
// 2) Ajustement conjoint : à Elo donné, quel bonus H (en points d'Elo) maximise
//    la vraisemblance des matchs à domicile ? C'est une régression logistique
//    won ~ sigmoïde(K·(ΔElo + h·H)) où seule H est libre : la pente Elo est
//    celle de la production, donc H mesure ce que le facteur ajoute EN PLUS.
//    Items : { d: eloA−eloB, h: +1/−1 (camp à domicile), y: 1 si team1 gagne }.
// ==============================================================================
export function fitHomeBonus(items) {
  let H = 0;
  for (let it = 0; it < 50; it++) {
    let g = 0, hess = 0;
    for (const { d, h, y } of items) {
      const p = 1 / (1 + Math.exp(-K * (d + h * H)));
      g += (y - p) * h * K;           // dL/dH
      hess -= p * (1 - p) * K * K;    // d²L/dH² (h² = 1)
    }
    const step = g / hess;
    H -= step;
    if (Math.abs(step) < 1e-6) break;
  }
  return Math.min(300, Math.max(-300, H));
}

/** IC bootstrap [2,5 % ; 97,5 %] du bonus (graine fixe). */
export function bootstrapHomeBonus(items, { draws = 200, seed = SEED } = {}) {
  const n = items.length;
  const rng = makeRng(seed);
  const boots = new Array(draws);
  const sample = new Array(n);
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < n; i++) sample[i] = items[(rng() * n) | 0];
    boots[d] = fitHomeBonus(sample);
  }
  boots.sort((a, b) => a - b);
  return [boots[Math.floor(0.025 * (draws - 1))], boots[Math.ceil(0.975 * (draws - 1))]];
}

/** Extrait les items d'ajustement (simple + un camp à domicile) de lignes du banc. */
export function homeItems(rows, { discs = SINGLES } = {}) {
  const items = [];
  for (const r of rows) {
    if (!discs.has(r.disc)) continue;
    const h = homeSign(r);
    if (!h) continue;
    items.push({ d: r.eloA - r.eloB, h, y: r.winner === 1 ? 1 : 0, year: r.year, disc: r.disc });
  }
  return items;
}

// ==============================================================================
// 3) La variante du banc d'essai — motif walk-forward de recal-wf-5disc :
//    pour les matchs de l'année Y, H est ajusté sur les années STRICTEMENT
//    antérieures, et n'est appliqué que si l'IC bootstrap exclut 0 (sinon 0 :
//    rien de prouvé, pas de bonus). 2024 reste sans bonus (rien d'antérieur).
// ==============================================================================
export const varianteTerrain = {
  key: "elo-terrain", label: "elo-terrain (wf)", actif: false,
  // Avantage du terrain (§2.6) : bonus Elo au camp à domicile, SIMPLE seulement,
  // ajusté en marche avant. Logique complète : measures/variante-terrain.mjs.
  prepare(allRows) {
    const items = homeItems(allRows);
    const yearsSeen = [...new Set(allRows.map((r) => r.year))].sort();
    this._table = new Map(); // année -> H appliqué
    this._detail = [];
    for (const Y of yearsSeen) {
      const past = items.filter((it) => it.year < Y);
      if (past.length < 100) { this._table.set(Y, 0); continue; }
      const fit = fitHomeBonus(past);
      const [lo, hi] = bootstrapHomeBonus(past);
      const applied = lo <= 0 && hi >= 0 ? 0 : fit; // 0 dans l'IC : pas de bonus
      this._table.set(Y, applied);
      // `disc: "simple"` : étiquette pour l'affichage générique du banc (le
      // bonus est commun à MS+WS, il n'y a pas de facteur par discipline).
      this._detail.push({ disc: "simple", year: Y, n: past.length, fit, lo, hi, applied });
    }
  },
  p(r) {
    let { eloA, eloB } = r;
    if (SINGLES.has(r.disc)) {
      const h = homeSign(r);
      if (h) {
        const H = this._table.get(r.year) ?? 0;
        if (h === 1) eloA += H; else eloB += H;
      }
    }
    return recalibrate(eloProb(eloA, eloB), r.disc);
  },
};

// ==============================================================================
// 4) Mode autonome : l'ÉTAPE 2 chiffrée (+ le réglage 2024-2025 que l'étape 3
//    applique à 2026). On rejoue l'historique comme le banc (walk-forward,
//    Elo non provisoires des deux côtés — mêmes exigences que l'étape 1).
// ==============================================================================
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { isProvisional } = await import("../lib/models.mjs");
  const init = loadInitialRanks();
  const seeds = {};
  for (const [disc, m] of Object.entries(init)) {
    const sm = new Map();
    for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
    seeds[disc] = sm;
  }
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
        winner: match.winner, eloA: a.entity.rating, eloB: b.entity.rating,
      });
    },
  });

  const fmt = (x, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d);
  console.log("ÉTAPE 2 — apport marginal du facteur terrain, à Elo donné");
  console.log(`Matchs rejoués (Elo non provisoire des 2 côtés) : ${rows.length}`);

  // --- Ajustement conjoint global (2024-2026), simple ---
  const items = homeItems(rows);
  console.log(`Matchs SIMPLE avec exactement un camp à domicile : ${items.length}`);
  const H = fitHomeBonus(items);
  const [lo, hi] = bootstrapHomeBonus(items, { draws: 1000 });
  console.log(`\nBonus domicile ajusté (simple, 2024-2026) : H = ${fmt(H)} points d'Elo,` +
    ` IC 95 % bootstrap [${fmt(lo)} ; ${fmt(hi)}] ${lo > 0 || hi < 0 ? "✅ exclut 0" : "❌ contient 0"}`);
  console.log("(étape 1 §2.6 estimait ≈ +16 points d'Elo — cohérence à vérifier)");

  // --- Par discipline (contrôle : l'effet doit être en simple, pas en double) ---
  console.log("\nPar discipline (H ajusté séparément, IC bootstrap 1000 tirages) :");
  for (const disc of ["MS", "WS", "MD", "WD", "XD"]) {
    const its = homeItems(rows, { discs: new Set([disc]) });
    if (its.length < 50) continue;
    const h = fitHomeBonus(its);
    const [l, u] = bootstrapHomeBonus(its, { draws: 1000 });
    console.log(`  ${disc} : n=${its.length}, H = ${fmt(h)} [${fmt(l)} ; ${fmt(u)}] ${l > 0 || u < 0 ? "✅" : "— (0 dans l'IC)"}`);
  }

  // --- Δ log loss apparié sur les matchs concernés (simple + domicile) ---
  const y01 = items.map((it) => it.y);
  const pSans = items.map((it) => 1 / (1 + Math.exp(-K * it.d)));
  const pAvec = items.map((it) => 1 / (1 + Math.exp(-K * (it.d + it.h * H))));
  const dll = logLoss(pAvec, y01) - logLoss(pSans, y01);
  // IC bootstrap apparié sur la différence par match
  const per = items.map((it, i) => {
    const l = (p) => -(y01[i] * Math.log(p) + (1 - y01[i]) * Math.log(1 - p));
    return l(pAvec[i]) - l(pSans[i]);
  });
  const rng = makeRng(SEED);
  const diffs = new Array(1000);
  for (let d = 0; d < 1000; d++) {
    let s = 0;
    for (let i = 0; i < per.length; i++) s += per[(rng() * per.length) | 0];
    diffs[d] = s / per.length;
  }
  diffs.sort((a, b) => a - b);
  console.log(`\nΔ log loss (avec − sans bonus) sur ces ${items.length} matchs : ${dll.toFixed(4)}` +
    ` IC [${diffs[24].toFixed(4)} ; ${diffs[974].toFixed(4)}] (négatif = le bonus aide)`);
  console.log("⚠️ H est ajusté sur ces mêmes matchs : ce Δ est optimiste par construction — c'est l'étape 3 qui tranche.");

  // --- Le réglage sans fuite que l'étape 3 applique (motif walk-forward) ---
  console.log("\nRéglages walk-forward (ceux que la variante `elo-terrain` du banc applique) :");
  varianteTerrain.prepare(rows);
  for (const d of varianteTerrain._detail) {
    console.log(`  ${d.year} : ajusté ${fmt(d.fit)} IC [${fmt(d.lo)} ; ${fmt(d.hi)}] sur n=${d.n}` +
      ` -> appliqué ${d.applied === 0 ? "0 (aucun bonus)" : fmt(d.applied)}`);
  }
  console.log("  (2024 : pas d'antériorité, aucun bonus par construction)");
  console.log("\nÉTAPE 3 → node measures/mesure-roi-modele.mjs --variantes=elo-terrain --annees=2025,2026");
}

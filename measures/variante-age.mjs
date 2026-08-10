// measures/variante-age.mjs
// FACTEUR ÂGE (roadmap lot C n° 0) — deux rôles dans un seul fichier :
//
//   1. MESURE DESCRIPTIVE (exécuter directement) :
//        node measures/variante-age.mjs
//      Répond à « l'âge apporte-t-il un signal AU-DELÀ de l'Elo ? » :
//      - taux de jointure réel entre les matchs prédictibles et
//        data/players/birthdates.json (âge AU JOUR du match) ;
//      - résidu (victoire observée − proba du modèle de prod) par tranche
//        d'écart d'âge, avec effectifs et IC 95 % ;
//      - régression logistique du résidu : victoire ~ sigmoid(logit(p_prod)
//        + b × écart d'âge), b avec IC bootstrap (graine 42), global,
//        par discipline et par année.
//
//   2. VARIANTE « elo-age » pour le banc d'essai (measures/mesure-roi-modele.mjs) :
//      makeVarianteAge() rend l'entrée à insérer dans VARIANTES. Ajustement en
//      MARCHE AVANT sur le motif de recal-wf-5disc : le coefficient d'âge des
//      matchs de l'année Y est ajusté sur les années STRICTEMENT antérieures,
//      et appliqué seulement si son IC bootstrap (200 tirages, graine 42)
//      exclut 0. 2024 reste sans correction (rien d'antérieur). Aucune fuite.
//
// CHOIX DE MODÉLISATION (justifications) :
// - Écart d'âge = âge(camp A) − âge(camp B), en années décimales au jour du
//   match. En DOUBLE, l'âge d'une équipe = MOYENNE des deux joueurs : les deux
//   jouent chaque point, aucun ne « porte » l'âge de la paire à lui seul ; la
//   mesure descriptive vérifie aussi les agrégats min/max pour s'assurer que
//   la conclusion n'en dépend pas.
// - Le terme d'âge s'ajoute au LOGIT de la proba de PRODUCTION (elo-recalibré) :
//   la variante est « prod + âge », pas un nouveau modèle. Pas d'ordonnée à
//   l'origine : l'écart d'âge est antisymétrique (échanger les camps change
//   son signe), le modèle reste symétrique par construction (p ↦ 1 − p).
// - Matchs sans date de naissance pour l'un des joueurs : la variante rend la
//   proba de production telle quelle (pas d'abstention, pour garder « mêmes
//   matchs pour toutes les variantes »).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eloProb } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { makeRng } from "../lib/metrics.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SEED = 42;
const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

// ---- Jointure matchs ↔ dates de naissance ------------------------------------

/** Charge data/players/birthdates.json : Map id joueur -> Date de naissance. */
export function loadBirthdates() {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "data", "players", "birthdates.json"), "utf8"),
  );
  const map = new Map();
  for (const [id, rec] of Object.entries(raw)) {
    if (rec?.dob) map.set(String(id), new Date(rec.dob + "T00:00:00Z"));
  }
  return map;
}

/** Ids joueurs d'une entité du banc : "1234" ou "pair:1234-5678". */
export const playerIdsOf = (entity) =>
  String(entity).startsWith("pair:")
    ? String(entity).slice(5).split("-")
    : [String(entity)];

/**
 * Âge d'un camp au jour du match (années décimales), ou null si une date de
 * naissance manque. `agg` : mean (défaut, cf. en-tête) | min | max.
 */
export function teamAge(entity, day, dobMap, agg = "mean") {
  const t = new Date(day + "T00:00:00Z").getTime();
  const ages = [];
  for (const id of playerIdsOf(entity)) {
    const dob = dobMap.get(id);
    if (!dob) return null;
    ages.push((t - dob.getTime()) / MS_PER_YEAR);
  }
  if (agg === "min") return Math.min(...ages);
  if (agg === "max") return Math.max(...ages);
  return ages.reduce((s, x) => s + x, 0) / ages.length;
}

/** Écart d'âge du match (camp A − camp B), ou null si jointure incomplète. */
export function ageGap(row, dobMap, agg = "mean") {
  const a = teamAge(row.a, row.day, dobMap, agg);
  const b = teamAge(row.b, row.day, dobMap, agg);
  return a == null || b == null ? null : a - b;
}

// ---- Régression logistique avec offset ---------------------------------------

const clampP = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/**
 * Ajuste par maximum de vraisemblance (Newton) : y ~ sigmoid(z + b·x), où z
 * est un offset FIXE (le logit du modèle existant, coefficient forcé à 1) et
 * x une seule variable (l'écart d'âge). Rend b : « ce que x explique EN PLUS
 * du modèle », en log-cotes par unité de x.
 */
export function fitOffsetSlope(zs, xs, ys) {
  let b = 0;
  for (let it = 0; it < 50; it++) {
    let g = 0, h = 0;
    for (let i = 0; i < zs.length; i++) {
      const p = sigmoid(zs[i] + b * xs[i]);
      g += (ys[i] - p) * xs[i];
      h -= p * (1 - p) * xs[i] * xs[i];
    }
    if (h === 0) break;
    const step = g / h;
    b -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  return Math.min(0.5, Math.max(-0.5, b)); // garde-fou numérique
}

/** IC 95 % bootstrap sur la pente b (rééchantillonnage des matchs, graine fixe). */
export function bootstrapSlope(zs, xs, ys, { draws = 200, seed = SEED } = {}) {
  const n = zs.length;
  const rng = makeRng(seed);
  const bz = new Array(n), bx = new Array(n), by = new Array(n);
  const boots = [];
  for (let d = 0; d < draws; d++) {
    for (let i = 0; i < n; i++) {
      const j = (rng() * n) | 0;
      bz[i] = zs[j]; bx[i] = xs[j]; by[i] = ys[j];
    }
    boots.push(fitOffsetSlope(bz, bx, by));
  }
  boots.sort((a, b) => a - b);
  return [boots[Math.floor(0.025 * boots.length)], boots[Math.floor(0.975 * boots.length)]];
}

// ---- Variante « elo-age » du banc d'essai -------------------------------------

/**
 * Coefficient d'âge par DISCIPLINE et par année, ajusté en MARCHE AVANT :
 * pour les matchs de l'année Y d'une discipline, le coefficient est ajusté
 * sur les matchs de cette discipline des années STRICTEMENT antérieures —
 * même motif mécanique que recal-wf-5disc (aucun choix rétrospectif de
 * disciplines « à corriger »). Appliqué seulement si l'IC bootstrap
 * (200 tirages, graine 42) exclut 0.
 */
export function fitAgeWalkForward(allRows, dobMap, { discs = ["MS", "WS", "MD", "WD", "XD"], gate = true } = {}) {
  const usable = [];
  for (const r of allRows) {
    const d = ageGap(r, dobMap);
    if (d == null) continue;
    usable.push({
      disc: r.disc, year: r.year,
      z: logit(recalibrate(eloProb(r.eloA, r.eloB), r.disc)),
      x: d,
      y: r.winner === 1 ? 1 : 0,
    });
  }
  const table = new Map(); // `${disc}|${year}` -> b appliqué
  const detail = [];
  const years = [...new Set(allRows.map((r) => r.year))].sort();
  for (const disc of discs) {
    const dRows = usable.filter((u) => u.disc === disc);
    for (const Y of years) {
      const past = dRows.filter((u) => u.year < Y);
      if (past.length < 300) { table.set(`${disc}|${Y}`, 0); continue; }
      const zs = past.map((u) => u.z), xs = past.map((u) => u.x), ys = past.map((u) => u.y);
      const b = fitOffsetSlope(zs, xs, ys);
      let applied = b, lo = null, hi = null;
      if (gate) {
        [lo, hi] = bootstrapSlope(zs, xs, ys);
        if (lo <= 0 && hi >= 0) applied = 0; // 0 dans l'IC : rien de prouvé
      }
      table.set(`${disc}|${Y}`, applied);
      detail.push({ disc, year: Y, n: past.length, fit: b, lo, hi, applied });
    }
  }
  return { table, detail };
}

/**
 * L'entrée VARIANTES pour measures/mesure-roi-modele.mjs (actif: false).
 * p(r) = sigmoid(logit(proba de production) + b_année × écart d'âge) ;
 * proba de production inchangée si b = 0 ou si une date de naissance manque.
 */
export function makeVarianteAge() {
  const dobMap = loadBirthdates();
  return {
    key: "elo-age", label: "elo-age", actif: false,
    prepare(allRows) {
      const { table, detail } = fitAgeWalkForward(allRows, dobMap);
      this._table = table;
      // même format que recal-wf-5disc pour l'impression de transparence du
      // banc (fit/lo/hi/applied avec 0 = « aucune correction » au lieu de 1)
      this._detail = detail.map((d) => ({ ...d, disc: `${d.disc} (b âge/an)` }));
    },
    p(r) {
      const base = recalibrate(eloProb(r.eloA, r.eloB), r.disc);
      const b = this._table?.get(`${r.disc}|${r.year}`) ?? 0;
      if (!b) return base;
      const d = ageGap(r, dobMap);
      if (d == null) return base;
      return sigmoid(logit(base) + b * d);
    },
  };
}

// ==============================================================================
// MESURE DESCRIPTIVE (node measures/variante-age.mjs)
// ==============================================================================
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await descriptif();

async function descriptif() {
  const [{ computeElo, seedEloByRank }, { loadInitialRanks }, { isWalkover }, { isProvisional }, store] =
    await Promise.all([
      import("../lib/elo.mjs"), import("../lib/seeds.mjs"),
      import("../lib/dataset.mjs"), import("../lib/models.mjs"), import("../lib/store.mjs"),
    ]);

  console.log("MESURE DESCRIPTIVE — le facteur âge au-delà de l'Elo (graine 42)\n");
  console.log("1) Rejeu walk-forward (mêmes matchs prédictibles que le banc)…");
  const init = loadInitialRanks();
  const seeds = {};
  for (const [disc, m] of Object.entries(init)) {
    const sm = new Map();
    for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
    seeds[disc] = sm;
  }
  const entityId = (players) => {
    const ids = players.map((p) => String(p.id)).sort();
    return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0];
  };
  const years = await store.listYears();
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
        eloA: a.entity.rating, eloB: b.entity.rating,
      });
    },
  });
  console.log(`   ${rows.length} matchs prédictibles (${years.join(", ")}).`);

  // --- 2) Jointure ------------------------------------------------------------
  const dobMap = loadBirthdates();
  console.log(`\n2) Jointure avec birthdates.json (${dobMap.size} joueurs datés)`);
  const perDisc = new Map();
  let playersSeen = 0, playersDated = 0;
  const joined = [];
  for (const r of rows) {
    const ids = [...playerIdsOf(r.a), ...playerIdsOf(r.b)];
    playersSeen += ids.length;
    playersDated += ids.filter((id) => dobMap.has(id)).length;
    const d = ageGap(r, dobMap);
    const st = perDisc.get(r.disc) || { n: 0, ok: 0 };
    st.n++;
    if (d != null) {
      st.ok++;
      joined.push({ ...r, dAge: d,
        ageA: teamAge(r.a, r.day, dobMap), ageB: teamAge(r.b, r.day, dobMap) });
    }
    perDisc.set(r.disc, st);
  }
  const totN = rows.length, totOk = joined.length;
  console.log(`   Matchs avec ÂGE COMPLET des deux camps : ${totOk}/${totN} (${(100 * totOk / totN).toFixed(1)} %)`);
  console.log(`   Apparitions de joueurs datées : ${(100 * playersDated / playersSeen).toFixed(1)} %`);
  for (const [disc, st] of [...perDisc].sort()) {
    console.log(`     ${disc} : ${st.ok}/${st.n} (${(100 * st.ok / st.n).toFixed(1)} %)`);
  }

  // --- 3) Résidu par tranche d'écart d'âge -------------------------------------
  // Résidu = victoire observée (0/1) − proba du modèle de PROD. Si l'âge
  // n'apporte rien au-delà de l'Elo, le résidu moyen est ≈ 0 dans chaque tranche.
  console.log("\n3) Résidu (observé − proba prod) par tranche d'écart d'âge (A − B, années)");
  const edges = [-30, -8, -5, -3, -1, 1, 3, 5, 8, 30];
  const buckets = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], res: [], p: [] }));
  for (const r of joined) {
    const p = recalibrate(eloProb(r.eloA, r.eloB), r.disc);
    const y = r.winner === 1 ? 1 : 0;
    const bk = buckets.find((b) => r.dAge >= b.lo && r.dAge < b.hi);
    if (bk) { bk.res.push(y - p); bk.p.push(p); }
  }
  console.log("   tranche          n      proba moy.  obs−attendu  IC 95 % (résidu)");
  for (const b of buckets) {
    const n = b.res.length;
    if (!n) continue;
    const m = b.res.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(b.res.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1));
    const half = 1.96 * sd / Math.sqrt(n);
    const pm = b.p.reduce((s, x) => s + x, 0) / n;
    const lab = `[${String(b.lo).padStart(3)} ; ${String(b.hi).padStart(3)})`;
    const sig = m - half > 0 || m + half < 0 ? " ⚠️" : "";
    console.log(
      `   ${lab.padEnd(14)} ${String(n).padStart(6)}   ${(100 * pm).toFixed(1).padStart(6)} %` +
      `   ${((m >= 0 ? "+" : "") + (100 * m).toFixed(2)).padStart(8)} pt   [${(100 * (m - half)).toFixed(2)} ; ${(100 * (m + half)).toFixed(2)}]${sig}`,
    );
  }

  // --- 4) Régression logistique du résidu --------------------------------------
  // b = log-cotes supplémentaires PAR ANNÉE d'écart d'âge, l'Elo (recalibré)
  // étant déjà compté (offset). b > 0 = « être plus vieux aide » à Elo égal.
  console.log("\n4) Régression : victoire ~ sigmoid(logit(p_prod) + b × écart d'âge)");
  const mkZXY = (rs, agg = "mean") => {
    const zs = [], xs = [], ys = [];
    for (const r of rs) {
      const d = agg === "mean" ? r.dAge : ageGap(r, dobMap, agg);
      if (d == null) continue;
      zs.push(logit(recalibrate(eloProb(r.eloA, r.eloB), r.disc)));
      xs.push(d);
      ys.push(r.winner === 1 ? 1 : 0);
    }
    return [zs, xs, ys];
  };
  const show = (label, rs, agg = "mean") => {
    const [zs, xs, ys] = mkZXY(rs, agg);
    if (zs.length < 100) { console.log(`   ${label.padEnd(18)} n=${zs.length} (trop peu)`); return; }
    const b = fitOffsetSlope(zs, xs, ys);
    const [lo, hi] = bootstrapSlope(zs, xs, ys, { draws: 500 });
    const sig = lo > 0 || hi < 0 ? " ⚠️ significatif" : "";
    console.log(
      `   ${label.padEnd(18)} n=${String(zs.length).padStart(5)}  b=${(b >= 0 ? "+" : "") + b.toFixed(4)}` +
      ` /an  IC95 [${lo.toFixed(4)} ; ${hi.toFixed(4)}]${sig}`,
    );
  };
  show("GLOBAL (moyenne)", joined);
  for (const disc of ["MS", "WS", "MD", "WD", "XD"]) {
    show(`  ${disc}`, joined.filter((r) => r.disc === disc));
  }
  for (const y of years) {
    show(`  année ${y}`, joined.filter((r) => r.year === y));
  }
  console.log("   Sensibilité à l'agrégat d'équipe en double (doubles seulement) :");
  const dbl = joined.filter((r) => r.disc !== "MS" && r.disc !== "WS");
  show("  double, moyenne", dbl, "mean");
  show("  double, min", dbl, "min");
  show("  double, max", dbl, "max");

  // --- 5) Ce que ferait la variante (coefficients marche avant) ----------------
  console.log("\n5) Coefficients de la variante elo-age (marche avant par discipline, IC doit exclure 0)");
  const { detail } = fitAgeWalkForward(rows, dobMap);
  if (!detail.length) console.log("   (aucune année avec assez d'antériorité)");
  for (const d of detail) {
    console.log(
      `   ${d.disc} ${d.year} : ajusté ${(d.fit >= 0 ? "+" : "") + d.fit.toFixed(4)}/an ` +
      `IC [${d.lo?.toFixed(4)} ; ${d.hi?.toFixed(4)}] sur n=${d.n} -> appliqué ${d.applied === 0 ? "0 (aucune correction)" : d.applied.toFixed(4)}`,
    );
  }
  console.log(
    "\nLecture : b est en log-cotes par année d'écart. À 50/50 Elo, b=+0,01 et " +
    "+5 ans d'écart déplacent la proba de 50 % à ~51,2 %. Un IC contenant 0 = " +
    "aucun signal prouvé au-delà de l'Elo.",
  );
}

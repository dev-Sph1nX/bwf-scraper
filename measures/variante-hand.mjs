// measures/variante-hand.mjs
// FACTEUR MAIN DOMINANTE — GAUCHER (roadmap lot C n° 2) — deux rôles, un fichier,
// sur le modèle exact de measures/variante-age.mjs (§9.3) :
//
//   1. MESURE DESCRIPTIVE (exécuter directement) :
//        node measures/variante-hand.mjs
//      Répond à « être gaucher apporte-t-il un signal AU-DELÀ de l'Elo ? » :
//      - taux de jointure réel : part des matchs où la main de TOUS les joueurs
//        des deux camps est connue (data/players/birthdates.json, champ hand) ;
//      - résidu (victoire observée − proba du modèle de prod) par CONFIGURATION
//        de mains (droitier vs gaucher, gaucher vs gaucher…), par discipline,
//        avec effectifs et IC 95 % — en configuration asymétrique le résidu est
//        pris DU POINT DE VUE DU CAMP LE PLUS GAUCHER (en miroir, l'avantage
//        du gaucher s'annule : ces configs servent de contrôle) ;
//      - régression logistique du résidu : victoire ~ sigmoid(logit(p_prod)
//        + b × écart de gaucherie), b avec IC bootstrap (graine 42), global,
//        par discipline et par année.
//
//   2. VARIANTE « elo-hand » pour le banc d'essai (measures/mesure-roi-modele.mjs) :
//      makeVarianteHand() rend l'entrée à insérer dans VARIANTES. Ajustement en
//      MARCHE AVANT sur le motif de recal-wf-5disc / elo-age : le coefficient
//      des matchs de l'année Y est ajusté PAR DISCIPLINE sur les années
//      STRICTEMENT antérieures, appliqué seulement si son IC bootstrap
//      (200 tirages, graine 42) exclut 0. 2024 reste sans correction (rien
//      d'antérieur). Aucune fuite.
//
// CHOIX DE CODAGE (justifications) :
// - « Gaucherie » d'un camp = NOMBRE de gauchers du camp (0 ou 1 en simple ;
//   0, 1 ou 2 en double). L'hypothèse mesurée est « les gauchers, rares, sont
//   sous-entraînés par leurs adversaires » : chaque gaucher d'une paire impose
//   ses angles inhabituels sur une partie des échanges, deux gauchers a priori
//   plus qu'un — le comptage est l'extension linéaire naturelle (même esprit
//   que la moyenne d'âge du §9.3). La mesure descriptive vérifie AUSSI le
//   codage binaire « au moins un gaucher » pour s'assurer que la conclusion
//   n'en dépend pas.
// - Écart du match x = gaucherie(camp A) − gaucherie(camp B) : antisymétrique
//   (échanger les camps change son signe), donc pas d'ordonnée à l'origine —
//   le modèle reste symétrique par construction (p ↦ 1 − p), comme pour l'âge.
// - Main inconnue pour AU MOINS un joueur du match : exclu du descriptif et de
//   l'ajustement ; la variante rend la proba de production TELLE QUELLE
//   (aucun ajustement — « mêmes matchs pour toutes les variantes » au banc).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eloProb } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { fitOffsetSlope, bootstrapSlope, playerIdsOf } from "./variante-age.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ---- Jointure matchs ↔ mains dominantes ---------------------------------------

/** Charge data/players/birthdates.json : Map id joueur -> "left" | "right". */
export function loadHands() {
  const raw = JSON.parse(
    readFileSync(join(ROOT, "data", "players", "birthdates.json"), "utf8"),
  );
  const map = new Map();
  for (const [id, rec] of Object.entries(raw)) {
    if (rec?.hand === "left" || rec?.hand === "right") map.set(String(id), rec.hand);
  }
  return map;
}

/**
 * Gaucherie d'un camp = nombre de gauchers (défaut, cf. en-tête), ou null si
 * la main d'un joueur manque. `agg` : count (défaut) | any (au moins un gaucher).
 */
export function teamLeftiness(entity, handMap, agg = "count") {
  let n = 0;
  for (const id of playerIdsOf(entity)) {
    const h = handMap.get(id);
    if (!h) return null;
    if (h === "left") n++;
  }
  return agg === "any" ? (n > 0 ? 1 : 0) : n;
}

/** Écart de gaucherie du match (camp A − camp B), ou null si jointure incomplète. */
export function handGap(row, handMap, agg = "count") {
  const a = teamLeftiness(row.a, handMap, agg);
  const b = teamLeftiness(row.b, handMap, agg);
  return a == null || b == null ? null : a - b;
}

const clampP = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// ---- Variante « elo-hand » du banc d'essai --------------------------------------

/**
 * Coefficient « gaucher » par DISCIPLINE et par année, ajusté en MARCHE AVANT :
 * pour les matchs de l'année Y d'une discipline, le coefficient est ajusté sur
 * les matchs de cette discipline des années STRICTEMENT antérieures dont les
 * mains sont toutes connues — même motif mécanique que elo-age (aucun choix
 * rétrospectif de disciplines « à corriger »). Appliqué seulement si l'IC
 * bootstrap (200 tirages, graine 42) exclut 0.
 */
export function fitHandWalkForward(allRows, handMap, { discs = ["MS", "WS", "MD", "WD", "XD"], gate = true } = {}) {
  const usable = [];
  for (const r of allRows) {
    const d = handGap(r, handMap);
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
 * p(r) = sigmoid(logit(proba de production) + b_année × écart de gaucherie) ;
 * proba de production inchangée si b = 0 ou si une main manque.
 */
export function makeVarianteHand() {
  const handMap = loadHands();
  return {
    key: "elo-hand", label: "elo-hand", actif: false,
    prepare(allRows) {
      const { table, detail } = fitHandWalkForward(allRows, handMap);
      this._table = table;
      // même format d'impression de transparence que elo-age (0 = « aucune correction »)
      this._detail = detail.map((d) => ({ ...d, disc: `${d.disc} (b gaucher)` }));
    },
    p(r) {
      const base = recalibrate(eloProb(r.eloA, r.eloB), r.disc);
      const b = this._table?.get(`${r.disc}|${r.year}`) ?? 0;
      if (!b) return base;
      const d = handGap(r, handMap);
      if (d == null) return base;
      return sigmoid(logit(base) + b * d);
    },
  };
}

// ==============================================================================
// MESURE DESCRIPTIVE (node measures/variante-hand.mjs)
// ==============================================================================
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) await descriptif();

async function descriptif() {
  const [{ computeElo, seedEloByRank }, { loadInitialRanks }, { isWalkover }, { isProvisional }, store] =
    await Promise.all([
      import("../lib/elo.mjs"), import("../lib/seeds.mjs"),
      import("../lib/dataset.mjs"), import("../lib/models.mjs"), import("../lib/store.mjs"),
    ]);

  console.log("MESURE DESCRIPTIVE — le facteur GAUCHER au-delà de l'Elo (graine 42)\n");
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

  // --- 2) Jointure --------------------------------------------------------------
  const handMap = loadHands();
  let nLeft = 0;
  for (const h of handMap.values()) if (h === "left") nLeft++;
  console.log(`\n2) Jointure avec birthdates.json (${handMap.size} joueurs à main connue, dont ${nLeft} gauchers)`);
  const perDisc = new Map();
  let appearSeen = 0, appearKnown = 0;
  const joined = [];
  for (const r of rows) {
    const ids = [...playerIdsOf(r.a), ...playerIdsOf(r.b)];
    appearSeen += ids.length;
    appearKnown += ids.filter((id) => handMap.has(id)).length;
    const d = handGap(r, handMap);
    const st = perDisc.get(r.disc) || { n: 0, ok: 0 };
    st.n++;
    if (d != null) {
      st.ok++;
      joined.push({ ...r, dHand: d,
        lA: teamLeftiness(r.a, handMap), lB: teamLeftiness(r.b, handMap) });
    }
    perDisc.set(r.disc, st);
  }
  const totN = rows.length, totOk = joined.length;
  console.log(`   Matchs avec la MAIN de TOUS les joueurs connue : ${totOk}/${totN} (${(100 * totOk / totN).toFixed(1)} %)`);
  console.log(`   Apparitions de joueurs à main connue : ${(100 * appearKnown / appearSeen).toFixed(1)} %`);
  for (const [disc, st] of [...perDisc].sort()) {
    console.log(`     ${disc} : ${st.ok}/${st.n} (${(100 * st.ok / st.n).toFixed(1)} %)`);
  }
  // Part de camps gauchers parmi les matchs joints (rareté du gaucher)
  const sides = joined.length * 2;
  const sidesWithLeft = joined.reduce((s, r) => s + (r.lA > 0 ? 1 : 0) + (r.lB > 0 ? 1 : 0), 0);
  console.log(`   Camps avec au moins un gaucher : ${sidesWithLeft}/${sides} (${(100 * sidesWithLeft / sides).toFixed(1)} %)`);

  // --- 3) Résidu par configuration de mains --------------------------------------
  // Résidu = victoire observée (0/1) − proba du modèle de PROD, pris DU POINT
  // DE VUE DU CAMP LE PLUS GAUCHER quand la config est asymétrique. Si être
  // gaucher n'apporte rien au-delà de l'Elo, ce résidu est ≈ 0. Les configs
  // symétriques (miroir) sont des CONTRÔLES : l'avantage y disparaît par
  // construction (résidu pris du point de vue du camp A, arbitraire).
  console.log("\n3) Résidu (observé − proba prod) par configuration de mains");
  console.log("   (asymétrique : du point de vue du camp le PLUS gaucher ; symétrique : contrôle, camp A)");
  const showBucket = (label, items) => {
    const n = items.length;
    if (!n) { console.log(`   ${label.padEnd(30)} n=0`); return; }
    const res = items.map((it) => it.res);
    const m = res.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(res.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, n - 1));
    const half = 1.96 * sd / Math.sqrt(n);
    const pm = items.reduce((s, it) => s + it.p, 0) / n;
    const sig = m - half > 0 || m + half < 0 ? " ⚠️" : "";
    console.log(
      `   ${label.padEnd(30)} ${String(n).padStart(5)}   ${(100 * pm).toFixed(1).padStart(6)} %` +
      `   ${((m >= 0 ? "+" : "") + (100 * m).toFixed(2)).padStart(8)} pt   [${(100 * (m - half)).toFixed(2)} ; ${(100 * (m + half)).toFixed(2)}]${sig}`,
    );
  };
  // point de vue du camp le plus gaucher (ou du camp A si égalité)
  const povItem = (r) => {
    const p = recalibrate(eloProb(r.eloA, r.eloB), r.disc);
    const y = r.winner === 1 ? 1 : 0;
    return r.dHand >= 0 ? { res: y - p, p } : { res: (1 - y) - (1 - p), p: 1 - p };
  };
  console.log("\n   configuration                     n   proba moy.  obs−attendu  IC 95 % (résidu)");
  const singles = joined.filter((r) => r.disc === "MS" || r.disc === "WS");
  console.log("   — SIMPLE (MS+WS) —");
  showBucket("D vs D (contrôle)", singles.filter((r) => r.lA === 0 && r.lB === 0).map(povItem));
  showBucket("G vs D (résidu du gaucher)", singles.filter((r) => r.dHand !== 0).map(povItem));
  showBucket("G vs G (contrôle miroir)", singles.filter((r) => r.lA === 1 && r.lB === 1).map(povItem));
  for (const disc of ["MS", "WS"]) {
    showBucket(`  ${disc} : G vs D`, singles.filter((r) => r.disc === disc && r.dHand !== 0).map(povItem));
  }
  const doubles = joined.filter((r) => r.disc !== "MS" && r.disc !== "WS");
  console.log("   — DOUBLE (MD+WD+XD) —");
  showBucket("0G vs 0G (contrôle)", doubles.filter((r) => r.lA === 0 && r.lB === 0).map(povItem));
  showBucket("camp plus gaucher (résidu)", doubles.filter((r) => r.dHand !== 0).map(povItem));
  showBucket("  dont écart d'exactement 1 G", doubles.filter((r) => Math.abs(r.dHand) === 1).map(povItem));
  showBucket("  dont écart de 2 G", doubles.filter((r) => Math.abs(r.dHand) === 2).map(povItem));
  showBucket("égalité ≥1 G (contrôle miroir)", doubles.filter((r) => r.dHand === 0 && r.lA > 0).map(povItem));
  for (const disc of ["MD", "WD", "XD"]) {
    showBucket(`  ${disc} : camp plus gaucher`, doubles.filter((r) => r.disc === disc && r.dHand !== 0).map(povItem));
  }

  // --- 4) Régression logistique du résidu ----------------------------------------
  // b = log-cotes supplémentaires PAR GAUCHER D'ÉCART, l'Elo (recalibré) étant
  // déjà compté (offset). b > 0 = « être (plus) gaucher aide » à Elo égal.
  console.log("\n4) Régression : victoire ~ sigmoid(logit(p_prod) + b × écart de gaucherie)");
  const mkZXY = (rs, agg = "count") => {
    const zs = [], xs = [], ys = [];
    for (const r of rs) {
      const d = agg === "count" ? r.dHand : handGap(r, handMap, agg);
      if (d == null) continue;
      zs.push(logit(recalibrate(eloProb(r.eloA, r.eloB), r.disc)));
      xs.push(d);
      ys.push(r.winner === 1 ? 1 : 0);
    }
    return [zs, xs, ys];
  };
  const show = (label, rs, agg = "count") => {
    const [zs, xs, ys] = mkZXY(rs, agg);
    const nGap = xs.filter((x) => x !== 0).length;
    if (zs.length < 100 || nGap < 30) {
      console.log(`   ${label.padEnd(18)} n=${zs.length} dont ${nGap} avec écart (trop peu)`);
      return;
    }
    const b = fitOffsetSlope(zs, xs, ys);
    const [lo, hi] = bootstrapSlope(zs, xs, ys, { draws: 500 });
    const sig = lo > 0 || hi < 0 ? " ⚠️ significatif" : "";
    console.log(
      `   ${label.padEnd(18)} n=${String(zs.length).padStart(5)} (écart≠0 : ${String(nGap).padStart(4)})` +
      `  b=${(b >= 0 ? "+" : "") + b.toFixed(4)}  IC95 [${lo.toFixed(4)} ; ${hi.toFixed(4)}]${sig}`,
    );
  };
  show("GLOBAL (comptage)", joined);
  for (const disc of ["MS", "WS", "MD", "WD", "XD"]) {
    show(`  ${disc}`, joined.filter((r) => r.disc === disc));
  }
  for (const y of years) {
    show(`  année ${y}`, joined.filter((r) => r.year === y));
  }
  console.log("   Sensibilité au codage d'équipe en double (doubles seulement) :");
  show("  double, comptage", doubles, "count");
  show("  double, ≥1 gaucher", doubles, "any");

  // --- 5) Ce que ferait la variante (coefficients marche avant) ------------------
  console.log("\n5) Coefficients de la variante elo-hand (marche avant par discipline, IC doit exclure 0)");
  const { detail } = fitHandWalkForward(rows, handMap);
  if (!detail.length) console.log("   (aucune année avec assez d'antériorité)");
  for (const d of detail) {
    console.log(
      `   ${d.disc} ${d.year} : ajusté ${(d.fit >= 0 ? "+" : "") + d.fit.toFixed(4)} ` +
      `IC [${d.lo?.toFixed(4)} ; ${d.hi?.toFixed(4)}] sur n=${d.n} -> appliqué ${d.applied === 0 ? "0 (aucune correction)" : d.applied.toFixed(4)}`,
    );
  }
  console.log(
    "\nLecture : b est en log-cotes par gaucher d'écart entre les camps. À 50/50 " +
    "Elo, b=+0,10 déplace la proba du camp gaucher de 50 % à ~52,5 %. Un IC " +
    "contenant 0 = aucun signal prouvé au-delà de l'Elo.",
  );
}

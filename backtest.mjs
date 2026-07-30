// backtest.mjs
// Rejoue tout l'historique des matchs et compare les modèles de pronostic.
//
//   node backtest.mjs                # écrit web/public/data/backtest.json
//   node backtest.mjs --quiet        # sans le résumé console
//
// Répond à trois questions par la mesure :
//   1. notre Elo vaut-il mieux que des règles triviales (tête de série,
//      classement mondial officiel) ?
//   2. quelle est l'incertitude propre à chaque discipline ?
//   3. la probabilité annoncée est-elle honnête (calibration) ?
//
// Tout repose sur le jeu de données d'AVANT match (lib/dataset.mjs) : chaque
// match est prédit avec l'état des connaissances à son instant, jamais avec
// l'état final. Sans cette marche avant, les chiffres seraient faux et
// paraîtraient excellents.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./lib/store.mjs";
import { seedEloByRank } from "./lib/elo.mjs";
import { loadInitialRanks } from "./lib/seeds.mjs";
import { loadPublications } from "./lib/rank-history.mjs";
import { buildDataset } from "./lib/dataset.mjs";
import { MODELS, predictAll, commonBase } from "./lib/models.mjs";
import { evaluate, calibration, overlaps, accuracy, brier, bootstrapCI, upsetByBand, logLoss, makeRng } from "./lib/metrics.mjs";
import { featuresOf, FEATURE_KEYS, featureLabel } from "./lib/features.mjs";
import { fitLogistic, predictLogistic } from "./lib/logistic.mjs";
import { isProvisional, eloProb } from "./lib/models.mjs";
import { recalibrate } from "./lib/calibrate.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "web", "public", "data", "backtest.json");
const QUIET = process.argv.includes("--quiet");
const DRAWS = 500;
const SEED = 42;

const log = (...a) => { if (!QUIET) console.log(...a); };
const pc = (v) => (v == null ? "  —  " : (v * 100).toFixed(1) + " %");

// ---- 1) Jeu de données -----------------------------------------------------
log("Construction du jeu de données d'avant match…");
const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();
const publications = await loadPublications(join(ROOT, "data", "rankings"));
const { rows, stats } = await buildDataset({ years, seeds, publications });
log(`   ${rows.length} matchs retenus (${stats.walkovers} forfaits exclus), ` +
    `${publications.length} publications de classement.`);

const y = rows.map((r) => r.won);
const { preds, coverage } = predictAll(rows, MODELS);
const libelle = (k) => MODELS.find((m) => m.key === k).label;

const indices = (k) => {
  const out = [];
  for (let i = 0; i < rows.length; i++) if (preds[i][k] != null) out.push(i);
  return out;
};
const evalSur = (idx, k) => evaluate(idx.map((i) => preds[i][k]), idx.map((i) => y[i]), { draws: DRAWS, seed: SEED });

// ---- 2) Comparaisons par paires --------------------------------------------
// Un socle commun unique à TOUS les modèles serait dicté par le moins couvrant
// (« tête de série » ne couvre que ~950 matchs, les deux têtes de série se
// croisant rarement) : la comparaison qui compte, Elo contre classement mondial,
// se jouerait alors sur 890 matchs au lieu de 8 750, avec des intervalles qui se
// chevauchent et aucune conclusion possible. On compare donc chaque paire sur
// SON intersection, ce qui maximise la puissance statistique de chaque duel.
const duels = [];
for (let i = 0; i < MODELS.length; i++) {
  for (let j = i + 1; j < MODELS.length; j++) {
    const a = MODELS[i].key, b = MODELS[j].key;
    const idx = [];
    for (let k = 0; k < rows.length; k++) if (preds[k][a] != null && preds[k][b] != null) idx.push(k);
    if (!idx.length) continue;
    const ea = evalSur(idx, a), eb = evalSur(idx, b);
    duels.push({
      a, b, aLabel: libelle(a), bLabel: libelle(b), n: idx.length,
      aAccuracy: ea.accuracy, bAccuracy: eb.accuracy,
      aBrier: ea.brier.value, bBrier: eb.brier.value,
      deltaAccuracy: eb.accuracy.value - ea.accuracy.value,
      deltaBrier: eb.brier.value - ea.brier.value,
      // Un écart n'est retenu que si les intervalles NE se chevauchent PAS.
      separable: !overlaps(ea.accuracy, eb.accuracy),
    });
  }
}

// ---- 3) Chaque modèle sur sa couverture propre -----------------------------
const parModele = MODELS.map((m) => {
  const idx = indices(m.key);
  const e = idx.length ? evalSur(idx, m.key) : null;
  return {
    key: m.key, label: m.label, binary: m.binary,
    n: idx.length, coverage: coverage[m.key] / rows.length,
    accuracy: e?.accuracy ?? null, brier: e?.brier ?? null,
    logLoss: e?.logLoss ?? null, upsetRate: e?.upsetRate ?? null,
    sharpness: e?.sharpness ?? null, calibrationError: e?.calibrationError ?? null,
  };
});

// ---- 4) Socle commun (conservé pour référence) -----------------------------
const socle = commonBase(preds, MODELS);
const surSocle = MODELS.map((m) => {
  const e = socle.length ? evalSur(socle, m.key) : null;
  return { key: m.key, label: m.label, accuracy: e?.accuracy ?? null, brier: e?.brier?.value ?? null };
});

// ---- 5) Calibration de l'Elo ----------------------------------------------
const idxElo = indices("elo");
const calibElo = calibration(idxElo.map((i) => preds[i].elo), idxElo.map((i) => y[i]), 10);

// ---- 6) Prévisibilité par discipline, à information constante --------------
// Orientation FIXÉE par l'Elo simple pour toutes les disciplines : c'est ce qui
// rend la comparaison valide, chaque discipline étant jugée avec la même
// information. Utiliser l'orientation propre à chaque modèle rendrait les
// colonnes incomparables. L'événement mesuré est « le favori Elo gagne » : sans
// cette réorientation, le taux de base vaudrait 0,5 partout (le camp A est
// simplement le premier du tableau) et ne mesurerait rien.
const parDiscipline = [];
for (const disc of ["MS", "WS", "MD", "WD", "XD"]) {
  const idx = idxElo.filter((i) => rows[i].disc === disc);
  if (idx.length < 30) continue;
  // orienté favori : p >= 0.5 -> on garde, sinon on retourne
  const p = [], o = [];
  for (const i of idx) {
    const pr = preds[i].elo;
    if (pr >= 0.5) { p.push(pr); o.push(y[i]); }
    else { p.push(1 - pr); o.push(1 - y[i]); }
  }
  const tauxFavori = bootstrapCI(p, o, (a, b) => accuracy(a, b), { draws: DRAWS, seed: SEED });
  const brierCI = bootstrapCI(p, o, brier, { draws: DRAWS, seed: SEED });
  // incertitude irréductible = p̄(1−p̄) avec p̄ = taux de victoire du favori
  const pBar = o.reduce((s, v) => s + v, 0) / o.length;
  parDiscipline.push({
    disc, n: idx.length,
    favWinRate: pBar,
    irreducible: pBar * (1 - pBar),
    brier: brierCI, accuracy: tauxFavori,
    upsetRate: 1 - pBar,
    sharpness: p.reduce((s, v) => s + Math.abs(v - 0.5), 0) / p.length,
    // Décomposition par bande : le taux global mélange les pile-ou-face et les
    // vraies surprises. Une discipline peu tranchée récolte mécaniquement plus
    // de « surprises » sans être moins prévisible. C'est la bande « francs »
    // (75-90 %) qui départage réellement les disciplines.
    bands: upsetByBand(p, o),
  });
}
parDiscipline.sort((a, b) => a.brier.value - b.brier.value);

// Paires de disciplines non départageables (intervalles de Brier qui se chevauchent).
const indistinguishable = [];
for (let i = 0; i < parDiscipline.length; i++) {
  for (let j = i + 1; j < parDiscipline.length; j++) {
    if (overlaps(parDiscipline[i].brier, parDiscipline[j].brier)) {
      indistinguishable.push([parDiscipline[i].disc, parDiscipline[j].disc]);
    }
  }
}

// ---- 6b) Modèle additif : les signaux supplémentaires servent-ils ? --------
// Chaque signal est pesé sur 2024-2025 puis le modèle est ÉVALUÉ sur 2026, jamais
// vu par l'ajustement — sans quoi on ne mesurerait que notre capacité à décrire
// le passé. Un signal dont l'intervalle bootstrap contient zéro est retiré.
//
// Ce bloc publie un résultat NÉGATIF, et c'est délibéré : il doit rester
// revérifiable. Voir la clé `verdict` ci-dessous.
const utilisables = rows.filter((r) => !isProvisional(r.nA) && !isProvisional(r.nB));
const appr = utilisables.filter((r) => r.t < "2026-01-01");
const verif = utilisables.filter((r) => r.t >= "2026-01-01");
let additif = null;

if (appr.length > 500 && verif.length > 200) {
  const Xa = appr.map(featuresOf), ya = appr.map((r) => r.won);
  const plein = fitLogistic(Xa, ya, { keys: FEATURE_KEYS, epochs: 4000, l2: 1e-3 });

  // Intervalle bootstrap de chaque poids : lesquels excluent zéro ?
  const rng = makeRng(SEED);
  const tirages = FEATURE_KEYS.map(() => []);
  for (let k = 0; k < 40; k++) {
    const ix = Array.from({ length: appr.length }, () => Math.floor(rng() * appr.length));
    const bm = fitLogistic(ix.map((i) => Xa[i]), ix.map((i) => ya[i]), { keys: FEATURE_KEYS, epochs: 1200, l2: 1e-3 });
    bm.weights.forEach((w, j) => tirages[j].push(w));
  }
  const signaux = FEATURE_KEYS.map((key, j) => {
    const s2 = tirages[j].slice().sort((x, z) => x - z);
    const lo = s2[Math.floor(0.025 * s2.length)], hi = s2[Math.floor(0.975 * s2.length)];
    return { key, label: featureLabel(key), weight: plein.weights[j], lo, hi, kept: (lo > 0 && hi > 0) || (lo < 0 && hi < 0) };
  });

  // Modèle restreint aux signaux retenus
  const gardes = signaux.filter((x) => x.kept).map((x) => x.key);
  const sousEns = (r) => { const f = featuresOf(r); return gardes.map((k) => f[FEATURE_KEYS.indexOf(k)]); };
  const restreint = fitLogistic(appr.map(sousEns), ya, { keys: gardes, epochs: 4000, l2: 1e-3 });

  const yv = verif.map((r) => r.won);
  const pElo = verif.map((r) => recalibrate(eloProb(r.eloA, r.eloB), r.disc));
  const pAdd = verif.map((r) => predictLogistic(restreint, sousEns(r)));
  const ciE = { accuracy: bootstrapCI(pElo, yv, accuracy, { draws: DRAWS, seed: SEED }), brier: bootstrapCI(pElo, yv, brier, { draws: DRAWS, seed: SEED }) };
  const ciA = { accuracy: bootstrapCI(pAdd, yv, accuracy, { draws: DRAWS, seed: SEED }), brier: bootstrapCI(pAdd, yv, brier, { draws: DRAWS, seed: SEED }) };

  additif = {
    trainedOn: { n: appr.length, to: "2025-12-31" },
    testedOn: { n: verif.length, from: "2026-01-01" },
    signals: signaux,
    kept: gardes,
    reference: { label: "Elo recalibré", accuracy: ciE.accuracy, brier: ciE.brier, logLoss: logLoss(pElo, yv) },
    additive: { label: "Modèle additif", accuracy: ciA.accuracy, brier: ciA.brier, logLoss: logLoss(pAdd, yv) },
    separable: !overlaps(ciE.brier, ciA.brier) && !overlaps(ciE.accuracy, ciA.accuracy),
  };
  additif.verdict = additif.separable
    ? (ciA.brier.value < ciE.brier.value ? "le modèle additif améliore la prédiction" : "le modèle additif la dégrade")
    : "aucun gain démontrable : les intervalles se chevauchent sur la réussite comme sur le Brier";
}

// ---- 7) Écriture -----------------------------------------------------------
const rapport = {
  generatedAt: new Date().toISOString(),
  method: {
    walkForward: true,
    bootstrapDraws: DRAWS,
    bootstrapSeed: SEED,
    disciplineOrientation: "elo",
    note: "Chaque match est prédit avec l'état des connaissances d'AVANT ce match.",
  },
  coverage: {
    rows: rows.length,
    walkovers: stats.walkovers,
    publications: publications.length,
    from: rows[0]?.t?.slice(0, 10) ?? null,
    to: rows[rows.length - 1]?.t?.slice(0, 10) ?? null,
    commonBase: socle.length,
  },
  models: parModele,
  duels,
  commonBaseMetrics: surSocle,
  calibration: calibElo,
  byDiscipline: parDiscipline,
  indistinguishable,
  additive: additif,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(rapport), "utf8");

// ---- 8) Résumé console -----------------------------------------------------
log("\n=== CHAQUE MODÈLE SUR SA COUVERTURE PROPRE ===");
log("modèle                réussite     Brier   couverture");
for (const m of parModele) {
  log(m.label.padEnd(20), pc(m.accuracy?.value).padStart(8),
      (m.brier?.value?.toFixed(3) ?? "—").padStart(9),
      (`${m.n} (${(m.coverage * 100).toFixed(0)} %)`).padStart(13));
}

log("\n=== DUELS, CHACUN SUR SON INTERSECTION ===");
for (const d of duels) {
  const signe = d.deltaAccuracy >= 0 ? "+" : "";
  log(`${d.aLabel} vs ${d.bLabel} — n=${d.n}`);
  log(`   ${pc(d.aAccuracy.value)} vs ${pc(d.bAccuracy.value)}  (${signe}${(d.deltaAccuracy * 100).toFixed(1)} pt)  ` +
      `Brier ${d.aBrier.toFixed(3)} vs ${d.bBrier.toFixed(3)}  ${d.separable ? "✅ écart réel" : "❌ non départageable"}`);
}

log("\n=== PRÉVISIBILITÉ PAR DISCIPLINE (orientation Elo, à information constante) ===");
log("disc   incertitude irréductible      Brier        surprise   netteté       n");
for (const d of parDiscipline) {
  log(`${d.disc.padEnd(6)} ${d.irreducible.toFixed(3).padStart(10)}` +
      `        ${d.brier.value.toFixed(3)} ±${((d.brier.hi - d.brier.lo) / 2).toFixed(3)}` +
      `   ${pc(d.upsetRate).padStart(8)}   ${pc(d.sharpness).padStart(7)}  ${String(d.n).padStart(6)}`);
}
if (indistinguishable.length) {
  log(`\n⚠️  non départageables (intervalles qui se chevauchent) : ` +
      indistinguishable.map((p) => p.join("/")).join(", "));
  log("    -> interdit de les traiter différemment dans le modèle.");
}

log("\n=== CALIBRATION DE L'ELO (probabilités repliées sur le favori) ===");
log("tranche    prédit   observé      n");
for (const b of calibElo) {
  if (!b.n) continue;
  const ecart = b.observed - b.predicted;
  log(`${b.bin.padEnd(10)} ${pc(b.predicted).padStart(7)} ${pc(b.observed).padStart(8)} ${String(b.n).padStart(7)}  ` +
      `${ecart >= 0 ? "+" : ""}${(ecart * 100).toFixed(1)} pt`);
}
const eElo = parModele.find((m) => m.key === "elo");
log(`\nerreur de calibration : ${(eElo.calibrationError * 100).toFixed(1)} pt d'écart moyen`);
if (additif) {
  log("\n=== SIGNAUX DU MODÈLE ADDITIF (pesés sur 2024-2025) ===");
  log("signal                          poids   intervalle        verdict");
  for (const s2 of additif.signals) {
    log(s2.label.padEnd(30), s2.weight.toFixed(3).padStart(7),
        `   [${s2.lo.toFixed(2)} , ${s2.hi.toFixed(2)}]`.padEnd(20),
        s2.kept ? "retenu" : "RETIRÉ (zéro dans l'intervalle)");
  }
  log(`\n=== LE MODÈLE ADDITIF BAT-IL L'ELO ? (sur ${additif.testedOn.n} matchs de 2026) ===`);
  log(`  ${additif.reference.label.padEnd(16)} ${pc(additif.reference.accuracy.value)}  Brier ${additif.reference.brier.value.toFixed(4)}`);
  log(`  ${additif.additive.label.padEnd(16)} ${pc(additif.additive.accuracy.value)}  Brier ${additif.additive.brier.value.toFixed(4)}`);
  log(`  -> ${additif.verdict}`);
}

log(`\n✅ écrit -> web/public/data/backtest.json`);

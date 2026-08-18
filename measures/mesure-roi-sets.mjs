// measures/mesure-roi-sets.mjs
// ÉTUDE DU MARCHÉ « NOMBRE DE SETS » — étapes 2 et 3 : le prix sait-il déjà, et
// est-ce rentable ?
//
//   node measures/mesure-roi-sets.mjs
//   node measures/mesure-roi-sets.mjs --seuils=0,0.05,0.10
//
// PRÉREQUIS : `node tools/flashscore/backfill-sets.mjs` (data/flashscore/sets/).
//
// D'OÙ VIENT LE PRIX. Les bookmakers ne cotent pas « 2 sets / 3 sets » dans les
// archives Flashscore, mais le SCORE EXACT en sets (2-0, 2-1, 1-2, 0-2), avec
// ouverture et clôture. « Match en 3 sets » se rejoue exactement en misant 2-1
// ET 1-2 — deux paris réels, dont le prix combiné est
//   c3 = 1 / (1/cote(2-1) + 1/cote(1-2))
// (mises réparties pour un gain identique dans les deux cas). Idem pour 2 sets
// avec 2-0 et 0-2. On ne synthétise donc AUCUNE cote qui n'existe pas : on
// achète les quatre issues offertes, on les regroupe.
//
// PROBA DU MARCHÉ. Les 4 issues couvrent tout l'espace : leur somme d'inverses
// vaut 1 + marge. On dé-vigue en proportionnel (comme lib/roi.mjs), d'où
//   p3(marché) = (1/c(2-1) + 1/c(1-2)) / Σ des 4 inverses.
//
// NOTRE PROBA. Modèle D de l'étape 1 (§10.1) : écart d'Elo + écart de rang
// mondial + niveau + discipline. Ajusté en MARCHE AVANT, réajusté chaque mois
// sur les seuls matchs strictement antérieurs — jamais sur le match jugé.
//
// CE QU'ON MESURE.
//   Étape 2 : log loss du marché vs la nôtre vs le taux constant, et
//             calibration du marché. Si le marché est meilleur partout, il n'y
//             a pas d'edge à chercher, et on s'arrête là.
//   Étape 3 : ROI réel des paris (à la clôture ET à l'ouverture), par seuil
//             d'EV, avec IC bootstrap ; ROI des stratégies aveugles (tout
//             miser sur 3 sets, ou tout sur 2 sets) qui donnent la marge du
//             bookmaker ; et la CLV (ouverture vs clôture).

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover, wentThreeSets, makeRankLookup } from "../lib/dataset.mjs";
import { fitLogistic, predictLogistic } from "../lib/logistic.mjs";
import { loadPublications } from "../lib/rank-history.mjs";
import { loadFlashscoreOdds, joinFlashscore } from "../lib/flashscore-join.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const SEUILS = (args.find((a) => a.startsWith("--seuils=")) || "")
  .split("=")[1]?.split(",").map(Number) ?? [0, 0.05, 0.1];

const DISCIPLINES = ["MS", "WS", "MD", "WD", "XD"];
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pctSigne = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;
const lg = (x) => Math.log10(Math.max(1, x));

// --- 1. Les matchs BWF, avec Elo et rang d'AVANT match ----------------------

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();
const publications = await loadPublications(join(ROOT, "data", "rankings"));
const rangDe = makeRankLookup(publications);

const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || match.score.length < 2) return;
    const jour = String(match.matchTime).slice(0, 10);
    rows.push({
      cle: `${tmtId}|${disc}|${jour}|${a.key}|${b.key}`,
      tmtId, disc, jour,
      an: Number(jour.slice(0, 4)),
      mois: jour.slice(0, 7),
      gap: Math.abs(a.entity.rating - b.entity.rating),
      rangA: rangDe(match.matchTime, disc, a.key)?.rank ?? null,
      rangB: rangDe(match.matchTime, disc, b.key)?.rank ?? null,
      three: wentThreeSets(match.score) ? 1 : 0,
      // pour la jointure Flashscore (même forme que build-data.mjs)
      name1: match.team1.players.map((p) => p.nameDisplay).join(" / "),
      name2: match.team2.players.map((p) => p.nameDisplay).join(" / "),
      sets: match.score.map((s) => ({ home: s.home, away: s.away })),
      a: a.key, b: b.key,
    });
  },
});
rows.sort((x, y) => (x.jour < y.jour ? -1 : 1));

// --- 2. Jointure vers les cotes de sets --------------------------------------

const fsFiles = await loadFlashscoreOdds(join(ROOT, "data", "flashscore", "odds"));
const { joined } = joinFlashscore(fsFiles, rows.map((r) => ({
  tmtId: r.tmtId, disc: r.disc, day: r.jour,
  name1: r.name1, name2: r.name2, sets: r.sets, a: r.a, b: r.b,
})));

// data/flashscore/sets/ : fsId -> cotes par score exact, par opérateur
const SETS_DIR = join(ROOT, "data", "flashscore", "sets");
const parFsId = new Map();
let fichiers = [];
try { fichiers = (await readdir(SETS_DIR)).filter((f) => f.endsWith(".json")); }
catch { console.error(`Aucune collecte dans ${SETS_DIR} — lancer tools/flashscore/backfill-sets.mjs.`); process.exit(1); }
for (const f of fichiers) {
  const j = JSON.parse(await readFile(join(SETS_DIR, f), "utf8"));
  for (const m of j.matches || []) if (m.scores) parFsId.set(m.fsId, m.scores);
}

/**
 * Prix combiné et proba du marché, pour un opérateur donné.
 * @param {object} scores  { "2-0": {opening, closing}, … }
 * @param {"opening"|"closing"} quand
 * @returns {{c3: number, c2: number, p3: number}|null} null si les 4 issues ne
 *          sont pas toutes cotées (on n'invente pas la moitié manquante).
 */
export function prixDesSets(scores, quand) {
  const o = {};
  for (const k of ["2-0", "2-1", "1-2", "0-2"]) {
    const v = scores?.[k]?.[quand];
    if (!Number.isFinite(v) || v <= 1) return null;
    o[k] = v;
  }
  const inv = (k) => 1 / o[k];
  const somme = inv("2-0") + inv("2-1") + inv("1-2") + inv("0-2");
  return {
    c3: 1 / (inv("2-1") + inv("1-2")),
    c2: 1 / (inv("2-0") + inv("0-2")),
    p3: (inv("2-1") + inv("1-2")) / somme,
    marge: somme - 1,
  };
}

const OPERATEURS = ["betclic", "winamax", "unibet"];
const paris = [];
for (const r of rows) {
  const j = joined.get(r.cle);
  const scores = j?.fsId ? parFsId.get(j.fsId) : null;
  if (!scores) continue;
  // Meilleur prix disponible sur « 3 sets » à la clôture = ce qu'on aurait
  // vraiment joué (multi-comptes, cf. §8.1).
  const parOp = {};
  for (const op of OPERATEURS) {
    if (!scores[op]) continue;
    const cl = prixDesSets(scores[op], "closing");
    const ouv = prixDesSets(scores[op], "opening");
    if (cl) parOp[op] = { cl, ouv };
  }
  if (!Object.keys(parOp).length) continue;
  paris.push({ ...r, parOp });
}

console.log("ÉTUDE DU MARCHÉ « NOMBRE DE SETS » — étapes 2 et 3");
console.log(`${fichiers.length} tournois collectés | ${paris.length} matchs joints (BWF ↔ cotes de sets)\n`);
if (paris.length < 200) {
  console.log("Trop peu de matchs pour conclure — la collecte est-elle terminée ?");
}

// --- 3. Notre proba, en marche avant (modèle D de §10.1) ---------------------

const DUMMIES = DISCIPLINES.slice(1);
const encode = (r) => [
  r.gap / 100,
  Math.abs(lg(r.rangA) - lg(r.rangB)),
  lg(Math.min(r.rangA, r.rangB)),
  ...DUMMIES.map((d) => (r.disc === d ? 1 : 0)),
];
const utilisables = rows.filter((r) => r.rangA && r.rangB);

// Réajustement MENSUEL sur les seuls matchs strictement antérieurs : un modèle
// figé sur « avant 2025 » gâcherait toute l'année 2024, qui porte pourtant des
// cotes. Coût : ~30 ajustements, quelques secondes.
const modelesParMois = new Map();
const moisTries = [...new Set(utilisables.map((r) => r.mois))].sort();
for (const mois of moisTries) {
  const passe = utilisables.filter((r) => r.mois < mois);
  if (passe.length < 1500) continue; // pas assez d'histoire : mois non jugeable
  modelesParMois.set(mois, fitLogistic(
    passe.map(encode), passe.map((r) => r.three), { epochs: 3000 },
  ));
}
const notreP3 = (r) => {
  const m = modelesParMois.get(r.mois);
  return m && r.rangA && r.rangB ? predictLogistic(m, encode(r)) : null;
};

// --- 4. ÉTAPE 2 : le marché sait-il déjà ? -----------------------------------

const logLoss = (ps, ys) => -ps.reduce((s, p, i) => {
  const q = Math.min(1 - 1e-15, Math.max(1e-15, p));
  return s + (ys[i] ? Math.log(q) : Math.log(1 - q));
}, 0) / ps.length;

const jugeables = paris.filter((r) => notreP3(r) != null);
const pMarche = jugeables.map((r) => {
  const ops = Object.values(r.parOp);
  return ops.reduce((s, o) => s + o.cl.p3, 0) / ops.length; // consensus des opérateurs
});
const pNous = jugeables.map(notreP3);
const ys = jugeables.map((r) => r.three);
const tauxBase = ys.reduce((s, y) => s + y, 0) / ys.length;

console.log("ÉTAPE 2 — qui prédit le mieux le nombre de sets ?");
console.log(`   ${jugeables.length} matchs jugeables | 3 sets observés : ${pct(tauxBase)}`);
console.log(`   log loss taux constant : ${logLoss(jugeables.map(() => tauxBase), ys).toFixed(4)}`);
console.log(`   log loss NOTRE modèle  : ${logLoss(pNous, ys).toFixed(4)}`);
console.log(`   log loss MARCHÉ        : ${logLoss(pMarche, ys).toFixed(4)}`);
const margeMoy = jugeables.reduce((s, r) => {
  const ops = Object.values(r.parOp);
  return s + ops.reduce((t, o) => t + o.cl.marge, 0) / ops.length;
}, 0) / (jugeables.length || 1);
console.log(`   marge moyenne du bookmaker sur les 4 issues : ${pct(margeMoy)}`);

console.log("\n   Calibration du MARCHÉ par tranche de p3 (dé-viggée, clôture)");
const tranches = [0, 0.25, 0.3, 0.35, 0.4, 1];
for (let i = 0; i < tranches.length - 1; i++) {
  const bloc = jugeables.filter((_, k) => pMarche[k] >= tranches[i] && pMarche[k] < tranches[i + 1]);
  if (bloc.length < 30) continue;
  const idx = jugeables.map((_, k) => k).filter((k) => pMarche[k] >= tranches[i] && pMarche[k] < tranches[i + 1]);
  const pm = idx.reduce((s, k) => s + pMarche[k], 0) / idx.length;
  const obs = bloc.reduce((s, r) => s + r.three, 0) / bloc.length;
  console.log(`      ${pct(tranches[i]).padStart(6)}-${pct(tranches[i + 1]).padStart(6)} | ${String(bloc.length).padStart(5)} matchs | marché ${pct(pm)} | observé ${pct(obs)} | ${pctSigne(obs - pm)}`);
}

// --- 5. ÉTAPE 3 : rentabilité ------------------------------------------------

// Bootstrap déterministe (graine 42), même convention que le banc d'essai.
function ic95Bootstrap(gains, tirages = 2000) {
  if (!gains.length) return [0, 0];
  let graine = 42;
  const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const moyennes = [];
  for (let t = 0; t < tirages; t++) {
    let s = 0;
    for (let i = 0; i < gains.length; i++) s += gains[Math.floor(alea() * gains.length)];
    moyennes.push(s / gains.length);
  }
  moyennes.sort((a, b) => a - b);
  return [moyennes[Math.floor(tirages * 0.025)], moyennes[Math.floor(tirages * 0.975)]];
}

/** Gain d'une mise de 1 € sur `camp` (3 ou 2 sets) au prix `cote`. */
const gainDe = (cote, gagne) => (gagne ? cote - 1 : -1);

/** Meilleur prix entre opérateurs pour un camp donné. */
const meilleur = (r, quand, camp) => {
  let best = null;
  for (const o of Object.values(r.parOp)) {
    const p = quand === "cl" ? o.cl : o.ouv;
    if (!p) continue;
    const c = camp === 3 ? p.c3 : p.c2;
    if (best == null || c > best) best = c;
  }
  return best;
};

console.log("\nÉTAPE 3 — rentabilité (mise de 1 €, meilleur prix entre opérateurs)");
console.log("\n   a) Stratégies AVEUGLES — elles mesurent la marge, pas notre modèle");
for (const [nom, camp] of [["tout sur 3 sets", 3], ["tout sur 2 sets", 2]]) {
  const gains = [];
  for (const r of jugeables) {
    const c = meilleur(r, "cl", camp);
    if (c) gains.push(gainDe(c, camp === 3 ? r.three === 1 : r.three === 0));
  }
  const roi = gains.reduce((s, g) => s + g, 0) / gains.length;
  const [lo, hi] = ic95Bootstrap(gains);
  console.log(`      ${nom.padEnd(16)} ${String(gains.length).padStart(5)} paris | ROI ${pctSigne(roi).padStart(7)} [${pctSigne(lo)} ; ${pctSigne(hi)}]`);
}

console.log("\n   b) Paris SÉLECTIFS selon notre modèle (EV = p × cote − 1)");
console.log("      seuil | camp    | quand     |     n | ROI          | IC 95 %");
for (const seuil of SEUILS) {
  for (const camp of [3, 2]) {
    for (const quand of ["cl", "ouv"]) {
      const gains = [];
      for (const r of jugeables) {
        const c = meilleur(r, quand, camp);
        if (!c) continue;
        const p = camp === 3 ? notreP3(r) : 1 - notreP3(r);
        if (p * c - 1 <= seuil) continue;
        gains.push(gainDe(c, camp === 3 ? r.three === 1 : r.three === 0));
      }
      if (gains.length < 20) continue;
      const roi = gains.reduce((s, g) => s + g, 0) / gains.length;
      const [lo, hi] = ic95Bootstrap(gains);
      console.log(
        `      ${String(seuil).padEnd(5)} | ${camp} sets | ${(quand === "cl" ? "clôture" : "ouverture").padEnd(9)} | ` +
        `${String(gains.length).padStart(5)} | ${pctSigne(roi).padStart(7)}      | [${pctSigne(lo)} ; ${pctSigne(hi)}]`,
      );
    }
  }
}

// CLV : le prix pris à l'ouverture bat-il la clôture ? (couche 5, cf. §8.2)
const clv = [];
for (const r of jugeables) {
  const ouv = meilleur(r, "ouv", 3), cl = meilleur(r, "cl", 3);
  if (ouv && cl) clv.push(ouv / cl - 1);
}
if (clv.length) {
  const moy = clv.reduce((s, x) => s + x, 0) / clv.length;
  const [lo, hi] = ic95Bootstrap(clv);
  console.log(`\n   c) CLV sur « 3 sets » (ouverture vs clôture, ${clv.length} matchs) : ${pctSigne(moy)} [${pctSigne(lo)} ; ${pctSigne(hi)}]`);
  console.log("      Positif = les cotes de 3 sets se resserrent après l'ouverture (parier tôt paie).");
}

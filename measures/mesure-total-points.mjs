// measures/mesure-total-points.mjs
// ÉTUDE DU MARCHÉ « TOTAL DE POINTS » — les 3 étapes d'un coup.
//
//   node measures/mesure-total-points.mjs
//
// PRÉREQUIS : `node tools/flashscore/backfill-sets.mjs` (le marché des points
// vient de la même collecte que celui des sets).
//
// POURQUOI ce marché après l'échec des sets (§10.2) : sa marge est deux fois
// plus faible (10,8 % contre 17-18 % en direct et 29,8 % en archives). Le
// péage étant le facteur qui a tué le marché des sets, c'est la seule variable
// qui vaille d'être retentée.
//
// LE PARI EST « Plus / Moins de N points dans le match », N ≈ 73,5. Notre
// résultat est connu sans rien collecter : le score set par set est déjà dans
// data/ — total = somme de tous les points marqués par les deux camps.
//
// COMMENT ON PRÉDIT. Le total est fortement BIMODAL : un match en 2 sets et un
// match en 3 sets ne vivent pas dans la même plage. On ne modélise donc pas une
// moyenne, on compose :
//     P(total > N) = p3 × P(total > N | 3 sets) + (1 − p3) × P(total > N | 2 sets)
// où p3 vient du modèle D de §10.1 (Elo + rang + niveau + discipline) et où les
// deux lois conditionnelles sont EMPIRIQUES, estimées sur les seuls matchs
// antérieurs (par discipline : un simple dames ne marque pas comme un double
// hommes). Aucune hypothèse de normalité — la loi est trop irrégulière.
//
// SI CE DÉCOUPAGE EST BON, il dit aussi quelque chose d'utile : le marché des
// points est en grande partie un habillage du marché des sets. Le vérifier est
// l'étape 1 de cette étude.

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
  .split("=")[1]?.split(",").map(Number) ?? [0, 0.03, 0.05];

const DISCIPLINES = ["MS", "WS", "MD", "WD", "XD"];
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pctSigne = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;
const lg = (x) => Math.log10(Math.max(1, x));

// --- 1. Matchs BWF : total de points, Elo et rang d'avant match --------------

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
    // Un set incomplet (abandon en cours de match) fausserait le total : on
    // exige des scores plausibles (un set se gagne à 21, jusqu'à 30 au maximum).
    const sets = match.score.map((s) => ({ home: Number(s.home), away: Number(s.away) }));
    if (sets.some((s) => !Number.isFinite(s.home) || !Number.isFinite(s.away))) return;
    const gagnant = sets.every((s) => Math.max(s.home, s.away) >= 21 && Math.max(s.home, s.away) <= 30);
    if (!gagnant) return;
    const jour = String(match.matchTime).slice(0, 10);
    rows.push({
      cle: `${tmtId}|${disc}|${jour}|${a.key}|${b.key}`,
      tmtId, disc, jour, mois: jour.slice(0, 7),
      gap: Math.abs(a.entity.rating - b.entity.rating),
      rangA: rangDe(match.matchTime, disc, a.key)?.rank ?? null,
      rangB: rangDe(match.matchTime, disc, b.key)?.rank ?? null,
      three: wentThreeSets(match.score) ? 1 : 0,
      total: sets.reduce((s, x) => s + x.home + x.away, 0),
      name1: match.team1.players.map((p) => p.nameDisplay).join(" / "),
      name2: match.team2.players.map((p) => p.nameDisplay).join(" / "),
      sets, a: a.key, b: b.key,
    });
  },
});
rows.sort((x, y) => (x.jour < y.jour ? -1 : 1));

const moy = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const ecartType = (xs) => { const m = moy(xs); return Math.sqrt(moy(xs.map((x) => (x - m) ** 2))); };

console.log("ÉTUDE DU MARCHÉ « TOTAL DE POINTS »\n");
console.log("ÉTAPE 1 — de quoi dépend le total, et est-ce autre chose que le marché des sets ?");
console.log(`   ${rows.length} matchs | total moyen ${moy(rows.map((r) => r.total)).toFixed(1)} points (écart-type ${ecartType(rows.map((r) => r.total)).toFixed(1)})`);

const en2 = rows.filter((r) => !r.three), en3 = rows.filter((r) => r.three);
console.log(`   en 2 sets : ${en2.length} matchs, ${moy(en2.map((r) => r.total)).toFixed(1)} pts (±${ecartType(en2.map((r) => r.total)).toFixed(1)})`);
console.log(`   en 3 sets : ${en3.length} matchs, ${moy(en3.map((r) => r.total)).toFixed(1)} pts (±${ecartType(en3.map((r) => r.total)).toFixed(1)})`);
const chevauchement = en2.filter((r) => r.total > Math.min(...en3.map((x) => x.total))).length;
console.log(`   Recouvrement des deux lois : ${chevauchement} matchs en 2 sets dépassent le plus petit total en 3 sets`);

console.log("\n   Total moyen par discipline");
for (const d of DISCIPLINES) {
  const bloc = rows.filter((r) => r.disc === d);
  if (!bloc.length) continue;
  console.log(`      ${d}  ${String(bloc.length).padStart(5)} matchs  ${moy(bloc.map((r) => r.total)).toFixed(1)} pts  (2 sets : ${moy(bloc.filter((r) => !r.three).map((r) => r.total)).toFixed(1)} | 3 sets : ${moy(bloc.filter((r) => r.three).map((r) => r.total)).toFixed(1)})`);
}

// --- 2. Notre P(total > N), composée ----------------------------------------

const DUMMIES = DISCIPLINES.slice(1);
const encode = (r) => [
  r.gap / 100,
  Math.abs(lg(r.rangA) - lg(r.rangB)),
  lg(Math.min(r.rangA, r.rangB)),
  ...DUMMIES.map((d) => (r.disc === d ? 1 : 0)),
];
const utilisables = rows.filter((r) => r.rangA && r.rangB);

// Modèle de p3, réajusté chaque mois sur le passé strict (comme §10.2).
const modeles = new Map();
for (const mois of [...new Set(utilisables.map((r) => r.mois))].sort()) {
  const passe = utilisables.filter((r) => r.mois < mois);
  if (passe.length < 1500) continue;
  modeles.set(mois, fitLogistic(passe.map(encode), passe.map((r) => r.three), { epochs: 3000 }));
}
const p3De = (r) => {
  const m = modeles.get(r.mois);
  return m && r.rangA && r.rangB ? predictLogistic(m, encode(r)) : null;
};

/**
 * Lois EMPIRIQUES du total, conditionnelles au nombre de sets et à la
 * discipline, estimées sur les lignes fournies (donc le passé strict).
 * Repli sur toutes disciplines confondues quand la case est trop maigre.
 */
function loisDuTotal(passe) {
  const par = new Map();
  for (const r of passe) {
    const k = `${r.disc}|${r.three}`;
    (par.get(k) ?? par.set(k, []).get(k)).push(r.total);
  }
  const global = { 0: passe.filter((r) => !r.three).map((r) => r.total), 1: passe.filter((r) => r.three).map((r) => r.total) };
  for (const v of Object.values(global)) v.sort((a, b) => a - b);
  for (const v of par.values()) v.sort((a, b) => a - b);
  // P(total > N) : proportion d'observations strictement au-dessus.
  const survie = (echantillon, N) => {
    let lo = 0, hi = echantillon.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (echantillon[mid] <= N) lo = mid + 1; else hi = mid; }
    return (echantillon.length - lo) / echantillon.length;
  };
  return (disc, three, N) => {
    const e = par.get(`${disc}|${three}`);
    return survie(e && e.length >= 200 ? e : global[three], N);
  };
}

// --- 3. Jointure vers les cotes de points ------------------------------------

const fsFiles = await loadFlashscoreOdds(join(ROOT, "data", "flashscore", "odds"));
const { joined } = joinFlashscore(fsFiles, rows.map((r) => ({
  tmtId: r.tmtId, disc: r.disc, day: r.jour, name1: r.name1, name2: r.name2, sets: r.sets, a: r.a, b: r.b,
})));

const SETS_DIR = join(ROOT, "data", "flashscore", "sets");
const parFsId = new Map();
const fichiers = (await readdir(SETS_DIR)).filter((f) => f.endsWith(".json"));
for (const f of fichiers) {
  const j = JSON.parse(await readFile(join(SETS_DIR, f), "utf8"));
  for (const m of j.matches || []) if (m.points) parFsId.set(m.fsId, m.points);
}

/** Lignes over/under complètes d'un opérateur : [{N, over, under, marge}]. */
function lignesDe(points, quand) {
  const parTotal = new Map();
  for (const l of points || []) {
    if (!Number.isFinite(l.total)) continue;
    const c = l[quand];
    if (!Number.isFinite(c) || c <= 1) continue;
    const e = parTotal.get(l.total) || {};
    e[l.selection] = c;
    parTotal.set(l.total, e);
  }
  const out = [];
  for (const [N, e] of parTotal) {
    if (e.OVER > 1 && e.UNDER > 1) out.push({ N, over: e.OVER, under: e.UNDER, marge: 1 / e.OVER + 1 / e.UNDER - 1 });
  }
  return out;
}

// Un pari = un match × une ligne. Le modèle est réajusté par mois, les lois du
// total aussi (elles bougent peu, mais la marche avant l'exige).
const loisParMois = new Map();
for (const mois of [...new Set(rows.map((r) => r.mois))].sort()) {
  const passe = rows.filter((r) => r.mois < mois);
  if (passe.length >= 1500) loisParMois.set(mois, loisDuTotal(passe));
}

const paris = [];
for (const r of rows) {
  const j = joined.get(r.cle);
  const pts = j?.fsId ? parFsId.get(j.fsId) : null;
  const p3 = p3De(r);
  const lois = loisParMois.get(r.mois);
  if (!pts || p3 == null || !lois) continue;
  for (const [op, lignes] of Object.entries(pts)) {
    for (const quand of ["closing", "opening"]) {
      for (const l of lignesDe(lignes, quand)) {
        const nous = p3 * lois(r.disc, 1, l.N) + (1 - p3) * lois(r.disc, 0, l.N);
        const marche = (1 / l.over) / (1 / l.over + 1 / l.under); // dé-vig proportionnel
        paris.push({ ...r, op, quand, N: l.N, over: l.over, under: l.under, marge: l.marge, nous, marche, gagneOver: r.total > l.N });
      }
    }
  }
}

const clotures = paris.filter((p) => p.quand === "closing");
console.log(`\n   ${fichiers.length} tournois collectés | ${new Set(clotures.map((p) => p.cle)).size} matchs joints | ${clotures.length} lignes de pari (clôture)`);
if (clotures.length < 200) { console.log("   Trop peu de lignes pour conclure."); process.exit(0); }

// --- 4. ÉTAPE 2 : le marché sait-il déjà ? -----------------------------------

const logLoss = (ps, ys) => -ps.reduce((s, p, i) => {
  const q = Math.min(1 - 1e-15, Math.max(1e-15, p));
  return s + (ys[i] ? Math.log(q) : Math.log(1 - q));
}, 0) / ps.length;

const ys = clotures.map((p) => (p.gagneOver ? 1 : 0));
const tauxOver = moy(ys);
console.log("\nÉTAPE 2 — qui prédit le mieux le franchissement de la ligne ?");
console.log(`   ${clotures.length} lignes | « plus de N » réalisé ${pct(tauxOver)} du temps | marge moyenne ${pct(moy(clotures.map((p) => p.marge)))}`);
console.log(`   log loss taux constant : ${logLoss(clotures.map(() => tauxOver), ys).toFixed(4)}`);
console.log(`   log loss NOTRE modèle  : ${logLoss(clotures.map((p) => p.nous), ys).toFixed(4)}`);
console.log(`   log loss MARCHÉ        : ${logLoss(clotures.map((p) => p.marche), ys).toFixed(4)}`);

console.log("\n   Calibration comparée par tranche de proba marché");
const tr = [0, 0.35, 0.45, 0.55, 0.65, 1];
for (let i = 0; i < tr.length - 1; i++) {
  const bloc = clotures.filter((p) => p.marche >= tr[i] && p.marche < tr[i + 1]);
  if (bloc.length < 40) continue;
  console.log(`      ${pct(tr[i]).padStart(6)}-${pct(tr[i + 1]).padStart(6)} | ${String(bloc.length).padStart(5)} | marché ${pct(moy(bloc.map((p) => p.marche)))} | nous ${pct(moy(bloc.map((p) => p.nous)))} | observé ${pct(moy(bloc.map((p) => (p.gagneOver ? 1 : 0))))}`);
}

// --- 5. ÉTAPE 3 : rentabilité ------------------------------------------------

/**
 * IC bootstrap PAR GRAPPE (un match = une grappe), graine 42.
 * Indispensable ici : un même match porte ~2 lignes de pari dont les résultats
 * sont fortement corrélés (même total). Tirer les LIGNES au hasard ferait
 * croire à deux fois plus d'observations indépendantes qu'il n'y en a, et
 * l'intervalle serait faussement étroit.
 * @param {Array<{cle: string, gain: number}>} obs
 */
function ic95ParMatch(obs, tirages = 2000) {
  if (!obs.length) return [0, 0];
  const grappes = new Map();
  for (const o of obs) (grappes.get(o.cle) ?? grappes.set(o.cle, []).get(o.cle)).push(o.gain);
  const liste = [...grappes.values()];
  let graine = 42;
  const alea = () => ((graine = (graine * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const ms = [];
  for (let t = 0; t < tirages; t++) {
    let somme = 0, n = 0;
    for (let i = 0; i < liste.length; i++) {
      const g = liste[Math.floor(alea() * liste.length)];
      for (const x of g) { somme += x; n++; }
    }
    ms.push(somme / n);
  }
  ms.sort((a, b) => a - b);
  return [ms[Math.floor(tirages * 0.025)], ms[Math.floor(tirages * 0.975)]];
}

console.log("\nÉTAPE 3 — rentabilité (mise de 1 € par ligne)");
console.log("\n   a) Stratégies aveugles (elles mesurent la marge)");
for (const [nom, cote, gagne] of [
  ["tout sur PLUS", (p) => p.over, (p) => p.gagneOver],
  ["tout sur MOINS", (p) => p.under, (p) => !p.gagneOver],
]) {
  const obs = clotures.map((p) => ({ cle: p.cle, gain: gagne(p) ? cote(p) - 1 : -1 }));
  const [lo, hi] = ic95ParMatch(obs);
  console.log(`      ${nom.padEnd(15)} ${String(obs.length).padStart(5)} paris | ROI ${pctSigne(moy(obs.map((o) => o.gain))).padStart(7)} [${pctSigne(lo)} ; ${pctSigne(hi)}]`);
}

console.log("\n   b) Paris sélectifs selon notre modèle");
console.log("      seuil | côté  | quand     |     n | ROI          | IC 95 %");
for (const seuil of SEUILS) {
  for (const cote of ["PLUS", "MOINS"]) {
    for (const quand of ["closing", "opening"]) {
      const obs = [];
      for (const p of paris.filter((x) => x.quand === quand)) {
        const c = cote === "PLUS" ? p.over : p.under;
        const proba = cote === "PLUS" ? p.nous : 1 - p.nous;
        if (proba * c - 1 <= seuil) continue;
        obs.push({ cle: p.cle, gain: (cote === "PLUS" ? p.gagneOver : !p.gagneOver) ? c - 1 : -1 });
      }
      if (obs.length < 20) continue;
      const [lo, hi] = ic95ParMatch(obs);
      console.log(`      ${String(seuil).padEnd(5)} | ${cote.padEnd(5)} | ${(quand === "closing" ? "clôture" : "ouverture").padEnd(9)} | ${String(obs.length).padStart(5)} | ${pctSigne(moy(obs.map((o) => o.gain))).padStart(7)}      | [${pctSigne(lo)} ; ${pctSigne(hi)}]`);
    }
  }
}

// --- 6. LE test qui tranche : le biais tient-il d'une année sur l'autre ? -----
//
// Un « plus de N » qui se réalise plus souvent que le prix ne le dit peut
// n'être que la chance d'un échantillon. S'il est réel, il doit se retrouver
// dans CHAQUE saison — c'est le critère de persistance appliqué à l'effet
// gymnase (§7) et à tout le reste du journal.

console.log("\n   c) Persistance du biais « plus de N » par année");
console.log("      année |     n | prix moyen | réalisé | écart   | ROI tout-sur-PLUS");
for (const an of [...new Set(clotures.map((p) => p.jour.slice(0, 4)))].sort()) {
  const bloc = clotures.filter((p) => p.jour.startsWith(an));
  if (bloc.length < 100) continue;
  const prix = moy(bloc.map((p) => p.marche));
  const reel = moy(bloc.map((p) => (p.gagneOver ? 1 : 0)));
  const obs = bloc.map((p) => ({ cle: p.cle, gain: p.gagneOver ? p.over - 1 : -1 }));
  const [lo, hi] = ic95ParMatch(obs);
  console.log(`      ${an}  | ${String(bloc.length).padStart(5)} |   ${pct(prix)}   | ${pct(reel)}  | ${pctSigne(reel - prix).padStart(6)}  | ${pctSigne(moy(obs.map((o) => o.gain))).padStart(7)} [${pctSigne(lo)} ; ${pctSigne(hi)}]`);
}

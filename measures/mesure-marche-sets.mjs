// measures/mesure-marche-sets.mjs
// ÉTUDE DU MARCHÉ « NOMBRE DE SETS » — étape 1 : que peut-on PRÉDIRE ?
//
//   node measures/mesure-marche-sets.mjs
//   node measures/mesure-marche-sets.mjs --annees=2025,2026   # années de test
//
// Le marché « vainqueur » est prouvé perdant pour nous (journal §8.4 : value
// −14,5 %). Le pari du lot C n°1 est qu'un marché MOINS travaillé par les
// bookmakers — « le match ira-t-il en 3 sets ? » — laisse davantage de place,
// d'autant que la mesure gymnase (§7) y a déjà trouvé un effet réel et
// persistant (r = 0,42) qu'aucun modèle de bookmaker n'a de raison de coter.
//
// Cette étape ne regarde AUCUNE cote : elle établit ce qu'on sait prédire, et
// avec quelle qualité, avant de le confronter à un prix (étapes 2 et 3).
//
// MÉTHODE.
// 1. Un match = une ligne, avec son écart d'Elo AVANT match (crochet onMatch
//    de computeElo : mêmes garanties anti-fuite que le backtest), sa
//    discipline, son lieu, et la cible `three` (3 sets ou non).
//    Walkovers et matchs sans score écartés.
// 2. Descriptif : taux de 3 sets global, par discipline, par tranche d'écart
//    d'Elo. C'est le fait de base — un match serré va plus souvent en 3 sets.
// 3. Modèle : régression logistique sur |ΔElo| + discipline, ajustée en
//    MARCHE AVANT (entraînée sur les années strictement antérieures à l'année
//    jugée). Deux variantes pour isoler l'apport du lieu :
//      A. écart d'Elo + discipline
//      B. A + résidu du gymnase (écart historique du lieu à son attendu,
//         calculé sur les années antérieures UNIQUEMENT — sinon on lit la
//         réponse dans l'énoncé).
// 4. Jugement hors échantillon : log loss vs deux références (le taux constant,
//    et le taux par case discipline × tranche d'Elo), plus une table de
//    calibration par décile — un modèle mal calibré ne sert à rien pour parier,
//    puisque tout repose sur la comparaison proba × cote.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover, wentThreeSets } from "../lib/dataset.mjs";
import { fitLogistic, predictLogistic } from "../lib/logistic.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ANNEES_TEST = (args.find((a) => a.startsWith("--annees=")) || "")
  .split("=")[1]?.split(",").map(Number).filter(Boolean) ?? null;

const DISCIPLINES = ["MS", "WS", "MD", "WD", "XD"];
const pct = (x) => `${(x * 100).toFixed(1)} %`;

// --- 1. Collecte -------------------------------------------------------------

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();

// Lieu normalisé, même règle que measures/mesure-gymnase-3sets.mjs (les
// éditions successives d'un tournoi doivent se regrouper sur un même gymnase).
const norm = (s) =>
  String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\bcity\b/g, "").replace(/[,\s]+/g, " ").trim();
const lieux = new Map();
for (const y of years) {
  try {
    const t = JSON.parse(await readFile(join(ROOT, "data", String(y), "tournaments.json"), "utf8"));
    for (const m of (Array.isArray(t) ? t : t.results ?? []))
      for (const tt of m.tournaments ?? [])
        lieux.set(Number(tt.id), norm(tt.location || tt.country || `t${tt.id}`));
  } catch { /* année sans calendrier lisible : les matchs garderont `t<id>` */ }
}

const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || match.score.length < 2) return;
    rows.push({
      year: Number(String(match.matchTime).slice(0, 4)),
      disc,
      venue: lieux.get(Number(tmtId)) ?? `t${tmtId}`,
      gap: Math.abs(a.entity.rating - b.entity.rating),
      three: wentThreeSets(match.score) ? 1 : 0,
    });
  },
});
rows.sort((x, y) => x.year - y.year);

const tauxGlobal = rows.reduce((s, r) => s + r.three, 0) / rows.length;
console.log(`ÉTUDE DU MARCHÉ « NOMBRE DE SETS » — étape 1`);
console.log(`${rows.length} matchs joués (${years.join(", ")}) | taux global de 3 sets : ${pct(tauxGlobal)}\n`);

// --- 2. Descriptif -----------------------------------------------------------

const agg = (liste, cle) => {
  const m = new Map();
  for (const r of liste) {
    const k = cle(r);
    const s = m.get(k) || { n: 0, k: 0 };
    s.n++; s.k += r.three; m.set(k, s);
  }
  return m;
};
// Intervalle de Wald à 95 % : suffisant ici, les effectifs se comptent en milliers.
const ic95 = (k, n) => 1.96 * Math.sqrt((k / n) * (1 - k / n) / n);

// Le taux de base dérive-t-il d'une année à l'autre ? S'il bouge, un modèle
// entraîné sur le passé part avec un handicap qui ne dit rien de sa qualité —
// et un pari « 3 sets » systématique n'a pas le même prix de revient selon
// l'année. À vérifier AVANT de juger les modèles.
console.log("Taux de 3 sets par année");
const parAn = agg(rows, (r) => r.year);
for (const an of [...parAn.keys()].sort()) {
  const s = parAn.get(an);
  console.log(`   ${an}  ${String(s.n).padStart(5)} matchs   ${pct(s.k / s.n).padStart(7)}  ± ${(ic95(s.k, s.n) * 100).toFixed(1)} pt`);
}

console.log("\nTaux de 3 sets par discipline");
const parDisc = agg(rows, (r) => r.disc);
for (const d of DISCIPLINES) {
  const s = parDisc.get(d); if (!s) continue;
  console.log(`   ${d}  ${String(s.n).padStart(5)} matchs   ${pct(s.k / s.n).padStart(7)}  ± ${(ic95(s.k, s.n) * 100).toFixed(1)} pt`);
}

const BANDES = [0, 50, 100, 150, 200, 300, 400];
const bandeDe = (gap) => {
  let i = 0;
  while (i + 1 < BANDES.length && gap >= BANDES[i + 1]) i++;
  return i;
};
const nomBande = (i) => (i === BANDES.length - 1 ? `${BANDES[i]}+` : `${BANDES[i]}-${BANDES[i + 1]}`);

console.log("\nTaux de 3 sets par écart d'Elo avant match (le facteur évident)");
const parBande = agg(rows, (r) => bandeDe(r.gap));
for (let i = 0; i < BANDES.length; i++) {
  const s = parBande.get(i); if (!s) continue;
  console.log(`   ΔElo ${nomBande(i).padEnd(8)} ${String(s.n).padStart(5)} matchs   ${pct(s.k / s.n).padStart(7)}  ± ${(ic95(s.k, s.n) * 100).toFixed(1)} pt`);
}

// --- 3. Modèles, en marche avant --------------------------------------------

const encode = (r, residuLieu) => [
  r.gap / 100, // en centaines de points d'Elo, pour un coefficient lisible
  ...DISCIPLINES.slice(1).map((d) => (r.disc === d ? 1 : 0)), // MS = référence
  residuLieu,
];
const CLES = ["ΔElo/100", ...DISCIPLINES.slice(1).map((d) => `disc=${d}`), "résidu lieu"];

/** Taux par case (discipline × tranche d'Elo) estimé sur les lignes fournies. */
function tauxParCase(liste) {
  const m = agg(liste, (r) => `${r.disc}|${bandeDe(r.gap)}`);
  const global = liste.reduce((s, r) => s + r.three, 0) / liste.length;
  return (r) => {
    const s = m.get(`${r.disc}|${bandeDe(r.gap)}`);
    return s && s.n >= 30 ? s.k / s.n : global; // case trop maigre : on retombe sur le global
  };
}

/**
 * Résidu d'un gymnase : écart moyen entre les 3 sets observés et l'attendu de
 * la case, sur les lignes fournies (donc uniquement le PASSÉ à l'usage).
 * Amorti par un pseudo-effectif de 50 matchs : un gymnase vu 12 fois ne doit
 * pas peser autant qu'un gymnase vu 400 fois.
 */
function residusParLieu(liste) {
  const attendu = tauxParCase(liste);
  const m = new Map();
  for (const r of liste) {
    const s = m.get(r.venue) || { n: 0, ecart: 0 };
    s.n++; s.ecart += r.three - attendu(r); m.set(r.venue, s);
  }
  const out = new Map();
  for (const [v, s] of m) out.set(v, s.ecart / (s.n + 50));
  return (r) => out.get(r.venue) ?? 0;
}

const logLoss = (ps, ys) => -ps.reduce((s, p, i) => {
  const q = Math.min(1 - 1e-15, Math.max(1e-15, p));
  return s + (ys[i] ? Math.log(q) : Math.log(1 - q));
}, 0) / ps.length;

const anneesDispo = [...new Set(rows.map((r) => r.year))].sort();
const anneesTest = (ANNEES_TEST ?? anneesDispo.slice(1)).filter((y) => anneesDispo.includes(y));

console.log(`\nJugement HORS ÉCHANTILLON (entraînement sur les années strictement antérieures)`);
console.log("année |     n | log loss : constante | case disc×ΔElo | modèle A | modèle B");

const toutesPreds = [];
for (const an of anneesTest) {
  const passe = rows.filter((r) => r.year < an);
  const test = rows.filter((r) => r.year === an);
  if (passe.length < 500 || !test.length) continue;

  const constante = passe.reduce((s, r) => s + r.three, 0) / passe.length;
  const parCase = tauxParCase(passe);
  const residu = residusParLieu(passe);

  const XA = passe.map((r) => encode(r, 0));
  const XB = passe.map((r) => encode(r, residu(r)));
  const y = passe.map((r) => r.three);
  const mA = fitLogistic(XA, y, { keys: CLES, epochs: 4000 });
  const mB = fitLogistic(XB, y, { keys: CLES, epochs: 4000 });

  const ys = test.map((r) => r.three);
  const pConst = test.map(() => constante);
  const pCase = test.map((r) => parCase(r));
  const pA = test.map((r) => predictLogistic(mA, encode(r, 0)));
  const pB = test.map((r) => predictLogistic(mB, encode(r, residu(r))));

  console.log(
    `${an}  | ${String(test.length).padStart(5)} |` +
    `        ${logLoss(pConst, ys).toFixed(4)}      |` +
    `     ${logLoss(pCase, ys).toFixed(4)}     |` +
    `  ${logLoss(pA, ys).toFixed(4)}  |  ${logLoss(pB, ys).toFixed(4)}`,
  );
  test.forEach((r, i) => toutesPreds.push({ ...r, pA: pA[i], pB: pB[i] }));

  if (an === anneesTest.at(-1)) {
    console.log("\n   Coefficients du modèle B (log-cote, variables centrées-réduites) :");
    mB.keys.forEach((k, j) => console.log(`      ${k.padEnd(12)} ${mB.weights[j] >= 0 ? "+" : ""}${mB.weights[j].toFixed(3)}`));
  }
}

// --- 4. Calibration hors échantillon ----------------------------------------

if (toutesPreds.length) {
  console.log("\nCalibration hors échantillon du modèle B (un pari ne vaut que si `p` est juste)");
  const tri = [...toutesPreds].sort((a, b) => a.pB - b.pB);
  const taille = Math.ceil(tri.length / 10);
  console.log("   décile |     n | prédit | observé | écart");
  let ecartAbs = 0;
  for (let i = 0; i < 10; i++) {
    const bloc = tri.slice(i * taille, (i + 1) * taille);
    if (!bloc.length) continue;
    const p = bloc.reduce((s, r) => s + r.pB, 0) / bloc.length;
    const o = bloc.reduce((s, r) => s + r.three, 0) / bloc.length;
    ecartAbs += Math.abs(p - o) * bloc.length;
    console.log(`      ${String(i + 1).padStart(2)}   | ${String(bloc.length).padStart(5)} | ${pct(p).padStart(6)} | ${pct(o).padStart(6)}  | ${((o - p) * 100 >= 0 ? "+" : "")}${((o - p) * 100).toFixed(1)} pt`);
  }
  console.log(`   Erreur de calibration moyenne : ${(ecartAbs / toutesPreds.length * 100).toFixed(2)} pt`);
  const etendue = Math.max(...toutesPreds.map((r) => r.pB)) - Math.min(...toutesPreds.map((r) => r.pB));
  console.log(`   Étendue des probas prédites : ${(etendue * 100).toFixed(1)} pt — c'est elle qui borne ce qu'on pourra détecter comme mal coté.`);
}

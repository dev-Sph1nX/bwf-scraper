// measures/variante-forme.mjs
// FENÊTRE DE FORME — la forme récente prédit-elle quelque chose, et à quelle
// fenêtre ? Étapes 1 (isolation), 2 (apport marginal) et 3 (hors échantillon).
//
// POURQUOI REMESURER. §2.1 a écarté la forme sur un criblage à niveau contrôlé
// (48,7 % / 50,4 % / 51,4 %) et §2.2-2.3 l'a confirmée non départageable. Mais
// ces mesures ont toutes été faites à `formWindow = 5`, la valeur choisie à la
// main au démarrage du projet et jamais évaluée — exactement ce que §2.9 pointe
// comme le levier restant. La question rouverte ici n'est donc pas « la forme
// sert-elle ? » (répondu : non, sur 5 matchs) mais « la fenêtre 5 était-elle le
// bon réglage ? ».
//
// LE PIÈGE, ET POURQUOI L'ÉTAPE 1 EST OBLIGATOIRE. La forme est la somme des
// deltas d'Elo des N derniers matchs. Pour une entité dont la note n'a pas
// encore rattrapé son niveau réel, cette somme est mécaniquement positive ET
// l'entité va continuer à gagner : la forme devient alors un PROXY du retard de
// note, pas une information sur la forme. Une régression le voit comme un signal
// significatif (§2.2 : poids 0,136, IC [0,09 ; 0,19]) alors que le criblage à
// niveau contrôlé le donne sous le hasard. D'où le protocole en deux tests, et
// d'où le contrôle par MATURITÉ ajouté ici : si le signal ne survit qu'aux
// entités jeunes, ce n'est pas de la forme, c'est le défaut de seed — corrigé
// depuis par pairSeedFromPlayers (journal §11), et à ne pas payer deux fois.
//
// PROTOCOLE
//   étape 1 : à écart d'Elo contrôlé (< 30, < 50, < 80), le camp le mieux en
//             forme gagne-t-il plus de 50 % ? Trois fenêtres de forme, IC
//             binomial. Puis le même test restreint aux entités mûres.
//   étapes 2-3 : terme b × écart de forme ajouté au LOGIT de la probabilité de
//             production (motif variante-age.mjs), b ajusté sur les années
//             < 2025, fenêtre choisie sur la validation 2025, jugement sur le
//             test 2026 jamais regardé par le choix.
//
// Usage : node measures/variante-forme.mjs

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank, PARAMS } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { eloProb, isProvisional } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { makeRng } from "../lib/metrics.mjs";

const SEED = 42;
const DRAWS = 2000;
const FENETRES = [5, 10, 15, 20];
const ECARTS = [30, 50, 80];
const MAX_HIST = Math.max(...FENETRES);

const years = await store.listYears();
const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}

// Une seule passe Elo : le crochet livre l'état d'AVANT match, dont l'historique
// des deltas dans lequel toutes les fenêtres se lisent.
const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ disc, match, won, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (isProvisional(a.entity.matches) || isProvisional(b.entity.matches)) return;
    const deltas = (e) => (e.history || []).slice(-MAX_HIST).map((h) => h.d || 0);
    rows.push({
      disc,
      year: Number(String(match.matchTime).slice(0, 4)),
      eloA: a.entity.rating, eloB: b.entity.rating,
      nA: a.entity.matches, nB: b.entity.matches,
      hA: deltas(a.entity), hB: deltas(b.entity),
      won,
    });
  },
});
console.log(`Lignes pronostiquables : ${rows.length} (fenêtre de forme de production : ${PARAMS.formWindow})`);

const forme = (h, w) => h.slice(-w).reduce((s, d) => s + d, 0);

// ==============================================================================
// ÉTAPE 1 — isolation à niveau contrôlé (protocole §2.1)
// ==============================================================================
function isolation(sel, w, lim) {
  let n = 0, gagnes = 0;
  for (const r of rows) {
    if (!sel(r) || Math.abs(r.eloA - r.eloB) >= lim) continue;
    const fA = forme(r.hA, w), fB = forme(r.hB, w);
    if (fA === fB) continue;
    const mieux = fA > fB ? 1 : 2;
    n++;
    if ((mieux === 1 && r.won === 1) || (mieux === 2 && r.won === 0)) gagnes++;
  }
  if (n < 100) return null;
  const p = gagnes / n, se = Math.sqrt((p * (1 - p)) / n);
  return { p, lo: p - 1.96 * se, hi: p + 1.96 * se, n };
}

const verdict1 = (x) => (!x ? "(n<100)" : x.lo > 0.5 ? "✅" : x.hi < 0.5 ? "❌" : " ~");
const fmt1 = (x) =>
  !x ? "     (n<100)     " : `${(x.p * 100).toFixed(1)}% [${(x.lo * 100).toFixed(1)}-${(x.hi * 100).toFixed(1)}] ${verdict1(x)} n=${String(x.n).padStart(4)}`;

console.log("\n=== ÉTAPE 1 : à écart d'Elo contrôlé, le camp le mieux en forme gagne-t-il ? ===");
console.log("50 % = aucune information exploitable. Protocole §2.1.\n");
console.log("fenêtre |        < 30        |        < 50        |        < 80");
for (const w of FENETRES) {
  const cells = ECARTS.map((lim) => fmt1(isolation(() => true, w, lim)));
  console.log(`  ${String(w).padStart(2)}    | ${cells.join(" | ")}`);
}

console.log("\n--- Contrôle de MATURITÉ : le signal survit-il sans les entités jeunes ? ---");
console.log("Si le signal ne vit que chez les jeunes, c'est le retard de note (§11), pas la forme.\n");
const MATURITES = [
  ["tous", () => true],
  ["les 2 ≥ 40 matchs", (r) => r.nA >= 40 && r.nB >= 40],
  ["les 2 ≥ 80 matchs", (r) => r.nA >= 80 && r.nB >= 80],
];
for (const w of [15]) {
  for (const [lbl, sel] of MATURITES) {
    const cells = ECARTS.map((lim) => fmt1(isolation(sel, w, lim)));
    console.log(`forme@${w} ${lbl.padEnd(18)} | ${cells.join(" | ")}`);
  }
}

// ==============================================================================
// ÉTAPES 2-3 — terme ajouté au logit de la proba de production
// ==============================================================================
const EPS = 1e-9;
const clamp = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const pProd = (r) => recalibrate(eloProb(r.eloA, r.eloB), r.disc);

/** Ajuste b (un scalaire) par descente de gradient sur le log loss. */
function ajusteB(data, w) {
  let b = 0;
  for (let ep = 0; ep < 2000; ep++) {
    let g = 0;
    for (const r of data) {
      const x = (forme(r.hA, w) - forme(r.hB, w)) / 50;
      const p = 1 / (1 + Math.exp(-(logit(pProd(r)) + b * x)));
      g += (p - r.won) * x;
    }
    b -= 0.5 * (g / data.length);
  }
  return b;
}
const pAvecForme = (r, w, b) => 1 / (1 + Math.exp(-(logit(pProd(r)) + b * ((forme(r.hA, w) - forme(r.hB, w)) / 50))));

const appr = rows.filter((r) => r.year < 2025);
const valid = rows.filter((r) => r.year === 2025);
const test = rows.filter((r) => r.year === 2026);
console.log(`\n=== ÉTAPES 2-3 === apprentissage ${appr.length} | validation 2025 ${valid.length} | test 2026 ${test.length}`);

const brier = (data, p) => data.reduce((s, r) => s + (p(r) - r.won) ** 2, 0) / data.length;
console.log("\nfenêtre | b ajusté (< 2025) | Brier validation 2025");
const essais = [];
for (const w of FENETRES) {
  const b = ajusteB(appr, w);
  const bv = brier(valid, (r) => pAvecForme(r, w, b));
  essais.push({ w, b, bv });
  console.log(`  ${String(w).padStart(2)}    |      ${b.toFixed(3).padStart(6)}       | ${bv.toFixed(4)}`);
}
const refVa = brier(valid, pProd);
console.log(`  réf   |         —         | ${refVa.toFixed(4)}  (production, sans forme)`);
essais.sort((a, b) => a.bv - b.bv);
const best = essais[0];
console.log(`  => fenêtre retenue en validation : ${best.w} (b = ${best.b.toFixed(3)})`);

// Réajustement sur apprentissage + validation, puis test.
const bFinal = ajusteB(appr.concat(valid), best.w);
const bRef = brier(test, pProd);
const bVar = brier(test, (r) => pAvecForme(r, best.w, bFinal));
console.log(`\nTEST 2026 — b réajusté sur < 2026 : ${bFinal.toFixed(3)}`);
console.log(`  Brier production        : ${bRef.toFixed(4)}`);
console.log(`  Brier production+forme@${best.w} : ${bVar.toFixed(4)}`);

const paires = test.map((r) => [(pProd(r) - r.won) ** 2, (pAvecForme(r, best.w, bFinal) - r.won) ** 2]);
const rng = makeRng(SEED);
const tirages = [];
for (let k = 0; k < DRAWS; k++) {
  let sa = 0, sb = 0;
  for (let i = 0; i < paires.length; i++) {
    const [x, y] = paires[Math.floor(rng() * paires.length)];
    sa += x; sb += y;
  }
  tirages.push((sa - sb) / paires.length);
}
tirages.sort((a, b) => a - b);
const lo = tirages[Math.floor(0.025 * DRAWS)], hi = tirages[Math.floor(0.975 * DRAWS)];
const moy = tirages.reduce((a, b) => a + b, 0) / tirages.length;
const e4 = (x) => `${(x * 1e4 >= 0 ? "+" : "") + (x * 1e4).toFixed(1)} e-4`;
console.log(`  gain : ${e4(moy)}  IC95 [${e4(lo)} ; ${e4(hi)}]`);
console.log(`  verdict : ${lo > 0 ? "✅ gain démontré" : hi < 0 ? "❌ perte démontrée" : "~ non départageable"}`);

console.log("\nRAPPEL DE LECTURE : un gain à l'étape 3 ne suffit pas à retenir la forme.");
console.log("Elle doit AUSSI passer l'étape 1 sur les entités mûres — sinon le terme ne");
console.log("fait que redécouvrir le retard de note déjà corrigé par le seed (§11).");

// measures/mesure-sensibilite-gauchers.mjs
// MESURE : certains joueurs sont-ils individuellement plus (ou moins) à l'aise
// contre les GAUCHERS que leur niveau ne le prédit ?
//
//   node measures/mesure-sensibilite-gauchers.mjs
//
// Idée du propriétaire (2026-08-18). Distincte de §9.6, qui mesurait un
// avantage GLOBAL du gaucher (« un gaucher gagne-t-il plus que son Elo ne le
// dit ? » — verdict : léger, instable, non adopté). Ici la question est une
// INTERACTION INDIVIDUELLE, classique au tennis : tel joueur souffre contre
// les gauchers, tel autre non. Si cette sensibilité existe et persiste, elle
// devient un facteur de prédiction pour les affiches contre gauchers.
//
// PÉRIMÈTRE : MS et WS seulement (décision propriétaire) — couverture des
// mains 77 % / 70 %, et pas de paires de double qui brouillent l'interaction.
//
// MÉTHODE (en trois temps, on s'arrête au premier verdict négatif).
// 1. SUR-DISPERSION — le même test que l'effet gymnase (§7). Pour chaque
//    joueur, sur ses matchs CONTRE GAUCHERS : victoires observées vs attendues
//    (l'attendu = proba Elo d'avant match, crochet onMatch, anti-fuite).
//    z par joueur = (obs − attendu) / écart-type binomial. Sous « aucune
//    sensibilité individuelle », Σz² suit un χ² : l'excès se lit en σ.
//    ⚠ L'avantage GLOBAL du gaucher (§9.6) gonflerait Σz² sans être une
//    différence ENTRE joueurs : on centre donc les résidus (moyenne pondérée
//    retirée) avant le χ², qui perd 1 degré de liberté.
// 2. PERSISTANCE — la seule chose qui rende un signal pariable : la
//    sensibilité mesurée sur 2024-2025 prédit-elle celle de 2026 ?
//    Corrélation pondérée entre les deux périodes, joueurs vus des deux côtés.
// 3. SPLIT-HALF — contrôle de robustesse : corrélation entre matchs pairs et
//    impairs de chaque joueur (coupe orthogonale au temps).
//
// Si (1) ne sort pas du bruit, les joueurs ne diffèrent pas entre eux et le
// facteur est mort avant d'être construit.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DISCIPLINES = new Set(["MS", "WS"]);
const MIN_MATCHS_ELO = 10; // en dessous, la proba Elo est du bruit d'amorce (§10.1)
const pct = (x) => `${(x * 100).toFixed(1)} %`;

// --- Mains connues ------------------------------------------------------------
const fiches = JSON.parse(await readFile(join(ROOT, "data", "players", "birthdates.json"), "utf8"));
const mainDe = new Map(
  Object.entries(fiches)
    .filter(([, v]) => v.hand === "left" || v.hand === "right")
    .map(([id, v]) => [String(id), v.hand]),
);

// --- Collecte : un duel simple = deux observations (une par joueur) -----------
const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}

// La proba Elo d'avant match, même échelle que lib/elo.mjs.
const { PARAMS } = await import("../lib/elo.mjs");
const probaElo = (rA, rB) => 1 / (1 + Math.pow(10, (rB - rA) / PARAMS.scale));

const obs = []; // { joueur, nom, disc, an, contreGaucher, p, gagne }
await computeElo(await store.listYears(), seeds, {
  onMatch: ({ disc, match, won, a, b }) => {
    if (!DISCIPLINES.has(disc)) return;
    if (isWalkover(match) || !match.matchTime) return;
    if (a.players.length !== 1 || b.players.length !== 1) return;
    const [idA, idB] = [String(a.players[0].id), String(b.players[0].id)];
    if (!mainDe.has(idA) || !mainDe.has(idB)) return;
    if (a.entity.matches < MIN_MATCHS_ELO || b.entity.matches < MIN_MATCHS_ELO) return;
    const an = Number(String(match.matchTime).slice(0, 4));
    const p = probaElo(a.entity.rating, b.entity.rating);
    obs.push(
      { joueur: idA, nom: a.players[0].nameDisplay, disc, an, contreGaucher: mainDe.get(idB) === "left", p, gagne: won === 1 },
      { joueur: idB, nom: b.players[0].nameDisplay, disc, an, contreGaucher: mainDe.get(idA) === "left", p: 1 - p, gagne: won !== 1 },
    );
  },
});

const vsG = obs.filter((o) => o.contreGaucher);
console.log("SENSIBILITÉ INDIVIDUELLE AUX GAUCHERS — MS + WS, probas Elo d'avant match");
console.log(`${obs.length / 2} duels retenus (mains connues, ≥${MIN_MATCHS_ELO} matchs d'Elo chacun) | ${vsG.length} observations joueur-contre-gaucher\n`);

// --- 0. Contrôle du niveau global (le résultat §9.6, revérifié en passant) ----
const attenduG = vsG.reduce((s, o) => s + o.p, 0);
const gagneG = vsG.filter((o) => o.gagne).length;
console.log(`Contrôle global (tous joueurs confondus, face aux gauchers) :`);
console.log(`   victoires ${gagneG} / attendues ${attenduG.toFixed(0)} sur ${vsG.length} -> écart ${((gagneG - attenduG) / vsG.length * 100).toFixed(2)} pt (le « bonus gaucher » global de §9.6, au signe près)\n`);

// --- 1. Sur-dispersion entre joueurs ------------------------------------------
const MIN_VS_G = 8; // en dessous, le z individuel n'a aucun sens
const parJoueur = new Map();
for (const o of vsG) {
  const s = parJoueur.get(o.joueur) || { nom: o.nom, disc: o.disc, n: 0, obs: 0, exp: 0, v: 0, parAn: new Map(), pairs: [0, 0, 0, 0] };
  s.n++; s.obs += o.gagne ? 1 : 0; s.exp += o.p; s.v += o.p * (1 - o.p);
  const a = s.parAn.get(o.an) || { n: 0, obs: 0, exp: 0 };
  a.n++; a.obs += o.gagne ? 1 : 0; a.exp += o.p; s.parAn.set(o.an, a);
  // split-half : matchs alternés (indice de passage pair/impair)
  const moitie = s.n % 2; // le n vient d'être incrémenté : alterne 1,0,1,0…
  s.pairs[moitie * 2] += o.gagne ? 1 : 0; s.pairs[moitie * 2 + 1] += o.p;
  parJoueur.set(o.joueur, s);
}
const eligibles = [...parJoueur.values()].filter((s) => s.n >= MIN_VS_G);
console.log(`1. SUR-DISPERSION — ${eligibles.length} joueurs à ≥${MIN_VS_G} matchs contre gauchers`);

// Centre les résidus : on retire la moyenne pondérée (l'effet global, qui
// n'est pas une différence entre joueurs).
const totalObs = eligibles.reduce((s, x) => s + x.obs, 0);
const totalExp = eligibles.reduce((s, x) => s + x.exp, 0);
const totalN = eligibles.reduce((s, x) => s + x.n, 0);
const biaisGlobal = (totalObs - totalExp) / totalN;
let chi2 = 0;
const scores = eligibles.map((s) => {
  const z = (s.obs - s.exp - biaisGlobal * s.n) / Math.sqrt(s.v);
  chi2 += z * z;
  return { ...s, z, ecart: (s.obs - s.exp) / s.n };
}).sort((a, b) => a.z - b.z);
const df = eligibles.length - 1; // 1 degré perdu par le centrage
const sigma = (chi2 - df) / Math.sqrt(2 * df);
console.log(`   Σz² = ${chi2.toFixed(1)} pour ${df} ddl -> sur-dispersion ${sigma.toFixed(2)} σ`);
console.log(`   (référence : l'effet gymnase §7 sortait à ~6 σ ; < 2 σ = indiscernable du hasard)\n`);

console.log("   Les 5 plus « anti-gauchers » et les 5 plus « à l'aise » (écart victoires−attendu par match) :");
for (const s of [...scores.slice(0, 5), ...scores.slice(-5)]) {
  console.log(`      ${s.nom.padEnd(28)} ${s.disc}  ${String(s.n).padStart(3)} matchs vs G   ${(s.ecart >= 0 ? "+" : "")}${(s.ecart * 100).toFixed(1)} pt   z=${s.z.toFixed(2)}`);
}

// --- 2. Persistance 2024-2025 -> 2026 ------------------------------------------
console.log("\n2. PERSISTANCE — la sensibilité d'hier prédit-elle celle de 2026 ?");
const paires = [];
for (const s of parJoueur.values()) {
  let avant = { n: 0, obs: 0, exp: 0 }, apres = { n: 0, obs: 0, exp: 0 };
  for (const [an, a] of s.parAn) {
    const cible = an >= 2026 ? apres : avant;
    cible.n += a.n; cible.obs += a.obs; cible.exp += a.exp;
  }
  if (avant.n >= 5 && apres.n >= 3) {
    paires.push({ x: (avant.obs - avant.exp) / avant.n, y: (apres.obs - apres.exp) / apres.n, w: Math.min(avant.n, apres.n) });
  }
}
const corrPonderee = (ps) => {
  const W = ps.reduce((s, p) => s + p.w, 0);
  const mx = ps.reduce((s, p) => s + p.w * p.x, 0) / W, my = ps.reduce((s, p) => s + p.w * p.y, 0) / W;
  const cov = ps.reduce((s, p) => s + p.w * (p.x - mx) * (p.y - my), 0) / W;
  const vx = ps.reduce((s, p) => s + p.w * (p.x - mx) ** 2, 0) / W, vy = ps.reduce((s, p) => s + p.w * (p.y - my) ** 2, 0) / W;
  return cov / Math.sqrt(vx * vy);
};
if (paires.length >= 15) {
  console.log(`   ${paires.length} joueurs vus des deux côtés (≥5 matchs vs G avant 2026, ≥3 en 2026)`);
  console.log(`   corrélation pondérée avant/après : r = ${corrPonderee(paires).toFixed(3)}`);
  console.log(`   (référence gymnase : r = 0,42 ; ≈ 0 = non pariable)`);
} else {
  console.log(`   ${paires.length} joueurs seulement vus des deux côtés — pas assez pour mesurer la persistance.`);
}

// --- 3. Split-half (contrôle orthogonal au temps) ------------------------------
console.log("\n3. SPLIT-HALF — moitiés alternées des matchs de chaque joueur");
const moities = eligibles
  .map((s) => ({ x: (s.pairs[0] - s.pairs[1]) / Math.ceil(s.n / 2), y: (s.pairs[2] - s.pairs[3]) / Math.floor(s.n / 2), w: s.n }))
  .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
if (moities.length >= 15) {
  console.log(`   ${moities.length} joueurs | corrélation pondérée entre moitiés : r = ${corrPonderee(moities).toFixed(3)}`);
} else {
  console.log("   pas assez de joueurs.");
}

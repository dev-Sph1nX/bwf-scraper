// measures/variante-seed-paires.mjs
// SEED D'UNE PAIRE NEUVE DEPUIS SES JOUEURS — étapes 1 à 3 en un script.
//
// LE DÉFAUT MESURÉ (étape 1, refaite ici pour être revérifiable). En double,
// l'entité Elo est la PAIRE (`pair:id1-id2`, lib/elo.mjs) et le modèle n'a
// AUCUNE information au niveau joueur : une paire jamais vue et non classée
// démarre à seedBottom (1350), que ses deux joueurs soient débutants ou
// champions du monde. L'écart mesuré sur 22 024 matchs (taux de victoire réel −
// probabilité annoncée, camps CHN/KOR face à une autre nation, doubles) :
//
//   | matchs joués PAR LA PAIRE | écart      | z   |
//   |---------------------------|------------|-----|
//   | 5-15                      | +19,6 pts  | 8,2 |
//   | 15-40                     | +13,9 pts  | 7,7 |
//   | 40-100                    |  +7,2 pts  | 5,4 |
//   | 100+                      |  +2,1 pts  | 1,3 | non significatif
//
// Les autres nations sont calibrées sur toute la plage (−3,1 à +2,0 pts). Ce
// n'est donc pas un défaut de netteté du modèle mais une erreur de POINT DE
// DÉPART : pour les nations à vivier profond, une paire neuve est composée de
// joueurs d'élite et son niveau réel est ~1900, pas 1350. Pour les autres
// nations la note basse est correcte — leurs paires neuves sont réellement
// moyennes, et elles sont même légèrement SURESTIMÉES (−3,1 pts).
//
// Hypothèse réfutée au passage : ce n'est pas de la recomposition de paires. Les
// paires chinoises sont les PLUS stables du circuit (médiane 41 matchs ensemble,
// à égalité avec MAS ; Inde 9, Canada 4).
//
// LA VARIANTE. `pairSeedFromPlayers` (lib/elo.mjs, 0 en production) : une paire
// jamais vue et absente des seeds démarre à
//     base + poids × confiance × (moyenne des notes de ses joueurs − base)
// où `base` est le seed actuel (1350), la confiance vaut 1 si les deux joueurs
// sont connus et 0,5 si un seul, et « note d'un joueur » est une note
// INDIVIDUELLE de double entretenue en parallèle : un joueur hérite du delta de
// la paire dans laquelle il joue, ce qui garde les deux échelles comparables.
// Cette note ne sert QU'AU SEED, jamais à prédire — la probabilité reste
// calculée sur la note de la paire.
//
// PROTOCOLE (le même que §2.3, et le seul qui vaille ici : le poids est un
// scalaire global, pas un facteur par discipline à ajuster en marche avant).
//   apprentissage : années < 2025 — ne sert qu'à faire tourner l'Elo ;
//   validation    : 2025 — CHOISIT la config de la grille ;
//   test          : 2026 — jamais regardé par le choix, seul chiffre à publier.
// La chaîne de probabilité est celle de production, inchangée (eloProb +
// recalibrate) : on ne juge QUE le point de départ des paires neuves.
//
// Limite assumée : les facteurs d'étirement de lib/calibrate.mjs ont été réglés
// sur l'Elo de production. Ils sont appliqués à l'identique aux deux modèles, ce
// qui désavantage légèrement la variante (ses notes ne sont plus exactement
// celles sur lesquelles l'étirement a été mesuré). Le compte-rendu affiche donc
// aussi le Brier BRUT, sans recalibration, où cette réserve ne joue pas.
//
// Usage :
//   node measures/variante-seed-paires.mjs            # grille + test
//   node measures/variante-seed-paires.mjs --rapide   # 2 configs seulement

import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover } from "../lib/dataset.mjs";
import { eloProb, isProvisional } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { makeRng } from "../lib/metrics.mjs";

const SEED = 42;
const DRAWS = 2000;
const DOUBLES = new Set(["MD", "WD", "XD"]);
const VIVIER = new Set(["CHN", "KOR"]); // nations dont l'écart a été démontré

const rapide = process.argv.includes("--rapide");

// Grille : poids accordé à la note dérivée, et nombre de matchs à partir duquel
// un joueur sert de référence. Volontairement courte — chaque config coûte une
// passe Elo complète, et une grille large serait une sélection déguisée.
const GRILLE = rapide
  ? [{ w: 1, min: 10 }]
  : [
      { w: 0.5, min: 10 },
      { w: 0.75, min: 10 },
      { w: 1, min: 5 },
      { w: 1, min: 10 },
      { w: 1, min: 20 },
    ];

const years = await store.listYears();

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}

/** Une passe Elo complète ; rend les lignes d'AVANT match. */
async function rejeu(params) {
  const rows = [];
  await computeElo(years, seeds, {
    params,
    onMatch: ({ disc, match, won, a, b }) => {
      if (isWalkover(match) || !match.matchTime) return;
      if (isProvisional(a.entity.matches) || isProvisional(b.entity.matches)) return;
      rows.push({
        disc,
        t: match.matchTime,
        year: Number(String(match.matchTime).slice(0, 4)),
        eloA: a.entity.rating,
        eloB: b.entity.rating,
        nA: a.entity.matches,
        nB: b.entity.matches,
        cA: match.team1?.countryCode ?? null,
        cB: match.team2?.countryCode ?? null,
        won,
      });
    },
  });
  return rows;
}

const brier = (rows, p) => rows.reduce((s, r) => s + (p(r) - r.won) ** 2, 0) / rows.length;
const pProd = (r) => recalibrate(eloProb(r.eloA, r.eloB), r.disc);
const pBrut = (r) => eloProb(r.eloA, r.eloB);

/** Écart (réel − annoncé) des camps d'une nation à vivier, en double. */
function ecartVivier(rows, p, filtre = () => true) {
  let n = 0, somme = 0, gagnes = 0;
  for (const r of rows) {
    if (!DOUBLES.has(r.disc) || !filtre(r)) continue;
    const prob = p(r);
    for (const cote of [1, 2]) {
      const c = cote === 1 ? r.cA : r.cB;
      const o = cote === 1 ? r.cB : r.cA;
      if (!VIVIER.has(c) || VIVIER.has(o)) continue;
      n++;
      somme += cote === 1 ? prob : 1 - prob;
      gagnes += cote === 1 ? r.won : 1 - r.won;
    }
  }
  if (!n) return null;
  const reel = gagnes / n, annonce = somme / n;
  return { n, reel, annonce, ecart: reel - annonce };
}

/** IC bootstrap apparié du gain de Brier de `b` sur `a` (positif = b meilleur). */
function gainBrier(rows, pa, pb) {
  const paires = rows.map((r) => [(pa(r) - r.won) ** 2, (pb(r) - r.won) ** 2]);
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
  tirages.sort((x, y) => x - y);
  const moy = tirages.reduce((a, b) => a + b, 0) / tirages.length;
  return { moy, lo: tirages[Math.floor(0.025 * DRAWS)], hi: tirages[Math.floor(0.975 * DRAWS)] };
}

const pc = (x) => `${(x * 100 >= 0 ? "+" : "") + (x * 100).toFixed(1)} pts`;
const e4 = (x) => `${(x * 1e4 >= 0 ? "+" : "") + (x * 1e4).toFixed(1)} e-4`;

// ==============================================================================
// Référence : l'Elo de production (variante désactivée).
// ==============================================================================
console.log("Rejeu de référence (production, pairSeedFromPlayers = 0)…");
const ref = await rejeu(undefined);
const refVa = ref.filter((r) => r.year === 2025);
const refTe = ref.filter((r) => r.year === 2026);
console.log(`  lignes : ${ref.length} (validation 2025 : ${refVa.length}, test 2026 : ${refTe.length})`);
console.log(`  Brier validation 2025 : ${brier(refVa, pProd).toFixed(4)}`);
console.log(`  Brier test 2026       : ${brier(refTe, pProd).toFixed(4)}`);
const ecartRef = ecartVivier(ref, pProd);
console.log(`  écart CHN/KOR doubles (tout l'historique) : ${pc(ecartRef.ecart)} sur ${ecartRef.n} camps`);

// ==============================================================================
// Grille, jugée sur la VALIDATION 2025 seulement.
// ==============================================================================
console.log("\n=== Grille (choix sur la validation 2025) ===");
const resultats = [];
for (const { w, min } of GRILLE) {
  const rows = await rejeu({ pairSeedFromPlayers: w, pairSeedMinPlayerMatches: min });
  const va = rows.filter((r) => r.year === 2025);
  const bv = brier(va, pProd);
  const ec = ecartVivier(rows, pProd);
  resultats.push({ w, min, rows, bv, ec });
  console.log(
    `  poids ${w} / min ${String(min).padStart(2)} : Brier validation ${bv.toFixed(4)}` +
      `  écart CHN/KOR ${pc(ec.ecart)}`
  );
}
resultats.sort((a, b) => a.bv - b.bv);
const best = resultats[0];
console.log(`  => config retenue : poids ${best.w}, min ${best.min} matchs`);

// ==============================================================================
// Test 2026 : le seul chiffre à publier.
// ==============================================================================
console.log("\n=== TEST 2026 (jamais regardé par le choix de config) ===");
const te = best.rows.filter((r) => r.year === 2026);
// Appariement PAR INDICE, et non par horodatage : plusieurs matchs partagent la
// même heure de début (mêmes tableaux, courts différents), donc une clé
// (horodatage, discipline) n'est pas bijective et un appariement par clé fait
// silencieusement comparer un match à un autre.
//
// L'indice est légitime ici : les deux rejeux parcourent les mêmes matchs dans
// le même ordre chronologique, et la règle d'abstention ne dépend que du NOMBRE
// de matchs des deux camps — un compteur que le seed ne touche pas. Les deux
// ensembles sont donc identiques ligne à ligne. On le VÉRIFIE au lieu de le
// supposer : au moindre désalignement, le script s'arrête.
if (te.length !== refTe.length) {
  throw new Error(`ensembles de test de tailles différentes : ${refTe.length} vs ${te.length}`);
}
for (let i = 0; i < te.length; i++) {
  const a = refTe[i], b = te[i];
  if (a.t !== b.t || a.disc !== b.disc || a.cA !== b.cA || a.cB !== b.cB || a.won !== b.won) {
    throw new Error(`désalignement à l'indice ${i} : ${a.t} ${a.disc} vs ${b.t} ${b.disc}`);
  }
}
const communs = te;
const refCommuns = refTe;
console.log(`  matchs de test : ${communs.length}, appariement par indice vérifié ligne à ligne`);

const bRef = brier(refCommuns, pProd), bVar = brier(communs, pProd);
console.log(`  Brier production  — référence ${bRef.toFixed(4)}  variante ${bVar.toFixed(4)}`);
const bRefB = brier(refCommuns, pBrut), bVarB = brier(communs, pBrut);
console.log(`  Brier brut        — référence ${bRefB.toFixed(4)}  variante ${bVarB.toFixed(4)}`);

// Bootstrap apparié : il faut les deux probabilités du MÊME match côte à côte.
const apparies = communs.map((r, i) => ({ ...r, _ref: refCommuns[i] }));
const gProd = gainBrier(apparies, (r) => pProd(r._ref), pProd);
const gBrut = gainBrier(apparies, (r) => pBrut(r._ref), pBrut);
console.log(`  gain (production) : ${e4(gProd.moy)}  IC95 [${e4(gProd.lo)} ; ${e4(gProd.hi)}]`);
console.log(`  gain (brut)       : ${e4(gBrut.moy)}  IC95 [${e4(gBrut.lo)} ; ${e4(gBrut.hi)}]`);
const conclut = (g) => (g.lo > 0 ? "✅ gain démontré" : g.hi < 0 ? "❌ perte démontrée" : "~ non départageable");
console.log(`  verdict production : ${conclut(gProd)}`);
console.log(`  verdict brut       : ${conclut(gBrut)}`);

// ==============================================================================
// Le défaut visé est-il corrigé ? Écart CHN/KOR par maturité de la paire.
// ==============================================================================
console.log("\n=== Écart CHN/KOR en doubles, par nombre de matchs de la paire ===");
console.log("tranche      | référence        | variante");
for (const [lo, hi] of [[5, 15], [15, 40], [40, 100], [100, Infinity]]) {
  const f = (r) => {
    const nMin = Math.min(r.nA, r.nB);
    return nMin >= lo && nMin < hi;
  };
  const a = ecartVivier(ref, pProd, f);
  const b = ecartVivier(best.rows, pProd, f);
  const fmt = (x) => (x ? `${pc(x.ecart).padStart(9)} (n=${String(x.n).padStart(4)})` : "     (vide)");
  console.log(`${`${lo}-${hi === Infinity ? "+" : hi}`.padEnd(12)} | ${fmt(a)} | ${fmt(b)}`);
}

console.log("\nRappel : rien n'est promu en production sur ce seul script. Le poids");
console.log("ne passe dans lib/elo.mjs que si le verdict du test 2026 est un gain.");

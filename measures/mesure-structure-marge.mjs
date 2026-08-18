// measures/mesure-structure-marge.mjs
// OÙ LE PÉAGE EST-IL MINCE ? — cartographie de la marge effective par camp.
//
//   node measures/mesure-structure-marge.mjs
//
// PRÉREQUIS : `npm run build-data` (lit web/public/data/pronos/*.json, la même
// jointure prono ↔ cotes que roi.json et le banc d'essai).
//
// POURQUOI. Tout le projet bute sur « l'edge (~3 %, CLV prouvée §8.2) < la
// marge (~8 %) ». Mais ce 8 % est une MOYENNE : le bookmaker ne charge pas les
// deux camps également (biais favori-outsider, documenté sur tous les sports :
// l'outsider porte l'essentiel de la marge, le favori se paie presque au juste
// prix). Personne n'a jamais cartographié notre marché : s'il existe des
// tranches de cotes où la marge effective d'UN camp tombe sous ~3 %, la CLV
// prouvée y suffit arithmétiquement. Sinon, c'est démontré : aucun chemin.
//
// MÉTHODE — sans hypothèse de dé-vig. Le dé-vig proportionnel attribue la
// marge également par construction : il ne peut PAS répondre. On mesure donc
// par les RÉSULTATS : le ROI d'un pari aveugle sur TOUS les camps d'une
// tranche de cote = − (marge effective de la tranche). Une tranche à ROI
// aveugle ≈ 0 est une tranche au juste prix.
//   1. Chaque match coté fournit DEUX observations (une par camp), à la
//      meilleure cote entre opérateurs (multi-comptes, comme §8.1), clôture
//      et ouverture séparément.
//   2. ROI aveugle par tranche de cote + IC bootstrap par grappe (grappe =
//      match : les deux camps d'un même match sont anticorrélés).
//   3. Persistance par année — une tranche mince une seule saison est du bruit.
//   4. Croisement final : nos paris value (EV > 0, proba de production),
//      restreints aux tranches minces trouvées. C'est LE test de viabilité.
//
// Tranches figées A PRIORI (grille standard du biais favori-outsider — pas
// choisies en regardant les résultats) : 1,01-1,1 / 1,1-1,2 / 1,2-1,35 /
// 1,35-1,5 / 1,5-1,8 / 1,8-2,2 / 2,2-3 / 3-5 / 5-10 / 10+.

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRONOS = join(ROOT, "web", "public", "data", "pronos");
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pctSigne = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;

const BANDES = [1.01, 1.1, 1.2, 1.35, 1.5, 1.8, 2.2, 3, 5, 10, 1e9];
const bandeDe = (o) => { let i = 0; while (i + 1 < BANDES.length - 1 && o >= BANDES[i + 1]) i++; return i; };
const nomBande = (i) => (i === BANDES.length - 2 ? "10+" : `${BANDES[i]}-${BANDES[i + 1]}`);

// --- Chargement --------------------------------------------------------------

const rows = [];
for (const f of (await readdir(PRONOS)).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(await readFile(join(PRONOS, f), "utf8"));
  for (const m of j.matches || (Array.isArray(j) ? j : [])) {
    if (!m.odds?.books || !m.winner || !m.matchTime) continue;
    rows.push({
      id: `${f}|${m.matchTime}|${m.team1?.players?.[0]?.id}`,
      an: Number(String(m.matchTime).slice(0, 4)),
      disc: m.disc,
      winner: m.winner, // 1 | 2
      prob: m.prob ?? null, // proba team1 de production, 0-100
      books: m.odds.books,
    });
  }
}

/** Meilleure cote d'un camp à un instant. */
const meilleure = (books, side, instant) => {
  const champ = (instant === "close" ? "odd" : "open") + side;
  let best = null;
  for (const b of Object.values(books)) if (b?.[champ] > 1 && (!best || b[champ] > best)) best = b[champ];
  return best;
};

console.log("OÙ LE PÉAGE EST-IL MINCE ? — marge effective par tranche de cote");
console.log(`${rows.length} matchs cotés (prono ↔ meilleure cote multi-opérateurs)\n`);

// --- Bootstrap par grappe (mulberry32, vérifié §6) ----------------------------
function ic95ParGrappe(obs, tirages = 2000) {
  if (!obs.length) return [0, 0];
  const grappes = new Map();
  for (const o of obs) (grappes.get(o.g) ?? grappes.set(o.g, []).get(o.g)).push(o.gain);
  const liste = [...grappes.values()];
  let a = 42 >>> 0;
  const alea = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ms = [];
  for (let t = 0; t < tirages; t++) {
    let somme = 0, n = 0;
    for (let i = 0; i < liste.length; i++) {
      const gr = liste[Math.floor(alea() * liste.length)];
      for (const x of gr) { somme += x; n++; }
    }
    ms.push(somme / n);
  }
  ms.sort((x, y) => x - y);
  return [ms[Math.floor(tirages * 0.025)], ms[Math.floor(tirages * 0.975)]];
}
const moy = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// --- 1. Carte de la marge : ROI aveugle par tranche ---------------------------

for (const instant of ["close", "open"]) {
  console.log(`\n=== ${instant === "close" ? "CLÔTURE" : "OUVERTURE"} — ROI aveugle par tranche (marge effective = −ROI) ===`);
  console.log("   tranche  |     n | ROI aveugle | IC 95 %            | par année (24/25/26)");
  for (let i = 0; i < BANDES.length - 1; i++) {
    const obs = [];
    const parAn = { 2024: [], 2025: [], 2026: [] };
    for (const r of rows) {
      for (const side of [1, 2]) {
        const o = meilleure(r.books, side, instant);
        if (!o || bandeDe(o) !== i) continue;
        const gain = r.winner === side ? o - 1 : -1;
        obs.push({ g: r.id, gain });
        (parAn[r.an] ??= []).push(gain);
      }
    }
    if (obs.length < 50) continue;
    const roi = moy(obs.map((o) => o.gain));
    const [lo, hi] = ic95ParGrappe(obs);
    const detail = [2024, 2025, 2026].map((an) => (parAn[an]?.length >= 30 ? pctSigne(moy(parAn[an])) : "—")).join(" / ");
    console.log(`   ${nomBande(i).padEnd(8)} | ${String(obs.length).padStart(5)} | ${pctSigne(roi).padStart(8)}   | [${pctSigne(lo)} ; ${pctSigne(hi)}] | ${detail}`);
  }
}

// --- 2. Croisement : nos paris value dans les tranches minces ------------------

// Les tranches « minces » sont déterminées PAR LA CLÔTURE (le prix de
// référence) : celles dont le ROI aveugle clôture > −3 % (marge < CLV prouvée).
console.log("\n=== NOS PARIS VALUE (EV > 0, proba de production) restreints par tranche ===");
console.log("   La question : le −14,5 % du value global vient-il des tranches chères ?");
const minces = new Set();
for (let i = 0; i < BANDES.length - 1; i++) {
  const obs = [];
  for (const r of rows) for (const side of [1, 2]) {
    const o = meilleure(r.books, side, "close");
    if (o && bandeDe(o) === i) obs.push({ g: r.id, gain: r.winner === side ? o - 1 : -1 });
  }
  if (obs.length >= 200 && moy(obs.map((x) => x.gain)) > -0.03) minces.add(i);
}
console.log(`   Tranches minces (ROI aveugle clôture > −3 %, n ≥ 200) : ${[...minces].map(nomBande).join(", ") || "AUCUNE"}`);

for (const instant of ["open", "close"]) {
  for (const [nom, filtre] of [
    ["value, TOUTES tranches     ", () => true],
    ["value, tranches MINCES     ", (i) => minces.has(i)],
    ["value, tranches chères     ", (i) => !minces.has(i)],
  ]) {
    const obs = [];
    const parAn = {};
    for (const r of rows) {
      if (r.prob == null) continue;
      for (const side of [1, 2]) {
        const o = meilleure(r.books, side, instant);
        if (!o) continue;
        const p = (side === 1 ? r.prob : 100 - r.prob) / 100;
        if (p * o - 1 <= 0) continue;
        if (!filtre(bandeDe(o))) continue;
        const gain = r.winner === side ? o - 1 : -1;
        obs.push({ g: r.id, gain });
        (parAn[r.an] ??= []).push(gain);
      }
    }
    if (obs.length < 30) { console.log(`   ${nom} (${instant}) : ${obs.length} paris — trop peu.`); continue; }
    const [lo, hi] = ic95ParGrappe(obs);
    const detail = Object.keys(parAn).sort().map((an) => `${an}: ${pctSigne(moy(parAn[an]))} (${parAn[an].length})`).join("  ");
    console.log(`   ${nom} | ${instant === "open" ? "ouv." : "clô."} | ${String(obs.length).padStart(5)} | ROI ${pctSigne(moy(obs.map((x) => x.gain))).padStart(7)} [${pctSigne(lo)} ; ${pctSigne(hi)}] | ${detail}`);
  }
}

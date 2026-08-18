// measures/mesure-gymnase-prix-sets.mjs
// LA question jamais posée sur l'effet gymnase : LE MARCHÉ LE CONNAÎT-IL ?
//
//   node measures/mesure-gymnase-prix-sets.mjs
//
// Ce qu'on sait déjà : l'effet gymnase sur les 3 sets est réel au niveau des
// LIEUX (§7 : sur-dispersion ~6 σ, persistance r = 0,42) mais n'améliore pas
// NOTRE prédiction match par match (§10.1 — le modèle E perdait contre D).
// Ce qu'on n'a jamais demandé : le PRIX du marché des sets varie-t-il d'un
// gymnase à l'autre ? Si le bookmaker cote le même p3 à Sydney et à Séoul
// alors que les taux réels y diffèrent durablement, son erreur est localisée —
// c'était l'intuition d'origine du lot C n°1, jamais testée frontalement.
//
// MÉTHODE.
// 1. Pour chaque match coté (jointure BWF ↔ data/flashscore/sets/, 97
//    tournois) : p3 du marché (dé-viggée, clôture, consensus des opérateurs),
//    résultat (3 sets ou non), lieu du tournoi.
// 2. PRIOR DE GYMNASE en marche avant : pour un match de l'année Y au lieu v,
//    l'écart historique du lieu = Σ(observé − attendu de la case disc×ΔElo)
//    sur les matchs des années < Y uniquement, amorti par pseudo-effectif 50
//    (même construction que §10.1 — aucune fuite du futur).
// 3. Question A — le marché voit-il les lieux ? Par tranche de prior : le p3
//    du marché bouge-t-il ? l'observé bouge-t-il ? L'écart (observé − marché)
//    croît-il avec le prior ? C'est LE test : si le marché intégrait le lieu,
//    l'écart serait plat.
// 4. Question B — ça paie ? ROI de « 3 sets » aux lieux à prior haut et de
//    « 2 sets » aux lieux à prior bas, meilleur prix entre opérateurs,
//    IC bootstrap par grappe (un tournoi × lieu = des matchs corrélés → grappe
//    = tournoi), et persistance par année.
//
// Le pronostic honnête AVANT mesure : l'effet lieu vaut quelques points aux
// extrêmes, la marge par camp ~8-15 points — il faudrait que le marché ignore
// TOTALEMENT les lieux ET que l'effet soit fort pour que B passe au vert.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover, wentThreeSets } from "../lib/dataset.mjs";
import { loadFlashscoreOdds, joinFlashscore } from "../lib/flashscore-join.mjs";
import { prixDesSets } from "./mesure-roi-sets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pct = (x) => `${(x * 100).toFixed(1)} %`;
const pctSigne = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} %`;

// --- 1. Matchs BWF avec lieu, écart d'Elo, résultat ---------------------------

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}
const years = await store.listYears();

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
  } catch { /* année sans calendrier : t<id> */ }
}

const rows = [];
await computeElo(years, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || match.score.length < 2) return;
    const jour = String(match.matchTime).slice(0, 10);
    rows.push({
      cle: `${tmtId}|${disc}|${jour}|${a.key}|${b.key}`,
      tmtId, disc, jour, an: Number(jour.slice(0, 4)),
      venue: lieux.get(Number(tmtId)) ?? `t${tmtId}`,
      gap: Math.abs(a.entity.rating - b.entity.rating),
      three: wentThreeSets(match.score) ? 1 : 0,
      name1: match.team1.players.map((p) => p.nameDisplay).join(" / "),
      name2: match.team2.players.map((p) => p.nameDisplay).join(" / "),
      sets: match.score.map((s) => ({ home: s.home, away: s.away })),
      a: a.key, b: b.key,
    });
  },
});

// --- 2. Prior de gymnase en marche avant (par année) --------------------------

const BANDES = [0, 50, 100, 150, 200, 300, 400];
const bandeDe = (g) => { let i = 0; while (i + 1 < BANDES.length && g >= BANDES[i + 1]) i++; return i; };

/** attendu par case disc×ΔElo et écarts par lieu, sur un passé donné. */
function construirePrior(passe) {
  const cases = new Map();
  for (const r of passe) {
    const k = `${r.disc}|${bandeDe(r.gap)}`;
    const s = cases.get(k) || { n: 0, k3: 0 };
    s.n++; s.k3 += r.three; cases.set(k, s);
  }
  const global = passe.reduce((s, r) => s + r.three, 0) / passe.length;
  const attendu = (r) => {
    const s = cases.get(`${r.disc}|${bandeDe(r.gap)}`);
    return s && s.n >= 30 ? s.k3 / s.n : global;
  };
  const parLieu = new Map();
  for (const r of passe) {
    const s = parLieu.get(r.venue) || { n: 0, ecart: 0 };
    s.n++; s.ecart += r.three - attendu(r); parLieu.set(r.venue, s);
  }
  const prior = new Map();
  for (const [v, s] of parLieu) prior.set(v, { valeur: s.ecart / (s.n + 50), n: s.n });
  return { prior, attendu };
}

const priorsParAn = new Map();
for (const an of [...new Set(rows.map((r) => r.an))].sort()) {
  const passe = rows.filter((r) => r.an < an);
  if (passe.length >= 2000) priorsParAn.set(an, construirePrior(passe));
}

// --- 3. Jointure vers les cotes de sets ---------------------------------------

const fsFiles = await loadFlashscoreOdds(join(ROOT, "data", "flashscore", "odds"));
const { joined } = joinFlashscore(fsFiles, rows.map((r) => ({
  tmtId: r.tmtId, disc: r.disc, day: r.jour, name1: r.name1, name2: r.name2, sets: r.sets, a: r.a, b: r.b,
})));
const SETS_DIR = join(ROOT, "data", "flashscore", "sets");
const parFsId = new Map();
for (const f of (await readdir(SETS_DIR)).filter((x) => x.endsWith(".json"))) {
  const j = JSON.parse(await readFile(join(SETS_DIR, f), "utf8"));
  for (const m of j.matches || []) if (m.scores) parFsId.set(m.fsId, m.scores);
}

const OPERATEURS = ["betclic", "winamax", "unibet"];
const cotes = [];
for (const r of rows) {
  const j = joined.get(r.cle);
  const scores = j?.fsId ? parFsId.get(j.fsId) : null;
  const ctx = priorsParAn.get(r.an);
  if (!scores || !ctx) continue;
  const parOp = {};
  for (const op of OPERATEURS) {
    if (!scores[op]) continue;
    const cl = prixDesSets(scores[op], "closing");
    if (cl) parOp[op] = cl;
  }
  if (!Object.keys(parOp).length) continue;
  const ops = Object.values(parOp);
  const p = ctx.prior.get(r.venue);
  cotes.push({
    ...r,
    p3Marche: ops.reduce((s, o) => s + o.p3, 0) / ops.length,
    c3: Math.max(...ops.map((o) => o.c3)),
    c2: Math.max(...ops.map((o) => o.c2)),
    attendu: ctx.attendu(r),
    prior: p?.valeur ?? 0,
    priorN: p?.n ?? 0,
  });
}

console.log("L'EFFET GYMNASE EST-IL DANS LE PRIX DU MARCHÉ DES SETS ?");
console.log(`${cotes.length} matchs cotés avec lieu et prior de gymnase (marche avant, années jugées : ${[...priorsParAn.keys()].join(", ")})\n`);

// --- 4. Question A : le marché voit-il les lieux ? -----------------------------

// Tranches de prior : quintiles pondérés simples.
const tries = [...cotes].sort((a, b) => a.prior - b.prior);
const K = 5;
const taille = Math.ceil(tries.length / K);
console.log("A. Par tranche de prior de gymnase (du plus « 2 sets » au plus « 3 sets »)");
console.log("   tranche | prior moyen |    n | p3 MARCHÉ | attendu Elo | OBSERVÉ | obs − marché");
const blocs = [];
for (let i = 0; i < K; i++) {
  const bloc = tries.slice(i * taille, (i + 1) * taille);
  if (!bloc.length) continue;
  const m = (f) => bloc.reduce((s, x) => s + f(x), 0) / bloc.length;
  blocs.push({ i, bloc, prior: m((x) => x.prior), marche: m((x) => x.p3Marche), attendu: m((x) => x.attendu), obs: m((x) => x.three) });
  const b = blocs.at(-1);
  console.log(`      Q${i + 1}   |   ${pctSigne(b.prior).padStart(6)}  | ${String(bloc.length).padStart(4)} |   ${pct(b.marche)}  |    ${pct(b.attendu)}   |  ${pct(b.obs)}  |   ${pctSigne(b.obs - b.marche)}`);
}
// Pente de l'erreur du marché sur le prior (moindres carrés simples).
const mx = cotes.reduce((s, x) => s + x.prior, 0) / cotes.length;
const my = cotes.reduce((s, x) => s + (x.three - x.p3Marche), 0) / cotes.length;
const num = cotes.reduce((s, x) => s + (x.prior - mx) * ((x.three - x.p3Marche) - my), 0);
const den = cotes.reduce((s, x) => s + (x.prior - mx) ** 2, 0);
const pente = num / den;
// Erreur type de la pente (résidus indépendants — approximation, les grappes
// tournoi la sous-estiment un peu : à lire avec ça en tête).
const res = cotes.map((x) => (x.three - x.p3Marche) - my - pente * (x.prior - mx));
const se = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / (cotes.length - 2) / den);
console.log(`\n   Pente de (observé − p3 marché) sur le prior : ${pente.toFixed(2)} ± ${(1.96 * se).toFixed(2)}`);
console.log("   1 = le marché ignore TOTALEMENT les lieux ; 0 = il les intègre déjà.");
// Et le marché bouge-t-il, lui ? (pente de p3Marché sur le prior)
const numM = cotes.reduce((s, x) => s + (x.prior - mx) * (x.p3Marche - cotes.reduce((t, y) => t + y.p3Marche, 0) / cotes.length), 0);
console.log(`   Pente du p3 MARCHÉ sur le prior : ${(numM / den).toFixed(2)} (0 = prix identique partout)`);

// --- 5. Question B : ça paie ? -------------------------------------------------

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

console.log("\nB. ROI aux extrêmes de prior (mise 1 €, meilleur prix, grappe = tournoi)");
console.log("   stratégie | seuil prior |     n | ROI      | IC 95 %       | par année");
for (const [nom, seuilFn, camp] of [
  ["3 sets aux lieux chauds", (x) => x.prior >= 0.02 && x.priorN >= 60, 3],
  ["3 sets, seuil fort     ", (x) => x.prior >= 0.035 && x.priorN >= 60, 3],
  ["2 sets aux lieux froids", (x) => x.prior <= -0.02 && x.priorN >= 60, 2],
]) {
  const sel = cotes.filter(seuilFn);
  if (sel.length < 30) { console.log(`   ${nom} : ${sel.length} matchs — trop peu.`); continue; }
  const obs = sel.map((x) => ({
    g: `${x.tmtId}`,
    gain: camp === 3 ? (x.three ? x.c3 - 1 : -1) : (!x.three ? x.c2 - 1 : -1),
  }));
  const roi = obs.reduce((s, o) => s + o.gain, 0) / obs.length;
  const [lo, hi] = ic95ParGrappe(obs);
  const parAn = {};
  sel.forEach((x, i) => { (parAn[x.an] ??= []).push(obs[i].gain); });
  const detail = Object.entries(parAn).map(([an, g]) => `${an}: ${pctSigne(g.reduce((s, x) => s + x, 0) / g.length)} (${g.length})`).join("  ");
  console.log(`   ${nom} | ${String(sel.length).padStart(5)} | ${pctSigne(roi).padStart(7)} | [${pctSigne(lo)} ; ${pctSigne(hi)}] | ${detail}`);
}

// Contexte : ce que coûte le même pari SANS le filtre gymnase.
const tous3 = cotes.map((x) => ({ g: `${x.tmtId}`, gain: x.three ? x.c3 - 1 : -1 }));
console.log(`\n   Référence — « 3 sets » partout : ${pctSigne(tous3.reduce((s, o) => s + o.gain, 0) / tous3.length)} (${tous3.length} paris)`);

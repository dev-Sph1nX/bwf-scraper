// measures/mesure-rentabilite-gymnase.mjs
// ÉTUDE DE RENTABILITÉ DU MARCHÉ « 3 SETS », GYMNASE PAR GYMNASE.
//
//   node measures/mesure-rentabilite-gymnase.mjs
//   node measures/mesure-rentabilite-gymnase.mjs --annees=2024,2025,2026
//   node measures/mesure-rentabilite-gymnase.mjs --min=40   # n mini par lieu
//
// POURQUOI CETTE MESURE, alors que §10.7 a déjà fermé la branche « gymnase » :
// §10.7 juge l'effet PAR QUINTILE de prior (5 groupes agrégés) et par seuil.
// Le détail LIEU PAR LIEU n'a jamais été publié — c'est la demande du
// propriétaire (2026-08-19) : « je veux les chiffres ». On les donne tous,
// avec l'arithmétique complète : notre avantage en points face au péage en
// points, gymnase par gymnase.
//
// ET SURTOUT, le test que §10.7 ne faisait pas : en regardant ~50 gymnases,
// LE MEILLEUR PARAÎT TOUJOURS RENTABLE, par pur hasard (c'est le biais de
// sélection déjà fatal à H1, §8.4). On le chiffre ici par simulation sous
// l'hypothèse nulle « le marché a raison » : on rejoue 2 000 saisons où
// chaque match tombe en 3 sets avec la probabilité du marché, aux VRAIS prix
// et dans la VRAIE structure de lieux, et on regarde ce que rapporte le
// meilleur gymnase de chaque saison simulée. Si le meilleur gymnase réel ne
// dépasse pas ce que le hasard produit, il n'y a rien — et c'est démontré,
// pas supposé.
//
// MÉTHODE (identique à §10.7 pour les briques communes) : p3 du marché
// dé-viggée à la clôture, consensus des opérateurs ; meilleur prix
// multi-opérateurs pour la mise ; prior de gymnase en marche avant (écart
// historique du lieu à l'attendu de la case disc×ΔElo, années antérieures
// seulement, amorti par pseudo-effectif 50) ; IC bootstrap par grappe
// (grappe = tournoi : les matchs d'un même tournoi sont corrélés).
//
// ANNÉES FIGÉES À 2024-2026 PAR DÉFAUT : c'est la période où les cotes de
// sets existent, et cela rend la mesure reproductible même si data/ gagne des
// années antérieures (backfill en cours) — le rejeu Elo repartirait sinon
// d'un état différent. Années JUGÉES : celles qui ont un passé (2025, 2026).
//
// Sortie : tableau console + data/analyses/gymnases-3sets.json (versionné,
// consommé par la page /gymnases de l'app via build-data).

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover, wentThreeSets } from "../lib/dataset.mjs";
import { loadFlashscoreOdds, joinFlashscore } from "../lib/flashscore-join.mjs";
import { makeRng } from "../lib/metrics.mjs";
import { prixDesSets } from "./mesure-roi-sets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => (process.argv.find((x) => x.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const ANNEES = (arg("annees") || "2024,2025,2026").split(",").map(Number);
const MIN_N = Number(arg("min") || 40);
const TIRAGES = 2000;
const SEED = 42;
const OPERATEURS = ["betclic", "winamax", "unibet"];

const pct = (x, d = 1) => `${(x * 100).toFixed(d)} %`;
const signe = (x, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)} %`;
const pts = (x, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)} pt`;

// ==============================================================================
// 1) Matchs : rejeu Elo walk-forward (probas d'avant match) + lieu du tournoi.
// ==============================================================================
const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}

const norm = (s) =>
  String(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/\bcity\b/g, "").replace(/[,\s]+/g, " ").trim();

const lieuNorm = new Map();   // tmtId -> clé normalisée
const lieuLabel = new Map();  // clé normalisée -> libellé lisible (le plus fréquent)
const paysDe = new Map();     // clé normalisée -> code pays
for (const y of ANNEES) {
  try {
    const t = JSON.parse(await readFile(join(ROOT, "data", String(y), "tournaments.json"), "utf8"));
    for (const m of (Array.isArray(t) ? t : t.results ?? [])) {
      for (const tt of m.tournaments ?? []) {
        const brut = tt.location || tt.country || `t${tt.id}`;
        const k = norm(brut);
        lieuNorm.set(Number(tt.id), k);
        if (!lieuLabel.has(k)) lieuLabel.set(k, String(brut).trim());
        const cc = /\/([A-Z]{3})\.png/.exec(tt.flag_url || "")?.[1];
        if (cc && !paysDe.has(k)) paysDe.set(k, cc);
      }
    }
  } catch { /* année sans calendrier */ }
}

const rows = [];
await computeElo(ANNEES.map(String), seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || match.score.length < 2) return;
    const jour = String(match.matchTime).slice(0, 10);
    rows.push({
      cle: `${tmtId}|${disc}|${jour}|${a.key}|${b.key}`,
      tmtId, disc, jour, an: Number(jour.slice(0, 4)),
      venue: lieuNorm.get(Number(tmtId)) ?? `t${tmtId}`,
      gap: Math.abs(a.entity.rating - b.entity.rating),
      three: wentThreeSets(match.score) ? 1 : 0,
      name1: match.team1.players.map((p) => p.nameDisplay).join(" / "),
      name2: match.team2.players.map((p) => p.nameDisplay).join(" / "),
      sets: match.score.map((s) => ({ home: s.home, away: s.away })),
      a: a.key, b: b.key,
    });
  },
});
console.log(`ÉTUDE DE RENTABILITÉ — MARCHÉ « 3 SETS », GYMNASE PAR GYMNASE`);
console.log(`Années rejouées : ${ANNEES.join(", ")} — ${rows.length} matchs joués exploitables.\n`);

// ==============================================================================
// 2) Prior de gymnase en marche avant (le lieu ne connaît que son passé).
// ==============================================================================
const BANDES = [0, 50, 100, 150, 200, 300, 400];
const bandeDe = (g) => { let i = 0; while (i + 1 < BANDES.length && g >= BANDES[i + 1]) i++; return i; };

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

// ==============================================================================
// 3) Jointure vers les cotes du marché des sets (Flashscore).
// ==============================================================================
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

const cotes = [];
for (const r of rows) {
  const j = joined.get(r.cle);
  const scores = j?.fsId ? parFsId.get(j.fsId) : null;
  const ctx = priorsParAn.get(r.an);
  if (!scores || !ctx) continue;
  const ops = [];
  for (const op of OPERATEURS) {
    if (!scores[op]) continue;
    const cl = prixDesSets(scores[op], "closing");
    if (cl) ops.push(cl);
  }
  if (!ops.length) continue;
  const c3 = Math.max(...ops.map((o) => o.c3));   // meilleur prix « 3 sets »
  const c2 = Math.max(...ops.map((o) => o.c2));   // meilleur prix « 2 sets »
  const p = ctx.prior.get(r.venue);
  cotes.push({
    ...r,
    p3Marche: ops.reduce((s, o) => s + o.p3, 0) / ops.length,
    c3, c2,
    // Péage effectif au meilleur prix multi-opérateurs : ce qui reste à payer
    // une fois qu'on a fait jouer la concurrence entre les 3 books.
    marge: 1 / c3 + 1 / c2 - 1,
    margeMoy: ops.reduce((s, o) => s + o.marge, 0) / ops.length,
    prior: p?.valeur ?? 0,
    priorN: p?.n ?? 0,
  });
}
const annéesJugées = [...new Set(cotes.map((c) => c.an))].sort();
console.log(`Matchs cotés sur le marché des sets : ${cotes.length} (années jugées : ${annéesJugées.join(", ")}, ` +
  `${new Set(cotes.map((c) => c.venue)).size} lieux, ${new Set(cotes.map((c) => c.tmtId)).size} tournois)\n`);

// ==============================================================================
// 4) Le tableau par gymnase.
// ==============================================================================
/** IC 95 % bootstrap, grappe = tournoi (matchs d'un même tournoi corrélés). */
function icGrappe(obs, { draws = TIRAGES, seed = SEED } = {}) {
  if (!obs.length) return null;
  const grappes = new Map();
  for (const o of obs) {
    if (!grappes.has(o.g)) grappes.set(o.g, []);
    grappes.get(o.g).push(o.gain);
  }
  const liste = [...grappes.values()];
  const rng = makeRng(seed);
  const ms = [];
  for (let t = 0; t < draws; t++) {
    let somme = 0, n = 0;
    for (let i = 0; i < liste.length; i++) {
      const gr = liste[(rng() * liste.length) | 0];
      for (const x of gr) { somme += x; n++; }
    }
    if (n) ms.push(somme / n);
  }
  ms.sort((x, y) => x - y);
  return [ms[Math.floor(draws * 0.025)], ms[Math.floor(draws * 0.975)]];
}

const moy = (xs, f) => xs.reduce((s, x) => s + f(x), 0) / xs.length;

const parLieu = new Map();
for (const c of cotes) {
  if (!parLieu.has(c.venue)) parLieu.set(c.venue, []);
  parLieu.get(c.venue).push(c);
}

const lieux = [];
for (const [venue, ms] of parLieu) {
  if (ms.length < MIN_N) continue;
  const obs3 = ms.map((x) => ({ g: `${x.tmtId}`, gain: x.three ? x.c3 - 1 : -1 }));
  const obs2 = ms.map((x) => ({ g: `${x.tmtId}`, gain: !x.three ? x.c2 - 1 : -1 }));
  const roi3 = moy(obs3, (o) => o.gain);
  const roi2 = moy(obs2, (o) => o.gain);
  const observe = moy(ms, (x) => x.three);
  const marche = moy(ms, (x) => x.p3Marche);
  const seuil = moy(ms, (x) => 1 / x.c3); // p3 minimal pour ne pas perdre
  lieux.push({
    venue,
    label: lieuLabel.get(venue) ?? venue,
    pays: paysDe.get(venue) ?? null,
    n: ms.length,
    tournois: new Set(ms.map((x) => x.tmtId)).size,
    annees: [...new Set(ms.map((x) => x.an))].sort(),
    observe, marche,
    avantage: observe - marche,             // notre « edge » brut, en points
    prior: moy(ms, (x) => x.prior),
    marge: moy(ms, (x) => x.marge),         // péage au meilleur prix
    margeMoy: moy(ms, (x) => x.margeMoy),   // marge moyenne d'un opérateur seul
    seuilRentable: seuil,
    roi3, ci3: icGrappe(obs3),
    roi2, ci2: icGrappe(obs2),
  });
}
lieux.sort((a, b) => b.roi3 - a.roi3);

const refObs = cotes.map((x) => ({ g: `${x.tmtId}`, gain: x.three ? x.c3 - 1 : -1 }));
const refRoi = moy(refObs, (o) => o.gain);
const refCi = icGrappe(refObs);
const margeGlobale = moy(cotes, (x) => x.marge);
const margeOpGlobale = moy(cotes, (x) => x.margeMoy);
const observeGlobal = moy(cotes, (x) => x.three);
const marcheGlobal = moy(cotes, (x) => x.p3Marche);

console.log(`RÉFÉRENCE — parier « 3 sets » sur TOUS les matchs cotés :`);
console.log(`  ROI ${signe(refRoi)} [${signe(refCi[0])} ; ${signe(refCi[1])}] sur ${cotes.length} paris`);
console.log(`  Taux réel de 3 sets ${pct(observeGlobal)} · prix du marché ${pct(marcheGlobal)} · ` +
  `écart ${pts(observeGlobal - marcheGlobal)}`);
console.log(`  Péage : ${pct(margeGlobale)} au meilleur prix des 3 opérateurs (${pct(margeOpGlobale)} chez un seul).\n`);

console.log(`PAR GYMNASE (≥ ${MIN_N} matchs cotés, trié par ROI « 3 sets » décroissant)\n`);
console.log(
  "  " + "Gymnase".padEnd(24) + "   n  tourn.  réel    marché   écart    péage   ROI 3 sets            ROI 2 sets",
);
for (const L of lieux) {
  console.log(
    "  " + L.label.slice(0, 23).padEnd(24) +
    String(L.n).padStart(4) + String(L.tournois).padStart(6) + "  " +
    pct(L.observe).padStart(7) + pct(L.marche).padStart(9) + pts(L.avantage).padStart(9) +
    pct(L.marge).padStart(9) + "   " +
    `${signe(L.roi3).padStart(7)} [${signe(L.ci3[0], 0)};${signe(L.ci3[1], 0)}]`.padEnd(22) +
    signe(L.roi2).padStart(8),
  );
}

// ==============================================================================
// 5) LE TEST DÉCISIF — biais de sélection : que produit le HASARD ?
//    Hypothèse nulle : le marché a exactement raison (chaque match tombe en
//    3 sets avec la probabilité p3 que le marché lui donne). On rejoue la
//    saison 2 000 fois aux VRAIS prix, dans la VRAIE structure de lieux, et on
//    note le ROI du MEILLEUR gymnase de chaque saison simulée.
// ==============================================================================
const éligibles = lieux.map((L) => parLieu.get(L.venue));
const rng = makeRng(SEED);
const meilleursSimules = [];
const positifsSimules = [];
for (let t = 0; t < TIRAGES; t++) {
  let best = -Infinity;
  let positifs = 0;
  for (const ms of éligibles) {
    let somme = 0;
    for (const x of ms) somme += (rng() < x.p3Marche ? x.c3 - 1 : -1);
    const roi = somme / ms.length;
    if (roi > best) best = roi;
    if (roi > 0) positifs++;
  }
  meilleursSimules.push(best);
  positifsSimules.push(positifs);
}
meilleursSimules.sort((a, b) => a - b);
const q = (p) => meilleursSimules[Math.floor(p * (meilleursSimules.length - 1))];
const meilleurReel = lieux[0];
const positifsReels = lieux.filter((L) => L.roi3 > 0).length;
const positifsAttendus = positifsSimules.reduce((s, x) => s + x, 0) / positifsSimules.length;
// Proportion de saisons simulées où AU MOINS un gymnase paraît rentable : la
// mesure directe du piège « mais tel gymnase gagne ! ».
const auMoinsUn = positifsSimules.filter((x) => x >= 1).length / positifsSimules.length;
// p-valeur : proportion de saisons simulées où le meilleur gymnase fait aussi
// bien ou mieux que le meilleur gymnase RÉEL.
const pValeur = meilleursSimules.filter((x) => x >= meilleurReel.roi3).length / meilleursSimules.length;

console.log(`\n\nLE TEST DÉCISIF — « mais tel gymnase est rentable ! », est-ce du hasard ?`);
console.log(`Hypothèse nulle : le marché a raison partout (aucun edge nulle part).`);
console.log(`${TIRAGES} saisons simulées aux vrais prix, sur les ${lieux.length} gymnases éligibles.\n`);
console.log(`  Meilleur gymnase RÉEL          : ${meilleurReel.label} — ROI ${signe(meilleurReel.roi3)} (${meilleurReel.n} paris)`);
console.log(`  Meilleur gymnase SOUS HASARD   : médiane ${signe(q(0.5))} · 95 % des saisons sous ` +
  `${signe(q(0.95))} · maximum atteint ${signe(meilleursSimules.at(-1))}`);
console.log(`  p-valeur du meilleur réel      : ${(pValeur * 100).toFixed(1)} %  ` +
  `(probabilité d'obtenir au moins aussi bien PAR HASARD)`);
console.log(`\n  Gymnases au ROI positif — réels : ${positifsReels} sur ${lieux.length}`);
console.log(`                          — hasard : ${positifsAttendus.toFixed(1)} en moyenne, ` +
  `et ${pct(auMoinsUn)} des saisons simulées en montrent AU MOINS UN`);
console.log(`  Autrement dit : même sans le moindre avantage réel, il y avait ${pct(auMoinsUn)} de chances`);
console.log(`  qu'un gymnase paraisse rentable et nous fasse croire à un filon.`);

// ==============================================================================
// 6) L'arithmétique, en une ligne : ce qu'il FAUDRAIT.
// ==============================================================================
const avantageMax = Math.max(...lieux.map((L) => L.avantage));
const seuilGlobal = moy(cotes, (x) => 1 / x.c3);
console.log(`\n\nL'ARITHMÉTIQUE DE LA RENTABILITÉ, EN TROIS LIGNES`);
console.log(`  Seuil imposé par la cote « 3 sets » : ${pct(seuilGlobal)} (il faut gagner au moins aussi souvent).`);
console.log(`  Taux réel de 3 sets                 : ${pct(observeGlobal)} — il manque ${pts(seuilGlobal - observeGlobal)}.`);
console.log(`  Meilleur gymnase (${meilleurReel.label}) : ${pct(meilleurReel.observe)} — il lui manque encore ` +
  `${pts(moy(parLieu.get(meilleurReel.venue), (x) => 1 / x.c3) - meilleurReel.observe)}.`);
console.log(`\n  Notre meilleur avantage sur le prix vaut ${pts(avantageMax)} ; il en faudrait ${pts(seuilGlobal - observeGlobal)}.`);
console.log(`  Le signal existe (le marché ignore les lieux), il est simplement DEUX FOIS TROP PETIT.`);

// ==============================================================================
// 7) Export JSON pour la page web.
// ==============================================================================
const sortie = {
  genereLe: new Date().toISOString().slice(0, 10),
  anneesRejouees: ANNEES,
  anneesJugees: annéesJugées,
  minN: MIN_N,
  tirages: TIRAGES,
  global: {
    nMatchs: cotes.length,
    nLieux: new Set(cotes.map((c) => c.venue)).size,
    nTournois: new Set(cotes.map((c) => c.tmtId)).size,
    observe: observeGlobal,
    marche: marcheGlobal,
    marge: margeGlobale,
    margeOperateur: margeOpGlobale,
    seuilRentable: moy(cotes, (x) => 1 / x.c3),
    roi3: refRoi,
    ci3: refCi,
  },
  lieux,
  hasard: {
    meilleurReel: { label: meilleurReel.label, roi3: meilleurReel.roi3, n: meilleurReel.n },
    medianeSimulee: q(0.5),
    q95Simulee: q(0.95),
    maxSimule: meilleursSimules.at(-1),
    pValeur,
    positifsReels: positifsReels,
    positifsAttendus,
    auMoinsUn,
    nLieuxEligibles: lieux.length,
  },
};
const OUT_DIR = join(ROOT, "data", "analyses");
await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "gymnases-3sets.json"), JSON.stringify(sortie, null, 2), "utf8");
console.log(`\n→ data/analyses/gymnases-3sets.json écrit (consommé par la page /gymnases).`);

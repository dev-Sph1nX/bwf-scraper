// tools/export-dataset.mjs
// EXPORT PORTABLE — deux CSV plats qui remplacent les 1 900 JSON de data/,
// pour réutiliser le jeu de données dans un autre projet, un notebook, Excel…
//
//   node tools/export-dataset.mjs                  # tout l'historique -> export/
//   node tools/export-dataset.mjs --annees=2024,2025,2026
//   node tools/export-dataset.mjs --out=/tmp/bwf
//
// PRODUIT :
//   export/matches.csv  une ligne par match JOUÉ — identité, résultat, ce que
//                       le MODÈLE prédisait, ce que le MARCHÉ disait. Se suffit
//                       à lui-même pour l'essentiel des analyses.
//   export/odds.csv     le détail par opérateur : une ligne par
//                       match × book × instant × marché, avec la colonne
//                       `misable` qui isole les cotes de RÉFÉRENCE.
//   export/README.md    le dictionnaire des colonnes (unités, pièges, trous).
//
// GARANTIE ANTI-FUITE : les probabilités et les notes Elo exportées sont celles
// d'AVANT le match, produites par le même rejeu chronologique que le backtest
// et la production (crochet `onMatch` de lib/elo.mjs, appelé avant la mise à
// jour des notes). Une analyse faite sur ce CSV ne peut pas tricher avec le
// futur — c'est la propriété qui rend l'export réutilisable pour du backtest.
//
// LA COLONNE `misable` D'ODDS.CSV EST IMPORTANTE. Depuis le 2026-08-19, la base
// contient des cotes bwin/NetBet collectées comme RÉFÉRENCE (opérateurs écartés
// du périmètre de pari, §10.5). Les inclure dans un calcul de rentabilité
// gonflerait artificiellement les résultats — c'est exactement le piège que
// build-data neutralise via MISABLE_BOOKS. Dans un autre projet, filtrer sur
// `misable = true` reproduit ce garde-fou.

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo, seedEloByRank } from "../lib/elo.mjs";
import { loadInitialRanks } from "../lib/seeds.mjs";
import { isWalkover, wentThreeSets, makeRankLookup } from "../lib/dataset.mjs";
import { loadPublications } from "../lib/rank-history.mjs";
import { eloProb, isProvisional } from "../lib/models.mjs";
import { recalibrate } from "../lib/calibrate.mjs";
import { loadFlashscoreOdds, joinFlashscore } from "../lib/flashscore-join.mjs";
import { BOOKS as MISABLES } from "../lib/roi.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => (process.argv.find((x) => x.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const ANNEES = arg("annees")?.split(",").map(Number) ?? null;
const OUT_DIR = arg("out") || join(ROOT, "export");

// --- utilitaires CSV ---------------------------------------------------------
/** Échappement RFC 4180 : guillemets doublés, champ cité s'il contient , " ou \n. */
const cell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const ligne = (vals) => vals.map(cell).join(",");
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

// ==============================================================================
// 1) Contexte des tournois : nom, lieu, pays (data/<an>/tournaments.json).
// ==============================================================================
console.log("1) Lecture du calendrier (noms, lieux, pays des tournois)…");
const annees = (await store.listYears()).filter((y) => !ANNEES || ANNEES.includes(Number(y)));
const tmt = new Map(); // id -> { name, lieu, pays }
for (const y of annees) {
  try {
    const t = JSON.parse(await readFile(join(ROOT, "data", String(y), "tournaments.json"), "utf8"));
    for (const m of (Array.isArray(t) ? t : t.results ?? [])) {
      for (const tt of m.tournaments ?? []) {
        tmt.set(Number(tt.id), {
          name: tt.name ?? null,
          lieu: tt.location ?? null,
          pays: /\/([A-Z]{3})\.png/.exec(tt.flag_url || "")?.[1] ?? tt.country ?? null,
        });
      }
    }
  } catch { /* année sans calendrier */ }
}
console.log(`   ${tmt.size} tournois au calendrier (saisons ${annees.join(", ")}).`);

// ==============================================================================
// 2) Rejeu chronologique : Elo et proba d'AVANT match (aucune fuite du futur).
// ==============================================================================
console.log("2) Rejeu walk-forward de l'historique…");
const publications = await loadPublications(join(ROOT, "data", "rankings"));
const rangDe = makeRankLookup(publications);

const init = loadInitialRanks();
const seeds = {};
for (const [disc, m] of Object.entries(init)) {
  const sm = new Map();
  for (const [k, rang] of m) sm.set(k, seedEloByRank(rang));
  seeds[disc] = sm;
}

const nomsDe = (t) => (t?.players ?? []).map((p) => p.nameDisplay).join(" / ");
const paysDe = (t) => [...new Set((t?.players ?? []).map((p) =>
  /\/([A-Z]{3})\.png/.exec(p.countryFlagUrl || "")?.[1] ?? p.countryCode).filter(Boolean))].join("/");

const rows = [];
await computeElo(annees, seeds, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || !match.score.length) return;
    if (match.winner !== 1 && match.winner !== 2) return;
    const jour = String(match.matchTime).slice(0, 10);
    const pts1 = match.score.reduce((s, x) => s + (Number(x.home) || 0), 0);
    const pts2 = match.score.reduce((s, x) => s + (Number(x.away) || 0), 0);
    // Le modèle ne se prononce pas sur les entités provisoires (trop peu de
    // matchs pour que la note veuille dire quelque chose) — colonne vide, pas
    // une valeur inventée.
    const provisoire = isProvisional(a.entity.matches) || isProvisional(b.entity.matches);
    const p = provisoire ? null : recalibrate(eloProb(a.entity.rating, b.entity.rating), disc);
    const info = tmt.get(Number(tmtId)) ?? {};
    rows.push({
      cle: `${tmtId}|${disc}|${jour}|${a.key}|${b.key}`,
      tmtId, disc, jour,
      datetime: match.matchTimeUtc ?? match.matchTime,
      saison: Number(jour.slice(0, 4)),
      tournoi: info.name ?? match.tournamentName ?? null,
      lieu: info.lieu ?? match.locationName ?? null,
      paysTournoi: info.pays ?? null,
      tour: match.roundName ?? null,
      equipe1: nomsDe(match.team1), equipe2: nomsDe(match.team2),
      pays1: paysDe(match.team1), pays2: paysDe(match.team2),
      a: a.key, b: b.key,
      vainqueur: match.winner,
      score: match.score.map((x) => `${x.home}-${x.away}`).join(" "),
      // Empreinte du score : c'est la clé d'appariement de lib/flashscore-join
      // (mêmes équipes + même score + jour ±1) — la passer est indispensable.
      setsBruts: match.score.map((x) => ({ home: x.home, away: x.away })),
      manches: match.score.length,
      troisManches: wentThreeSets(match.score) ? 1 : 0,
      points1: pts1, points2: pts2,
      duree: Number(match.duration) || null,
      elo1: Math.round(a.entity.rating), elo2: Math.round(b.entity.rating),
      proba1: p,
      rang1: rangDe(jour, disc, a.key)?.rank ?? null,
      rang2: rangDe(jour, disc, b.key)?.rank ?? null,
      // renseignés plus bas
      books: null, sets: null,
    });
  },
});
console.log(`   ${rows.length} matchs joués exploitables.`);

// ==============================================================================
// 3) Cotes : marché vainqueur (jointure Flashscore) + marché des manches.
// ==============================================================================
console.log("3) Jointure des cotes…");
const fsFiles = await loadFlashscoreOdds(join(ROOT, "data", "flashscore", "odds"));
const { joined, stats } = joinFlashscore(fsFiles, rows.map((r) => ({
  tmtId: r.tmtId, disc: r.disc, day: r.jour,
  name1: r.equipe1, name2: r.equipe2,
  sets: r.setsBruts, a: r.a, b: r.b,
})));
for (const r of rows) {
  const j = joined.get(r.cle);
  if (j) { r.books = j.books; r.fsId = j.fsId ?? null; }
}
console.log(`   marché vainqueur : ${stats.joined} matchs joints (${stats.ambiguous} ambigus).`);

// Marché des manches : indexé par fsId (data/flashscore/sets/).
const parFsId = new Map();
try {
  const dir = join(ROOT, "data", "flashscore", "sets");
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(await readFile(join(dir, f), "utf8"));
    for (const m of j.matches || []) if (m.scores || m.points) parFsId.set(m.fsId, m);
  }
} catch { /* pas de collecte du marché des manches */ }
let avecManches = 0;
for (const r of rows) {
  const s = r.fsId ? parFsId.get(r.fsId) : null;
  if (s) { r.sets = s; avecManches++; }
}
console.log(`   marché des manches : ${avecManches} matchs (${parFsId.size} en base).`);

// ==============================================================================
// 4) Agrégats de marché — MISABLES UNIQUEMENT (règle de lib/roi.mjs).
// ==============================================================================
/** Meilleure cote d'un camp chez les opérateurs misables. */
function meilleure(books, champ) {
  let best = null;
  for (const [op, b] of Object.entries(books || {})) {
    if (!MISABLES.includes(op)) continue;
    const c = b?.[champ];
    if (c > 1 && (!best || c > best)) best = c;
  }
  return best;
}
/** Proba du marché (camp 1), dé-viggée en proportionnel, moyenne des books
 *  qui cotent LES DEUX camps — un book qui n'en cote qu'un fausserait la marge. */
function probaMarche(books) {
  let s = 0, n = 0;
  for (const [op, b] of Object.entries(books || {})) {
    if (!MISABLES.includes(op)) continue;
    if (!(b?.odd1 > 1) || !(b?.odd2 > 1)) continue;
    const i1 = 1 / b.odd1, i2 = 1 / b.odd2;
    s += i1 / (i1 + i2); n++;
  }
  return n ? { p: s / n, n } : { p: null, n: 0 };
}
/** Marché des manches : « 3 manches » = miser 2-1 ET 1-2 (prix combiné). */
function prixManches(scores) {
  let c3 = null, c2 = null, p3 = null;
  for (const [op, parScore] of Object.entries(scores || {})) {
    if (!MISABLES.includes(op)) continue;
    const v = (k) => Number(parScore?.[k]?.closing) || null;
    const [a, b, c, d] = [v("2-0"), v("2-1"), v("1-2"), v("0-2")];
    if (!(a > 1 && b > 1 && c > 1 && d > 1)) continue;
    const i3 = 1 / b + 1 / c, i2 = 1 / a + 1 / d;
    const t3 = 1 / i3, t2 = 1 / i2;
    if (!c3 || t3 > c3) c3 = t3;
    if (!c2 || t2 > c2) c2 = t2;
    p3 = i3 / (i3 + i2); // dé-viggée
  }
  return { c3, c2, p3 };
}

// ==============================================================================
// 5) Écriture de matches.csv
// ==============================================================================
const COLS = [
  "match_id", "date", "datetime_utc", "saison", "discipline", "tour",
  "tournoi_id", "tournoi", "lieu", "pays_tournoi",
  "equipe1_id", "equipe1", "pays1", "equipe2_id", "equipe2", "pays2",
  "vainqueur", "score", "manches", "trois_manches", "points1", "points2", "duree_min",
  "elo1_avant", "elo2_avant", "proba_modele1", "rang1", "rang2",
  "cote1_cloture", "cote2_cloture", "cote1_ouverture", "cote2_ouverture",
  "proba_marche1", "nb_books",
  "cote_3manches", "cote_2manches", "proba_marche_3manches",
];

await mkdir(OUT_DIR, { recursive: true });
const lignes = [ligne(COLS)];
let avecCotes = 0;
for (const r of rows) {
  const { p: pm, n: nb } = probaMarche(r.books);
  if (nb) avecCotes++;
  const { c3, c2, p3 } = prixManches(r.sets?.scores);
  lignes.push(ligne([
    r.cle, r.jour, r.datetime, r.saison, r.disc, r.tour,
    r.tmtId, r.tournoi, r.lieu, r.paysTournoi,
    r.a, r.equipe1, r.pays1, r.b, r.equipe2, r.pays2,
    r.vainqueur, r.score, r.manches, r.troisManches, r.points1, r.points2, r.duree,
    r.elo1, r.elo2, r4(r.proba1), r.rang1, r.rang2,
    r2(meilleure(r.books, "odd1")), r2(meilleure(r.books, "odd2")),
    r2(meilleure(r.books, "open1")), r2(meilleure(r.books, "open2")),
    r4(pm), nb,
    r2(c3), r2(c2), r4(p3),
  ]));
}
await writeFile(join(OUT_DIR, "matches.csv"), lignes.join("\n") + "\n", "utf8");
console.log(`\n→ matches.csv : ${rows.length} lignes (${avecCotes} avec cotes misables).`);

// ==============================================================================
// 6) Écriture de odds.csv — format long, avec le drapeau `misable`.
// ==============================================================================
const O_COLS = ["match_id", "date", "book", "misable", "marche", "instant", "selection", "cote"];
const oLignes = [ligne(O_COLS)];
let nOdds = 0;
for (const r of rows) {
  // Marché vainqueur : tous les opérateurs présents, misables ou non.
  for (const [op, b] of Object.entries(r.books || {})) {
    const mis = MISABLES.includes(op) ? "true" : "false";
    for (const [instant, k1, k2] of [["close", "odd1", "odd2"], ["open", "open1", "open2"]]) {
      if (b?.[k1] > 1) { oLignes.push(ligne([r.cle, r.jour, op, mis, "vainqueur", instant, "equipe1", r2(b[k1])])); nOdds++; }
      if (b?.[k2] > 1) { oLignes.push(ligne([r.cle, r.jour, op, mis, "vainqueur", instant, "equipe2", r2(b[k2])])); nOdds++; }
    }
  }
  // Marché des manches : cotes par score exact, telles qu'offertes.
  for (const [op, parScore] of Object.entries(r.sets?.scores || {})) {
    const mis = MISABLES.includes(op) ? "true" : "false";
    for (const [sc, v] of Object.entries(parScore || {})) {
      for (const [instant, k] of [["close", "closing"], ["open", "opening"]]) {
        if (v?.[k] > 1) { oLignes.push(ligne([r.cle, r.jour, op, mis, "score_manches", instant, sc, r2(v[k])])); nOdds++; }
      }
    }
  }
  // Marché du total de points (plus/moins de N points dans le match).
  for (const [op, lgs] of Object.entries(r.sets?.points || {})) {
    const mis = MISABLES.includes(op) ? "true" : "false";
    for (const l of lgs || []) {
      for (const [instant, k] of [["close", "closing"], ["open", "opening"]]) {
        if (l?.[k] > 1) { oLignes.push(ligne([r.cle, r.jour, op, mis, "total_points", instant, `${l.selection} ${l.total}`, r2(l[k])])); nOdds++; }
      }
    }
  }
}
await writeFile(join(OUT_DIR, "odds.csv"), oLignes.join("\n") + "\n", "utf8");
console.log(`→ odds.csv    : ${nOdds} lignes.`);

// ==============================================================================
// 7) Dictionnaire des colonnes — un export sans mode d'emploi est inexploitable.
// ==============================================================================
const readme = `# Jeu de données BWF — export plat

Généré le ${new Date().toISOString().slice(0, 10)} par \`node tools/export-dataset.mjs\`.
Saisons : ${annees.join(", ")}. ${rows.length} matchs joués, ${avecCotes} avec cotes.

Deux fichiers CSV (UTF-8, séparateur \`,\`, échappement RFC 4180) :
\`matches.csv\` (une ligne par match) et \`odds.csv\` (le détail par opérateur).

## Garantie anti-fuite

\`proba_modele1\`, \`elo1_avant\`, \`elo2_avant\`, \`rang1\` et \`rang2\` sont les valeurs
connues **avant** le match : rejeu chronologique, classement de la dernière
publication antérieure. Un backtest fait sur ce fichier ne peut pas tricher avec
le futur.

## matches.csv

| Colonne | Description |
|---|---|
| \`match_id\` | Clé stable \`tournoi\|discipline\|date\|equipe1_id\|equipe2_id\`. Fait la jointure avec \`odds.csv\`. |
| \`date\`, \`datetime_utc\` | Jour du match, et horodatage UTC quand il est connu. |
| \`saison\` | Année civile. |
| \`discipline\` | \`MS\` simple hommes, \`WS\` simple dames, \`MD\` double hommes, \`WD\` double dames, \`XD\` double mixte. |
| \`tour\` | Tour du tableau (R32, R16, quart…). |
| \`tournoi_id\`, \`tournoi\`, \`lieu\`, \`pays_tournoi\` | Identité et localisation du tournoi. |
| \`equipe1_id\`, \`equipe2_id\` | Identifiant d'entité : l'id du joueur en simple, \`pair:<id>-<id>\` (ids triés) en double. |
| \`equipe1\`, \`equipe2\`, \`pays1\`, \`pays2\` | Noms affichés et codes pays. |
| \`vainqueur\` | \`1\` ou \`2\`. **C'est la cible à prédire.** |
| \`score\` | Manches séparées par une espace, ex. \`21-12 19-21 21-15\` (du point de vue de l'équipe 1). |
| \`manches\`, \`trois_manches\` | Nombre de manches jouées ; \`1\` si le match est allé en 3 manches. |
| \`points1\`, \`points2\`, \`duree_min\` | Points totaux marqués et durée en minutes (vide si non renseignée). |
| \`elo1_avant\`, \`elo2_avant\` | Notes Elo d'avant match (échelle type échecs, départ ~1500). |
| \`proba_modele1\` | Probabilité que l'équipe 1 gagne, selon le modèle (Elo recalibré). **Vide** quand une des entités est encore provisoire (trop peu de matchs). |
| \`rang1\`, \`rang2\` | Classement mondial BWF à la dernière publication antérieure. Souvent **vide avant 2024** : les publications anciennes ne sont pas récupérables. |
| \`cote1_cloture\`, \`cote2_cloture\` | Meilleure cote décimale à la clôture, **opérateurs misables uniquement**. |
| \`cote1_ouverture\`, \`cote2_ouverture\` | Idem à l'ouverture du marché. |
| \`proba_marche1\` | Probabilité implicite de l'équipe 1, marge retirée (dé-vig proportionnel), moyenne des opérateurs cotant les deux camps. |
| \`nb_books\` | Nombre d'opérateurs misables ayant coté les deux camps. \`0\` = pas de cotes. |
| \`cote_3manches\`, \`cote_2manches\` | Prix combiné du marché « nombre de manches » (3 manches = miser 2-1 **et** 1-2). Vide avant 2023. |
| \`proba_marche_3manches\` | Probabilité de 3 manches selon le marché, marge retirée. |

## odds.csv

Une ligne par **match × opérateur × marché × instant × sélection**.

| Colonne | Description |
|---|---|
| \`match_id\`, \`date\` | Jointure vers \`matches.csv\`. |
| \`book\` | \`betclic\`, \`unibet\`, \`winamax\`, \`bwin\`, \`netbet\`. |
| \`misable\` | **À LIRE.** \`true\` = opérateur sur lequel on peut réellement parier. \`false\` = cote de **référence** (bwin, NetBet), conservée pour la mesure mais **jamais jouable**. |
| \`marche\` | \`vainqueur\`, \`score_manches\`, \`total_points\`. |
| \`instant\` | \`open\` (ouverture du marché) ou \`close\` (juste avant le match). |
| \`selection\` | \`equipe1\`/\`equipe2\` ; ou le score exact \`2-0\`, \`2-1\`, \`1-2\`, \`0-2\` ; ou \`OVER 73.5\`/\`UNDER 73.5\`. |
| \`cote\` | Cote décimale. |

### Le piège à ne pas reproduire

Si vous calculez une rentabilité, **filtrez sur \`misable = true\`**. Inclure les
cotes de référence donne un résultat flatteur et faux : ce sont des prix qu'on ne
peut pas jouer. C'est le garde-fou que le projet applique dans sa propre chaîne.

## Trous connus, à ne pas prendre pour des erreurs

- **Classement mondial** : indisponible sur 2022-2023 (les publications anciennes
  ne sont plus servies par l'API et le site tiers exige un compte).
- **Marché des manches** : rien en 2022 — aucun opérateur ne le cotait cette
  saison-là. À partir de 2023, il repose sur **Betclic quasi seul**.
- **Cotes vainqueur** : Winamax est absent avant 2025 ; sur 2022 plusieurs
  tournois ne sont couverts que par bwin/NetBet (donc \`misable = false\`).
- **Matchs sans cotes** : \`nb_books = 0\`. Normal sur les tournois anciens.
- Les forfaits (walkovers) et les matchs non joués sont **exclus** de l'export.
`;
await writeFile(join(OUT_DIR, "README.md"), readme, "utf8");
console.log(`→ README.md   : dictionnaire des colonnes.`);
console.log(`\n✅ Export dans ${OUT_DIR}`);

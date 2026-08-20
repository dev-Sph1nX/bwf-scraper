// tools/export-dataset.mjs
// EXPORT PORTABLE — deux CSV plats de RÉSULTATS, qui remplacent les 1 900 JSON
// de data/ (224 Mo) pour réutiliser le palmarès du circuit dans un autre projet,
// un notebook ou Excel.
//
//   node tools/export-dataset.mjs                  # tout l'historique -> export/
//   node tools/export-dataset.mjs --annees=2024,2025,2026
//   node tools/export-dataset.mjs --out=/tmp/bwf
//
// PRODUIT :
//   export/matches.csv  une ligne par match JOUÉ : identité du match, résultat
//                       détaillé, et le classement mondial des deux camps.
//   export/players.csv  une ligne par JOUEUR apparaissant dans matches.csv :
//                       état civil, physique, bilan de carrière, classement.
//   export/cotes.csv    une ligne par match × opérateur : les trois marchés
//                       (vainqueur, score exact, total de points) à l'ouverture
//                       ET à la clôture, plus les indicateurs dérivés utiles à
//                       une analyse de prédiction (marge, probas dé-viguées,
//                       dérive du marché, écart entre marchés).
//   export/cotes-totaux.csv  l'échelle complète des lignes over/under, qu'une
//                       ligne par opérateur ne peut pas porter (58 % des
//                       couples match × opérateur en ont plusieurs).
//   export/README.md    le dictionnaire des colonnes (unités, pièges, trous).
//
// PÉRIMÈTRE. Demande du propriétaire (2026-08-20) : les prédictions du MODÈLE
// (Elo, probabilités calibrées) restent HORS export — elles appartiennent à la
// chaîne du projet (build-data, backtest). Les cotes, elles, sont exportées :
// ce sont des données de marché observées, la matière d'une analyse de
// prédiction. Ne pas rajouter les colonnes de modèle « au cas où ».
//
// ANTI-FUITE SUR LE CLASSEMENT : dans matches.csv, `rang1`/`rang2` sont lus dans
// la dernière publication ANTÉRIEURE au match, jamais celle qui l'a suivi (le
// classement publié après coup intègre déjà le résultat). Une analyse faite sur
// ce CSV ne peut donc pas tricher avec le futur via le rang.
//
// ATTENTION, players.csv N'A PAS cette propriété et ne peut pas l'avoir : une
// fiche joueur est par nature un état agrégé (bilan de carrière, meilleur rang)
// qui regarde tout l'historique. Ne pas s'en servir comme variable explicative
// d'un match passé sans y réfléchir — l'avertissement est répété dans le README.

import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "../lib/store.mjs";
import { computeElo } from "../lib/elo.mjs";
import { isWalkover, makeRankLookup } from "../lib/dataset.mjs";
import { loadPublications, buildPlayerRankHistory } from "../lib/rank-history.mjs";
import { loadFlashscoreOdds, joinFlashscore } from "../lib/flashscore-join.mjs";
import { BOOKS as MISABLES } from "../lib/roi.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n) => (process.argv.find((x) => x.startsWith(`--${n}=`)) || "").split("=")[1] || null;
const ANNEES = arg("annees")?.split(",").map(Number) ?? null;
const OUT_DIR = arg("out") || join(ROOT, "export");
const DOUBLES = new Set(["MD", "WD", "XD"]);

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
// 2) Parcours chronologique de l'historique.
//
// On emprunte le rejeu de computeElo plutôt que de re-filtrer les matchs à la
// main : il donne le tri chronologique, l'exclusion des disciplines inconnues
// et surtout la CLÉ D'ENTITÉ (id du joueur en simple, `pair:` en double) déjà
// utilisée partout dans le projet. Les notes Elo qu'il calcule au passage ne
// sont pas exportées — c'est l'itérateur qui nous intéresse, et il garantit que
// l'export couvre exactement le même univers de matchs que le reste de la
// chaîne. Pas de graine (`{}`) : sans Elo exporté, elle n'aurait aucun effet.
//
// Les fiches joueurs sont accumulées DANS cette boucle, donc sur exactement les
// mêmes matchs que matches.csv : la colonne `matchs` de players.csv est
// vérifiable en comptant les lignes de matches.csv, sans écart possible.
// ==============================================================================
console.log("2) Parcours de l'historique…");
const publications = await loadPublications(join(ROOT, "data", "rankings"));
const rangDe = makeRankLookup(publications);

const nomsDe = (t) => (t?.players ?? []).map((p) => p.nameDisplay).join(" / ");
const paysDe = (t) => [...new Set((t?.players ?? []).map((p) =>
  /\/([A-Z]{3})\.png/.exec(p.countryFlagUrl || "")?.[1] ?? p.countryCode).filter(Boolean))].join("/");

const rows = [];
const joueurs = new Map(); // id -> fiche en construction

/** Cumule un match dans la fiche des joueurs d'un camp. */
function noteJoueurs(players, { disc, jour, saison, tmtId, gagne, pour, contre }) {
  for (const p of players ?? []) {
    const id = String(p.id);
    let f = joueurs.get(id);
    if (!f) {
      f = {
        id, matchs: 0, v: 0, simple: 0, double: 0,
        disc: new Set(), tmt: new Set(), saisons: new Set(),
        premier: jour, dernier: jour, pour: 0, contre: 0,
      };
      joueurs.set(id, f);
    }
    // Le parcours est chronologique : le DERNIER match vu porte le nom, le pays
    // et la photo les plus à jour (un joueur peut changer de nation).
    f.p = p;
    f.matchs++;
    if (gagne) f.v++;
    if (DOUBLES.has(disc)) f.double++; else f.simple++;
    f.disc.add(disc); f.tmt.add(Number(tmtId)); f.saisons.add(saison);
    if (jour < f.premier) f.premier = jour;
    if (jour > f.dernier) f.dernier = jour;
    f.pour += pour; f.contre += contre;
  }
}

await computeElo(annees, {}, {
  onMatch: ({ tmtId, disc, match, a, b }) => {
    if (isWalkover(match) || !match.matchTime) return;
    if (!Array.isArray(match.score) || !match.score.length) return;
    if (match.winner !== 1 && match.winner !== 2) return;
    const jour = String(match.matchTime).slice(0, 10);
    const saison = Number(jour.slice(0, 4));
    const pts1 = match.score.reduce((s, x) => s + (Number(x.home) || 0), 0);
    const pts2 = match.score.reduce((s, x) => s + (Number(x.away) || 0), 0);
    const info = tmt.get(Number(tmtId)) ?? {};
    const commun = { disc, jour, saison, tmtId };
    noteJoueurs(match.team1?.players, { ...commun, gagne: match.winner === 1, pour: pts1, contre: pts2 });
    noteJoueurs(match.team2?.players, { ...commun, gagne: match.winner === 2, pour: pts2, contre: pts1 });
    rows.push({
      cle: `${tmtId}|${disc}|${jour}|${a.key}|${b.key}`,
      tmtId, disc, jour,
      datetime: match.matchTimeUtc ?? match.matchTime,
      saison,
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
      // (mêmes équipes + même score + jour ±1). Pas exportée telle quelle.
      setsBruts: match.score.map((x) => ({ home: x.home, away: x.away })),
      manches: match.score.length,
      points1: pts1, points2: pts2,
      duree: Number(match.duration) || null,
      // Dernière publication ANTÉRIEURE au match (cf. en-tête : anti-fuite).
      rang1: rangDe(jour, disc, a.key)?.rank ?? null,
      rang2: rangDe(jour, disc, b.key)?.rank ?? null,
    });
  },
});
console.log(`   ${rows.length} matchs joués exploitables, ${joueurs.size} joueurs distincts.`);

// ==============================================================================
// 3) Écriture de matches.csv
// ==============================================================================
const COLS = [
  "match_id", "date", "datetime_utc", "saison", "discipline", "tour",
  "tournoi_id", "tournoi", "lieu", "pays_tournoi",
  "equipe1_id", "equipe1", "pays1", "equipe2_id", "equipe2", "pays2",
  "vainqueur", "score", "manches", "points1", "points2", "duree_min",
  "rang1", "rang2",
];

await mkdir(OUT_DIR, { recursive: true });
const lignes = [ligne(COLS)];
// Couverture du classement par saison : c'est LE trou du jeu de données, autant
// le mesurer à chaque export plutôt que de laisser l'utilisateur le découvrir.
const couv = new Map(); // saison -> { n, deux, un }
for (const r of rows) {
  const c = couv.get(r.saison) ?? { n: 0, deux: 0, un: 0 };
  const k = (r.rang1 ? 1 : 0) + (r.rang2 ? 1 : 0);
  c.n++; if (k === 2) c.deux++; else if (k === 1) c.un++;
  couv.set(r.saison, c);
  lignes.push(ligne([
    r.cle, r.jour, r.datetime, r.saison, r.disc, r.tour,
    r.tmtId, r.tournoi, r.lieu, r.paysTournoi,
    r.a, r.equipe1, r.pays1, r.b, r.equipe2, r.pays2,
    r.vainqueur, r.score, r.manches, r.points1, r.points2, r.duree,
    r.rang1, r.rang2,
  ]));
}
await writeFile(join(OUT_DIR, "matches.csv"), lignes.join("\n") + "\n", "utf8");
console.log(`\n→ matches.csv : ${rows.length} lignes × ${COLS.length} colonnes.`);

const saisons = [...couv.keys()].sort();
const pct = (x, n) => `${((100 * x) / n).toFixed(1)} %`;
const tableauRangs = saisons.map((s) => {
  const c = couv.get(s);
  return `| ${s} | ${c.n} | ${pct(c.deux, c.n)} | ${pct(c.un, c.n)} | ${pct(c.n - c.deux - c.un, c.n)} |`;
}).join("\n");
for (const s of saisons) {
  const c = couv.get(s);
  console.log(`   classement ${s} : ${pct(c.deux, c.n)} des matchs avec les 2 rangs connus.`);
}

// ==============================================================================
// 4) Écriture de players.csv
//
// Trois sources fusionnées sur l'id BWF du joueur :
//   - les draws (nom, prénom, pays, photo) : présents pour 100 % des joueurs ;
//   - data/players/birthdates.json (naissance, main, taille) : partiel, cf.
//     data/players/birthdates-rapport.md pour la méthode et les sources ;
//   - data/rankings/ (classement hebdomadaire) : archive 2024+ seulement.
// ==============================================================================
console.log("\n3) Fiches joueurs…");
let bio = {};
try {
  bio = JSON.parse(await readFile(join(ROOT, "data", "players", "birthdates.json"), "utf8"));
} catch { console.log("   ⚠ data/players/birthdates.json absent : colonnes bio vides."); }

// Séries hebdomadaires de classement, par joueur : [{ t, disc, rank, points }].
const rangHist = buildPlayerRankHistory(publications);
const dernierePub = publications.at(-1)?.date ?? null;

/** L'avatar BWF est parfois un dessin générique : ce n'est pas une photo. */
const vraiePhoto = (u) => (u && !/profile_(male|female)\./i.test(u) ? u : null);

const P_COLS = [
  "player_id", "nom", "prenom", "nom_famille", "slug", "pays",
  "date_naissance", "main", "taille_cm", "source_bio", "photo_url",
  "matchs", "victoires", "defaites", "taux_victoire",
  "matchs_simple", "matchs_double", "disciplines", "tournois",
  "premier_match", "dernier_match", "saisons", "points_gagnes", "points_concedes",
  "rang_actuel", "rang_actuel_discipline", "points_actuels",
  "meilleur_rang_depuis_2024", "meilleur_rang_discipline", "meilleur_rang_date",
];

// Tri par volume de matchs décroissant : les joueurs qui comptent en premier,
// comme players.json de l'app. Un CSV ouvert dans Excel devient lisible d'emblée.
const fiches = [...joueurs.values()].sort((x, y) => y.matchs - x.matchs || x.id.localeCompare(y.id));
const pLignes = [ligne(P_COLS)];
const cptBio = { dob: 0, main: 0, taille: 0, photo: 0, classe: 0 };
let appTot = 0;
const cptApp = { dob: 0, main: 0, taille: 0, photo: 0, classe: 0 };

for (const f of fiches) {
  const b = bio[f.id] ?? {};
  const photo = vraiePhoto(f.p.avatar?.thumbnailUrl);
  const h = rangHist[f.id] ?? [];

  // Meilleur rang jamais atteint DANS L'ARCHIVE (2024+), pas de la carrière.
  let best = null;
  for (const e of h) if (!best || e.rank < best.rank) best = e;
  // Rang « actuel » = celui de la dernière publication de l'archive. Un joueur
  // sorti du classement n'y figure pas : colonne vide, ce qui est l'information.
  let actuel = null;
  for (const e of h) {
    if (e.t !== dernierePub) continue;
    if (!actuel || e.rank < actuel.rank) actuel = e;
  }

  appTot += f.matchs;
  if (b.dob) { cptBio.dob++; cptApp.dob += f.matchs; }
  if (b.hand) { cptBio.main++; cptApp.main += f.matchs; }
  if (b.height) { cptBio.taille++; cptApp.taille += f.matchs; }
  if (photo) { cptBio.photo++; cptApp.photo += f.matchs; }
  if (h.length) { cptBio.classe++; cptApp.classe += f.matchs; }

  pLignes.push(ligne([
    f.id, f.p.nameDisplay, f.p.firstName, f.p.lastName, f.p.slug,
    /\/([A-Z]{3})\.png/.exec(f.p.countryFlagUrl || "")?.[1] ?? f.p.countryCode ?? null,
    b.dob ?? null, b.hand ?? null, b.height ?? null, b.source ?? null, photo,
    f.matchs, f.v, f.matchs - f.v, r4(f.v / f.matchs),
    f.simple, f.double,
    [...f.disc].sort().join(";"), f.tmt.size,
    f.premier, f.dernier, [...f.saisons].sort().join(";"),
    f.pour, f.contre,
    actuel?.rank ?? null, actuel?.disc ?? null, actuel?.points ?? null,
    best?.rank ?? null, best?.disc ?? null, best?.t ?? null,
  ]));
}
await writeFile(join(OUT_DIR, "players.csv"), pLignes.join("\n") + "\n", "utf8");
console.log(`→ players.csv : ${fiches.length} lignes × ${P_COLS.length} colonnes.`);

// La couverture pondérée par apparitions est la métrique utile : un joueur à
// 200 matchs pèse 100 fois plus qu'un joueur à 2 matchs dans une analyse.
const n = fiches.length;
const couvLigne = (lib, k) =>
  `| ${lib} | ${cptBio[k]} (${pct(cptBio[k], n)}) | **${pct(cptApp[k], appTot)}** |`;
const tableauBio = [
  couvLigne("`date_naissance`", "dob"),
  couvLigne("`main`", "main"),
  couvLigne("`taille_cm`", "taille"),
  couvLigne("`photo_url`", "photo"),
  couvLigne("Classé au moins une fois (2024+)", "classe"),
].join("\n");
console.log(`   naissance ${pct(cptApp.dob, appTot)} des apparitions, ` +
  `main ${pct(cptApp.main, appTot)}, taille ${pct(cptApp.taille, appTot)}, ` +
  `classement ${pct(cptApp.classe, appTot)}.`);

// ==============================================================================
// 5) Écriture de cotes.csv + cotes-totaux.csv
//
// Source : data/flashscore/odds/ (marché vainqueur, ouverture + clôture) et
// data/flashscore/sets/ (score exact et total de points). La jointure vers nos
// matchs passe par l'EMPREINTE DE SCORE (lib/flashscore-join) : les noms
// Flashscore sont abrégés, le score exact ne l'est pas.
//
// ORIENTATION — LE PIÈGE DE CE FICHIER. joinFlashscore rend les cotes du marché
// vainqueur déjà retournées vers notre team1/team2, mais les marchés de
// data/flashscore/sets/ sont stockés dans l'orientation Flashscore : « 2-0 »
// y désigne le home Flashscore, qui est notre team2 quand `swap` vaut true. On
// remet donc les scores exacts dans NOTRE orientation avant d'écrire, sinon la
// colonne cs_2_0 décrirait un camp différent d'une ligne à l'autre.
// ==============================================================================
console.log("\n4) Cotes…");
const fsFiles = await loadFlashscoreOdds(join(ROOT, "data", "flashscore", "odds"));
const { joined, stats } = joinFlashscore(fsFiles, rows.map((r) => ({
  tmtId: r.tmtId, disc: r.disc, day: r.jour,
  name1: r.equipe1, name2: r.equipe2,
  sets: r.setsBruts, a: r.a, b: r.b,
})));
console.log(`   marché vainqueur : ${stats.joined} matchs joints sur ${stats.fsMatches} ` +
  `(${stats.unmatched} non appariés, ${stats.ambiguous} ambigus).`);

// Marchés score exact / total de points : indexés par identifiant Flashscore.
const parFsId = new Map();
try {
  const dir = join(ROOT, "data", "flashscore", "sets");
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
    const j = JSON.parse(await readFile(join(dir, f), "utf8"));
    for (const m of j.matches || []) if (m.scores || m.points) parFsId.set(m.fsId, m);
  }
} catch { console.log("   ⚠ data/flashscore/sets absent : marchés dérivés vides."); }

/** Somme des inverses d'un jeu de cotes, ou null si l'une manque. */
function inverses(cotes) {
  let s = 0;
  for (const c of cotes) { if (!(c > 1)) return null; s += 1 / c; }
  return s;
}
/** Marge de l'opérateur (overround) : ce qu'il prend sur le marché complet. */
const marge = (cotes) => { const s = inverses(cotes); return s == null ? null : s - 1; };
/** Proba dé-viguée en PROPORTIONNEL d'une issue au sein d'un marché complet. */
function devig(part, cotes) {
  const s = inverses(cotes);
  return s == null || !(part > 1) ? null : 1 / part / s;
}
/** Idem pour un GROUPE d'issues (ex. « 3 manches » = 2-1 plus 1-2). */
function devigGroupe(parts, cotes) {
  const s = inverses(cotes);
  const p = inverses(parts);
  return s == null || p == null ? null : p / s;
}

// Score exact : nos clés, et leur miroir pour le cas swap.
const CS = ["2-0", "2-1", "1-2", "0-2"];
const MIROIR = { "2-0": "0-2", "2-1": "1-2", "1-2": "2-1", "0-2": "2-0" };

const C_COLS = [
  "match_id", "date", "discipline", "fs_id", "book", "misable",
  "vainqueur", "manches", "points_total",
  "cote1_ouverture", "cote1_cloture", "cote2_ouverture", "cote2_cloture",
  "marge_ouverture", "marge_cloture",
  "proba1_ouverture", "proba1_cloture", "derive_proba1",
  "cs_2_0_ouverture", "cs_2_0_cloture", "cs_2_1_ouverture", "cs_2_1_cloture",
  "cs_1_2_ouverture", "cs_1_2_cloture", "cs_0_2_ouverture", "cs_0_2_cloture",
  "marge_manches_cloture", "proba_3manches_cloture",
  "proba1_manches_cloture", "ecart_proba1_manches",
  "total_ligne", "cote_over_ouverture", "cote_over_cloture",
  "cote_under_ouverture", "cote_under_cloture", "proba_over_cloture", "total_lignes",
];
const T_COLS = [
  "match_id", "date", "book", "misable", "total",
  "cote_over_ouverture", "cote_over_cloture",
  "cote_under_ouverture", "cote_under_cloture",
  "proba_over_cloture", "points_total", "resultat_over",
];

const cLignes = [ligne(C_COLS)];
const tLignes = [ligne(T_COLS)];
let nMatchsCotes = 0, nLignesCotes = 0, nTotaux = 0, nSwap = 0;
// Calibration des probas dé-viguées, mesurée à chaque export sur les seuls
// opérateurs misables : ces trois marchés ont des biais SYSTÉMATIQUES qu'un
// consommateur doit connaître avant de prendre la colonne pour une vérité.
// Les mesurer ici, c'est garantir qu'elles ne vieillissent pas dans le README.
const cal = {
  v: { n: 0, p: 0, o: 0 },   // vainqueur
  m: { n: 0, p: 0, o: 0 },   // 3 manches
  t: { n: 0, p: 0, o: 0 },   // over
};
const parBook = new Map();   // opérateur -> lignes produites
const parAnnee = new Map();  // saison -> { m, avec }

for (const r of rows) {
  const c = parAnnee.get(r.saison) ?? { m: 0, avec: 0 };
  c.m++;
  const j = joined.get(r.cle);
  if (!j) { parAnnee.set(r.saison, c); continue; }
  c.avec++; parAnnee.set(r.saison, c);
  nMatchsCotes++;
  if (j.swap) nSwap++;
  const extra = j.fsId ? parFsId.get(j.fsId) : null;
  const ptsTotal = r.points1 + r.points2;

  // Un opérateur peut n'être présent que sur un seul des trois marchés : on
  // prend l'union, sinon les cotes de score exact de Betclic disparaîtraient
  // sur les matchs où il n'a pas coté le vainqueur.
  const ops = new Set([
    ...Object.keys(j.books || {}),
    ...Object.keys(extra?.scores || {}),
    ...Object.keys(extra?.points || {}),
  ]);

  for (const op of [...ops].sort()) {
    const b = j.books?.[op] ?? {};
    const misable = MISABLES.includes(op);

    // --- marché vainqueur ---------------------------------------------------
    const pO = devig(b.open1, [b.open1, b.open2]);
    const pC = devig(b.odd1, [b.odd1, b.odd2]);

    // --- score exact, remis dans NOTRE orientation --------------------------
    const cs = (sc, instant) => {
      const k = j.swap ? MIROIR[sc] : sc;
      return Number(extra?.scores?.[op]?.[k]?.[instant]) || null;
    };
    const csC = CS.map((sc) => cs(sc, "closing"));
    const p3 = devigGroupe([csC[1], csC[2]], csC);          // 2-1 ou 1-2
    const p1m = devigGroupe([csC[0], csC[1]], csC);          // 2-0 ou 2-1

    // --- total de points : l'échelle complète, puis la ligne principale -----
    // Ligne principale = celle dont les deux prix de clôture sont les plus
    // proches, donc l'estimation centrale du marché. Les autres ne sont pas
    // perdues : elles partent dans cotes-totaux.csv.
    const echelle = new Map(); // total -> { oO, oC, uO, uC }
    for (const l of extra?.points?.[op] ?? []) {
      const e = echelle.get(l.total) ?? {};
      const sel = String(l.selection).toUpperCase() === "OVER" ? "o" : "u";
      e[`${sel}O`] = Number(l.opening) || null;
      e[`${sel}C`] = Number(l.closing) || null;
      echelle.set(l.total, e);
    }
    let principale = null;
    for (const [total, e] of echelle) {
      const pOver = devig(e.oC, [e.oC, e.uC]);
      tLignes.push(ligne([
        r.cle, r.jour, op, misable, total,
        r2(e.oO), r2(e.oC), r2(e.uO), r2(e.uC), r4(pOver),
        ptsTotal, ptsTotal > total ? 1 : 0,
      ]));
      nTotaux++;
      if (misable && pOver != null) { cal.t.n++; cal.t.p += pOver; cal.t.o += ptsTotal > total ? 1 : 0; }
      const ecart = e.oC > 1 && e.uC > 1 ? Math.abs(1 / e.oC - 1 / e.uC) : Infinity;
      if (!principale || ecart < principale.ecart) principale = { total, e, ecart, pOver };
    }

    cLignes.push(ligne([
      r.cle, r.jour, r.disc, j.fsId, op, misable,
      r.vainqueur, r.manches, ptsTotal,
      r2(b.open1), r2(b.odd1), r2(b.open2), r2(b.odd2),
      r4(marge([b.open1, b.open2])), r4(marge([b.odd1, b.odd2])),
      r4(pO), r4(pC), r4(pC != null && pO != null ? pC - pO : null),
      r2(cs("2-0", "opening")), r2(csC[0]), r2(cs("2-1", "opening")), r2(csC[1]),
      r2(cs("1-2", "opening")), r2(csC[2]), r2(cs("0-2", "opening")), r2(csC[3]),
      r4(marge(csC)), r4(p3),
      r4(p1m), r4(p1m != null && pC != null ? p1m - pC : null),
      principale?.total ?? null,
      r2(principale?.e.oO), r2(principale?.e.oC),
      r2(principale?.e.uO), r2(principale?.e.uC),
      r4(principale?.pOver), echelle.size,
    ]));
    nLignesCotes++;
    parBook.set(op, (parBook.get(op) || 0) + 1);
    if (misable && pC != null) { cal.v.n++; cal.v.p += pC; cal.v.o += r.vainqueur === 1 ? 1 : 0; }
    if (misable && p3 != null) { cal.m.n++; cal.m.p += p3; cal.m.o += r.manches === 3 ? 1 : 0; }
  }
}
await writeFile(join(OUT_DIR, "cotes.csv"), cLignes.join("\n") + "\n", "utf8");
await writeFile(join(OUT_DIR, "cotes-totaux.csv"), tLignes.join("\n") + "\n", "utf8");
console.log(`→ cotes.csv   : ${nLignesCotes} lignes × ${C_COLS.length} colonnes ` +
  `(${nMatchsCotes} matchs cotés, ${pct(nMatchsCotes, rows.length)} de l'export).`);
console.log(`→ cotes-totaux.csv : ${nTotaux} lignes × ${T_COLS.length} colonnes.`);
console.log(`   par opérateur : ${[...parBook.entries()].sort((a, b) => b[1] - a[1])
  .map(([o, n]) => `${o} ${n}${MISABLES.includes(o) ? "" : " (réf.)"}`).join(", ")}.`);
if (nSwap) console.log(`   ⚠ ${nSwap} matchs en orientation Flashscore inversée (score exact remis d'aplomb).`);

const annCotes = [...parAnnee.keys()].sort();
const tableauCotes = annCotes.map((a) => {
  const v = parAnnee.get(a);
  return `| ${a} | ${v.m} | ${v.avec} | ${pct(v.avec, v.m)} |`;
}).join("\n");
const tableauBooks = [...parBook.entries()].sort((a, b) => b[1] - a[1])
  .map(([o, n]) => `| \`${o}\` | ${n} | ${MISABLES.includes(o) ? "oui" : "**non — référence**"} |`)
  .join("\n");
const calLigne = (lib, col, c) => `| ${lib} | \`${col}\` | ${c.n} | ${pct(c.p, c.n)} | ${pct(c.o, c.n)} |`;
const tableauCal = [
  calLigne("Équipe 1 gagne", "proba1_cloture", cal.v),
  calLigne("Match en 3 manches", "proba_3manches_cloture", cal.m),
  calLigne("Total dépassé", "proba_over_cloture", cal.t),
].join("\n");
console.log(`   calibration (misables) : vainqueur ${pct(cal.v.p, cal.v.n)} prédit / ` +
  `${pct(cal.v.o, cal.v.n)} observé · 3 manches ${pct(cal.m.p, cal.m.n)} / ${pct(cal.m.o, cal.m.n)} · ` +
  `over ${pct(cal.t.p, cal.t.n)} / ${pct(cal.t.o, cal.t.n)}.`);

// ==============================================================================
// 6) Dictionnaire des colonnes — un export sans mode d'emploi est inexploitable.
// ==============================================================================
const readme = `# Résultats BWF World Tour — export plat

Généré le ${new Date().toISOString().slice(0, 10)} par \`node tools/export-dataset.mjs\`
(\`npm run export\` à la racine du projet).
Saisons : ${annees.join(", ")}. **${rows.length} matchs joués**, **${fiches.length} joueurs**.

Quatre fichiers CSV (UTF-8, séparateur \`,\`, échappement RFC 4180) :

| Fichier | Grain | Lignes × colonnes |
|---|---|---|
| \`matches.csv\` | un match joué | ${rows.length} × ${COLS.length} |
| \`players.csv\` | un joueur | ${fiches.length} × ${P_COLS.length} |
| \`cotes.csv\` | un match × un opérateur | ${nLignesCotes} × ${C_COLS.length} |
| \`cotes-totaux.csv\` | un match × opérateur × ligne de total | ${nTotaux} × ${T_COLS.length} |

Données **observées** : résultats et cotes de marché. Les prédictions du modèle
du projet (Elo, probabilités calibrées) ne sont pas exportées.

## Comment joindre les deux fichiers

\`matches.csv\` identifie un camp par une **entité**, pas par un joueur — parce
qu'en double c'est la paire qui joue :

- simple : \`equipe1_id = p:57945\` → \`player_id = 57945\`
- double : \`equipe1_id = pair:51074-52749\` → deux \`player_id\` : \`51074\` et \`52749\`

Donc, en SQL ou en pandas, retirer le préfixe et éclater sur \`-\` :

\`\`\`python
import pandas as pd
m = pd.read_csv("matches.csv"); p = pd.read_csv("players.csv")

def ids(e):  # "p:57945" -> [57945] ; "pair:51074-52749" -> [51074, 52749]
    return [int(x) for x in e.split(":", 1)[1].split("-")]

long = (m.assign(player_id=m.equipe1_id.map(ids))
         .explode("player_id")
         .merge(p, on="player_id", how="left"))
\`\`\`

## matches.csv

| Colonne | Description |
|---|---|
| \`match_id\` | Clé stable \`tournoi\|discipline\|date\|equipe1_id\|equipe2_id\`. Unique, utilisable comme clé primaire. |
| \`date\`, \`datetime_utc\` | Jour du match, et horodatage UTC quand il est connu (sinon minuit). |
| \`saison\` | Année civile. |
| \`discipline\` | \`MS\` simple hommes, \`WS\` simple dames, \`MD\` double hommes, \`WD\` double dames, \`XD\` double mixte. |
| \`tour\` | Tour du tableau (\`R32\`, \`R16\`, quart, demi, finale…). |
| \`tournoi_id\`, \`tournoi\`, \`lieu\`, \`pays_tournoi\` | Identité et localisation du tournoi. |
| \`equipe1_id\`, \`equipe2_id\` | Identifiant d'entité : \`p:<id>\` le joueur en simple, \`pair:<id>-<id>\` (ids triés) la paire en double. Stable d'une saison à l'autre : c'est la bonne clé pour agréger par joueur ou par paire. |
| \`equipe1\`, \`equipe2\` | Noms affichés (\`NOM Prénom\`, séparés par \` / \` en double). |
| \`pays1\`, \`pays2\` | Codes pays ISO-3 (séparés par \`/\` si la paire est mixte-nation). |
| \`vainqueur\` | \`1\` ou \`2\`. |
| \`score\` | Manches séparées par une espace, ex. \`21-12 19-21 21-15\`, **du point de vue de l'équipe 1**. |
| \`manches\` | Nombre de manches jouées (2 ou 3). |
| \`points1\`, \`points2\` | Points totaux marqués sur l'ensemble du match. |
| \`duree_min\` | Durée en minutes. **Vide** quand la fédération ne l'a pas renseignée. |
| \`rang1\`, \`rang2\` | Classement mondial BWF des deux camps **au moment du match** : rang dans la dernière publication hebdomadaire *antérieure* au match, dans la discipline concernée. Voir le trou plus bas. |

### Pourquoi le rang est celui d'AVANT le match

Le classement publié *après* un tournoi intègre déjà ses résultats. \`rang1\` et
\`rang2\` sont donc lus dans la dernière publication antérieure à la date du
match : une analyse ou un modèle entraîné sur ce fichier ne peut pas tricher
avec le futur via le rang.

## players.csv

Une ligne par joueur **apparaissant dans \`matches.csv\`**, triée par nombre de
matchs décroissant.

### Identité

| Colonne | Description |
|---|---|
| \`player_id\` | Id BWF, entier. Clé primaire, et la clé de jointure (voir plus haut). |
| \`nom\` | Nom affiché tel que publié par la BWF (\`NOM Prénom\` ou \`Prénom NOM\` selon la convention du pays). |
| \`prenom\`, \`nom_famille\` | Les deux parties séparées, quand on veut trier ou afficher soi-même. |
| \`slug\` | Identifiant lisible (\`shi-yu-qi\`), utile pour construire une URL. |
| \`pays\` | Code pays ISO-3. C'est **le pays de la dernière apparition** : un joueur qui change de nation porte sa nation actuelle. |
| \`photo_url\` | Portrait officiel. **Vide** quand la BWF ne sert que la silhouette générique — un placeholder n'est pas une photo, autant que la colonne le dise. |

### Physique et état civil

Source : \`data/players/birthdates.json\`, constitué depuis Wikidata et l'API
BWF (méthode et sources détaillées dans \`data/players/birthdates-rapport.md\`).

| Colonne | Description |
|---|---|
| \`date_naissance\` | \`AAAA-MM-JJ\`. |
| \`main\` | \`right\` ou \`left\`. |
| \`taille_cm\` | Taille en centimètres. |
| \`source_bio\` | \`wikidata\` ou \`bwf\` — d'où viennent les trois colonnes ci-dessus, pour qui veut pondérer sa confiance. |

### Bilan de carrière — mesuré sur \`matches.csv\`

Ces colonnes sont calculées sur **exactement les mêmes matchs** que
\`matches.csv\` : la somme des \`matchs\` est vérifiable en comptant les lignes de
l'autre fichier. Ce ne sont donc **pas** des totaux de carrière BWF : un joueur
actif avant ${annees[0]} a des chiffres tronqués au début de la fenêtre.

| Colonne | Description |
|---|---|
| \`matchs\`, \`victoires\`, \`defaites\` | En double, les deux joueurs de la paire gagnante marquent chacun une victoire. |
| \`taux_victoire\` | \`victoires / matchs\`, 4 décimales. |
| \`matchs_simple\`, \`matchs_double\` | Répartition par type d'épreuve — un joueur peut faire les deux. |
| \`disciplines\` | Celles où il a joué, séparées par \`;\` (ex. \`MD;XD\`). |
| \`tournois\` | Nombre de tournois distincts. |
| \`premier_match\`, \`dernier_match\` | Bornes de sa fenêtre de présence dans les données. |
| \`saisons\` | Années où il a joué, séparées par \`;\`. |
| \`points_gagnes\`, \`points_concedes\` | Points cumulés pour et contre, tous matchs confondus. |

### Classement mondial

| Colonne | Description |
|---|---|
| \`rang_actuel\`, \`rang_actuel_discipline\`, \`points_actuels\` | Rang à la publication la plus récente de l'archive (**${dernierePub ?? "—"}**). **Vide** si le joueur n'y figure pas : c'est l'information (retraité, blessé, sorti du classement), pas un trou. |
| \`meilleur_rang_depuis_2024\`, \`meilleur_rang_discipline\`, \`meilleur_rang_date\` | Meilleur rang atteint **dans l'archive locale**, pas de la carrière (voir ci-dessous). |

Un joueur classé dans plusieurs disciplines (typiquement double + mixte) n'a
qu'une ligne : on retient son **meilleur** rang, et la colonne
\`_discipline\` dit dans laquelle il l'obtient.

### ⚠ players.csv regarde tout l'historique

Contrairement à \`matches.csv\`, une fiche joueur est un état **agrégé** :
\`taux_victoire\`, \`meilleur_rang_depuis_2024\` ou \`rang_actuel\` incorporent des
matchs postérieurs à n'importe quel match donné. Joindre players.csv à un match
de 2024 pour prédire ce match introduit donc une **fuite du futur**. Pour cet
usage, utiliser \`rang1\`/\`rang2\` de \`matches.csv\`, qui sont datés d'avant.
players.csv est fait pour décrire les joueurs, pas pour entraîner sur le passé.

## cotes.csv

Une ligne par **match × opérateur**, les trois marchés de front. Source :
Flashscore (cotes historiques d'ouverture et de clôture), joint à nos matchs par
l'**empreinte de score** — les noms Flashscore sont abrégés (« Lu G. Z. »), la
suite exacte des points ne l'est pas.

${nMatchsCotes} matchs sur ${rows.length} portent des cotes (${pct(nMatchsCotes, rows.length)}).

### Jointure et contexte

| Colonne | Description |
|---|---|
| \`match_id\` | Jointure vers \`matches.csv\`. |
| \`date\`, \`discipline\` | Dupliqués depuis \`matches.csv\` pour filtrer sans jointure. |
| \`fs_id\` | Identifiant Flashscore du match — pour retrouver la source ou recouper. |
| \`book\` | \`betclic\`, \`unibet\`, \`winamax\`, \`bwin\`, \`netbet\`. |
| \`misable\` | **À LIRE.** \`true\` = opérateur sur lequel on peut réellement parier. \`false\` = cote de **référence** (bwin, NetBet), gardée pour la mesure, **jamais jouable**. |
| \`vainqueur\`, \`manches\`, \`points_total\` | Le résultat, dupliqué ici exprès : ROI, Brier ou log-loss se calculent sans jointure. \`points_total\` est la valeur qui règle le marché over/under. |

### Marché vainqueur

| Colonne | Description |
|---|---|
| \`cote1_ouverture\`, \`cote1_cloture\` | Cote décimale de l'**équipe 1** (celle de \`matches.csv\`) à l'ouverture du marché et juste avant le match. |
| \`cote2_ouverture\`, \`cote2_cloture\` | Idem équipe 2. |
| \`marge_ouverture\`, \`marge_cloture\` | Marge de l'opérateur (*overround*) : \`1/c1 + 1/c2 − 1\`. 0,06 = 6 % prélevés. |
| \`proba1_ouverture\`, \`proba1_cloture\` | Probabilité de l'équipe 1 **marge retirée** (dé-vig proportionnel). C'est la référence à battre pour un modèle. |
| \`derive_proba1\` | \`proba1_cloture − proba1_ouverture\`. Le mouvement du marché, souvent la variable la plus informative du fichier : positif = l'argument est allé vers l'équipe 1. |

### Marché du score exact (nombre de manches)

Quatre issues : \`2-0\`, \`2-1\`, \`1-2\`, \`0-2\`, **du point de vue de l'équipe 1**
(remis d'aplomb quand Flashscore inverse les camps — voir le piège ci-dessous).

| Colonne | Description |
|---|---|
| \`cs_2_0_*\`, \`cs_2_1_*\`, \`cs_1_2_*\`, \`cs_0_2_*\` | Cote de chaque score exact, \`_ouverture\` et \`_cloture\`. |
| \`marge_manches_cloture\` | Marge sur les quatre issues réunies. Nettement plus grasse que sur le vainqueur : c'est le marché où l'opérateur se protège. |
| \`proba_3manches_cloture\` | Probabilité que le match aille en 3 manches, marge retirée (\`2-1\` **ou** \`1-2\`). |
| \`proba1_manches_cloture\` | Probabilité de victoire de l'équipe 1 **déduite du score exact** (\`2-0\` ou \`2-1\`). |
| \`ecart_proba1_manches\` | \`proba1_manches_cloture − proba1_cloture\` : deux marchés du même opérateur sur le même événement. Un écart net signale une incohérence interne — la matière première d'une recherche d'arbitrage ou d'un signal de mauvais prix. |

### Marché du total de points (ligne principale)

| Colonne | Description |
|---|---|
| \`total_ligne\` | Le seuil, ex. \`78.5\`. **Ligne principale** = celle dont les deux prix de clôture sont les plus proches, donc l'estimation centrale de l'opérateur. |
| \`cote_over_*\`, \`cote_under_*\` | Prix des deux côtés, ouverture et clôture. |
| \`proba_over_cloture\` | Probabilité de dépassement, marge retirée. |
| \`total_lignes\` | Nombre de seuils proposés par cet opérateur sur ce match. **Dès qu'il vaut plus de 1, l'échelle complète est dans \`cotes-totaux.csv\`** — cette ligne-ci n'en montre qu'une. |

## cotes-totaux.csv

L'échelle complète du marché over/under : une ligne par **match × opérateur ×
seuil**. Elle ne peut pas tenir dans \`cotes.csv\` sans perte — la majorité des
couples match × opérateur proposent plusieurs seuils, et l'ensemble de la
courbe est ce qui permet d'estimer une distribution du total de points.

| Colonne | Description |
|---|---|
| \`match_id\`, \`date\`, \`book\`, \`misable\` | Jointure et contexte. |
| \`total\` | Le seuil (toujours en \`.5\`, donc jamais de remboursement). |
| \`cote_over_ouverture\`, \`cote_over_cloture\` | Prix du dépassement. |
| \`cote_under_ouverture\`, \`cote_under_cloture\` | Prix inverse. |
| \`proba_over_cloture\` | Probabilité de dépassement, marge retirée. |
| \`points_total\` | Points réellement marqués dans le match. |
| \`resultat_over\` | \`1\` si \`points_total > total\`, sinon \`0\`. **Le pari est déjà réglé** : la colonne se compare directement à \`proba_over_cloture\`. |

### Deux pièges à ne pas reproduire

**1. Filtrez sur \`misable = true\` pour tout calcul de rentabilité.** Inclure les
cotes de référence (bwin, NetBet) donne un résultat flatteur et faux : ce sont
des prix qu'on ne peut pas jouer. C'est le garde-fou que le projet applique dans
sa propre chaîne (\`lib/roi.mjs\`).

**2. Les probas dé-viguées ne sont pas calibrées à la perfection.** Mesuré sur
cet export, opérateurs misables uniquement :

| Marché | Colonne | Lignes | Moyenne prédite | Fréquence observée |
|---|---|---|---|---|
${tableauCal}

Globalement juste sur le vainqueur, mais l'écart n'est pas uniforme : les
**outsiders sont surévalués et les favoris sous-évalués** aux extrêmes (autour
de 15 % prédits pour 8 % observés, 84 % prédits pour 91 % observés). C'est la
limite connue du dé-vig **proportionnel**, qui répartit la marge au prorata de
la probabilité. Si votre analyse vit dans les extrêmes, re-dé-viguez vous-même
depuis \`cote1_cloture\`/\`cote2_cloture\`, qui sont dans le fichier — méthode de
Shin ou *odds ratio* plutôt que proportionnel. Sur les deux autres marchés
l'écart est un biais de marge, pas une erreur d'export.

**3. Les cotes de clôture savent des choses.** \`cote*_cloture\` et
\`proba1_cloture\` intègrent toute l'information disponible juste avant le match
— y compris ce qu'un modèle censé prédire *à l'avance* ne pourrait pas savoir.
Pour mesurer un modèle contre le marché, c'est la bonne référence. Pour
l'**entraîner**, la clôture est une fuite : utilisez l'ouverture.

## Trous connus, à ne pas prendre pour des erreurs

### Classement mondial : rien avant 2024

| Saison | Matchs | Les 2 rangs connus | Un seul | Aucun |
|---|---|---|---|---|
${tableauRangs}

L'API BWF n'expose que **60 semaines glissantes** de classement. Les
publications plus anciennes ne sont plus servies et ne sont pas récupérables :
l'archive locale démarre au **2024-01-02**, donc \`rang1\`/\`rang2\` sont
**définitivement vides sur 2022-2023**. Ce n'est pas un bug de l'export et ce ne
sera pas comblé plus tard. Même limite pour
\`meilleur_rang_depuis_2024\` : un joueur au sommet en 2022 puis en déclin
apparaît avec son meilleur rang *depuis 2024*, pas son meilleur rang de
carrière.

Sur 2024 et après, les quelques pour cent de matchs restants sont des joueurs
absents de la publication (juniors, wild-cards, invités hors classement) : rang
vide, pas rang zéro.

### Couverture des colonnes joueur

Le nombre de joueurs renseignés est trompeur : le circuit compte une longue
traîne de joueurs à deux ou trois matchs. La colonne de droite, **pondérée par
le nombre de matchs joués**, dit ce que vous verrez réellement en analysant des
matchs.

| Colonne | Joueurs renseignés | Part des apparitions en match |
|---|---|---|
${tableauBio}

### Couverture des cotes

| Saison | Matchs | Avec cotes | Part |
|---|---|---|---|
${tableauCotes}

Rien de récupérable en amont : Flashscore ne sert plus les cotes des tournois
trop anciens, et un match non apparié l'est resté faute de certitude (la
jointure refuse de deviner : ${stats.unmatched} non appariés, ${stats.ambiguous} ambigus).

| Opérateur | Lignes | Misable |
|---|---|---|
${tableauBooks}

- **Winamax** est absent avant 2025.
- **bwin** et **NetBet** ne couvrent qu'une poignée de tournois de 2022, et sont
  des cotes de **référence** : hors périmètre de pari, cf. le piège plus haut.
- **Score exact** : rien en 2022 (aucun opérateur ne le cotait), et à partir de
  2023 il repose sur **Betclic quasi seul**.
- **Total de points** : n'apparaît qu'à la fin 2024, Betclic seul.

### Le reste

- **Durée** : \`duree_min\` est vide sur une partie des matchs — donnée non
  renseignée à la source, pas une durée nulle.
- **Forfaits** : les walkovers, abandons sans score et matchs non joués sont
  **exclus** de l'export. Seuls les matchs réellement disputés y figurent.
- **Doubles** : une paire est identifiée par ses deux joueurs. Un joueur qui
  change de partenaire produit une entité \`pair:\` différente — c'est voulu.
- **Nom et pays** d'un joueur sont ceux de sa **dernière** apparition. Un CSV à
  une ligne par joueur ne peut pas porter un historique de nationalité.

## Ce qui n'est PAS ici

- **Les prédictions du modèle du projet** (Elo, probabilités calibrées) :
  volontairement hors export, elles appartiennent à la chaîne
  \`build-data\` / \`backtest\` du dépôt. Ce jeu de données sert à construire ses
  propres prédictions, pas à recopier les nôtres.
- **Les relevés de cotes horodatés** (\`data/books/runs/\`) : le projet interroge
  aussi les opérateurs en direct toutes les deux heures, ce qui donne la courbe
  intra-journalière et pas seulement ouverture/clôture. Cette collecte n'a
  démarré que fin juillet 2026 et reste dominée par un seul opérateur : trop
  mince pour un export, elle vit dans \`data/books/runs/\`.
`;
await writeFile(join(OUT_DIR, "README.md"), readme, "utf8");
console.log(`→ README.md   : dictionnaire des colonnes.`);
console.log(`\n✅ Export dans ${OUT_DIR}`);

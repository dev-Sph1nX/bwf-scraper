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
//                       identité et biologie SEULEMENT (ni agrégat, ni classement).
//   export/cotes.csv    une ligne par match × opérateur : les trois marchés
//                       (vainqueur, score exact, total de points) à l'ouverture
//                       ET à la clôture. PRIX BRUTS uniquement : aucune marge,
//                       aucune probabilité dé-viguée (cf. lib/export-schema.mjs).
//   export/cotes-totaux.csv  l'échelle complète des lignes over/under, qu'une
//                       ligne par opérateur ne peut pas porter (58 % des
//                       couples match × opérateur en ont plusieurs).
//   export/README.md    le dictionnaire des colonnes (unités, pièges, trous).
//
// PÉRIMÈTRE : FAITS OBSERVÉS SEULEMENT. Cet export est la seule surface
// d'analyse, donc tout ce qui y figure sera pris pour un fait. En sont bannis,
// et le bannissement est vérifié par test (test/export-schema.test.mjs) :
//   - les prédictions du modèle du projet (Elo, probabilités calibrées) ;
//   - les probabilités et marges implicites — une cote est un prix, donc un
//     fait ; une probabilité suppose une normalisation de la marge non mesurée ;
//   - les agrégats de carrière — ils résument toute la période, donc décrire un
//     match ancien avec eux fuite le futur.
// Tout cela se recalcule depuis les colonnes conservées. Ne rien rajouter
// « au cas où » : la liste vit dans lib/export-schema.mjs.
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
import {
  MATCH_COLS, PLAYER_COLS, ODDS_COLS, TOTALS_COLS, assertPur,
} from "../lib/export-schema.mjs";

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
    const r1 = rangDe(jour, disc, a.key);
    const r2 = rangDe(jour, disc, b.key);
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
      // `at` = date de la publication effectivement lue : exportée pour que
      // l'absence de fuite se vérifie au lieu de se croire.
      rang1: r1?.rank ?? null, rang1Date: r1?.at ?? null,
      rang2: r2?.rank ?? null, rang2Date: r2?.at ?? null,
    });
  },
});
console.log(`   ${rows.length} matchs joués exploitables, ${joueurs.size} joueurs distincts.`);

// ==============================================================================
// 3) Écriture de matches.csv
// ==============================================================================
const COLS = assertPur(MATCH_COLS, "matches.csv");

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
    r.rang1, r.rang1Date, r.rang2, r.rang2Date,
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

const P_COLS = assertPur(PLAYER_COLS, "players.csv");

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

const C_COLS = assertPur(ODDS_COLS, "cotes.csv");
const T_COLS = assertPur(TOTALS_COLS, "cotes-totaux.csv");

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
    // Seule sert encore au diagnostic de calibration publié dans le README :
    // aucune probabilité n'est exportée.
    const pC = devig(b.odd1, [b.odd1, b.odd2]);

    // --- score exact, remis dans NOTRE orientation --------------------------
    const cs = (sc, instant) => {
      const k = j.swap ? MIROIR[sc] : sc;
      return Number(extra?.scores?.[op]?.[k]?.[instant]) || null;
    };
    const csC = CS.map((sc) => cs(sc, "closing"));
    const p3 = devigGroupe([csC[1], csC[2]], csC);          // 2-1 ou 1-2

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
        r2(e.oO), r2(e.oC), r2(e.uO), r2(e.uC),
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
      r2(cs("2-0", "opening")), r2(csC[0]), r2(cs("2-1", "opening")), r2(csC[1]),
      r2(cs("1-2", "opening")), r2(csC[2]), r2(cs("0-2", "opening")), r2(csC[3]),
      principale?.total ?? null,
      r2(principale?.e.oO), r2(principale?.e.oC),
      r2(principale?.e.uO), r2(principale?.e.uC),
      echelle.size,
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
// Diagnostic publié dans le README : le dé-vig est recalculé ICI pour mesurer le
// biais du marché, jamais exporté en colonne. On nomme donc le marché et les
// cotes d'origine, pas une colonne qui n'existe plus.
const calLigne = (lib, src, c) => `| ${lib} | \`${src}\` | ${c.n} | ${pct(c.p, c.n)} | ${pct(c.o, c.n)} |`;
const tableauCal = [
  calLigne("Équipe 1 gagne", "cote1_cloture / cote2_cloture", cal.v),
  calLigne("Match en 3 manches", "cs_*_cloture", cal.m),
  calLigne("Total dépassé", "cote_over_cloture / cote_under_cloture", cal.t),
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

### Pourquoi aucun bilan de carrière

players.csv ne porte **ni agrégat ni classement**. Ces colonnes ont existé
(\`taux_victoire\`, \`victoires\`, \`rang_actuel\`, \`meilleur_rang_*\`, \`tournois\`…)
et ont été retirées : un agrégat résume toute la période couverte, donc joindre
players.csv à un match de ${annees[0]} décrit ce match par ce qui s'est passé en
${annees[annees.length - 1]}. C'est une **fuite du futur** qu'une jointure d'une
ligne suffit à provoquer, et aucun avertissement écrit n'en protège.

Un bilan à une date donnée se recalcule sur \`matches.csv\` — ce qui oblige à
déclarer la fenêtre, et c'est le but :

\`\`\`python
avant = m[m.date < "2024-06-01"]
# éclater les entités en joueurs, puis compter victoires / matchs
\`\`\`

Pour le classement d'un camp au moment d'un match, utiliser \`rang1\`/\`rang2\` de
\`matches.csv\`, datés par \`rang1_date\`/\`rang2_date\`.

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

### Aucune probabilité n'est exportée

Une cote est un prix affiché, donc un fait. Une probabilité implicite est une
**convention** : elle suppose une façon de retirer la marge (proportionnelle,
*odds ratio*, Shin) que rien ici n'a mesurée. Pré-calculée, ce choix devient
invisible ; recalculée à l'analyse, c'est un paramètre. Les colonnes
\`proba*\`, \`marge*\`, \`derive*\` et \`ecart*\` ont donc été retirées. Toutes se
refont depuis les prix, tous conservés :

\`\`\`python
marge  = 1/c1 + 1/c2 - 1
proba1 = (1/c1) / (1/c1 + 1/c2)          # dé-vig proportionnel
derive = proba1_cloture - proba1_ouverture
p3     = (1/cs_2_1 + 1/cs_1_2) / sum(1/cs for cs in quatre_scores)
\`\`\`

### Marché du score exact (nombre de manches)

Quatre issues : \`2-0\`, \`2-1\`, \`1-2\`, \`0-2\`, **du point de vue de l'équipe 1**
(remis d'aplomb quand Flashscore inverse les camps — voir le piège ci-dessous).

| Colonne | Description |
|---|---|
| \`cs_2_0_*\`, \`cs_2_1_*\`, \`cs_1_2_*\`, \`cs_0_2_*\` | Cote de chaque score exact, \`_ouverture\` et \`_cloture\`. |

### Marché du total de points (ligne principale)

| Colonne | Description |
|---|---|
| \`total_ligne\` | Le seuil, ex. \`78.5\`. **Ligne principale** = celle dont les deux prix de clôture sont les plus proches, donc l'estimation centrale de l'opérateur. |
| \`cote_over_*\`, \`cote_under_*\` | Prix des deux côtés, ouverture et clôture. |
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
| \`points_total\` | Points réellement marqués dans le match. |
| \`resultat_over\` | \`1\` si \`points_total > total\`, sinon \`0\`. **Le pari est déjà réglé** : c'est l'étiquette. |

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

**3. Les cotes de clôture savent des choses.** \`cote*_cloture\` intègre
toute l'information disponible juste avant le match
— y compris ce qu'un modèle censé prédire *à l'avance* ne pourrait pas savoir.
Pour mesurer un modèle contre le marché, c'est la bonne référence. Pour
l'**entraîner**, la clôture est une fuite : utilisez l'ouverture.

## Trous connus, à ne pas prendre pour des erreurs

### Classement mondial : couverture par saison

| Saison | Matchs | Les 2 rangs connus | Un seul | Aucun |
|---|---|---|---|---|
${tableauRangs}

Le tableau ci-dessus est recalculé à chaque export : c'est la seule source à
consulter sur ce point. L'API BWF ne sert que **60 semaines glissantes**, donc
les publications anciennes ne sont plus téléchargeables — mais l'archive locale
peut être complétée par import, et l'a été. Aucun trou n'est déclaré définitif
ici : si une saison affiche un taux faible, c'est un état, pas une fatalité.

\`rang1_date\`/\`rang2_date\` donnent la publication effectivement utilisée pour
chaque ligne, ce qui permet de vérifier soi-même l'antériorité au match.

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

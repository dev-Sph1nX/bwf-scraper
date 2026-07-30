// Test ANTI-FUITE du jeu de données d'avant match.
//   node --test test/
//
// C'est le test le plus important du backtest. Si une valeur postérieure au
// match se glisse dans une ligne, toutes les métriques publiées seront fausses
// ET paraîtront excellentes — un échec invisible. Ici on reconstruit l'état
// attendu À LA MAIN après k-1 matchs et on exige l'égalité stricte.
//
// Le collecteur est alimenté par des appels de crochet synthétiques : ni disque,
// ni réseau, ni dépendance à lib/elo.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCollector, makeRankLookup, formOf, daysSince, wentThreeSets, isWalkover, seedNumber,
} from "../lib/dataset.mjs";

// Fabrique une entité au sens du crochet de lib/elo.mjs.
const ent = (rating, matches, history = [], lastPlayed = null) => ({ rating, matches, history, lastPlayed });

// Fabrique un appel de crochet.
const ctx = ({ t, disc = "MS", tmtId = 1, drawId = "1", won = 1, a, b, duration = 40, sets = 2, statut = null, seedA = null, seedB = null }) => ({
  tmtId, drawId, disc, won,
  match: {
    matchTime: t, duration, scoreStatusValue: statut,
    score: Array.from({ length: sets }, (_, i) => ({ set: i + 1, home: 21, away: 15 })),
    team1seed: seedA, team2seed: seedB,
  },
  a: { key: a.key, players: [{ id: a.key.replace("p:", "") }], entity: a.e },
  b: { key: b.key, players: [{ id: b.key.replace("p:", "") }], entity: b.e },
});

// --- Aides ----------------------------------------------------------------

test("formOf somme les deltas des 5 derniers matchs, comme lib/elo.mjs", () => {
  const h = [{ d: 10 }, { d: -5 }, { d: 3 }, { d: 7 }, { d: -2 }, { d: 100 }];
  assert.equal(formOf(h), 103, "seuls les 5 DERNIERS comptent : -5+3+7-2+100");
  assert.equal(formOf([]), 0);
  assert.equal(formOf(undefined), 0);
});

test("daysSince compte les jours entre deux horodatages", () => {
  assert.equal(daysSince("2026-03-01 10:00:00", "2026-03-11 10:00:00"), 10);
  assert.equal(daysSince(null, "2026-03-11 10:00:00"), null, "jamais joué -> null");
  assert.equal(daysSince("2026-03-01 10:00:00", null), null);
});

test("wentThreeSets ne compte que les matchs à 3 manches ou plus", () => {
  assert.equal(wentThreeSets([{}, {}]), false);
  assert.equal(wentThreeSets([{}, {}, {}]), true);
  assert.equal(wentThreeSets([]), false);
  assert.equal(wentThreeSets(undefined), false);
});

test("seedNumber convertit la tête de série en NOMBRE", () => {
  // L'API renvoie la tête de série en chaîne. Comparer les chaînes classerait
  // « 10 » avant « 9 » en ordre lexicographique — donc la 10e tête de série
  // devant la 9e, ce qui inverserait le baseline « tête de série ».
  assert.equal(seedNumber("3"), 3);
  assert.equal(typeof seedNumber("3"), "number");
  assert.ok(seedNumber("9") < seedNumber("10"), "9e mieux classé que 10e — faux si on comparait les chaînes");
  assert.equal(seedNumber(null), null);
  assert.equal(seedNumber(""), null);
  assert.equal(seedNumber("Q"), null, "un qualifié n'est pas une tête de série");
  assert.equal(seedNumber("0"), null);
  assert.equal(seedNumber(5), 5, "tolère un nombre déjà converti");
});

test("le jeu de données stocke les têtes de série en nombre", () => {
  const { onMatch, rows } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", seedA: "9", seedB: "10", a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  assert.equal(rows[0].seedA, 9);
  assert.equal(rows[0].seedB, 10);
  assert.ok(rows[0].seedA < rows[0].seedB, "l'ordre doit être numérique");
});

test("isWalkover repère un forfait", () => {
  assert.equal(isWalkover({ scoreStatusValue: "Walkover", duration: 0, score: [] }), true);
  assert.equal(isWalkover({ scoreStatusValue: "Retired", duration: 20, score: [{}] }), true);
  assert.equal(isWalkover({ scoreStatusValue: null, duration: 0, score: [] }), true, "0 min sans score = pas un match joué");
  assert.equal(isWalkover({ scoreStatusValue: null, duration: 40, score: [{}, {}] }), false);
});

// --- LE test anti-fuite ---------------------------------------------------

test("ANTI-FUITE : la ligne du match k ne contient rien des matchs >= k", () => {
  const { onMatch, rows } = createCollector();

  // Trois matchs du MÊME tournoi entre les mêmes joueurs, chronologiques.
  // On fait varier tout ce qui est accumulé, pour que toute fuite se voie.
  const A = ent(1500, 0, [], null);
  const B = ent(1400, 0, [], null);

  // -- match 1 : A gagne, 2 manches, 40 min
  onMatch(ctx({ t: "2026-01-06 10:00:00", won: 1, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  // on simule la mise à jour que lib/elo.mjs applique après le crochet
  A.rating = 1516; A.matches = 1; A.lastPlayed = "2026-01-06 10:00:00"; A.history.push({ d: 16 });
  B.rating = 1384; B.matches = 1; B.lastPlayed = "2026-01-06 10:00:00"; B.history.push({ d: -16 });

  // -- match 2 : B gagne, 3 manches, 70 min
  onMatch(ctx({ t: "2026-01-08 10:00:00", won: 0, sets: 3, duration: 70, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  A.rating = 1498; A.matches = 2; A.lastPlayed = "2026-01-08 10:00:00"; A.history.push({ d: -18 });
  B.rating = 1402; B.matches = 2; B.lastPlayed = "2026-01-08 10:00:00"; B.history.push({ d: 18 });

  // -- match 3 : A gagne
  onMatch(ctx({ t: "2026-01-10 10:00:00", won: 1, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));

  assert.equal(rows.length, 3);

  // ---- ligne 1 : AUCUN antécédent ne doit exister ----
  assert.deepEqual(
    { eloA: rows[0].eloA, eloB: rows[0].eloB, nA: rows[0].nA, nB: rows[0].nB,
      formA: rows[0].formA, formB: rows[0].formB,
      daysOffA: rows[0].daysOffA, daysOffB: rows[0].daysOffB,
      h2hA: rows[0].h2hA, h2hB: rows[0].h2hB,
      loadA: rows[0].loadA, loadB: rows[0].loadB,
      sets3A: rows[0].sets3A, sets3B: rows[0].sets3B },
    { eloA: 1500, eloB: 1400, nA: 0, nB: 0, formA: 0, formB: 0,
      daysOffA: null, daysOffB: null, h2hA: 0, h2hB: 0,
      loadA: 0, loadB: 0, sets3A: false, sets3B: false },
    "le premier match ne peut rien savoir",
  );

  // ---- ligne 2 : exactement l'état après le match 1, pas après le 2 ----
  assert.equal(rows[1].eloA, 1516, "Elo d'avant match 2 = après match 1");
  assert.equal(rows[1].nA, 1);
  assert.equal(rows[1].formA, 16);
  assert.equal(rows[1].daysOffA, 2, "du 06 au 08");
  assert.equal(rows[1].h2hA, 1, "A avait gagné le match 1");
  assert.equal(rows[1].h2hB, 0, "B n'avait encore rien gagné");
  assert.equal(rows[1].loadA, 40, "40 min du match 1 seulement, PAS les 70 du match 2");
  assert.equal(rows[1].sets3A, false, "le match 1 était en 2 manches");

  // ---- ligne 3 : intègre le match 2 mais rien de plus ----
  assert.equal(rows[2].eloA, 1498);
  assert.equal(rows[2].nA, 2);
  assert.equal(rows[2].formA, -2, "16 + (-18)");
  assert.equal(rows[2].daysOffA, 2, "du 08 au 10");
  assert.equal(rows[2].h2hA, 1, "1 victoire chacun avant le match 3");
  assert.equal(rows[2].h2hB, 1);
  assert.equal(rows[2].loadA, 110, "40 + 70");
  assert.equal(rows[2].sets3A, true, "le match 2 était en 3 manches");
});

test("ANTI-FUITE : la cible `won` est la seule information du match présente", () => {
  const { onMatch, rows } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", won: 0, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  const r = rows[0];
  assert.equal(r.won, 0, "0 = le camp B gagne, valeur réellement produite par lib/elo.mjs");
  // Aucune variable ne doit refléter le score, la durée ni le vainqueur de CE match.
  assert.equal(r.loadA, 0, "la durée de CE match ne doit pas être comptée dans sa propre charge");
  assert.equal(r.sets3A, false, "le nombre de manches de CE match ne doit pas y figurer");
  assert.equal(r.h2hA + r.h2hB, 0, "le résultat de CE match ne doit pas figurer dans son propre H2H");
});

test("ANTI-FUITE : le rang mondial vient d'une publication STRICTEMENT antérieure", () => {
  const pub = (date, rank) => ({
    date,
    disciplines: { MS: [{ rank, points: 1000, players: [{ id: "1" }] }] },
  });
  const lookup = makeRankLookup([pub("2026-01-06", 10), pub("2026-01-13", 5)]);

  // un match le jour même d'une publication ne doit PAS l'utiliser
  assert.equal(lookup("2026-01-13 09:00:00", "MS", "p:1")?.rank, 10, "doit prendre celle du 06, pas du 13");
  assert.equal(lookup("2026-01-13 09:00:00", "MS", "p:1")?.at, "2026-01-06");
  // un match après les deux prend la plus récente
  assert.equal(lookup("2026-01-20 09:00:00", "MS", "p:1")?.rank, 5);
  // un match avant toute publication n'a pas de rang
  assert.equal(lookup("2026-01-05 09:00:00", "MS", "p:1"), null);
  // entité inconnue
  assert.equal(lookup("2026-01-20 09:00:00", "MS", "p:999"), null);
  // discipline sans données
  assert.equal(lookup("2026-01-20 09:00:00", "XD", "p:1"), null);
});

// --- Cas limites ----------------------------------------------------------

test("les forfaits sont exclus et ne polluent aucun accumulateur", () => {
  const { onMatch, rows, stats } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", won: 1, duration: 0, sets: 0, statut: "Walkover", a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  onMatch(ctx({ t: "2026-01-08 10:00:00", won: 1, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  assert.equal(rows.length, 1, "seul le vrai match produit une ligne");
  assert.equal(stats.walkovers, 1);
  assert.equal(rows[0].h2hA, 0, "la victoire par forfait ne compte pas dans le H2H");
  assert.equal(rows[0].loadA, 0, "un forfait n'ajoute pas de minutes");
});

test("un match sans horodatage est exclu", () => {
  const { onMatch, rows, stats } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: null, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  assert.equal(rows.length, 0);
  assert.equal(stats.sansDate, 1);
});

test("la charge est remise à zéro au changement de tournoi", () => {
  const { onMatch, rows } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", tmtId: 1, duration: 60, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  onMatch(ctx({ t: "2026-01-08 10:00:00", tmtId: 1, duration: 50, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  onMatch(ctx({ t: "2026-01-20 10:00:00", tmtId: 2, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  assert.equal(rows[1].loadA, 60, "2e match du tournoi 1");
  assert.equal(rows[2].loadA, 0, "nouveau tournoi -> charge repartie de zéro");
  assert.equal(rows[2].sets3A, false, "et l'indicateur 3 manches aussi");
});

test("le face-à-face est cloisonné par discipline", () => {
  const { onMatch, rows } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", disc: "MS", won: 1, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  onMatch(ctx({ t: "2026-01-08 10:00:00", disc: "XD", won: 1, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  assert.equal(rows[1].h2hA, 0, "la victoire en MS ne compte pas dans le H2H de XD");
});

test("le face-à-face s'apparie quel que soit le sens de la rencontre", () => {
  const { onMatch, rows } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", won: 1, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  // retour, joueurs inversés : A est maintenant en team2
  onMatch(ctx({ t: "2026-01-08 10:00:00", won: 1, a: { key: "p:2", e: B }, b: { key: "p:1", e: A } }));
  assert.equal(rows[1].h2hA, 0, "p:2 n'a rien gagné");
  assert.equal(rows[1].h2hB, 1, "p:1 avait gagné l'aller");
});

test("les têtes de série sont reprises du match, null si non classé", () => {
  const { onMatch, rows } = createCollector();
  const A = ent(1500, 0), B = ent(1500, 0);
  onMatch(ctx({ t: "2026-01-06 10:00:00", seedA: 3, seedB: null, a: { key: "p:1", e: A }, b: { key: "p:2", e: B } }));
  assert.equal(rows[0].seedA, 3);
  assert.equal(rows[0].seedB, null);
});

test("makeRankLookup sur une liste vide ne lève pas", () => {
  const lookup = makeRankLookup([]);
  assert.equal(lookup("2026-01-06 10:00:00", "MS", "p:1"), null);
  assert.equal(makeRankLookup(undefined)("2026-01-06", "MS", "p:1"), null);
});

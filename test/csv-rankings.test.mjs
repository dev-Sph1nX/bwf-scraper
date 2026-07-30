// Tests de l'import des classements mondiaux fournis en CSV.
//   node --test test/
//
// Fonctions pures : aucun accès disque ni réseau. Les cas tordus reproduisent
// des lignes RÉELLES du lot (champs cités contenant une virgule, CRLF).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CSV_ANCHOR, parseCsvLine, parseRankingCsv, weekDateChain, withRankChanges,
} from "../lib/csv-rankings.mjs";

const EN_TETE_S = "Ranking,BWF ID,Last Name,First Name,Country,Points,Tour";
const EN_TETE_D = "Ranking,P1 BWF ID,P1 Last Name,P1 First Name,P1 Country,P2 BWF ID,P2 Last Name,P2 First Name,P2 Country,Points,Tour";

// --- Découpage CSV --------------------------------------------------------

test("parseCsvLine découpe une ligne simple", () => {
  assert.deepEqual(parseCsvLine("1,25831,AXELSEN,Viktor,DEN,105655,16"),
    ["1", "25831", "AXELSEN", "Viktor", "DEN", "105655", "16"]);
});

test("parseCsvLine respecte un champ cité contenant une virgule", () => {
  // ligne réelle de 2024-W01_WD.csv
  const c = parseCsvLine('181,65389,SIOW,"Desiree, Hao Shan",MAS,97932,YAP,Rui Chen,MAS,6487,6');
  assert.equal(c.length, 11, "un split naïf donnerait 12 colonnes et décalerait tout");
  assert.equal(c[3], "Desiree, Hao Shan");
  assert.equal(c[5], "97932", "l'identifiant du 2e joueur ne doit PAS être décalé");
  assert.equal(c[9], "6487");
  assert.equal(c[10], "6");
});

test("parseCsvLine gère un guillemet littéral doublé dans un champ cité", () => {
  // Le doublement `""` n'est un échappement QUE dans un champ cité (norme CSV).
  assert.deepEqual(parseCsvLine('1,2,"O""BRIEN",Sean,IRL,10,1'),
    ["1", "2", 'O"BRIEN', "Sean", "IRL", "10", "1"]);
});

test("parseCsvLine rend un champ vide pour deux virgules consécutives", () => {
  assert.deepEqual(parseCsvLine("1,2,,Sean,IRL,10,1"), ["1", "2", "", "Sean", "IRL", "10", "1"]);
});

// --- Parsing d'un fichier ------------------------------------------------

test("parseRankingCsv lit un classement de simple", () => {
  const rows = parseRankingCsv(`${EN_TETE_S}\r\n1,25831,AXELSEN,Viktor,DEN,105655,16\r\n2,62063,NARAOKA,Kodai,JPN,83515,23\r\n`, { doubles: false });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    rank: 1, rankPrevious: null, rankChange: null,
    points: 105655, tournaments: 16,
    players: [{ id: "25831", slug: null, name: "Viktor AXELSEN", country: "DEN" }],
  });
});

test("parseRankingCsv lit un classement de double avec les deux joueurs", () => {
  const rows = parseRankingCsv(`${EN_TETE_D}\r\n1,90531,LIANG,Wei Keng,CHN,55414,WANG,Chang,CHN,97991,19\r\n`, { doubles: true });
  assert.equal(rows[0].players.length, 2);
  assert.deepEqual(rows[0].players.map((p) => p.id), ["90531", "55414"]);
  assert.equal(rows[0].players[1].name, "Chang WANG");
  assert.equal(rows[0].points, 97991);
  assert.equal(rows[0].tournaments, 19);
});

test("parseRankingCsv tolère les fins de ligne CRLF et une ligne vide finale", () => {
  const rows = parseRankingCsv(`${EN_TETE_S}\r\n1,25831,AXELSEN,Viktor,DEN,105655,16\r\n\r\n`, { doubles: false });
  assert.equal(rows.length, 1);
});

test("parseRankingCsv ne décale pas les colonnes sur une ligne citée", () => {
  const rows = parseRankingCsv(`${EN_TETE_D}\r\n181,65389,SIOW,"Desiree, Hao Shan",MAS,97932,YAP,Rui Chen,MAS,6487,6\r\n`, { doubles: true });
  assert.deepEqual(rows[0].players.map((p) => p.id), ["65389", "97932"]);
  assert.equal(rows[0].points, 6487);
  assert.equal(rows[0].players[0].name, "Desiree, Hao Shan SIOW");
});

test("parseRankingCsv convertit points et tournois en nombres", () => {
  const rows = parseRankingCsv(`${EN_TETE_S}\r\n1,25831,AXELSEN,Viktor,DEN,105655,16\r\n`, { doubles: false });
  assert.equal(typeof rows[0].points, "number");
  assert.equal(typeof rows[0].tournaments, "number");
});

test("parseRankingCsv rend les identifiants en chaîne (espace d'ids des draws)", () => {
  const rows = parseRankingCsv(`${EN_TETE_S}\r\n1,25831,AXELSEN,Viktor,DEN,105655,16\r\n`, { doubles: false });
  assert.equal(rows[0].players[0].id, "25831");
  assert.equal(typeof rows[0].players[0].id, "string");
});

test("parseRankingCsv lève si le nombre de colonnes est faux", () => {
  assert.throws(() => parseRankingCsv(`${EN_TETE_S}\r\n1,25831,AXELSEN,Viktor\r\n`, { doubles: false }),
    /colonnes au lieu de 7/);
});

test("parseRankingCsv lève si un identifiant BWF manque", () => {
  assert.throws(() => parseRankingCsv(`${EN_TETE_S}\r\n1,,AXELSEN,Viktor,DEN,105655,16\r\n`, { doubles: false }),
    /identifiant BWF manquant/);
});

test("parseRankingCsv rend un tableau vide pour un fichier sans ligne de données", () => {
  assert.deepEqual(parseRankingCsv(`${EN_TETE_S}\r\n`, { doubles: false }), []);
});

// --- Chaîne de dates -----------------------------------------------------

test("l'ancre est la semaine 1 de 2024, datée du 2024-01-02", () => {
  assert.deepEqual(CSV_ANCHOR, { week: "2024-W01", date: "2024-01-02" });
  assert.equal(new Date(`${CSV_ANCHOR.date}T00:00:00Z`).getUTCDay(), 2, "doit être un mardi");
});

test("weekDateChain avance de 7 jours par semaine successive", () => {
  const c = weekDateChain(["2024-W01", "2024-W02", "2024-W03"]);
  assert.deepEqual(c.map((x) => x.date), ["2024-01-02", "2024-01-09", "2024-01-16"]);
});

test("weekDateChain franchit le changement d'année sans recalculer depuis le numéro", () => {
  // La BWF a une semaine 53 en 2024, année qui n'a que 52 semaines ISO : une
  // conversion « numéro de semaine -> date » casserait ici.
  const semaines = [];
  for (let w = 1; w <= 53; w++) semaines.push(`2024-W${String(w).padStart(2, "0")}`);
  semaines.push("2025-W02");
  const c = weekDateChain(semaines);
  assert.equal(c.find((x) => x.week === "2024-W53").date, "2024-12-31");
  assert.equal(c.find((x) => x.week === "2025-W02").date, "2025-01-07");
});

test("weekDateChain expose le numéro de semaine et l'année tels quels", () => {
  const c = weekDateChain(["2024-W01", "2024-W02"]);
  assert.equal(c[1].weekNumber, 2);
  assert.equal(c[1].year, 2024);
});

test("weekDateChain refuse une liste qui ne commence pas à l'ancre", () => {
  assert.throws(() => weekDateChain(["2024-W05", "2024-W06"]), /l'ancre attend 2024-W01/);
});

test("weekDateChain refuse une liste vide", () => {
  assert.throws(() => weekDateChain([]), /aucune semaine/);
});

test("weekDateChain produit uniquement des mardis sur les 75 semaines réelles", () => {
  const semaines = [];
  for (let w = 1; w <= 53; w++) semaines.push(`2024-W${String(w).padStart(2, "0")}`);
  for (let w = 2; w <= 23; w++) semaines.push(`2025-W${String(w).padStart(2, "0")}`);
  const c = weekDateChain(semaines);
  assert.equal(c.length, 75);
  assert.ok(c.every((x) => new Date(`${x.date}T00:00:00Z`).getUTCDay() === 2));
  // raccord décisif : la dernière semaine CSV + 7 jours = 1re publication de l'API
  assert.equal(c.at(-1).date, "2025-06-03");
});

// --- Variations de rang --------------------------------------------------

const P = (rank, ids, points = 1000) => ({
  rank, rankPrevious: null, rankChange: null, points, tournaments: 10,
  players: ids.map((id) => ({ id: String(id), slug: null, name: `J${id}`, country: "FRA" })),
});
const PUB = (date, disciplines) => ({ date, disciplines });

test("withRankChanges laisse la première publication entièrement à null", () => {
  const p = withRankChanges([PUB("2024-01-02", { MS: [P(1, [10])] })]);
  assert.equal(p[0].disciplines.MS[0].rankPrevious, null);
  assert.equal(p[0].disciplines.MS[0].rankChange, null);
});

test("withRankChanges suit la convention de l'API : positif = progression", () => {
  const p = withRankChanges([
    PUB("2024-01-02", { MS: [P(4, [10])] }),
    PUB("2024-01-09", { MS: [P(3, [10])] }),
  ]);
  const r = p[1].disciplines.MS[0];
  assert.equal(r.rankPrevious, 4);
  assert.equal(r.rankChange, 1, "gagner une place = +1, comme rankPrevious - rank");
});

test("withRankChanges rend un changement négatif pour une chute", () => {
  const p = withRankChanges([
    PUB("2024-01-02", { MS: [P(3, [10])] }),
    PUB("2024-01-09", { MS: [P(8, [10])] }),
  ]);
  assert.equal(p[1].disciplines.MS[0].rankChange, -5);
});

test("withRankChanges met null pour une entité absente la semaine précédente", () => {
  const p = withRankChanges([
    PUB("2024-01-02", { MS: [P(1, [10])] }),
    PUB("2024-01-09", { MS: [P(1, [10]), P(2, [99])] }),
  ]);
  const entrant = p[1].disciplines.MS.find((r) => r.players[0].id === "99");
  assert.equal(entrant.rankPrevious, null, "on ne connaît pas son vrai rang, il pouvait être 429e");
  assert.equal(entrant.rankChange, null);
});

test("withRankChanges apparie les paires quel que soit l'ordre des joueurs", () => {
  const p = withRankChanges([
    PUB("2024-01-02", { MD: [P(5, [20, 10])] }),
    PUB("2024-01-09", { MD: [P(3, [10, 20])] }),
  ]);
  assert.equal(p[1].disciplines.MD[0].rankPrevious, 5);
  assert.equal(p[1].disciplines.MD[0].rankChange, 2);
});

test("withRankChanges ne mélange pas les disciplines", () => {
  const p = withRankChanges([
    PUB("2024-01-02", { MS: [P(1, [10])], XD: [P(50, [10, 11])] }),
    PUB("2024-01-09", { MS: [P(2, [10])], XD: [P(40, [10, 11])] }),
  ]);
  assert.equal(p[1].disciplines.MS[0].rankPrevious, 1);
  assert.equal(p[1].disciplines.XD[0].rankPrevious, 50);
});

test("withRankChanges chaîne correctement sur trois semaines", () => {
  const p = withRankChanges([
    PUB("2024-01-02", { MS: [P(10, [1])] }),
    PUB("2024-01-09", { MS: [P(7, [1])] }),
    PUB("2024-01-16", { MS: [P(9, [1])] }),
  ]);
  assert.deepEqual(p.map((x) => x.disciplines.MS[0].rankChange), [null, 3, -2]);
});

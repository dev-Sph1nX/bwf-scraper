// Tests du matcher cotes <-> matchs BWF.
//   node --test test/
//
// Le matcher est pur : aucun navigateur, aucun I/O. Les fixtures viennent d'un
// vrai scrape (test/fixtures/oddsportal-2026-07-30.json).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { matchOdds, tournamentKeyFromBwfName, initialsOf } from "../lib/odds-match.mjs";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/oddsportal-2026-07-30.json", import.meta.url)));
const rows = fixture.matches;
const rowFor = (id) => rows.find((r) => r.eventId === id);

// Fabrique un candidat BWF minimal.
const P = (lastName, firstName, slug, countryCode = null, id = `${lastName}-${firstName}`) => ({
  id, nameDisplay: `${lastName.toUpperCase()} ${firstName}`, lastName, firstName, slug, countryCode,
});
const M = (eventName, t1, t2, extra = {}) => ({
  tmtId: 5514, tournamentName: "YONEX Taipei Open 2026", eventName, roundName: "R32",
  team1: { players: t1 }, team2: { players: t2 }, ...extra,
});

// --- Clé de tournoi -------------------------------------------------------

test("tournamentKeyFromBwfName retire l'année et garde les tokens signifiants", () => {
  const k = tournamentKeyFromBwfName("YONEX Taipei Open 2026");
  assert.ok(k.includes("taipei"));
  assert.ok(!k.includes("2026"));
});

test("le tournoi oddsportal 'taipei open' matche le nom BWF sponsorisé", () => {
  // La clé oddsportal doit être un sous-ensemble du nom BWF, sans liste de sponsors.
  const bwf = [M("MS", [P("LIN", "Chun Yi", "chun-yi-lin", "TPE")], [P("LEE", "Zii Jia", "zii-jia-lee", "MAS")])];
  const res = matchOdds(bwf, [rowFor("8WynYfLk")]);
  assert.equal(res.matched.length, 1, "le match devrait être apparié malgré 'YONEX' et '2026'");
});

test("un tournoi différent ne matche pas ('Korea Masters' vs 'Korea Open')", () => {
  const row = { ...rowFor("8WynYfLk"), league: "BWF World Tour - Men Korea Masters", tournamentKey: "korea masters" };
  const bwf = [{ ...M("MS", [P("LIN", "Chun Yi", "chun-yi-lin")], [P("LEE", "Zii Jia", "zii-jia-lee")]), tournamentName: "Korea Open 2026" }];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 0);
});

// --- Initiales ------------------------------------------------------------

test("initialsOf gère les prénoms composés et déjà réduits", () => {
  assert.deepEqual(initialsOf("Su Yu"), ["s", "y"]);
  assert.deepEqual(initialsOf("H. S."), ["h", "s"]);
  assert.deepEqual(initialsOf("Chun-Yi"), ["c", "y"]);
});

// --- Simples --------------------------------------------------------------

test("l'ordre des slugs de l'URL n'inverse pas les cotes", () => {
  // Ligne réelle : href = hoh…/shujiwo… mais affichage = Shujiwo (2.60) / Hoh (1.42).
  const row = rowFor("pQj9MZp4");
  assert.equal(row.p1.display, "Shujiwo P. B.");
  const bwf = [M("MS",
    [P("SHUJIWO", "Prahdiska Bagas", "prahdiska-bagas-shujiwo", "INA")],
    [P("HOH", "Justin Shou Wei", "justin-shou-wei-hoh", "MAS")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
  const m = res.matched[0];
  // Les cotes bougent : on compare à la fixture, pas à une valeur figée.
  assert.equal(m.oddsTeam1, row.odd1, "team1 BWF = Shujiwo doit recevoir la cote de p1");
  assert.equal(m.oddsTeam2, row.odd2);
});

test("les cotes suivent team1/team2 BWF même si l'ordre oddsportal est inversé", () => {
  const row = rowFor("pQj9MZp4"); // p1 = Shujiwo, p2 = Hoh
  // Ici on déclare Hoh en team1 : la cote 1.42 doit suivre Hoh.
  const bwf = [M("MS",
    [P("HOH", "Justin Shou Wei", "justin-shou-wei-hoh", "MAS")],
    [P("SHUJIWO", "Prahdiska Bagas", "prahdiska-bagas-shujiwo", "INA")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].oddsTeam1, row.odd2, "Hoh en team1 doit recevoir la cote de p2");
  assert.equal(res.matched[0].oddsTeam2, row.odd1);
  assert.equal(res.matched[0].swapped, true);
});

test("nom affiché sans initiales ('Lin Chun-Yi') traité comme nom complet", () => {
  const row = rowFor("8WynYfLk"); // Lee Z. J. vs Lin Chun-Yi
  const bwf = [M("MS", [P("LEE", "Zii Jia", "zii-jia-lee", "MAS")], [P("LIN", "Chun Yi", "chun-yi-lin", "TPE")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].oddsTeam1, row.odd1);
});

test("initiales multiples ('Prannoy H. S.')", () => {
  const row = rowFor("dreRQrwq"); // Gunawan J. vs Prannoy H. S.
  const bwf = [M("MS", [P("GUNAWAN", "Jason", "jason-gunawan", "HKG")], [P("PRANNOY", "H. S.", "h-s-prannoy", "IND")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
});

test("prénom BWF non découpé ('LEE JONGMIN') n'empêche pas le match", () => {
  // Cas réel : BWF stocke firstName "JONGMIN" (une initiale) là où oddsportal
  // affiche "Lee J. M." (deux). Première initiale concordante + BWF plus pauvre
  // = information manquante, pas contradiction.
  const row = rowFor("xIULhbRa"); // Jin Y./Lee J. M. vs Na S. S./Wang C.
  const bwf = [M("MD",
    [P("JIN", "Yong", "yong-jin", "KOR"), P("LEE", "JONGMIN", "jongmin-lee", "KOR")],
    [P("NA", "Sung Seung", "sung-seung-na", "KOR"), P("WANG", "Chan", "chan-wang", "KOR")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
});

test("initiales contradictoires empêchent le match", () => {
  const row = rowFor("dreRQrwq"); // Prannoy H. S.
  const bwf = [M("MS", [P("GUNAWAN", "Jason", "jason-gunawan")], [P("PRANNOY", "Wei Long", "wei-long-prannoy")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 0, "Prannoy W. L. n'est pas Prannoy H. S.");
});

// --- Doubles --------------------------------------------------------------

test("double apparié sur les deux noms de famille", () => {
  const row = rowFor("Y7AQt3WQ"); // Watanabe/Taguchi vs Tsai/Sung
  const bwf = [M("XD",
    [P("WATANABE", "Yuta", "yuta-watanabe", "JPN"), P("TAGUCHI", "Moe", "moe-taguchi", "JPN")],
    [P("TSAI", "Fang Chih", "fang-chih-tsai", "TPE"), P("SUNG", "Yu Hsuan", "yu-hsuan-sung", "TPE")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].oddsTeam1, row.odd1);
});

test("double : l'ordre des joueurs dans la paire est indifférent", () => {
  const row = rowFor("Y7AQt3WQ");
  const bwf = [M("XD",
    [P("TAGUCHI", "Moe", "moe-taguchi"), P("WATANABE", "Yuta", "yuta-watanabe")],
    [P("SUNG", "Yu Hsuan", "yu-hsuan-sung"), P("TSAI", "Fang Chih", "fang-chih-tsai")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].oddsTeam1, row.odd1);
});

// --- Sécurité : ambiguïté et faux positifs --------------------------------

test("deux candidats indiscernables partent en 'ambiguous', pas en faux match", () => {
  const row = rowFor("pQj9MZp4"); // ligne réellement cotée
  const dup = () => M("MS",
    [P("SHUJIWO", "Prahdiska Bagas", "prahdiska-bagas-shujiwo", "INA")],
    [P("HOH", "Justin Shou Wei", "justin-shou-wei-hoh", "MAS")]);
  const res = matchOdds([{ ...dup(), tmtId: 5514 }, { ...dup(), tmtId: 5514, roundName: "R16" }], [row]);
  assert.equal(res.matched.length, 0);
  assert.equal(res.ambiguous.length, 1);
});

test("mauvaise discipline : aucun match", () => {
  const row = rowFor("pQj9MZp4"); // MS
  const bwf = [M("WS",
    [P("SHUJIWO", "Prahdiska Bagas", "prahdiska-bagas-shujiwo")],
    [P("HOH", "Justin Shou Wei", "justin-shou-wei-hoh")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 0);
});

test("noms de famille identiques départagés par les initiales", () => {
  const row = rowFor("xIULhbRa"); // Jin Y./Lee J. M. vs Na S. S./Wang C.
  const good = M("MD",
    [P("JIN", "Yong", "yong-jin", "KOR"), P("LEE", "Jae Min", "jae-min-lee", "KOR")],
    [P("NA", "Sung Seung", "sung-seung-na", "KOR"), P("WANG", "Chan", "chan-wang", "KOR")]);
  const decoy = M("MD",
    [P("JIN", "Yong", "yong-jin", "KOR"), P("LEE", "Zii Jia", "zii-jia-lee", "MAS")],
    [P("NA", "Sung Seung", "sung-seung-na", "KOR"), P("WANG", "Chan", "chan-wang", "KOR")]);
  const res = matchOdds([decoy, good], [row]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].bwf.team1.players[1].firstName, "Jae Min");
});

// --- Buckets et stats -----------------------------------------------------

test("une ligne sans cote n'est jamais appariée", () => {
  const row = { ...rowFor("pQj9MZp4"), odd1: null, odd2: null };
  const bwf = [M("MS",
    [P("SHUJIWO", "Prahdiska Bagas", "prahdiska-bagas-shujiwo")],
    [P("HOH", "Justin Shou Wei", "justin-shou-wei-hoh")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 0);
  assert.equal(res.noOdds.length, 1);
});

test("un match déjà joué est écarté (settled)", () => {
  const row = { ...rowFor("pQj9MZp4"), settled: true };
  const bwf = [M("MS",
    [P("SHUJIWO", "Prahdiska Bagas", "prahdiska-bagas-shujiwo")],
    [P("HOH", "Justin Shou Wei", "justin-shou-wei-hoh")])];
  const res = matchOdds(bwf, [row]);
  assert.equal(res.matched.length, 0);
  assert.equal(res.settled.length, 1);
});

test("les buckets couvrent toutes les lignes en entrée, sans doublon", () => {
  const res = matchOdds([], rows);
  const total = res.matched.length + res.ambiguous.length + res.unmatchedOdds.length
    + res.noOdds.length + res.settled.length;
  assert.equal(total, rows.length);
});

test("un match BWF sans ligne oddsportal se retrouve dans unmatchedBwf", () => {
  const bwf = [M("MS", [P("AXELSEN", "Viktor", "viktor-axelsen", "DEN")], [P("ANTONSEN", "Anders", "anders-antonsen", "DEN")])];
  const res = matchOdds(bwf, []);
  assert.equal(res.unmatchedBwf.length, 1);
});

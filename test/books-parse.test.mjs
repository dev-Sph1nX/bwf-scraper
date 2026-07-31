// Tests des parseurs de cotes bookmakers (Betclic, Unibet, Winamax).
//   node --test test/books-parse.test.mjs
//
// Les fixtures sont des captures RÉELLES (2026-07-31), réduites à 3-5 matchs :
// mêmes structures, mêmes pièges (cotes à virgule, dates compactes, clés de
// cache volatiles). Chaque parseur produit des lignes normalisées communes :
//   { book, bookMatchId, srId, tournament, discipline, p1, p2,
//     odd1, odd2, startUtc, isLive }
// `srId` est l'identifiant Sportradar, COMMUN aux trois opérateurs — c'est lui
// qui permet de joindre les cotes d'un même match entre bookmakers sans aucun
// rapprochement de noms.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseBetclicPage } from "../lib/book-betclic.mjs";
import { extractUnibetToken, parseUnibetLvs } from "../lib/book-unibet.mjs";
import { extractPreloadedState, parseWinamaxState } from "../lib/book-winamax.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => readFileSync(join(FIX, f), "utf8");

// --- Betclic ----------------------------------------------------------------

test("betclic : matchs extraits du ng-state par la forme, pas par la clé", () => {
  // La fixture utilise des clés grpc:111111/grpc:222222 volontairement
  // différentes des vraies (hachages volatils par build Angular).
  const { rows } = parseBetclicPage(read("betclic-page.html"));
  assert.equal(rows.length, 3);
});

test("betclic : ligne simple prématch complète", () => {
  const { rows } = parseBetclicPage(read("betclic-page.html"));
  const hoh = rows.find((r) => r.p1 === "Justin Hoh");
  assert.deepEqual(hoh, {
    book: "betclic",
    bookMatchId: "1183683200425984",
    srId: "73288292",
    tournament: "Open de Chine Taipei",
    discipline: "MS",
    p1: "Justin Hoh",
    p2: "Bin Tae Yoo",
    odd1: 1.52,
    odd2: 1.9,
    startUtc: "2026-07-31T11:30:00.000Z",
    isLive: false,
  });
});

test("betclic : double + live + discipline MD", () => {
  const { rows } = parseBetclicPage(read("betclic-page.html"));
  const dbl = rows.find((r) => r.srId === "73296182");
  assert.equal(dbl.discipline, "MD");
  assert.equal(dbl.isLive, true);
  assert.equal(dbl.p1, "C. Ye Lin / Y S. Lin");
  assert.equal(dbl.odd1, 10);
  assert.equal(dbl.odd2, 1.02);
});

test("betclic : une cote ≤ 1 (marché quasi réglé, non misable) devient null", () => {
  // Cas observé en live réel : "Okimoto 1 / George 15". Même règle que les
  // parseurs Unibet et Winamax : une cote qui ne paie pas n'est pas une cote.
  const html = read("betclic-page.html");
  const rigged = html.replace(/"odds":\s*1\.52/, '"odds": 1').replace(/"odds":\s*1\.9(?=\s*[,}])/, '"odds": 15');
  const { rows } = parseBetclicPage(rigged);
  const hoh = rows.find((r) => r.srId === "73288292");
  assert.equal(hoh.odd1, null);
  assert.equal(hoh.odd2, 15);
});

test("betclic : totalCount et liste des compétitions pour la pagination", () => {
  const { totalCount, competitions } = parseBetclicPage(read("betclic-page.html"));
  assert.equal(totalCount, 8); // la vraie page en annonçait 8, la fixture n'en garde que 3
  assert.deepEqual(competitions.map((c) => c.id), ["19610", "19609", "19612"]);
  assert.equal(competitions[2].name, "Open de Chine Taipei H.");
});

// --- Unibet -------------------------------------------------------------------

test("unibet : token anonyme extrait de la page", () => {
  const token = extractUnibetToken(read("unibet-page.html"));
  assert.match(token, /^B33ah75WPIlj8EQjnHx8_SQda/);
  assert.ok(token.length > 20);
});

test("unibet : les 5 événements badminton sont extraits", () => {
  const rows = parseUnibetLvs(JSON.parse(read("unibet-lvs.json")));
  assert.equal(rows.length, 5);
});

test("unibet : ligne simple avec cotes à virgule décodées et date compacte UTC", () => {
  const rows = parseUnibetLvs(JSON.parse(read("unibet-lvs.json")));
  const chou = rows.find((r) => r.p1 === "TC.Chou");
  assert.deepEqual(chou, {
    book: "unibet",
    bookMatchId: "e3368088",
    srId: "73296178",
    tournament: "Taipei Open",
    discipline: "MS",
    p1: "TC.Chou",
    p2: "Y-K.Wang",
    odd1: 1.15, // "1,15" dans le flux
    odd2: 3.7,  // "3,70"
    startUtc: "2026-07-31T11:35:00.000Z", // "2607311135" = AAMMJJHHMM UTC
    isLive: false,
  });
});

test("unibet : disciplines déduites du suffixe de ligue (DH→MD, DF→WD)", () => {
  const rows = parseUnibetLvs(JSON.parse(read("unibet-lvs.json")));
  assert.equal(rows.find((r) => r.p1 === "Chia/Tai").discipline, "MD");
  assert.equal(rows.find((r) => r.p1 === "Jongsat/Wedler").discipline, "WD");
});

// --- Winamax --------------------------------------------------------------------

test("winamax : PRELOADED_STATE extrait du HTML (accolades imbriquées)", () => {
  const state = extractPreloadedState(read("winamax-page.html"));
  assert.ok(state.matches);
  assert.equal(Object.keys(state.matches).length, 3);
});

test("winamax : ligne simple prématch avec noms COMPLETS des compétiteurs", () => {
  const { rows } = parseWinamaxState(extractPreloadedState(read("winamax-page.html")));
  const hoh = rows.find((r) => r.srId === "73288292");
  assert.deepEqual(hoh, {
    book: "winamax",
    bookMatchId: "73288292",
    srId: "73288292", // chez Winamax l'id de match EST l'id Sportradar
    tournament: "Open de Taipei",
    discipline: "MS", // « Simples Hommes »
    p1: "Justin Hoh", // competitor1Name, pas le label abrégé « J. Hoh »
    p2: "Tae Bin Yoo",
    odd1: 1.58,
    odd2: 2,
    startUtc: "2026-07-31T11:30:00.000Z", // matchStart = epoch secondes UTC
    isLive: false,
  });
});

test("winamax : live + doubles (« Doubles Hommes » → MD)", () => {
  const { rows } = parseWinamaxState(extractPreloadedState(read("winamax-page.html")));
  const live = rows.find((r) => r.srId === "73295562");
  assert.equal(live.isLive, true);
  const dbl = rows.find((r) => r.srId === "73296182");
  assert.equal(dbl.discipline, "MD");
  assert.equal(dbl.p1, "C.Y.Lin / Y.S.Lin");
});

test("winamax : un mainBet qui n'est pas « Vainqueur » du match est écarté", () => {
  // Cas observé en live réel : pendant un match, mainBetId peut pointer le
  // marché « 2e set - Vainqueur ». Enregistrer ces cotes comme cotes du match
  // serait une donnée FAUSSE — pire qu'une donnée absente.
  const state = extractPreloadedState(read("winamax-page.html"));
  const bet = state.bets[String(state.matches["73295562"].mainBetId)];
  bet.betTitle = "2e set  - Vainqueur";
  bet.marketId = 187;
  const { rows, complete } = parseWinamaxState(state);
  assert.equal(rows.find((r) => r.srId === "73295562"), undefined);
  // …mais la couverture reste jugée sur les MATCHS VUS, pas sur les lignes :
  // un marché suspendu/absent est normal, ce n'est pas un défaut de scrape.
  assert.equal(complete, true);
});

test("winamax : auto-vérification de couverture via mainMatchCount", () => {
  const { rows, expectedCount, complete } = parseWinamaxState(
    extractPreloadedState(read("winamax-page.html")),
  );
  assert.equal(expectedCount, 3);
  assert.equal(rows.length, 3);
  assert.equal(complete, true);
});

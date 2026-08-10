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

// --- Marché « nombre de sets » (champ optionnel `sets`) -----------------------
//
// Fixtures inline issues de captures RÉELLES du 2026-08-10 (tennis, seul sport
// coté hors saison badminton) : mêmes structures que celles que servira le
// badminton au prochain tournoi. Vérification en réel prévue mi-septembre
// (docs/verif-cotes-sets.md).

import { setsFromOutcomes } from "../lib/books.mjs";
import { setsFromBetclicMarkets } from "../lib/book-betclic.mjs";
import { parseUnibetMarketCards, setsFromUnibetCards, slugifyUnibet, unibetMatchPaths } from "../lib/book-unibet.mjs";
import { parseWinamaxMatchSets } from "../lib/book-winamax.mjs";

test("sets : issues « 2 »/« 3 » et « Plus/Moins de 2,5 » comprises, cote ≤ 1 neutralisée", () => {
  assert.deepEqual(setsFromOutcomes([{ label: "2", odd: 1.44 }, { label: "3", odd: 2.1 }]),
    { odd2: 1.44, odd3: 2.1 });
  assert.deepEqual(setsFromOutcomes([{ label: "Moins de 2,5", odd: 1.44 }, { label: "Plus de 2,5", odd: 2.1 }]),
    { odd2: 1.44, odd3: 2.1 });
  assert.deepEqual(setsFromOutcomes([{ label: "2 sets", odd: 1.0 }, { label: "3 sets", odd: 2.25 }]),
    { odd2: null, odd3: 2.25 });
  assert.equal(setsFromOutcomes([{ label: "Oui", odd: 1.5 }]), null);
});

test("winamax : « Nombre exact de sets » (196) préféré sur la page match", () => {
  // Structure réelle (match 73252872 du 2026-08-10) réduite aux deux marchés.
  const state = {
    bets: {
      b1: { matchId: "73252872", marketId: 314, betTitle: "Nombre de sets", specialBetValue: "total=2.5", outcomes: [10, 11] },
      b2: { matchId: "73252872", marketId: 196, betTitle: "Nombre exact de sets", outcomes: [20, 21] },
      autre: { matchId: "999", marketId: 196, betTitle: "Nombre exact de sets", outcomes: [30] },
    },
    outcomes: { 10: { label: "Plus de 2,5" }, 11: { label: "Moins de 2,5" }, 20: { label: "2" }, 21: { label: "3" } },
    odds: { 10: 2.1, 11: 1.44, 20: 1.44, 21: 2.1 },
  };
  assert.deepEqual(parseWinamaxMatchSets(state, "73252872"),
    { market: "Nombre exact de sets", odd2: 1.44, odd3: 2.1 });
  // sans marché exact, l'over/under 2,5 fait l'affaire (équivalent en best of 3)
  delete state.bets.b2;
  assert.deepEqual(parseWinamaxMatchSets(state, "73252872"),
    { market: "Nombre de sets", odd2: 1.44, odd3: 2.1 });
  assert.equal(parseWinamaxMatchSets(state, "73999999"), null);
});

test("betclic : « Les deux joueurs gagnent un set » = 2/3 sets (Non/Oui)", () => {
  const markets = [
    { name: "Vainqueur du match", selections: [{ label: "A", odd: 1.75 }, { label: "B", odd: 2.03 }] },
    { name: "Les deux joueurs gagnent un set", selections: [{ label: "Oui", odd: 2.15 }, { label: "Non", odd: 1.53 }] },
    { name: "Score final (sets)", selections: [{ label: "2 - 0", odd: 2.7 }, { label: "0 - 2", odd: 3 }, { label: "2 - 1", odd: 3.9 }, { label: "1 - 2", odd: 4.2 }] },
  ];
  assert.deepEqual(setsFromBetclicMarkets(markets),
    { market: "Les deux joueurs gagnent un set", odd2: 1.53, odd3: 2.15 });
  // un marché « Nombre de sets » nommé ainsi prime s'il existe
  markets.unshift({ name: "Nombre de sets", selections: [{ label: "2", odd: 1.5 }, { label: "3", odd: 2.4 }] });
  assert.deepEqual(setsFromBetclicMarkets(markets), { market: "Nombre de sets", odd2: 1.5, odd3: 2.4 });
});

test("betclic : repli « Score final (sets) » -> cotes par score, jamais recombinées", () => {
  const markets = [
    { name: "Score final (sets)", selections: [{ label: "2 - 0", odd: 2.7 }, { label: "0 - 2", odd: 3 }, { label: "2 - 1", odd: 3.9 }, { label: "1 - 2", odd: 4.2 }] },
  ];
  assert.deepEqual(setsFromBetclicMarkets(markets), {
    market: "Score final (sets)", odd2: null, odd3: null,
    scores: { "2-0": 2.7, "0-2": 3, "2-1": 3.9, "1-2": 4.2 },
  });
  assert.equal(setsFromBetclicMarkets([{ name: "Vainqueur du match", selections: [] }]), null);
});

test("unibet : carte « Nombre de sets » lue dans le HTML SSR de la page match", () => {
  // Extrait réel (match 3370100 du 2026-08-10), virgules françaises comprises.
  const html =
    '<div class="psel-market-card"><span class="psel-title-market__label" data-group-id="190429492">' +
    "Nombre de sets dans le match - Match</span>" +
    '<span class="psel-outcome__label">2 sets</span><!----><span class="psel-outcome__data">1,49</span>' +
    '<span class="psel-outcome__label">3 sets</span><!----><span class="psel-outcome__data">2,25</span></div>' +
    '<div class="psel-market-card"><span class="psel-title-market__label">Vainqueur du match</span>' +
    '<span class="psel-outcome__label">L. Darderi</span><!----><span class="psel-outcome__data">1,75</span></div>';
  const cards = parseUnibetMarketCards(html);
  assert.equal(cards.length, 2);
  assert.deepEqual(setsFromUnibetCards(cards),
    { market: "Nombre de sets dans le match - Match", odd2: 1.49, odd3: 2.25 });
  assert.equal(setsFromUnibetCards([{ title: "Vainqueur", outcomes: [] }]), null);
});

test("unibet : URL de page match reconstruite depuis le flux (slugs non libres)", () => {
  // "Toronto DF" + "Siniakov/Zhang vs Hunter/Krawczy" -> href réel du site.
  assert.equal(slugifyUnibet("Op Australie F"), "op-australie-f");
  const paths = unibetMatchPaths({
    items: {
      e3370126: {
        eType: "G", desc: "Siniakov/Zhang vs Hunter/Krawczy",
        path: { Sport: "Tennis", Category: "WTA", League: "Toronto DF" },
      },
      m123: { markettypeId: 8500, parent: "e3370126" },
    },
  });
  assert.equal(paths.get("e3370126"), "wta/toronto-df/3370126/siniakov-zhang-vs-hunter-krawczy");
});

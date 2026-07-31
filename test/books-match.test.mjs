// Tests de l'appariement bookmakers ↔ matchs BWF.
//   node --test test/books-match.test.mjs
//
// Différence avec lib/odds-match.mjs (oddsportal) : les noms de tournoi des
// bookmakers français sont TRADUITS (« Open de Chine Taipei » pour « Taipei
// Open 2026 ») — l'exigence « tous les tokens présents côté BWF » ne peut pas
// tenir. Le pool de candidats se restreint donc par discipline + proximité de
// DATE (les cotes portent l'heure UTC du match), et la décision reste portée
// par le score de joueurs, avec les mêmes seuils conservateurs : au moindre
// doute, pas d'appariement.

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchBooks } from "../lib/books-match.mjs";

const bwf = (over = {}) => ({
  tournamentName: "Taipei Open 2026",
  eventName: "MS",
  roundName: "R16",
  matchTime: "2026-07-31 19:30:00", // heure locale du lieu
  team1: { players: [{ id: "1", nameDisplay: "Justin HOH", lastName: "HOH", firstName: "Justin", slug: "justin-hoh", countryCode: "MAS" }] },
  team2: { players: [{ id: "2", nameDisplay: "Tae Bin YOO", lastName: "YOO", firstName: "Tae Bin", slug: "tae-bin-yoo", countryCode: "KOR" }] },
  a: "p:1", b: "p:2", prob: 62,
  ...over,
});

const groupe = (over = {}) => ({
  key: "73288292", srId: "73288292",
  tournament: "Open de Taipei", discipline: "MS",
  p1: "Justin Hoh", p2: "Tae Bin Yoo",
  startUtc: "2026-07-31T11:30:00.000Z",
  isLive: false,
  books: { winamax: { odd1: 1.58, odd2: 2.0 } },
  ...over,
});

test("un groupe s'apparie à son match BWF malgré le nom de tournoi traduit", () => {
  const res = matchBooks([bwf()], [groupe()]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].group.key, "73288292");
  assert.equal(res.matched[0].swapped, false);
});

test("l'orientation inversée est détectée (p1 opérateur = team2 BWF)", () => {
  const res = matchBooks([bwf()], [groupe({ p1: "Tae Bin Yoo", p2: "Justin Hoh" })]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].swapped, true);
});

test("hors fenêtre de date, aucun appariement (autre édition du même duel)", () => {
  const res = matchBooks([bwf({ matchTime: "2026-05-02 19:30:00" })], [groupe()]);
  assert.equal(res.matched.length, 0);
  assert.equal(res.unmatched.length, 1);
});

test("deux candidats indiscernables -> ambigu, jamais forcé", () => {
  // Deux frères aux noms très proches, même jour, même discipline.
  const c1 = bwf();
  const c2 = bwf({
    roundName: "R32",
    team2: { players: [{ id: "3", nameDisplay: "Tae Bin YOO", lastName: "YOO", firstName: "Tae Bin", slug: "tae-bin-yoo-2", countryCode: "KOR" }] },
    b: "p:3",
  });
  const res = matchBooks([c1, c2], [groupe()]);
  assert.equal(res.matched.length, 0);
  assert.equal(res.ambiguous.length, 1);
});

test("doubles : initiales en tête et collées (« A.Chia », « H.C.Chiu ») reconnues", () => {
  // Les trois bookmakers écrivent les paires ainsi : "A.Chia / A.Tai",
  // "H.C.Chiu / C.Wang". C'est l'inverse d'oddsportal ("Chia A.") — sans
  // remise en forme, aucun double ne s'appariait (constaté sur données réelles).
  const paire = bwf({
    eventName: "MD",
    team1: { players: [
      { id: "10", nameDisplay: "Aaron CHIA", lastName: "CHIA", firstName: "Aaron", slug: "aaron-chia", countryCode: "MAS" },
      { id: "11", nameDisplay: "Wei Chien TAI", lastName: "TAI", firstName: "Wei Chien", slug: "wei-chien-tai", countryCode: "MAS" },
    ] },
    team2: { players: [
      { id: "12", nameDisplay: "Jong Hoon LEE", lastName: "LEE", firstName: "Jong Hoon", slug: "jong-hoon-lee", countryCode: "KOR" },
      { id: "13", nameDisplay: "Po Hsuan YANG", lastName: "YANG", firstName: "Po Hsuan", slug: "po-hsuan-yang", countryCode: "KOR" },
    ] },
    a: "pair:10-11", b: "pair:12-13",
  });
  const g = groupe({
    key: "73297292", srId: "73297292", discipline: "MD",
    p1: "A.Chia / W.C.Tai", p2: "J.H.Lee / P.H.Yang",
  });
  const res = matchBooks([paire], [g]);
  assert.equal(res.matched.length, 1);
  assert.equal(res.matched[0].swapped, false);
});

test("une discipline différente ne matche jamais, même à noms égaux", () => {
  const res = matchBooks([bwf({ eventName: "WS" })], [groupe()]);
  assert.equal(res.matched.length, 0);
});

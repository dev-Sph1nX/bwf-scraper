// Tests des fonctions pures d'analyse du scraper oddsportal.
//   node --test test/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDisplayName, parseParticipant, stripSlugId, alignSlugs,
  disciplineFromLeague, tournamentKeyFromLeague, dateRange, toUrlDate,
} from "../lib/odds.mjs";

// --- Noms affichés --------------------------------------------------------

test("nom + initiales simples", () => {
  const r = parseDisplayName("Shujiwo P. B.");
  assert.equal(r.surname, "shujiwo");
  assert.deepEqual(r.initials, ["p", "b"]);
});

test("nom complet sans initiales conservé entier", () => {
  const r = parseDisplayName("Lin Chun-Yi");
  assert.equal(r.surname, "lin chun yi");
  assert.deepEqual(r.initials, []);
});

test("initiales composées à tiret extraites du nom de famille", () => {
  // Régression : "Lee J-H." donnait un nom de famille "lee j h".
  const r = parseDisplayName("Lee J-H.");
  assert.equal(r.surname, "lee");
  assert.deepEqual(r.initials, ["j", "h"]);
});

test("initiales composées et simples mélangées", () => {
  const r = parseDisplayName("Huang Y-H.");
  assert.equal(r.surname, "huang");
  assert.deepEqual(r.initials, ["y", "h"]);
});

test("dernière initiale sans point final", () => {
  // Régression : "Lee F. C" donnait un nom de famille "lee f c".
  const r = parseDisplayName("Lee F. C");
  assert.equal(r.surname, "lee");
  assert.deepEqual(r.initials, ["f", "c"]);
});

test("initiales mêlant point et tiret", () => {
  // Régression : "Liao J.-F." donnait un nom de famille "liao j f".
  const r = parseDisplayName("Liao J.-F.");
  assert.equal(r.surname, "liao");
  assert.deepEqual(r.initials, ["j", "f"]);
});

test("un prénom court non abrégé n'est pas pris pour des initiales", () => {
  assert.equal(parseDisplayName("Yang Po-Hsuan").surname, "yang po hsuan");
  assert.equal(parseDisplayName("Lin Chun-Yi").surname, "lin chun yi");
});

test("participant double découpé sur le slash", () => {
  const p = parseParticipant("Watanabe Y./Taguchi M.");
  assert.equal(p.length, 2);
  assert.equal(p[0].surname, "watanabe");
  assert.equal(p[1].surname, "taguchi");
});

// --- Slugs ----------------------------------------------------------------

test("stripSlugId retire l'identifiant de 8 caractères", () => {
  assert.equal(stripSlugId("lee-zii-jia-fkHsTftd"), "lee-zii-jia");
  assert.equal(stripSlugId("watanabe-taguchi-bgKxnu09"), "watanabe-taguchi");
});

test("alignSlugs remet les slugs dans l'ordre d'affichage", () => {
  // Cas réel : href = hoh…/shujiwo… pour un affichage Shujiwo / Hoh.
  const parts = [parseParticipant("Shujiwo P. B."), parseParticipant("Hoh J.")];
  const [s1, s2] = alignSlugs(["hoh-justin-shou-wei", "shujiwo-prahdiska-bagas"], parts);
  assert.equal(s1, "shujiwo-prahdiska-bagas");
  assert.equal(s2, "hoh-justin-shou-wei");
});

test("alignSlugs laisse l'ordre inchangé quand il est déjà bon", () => {
  const parts = [parseParticipant("Watanabe Y./Taguchi M."), parseParticipant("Tsai F. C./Sung Y.")];
  const [s1] = alignSlugs(["watanabe-taguchi", "tsai-sung"], parts);
  assert.equal(s1, "watanabe-taguchi");
});

test("alignSlugs renvoie null plutôt que de deviner", () => {
  const parts = [parseParticipant("Dupont A."), parseParticipant("Martin B.")];
  assert.deepEqual(alignSlugs(["inconnu-un", "inconnu-deux"], parts), [null, null]);
});

// --- Libellés de ligue ----------------------------------------------------

test("les doubles sont reconnus avant les simples", () => {
  assert.equal(disciplineFromLeague("BWF World Tour - Doubles Men Taipei Open"), "MD");
  assert.equal(disciplineFromLeague("BWF World Tour - Doubles Women Taipei Open"), "WD");
  assert.equal(disciplineFromLeague("BWF World Tour - Mixed Doubles Taipei Open"), "XD");
  assert.equal(disciplineFromLeague("BWF World Tour - Men Taipei Open"), "MS");
  assert.equal(disciplineFromLeague("BWF World Tour - Women Taipei Open"), "WS");
});

test("clé de tournoi indépendante de la discipline", () => {
  const keys = [
    "BWF World Tour - Doubles Men Taipei Open",
    "BWF World Tour - Mixed Doubles Taipei Open",
    "BWF World Tour - Women Taipei Open",
  ].map(tournamentKeyFromLeague);
  assert.deepEqual(new Set(keys), new Set(["taipei open"]));
});

// --- Dates ----------------------------------------------------------------

test("dateRange traverse correctement une fin de mois", () => {
  assert.deepEqual(dateRange("2026-07-30", 4), ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
});

test("toUrlDate produit le format oddsportal", () => {
  assert.equal(toUrlDate("2026-07-30"), "20260730");
});

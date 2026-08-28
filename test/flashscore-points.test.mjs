// Décodeur du point par point Flashscore.
//
// Le flux est du texte à séparateurs, sans schéma ni version : le jour où
// Flashscore décale un champ, seul un test sur des flux réels le dit. Les
// fixtures ci-dessous sont des extraits littéraux du flux `df_mh_1_<fsId>`,
// et les conventions qu'elles vérifient (HC/HE = score home/away, HK =
// marqueur, HG = serveur) sont celles mesurées par sonde sur 24 matchs.
//
// Le point dur est le REFUS DE DEVINER : quand le flux saute des points
// (constaté en production : un score qui passe de 15-10 à 18-10), le décodeur
// doit le signaler, pas combler le trou. Sans ce garde-fou, un match troué
// entrerait dans l'export avec une séquence silencieusement fausse.

import test from "node:test";
import assert from "node:assert/strict";
import { decoder } from "../lib/flashscore-points.mjs";

/** Fabrique une section « point » du flux. */
const pt = (hc, he, hg, hk) => `HC÷${hc}¬HE÷${he}¬HG÷${hg}¬HK÷${hk}¬`;
const manche = (n) => `HA÷Set ${n}¬HB÷Point by point - Set ${n}¬`;

test("un flux sans point par point rend null", () => {
  assert.equal(decoder("0"), null);
  assert.equal(decoder(""), null);
  assert.equal(decoder("HA÷Set 1¬HB÷Autre chose¬"), null);
});

test("marqueur lu sur le score, serveur lu sur HG", () => {
  const flux = [manche(1), pt(0, 1, 1, 2), pt(1, 1, 2, 1), pt(2, 1, 1, 1)].join("~");
  const d = decoder(flux);
  assert.deepEqual(d.anomalies, []);
  assert.equal(d.sets.length, 1);
  assert.deepEqual(d.sets[0].fin, [2, 1]);
  assert.equal(d.sets[0].m, "211");  // away, home, home
  assert.equal(d.sets[0].s, "121");  // le service suit le gagnant du rallye
});

test("le numéro de manche vient du titre, pas du rang d'apparition", () => {
  const flux = [manche(3), pt(1, 0, 1, 1)].join("~");
  assert.equal(decoder(flux).sets[0].no, 3);
});

test("un saut de score est signalé, jamais comblé", () => {
  // 1-0 → 4-0 : deux points manquants dans le flux Flashscore (le cas réel
  // rencontré en production était un 15-10 → 18-10).
  const flux = [manche(1), pt(1, 0, 1, 1), pt(4, 0, 1, 1), pt(4, 1, 1, 2)].join("~");
  const d = decoder(flux);
  assert.equal(d.anomalies.length, 1);
  assert.match(d.anomalies[0], /1-0 → 4-0/);
  // Le point douteux est marqué « 0 » : ni équipe 1, ni équipe 2 inventée.
  assert.equal(d.sets[0].m, "102");
});

test("un HK en désaccord avec le score est signalé (le score fait foi)", () => {
  const flux = [manche(1), pt(1, 0, 1, 2)].join("~");
  const d = decoder(flux);
  assert.equal(d.sets[0].m, "1");            // le score dit équipe 1
  assert.match(d.anomalies[0], /HK=2/);      // et le désaccord est consigné
});

test("un HG absent ou aberrant devient 0 (serveur inconnu), sans anomalie", () => {
  const flux = [manche(1), `HC÷1¬HE÷0¬HK÷1¬`, pt(1, 1, 9, 2)].join("~");
  const d = decoder(flux);
  assert.equal(d.sets[0].s, "00");
  assert.deepEqual(d.anomalies, []);
});

test("plusieurs manches, dans l'ordre du flux", () => {
  const flux = [
    manche(1), pt(1, 0, 1, 1), pt(1, 1, 1, 2),
    manche(2), pt(0, 1, 2, 2),
  ].join("~");
  const d = decoder(flux);
  assert.deepEqual(d.sets.map((s) => s.no), [1, 2]);
  assert.deepEqual(d.sets.map((s) => s.fin), [[1, 1], [0, 1]]);
});

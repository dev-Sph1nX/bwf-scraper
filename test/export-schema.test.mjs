// Neutralité du schéma d'export.
//
// L'export est la SEULE surface d'analyse : ce qui y figure sera pris pour un
// fait. Une colonne dérivée y fige un choix (normalisation d'une marge, fenêtre
// d'un agrégat) que le consommateur ne peut plus interroger — et un agrégat de
// carrière décrit un match de 2022 avec ce qui s'est passé en 2026.
//
// Ce test est le garde-fou structurel : ajouter une colonne `proba_*` ou
// `taux_*` le casse, y compris pour moi dans six mois.

import test from "node:test";
import assert from "node:assert/strict";
import {
  MATCH_COLS, PLAYER_COLS, ODDS_COLS, TOTALS_COLS,
  MOTIFS_DERIVES, colonnesDerivees, assertPur,
} from "../lib/export-schema.mjs";

const TOUS = { MATCH_COLS, PLAYER_COLS, ODDS_COLS, TOTALS_COLS };

test("aucun fichier ne porte de colonne dérivée", () => {
  for (const [nom, cols] of Object.entries(TOUS)) {
    assert.deepEqual(colonnesDerivees(cols), [], `${nom} doit être pur`);
  }
});

test("le garde-fou refuse réellement une colonne dérivée", () => {
  // Sans cette assertion, un colonnesDerivees() qui retourne toujours []
  // rendrait le test précédent vide de sens.
  assert.throws(() => assertPur(["match_id", "proba1_cloture"]), /proba1_cloture/);
  assert.throws(() => assertPur(["taux_victoire"]), /taux_victoire/);
  assert.throws(() => assertPur(["elo_avant"]), /elo_avant/);
  assert.throws(() => assertPur(["MARGE_CLOTURE"]), /MARGE_CLOTURE/, "insensible à la casse");
});

test("les colonnes retirées ne peuvent pas revenir", () => {
  const bannies = [
    // agrégats de carrière (fuite du futur)
    "matchs", "victoires", "defaites", "taux_victoire", "matchs_simple",
    "matchs_double", "disciplines", "tournois", "premier_match", "dernier_match",
    "saisons", "points_gagnes", "points_concedes", "rang_actuel",
    "rang_actuel_discipline", "points_actuels", "meilleur_rang_depuis_2024",
    "meilleur_rang_discipline", "meilleur_rang_date",
    // probabilités et marges (choix de normalisation caché)
    "marge_ouverture", "marge_cloture", "proba1_ouverture", "proba1_cloture",
    "derive_proba1", "marge_manches_cloture", "proba_3manches_cloture",
    "proba1_manches_cloture", "ecart_proba1_manches", "proba_over_cloture",
  ];
  const presentes = Object.values(TOUS).flat();
  for (const b of bannies) {
    assert.ok(!presentes.includes(b), `${b} ne doit plus être exportée`);
  }
});

test("la date de la publication du rang est exportée, pour rendre l'anti-fuite auditable", () => {
  // `rang1`/`rang2` viennent de la dernière publication ANTÉRIEURE au match.
  // Sans la date, cette promesse se croit sur parole ; avec, elle se vérifie
  // ligne à ligne.
  assert.ok(MATCH_COLS.includes("rang1_date"));
  assert.ok(MATCH_COLS.includes("rang2_date"));
  assert.equal(MATCH_COLS.indexOf("rang1_date"), MATCH_COLS.indexOf("rang1") + 1);
  assert.equal(MATCH_COLS.indexOf("rang2_date"), MATCH_COLS.indexOf("rang2") + 1);
});

test("les cotes brutes sont toutes conservées : rien n'est perdu, tout est déplacé", () => {
  // Chaque probabilité retirée se recalcule depuis ces prix. Si l'une d'elles
  // disparaissait aussi, la réduction deviendrait une perte d'information.
  for (const c of [
    "cote1_ouverture", "cote1_cloture", "cote2_ouverture", "cote2_cloture",
    "cs_2_0_ouverture", "cs_2_0_cloture", "cs_2_1_ouverture", "cs_2_1_cloture",
    "cs_1_2_ouverture", "cs_1_2_cloture", "cs_0_2_ouverture", "cs_0_2_cloture",
    "cote_over_ouverture", "cote_over_cloture", "cote_under_ouverture", "cote_under_cloture",
    "total_ligne", "total_lignes",
  ]) {
    assert.ok(ODDS_COLS.includes(c), `${c} manque dans cotes.csv`);
  }
});

test("les issues observées restent disponibles : ce sont les étiquettes", () => {
  assert.ok(ODDS_COLS.includes("vainqueur"));
  assert.ok(ODDS_COLS.includes("manches"));
  assert.ok(ODDS_COLS.includes("points_total"));
  assert.ok(TOTALS_COLS.includes("resultat_over"));
  assert.ok(TOTALS_COLS.includes("points_total"));
});

test("les identités biologiques restent, et elles seules", () => {
  assert.deepEqual(PLAYER_COLS, [
    "player_id", "nom", "prenom", "nom_famille", "slug", "pays",
    "date_naissance", "main", "taille_cm", "source_bio", "photo_url",
  ]);
});

test("nombre de colonnes par fichier", () => {
  assert.equal(MATCH_COLS.length, 26);
  assert.equal(PLAYER_COLS.length, 11);
  assert.equal(ODDS_COLS.length, 27);
  assert.equal(TOTALS_COLS.length, 11);
});

test("aucun doublon de colonne dans un fichier", () => {
  for (const [nom, cols] of Object.entries(TOUS)) {
    assert.equal(new Set(cols).size, cols.length, `${nom} contient un doublon`);
  }
});

test("les motifs interdits sont non vides et documentés", () => {
  assert.ok(MOTIFS_DERIVES.length >= 5);
  for (const m of MOTIFS_DERIVES) assert.ok(m instanceof RegExp);
});

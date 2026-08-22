// Tests du seed d'une paire neuve depuis les notes individuelles de ses joueurs
// (lib/elo.mjs, journal §11).
//   node --test test/pair-seed.test.mjs
//
// Ce que ces tests protègent. Le défaut corrigé était un POINT DE DÉPART faux :
// une paire de double jamais vue et non classée démarrait à seedBottom (1350),
// que ses deux joueurs soient débutants ou champions du monde — d'où une
// sous-estimation mesurée à +19,6 pts sur les paires chinoises/coréennes de 5 à
// 15 matchs. Les garde-fous à ne jamais perdre :
//   - poids 0 doit rendre `null`, donc laisser la production d'avant intacte ;
//   - un joueur sous le seuil de matchs ne doit JAMAIS servir de référence
//     (sinon on amorce du bruit avec du bruit) ;
//   - une paire dont un seul joueur est connu ne doit être déplacée que de
//     moitié — c'est la « confiance » qui empêche un seul joueur d'imposer le
//     niveau du duo ;
//   - le seed doit rester ENTRE base et la note dérivée, jamais au-delà :
//     extrapoler serait inventer de l'information.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pairSeedFromPlayerNotes, PARAMS } from "../lib/elo.mjs";

const P = { pairSeedFromPlayers: 1, pairSeedMinPlayerMatches: 10 };
const joueur = (rating, matches) => ({ rating, matches });
const proche = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

// --- Désactivation -----------------------------------------------------------

test("poids 0 -> null : la production d'avant est inchangée", () => {
  const notes = [joueur(1900, 50), joueur(1900, 50)];
  assert.equal(pairSeedFromPlayerNotes(1350, notes, { ...P, pairSeedFromPlayers: 0 }), null);
});

test("poids négatif ou absent -> null", () => {
  const notes = [joueur(1900, 50)];
  assert.equal(pairSeedFromPlayerNotes(1350, notes, { ...P, pairSeedFromPlayers: -1 }), null);
  assert.equal(pairSeedFromPlayerNotes(1350, notes, { ...P, pairSeedFromPlayers: undefined }), null);
});

// --- Seuil de matchs ---------------------------------------------------------

test("aucun joueur au seuil -> null (on ne remplace pas 1350 par du bruit)", () => {
  const notes = [joueur(1900, 9), joueur(1900, 2)];
  assert.equal(pairSeedFromPlayerNotes(1350, notes, P), null);
});

test("le seuil est inclusif : exactement min matchs, le joueur compte", () => {
  const notes = [joueur(1900, 10), joueur(1900, 10)];
  proche(pairSeedFromPlayerNotes(1350, notes, P), 1900);
});

test("un joueur sous le seuil est ignoré, pas moyenné", () => {
  // Le second joueur (1000) est sous le seuil : il ne doit pas tirer la note
  // vers le bas. Reste donc UN joueur utilisable sur deux -> confiance 1/2.
  const notes = [joueur(1900, 50), joueur(1000, 3)];
  proche(pairSeedFromPlayerNotes(1350, notes, P), 1350 + 0.5 * (1900 - 1350));
});

// --- Confiance ---------------------------------------------------------------

test("deux joueurs connus -> confiance pleine, seed = moyenne des deux", () => {
  const notes = [joueur(1900, 50), joueur(1700, 50)];
  proche(pairSeedFromPlayerNotes(1350, notes, P), 1800);
});

test("un seul joueur connu -> seed déplacé de moitié seulement", () => {
  const notes = [joueur(1900, 50), undefined];
  proche(pairSeedFromPlayerNotes(1350, notes, P), 1625);
});

test("poids fractionnaire : le déplacement est proportionnel", () => {
  const notes = [joueur(1900, 50), joueur(1900, 50)];
  const p = { ...P, pairSeedFromPlayers: 0.5 };
  proche(pairSeedFromPlayerNotes(1350, notes, p), 1350 + 0.5 * (1900 - 1350));
});

// --- Bornes et robustesse ----------------------------------------------------

test("le seed reste entre base et la note dérivée (jamais d'extrapolation)", () => {
  for (const base of [1200, 1350, 1500, 1800]) {
    for (const r of [1100, 1400, 1900, 2100]) {
      const v = pairSeedFromPlayerNotes(base, [joueur(r, 50), joueur(r, 50)], P);
      const lo = Math.min(base, r), hi = Math.max(base, r);
      assert.ok(v >= lo - 1e-9 && v <= hi + 1e-9, `${v} hors [${lo} ; ${hi}]`);
    }
  }
});

test("des joueurs plus FAIBLES que la base tirent le seed vers le bas", () => {
  // Symétrie indispensable : le correctif ne doit pas être un bonus déguisé
  // réservé aux forts. Une paire neuve de deux joueurs à 1200 doit partir SOUS
  // le seed par défaut.
  const v = pairSeedFromPlayerNotes(1350, [joueur(1200, 50), joueur(1200, 50)], P);
  proche(v, 1200);
  assert.ok(v < 1350);
});

test("notes absentes, vides ou mal formées -> null", () => {
  assert.equal(pairSeedFromPlayerNotes(1350, null, P), null);
  assert.equal(pairSeedFromPlayerNotes(1350, [], P), null);
  assert.equal(pairSeedFromPlayerNotes(1350, [undefined, undefined], P), null);
  assert.equal(pairSeedFromPlayerNotes(1350, [{ rating: NaN, matches: 50 }], P), null);
  assert.equal(pairSeedFromPlayerNotes(1350, [{ matches: 50 }], P), null);
});

// --- Config de production ----------------------------------------------------

test("la config de production est bien celle mesurée (poids 1, min 10)", () => {
  // Si ces valeurs changent, c'est une décision de modèle : elle doit passer par
  // measures/variante-seed-paires.mjs et le journal, pas par un ajustement
  // silencieux.
  assert.equal(PARAMS.pairSeedFromPlayers, 1);
  assert.equal(PARAMS.pairSeedMinPlayerMatches, 10);
});

test("avec la config de production, une paire d'élite ne part plus de 1350", () => {
  const notes = [joueur(1900, 60), joueur(1880, 45)];
  const v = pairSeedFromPlayerNotes(PARAMS.seedBottom, notes, PARAMS);
  assert.ok(v > 1800, `attendu > 1800, obtenu ${v}`);
});

// lib/seeds.mjs
// Amorçage de l'Elo : rang mondial de départ de chaque entité (joueur ou
// paire), converti ensuite en Elo initial par `seedEloByRank` (lib/elo.mjs).
//
// Sans amorçage, le n°1 mondial et le 200e démarreraient au même score et les
// premiers mois de données ne serviraient qu'à rattraper ce qu'on savait déjà.
//
// SOURCE : la publication la PLUS ANCIENNE de data/rankings/, c'est-à-dire le
// classement mondial tel qu'il était à l'ouverture de la fenêtre de données.
// Ce répertoire portait autrefois cinq CSV « Top60 » recopiés à la main dans
// data/seeds/, à trois dates différentes (2021-12-14, 2021-12-21, 2022-01-04) ;
// l'import des saisons 2022-2023 les a rendus redondants — et le double dames,
// figé trois semaines trop tôt, était le seul à diverger du classement réel.
// Un point d'entrée manuel de moins, et une date homogène sur les cinq
// disciplines.
//
// La conversion est isolée dans `initialRanksFromPublication`, pure et testée
// (test/seeds.test.mjs) : la clé d'entité doit être au caractère près celle de
// l'Elo, sinon l'amorçage ne s'applique à personne, silencieusement.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RANKINGS_DIR = join(ROOT, "data", "rankings");

/** Nom de fichier d'une publication hebdomadaire (les autres sont des index). */
const PUB_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Clé d'entité : identifiants TRIÉS, même convention que lib/elo.mjs et
 * `entityKeyOf` de lib/rank-history.mjs. Dupliquée ici à dessein — importer
 * rank-history depuis seeds créerait un cycle avec build-data, et un test
 * croise les deux implémentations pour interdire toute divergence.
 */
function entityKey(players) {
  const ids = (players ?? []).map((p) => String(p.id)).sort();
  if (ids.length === 0) return null;
  return ids.length === 1 ? `p:${ids[0]}` : `pair:${ids.join("-")}`;
}

/**
 * Rangs de départ tirés d'une publication.
 *
 * Ne filtre RIEN sur le rang : le plafonnement à `seedTopN` appartient à
 * `seedEloByRank`. Sans quoi remonter `seedTopN` obligerait à retoucher ce
 * module aussi.
 *
 * @param {{disciplines?: Object<string, object[]>}|null} publication
 * @returns {Object<string, Map<string, number>>} discipline -> clé -> rang
 */
export function initialRanksFromPublication(publication) {
  const out = {};
  for (const [disc, rows] of Object.entries(publication?.disciplines ?? {})) {
    const m = new Map();
    for (const row of rows ?? []) {
      const key = entityKey(row.players);
      if (key === null) continue; // ligne sans joueur : rien à amorcer
      m.set(key, row.rank);
    }
    out[disc] = m;
  }
  return out;
}

/**
 * Charge l'amorçage depuis la publication la plus ancienne du store.
 *
 * Synchrone et sans argument : signature conservée telle quelle, elle est
 * appelée depuis build-data.mjs, backtest.mjs et les scripts de measures/.
 * Store absent ou vide -> `{}`, et `computeElo` retombe alors sur
 * `PARAMS.initial` pour tout le monde (cf. lib/elo.mjs, `hasSeeds`).
 *
 * @param {string} [dir] répertoire des publications (surchargeable pour test)
 */
export function loadInitialRanks(dir = RANKINGS_DIR) {
  if (!existsSync(dir)) return {};
  const premiere = readdirSync(dir).filter((n) => PUB_FILE.test(n)).sort()[0];
  if (!premiere) return {};
  return initialRanksFromPublication(JSON.parse(readFileSync(join(dir, premiere), "utf8")));
}

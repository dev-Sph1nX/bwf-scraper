#!/usr/bin/env node
// merge-hands.mjs — fusionne hands-progress.json (collecte BWF) dans
// data/players/birthdates.json et produit birthdates-enrichi.json (+ stats).
//
// Politique :
//   - hand : ne jamais écraser une main déjà connue (Wikidata) SAUF si la fiche
//     BWF la contredit — la fiche BWF fait alors foi ; contradictions listées.
//   - height : ajouté partout où la fiche BWF le donne (null sinon).
//   - joueurs absents de birthdates.json : ajoutés seulement s'ils apportent
//     au moins une info (hand ou height). dob/source/confidence restent null
//     (ces champs décrivent la date de naissance, pas la main).
//
// Usage : node merge-hands.mjs   (chemins en dur ci-dessous)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIRTHDATES = "/Users/lucasleperlier/Documents/bwf-scraper/data/players/birthdates.json";
// players.json vit à côté du script (produit par extract-players.mjs — les
// anciens chemins /tmp disparaissaient entre sessions).
const PLAYERS = join(HERE, "players.json");
const PROGRESS = join(HERE, "hands-progress.json");
const OUT = join(HERE, "birthdates-enrichi.json");

const birthdates = JSON.parse(readFileSync(BIRTHDATES, "utf8"));
const players = JSON.parse(readFileSync(PLAYERS, "utf8"));
const progress = JSON.parse(readFileSync(PROGRESS, "utf8"));
const byId = new Map(players.map((p) => [p.id, p]));

const out = {};
const contradictions = [];
let handAdded = 0, heightAdded = 0, newPlayers = 0, handConfirmed = 0;

// 1. Tous les joueurs existants, enrichis.
for (const [id, entry] of Object.entries(birthdates)) {
  const e = { ...entry };
  const scraped = progress[id];
  const got = scraped && !scraped.error ? scraped : null;
  if (got) {
    if (e.hand && got.hand && e.hand !== got.hand) {
      contradictions.push({ id, name: e.name, wikidata: e.hand, bwf: got.hand });
      e.hand = got.hand; // la fiche BWF fait foi
    } else if (e.hand && got.hand && e.hand === got.hand) {
      handConfirmed++;
    } else if (!e.hand && got.hand) {
      e.hand = got.hand;
      handAdded++;
    }
    e.height = got.height ?? e.height ?? null;
    if (got.height != null) heightAdded++;
  } else if (!("height" in e)) {
    e.height = null;
  }
  out[id] = e;
}

// 2. Joueurs nouveaux (hors birthdates) avec au moins une info.
for (const [id, got] of Object.entries(progress)) {
  if (id in out || got.error) continue;
  if (got.hand == null && got.height == null) continue;
  const p = byId.get(id);
  out[id] = {
    name: got.name ?? p?.nameDisplay ?? null,
    country: p?.countryCode ?? null,
    dob: null,
    hand: got.hand ?? null,
    source: null,
    confidence: null,
    height: got.height ?? null,
  };
  newPlayers++;
  if (got.hand) handAdded++;
  if (got.height != null) heightAdded++;
}

writeFileSync(OUT, JSON.stringify(out, null, 1));

// 3. Stats de couverture (globale + pondérée par matchs joués).
const matchesOf = (id) => byId.get(id)?.matches ?? 0;
const totalMatches = players.reduce((s, p) => s + p.matches, 0);
function coverage(obj, field) {
  const ids = Object.keys(obj);
  const withF = ids.filter((id) => obj[id][field] != null);
  const wAll = players.length ? totalMatches : 0;
  const w = withF.reduce((s, id) => s + matchesOf(id), 0);
  return {
    n: withF.length,
    total: players.length, // référentiel : tous les joueurs vus en match
    pct: ((100 * withF.length) / players.length).toFixed(1),
    wPct: ((100 * w) / wAll).toFixed(1),
  };
}
const before = coverage(birthdates, "hand");
const after = coverage(out, "hand");
const height = coverage(out, "height");
console.log(JSON.stringify({
  before, after, height,
  handAdded, heightAdded, newPlayers, handConfirmed,
  contradictions,
  errors: Object.values(progress).filter((v) => v.error).length,
  scraped: Object.keys(progress).length,
}, null, 2));

// Tests de l'index des publications de classement BWF.
//   node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  INDEX_URL, ANCHORS, normalizeIndex, validateIndex, fetchPublicationIndex,
} from "../lib/publications.mjs";

const brut = JSON.parse(fs.readFileSync(new URL("./fixtures/rankingweek-2026-07-30.json", import.meta.url)));

const clientAvec = (rows) => {
  const urls = [];
  return { urls, async getJson(url) { urls.push(url); return rows; } };
};

// --- Ancres ---------------------------------------------------------------

test("les 7 ancres sont des mardis", () => {
  for (const a of ANCHORS) {
    assert.equal(new Date(a.date + "T00:00:00Z").getUTCDay(), 2, `${a.date} (id ${a.publicationId})`);
  }
});

// --- Normalisation --------------------------------------------------------

test("normalizeIndex tronque la date au jour", () => {
  const p = normalizeIndex([{ id: 4402, year: 2026, week: 31, date: "2026-07-28 00:00:00" }]);
  assert.deepEqual(p, [{ publicationId: 4402, date: "2026-07-28", week: 31, year: 2026 }]);
});

test("normalizeIndex trie par date croissante", () => {
  const p = normalizeIndex([
    { id: 4402, year: 2026, week: 31, date: "2026-07-28 00:00:00" },
    { id: 3821, year: 2025, week: 24, date: "2025-06-10 00:00:00" },
    { id: 4394, year: 2026, week: 30, date: "2026-07-21 00:00:00" },
  ]);
  assert.deepEqual(p.map((x) => x.date), ["2025-06-10", "2026-07-21", "2026-07-28"]);
});

test("normalizeIndex ne recalcule jamais la date depuis year/week", () => {
  // Une entrée volontairement incohérente : la date doit être servie telle quelle.
  const p = normalizeIndex([{ id: 1, year: 1999, week: 1, date: "2025-06-10 00:00:00" }]);
  assert.equal(p[0].date, "2025-06-10");
  assert.equal(p[0].year, 1999, "year est recopié, pas déduit");
});

test("normalizeIndex convertit les identifiants en nombres", () => {
  const p = normalizeIndex([{ id: "4402", year: "2026", week: "31", date: "2026-07-28 00:00:00" }]);
  assert.equal(p[0].publicationId, 4402);
  assert.equal(p[0].week, 31);
  assert.equal(p[0].year, 2026);
});

test("normalizeIndex sur la fixture réelle rend 60 entrées de 2025-06-10 à 2026-07-28", () => {
  const p = normalizeIndex(brut);
  assert.equal(p.length, 60);
  assert.equal(p[0].publicationId, 3821);
  assert.equal(p[0].date, "2025-06-10");
  assert.equal(p[59].publicationId, 4402);
  assert.equal(p[59].date, "2026-07-28");
});

// --- Garde-fous -----------------------------------------------------------

test("validateIndex accepte la fixture réelle", () => {
  assert.doesNotThrow(() => validateIndex(normalizeIndex(brut)));
});

test("validateIndex rejette une liste vide", () => {
  assert.throws(() => validateIndex([]), /vide/i);
});

test("validateIndex rejette une entrée sans identifiant ou sans date", () => {
  assert.throws(() => validateIndex([{ publicationId: null, date: "2025-06-10", week: 24, year: 2025 }]), /champ/i);
  assert.throws(() => validateIndex([{ publicationId: 1, date: null, week: 24, year: 2025 }]), /champ/i);
});

test("validateIndex rejette une date qui n'est pas un mardi", () => {
  const p = normalizeIndex(brut);
  p[10] = { ...p[10], date: "2025-08-21" }; // un jeudi
  assert.throws(() => validateIndex(p), /mardi/i);
});

test("validateIndex rejette un doublon de date", () => {
  const p = normalizeIndex(brut);
  p[10] = { ...p[10], date: p[11].date };
  assert.throws(() => validateIndex(p), /doublon|trou/i);
});

test("validateIndex rejette un trou dans la suite hebdomadaire", () => {
  const p = normalizeIndex(brut).filter((_, i) => i !== 30);
  assert.throws(() => validateIndex(p), /trou/i);
});

test("validateIndex accepte une suite hebdomadaire contiguë passée dans le désordre", () => {
  // validateIndex est exportée et appelable seule (le futur mergeIndex de la
  // tâche 2 pourra lui passer un tableau non trié) : le calcul de continuité
  // ne doit pas supposer que dates[0]/dates[dates.length-1] sont les bornes.
  const p = [
    { publicationId: 2, date: "2025-06-17", week: 25, year: 2025 },
    { publicationId: 1, date: "2025-06-10", week: 24, year: 2025 },
    { publicationId: 3, date: "2025-06-24", week: 26, year: 2025 },
  ];
  assert.doesNotThrow(() => validateIndex(p));
});

test("validateIndex rejette une ancre présente avec une mauvaise date", () => {
  const p = normalizeIndex(brut).map((x) =>
    x.publicationId === 3835 ? { ...x, date: "2025-07-08" } : x);
  assert.throws(() => validateIndex(p), /ancre/i);
});

test("validateIndex tolère une ancre ABSENTE (sortie de la fenêtre glissante)", () => {
  // On simule la fenêtre qui a glissé : les 4 premières semaines ont disparu.
  const p = normalizeIndex(brut).slice(4);
  assert.doesNotThrow(() => validateIndex(p), "une ancre hors fenêtre n'est pas une erreur");
});

test("validateIndex liste TOUS les désaccords, pas seulement le premier", () => {
  const p = normalizeIndex(brut).map((x) =>
    x.publicationId === 3835 ? { ...x, date: "2025-07-08" } : x);
  try {
    validateIndex(p);
    assert.fail("aurait dû lever");
  } catch (e) {
    // la date faussée crée un doublon (première/dernière date inchangées, donc
    // la suite hebdomadaire reste satisfaite) et casse l'ancre : deux désaccords
    assert.match(e.message, /ancre/i);
    assert.ok(e.message.split("\n").length > 2, "plusieurs désaccords listés");
  }
});

// --- Récupération ---------------------------------------------------------

test("fetchPublicationIndex appelle le bon endpoint et valide", async () => {
  const client = clientAvec(brut);
  const index = await fetchPublicationIndex(client);
  assert.equal(client.urls.length, 1, "une seule requête");
  assert.equal(client.urls[0], INDEX_URL);
  assert.match(INDEX_URL, /vue-rankingweek\?rankId=2/);
  assert.equal(index.source, "vue-rankingweek");
  assert.ok(index.fetchedAt);
  assert.equal(index.publications.length, 60);
});

test("fetchPublicationIndex propage l'échec d'un garde-fou", async () => {
  const client = clientAvec([{ id: 1, year: 2025, week: 1, date: "2025-06-12 00:00:00" }]); // jeudi
  await assert.rejects(() => fetchPublicationIndex(client), /mardi/i);
});

test("fetchPublicationIndex accepte une réponse enveloppée dans results", async () => {
  const client = clientAvec({ results: brut });
  const index = await fetchPublicationIndex(client);
  assert.equal(index.publications.length, 60);
});

// --- Fusion et persistance -------------------------------------------------

import { mergeIndex, loadIndex, saveIndex } from "../lib/publications.mjs";
import os from "node:os";
import path from "node:path";

const P = (publicationId, date, week = 1, year = 2025) => ({ publicationId, date, week, year });

test("mergeIndex conserve les entrées locales sorties de la fenêtre de l'API", () => {
  const local = [P(3821, "2025-06-10"), P(3828, "2025-06-17"), P(3835, "2025-06-24")];
  const remote = [P(3828, "2025-06-17"), P(3835, "2025-06-24"), P(3842, "2025-07-01")];
  const m = mergeIndex(local, remote);
  assert.deepEqual(m.map((p) => p.publicationId), [3821, 3828, 3835, 3842]);
});

test("mergeIndex ajoute les nouvelles publications de l'API", () => {
  const m = mergeIndex([P(3821, "2025-06-10")], [P(3821, "2025-06-10"), P(3828, "2025-06-17")]);
  assert.equal(m.length, 2);
  assert.equal(m[1].publicationId, 3828);
});

test("mergeIndex ne crée pas de doublon quand les deux listes coïncident", () => {
  const l = [P(3821, "2025-06-10"), P(3828, "2025-06-17")];
  assert.equal(mergeIndex(l, l).length, 2);
});

test("mergeIndex trie le résultat par date croissante", () => {
  const m = mergeIndex([P(4402, "2026-07-28")], [P(3821, "2025-06-10")]);
  assert.deepEqual(m.map((p) => p.date), ["2025-06-10", "2026-07-28"]);
});

test("mergeIndex lève si un même id porte deux dates différentes", () => {
  assert.throws(
    () => mergeIndex([P(3821, "2025-06-10")], [P(3821, "2025-06-17")]),
    /3821/,
  );
});

test("mergeIndex fonctionne avec un index local vide", () => {
  const remote = [P(3821, "2025-06-10")];
  assert.deepEqual(mergeIndex([], remote), remote);
  assert.deepEqual(mergeIndex(null, remote), remote);
});

test("loadIndex renvoie null pour un fichier absent", async () => {
  assert.equal(await loadIndex(path.join(os.tmpdir(), "aucun-index-bwf-xyz.json")), null);
});

test("saveIndex puis loadIndex rendent le même index", async () => {
  const f = path.join(os.tmpdir(), `index-bwf-test-${process.pid}.json`);
  const index = { source: "vue-rankingweek", fetchedAt: "2026-07-30T00:00:00.000Z",
                  publications: [P(3821, "2025-06-10", 24, 2025)] };
  await saveIndex(f, index);
  const relu = await loadIndex(f);
  assert.deepEqual(relu, index);
  fs.unlinkSync(f);
});

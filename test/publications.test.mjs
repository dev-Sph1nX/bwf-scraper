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

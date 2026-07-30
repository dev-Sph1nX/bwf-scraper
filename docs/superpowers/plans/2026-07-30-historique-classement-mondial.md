# Historique du classement mondial BWF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Constituer l'historique hebdomadaire du classement mondial BWF depuis le 2025-06-10, puis superposer son évolution sur le graphe Elo existant.

**Architecture:** Un module de logique pure (`lib/publications.mjs`) découvre les `publicationId` par marche avant et valide le résultat contre 7 ancres connues ; un backfill one-shot télécharge une publication par semaine dans `data/rankings/<date>.json` ; le run hebdomadaire devient idempotent par identifiant BWF ; `build-data.mjs` lit la série et produit une série `worldRank` par joueur ; `EloChart.jsx` trace deux séries sur un axe temps partagé.

**Tech Stack:** Node 22 (ESM), Playwright (via `BwfClient` existant), `node:test` + `node:assert/strict`, React 18 + Vite, SVG à la main.

## Global Constraints

- **Aucune nouvelle dépendance npm.** Le dépôt n'a que `playwright`.
- **Tests :** `node --test test/*.test.mjs`. Idiome du dépôt : `import { test } from "node:test"` + `import assert from "node:assert/strict"`, noms de tests en français, fixtures JSON dans `test/fixtures/`.
- **Aucun accès réseau dans les tests.** Toute fonction testée reçoit son `client` par injection ; les fixtures sont des réponses réelles capturées.
- **Aucune date n'est calculée.** L'index `vue-rankingweek?rankId=2` fournit `date`, `week` et `year` ; on les lit, on ne les dérive jamais. Une conception antérieure déduisait les dates d'une ancre par pas hebdomadaire : les écarts d'id réels vont de **4 à 50**, ce qui l'aurait fait échouer.
- **Les publications BWF tombent toujours un mardi** — vérifié sur les 60 entrées de l'index. C'est un garde-fou, pas une règle de calcul.
- **7 ancres de validation** (id → date), relevées à la main sur le site, indépendamment de l'API : `3821→2025-06-10`, `3828→2025-06-17`, `3835→2025-06-24`, `3842→2025-07-01`, `4387→2026-07-14`, `4394→2026-07-21`, `4402→2026-07-28`. Une ancre **absente** de l'index est normale (fenêtre glissante) ; une ancre présente avec une **autre date** est une erreur bloquante.
- **Fenêtre glissante de 60 semaines.** L'API n'expose que les 60 dernières publications ; ce qui en sort est définitivement perdu. L'index local est donc **fusionné** avec la réponse de l'API, jamais remplacé — et le backfill de la tâche 4 doit être committé sans délai.
- **Profondeur :** top **250** par discipline, 5 disciplines (`MS:6, WS:7, MD:8, WD:9, XD:10` via `catId`, `doubles=true` pour MD/WD/XD).
- **Champs conservés par ligne :** `rank`, `rankPrevious`, `rankChange`, `points` (converti en nombre), `tournaments`, `players[]`.
- **CSS :** couleurs uniquement via variables de `web/src/styles.css` (`--accent`, `--accent-2`, `--muted`, `--line`, `--surface`). Jamais de couleur en dur.
- **Responsive :** vérifier à ~375px, aucun débordement horizontal de page, SVG en `viewBox` + `width:100%`.
- **Règle projet :** invoquer le skill `ui-ux-pro-max-skill` avant la tâche 8 (seule tâche qui touche l'UI).
- **`data/` est versionné** (nécessaire à l'incrémental) ; `web/public/data/` est ignoré et régénéré. Vérifié : `data/rankings/` n'est pas couvert par `.gitignore`.

---

### Task 1 : Index des publications et ses garde-fous

**Files:**
- Create: `lib/publications.mjs`
- Test: `test/publications.test.mjs`
- Fixture: `test/fixtures/rankingweek-2026-07-30.json` (**déjà en place**, 60 entrées, réponse réelle capturée le 2026-07-30)

**Interfaces:**
- Consumes: un client exposant `getJson(url): Promise<any>` (injecté ; en production `BwfClient` de `lib/client.mjs`).
- Produces:
  - `INDEX_URL: string` — `https://extranet-lv.bwfbadminton.com/api/vue-rankingweek?rankId=2`
  - `ANCHORS: Array<{publicationId:number, date:string}>` — les 7 couples relevés à la main
  - `normalizeIndex(rows: Array<object>): Array<{publicationId:number, date:string, week:number, year:number}>` — trié par date croissante
  - `validateIndex(publications): typeof publications` — lève une `Error` listant **tous** les désaccords
  - `fetchPublicationIndex(client): Promise<{source:string, fetchedAt:string, publications:Array}>`

**Contexte.** L'API `vue-rankingweek?rankId=2` renvoie en **une requête** la liste
des publications avec leurs dates. Aucune date ne doit être calculée : toute
datation dérivée est interdite dans ce module. Forme d'une entrée renvoyée par
l'API :

```json
{ "id": 4402, "year": 2026, "week": 31,
  "date": "2026-07-28 00:00:00",
  "key": "2026-31-4402",
  "display": "Week 31 (2026-07-28)" }
```

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/publications.test.mjs` :

```js
// Tests de l'index des publications de classement BWF.
//   node --test test/
//
// La fixture est la réponse RÉELLE de vue-rankingweek?rankId=2 capturée le
// 2026-07-30 (60 entrées). Le client est simulé : aucune requête réseau.

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
    // la date faussée casse à la fois la suite hebdomadaire et l'ancre
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test test/publications.test.mjs`
Expected: FAIL — `Cannot find module '../lib/publications.mjs'`

- [ ] **Step 3 : Écrire l'implémentation**

Créer `lib/publications.mjs` :

```js
// lib/publications.mjs
// Index des publications hebdomadaires du classement mondial BWF.
//
// L'endpoint vue-rankingweek renvoie en UNE requête la liste des publications
// avec leur id, leur date, leur semaine et leur année :
//
//   GET /api/vue-rankingweek?rankId=2
//   [ { "id": 4402, "year": 2026, "week": 31, "date": "2026-07-28 00:00:00",
//       "key": "2026-31-4402", "display": "Week 31 (2026-07-28)" }, … ]
//
// RÈGLE ABSOLUE : aucune date n'est calculée ici, seulement lue. Une conception
// antérieure déduisait les dates d'une ancre par arithmétique hebdomadaire ; la
// mesure a montré que les écarts d'id réels vont de 4 à 50, ce qui aurait fait
// échouer toute déduction fondée sur un pas régulier.
//
// L'API n'expose que 60 semaines GLISSANTES : une publication qui en sort n'est
// plus récupérable. L'index local doit donc être fusionné avec la réponse de
// l'API, jamais remplacé par elle (cf. mergeIndex, tâche 2).

const BASE = "https://extranet-lv.bwfbadminton.com/api";

/** Endpoint de l'index des publications du classement mondial (rankId=2). */
export const INDEX_URL = `${BASE}/vue-rankingweek?rankId=2`;

/**
 * Couples (id, date) relevés à la main sur le site BWF, indépendamment de l'API.
 * Servent de contrôle croisé : si l'API renvoyait un jour d'autres dates pour ces
 * ids, c'est que quelque chose a changé et il faut s'arrêter.
 */
export const ANCHORS = [
  { publicationId: 3821, date: "2025-06-10" },
  { publicationId: 3828, date: "2025-06-17" },
  { publicationId: 3835, date: "2025-06-24" },
  { publicationId: 3842, date: "2025-07-01" },
  { publicationId: 4387, date: "2026-07-14" },
  { publicationId: 4394, date: "2026-07-21" },
  { publicationId: 4402, date: "2026-07-28" },
];

const DAY_MS = 86_400_000;
const isTuesday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 2;

/** Normalise la réponse de l'API : date tronquée au jour, tri par date croissante. */
export function normalizeIndex(rows) {
  return (rows || [])
    .map((r) => ({
      publicationId: Number(r.id),
      date: String(r.date ?? "").slice(0, 10) || null,
      week: Number(r.week),
      year: Number(r.year),
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Valide un index. Lève en listant TOUS les désaccords : écrire de mauvaises
 * dates rendrait l'historique silencieusement mensonger.
 */
export function validateIndex(publications) {
  const errors = [];

  if (!Array.isArray(publications) || publications.length === 0) {
    throw new Error("Index de publications invalide :\n  - la liste est vide");
  }

  for (const p of publications) {
    if (!Number.isFinite(p.publicationId) || !p.date || !Number.isFinite(p.week)) {
      errors.push(`champ manquant ou invalide : ${JSON.stringify(p)}`);
    }
  }

  for (const p of publications) {
    if (p.date && !isTuesday(p.date)) {
      errors.push(`la date ${p.date} (id ${p.publicationId}) n'est pas un mardi`);
    }
  }

  const dates = publications.map((p) => p.date);
  const uniques = new Set(dates);
  if (uniques.size !== dates.length) {
    errors.push(`${dates.length - uniques.size} date(s) en doublon`);
  }

  // Suite hebdomadaire sans trou : (dernière − première) / 7 + 1 == effectif
  const premiere = dates[0];
  const derniere = dates[dates.length - 1];
  if (premiere && derniere) {
    const jours = (new Date(`${derniere}T00:00:00Z`) - new Date(`${premiere}T00:00:00Z`)) / DAY_MS;
    const attendu = jours / 7 + 1;
    if (!Number.isInteger(attendu) || attendu !== publications.length) {
      errors.push(
        `trou dans la suite hebdomadaire : ${publications.length} publications de ` +
        `${premiere} à ${derniere}, ${attendu} attendue(s)`,
      );
    }
  }

  // Ancres : une ancre ABSENTE est normale (fenêtre glissante) ; une ancre
  // présente avec une AUTRE date est une erreur.
  const parId = new Map(publications.map((p) => [p.publicationId, p.date]));
  for (const a of ANCHORS) {
    const trouve = parId.get(a.publicationId);
    if (trouve !== undefined && trouve !== a.date) {
      errors.push(`ancre ${a.publicationId} : l'API donne ${trouve}, attendu ${a.date}`);
    }
  }

  if (errors.length) {
    throw new Error(`Index de publications invalide :\n  - ${errors.join("\n  - ")}`);
  }
  return publications;
}

/** Récupère et valide l'index. Une seule requête. */
export async function fetchPublicationIndex(client) {
  const json = await client.getJson(INDEX_URL);
  const rows = Array.isArray(json) ? json : (json?.results ?? json?.data ?? []);
  const publications = validateIndex(normalizeIndex(rows));
  return {
    source: "vue-rankingweek",
    fetchedAt: new Date().toISOString(),
    publications,
  };
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `node --test test/publications.test.mjs`
Expected: PASS — 17 tests

- [ ] **Step 5 : Commit**

```bash
git add lib/publications.mjs test/publications.test.mjs test/fixtures/rankingweek-2026-07-30.json
git commit -m "feat(rankings): index des publications via vue-rankingweek + garde-fous"
```

---

### Task 2 : Fusion et persistance de l'index

**Files:**
- Modify: `lib/publications.mjs` (ajout en fin de fichier)
- Modify: `test/publications.test.mjs` (ajout en fin de fichier)

**Interfaces:**
- Consumes: `normalizeIndex`, `validateIndex` de la tâche 1.
- Produces:
  - `mergeIndex(local: Array, remote: Array): Array` — union par `publicationId`, triée par date ; lève si un id commun porte deux dates différentes
  - `loadIndex(path: string): Promise<{publications:Array}|null>` — `null` si absent
  - `saveIndex(path: string, index: object): Promise<void>` — écrit en JSON indenté

**Pourquoi une fusion et pas un remplacement.** L'API n'expose que 60 semaines
glissantes. Dans un an, `vue-rankingweek` ne contiendra plus 2025-06-10 alors que
`data/rankings/2025-06-10.json` existera toujours. Remplacer l'index par la
réponse de l'API effacerait la trace de ces publications archivées.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à la fin de `test/publications.test.mjs` :

```js
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
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test test/publications.test.mjs`
Expected: FAIL — `mergeIndex is not a function`

- [ ] **Step 3 : Écrire l'implémentation**

Ajouter à la fin de `lib/publications.mjs` :

```js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Fusionne l'index local et celui de l'API.
 *
 * L'API n'expose que 60 semaines glissantes : les entrées présentes seulement en
 * local sont des publications archivées, elles doivent survivre. Un même id qui
 * porterait deux dates différentes signale un changement d'API — on lève.
 */
export function mergeIndex(local, remote) {
  const parId = new Map();
  for (const p of local || []) parId.set(p.publicationId, p);

  for (const p of remote || []) {
    const existant = parId.get(p.publicationId);
    if (existant && existant.date !== p.date) {
      throw new Error(
        `publication ${p.publicationId} : date locale ${existant.date} ≠ date API ${p.date}`,
      );
    }
    parId.set(p.publicationId, p);
  }

  return [...parId.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Charge un index depuis le disque. `null` si le fichier n'existe pas. */
export async function loadIndex(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

/** Écrit un index sur le disque, en JSON indenté (il est versionné, donc lisible). */
export async function saveIndex(path, index) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(index, null, 2), "utf8");
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `node --test test/publications.test.mjs`
Expected: PASS — 25 tests au total

- [ ] **Step 5 : Commit**

```bash
git add lib/publications.mjs test/publications.test.mjs
git commit -m "feat(rankings): fusion et persistance de l'index (fenêtre glissante)"
```

---


### Task 3 : Récupération d'une publication (profondeur 250)

**Files:**
- Modify: `lib/rankings.mjs` (réécriture complète)
- Test: `test/rankings-parse.test.mjs`

**Interfaces:**
- Consumes: `BwfClient` de `lib/client.mjs` (méthode `getJson(url)`).
- Produces:
  - `WR_CAT = { MS:6, WS:7, MD:8, WD:9, XD:10 }`, `DEFAULT_DEPTH = 250`
  - `normRow(apiRow): {rank, rankPrevious, rankChange, points:number, tournaments, players:Array<{id:string, slug, name, country}>}`
  - `fetchTable(client, { catId, doubles, publicationId, depth }): Promise<Array<normRow>>`
  - `fetchPublication(client, { publicationId, depth?, onProgress? }): Promise<{publicationId, rankId:2, depth, fetchedAt, disciplines: Record<string, Array>}>`
  - `probeTotal(client, publicationId): Promise<number>`
  - `currentPublicationId(client): Promise<number|null>`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/rankings-parse.test.mjs` :

```js
// Tests du parsing des réponses vue-rankingtable.
//   node --test test/
//
// Le client est simulé : aucune requête réseau. La forme des réponses vient
// d'un vrai appel à l'API (sondes du 2026-07-30).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normRow, fetchTable, fetchPublication, probeTotal, currentPublicationId,
  WR_CAT, DEFAULT_DEPTH,
} from "../lib/rankings.mjs";

// Ligne simple telle que renvoyée par l'API (champs non utilisés omis).
const ligneSimple = {
  ranking_publication_id: 3821,
  rank: 1, rank_previous: 2, rank_change: 1,
  points: "97179.0000", tournaments: 18,
  player1_id: 64032, player2_id: null,
  player1_model: { slug: "kunlavut-vitidsarn", name_display_bold: "<b>Kunlavut</b> VITIDSARN" },
  p1_country_model: { name: "Thailand" },
};

const ligneDouble = {
  rank: 3, rank_previous: 3, rank_change: 0,
  points: "84210.5000", tournaments: 15,
  player1_id: 111, player2_id: 222,
  player1_model: { slug: "a-un", name_display_bold: "<b>A</b> UN" },
  player2_model: { slug: "b-deux", name_display_bold: "<b>B</b> DEUX" },
  p1_country_model: { name: "Malaysia" },
  p2_country_model: { name: "Malaysia" },
};

/**
 * Faux client. `pages` est une fonction (params) -> réponse API.
 * Enregistre les URLs demandées dans `client.urls`.
 */
const fauxClient = (repondre) => {
  const urls = [];
  return {
    urls,
    async getJson(url) {
      urls.push(url);
      return repondre(new URL(url).searchParams);
    },
  };
};

const reponse = (rows, { total = rows.length, perPage = 250, lastPage = 1 } = {}) => ({
  results: { data: rows, total, per_page: perPage, last_page: lastPage, current_page: 1 },
  drawCount: 1,
});

// --- normRow --------------------------------------------------------------

test("normRow convertit les points en nombre", () => {
  assert.equal(normRow(ligneSimple).points, 97179);
  assert.equal(typeof normRow(ligneSimple).points, "number");
  assert.equal(normRow(ligneDouble).points, 84210.5);
});

test("normRow conserve rankPrevious et rankChange", () => {
  const r = normRow(ligneSimple);
  assert.equal(r.rank, 1);
  assert.equal(r.rankPrevious, 2);
  assert.equal(r.rankChange, 1);
});

test("normRow retire les balises HTML des noms", () => {
  assert.equal(normRow(ligneSimple).players[0].name, "Kunlavut VITIDSARN");
});

test("normRow rend un seul joueur en simple, deux en double", () => {
  assert.equal(normRow(ligneSimple).players.length, 1);
  const d = normRow(ligneDouble);
  assert.equal(d.players.length, 2);
  assert.deepEqual(d.players.map((p) => p.id), ["111", "222"]);
  assert.equal(d.players[1].country, "Malaysia");
});

test("normRow rend les ids en chaîne (espace d'ids partagé avec les draws)", () => {
  assert.equal(normRow(ligneSimple).players[0].id, "64032");
  assert.equal(typeof normRow(ligneSimple).players[0].id, "string");
});

test("normRow tolère l'absence de pays ou de slug", () => {
  const r = normRow({ rank: 9, points: "1.0", player1_id: 7, player1_model: {}, });
  assert.equal(r.players[0].country, null);
  assert.equal(r.players[0].slug, null);
});

// --- fetchTable -----------------------------------------------------------

test("fetchTable demande la profondeur voulue en une requête si l'API l'honore", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ ...ligneSimple, rank: i + 1 }));
  const client = fauxClient(() => reponse(rows, { total: 1898, perPage: 250 }));
  const out = await fetchTable(client, { catId: 6, doubles: false, publicationId: 3821, depth: 250 });
  assert.equal(out.length, 250);
  assert.equal(client.urls.length, 1, "une seule requête suffit");
  assert.match(client.urls[0], /pageKey=250/);
  assert.match(client.urls[0], /publicationId=3821/);
  assert.match(client.urls[0], /catId=6/);
  assert.match(client.urls[0], /doubles=false/);
});

test("fetchTable repagine si l'API plafonne per_page à 100", async () => {
  const client = fauxClient((params) => {
    const page = Number(params.get("page"));
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...ligneSimple, rank: (page - 1) * 100 + i + 1 }));
    return reponse(rows, { total: 1898, perPage: 100, lastPage: 19 });
  });
  const out = await fetchTable(client, { catId: 6, doubles: false, publicationId: 3821, depth: 250 });
  assert.equal(out.length, 250, "tronqué à la profondeur demandée");
  assert.equal(client.urls.length, 3, "3 pages de 100 pour atteindre 250");
  assert.equal(out[0].rank, 1);
  assert.equal(out[249].rank, 250);
});

test("fetchTable s'arrête au total quand la discipline compte moins que la profondeur", async () => {
  const rows = Array.from({ length: 42 }, (_, i) => ({ ...ligneSimple, rank: i + 1 }));
  const client = fauxClient(() => reponse(rows, { total: 42, perPage: 250 }));
  const out = await fetchTable(client, { catId: 10, doubles: true, publicationId: 3821, depth: 250 });
  assert.equal(out.length, 42);
  assert.equal(client.urls.length, 1, "ne doit pas boucler sur une page vide");
});

test("fetchTable renvoie un tableau vide pour une publication inexistante", async () => {
  const client = fauxClient(() => reponse([], { total: 0 }));
  const out = await fetchTable(client, { catId: 6, doubles: false, publicationId: 3849, depth: 250 });
  assert.deepEqual(out, []);
});

test("fetchTable marque doubles=true pour les disciplines de double", async () => {
  const client = fauxClient(() => reponse([ligneDouble], { total: 1 }));
  await fetchTable(client, { catId: 8, doubles: true, publicationId: 3821, depth: 250 });
  assert.match(client.urls[0], /doubles=true/);
});

// --- fetchPublication -----------------------------------------------------

test("fetchPublication récupère les 5 disciplines et rend les métadonnées", async () => {
  const client = fauxClient((params) => {
    const doubles = params.get("doubles") === "true";
    return reponse([doubles ? ligneDouble : ligneSimple], { total: 1 });
  });
  const vues = [];
  const pub = await fetchPublication(client, {
    publicationId: 3821, depth: 250, onProgress: (c, n) => vues.push([c, n]),
  });
  assert.equal(pub.publicationId, 3821);
  assert.equal(pub.rankId, 2);
  assert.equal(pub.depth, 250);
  assert.ok(pub.fetchedAt, "fetchedAt renseigné");
  assert.deepEqual(Object.keys(pub.disciplines), ["MS", "WS", "MD", "WD", "XD"]);
  assert.equal(pub.disciplines.MD[0].players.length, 2, "MD est bien traité en double");
  assert.equal(pub.disciplines.MS[0].players.length, 1);
  assert.equal(vues.length, 5, "onProgress appelé une fois par discipline");
});

test("fetchPublication utilise la profondeur par défaut de 250", async () => {
  assert.equal(DEFAULT_DEPTH, 250);
  const client = fauxClient(() => reponse([ligneSimple], { total: 1 }));
  const pub = await fetchPublication(client, { publicationId: 3821 });
  assert.equal(pub.depth, 250);
});

test("les catId des disciplines sont ceux du classement mondial (rankId=2)", () => {
  assert.deepEqual(WR_CAT, { MS: 6, WS: 7, MD: 8, WD: 9, XD: 10 });
});

// --- Sondes ---------------------------------------------------------------

test("probeTotal ne demande qu'une ligne et renvoie le total", async () => {
  const client = fauxClient(() => reponse([ligneSimple], { total: 1898 }));
  assert.equal(await probeTotal(client, 3821), 1898);
  assert.match(client.urls[0], /pageKey=1/);
});

test("probeTotal renvoie 0 pour une publication vide", async () => {
  const client = fauxClient(() => reponse([], { total: 0 }));
  assert.equal(await probeTotal(client, 3849), 0);
});

test("currentPublicationId lit l'id réel derrière publicationId=0", async () => {
  const client = fauxClient(() => reponse([{ ...ligneSimple, ranking_publication_id: 4402 }], { total: 2117 }));
  assert.equal(await currentPublicationId(client), 4402);
  assert.match(client.urls[0], /publicationId=0/);
});

test("currentPublicationId renvoie null si la réponse est vide", async () => {
  const client = fauxClient(() => reponse([], { total: 0 }));
  assert.equal(await currentPublicationId(client), null);
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test test/rankings-parse.test.mjs`
Expected: FAIL — `normRow is not exported` / `fetchTable is not a function`

- [ ] **Step 3 : Écrire l'implémentation**

Remplacer intégralement `lib/rankings.mjs` :

```js
// lib/rankings.mjs
// Récupère une PUBLICATION du classement mondial officiel BWF (World Rankings).
//
// Endpoint : GET /api/vue-rankingtable
//   rankId=2        -> World Rankings (classement officiel, à comparer à l'Elo)
//   catId           -> discipline (mapping propre à rankId=2, cf. WR_CAT)
//   doubles         -> false pour MS/WS, true pour MD/WD/XD
//   publicationId   -> 0 = dernière publiée ; sinon une semaine précise
//
// La réponse ne contient AUCUNE date : le seul repère temporel est
// `ranking_publication_id`. La datation est faite par lib/publications.mjs.
//
// Les ids joueurs (player1_id/player2_id) sont dans le MÊME espace que nos ids
// de draws (donc que les clés Elo), ce qui permet un matching direct.

const BASE = "https://extranet-lv.bwfbadminton.com/api";

/** Discipline -> catId, pour rankId=2. */
export const WR_CAT = { MS: 6, WS: 7, MD: 8, WD: 9, XD: 10 };
const DOUBLES = new Set(["MD", "WD", "XD"]);

/** Profondeur retenue par discipline : couvre tous les joueurs du World Tour. */
export const DEFAULT_DEPTH = 250;

const MAX_PAGES = 30; // garde-fou anti-boucle

const stripTags = (s) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function url(params) {
  return `${BASE}/vue-rankingtable?${new URLSearchParams(params)}`;
}

function baseParams({ catId, doubles, publicationId, pageKey, page }) {
  return {
    rankId: "2",
    catId: String(catId),
    publicationId: String(publicationId),
    doubles: String(doubles),
    searchKey: "",
    pageKey: String(pageKey),
    page: String(page),
    drawCount: "1",
  };
}

const unwrap = (json) => json?.results ?? json?.data?.results ?? json ?? {};

/** Normalise une ligne d'API vers notre forme compacte. */
export function normRow(r) {
  const players = [];
  if (r.player1_id) players.push({
    id: String(r.player1_id),
    slug: r.player1_model?.slug ?? null,
    name: stripTags(r.player1_model?.name_display_bold) || null,
    country: r.p1_country_model?.name ?? null,
  });
  if (r.player2_id) players.push({
    id: String(r.player2_id),
    slug: r.player2_model?.slug ?? null,
    name: stripTags(r.player2_model?.name_display_bold) || null,
    country: r.p2_country_model?.name ?? null,
  });
  return {
    rank: r.rank,
    rankPrevious: r.rank_previous ?? null,
    rankChange: r.rank_change ?? null,
    points: Number(r.points),
    tournaments: r.tournaments ?? null,
    players,
  };
}

/**
 * Récupère le top `depth` d'une discipline pour une publication.
 *
 * On demande `pageKey=depth` : si l'API l'honore, une seule requête suffit ; si
 * elle plafonne `per_page` (100 observé), la boucle repagine automatiquement.
 */
export async function fetchTable(client, { catId, doubles, publicationId, depth = DEFAULT_DEPTH }) {
  const out = [];
  let page = 1;
  let total = null;
  let lastPage = 1;

  do {
    const json = await client.getJson(url(baseParams({ catId, doubles, publicationId, pageKey: depth, page })));
    const res = unwrap(json);
    const rows = res.data ?? [];
    if (total == null) total = res.total ?? rows.length;
    lastPage = Math.min(res.last_page ?? 1, MAX_PAGES);

    if (!rows.length) break;
    for (const r of rows) {
      if (out.length >= depth) break;
      out.push(normRow(r));
    }
    page++;
  } while (out.length < Math.min(depth, total) && page <= lastPage);

  return out;
}

/** Récupère les 5 disciplines d'une publication. */
export async function fetchPublication(client, { publicationId, depth = DEFAULT_DEPTH, onProgress } = {}) {
  const disciplines = {};
  for (const [code, catId] of Object.entries(WR_CAT)) {
    disciplines[code] = await fetchTable(client, {
      catId, doubles: DOUBLES.has(code), publicationId, depth,
    });
    onProgress?.(code, disciplines[code].length);
  }
  return {
    publicationId,
    rankId: 2,
    depth,
    fetchedAt: new Date().toISOString(),
    disciplines,
  };
}

/** Nombre de lignes d'une publication (sonde de découverte, 1 ligne demandée). */
export async function probeTotal(client, publicationId) {
  const json = await client.getJson(url(baseParams({
    catId: WR_CAT.MS, doubles: false, publicationId, pageKey: 1, page: 1,
  })));
  return unwrap(json).total ?? 0;
}

/** Id réel de la publication courante, lu dans les lignes de publicationId=0. */
export async function currentPublicationId(client) {
  const json = await client.getJson(url(baseParams({
    catId: WR_CAT.MS, doubles: false, publicationId: 0, pageKey: 1, page: 1,
  })));
  const rows = unwrap(json).data ?? [];
  return rows[0]?.ranking_publication_id ?? null;
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `node --test test/rankings-parse.test.mjs`
Expected: PASS — 17 tests

- [ ] **Step 5 : Vérifier qu'on n'a rien cassé**

Run: `node --test test/*.test.mjs`
Expected: PASS — l'ancien `fetchWorldRankings` a disparu ; aucun test existant ne l'utilisait.

- [ ] **Step 6 : Commit**

```bash
git add lib/rankings.mjs test/rankings-parse.test.mjs
git commit -m "feat(rankings): fetchPublication avec profondeur et variations de rang"
```

---

### Task 4 : Backfill one-shot de l'historique

**Files:**
- Create: `backfill-rankings.mjs`
- Modify: `package.json` (ajout d'un script)

**Interfaces:**
- Consumes: `fetchPublicationIndex`, `mergeIndex`, `loadIndex`, `saveIndex` (`lib/publications.mjs`) ; `fetchPublication`, `DEFAULT_DEPTH` (`lib/rankings.mjs`) ; `BwfClient` (`lib/client.mjs`).
- Produces: `data/rankings/publications.json` et `data/rankings/<YYYY-MM-DD>.json`.

**Urgence.** La fenêtre de l'API fait 60 semaines glissantes : chaque semaine
d'attente fait perdre définitivement une publication récupérable. Le commit de
l'étape 8 n'est pas optionnel.

- [ ] **Step 1 : Écrire le script**

Créer `backfill-rankings.mjs` :

```js
// backfill-rankings.mjs
// ONE-SHOT : constitue l'historique hebdomadaire du classement mondial BWF sur
// toute la fenêtre exposée par l'API (60 semaines glissantes).
//
//   node backfill-rankings.mjs             # index puis téléchargement des manquants
//   node backfill-rankings.mjs --index     # rafraîchit seulement l'index
//   node backfill-rankings.mjs --force     # réécrit les fichiers déjà présents
//
// Relançable sans perte : une publication déjà téléchargée est sautée, donc une
// interruption réseau se reprend là où elle s'est arrêtée.
//
// ATTENTION : l'API n'expose que 60 semaines. Ce qui n'est pas archivé dans
// data/rankings/ avant d'en sortir est perdu pour toujours. D'où la fusion de
// l'index (jamais un remplacement) et l'obligation de committer le résultat.

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BwfClient } from "./lib/client.mjs";
import { fetchPublicationIndex, mergeIndex, loadIndex, saveIndex } from "./lib/publications.mjs";
import { fetchPublication, DEFAULT_DEPTH } from "./lib/rankings.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, "data", "rankings");
const INDEX_PATH = join(DIR, "publications.json");

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const INDEX_ONLY = args.includes("--index");

const client = await new BwfClient().start();

try {
  // ---- 1) Index : API + fusion avec l'archive locale ----------------------
  console.log("Récupération de l'index des publications (1 requête)…");
  const distant = await fetchPublicationIndex(client);
  console.log(`   ${distant.publications.length} publications côté API : ` +
    `${distant.publications[0].date} → ${distant.publications.at(-1).date}`);

  const local = await loadIndex(INDEX_PATH);
  const fusion = mergeIndex(local?.publications ?? [], distant.publications);
  if (local) {
    const gardees = fusion.length - distant.publications.length;
    console.log(`   index local : ${local.publications.length} entrées` +
      (gardees > 0 ? `, dont ${gardees} archivée(s) hors fenêtre API` : ""));
  }

  const index = { source: distant.source, fetchedAt: distant.fetchedAt, publications: fusion };
  await saveIndex(INDEX_PATH, index);
  console.log(`   ✅ index écrit -> ${INDEX_PATH} (${fusion.length} publications)`);

  if (INDEX_ONLY) {
    console.log("--index : arrêt après l'index.");
    process.exit(0);
  }

  // ---- 2) Téléchargement des publications manquantes ---------------------
  const total = fusion.length;
  let faits = 0, sautes = 0;

  for (const pub of fusion) {
    const path = join(DIR, `${pub.date}.json`);
    if (existsSync(path) && !FORCE) { sautes++; continue; }

    const data = await fetchPublication(client, {
      publicationId: pub.publicationId,
      depth: DEFAULT_DEPTH,
    });
    const lignes = Object.values(data.disciplines).reduce((a, r) => a + r.length, 0);

    await writeFile(path, JSON.stringify({
      publicationId: pub.publicationId,
      date: pub.date,
      week: pub.week,
      year: pub.year,
      rankId: data.rankId,
      depth: data.depth,
      fetchedAt: data.fetchedAt,
      disciplines: data.disciplines,
    }), "utf8");

    faits++;
    console.log(`   ${faits + sautes}/${total} ✓ ${pub.date} (S${pub.week}) id ${pub.publicationId} — ${lignes} lignes`);
  }

  console.log(`\n✅ terminé : ${faits} téléchargées, ${sautes} déjà présentes, ${total} au total.`);
} finally {
  await client.close();
}
```

- [ ] **Step 2 : Ajouter le script npm**

Dans `package.json`, ajouter la ligne `"backfill-rankings"` dans `scripts`, juste après `"fetch-rankings"` :

```json
    "fetch-rankings": "node fetch-rankings.mjs",
    "backfill-rankings": "node backfill-rankings.mjs",
```

- [ ] **Step 3 : Récupérer l'index seul et vérifier les garde-fous**

Run: `node backfill-rankings.mjs --index`
Expected: `60 publications côté API : 2025-06-10 → 2026-07-28`, puis
`✅ index écrit`. Si un garde-fou échoue, le script s'arrête sans rien écrire —
ne pas contourner, réinspecter l'API (méthode : intercepter les requêtes de
`https://bwfbadminton.com/rankings/` avec Playwright).

- [ ] **Step 4 : Vérifier l'index produit**

Run:
```bash
node -e '
const i = require("./data/rankings/publications.json");
console.log("publications :", i.publications.length, "| source :", i.source);
console.log("première :", i.publications[0]);
console.log("dernière :", i.publications.at(-1));
const ancres = { 3821:"2025-06-10", 3828:"2025-06-17", 3835:"2025-06-24", 3842:"2025-07-01",
                 4387:"2026-07-14", 4394:"2026-07-21", 4402:"2026-07-28" };
let ok = 0;
for (const [id, d] of Object.entries(ancres)) {
  const p = i.publications.find(x => x.publicationId === Number(id));
  const bon = p?.date === d;
  if (bon) ok++;
  console.log(`  ancre ${id} -> ${p?.date ?? "ABSENTE"} (attendu ${d})`, bon ? "OK" : "KO");
}
console.log(`${ok}/7 ancres`);
const pasMardi = i.publications.filter(p => new Date(p.date+"T00:00:00Z").getUTCDay() !== 2);
console.log("dates non-mardi :", pasMardi.length);
const dates = i.publications.map(p => p.date);
console.log("doublons :", dates.length - new Set(dates).size);
'
```
Expected: `publications : 60`, **7/7 ancres OK**, `dates non-mardi : 0`, `doublons : 0`.

- [ ] **Step 5 : Lancer le backfill complet**

Run: `node backfill-rankings.mjs`
Expected: **10 à 20 minutes** (300 à 900 requêtes selon que l'API honore
`pageKey=250`), progression `1/60` → `60/60`, puis
`✅ terminé : 60 téléchargées, 0 déjà présentes, 60 au total.`

Si le réseau coupe, relancer : les fichiers déjà écrits sont sautés.

- [ ] **Step 6 : Vérifier les fichiers produits**

Run:
```bash
ls data/rankings/*.json | wc -l          # 61 (60 publications + publications.json)
du -sh data/rankings/                    # attendu ~7 Mo
node -e '
const fs = require("fs");
const f = fs.readdirSync("data/rankings").filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
console.log("fichiers de publication :", f.length);
for (const n of [f[0], f.at(-1)]) {
  const d = JSON.parse(fs.readFileSync("data/rankings/" + n));
  const tailles = Object.entries(d.disciplines).map(([k,v]) => `${k}:${v.length}`).join(" ");
  console.log(n, "id", d.publicationId, "S" + d.week, tailles);
  const r = d.disciplines.MS[0];
  console.log("   MS #1 :", r.players[0].name, "pts", r.points, "prev", r.rankPrevious, "chg", r.rankChange);
}
// aucun fichier ne doit être vide
const vides = f.filter(n => {
  const d = JSON.parse(fs.readFileSync("data/rankings/" + n));
  return Object.values(d.disciplines).some(v => v.length === 0);
});
console.log("fichiers avec une discipline vide :", vides.length, vides.slice(0,3));
'
```
Expected: 60 fichiers ; chaque discipline à 250 lignes (ou son total si inférieur) ;
`points` numérique ; `rankPrevious` et `rankChange` renseignés ; **0 fichier avec
une discipline vide**.

- [ ] **Step 7 : Vérifier que la suite de tests passe toujours**

Run: `node --test test/*.test.mjs`
Expected: PASS

- [ ] **Step 8 : Commit — obligatoire, ne pas différer**

```bash
git add backfill-rankings.mjs package.json data/rankings/
git commit -m "feat(rankings): backfill des 60 publications hebdomadaires (2025-06-10 -> 2026-07-28)"
```

La fenêtre de l'API étant glissante, ce commit est la seule archive de ces
publications. Ne pas passer à la tâche suivante avant qu'il soit fait.

---

### Task 5 : Run hebdomadaire — synchronisation

**Files:**
- Modify: `fetch-rankings.mjs` (réécriture complète)

**Interfaces:**
- Consumes: `fetchPublicationIndex`, `mergeIndex`, `loadIndex`, `saveIndex` (`lib/publications.mjs`) ; `fetchPublication`, `DEFAULT_DEPTH` (`lib/rankings.mjs`) ; `BwfClient` (`lib/client.mjs`).
- Produces: aucun nouvel export. Ajoute les fichiers manquants dans `data/rankings/` et met l'index à jour.

**Changement de nature par rapport à la conception initiale.** Le script ne
« ajoute la publication courante » plus : il **synchronise**. Il télécharge toute
publication de l'index dont le fichier manque. Conséquence directe : si le cron
GitHub Actions ne tourne pas pendant trois semaines, le run suivant rattrape les
trois semaines au lieu de les perdre définitivement.

L'idempotence vient de l'existence du fichier `data/rankings/<date>.json`, donc de
l'identité BWF elle-même — aucun horodatage d'exécution n'intervient.

- [ ] **Step 1 : Réécrire le script**

Remplacer intégralement `fetch-rankings.mjs` :

```js
// fetch-rankings.mjs
// Synchronise l'historique du classement mondial BWF : récupère l'index des
// publications et télécharge celles dont le fichier manque dans data/rankings/.
//
//   node fetch-rankings.mjs            # synchronise (ne fait rien si à jour)
//   node fetch-rankings.mjs --force    # réécrit tous les fichiers de la fenêtre
//
// À lancer quotidiennement : la BWF publie une fois par semaine (le mardi), donc
// le script ne fera rien la plupart du temps. Il n'y a pas de test de fraîcheur
// sur l'heure d'exécution : l'idempotence vient de l'existence du fichier de la
// publication, c'est-à-dire de l'identité BWF elle-même.
//
// Un run manqué se rattrape tout seul : les publications absentes sont reprises
// au run suivant, tant qu'elles sont encore dans la fenêtre de 60 semaines de
// l'API.

import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BwfClient } from "./lib/client.mjs";
import { fetchPublicationIndex, mergeIndex, loadIndex, saveIndex } from "./lib/publications.mjs";
import { fetchPublication, DEFAULT_DEPTH } from "./lib/rankings.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIR = join(ROOT, "data", "rankings");
const INDEX_PATH = join(DIR, "publications.json");

const FORCE = process.argv.slice(2).includes("--force");

const client = await new BwfClient().start();

try {
  const distant = await fetchPublicationIndex(client);
  const local = await loadIndex(INDEX_PATH);
  const fusion = mergeIndex(local?.publications ?? [], distant.publications);

  console.log(
    `Index : ${distant.publications.length} publications côté API, ` +
    `${fusion.length} après fusion avec l'archive locale.`,
  );

  const manquantes = fusion.filter((p) => FORCE || !existsSync(join(DIR, `${p.date}.json`)));

  if (manquantes.length === 0) {
    console.log("⏭  Aucune publication manquante. Rien à faire.");
    await saveIndex(INDEX_PATH, { source: distant.source, fetchedAt: distant.fetchedAt, publications: fusion });
    process.exit(0);
  }

  console.log(`${manquantes.length} publication(s) à télécharger : ${manquantes.map((p) => p.date).join(", ")}`);

  for (const pub of manquantes) {
    const data = await fetchPublication(client, {
      publicationId: pub.publicationId,
      depth: DEFAULT_DEPTH,
      onProgress: (c, n) => console.log(`   ✓ ${c} — ${n} lignes`),
    });
    await writeFile(join(DIR, `${pub.date}.json`), JSON.stringify({
      publicationId: pub.publicationId,
      date: pub.date,
      week: pub.week,
      year: pub.year,
      rankId: data.rankId,
      depth: data.depth,
      fetchedAt: data.fetchedAt,
      disciplines: data.disciplines,
    }), "utf8");
    console.log(`✅ écrit -> data/rankings/${pub.date}.json (S${pub.week}, id ${pub.publicationId})`);
  }

  await saveIndex(INDEX_PATH, { source: distant.source, fetchedAt: distant.fetchedAt, publications: fusion });
  console.log(`✅ index mis à jour : ${fusion.length} publications.`);
} finally {
  await client.close();
}
```

- [ ] **Step 2 : Vérifier l'idempotence sur les données réelles**

Run: `node fetch-rankings.mjs`
Expected: `⏭  Aucune publication manquante. Rien à faire.` puis code de sortie 0.
(Le backfill de la tâche 4 a déjà tout téléchargé.)

- [ ] **Step 3 : Vérifier le rattrapage automatique**

Run:
```bash
mv data/rankings/2026-07-21.json /tmp/pub-test.json
node fetch-rankings.mjs
```
Expected: `1 publication(s) à télécharger : 2026-07-21`, puis le fichier est
retéléchargé. C'est le comportement de rattrapage — la conception précédente
aurait laissé ce trou définitivement.

Puis vérifier que le fichier retéléchargé est équivalent à l'original :
```bash
node -e '
const a = require("/tmp/pub-test.json"), b = require("./data/rankings/2026-07-21.json");
const cle = (d) => Object.entries(d.disciplines).map(([k,v]) => `${k}:${v.length}:${v[0]?.players[0]?.id}`).join("|");
console.log("original    :", cle(a));
console.log("retéléchargé:", cle(b));
console.log(cle(a) === cle(b) ? "✅ identiques" : "❌ divergents");
'
rm /tmp/pub-test.json
```
Expected: `✅ identiques`.

- [ ] **Step 4 : Vérifier que l'index absent ne bloque pas**

Run:
```bash
mv data/rankings/publications.json /tmp/idx-backup.json
node fetch-rankings.mjs
```
Expected: le script reconstruit l'index depuis l'API et signale
`⏭  Aucune publication manquante` (les 60 fichiers sont là). Contrairement à la
conception précédente, l'absence d'index n'est plus une erreur bloquante.

Puis vérifier que l'index reconstruit est équivalent :
```bash
node -e '
const a = require("/tmp/idx-backup.json"), b = require("./data/rankings/publications.json");
console.log("avant :", a.publications.length, "| après :", b.publications.length);
const s = (i) => i.publications.map(p => `${p.publicationId}:${p.date}`).join(",");
console.log(s(a) === s(b) ? "✅ identiques" : "❌ divergents");
'
rm /tmp/idx-backup.json
```
Expected: `✅ identiques`.

- [ ] **Step 5 : Lancer toute la suite de tests**

Run: `node --test test/*.test.mjs`
Expected: PASS

- [ ] **Step 6 : Commit**

```bash
git add fetch-rankings.mjs
git commit -m "feat(rankings): run hebdo en synchronisation, rattrape les runs manques"
```

---


### Task 6 : Série `worldRank` par joueur

**Files:**
- Create: `lib/rank-history.mjs`
- Test: `test/rank-history.test.mjs`

**Interfaces:**
- Consumes: rien (fonctions pures) ; le chargeur utilise `node:fs/promises`.
- Produces:
  - `entityKeyOf(players: Array<{id}>): string` — `p:<id>` en simple, `pair:<id1>-<id2>` (ids triés) en double. **Même convention que `build-data.mjs:64-65`.**
  - `buildWorldMap(publication): Record<string, Map<string, {rank, points}>>`
  - `buildPlayerRankHistory(publications): Record<string, Array<{t, disc, rank, points, key}>>`
  - `loadPublications(dir): Promise<Array<publication>>` — triées par date croissante, `publications.json` exclu.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `test/rank-history.test.mjs` :

```js
// Tests de la construction des séries de classement mondial.
//   node --test test/
//
// Fonctions pures : les publications sont fabriquées à la main.

import { test } from "node:test";
import assert from "node:assert/strict";
import { entityKeyOf, buildWorldMap, buildPlayerRankHistory } from "../lib/rank-history.mjs";

const L = (rank, points, players, extra = {}) => ({
  rank, rankPrevious: rank, rankChange: 0, points, tournaments: 10, players, ...extra,
});
const J = (id, name = `J${id}`) => ({ id: String(id), slug: `j-${id}`, name, country: "France" });

const PUB = (date, disciplines) => ({ publicationId: 1000, date, week: 1, year: 2025, disciplines });

// --- Clés d'entité --------------------------------------------------------

test("entityKeyOf produit p:<id> en simple", () => {
  assert.equal(entityKeyOf([J(64032)]), "p:64032");
});

test("entityKeyOf produit pair:<ids triés> en double, quel que soit l'ordre", () => {
  assert.equal(entityKeyOf([J(222), J(111)]), "pair:111-222");
  assert.equal(entityKeyOf([J(111), J(222)]), "pair:111-222");
});

test("entityKeyOf trie les ids comme des chaînes, comme build-data.mjs", () => {
  // Cohérence indispensable : build-data fait players.map(String).sort()
  assert.equal(entityKeyOf([J(9), J(10)]), "pair:10-9");
});

// --- Carte du classement courant -----------------------------------------

test("buildWorldMap indexe par clé d'entité et par discipline", () => {
  const pub = PUB("2025-06-10", {
    MS: [L(1, 97179, [J(64032)]), L(2, 90000, [J(57945)])],
    MD: [L(1, 84210, [J(111), J(222)])],
  });
  const wm = buildWorldMap(pub);
  assert.equal(wm.MS.get("p:64032").rank, 1);
  assert.equal(wm.MS.get("p:64032").points, 97179);
  assert.equal(wm.MS.get("p:57945").rank, 2);
  assert.equal(wm.MD.get("pair:111-222").rank, 1);
  assert.equal(wm.MS.get("p:999"), undefined);
});

test("buildWorldMap tolère une publication sans disciplines", () => {
  assert.deepEqual(buildWorldMap({ date: "2025-06-10" }), {});
});

// --- Série par joueur ----------------------------------------------------

test("buildPlayerRankHistory produit une entrée par semaine et par discipline", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", { MS: [L(12, 54320, [J(1)])] }),
    PUB("2025-06-17", { MS: [L(11, 55100, [J(1)])] }),
  ]);
  assert.deepEqual(h["1"], [
    { t: "2025-06-10", disc: "MS", rank: 12, points: 54320, key: "p:1" },
    { t: "2025-06-17", disc: "MS", rank: 11, points: 55100, key: "p:1" },
  ]);
});

test("buildPlayerRankHistory rattache les deux joueurs d'une paire", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", { MD: [L(3, 84210, [J(111), J(222)])] }),
  ]);
  assert.equal(h["111"][0].rank, 3);
  assert.equal(h["222"][0].rank, 3);
  assert.equal(h["111"][0].key, "pair:111-222");
  assert.equal(h["111"][0].disc, "MD");
});

test("buildPlayerRankHistory sépare les disciplines d'un même joueur", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", {
      MD: [L(3, 84210, [J(111), J(222)])],
      XD: [L(8, 61000, [J(111), J(333)])],
    }),
  ]);
  const discs = h["111"].map((p) => p.disc).sort();
  assert.deepEqual(discs, ["MD", "XD"]);
  assert.equal(h["111"].find((p) => p.disc === "XD").rank, 8);
});

test("buildPlayerRankHistory garde le meilleur rang si un joueur a deux paires la même semaine", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", {
      MD: [L(3, 84210, [J(111), J(222)]), L(40, 20000, [J(111), J(444)])],
    }),
  ]);
  assert.equal(h["111"].length, 1, "une seule entrée par (semaine, discipline)");
  assert.equal(h["111"][0].rank, 3, "le meilleur rang gagne");
  assert.equal(h["111"][0].key, "pair:111-222");
  assert.equal(h["222"][0].rank, 3);
  assert.equal(h["444"][0].rank, 40, "le partenaire de l'autre paire garde SON rang");
});

test("buildPlayerRankHistory laisse un TROU quand le joueur sort du top", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-10", { MS: [L(240, 9000, [J(1)])] }),
    PUB("2025-06-17", { MS: [] }),                       // sorti du top 250
    PUB("2025-06-24", { MS: [L(238, 9500, [J(1)])] }),
  ]);
  assert.equal(h["1"].length, 2, "aucune entrée inventée pour la semaine manquante");
  assert.deepEqual(h["1"].map((p) => p.t), ["2025-06-10", "2025-06-24"]);
});

test("buildPlayerRankHistory trie chronologiquement", () => {
  const h = buildPlayerRankHistory([
    PUB("2025-06-24", { MS: [L(10, 1, [J(1)])] }),
    PUB("2025-06-10", { MS: [L(12, 1, [J(1)])] }),
    PUB("2025-06-17", { MS: [L(11, 1, [J(1)])] }),
  ]);
  assert.deepEqual(h["1"].map((p) => p.t), ["2025-06-10", "2025-06-17", "2025-06-24"]);
});

test("buildPlayerRankHistory renvoie un objet vide sans publication", () => {
  assert.deepEqual(buildPlayerRankHistory([]), {});
});
```

- [ ] **Step 2 : Lancer les tests pour vérifier qu'ils échouent**

Run: `node --test test/rank-history.test.mjs`
Expected: FAIL — `Cannot find module '../lib/rank-history.mjs'`

- [ ] **Step 3 : Écrire l'implémentation**

Créer `lib/rank-history.mjs` :

```js
// lib/rank-history.mjs
// Construit les séries exploitables à partir des publications hebdomadaires
// stockées dans data/rankings/.
//
// Deux sorties :
//   - buildWorldMap(publication)      -> le classement d'UNE semaine, indexé par
//                                        clé d'entité (remplace l'ancien world.json)
//   - buildPlayerRankHistory(pubs)    -> la série temporelle par JOUEUR
//
// Convention de clé identique à build-data.mjs et lib/elo.mjs :
//   simple : p:<id>            double : pair:<id1>-<id2> (ids triés en chaînes)

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Clé d'entité (joueur seul ou paire), même convention que l'Elo. */
export function entityKeyOf(players) {
  const ids = players.map((p) => String(p.id)).sort();
  return ids.length === 1 ? `p:${ids[0]}` : `pair:${ids.join("-")}`;
}

/** Classement d'une publication, indexé discipline -> Map(clé -> {rank, points}). */
export function buildWorldMap(publication) {
  const out = {};
  for (const [disc, rows] of Object.entries(publication?.disciplines || {})) {
    const m = new Map();
    for (const row of rows) {
      m.set(entityKeyOf(row.players), { rank: row.rank, points: row.points });
    }
    out[disc] = m;
  }
  return out;
}

/**
 * Série temporelle du classement mondial par joueur.
 *
 * Une entrée par (semaine, discipline). Un joueur engagé dans deux paires la
 * même semaine ne garde que son MEILLEUR rang — sinon la courbe aurait deux
 * points au même instant. Aucune entrée n'est inventée pour une semaine où le
 * joueur est absent : le trou est significatif (sortie du top).
 */
export function buildPlayerRankHistory(publications) {
  const out = {};

  for (const pub of publications) {
    for (const [disc, rows] of Object.entries(pub?.disciplines || {})) {
      // meilleur rang de la semaine, par joueur
      const best = new Map(); // playerId -> row
      for (const row of rows) {
        for (const pl of row.players) {
          const id = String(pl.id);
          const prev = best.get(id);
          if (!prev || row.rank < prev.rank) best.set(id, row);
        }
      }
      for (const [id, row] of best) {
        (out[id] ??= []).push({
          t: pub.date,
          disc,
          rank: row.rank,
          points: row.points,
          key: entityKeyOf(row.players),
        });
      }
    }
  }

  for (const id of Object.keys(out)) {
    out[id].sort((a, b) => a.t.localeCompare(b.t) || a.disc.localeCompare(b.disc));
  }
  return out;
}

/** Charge toutes les publications d'un répertoire, triées par date croissante. */
export async function loadPublications(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const out = [];
  for (const n of files) {
    out.push(JSON.parse(await readFile(join(dir, n), "utf8")));
  }
  return out;
}
```

- [ ] **Step 4 : Lancer les tests pour vérifier qu'ils passent**

Run: `node --test test/rank-history.test.mjs`
Expected: PASS — 12 tests

- [ ] **Step 5 : Vérifier sur les vraies données**

Run:
```bash
node -e '
const { loadPublications, buildPlayerRankHistory, buildWorldMap } = await import("./lib/rank-history.mjs");
const pubs = await loadPublications("data/rankings");
console.log("publications chargées :", pubs.length, "de", pubs[0].date, "à", pubs.at(-1).date);
const h = buildPlayerRankHistory(pubs);
console.log("joueurs avec historique :", Object.keys(h).length);
const wm = buildWorldMap(pubs.at(-1));
console.log("MS dans la dernière publication :", wm.MS.size);
const long = Object.entries(h).sort((a,b) => b[1].length - a[1].length)[0];
console.log("série la plus longue :", long[0], long[1].length, "points");
console.log("  premier :", long[1][0]);
console.log("  dernier :", long[1].at(-1));
' --input-type=module
```
Expected: 60 publications, plusieurs milliers de joueurs, `MS` proche de 250,
la plus longue série à ~60 points (un joueur présent toutes les semaines).

- [ ] **Step 6 : Commit**

```bash
git add lib/rank-history.mjs test/rank-history.test.mjs
git commit -m "feat(rankings): séries worldRank par joueur depuis l'historique"
```

---

### Task 7 : Bascule de `build-data.mjs` sur la série

**Files:**
- Modify: `build-data.mjs:54-70` (chargement du classement), `:90` (métadonnées), `:151-158` (fiche joueur), `:434-444` (summary)
- Delete: `data/2026/rankings/world.json`

**Interfaces:**
- Consumes: `loadPublications`, `buildWorldMap`, `buildPlayerRankHistory` (`lib/rank-history.mjs`).
- Produces: `player/<id>.json` contient désormais `worldRank: Array<{t, disc, rank, points, key}>` ; `worldMeta` gagne `date`, `publicationId`, `weeks`.

- [ ] **Step 1 : Ajouter l'import**

Dans `build-data.mjs`, après la ligne 20 (`import { matchOdds } ...`) :

```js
import { loadPublications, buildWorldMap, buildPlayerRankHistory } from "./lib/rank-history.mjs";
```

- [ ] **Step 2 : Remplacer le chargement du classement**

Remplacer le bloc `build-data.mjs:54-70` (de `// ===== 2) Classement mondial` jusqu'à la ligne `}` fermant le `if (existsSync(wrPath))`) par :

```js
// ===== 2) Classement mondial officiel BWF + comparaison =====
// Source : la série hebdomadaire de data/rankings/ (cf. backfill-rankings.mjs).
// La publication la plus récente joue le rôle de l'ancien world.json ; les
// précédentes alimentent la série worldRank des fiches joueurs.
const publications = await loadPublications(join(ROOT, "data", "rankings"));
const latestPub = publications[publications.length - 1] || null;
const playerRankHistory = buildPlayerRankHistory(publications);

let worldMeta = null;
let worldMap = {}; // disc -> Map(entityKey -> {rank, points})
if (latestPub) {
  worldMeta = {
    fetchedAt: latestPub.fetchedAt,
    date: latestPub.date,
    publicationId: latestPub.publicationId,
    week: latestPub.week,
    year: latestPub.year,
    depth: latestPub.depth,
    weeks: publications.length,
    firstDate: publications[0].date,
  };
  worldMap = buildWorldMap(latestPub);
}
console.log(
  `   Classement mondial : ${publications.length} publications` +
  (latestPub ? ` (${publications[0].date} → ${latestPub.date})` : " — aucune"),
);
```

- [ ] **Step 3 : Ajouter `worldRank` à la fiche joueur**

Dans `build-data.mjs`, dans l'objet passé à `write(\`player/${e.id}.json\`, …)` (ligne ~151), ajouter une propriété après `elo:` :

```js
    elo: playerHistory[e.id] || [],
    worldRank: playerRankHistory[e.id] || [],
    comparison: playerCompare[e.id] || [],
```

- [ ] **Step 4 : Lancer le build et vérifier**

Run: `npm run build-data`
Expected: la ligne `Classement mondial : 60 publications (2025-06-10 → 2026-07-28)`,
puis le build se termine sans erreur.

- [ ] **Step 5 : Vérifier les données produites**

Run:
```bash
node -e '
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("web/public/data/elo/ranking.json"));
console.log("worldRanking :", r.worldRanking);
const s = JSON.parse(fs.readFileSync("web/public/data/summary.json"));
console.log("summary.worldRanking.weeks :", s.worldRanking?.weeks);
// une fiche joueur avec un historique fourni
const ids = fs.readdirSync("web/public/data/player").slice(0, 400).map(n => n.replace(".json",""));
let best = null;
for (const id of ids) {
  const p = JSON.parse(fs.readFileSync("web/public/data/player/" + id + ".json"));
  if (!best || (p.worldRank||[]).length > best.n) best = { id, n: (p.worldRank||[]).length, p };
}
console.log("fiche la mieux garnie :", best.id, "->", best.n, "points de classement");
console.log("  extrait :", best.p.worldRank.slice(0, 2));
console.log("  bwfRank courant (comparison) :", best.p.comparison?.[0]?.bwfRank);
'
```
Expected: `worldRanking` contient `date`, `publicationId`, `weeks: 60` ;
une fiche joueur du top affiche ~60 points de `worldRank` ; `comparison`
continue de fonctionner (le rang mondial courant est toujours renseigné).

- [ ] **Step 6 : Supprimer l'ancien instantané**

Run:
```bash
git rm data/2026/rankings/world.json
grep -rn "world.json" --include="*.mjs" --include="*.jsx" --include="*.js" . | grep -v node_modules | grep -v "web/dist"
```
Expected: la commande `grep` ne renvoie **aucune** ligne (plus aucune référence).

- [ ] **Step 7 : Rebuild pour confirmer l'absence de régression**

Run: `npm run build-data && node --test test/*.test.mjs`
Expected: build identique à l'étape 4 (`60 publications`) et tous les tests PASS.

- [ ] **Step 8 : Commit**

```bash
git add build-data.mjs
git commit -m "feat(rankings): build-data lit la série hebdomadaire, world.json supprimé"
```

---

### Task 8 : Deux courbes sur le graphe Elo

**Files:**
- Modify: `web/src/components/EloChart.jsx` (réécriture complète)
- Modify: `web/src/pages/Player.jsx:184-193` (série de classement par discipline), `:267` (passage de la prop)

**Interfaces:**
- Consumes: `worldRank` de `player/<id>.json` (tâche 7).
- Produces: `EloChart({ points, rankPoints, label, onPointClick })` — `rankPoints: Array<{t, rank, points}>` optionnel.

- [ ] **Step 1 : Invoquer le skill UI/UX du projet**

**Obligatoire avant d'écrire du JSX** (règle du `CLAUDE.md`) : invoquer
`ui-ux-pro-max-skill` et appliquer sa check-list. Ne pas sauter cette étape.

- [ ] **Step 2 : Réécrire EloChart**

Remplacer intégralement `web/src/components/EloChart.jsx` :

```jsx
import { useMemo, useRef, useState } from "react";

// Graphique d'évolution : cote Elo (axe gauche) et, en option, rang mondial BWF
// (axe droit, INVERSÉ pour que « la courbe monte » = « le joueur progresse »
// sur les deux séries — sans quoi la comparaison serait trompeuse).
//
// Les deux séries partagent le MÊME domaine temporel : l'Elo est ponctuel (un
// point par match, horodatage irrégulier), le classement est hebdomadaire. Pas
// de rééchantillonnage ni d'interpolation.
//
// SVG responsive (viewBox), thème sombre, hover crosshair.
const W = 720, H = 260, PAD = { l: 46, r: 44, t: 18, b: 34 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;

// Au-delà de 10 jours entre deux relevés hebdomadaires, le joueur est sorti du
// top : on coupe la courbe au lieu de tracer un trait droit qui affirmerait une
// continuité non mesurée.
const RANK_GAP_MS = 10 * 864e5;

const parseT = (t) => (t ? new Date(t.replace(" ", "T")).getTime() : NaN);
const fmtDate = (t) => (t ? new Date(t.replace(" ", "T")).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" }) : "");

export default function EloChart({ points, rankPoints, label, onPointClick }) {
  const svgRef = useRef(null);
  const [hi, setHi] = useState(null);

  const geo = useMemo(() => {
    const pts = (points || []).filter((p) => Number.isFinite(p.r));
    if (pts.length === 0) return null;
    const rk = (rankPoints || [])
      .filter((p) => Number.isFinite(p.rank))
      .slice()
      .sort((a, b) => parseT(a.t) - parseT(b.t));

    // --- domaine temporel PARTAGÉ par les deux séries ---
    const eloT = pts.map((p) => parseT(p.t));
    const rkT = rk.map((p) => parseT(p.t));
    const allT = [...eloT, ...rkT].filter(Number.isFinite);
    const tmin = allT.length ? Math.min(...allT) : NaN;
    const tmax = allT.length ? Math.max(...allT) : NaN;
    const hasTime = Number.isFinite(tmin) && tmax > tmin;

    const xOfT = (t) => PAD.l + (hasTime && Number.isFinite(t) ? (t - tmin) / (tmax - tmin) : 0.5) * PW;
    const x = (i) => (hasTime ? xOfT(eloT[i]) : PAD.l + (pts.length === 1 ? 0.5 : i / (pts.length - 1)) * PW);

    // --- axe gauche : Elo ---
    const rs = pts.map((p) => p.r);
    const rmin = Math.min(...rs), rmax = Math.max(...rs);
    const pad = Math.max(15, (rmax - rmin) * 0.2);
    const ylo = Math.floor((rmin - pad) / 10) * 10;
    const yhi = Math.ceil((rmax + pad) / 10) * 10;
    const y = (r) => PAD.t + (1 - (r - ylo) / (yhi - ylo || 1)) * PH;

    const ticks = [];
    for (let k = 0; k <= 3; k++) ticks.push(Math.round(ylo + (k / 3) * (yhi - ylo)));

    const line = pts.map((p, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(p.r).toFixed(1)}`).join(" ");
    const base = PAD.t + PH;
    const area = `${line} L ${x(pts.length - 1).toFixed(1)} ${base} L ${x(0).toFixed(1)} ${base} Z`;

    // --- axe droit : rang mondial, inversé (rang 1 en haut) ---
    let rank = null;
    if (rk.length && hasTime) {
      const ranks = rk.map((p) => p.rank);
      let lo = Math.min(...ranks), hiR = Math.max(...ranks);
      if (lo === hiR) { lo = Math.max(1, lo - 5); hiR = hiR + 5; }
      const yR = (v) => PAD.t + ((v - lo) / (hiR - lo || 1)) * PH;

      // Segments : coupure dès qu'une semaine manque.
      const segments = [];
      let cur = [rk[0]];
      for (let i = 1; i < rk.length; i++) {
        if (rkT[i] - rkT[i - 1] > RANK_GAP_MS) { segments.push(cur); cur = []; }
        cur.push(rk[i]);
      }
      segments.push(cur);

      const paths = segments
        .filter((s) => s.length > 1)
        .map((s) => s.map((p, i) => `${i ? "L" : "M"} ${xOfT(parseT(p.t)).toFixed(1)} ${yR(p.rank).toFixed(1)}`).join(" "));
      const isolated = segments.filter((s) => s.length === 1).map((s) => s[0]);

      const rTicks = [];
      for (let k = 0; k <= 3; k++) rTicks.push(Math.round(lo + (k / 3) * (hiR - lo)));

      rank = { pts: rk, yR, paths, isolated, ticks: [...new Set(rTicks)], first: rk[0], last: rk[rk.length - 1] };
    }

    return { pts, x, y, xOfT, ticks, line, area, base, hasTime,
             first: pts[0], last: pts[pts.length - 1], rank };
  }, [points, rankPoints]);

  if (!geo) return <div className="muted" style={{ padding: "8px 0" }}>Pas encore d'historique de cote.</div>;

  const { pts, x, y, xOfT, ticks, line, area, first, last, rank } = geo;

  const onMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pts.length; i++) { const d = Math.abs(x(i) - vbx); if (d < bd) { bd = d; best = i; } }
    setHi(best);
  };

  const cur = last.r, delta = last.r - first.r;

  // Rang mondial le plus proche du point Elo survolé (pour l'infobulle).
  const rankNear = (t) => {
    if (!rank) return null;
    const target = parseT(t);
    let best = null, bd = Infinity;
    for (const p of rank.pts) { const d = Math.abs(parseT(p.t) - target); if (d < bd) { bd = d; best = p; } }
    return bd <= RANK_GAP_MS ? best : null;
  };

  const aria = rank
    ? `Évolution en ${label} : cote Elo de ${first.r} à ${cur} points, et rang mondial de ${rank.first.rank} à ${rank.last.rank}`
    : `Évolution de la cote Elo en ${label} : de ${first.r} à ${cur} points`;

  return (
    <div className="chart" role="img" aria-label={aria}>
      <div className="chart-head">
        <span className="chart-title">{label}</span>
        <span className="chart-cur">
          {cur} <span className={`form ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "→ 0"}
          </span>
          <span className="muted"> sur la période</span>
        </span>
      </div>
      <div className="chart-plot">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
             style={{ cursor: hi != null && pts[hi]?.tmtId ? "pointer" : "default" }}
             onMouseMove={onMove} onMouseLeave={() => setHi(null)}
             onClick={() => { if (hi != null && pts[hi]?.tmtId) onPointClick?.(pts[hi]); }}>
          {ticks.map((t) => (
            <g key={`e${t}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--muted)">{t}</text>
            </g>
          ))}

          {/* rang mondial : axe droit, valeurs croissantes vers le bas */}
          {rank && rank.ticks.map((v) => (
            <text key={`r${v}`} x={W - PAD.r + 8} y={rank.yR(v) + 4}
                  fontSize="12" fill="var(--accent-2)">{v}e</text>
          ))}

          <path d={area} fill="var(--accent)" fillOpacity="0.12" stroke="none" />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {rank && rank.paths.map((d, i) => (
            <path key={`rp${i}`} d={d} fill="none" stroke="var(--accent-2)" strokeWidth="2"
                  strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {rank && rank.isolated.map((p, i) => (
            <circle key={`ri${i}`} cx={xOfT(parseT(p.t))} cy={rank.yR(p.rank)} r="2.5" fill="var(--accent-2)" />
          ))}

          <circle cx={x(pts.length - 1)} cy={y(last.r)} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />

          {hi != null && (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={PAD.t + PH} stroke="var(--muted)" strokeWidth="1" />
              <circle cx={x(hi)} cy={y(pts[hi].r)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
            </g>
          )}

          <text x={PAD.l} y={H - 6} fontSize="12" fill="var(--muted)">{fmtDate(first.t)}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="12" fill="var(--muted)">{fmtDate(last.t)}</text>
        </svg>

        {hi != null && (
          <div className="chart-tip" style={{ left: `${(x(hi) / W) * 100}%`, top: `${(y(pts[hi].r) / H) * 100}%` }}>
            <div className="tip-r">
              <b>{pts[hi].r}</b>
              {typeof pts[hi].d === "number" && (
                <span className={`form ${pts[hi].d > 0 ? "up" : pts[hi].d < 0 ? "down" : "flat"}`}>
                  {pts[hi].d > 0 ? `+${pts[hi].d}` : pts[hi].d}
                </span>
              )}
            </div>
            <div className="tip-line">
              <span className={pts[hi].won ? "win" : "loss"}>{pts[hi].won ? "Victoire" : "Défaite"}</span>
              {pts[hi].round ? ` · ${pts[hi].round}` : ""} · {fmtDate(pts[hi].t)}
            </div>
            {pts[hi].opp && <div className="tip-line muted">vs {pts[hi].opp}</div>}
            {rankNear(pts[hi].t) && (
              <div className="tip-line muted">Mondial : {rankNear(pts[hi].t).rank}e</div>
            )}
            {pts[hi].tmt && <div className="tip-tmt">{pts[hi].tmt}</div>}
            {pts[hi].tmtId && <div className="tip-go">Voir le match ↓</div>}
          </div>
        )}
      </div>

      {rank && (
        <div className="chart-legend">
          <span className="chart-leg">
            <span className="chart-leg-swatch" style={{ background: "var(--accent)" }} />
            <span className="chart-leg-name">Cote Elo (échelle de gauche)</span>
          </span>
          <span className="chart-leg">
            <span className="chart-leg-swatch" style={{ background: "var(--accent-2)" }} />
            <span className="chart-leg-name">Rang mondial (droite, 1er en haut)</span>
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3 : Alimenter la série de classement dans Player.jsx**

Dans `web/src/pages/Player.jsx`, après le bloc `eloByDisc` (lignes 184-193), ajouter :

```js
  // Classement mondial groupé par discipline, même filtre temporel que l'Elo
  const allRank = data.worldRank || [];
  const rankByDisc = {};
  for (const pt of allRank) {
    if (cutoff && pt.t && new Date(pt.t) < cutoff) continue;
    (rankByDisc[pt.disc] ??= []).push(pt);
  }
```

- [ ] **Step 4 : Passer la prop au graphe**

Remplacer la ligne 267 de `web/src/pages/Player.jsx` :

```jsx
            <EloChart key={code} points={eloByDisc[code]} rankPoints={rankByDisc[code]}
                      label={DISC_LABEL[code] || code} onPointClick={goToMatch} />
```

- [ ] **Step 5 : Vérifier en local**

Run:
```bash
npm run build-data
cd web && npm run dev
```
Ouvrir `http://localhost:5173/#/player/<id>` pour un joueur du top (par exemple
celui identifié à la tâche 7, étape 5) et vérifier :
- deux courbes visibles, la légende présente ;
- la courbe de rang **monte** quand le joueur progresse (rang 1 en haut) ;
- les libellés de rang à droite en `var(--accent-2)` ;
- pour un joueur sorti du top 250, la courbe de rang est **interrompue** et non
  reliée par un trait droit ;
- pour un joueur sans classement, aucune légende et aucun axe droit — le graphe
  redevient identique à avant.

- [ ] **Step 6 : Vérifier le rendu mobile à 375px**

Dans le navigateur, réduire la fenêtre à **375px** de large (ou utiliser le mode
responsive des devtools) et vérifier :
- **aucun débordement horizontal de la page** ;
- le SVG se redimensionne (`viewBox`, pas de largeur fixe) ;
- la légende passe à la ligne sans casser la carte ;
- les libellés de dates ne se chevauchent pas.

- [ ] **Step 7 : Construire le front pour valider le build**

Run: `cd web && npm run build`
Expected: build Vite réussi, aucun avertissement de variable non définie.

- [ ] **Step 8 : Commit**

```bash
git add web/src/components/EloChart.jsx web/src/pages/Player.jsx
git commit -m "feat(web): superpose le rang mondial sur le graphe Elo (axe droit inversé)"
```

---

## Notes de vérification finale

Après la tâche 8, lancer la chaîne complète :

```bash
node --test test/*.test.mjs      # 54 tests attendus (25 publications + 17 rankings + 12 rank-history)
npm run build-data
cd web && npm run build
```

Puis vérifier que `npm run refresh` reste cohérent : la chaîne
`update && fetch-rankings && scrape-odds && build-data` fonctionne toujours,
`fetch-rankings.mjs` sortant en `⏭ Aucune publication manquante` quand tout est
à jour.

**Workflow GitHub Actions** (`.github/workflows/deploy.yml`) : **aucune
modification nécessaire.** `fetch-rankings.mjs` reconstruit l'index depuis l'API
s'il est absent, donc il n'a pas de prérequis de fichier. Il consomme 1 requête
d'index par run, et ne télécharge que le mardi (ou pour rattraper un trou).

**Vérification du rattrapage en conditions réelles**, une fois la chaîne verte :
supprimer un fichier de publication, lancer `npm run refresh`, et confirmer que
le fichier revient et que `build-data` reproduit la même série. C'est la propriété
qui distingue cette conception de la précédente ; elle mérite d'être vue
fonctionner au moins une fois.

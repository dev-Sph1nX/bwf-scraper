# Étude de rentabilité (ROI) des pronostics — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mesurer la rentabilité (ROI) qu'aurait eue un parieur suivant nos pronos en mise plate 1 €, selon 6 analyses (favori, value EV+, tranches de confiance, balayage du seuil EV, désaccord bookmaker, par bookmaker), et l'afficher sur une page « Rentabilité » du site.

**Architecture:** Un module pur `lib/roi.mjs` (aucune E/S, testé unitairement) calcule tout ; `build-data.mjs` lui passe les matchs prono+cotes déjà en mémoire (section 5b) et écrit `web/public/data/roi.json` ; une page React `Rentabilite.jsx` l'affiche.

**Tech Stack:** Node ≥ 20 (ESM, `node --test`), React + Vite + react-router (HashRouter), aucune dépendance nouvelle.

**Spec :** `docs/superpowers/specs/2026-08-04-roi-etude-rentabilite-design.md`

## Global Constraints

- Mise plate 1 € par pari ; gain = cote − 1 si gagné, −1 sinon ; ROI = gain net / mise totale.
- Convention EV du projet (`lib/ev.mjs`) : `EV = cote × p − 1`, value si EV > 0. Seuils du balayage : 0 / 0,05 / 0,10 / 0,15 / 0,20.
- Deux instants indépendants : `open` (cotes `open1`/`open2`, seules les données Flashscore en ont) et `close` (`odd1`/`odd2`). Un camp sans cote à un instant ⇒ pas de pari à cet instant.
- Bootstrap : 500 tirages, graine 42 (comme `backtest.mjs`), via `makeRng` de `lib/metrics.mjs`.
- Probas : entiers 0..100 (proba de team1, déjà recalibrée, figée d'avant match). `pick` = 1|2, `winner` = 1|2.
- Ne jamais committer `web/public/data/` (ignoré). Les commits suivent le style du dépôt : `feat(roi): …` en français, avec `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- UI : passer par le skill `ui-ux-pro-max-skill` AVANT de toucher au React/CSS ; couleurs uniquement via variables CSS de `web/src/styles.css` ; 3 états (chargement/vide/données) ; tableaux dans `.table-scroll` ; rendu vérifié à ~375 px.

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `lib/roi.mjs` (créer) | Module pur : meilleure cote par instant, générateurs de paris (3 stratégies), agrégats bootstrap, `computeRoi()` qui assemble tout le rapport |
| `test/roi.test.mjs` (créer) | Tests unitaires `node --test` |
| `build-data.mjs` (modifier, section 5b ~l.675-697) | Collecte des lignes prono+cotes, appel `computeRoi`, écriture `roi.json` |
| `web/src/pages/Rentabilite.jsx` (créer) | Page « Rentabilité » |
| `web/src/main.jsx` + `web/src/components/Layout.jsx` (modifier) | Route `/rentabilite` + entrée de menu |
| `web/src/styles.css` (modifier si besoin) | Styles spécifiques, via variables existantes |

---

### Task 1: `lib/roi.mjs` — meilleure cote et générateurs de paris

**Files:**
- Create: `lib/roi.mjs`
- Test: `test/roi.test.mjs`

**Interfaces:**
- Consumes: `ev(odd, p)` de `lib/ev.mjs` (retourne `cote × p − 1`, ou `null` si cote ≤ 1 / p inconnue).
- Produces (utilisé par Task 2-3) :
  - `bestOddAt(books, side, instant, onlyBook = null) -> { odd, book } | null`
  - `favoriBets(row, instant, onlyBook = null) -> Bet[]`
  - `valueBets(row, instant, { threshold = 0, onlyBook = null } = {}) -> Bet[]` (chaque pari porte `ev`)
  - `disagreementBets(row, instant) -> Bet[]`
  - `Bet = { side, odd, book, rowProb, won, gain, ev? }` (`rowProb` = proba team1 de la ligne, nécessaire aux tranches de confiance de la Task 3) ; `row = { prob, pick, winner, books, … }`
  - Constantes : `BOOKS = ["betclic","unibet","winamax"]`, `INSTANTS = ["open","close"]`, `EV_THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2]`, `BANDS = ["50-60","60-70","70-80","80-90","90-100"]`

- [ ] **Step 1 : écrire les tests qui échouent**

```js
// test/roi.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  bestOddAt, favoriBets, valueBets, disagreementBets,
} from "../lib/roi.mjs";

// Jeux de cotes : flashscore (open+close) et relevé maison (close seule).
const BOOKS_FULL = {
  betclic: { odd1: 1.5, odd2: 2.5, open1: 1.4, open2: 2.8 },
  unibet:  { odd1: 1.55, odd2: 2.4, open1: 1.45, open2: 2.6 },
  winamax: { odd1: 1.48, odd2: 2.6, open1: 1.38, open2: 3.0 },
};
const BOOKS_CLOSE_ONLY = { betclic: { odd1: 1.9, odd2: 1.9 } };

test("bestOddAt : max des bookmakers, par camp et par instant", () => {
  assert.deepEqual(bestOddAt(BOOKS_FULL, 1, "close"), { odd: 1.55, book: "unibet" });
  assert.deepEqual(bestOddAt(BOOKS_FULL, 2, "close"), { odd: 2.6, book: "winamax" });
  assert.deepEqual(bestOddAt(BOOKS_FULL, 2, "open"), { odd: 3.0, book: "winamax" });
});

test("bestOddAt : ouverture absente (relevé maison) -> null ; clôture ok", () => {
  assert.equal(bestOddAt(BOOKS_CLOSE_ONLY, 1, "open"), null);
  assert.deepEqual(bestOddAt(BOOKS_CLOSE_ONLY, 1, "close"), { odd: 1.9, book: "betclic" });
});

test("bestOddAt : restriction à un seul bookmaker", () => {
  assert.deepEqual(bestOddAt(BOOKS_FULL, 1, "close", "betclic"), { odd: 1.5, book: "betclic" });
  assert.equal(bestOddAt(BOOKS_CLOSE_ONLY, 1, "close", "winamax"), null);
});

test("bestOddAt : books vide ou absent -> null", () => {
  assert.equal(bestOddAt({}, 1, "close"), null);
  assert.equal(bestOddAt(undefined, 1, "close"), null);
});

const row = (over = {}) => ({
  prob: 70, pick: 1, winner: 1, books: BOOKS_FULL, ...over,
});

test("favoriBets : gagne -> gain = cote − 1 ; perd -> −1", () => {
  const [win] = favoriBets(row(), "close");
  assert.deepEqual(win, { side: 1, odd: 1.55, book: "unibet", rowProb: 70, won: true, gain: 0.55 });
  const [lose] = favoriBets(row({ winner: 2 }), "close");
  assert.equal(lose.won, false);
  assert.equal(lose.gain, -1);
});

test("favoriBets : pas de cote du pick à cet instant -> aucun pari", () => {
  assert.deepEqual(favoriBets(row({ books: BOOKS_CLOSE_ONLY }), "open"), []);
});

test("valueBets : mise sur l'outsider quand l'EV est positive", () => {
  // prob team1 = 70 % -> team2 = 30 % ; cote 2 de clôture 2.6 -> EV = 0.3×2.6−1 = −0.22 (pas de pari)
  // cote 1 de clôture 1.55 -> EV = 0.7×1.55−1 = 0.085 (pari sur le camp 1)
  const bets = valueBets(row(), "close");
  assert.equal(bets.length, 1);
  assert.equal(bets[0].side, 1);
  assert.ok(Math.abs(bets[0].ev - 0.085) < 1e-9);
});

test("valueBets : peut miser sur les DEUX camps si les cotes sont généreuses", () => {
  const books = { betclic: { odd1: 2.1, odd2: 2.6 } }; // 50 % -> EV 0.05 et 0.30… avec prob 50/50
  const bets = valueBets(row({ prob: 50, books }), "close");
  assert.equal(bets.length, 2);
});

test("valueBets : seuil strict — EV exactement au seuil ne mise pas", () => {
  // Cas choisis pour une arithmétique flottante EXACTE (p = 0,5 divise par 2) :
  const books = { betclic: { odd1: 2.0 } }; // prob 50 -> EV = 0 pile
  assert.deepEqual(valueBets(row({ prob: 50, books }), "close"), []);
  // odd 3.0 × 0.5 = 1.5 exact -> EV = 0.5 pile : pas de pari au seuil 0.5
  assert.equal(valueBets(row({ prob: 50, books: { betclic: { odd1: 3.0 } } }), "close", { threshold: 0.5 }).length, 0);
});

test("valueBets : restriction à un bookmaker", () => {
  const bets = valueBets(row(), "close", { onlyBook: "winamax" }); // odd1 1.48 -> EV 0.036
  assert.equal(bets.length, 1);
  assert.equal(bets[0].book, "winamax");
});

test("disagreementBets : seulement si la meilleure cote du favori dépasse 2", () => {
  assert.deepEqual(disagreementBets(row(), "close"), []); // cote favori 1.55
  const books = { betclic: { odd1: 2.0 } };
  assert.deepEqual(disagreementBets(row({ books }), "close"), []); // 2.0 pile : non
  const [bet] = disagreementBets(row({ books: { betclic: { odd1: 2.1 } } }), "close");
  assert.equal(bet.odd, 2.1);
  assert.equal(bet.side, 1);
});
```

- [ ] **Step 2 : vérifier qu'ils échouent**

Run : `npm test -- test/roi.test.mjs` (ou `node --test test/roi.test.mjs`)
Attendu : ÉCHEC — `Cannot find module '../lib/roi.mjs'`.

- [ ] **Step 3 : implémentation minimale**

```js
// lib/roi.mjs
// Étude de rentabilité des pronostics : simule des stratégies de mise PLATE
// (1 € par pari) sur les matchs joués disposant d'un prono ET de cotes.
// Module pur, aucune E/S : appelé par build-data.mjs, testé par test/roi.test.mjs.
//
// Une « ligne » = un match prono+coté :
//   { tmtId, name, disc, roundName, matchTime, team1, team2,  // affichage
//     prob,   // proba (team1) d'avant match, entier 0..100, déjà recalibrée
//     pick,   // camp prédit : 1 | 2
//     winner, // vainqueur réel : 1 | 2
//     books } // { betclic|unibet|winamax: { odd1, odd2, open1?, open2? } }
// Les cotes d'ouverture n'existent que via Flashscore ; nos relevés maison
// n'ont que la clôture — chaque instant se traite donc indépendamment.

import { ev } from "./ev.mjs";
import { makeRng } from "./metrics.mjs";

export const BOOKS = ["betclic", "unibet", "winamax"];
export const INSTANTS = ["open", "close"];
export const EV_THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2];
export const BANDS = ["50-60", "60-70", "70-80", "80-90", "90-100"];

/** Meilleure cote d'un camp à un instant (ou celle d'un seul bookmaker). */
export function bestOddAt(books, side, instant, onlyBook = null) {
  const field = (instant === "close" ? "odd" : "open") + side;
  let best = null;
  for (const [book, b] of Object.entries(books || {})) {
    if (onlyBook && book !== onlyBook) continue;
    const odd = b?.[field];
    if (odd > 1 && (!best || odd > best.odd)) best = { odd, book };
  }
  return best;
}

const round2 = (v) => Math.round(v * 100) / 100;

/** Règle le pari : gain = cote − 1 si le camp misé gagne, −1 sinon.
 *  rowProb (proba team1) voyage avec le pari : les tranches de confiance
 *  de computeRoi en ont besoin sans retour à la ligne d'origine. */
const settle = (row, side, b) => ({
  side, odd: b.odd, book: b.book, rowProb: row.prob,
  won: row.winner === side,
  gain: row.winner === side ? round2(b.odd - 1) : -1,
});

/** Proba (0..1) d'un camp, depuis la proba team1 entière. */
const probOf = (row, side) => (side === 1 ? row.prob : 100 - row.prob) / 100;

/** Stratégie « favori » : 1 € sur notre pick, si sa cote existe à cet instant. */
export function favoriBets(row, instant, onlyBook = null) {
  const b = bestOddAt(row.books, row.pick, instant, onlyBook);
  return b ? [settle(row, row.pick, b)] : [];
}

/** Stratégie « value » : 1 € sur chaque camp dont EV = cote × p − 1 > seuil.
 *  Le pari porte son EV : le balayage de seuils refiltre sans re-simuler. */
export function valueBets(row, instant, { threshold = 0, onlyBook = null } = {}) {
  const out = [];
  for (const side of [1, 2]) {
    const b = bestOddAt(row.books, side, instant, onlyBook);
    if (!b) continue;
    const e = ev(b.odd, probOf(row, side));
    if (e != null && e > threshold) out.push({ ...settle(row, side, b), ev: e });
  }
  return out;
}

/** Stratégie « désaccord » : notre favori est l'outsider du marché (cote > 2). */
export function disagreementBets(row, instant) {
  const b = bestOddAt(row.books, row.pick, instant);
  return b && b.odd > 2 ? [settle(row, row.pick, b)] : [];
}
```

(`makeRng` est importé dès maintenant pour la Task 2 ; si le linter s'en plaint, le déplacer en Task 2.)

- [ ] **Step 4 : vérifier que les tests passent**

Run : `node --test test/roi.test.mjs` — attendu : tous PASS.
Puis `npm test` — attendu : la suite complète passe (aucune régression).

- [ ] **Step 5 : commit**

```bash
git add lib/roi.mjs test/roi.test.mjs
git commit -m "feat(roi): meilleure cote par instant + paris favori/value/désaccord (lib pure)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `lib/roi.mjs` — agrégats avec intervalle de confiance bootstrap

**Files:**
- Modify: `lib/roi.mjs`
- Test: `test/roi.test.mjs`

**Interfaces:**
- Produces : `aggregate(bets, { draws = 500, seed = 42 } = {}) -> { n, staked, net, roi, ci, won }`
  — `roi` et les bornes `ci` arrondis à 4 décimales, `net` à 2 ; liste vide → `{ n: 0, staked: 0, net: 0, roi: null, ci: null, won: 0 }`.

- [ ] **Step 1 : tests qui échouent**

```js
// à ajouter dans test/roi.test.mjs
import { aggregate } from "../lib/roi.mjs";

test("aggregate : liste vide -> zéros et roi/ci null", () => {
  assert.deepEqual(aggregate([]), { n: 0, staked: 0, net: 0, roi: null, ci: null, won: 0 });
});

test("aggregate : net, roi et won exacts", () => {
  const bets = [
    { gain: 0.55, won: true }, { gain: -1, won: false },
    { gain: 1.4, won: true }, { gain: -1, won: false },
  ];
  const a = aggregate(bets);
  assert.equal(a.n, 4);
  assert.equal(a.staked, 4);
  assert.ok(Math.abs(a.net - -0.05) < 1e-9);
  assert.ok(Math.abs(a.roi - -0.0125) < 1e-4);
  assert.equal(a.won, 2);
});

test("aggregate : bootstrap reproductible (graine fixe) et IC autour du ROI", () => {
  const bets = Array.from({ length: 100 }, (_, i) => (
    i % 2 ? { gain: 0.9, won: true } : { gain: -1, won: false }
  ));
  const a = aggregate(bets, { seed: 42 });
  const b = aggregate(bets, { seed: 42 });
  assert.deepEqual(a.ci, b.ci); // même graine -> même IC
  assert.ok(a.ci[0] <= a.roi && a.roi <= a.ci[1]); // l'IC contient le ROI ponctuel
  assert.ok(a.ci[0] < a.ci[1]);
});
```

- [ ] **Step 2 : vérifier l'échec** — `node --test test/roi.test.mjs` : `aggregate is not a function` (ou équivalent).

- [ ] **Step 3 : implémentation**

```js
// à ajouter dans lib/roi.mjs
const round4 = (v) => Math.round(v * 10000) / 10000;

/** Agrégat d'une liste de paris : ROI ponctuel + IC 95 % par bootstrap
 *  (rééchantillonnage des paris avec remise, graine fixe -> reproductible). */
export function aggregate(bets, { draws = 500, seed = 42 } = {}) {
  const n = bets.length;
  if (!n) return { n: 0, staked: 0, net: 0, roi: null, ci: null, won: 0 };
  const net = bets.reduce((s, b) => s + b.gain, 0);
  const won = bets.reduce((s, b) => s + (b.won ? 1 : 0), 0);
  const rng = makeRng(seed);
  const rois = new Array(draws);
  for (let d = 0; d < draws; d++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += bets[(rng() * n) | 0].gain;
    rois[d] = s / n;
  }
  rois.sort((a, b) => a - b);
  const lo = rois[Math.floor(0.025 * (draws - 1))];
  const hi = rois[Math.ceil(0.975 * (draws - 1))];
  return { n, staked: n, net: round2(net), roi: round4(net / n), ci: [round4(lo), round4(hi)], won };
}
```

- [ ] **Step 4 : vérifier** — `node --test test/roi.test.mjs` PASS, puis `npm test` PASS.

- [ ] **Step 5 : commit**

```bash
git add lib/roi.mjs test/roi.test.mjs
git commit -m "feat(roi): agrégat de paris avec IC 95 % bootstrap (graine fixe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `lib/roi.mjs` — `computeRoi()` : le rapport complet

**Files:**
- Modify: `lib/roi.mjs`
- Test: `test/roi.test.mjs`

**Interfaces:**
- Consumes : tout ce qui précède.
- Produces : `computeRoi(rows, { draws = 500, seed = 42 } = {})` retournant :

```jsonc
{
  "totalMatches": 123,
  "strategies": {
    "favori": { "global": { "open": AGG, "close": AGG },
                "tournois": [ { "tmtId", "name", "firstDay", "open": AGG, "close": AGG } ] },
    "value":  { /* même forme */ }
  },
  "bands":    [ { "band": "50-60", "open": AGG, "close": AGG }, … 5 entrées ],
  "evSweep":  [ { "threshold": 0, "open": AGG, "close": AGG }, … 5 entrées ],
  "disagreement": { "open": AGG, "close": AGG },
  "byBook": [ { "book": "betclic",
                "favori": { "all": { "open": AGG, "close": AGG }, "common": { "open": AGG, "close": AGG } },
                "value":  { /* même forme */ } }, … 3 entrées ],
  "bets": [ { "tmtId", "disc", "roundName", "matchTime", "team1", "team2",
              "prob", "strategy", "instant", "side", "book", "odd",
              "ev": null | number, "won", "gain" } ]
}
```
  où `AGG` = le retour d'`aggregate`. `bets` couvre `favori`, `value` (seuil 0, avec `ev`) et `desaccord` aux deux instants — PAS le balayage ni le par-bookmaker (dérivables : refiltrer `ev`, rejouer avec `onlyBook`). Les lignes inutilisables (sans `prob`, sans `winner` 1|2, sans `books` non vide) sont écartées en tête.

- [ ] **Step 1 : tests qui échouent**

```js
// à ajouter dans test/roi.test.mjs
import { computeRoi, EV_THRESHOLDS, BANDS, BOOKS } from "../lib/roi.mjs";

// Petit jeu : 2 tournois, cotes complètes (open+close) pour rendre tout actif.
const mkRow = (tmtId, i, over = {}) => ({
  tmtId, name: `Tournoi ${tmtId}`, disc: "MS", roundName: "R16",
  matchTime: `2026-03-0${tmtId} 1${i}:00:00`, team1: `A${i}`, team2: `B${i}`,
  prob: 65, pick: 1, winner: i % 2 ? 1 : 2, books: BOOKS_FULL, ...over,
});
const ROWS = [
  ...Array.from({ length: 6 }, (_, i) => mkRow(1, i)),
  ...Array.from({ length: 6 }, (_, i) => mkRow(2, i)),
];

test("computeRoi : écarte les lignes inutilisables", () => {
  const r = computeRoi([
    ...ROWS,
    mkRow(3, 0, { prob: null, pick: null }),  // sans prono
    mkRow(3, 1, { winner: null }),             // sans vainqueur
    mkRow(3, 2, { books: {} }),                // sans cotes
  ]);
  assert.equal(r.totalMatches, ROWS.length);
  assert.equal(r.strategies.favori.tournois.length, 2);
});

test("computeRoi : la somme des tournois = le global (net et n), par stratégie/instant", () => {
  const r = computeRoi(ROWS);
  for (const key of ["favori", "value"]) {
    for (const instant of ["open", "close"]) {
      const t = r.strategies[key].tournois;
      const sumN = t.reduce((s, x) => s + x[instant].n, 0);
      const sumNet = t.reduce((s, x) => s + x[instant].net, 0);
      assert.equal(sumN, r.strategies[key].global[instant].n, `${key}/${instant}`);
      assert.ok(Math.abs(sumNet - r.strategies[key].global[instant].net) < 0.02, `${key}/${instant}`);
    }
  }
});

test("computeRoi : tranches — prob 50 tombe en 50-60, prob 100 en 90-100", () => {
  const rows = [mkRow(1, 0, { prob: 50, pick: 1 }), mkRow(1, 1, { prob: 100, pick: 1 })];
  const r = computeRoi(rows);
  const bandN = (band, instant) => r.bands.find((b) => b.band === band)[instant].n;
  assert.equal(bandN("50-60", "close"), 1);
  assert.equal(bandN("90-100", "close"), 1);
  assert.equal(r.bands.length, BANDS.length);
});

test("computeRoi : tranches — la proba du PICK, pas celle de team1 (pick 2, prob 20 -> 80-90)", () => {
  const r = computeRoi([mkRow(1, 0, { prob: 20, pick: 2, winner: 2 })]);
  assert.equal(r.bands.find((b) => b.band === "80-90").close.n, 1);
});

test("computeRoi : balayage — le volume ne peut que baisser quand le seuil monte", () => {
  const r = computeRoi(ROWS);
  assert.equal(r.evSweep.length, EV_THRESHOLDS.length);
  for (const instant of ["open", "close"]) {
    for (let i = 1; i < r.evSweep.length; i++) {
      assert.ok(r.evSweep[i][instant].n <= r.evSweep[i - 1][instant].n, instant);
    }
  }
  // seuil 0 = la stratégie value elle-même
  assert.equal(r.evSweep[0].close.n, r.strategies.value.global.close.n);
});

test("computeRoi : par bookmaker — le panier commun est inclus dans « tous ses matchs »", () => {
  // un match où seul betclic cote -> exclu du panier commun
  const rows = [...ROWS, mkRow(1, 9, { books: { betclic: { odd1: 1.8, odd2: 2.0 } } })];
  const r = computeRoi(rows);
  assert.equal(r.byBook.length, BOOKS.length);
  const bc = r.byBook.find((b) => b.book === "betclic");
  assert.ok(bc.favori.common.close.n < bc.favori.all.close.n);
  const wina = r.byBook.find((b) => b.book === "winamax");
  assert.equal(wina.favori.common.close.n, wina.favori.all.close.n); // winamax ne cote pas le match ajouté
});

test("computeRoi : le journal des paris est auditable (stratégies, ev sur value)", () => {
  const r = computeRoi(ROWS);
  const strategies = new Set(r.bets.map((b) => b.strategy));
  assert.deepEqual([...strategies].sort(), ["favori", "value"]); // pas de désaccord : cotes favori < 2
  assert.ok(r.bets.filter((b) => b.strategy === "value").every((b) => typeof b.ev === "number"));
  const fav = r.bets.filter((b) => b.strategy === "favori" && b.instant === "close");
  assert.equal(fav.length, r.strategies.favori.global.close.n);
});

test("computeRoi : reproductible (même graine -> mêmes IC)", () => {
  assert.deepEqual(computeRoi(ROWS), computeRoi(ROWS));
});
```

- [ ] **Step 2 : vérifier l'échec** — `node --test test/roi.test.mjs` : `computeRoi is not a function`.

- [ ] **Step 3 : implémentation**

```js
// à ajouter dans lib/roi.mjs

/** Tranche de confiance d'une proba de pick (50..100). */
const bandOf = (pickProb) => BANDS[Math.min(Math.floor((pickProb - 50) / 10), BANDS.length - 1)];

/** Le rapport complet de l'étude de rentabilité (cf. spec du 2026-08-04). */
export function computeRoi(rows, { draws = 500, seed = 42 } = {}) {
  const usable = rows.filter((r) =>
    r.prob != null && (r.winner === 1 || r.winner === 2) &&
    r.books && Object.keys(r.books).length > 0);
  const opts = { draws, seed };

  // Journal auditable : chaque pari des stratégies principales, aux 2 instants.
  const betLog = [];
  const logged = (row, strategy, instant, bets) => {
    for (const b of bets) betLog.push({
      tmtId: row.tmtId, disc: row.disc, roundName: row.roundName,
      matchTime: row.matchTime, team1: row.team1, team2: row.team2,
      prob: row.prob, strategy, instant, side: b.side, book: b.book,
      odd: b.odd, ev: b.ev != null ? round4(b.ev) : null, won: b.won, gain: b.gain,
    });
    return bets;
  };

  // --- analyses 1-2 : favori et value, par tournoi + global ---
  const gen = {
    favori: (r, instant) => favoriBets(r, instant),
    value: (r, instant) => valueBets(r, instant),
  };
  const allBets = { favori: { open: [], close: [] }, value: { open: [], close: [] } };
  const tmtIds = [...new Set(usable.map((r) => r.tmtId))];
  const strategies = {};
  for (const key of Object.keys(gen)) {
    const tournois = [];
    for (const tmtId of tmtIds) {
      const tRows = usable.filter((r) => r.tmtId === tmtId);
      const entry = {
        tmtId, name: tRows[0].name,
        firstDay: tRows.map((r) => String(r.matchTime || "")).sort()[0].slice(0, 10) || null,
      };
      for (const instant of INSTANTS) {
        const bets = tRows.flatMap((r) => logged(r, key, instant, gen[key](r, instant)));
        allBets[key][instant].push(...bets);
        entry[instant] = aggregate(bets, opts);
      }
      tournois.push(entry);
    }
    tournois.sort((a, b) => String(a.firstDay).localeCompare(String(b.firstDay)));
    strategies[key] = {
      global: {
        open: aggregate(allBets[key].open, opts),
        close: aggregate(allBets[key].close, opts),
      },
      tournois,
    };
  }

  // --- analyse 3 : ROI du pari « favori » par tranche de confiance ---
  const bands = BANDS.map((band) => ({ band }));
  for (const instant of INSTANTS) {
    const groups = new Map(BANDS.map((b) => [b, []]));
    for (const bet of allBets.favori[instant]) {
      // La proba du pick n'est pas dans le pari : on la retrouve via le camp misé.
      groups.get(bandOf(bet.side === 1 ? bet.rowProb : 100 - bet.rowProb)).push(bet);
    }
    for (const e of bands) e[instant] = aggregate(groups.get(e.band), opts);
  }

  // --- analyse 4 : balayage du seuil d'EV (refiltre les paris value, ev connu) ---
  const evSweep = EV_THRESHOLDS.map((threshold) => {
    const e = { threshold };
    for (const instant of INSTANTS) {
      e[instant] = aggregate(allBets.value[instant].filter((b) => b.ev > threshold), opts);
    }
    return e;
  });

  // --- analyse 5 : désaccord avec le marché ---
  const disagreement = {};
  for (const instant of INSTANTS) {
    const bets = usable.flatMap((r) => logged(r, "desaccord", instant, disagreementBets(r, instant)));
    disagreement[instant] = aggregate(bets, opts);
  }

  // --- analyse 6 : chaque bookmaker seul, sur tous ses matchs ET sur le
  // panier commun (matchs où les 3 cotent les deux camps à cet instant) ---
  const hasAll = (row, instant) =>
    BOOKS.every((bk) => bestOddAt(row.books, 1, instant, bk) && bestOddAt(row.books, 2, instant, bk));
  const byBook = BOOKS.map((book) => {
    const entry = { book };
    for (const key of Object.keys(gen)) {
      const mk = (r, instant) => key === "favori"
        ? favoriBets(r, instant, book)
        : valueBets(r, instant, { onlyBook: book });
      entry[key] = { all: {}, common: {} };
      for (const instant of INSTANTS) {
        entry[key].all[instant] = aggregate(usable.flatMap((r) => mk(r, instant)), opts);
        entry[key].common[instant] =
          aggregate(usable.filter((r) => hasAll(r, instant)).flatMap((r) => mk(r, instant)), opts);
      }
    }
    return entry;
  });

  return { totalMatches: usable.length, strategies, bands, evSweep, disagreement, byBook, bets: betLog };
}
```

(`bet.rowProb` vient de `settle()` en Task 1 : chaque pari porte la proba team1 de sa ligne, c'est ce qui permet aux tranches de se calculer depuis `allBets.favori` sans retour aux lignes.)

- [ ] **Step 4 : vérifier** — `node --test test/roi.test.mjs` PASS, puis `npm test` PASS.

- [ ] **Step 5 : commit**

```bash
git add lib/roi.mjs test/roi.test.mjs
git commit -m "feat(roi): computeRoi — 6 analyses (tournois, tranches, seuils EV, désaccord, bookmakers)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: branchement dans `build-data.mjs` → `web/public/data/roi.json`

**Files:**
- Modify: `build-data.mjs` (section 5b, ~lignes 675-697)

**Interfaces:**
- Consumes : `computeRoi(rows)` de `lib/roi.mjs` ; les structures locales de build-data : `pronosByTmt` (entrées `e` avec `prob`, `pick`, `winner`, `walkover`, `odds` attaché dans la boucle 5b), `allTournaments` (l.289, rempli avant la 5b ; champs `id`, `name`), `writtenTmtIds`, `write(path, obj)`, `ranking.generatedAt`.
- Produces : `web/public/data/roi.json` = `{ generatedAt, ...computeRoi(rows) }`.

- [ ] **Step 1 : import et collecte des lignes**

En tête de `build-data.mjs`, à côté des autres imports lib :

```js
import { computeRoi } from "./lib/roi.mjs";
```

Juste AVANT la boucle `for (const [tmtId, list] of pronosByTmt)` de la section 5b (~l.677) :

```js
// Lignes de l'étude de rentabilité : chaque match joué qui a un prono ET des
// cotes appariées. Construites ici même, où e.odds vient d'être attaché.
const tournamentName = new Map(allTournaments.map((t) => [t.id, t.name]));
const roiRows = [];
```

Dans la boucle, juste après `if (odds) { e.odds = odds; withOdds++; }` :

```js
    if (e.prob != null && e.odds?.books) {
      roiRows.push({
        tmtId, name: tournamentName.get(tmtId) ?? String(tmtId),
        disc: e.disc, roundName: e.roundName, matchTime: e.matchTime,
        team1: e.team1.players.map((p) => p.nameDisplay).join(" / "),
        team2: e.team2.players.map((p) => p.nameDisplay).join(" / "),
        prob: e.prob, pick: e.pick, winner: e.winner, books: e.odds.books,
      });
    }
```

(`e.prob != null` implique non-forfait : les forfaits n'ont jamais de prono.)

- [ ] **Step 2 : calcul et écriture, après la boucle 5b**

Après le `console.log("   Pronostics : …")` (~l.697) :

```js
// ===== 5c) Étude de rentabilité : roi.json =====
// Simule des mises plates de 1 € sur les pronos selon 6 stratégies (cf.
// docs/superpowers/specs/2026-08-04-roi-etude-rentabilite-design.md).
{
  const roi = computeRoi(roiRows);
  await write("roi.json", { generatedAt: ranking.generatedAt, ...roi });
  const pc = (v) => (v == null ? "—" : (v * 100).toFixed(1) + " %");
  const g = roi.strategies;
  console.log(
    `   ROI : ${roi.totalMatches} matchs prono+cotes — clôture : ` +
    `favori ${pc(g.favori.global.close.roi)} (${g.favori.global.close.n} paris), ` +
    `value ${pc(g.value.global.close.roi)} (${g.value.global.close.n} paris)`
  );
}
```

- [ ] **Step 3 : générer et vérifier**

Run : `npm run build-data`
Attendu : la ligne `   ROI : ~1398 matchs prono+cotes — clôture : favori … value …` s'affiche, et `web/public/data/roi.json` existe. Vérifier la cohérence :

```bash
node -e "
const r = require('./web/public/data/roi.json');
console.log('matchs', r.totalMatches);
console.log('tournois favori', r.strategies.favori.tournois.length);
console.log('close favori', r.strategies.favori.global.close);
console.log('close value ', r.strategies.value.global.close);
console.log('bands', r.bands.map(b=>b.band+':'+b.close.n).join(' '));
console.log('paris journalisés', r.bets.length);
"
```
Attendu : totalMatches ≈ 1398 (l'exploration du 2026-08-04 en comptait 1398), 19 tournois, chaque tranche non vide, `bets.length` > 0. Vérifier aussi la taille du fichier (`du -h web/public/data/roi.json`) : si > 2 Mo, alléger `bets` (retirer `roundName`) — sinon ne rien faire.

- [ ] **Step 4 : suite de tests complète** — `npm test` : PASS (aucune régression).

- [ ] **Step 5 : commit** (les données générées `web/public/data/` sont ignorées : ne committer QUE le code)

```bash
git add build-data.mjs
git commit -m "feat(roi): build-data génère roi.json (étude de rentabilité des pronos)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 6 : rapporter le verdict chiffré à Lucas** — copier dans la conversation le résumé console (ROI favori/value à la clôture et à l'ouverture, IC compris) AVANT de construire la page : c'est le livrable intermédiaire promis.

---

### Task 5: page web « Rentabilité » — route, menu, contenu

**Files:**
- Create: `web/src/pages/Rentabilite.jsx`
- Modify: `web/src/main.jsx` (route), `web/src/components/Layout.jsx` (menu), `web/src/styles.css` (si besoin)

**Interfaces:**
- Consumes : `getJSON("roi.json")` de `web/src/data.js` ; le format `roi.json` de la Task 4 ; les classes existantes (`.card`, `.stat`, `.badge`, `.table-scroll`…).
- Produces : route `/rentabilite` accessible depuis le menu.

**⚠ OBLIGATOIRE avant d'écrire le moindre JSX/CSS : invoquer le skill `ui-ux-pro-max-skill` et appliquer sa check-list.** Le code ci-dessous est la référence FONCTIONNELLE (structure, textes, données) ; les classes/styles exacts doivent être alignés sur le design system par le skill.

- [ ] **Step 1 : invoquer `ui-ux-pro-max-skill`** et lire `web/src/styles.css` + une page existante proche (`web/src/pages/Reliability.jsx`) pour caler les patterns (états, tableaux, encarts pédagogiques).

- [ ] **Step 2 : route et menu**

`web/src/main.jsx` — ajouter l'import et la route (à côté de `/predictor`) :

```jsx
import Rentabilite from "./pages/Rentabilite.jsx";
// …
<Route path="/rentabilite" element={<Rentabilite />} />
```

`web/src/components/Layout.jsx` — ajouter dans `<nav>` (l.49-56), après Coulisses :

```jsx
<NavLink to="/rentabilite">Rentabilité</NavLink>
```

- [ ] **Step 3 : page `Rentabilite.jsx`** — structure fonctionnelle de référence :

```jsx
// web/src/pages/Rentabilite.jsx
// Étude de rentabilité : et si on avait misé 1 € sur chaque prono ?
// Lit roi.json (généré par build-data, cf. lib/roi.mjs). Tout chiffre affiché
// est traçable jusqu'aux paris individuels (journal `bets`).
import { useEffect, useState } from "react";
import { getJSON } from "../data.js";

const pc = (v, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)} %`);
const eur = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)} €`);
const ciTxt = (ci) => (ci ? `${pc(ci[0], 0)} à ${pc(ci[1], 0)}` : "—");

// Un agrégat { n, net, roi, ci } -> cellules du tableau
function AggCells({ agg }) {
  if (!agg || !agg.n) return <><td className="num">—</td><td className="num">—</td><td className="num">—</td></>;
  return (
    <>
      <td className="num">{agg.n}</td>
      <td className="num" title={`Gain net ${eur(agg.net)} pour ${agg.staked} € misés`}>{pc(agg.roi)}</td>
      <td className="num" title="Intervalle de confiance à 95 % (bootstrap) : la fourchette dans laquelle le vrai ROI a 95 chances sur 100 de se trouver.">{ciTxt(agg.ci)}</td>
    </>
  );
}

export default function Rentabilite() {
  const [roi, setRoi] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { getJSON("roi.json").then(setRoi, setErr); }, []);

  if (err) return <p className="error">Impossible de charger l'étude de rentabilité ({String(err.message || err)}).</p>;
  if (!roi) return <p className="loading">Chargement de l'étude…</p>;
  if (!roi.totalMatches) return <p className="empty">Aucun match avec prono et cotes pour l'instant — l'étude se remplira avec les prochains tournois.</p>;

  const { strategies, bands, evSweep, disagreement, byBook } = roi;
  return (
    <main>
      <h1>Rentabilité des pronostics</h1>

      {/* Encart pédagogique : règle « pas de boîte noire » */}
      <section className="card">
        <h2>Comment lire cette page</h2>
        <p>
          On rejoue la saison : <strong>1 € misé</strong> sur chaque prono, aux cotes réelles des
          bookmakers (meilleure cote entre Betclic, Unibet et Winamax). Le <strong>ROI</strong> est le
          gain net rapporté à la mise totale : +5 % = 5 centimes gagnés par euro misé.
        </p>
        <p>
          Deux instants : la cote d'<strong>ouverture</strong> (au lancement du marché) et la cote
          de <strong>clôture</strong> (juste avant le match). La clôture intègre toute l'information
          du marché : un modèle rentable contre la clôture l'est très probablement en vrai.
        </p>
        <p>
          La colonne <strong>IC 95 %</strong> donne la fourchette d'incertitude : si elle contient
          0 %, le résultat peut n'être que de la chance (ou de la malchance).
        </p>
      </section>

      {/* Analyses 1-2 : le tableau par tournoi */}
      <section className="card">
        <h2>Par tournoi</h2>
        <p>
          <strong>Favori</strong> : 1 € sur le camp que notre modèle donne gagnant, à chaque match coté.{" "}
          <strong>Value</strong> : 1 € seulement quand la cote paie plus que notre probabilité
          (EV positive) — c'est le test « bat-on le marché ? ».
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Tournoi</th>
                <th colSpan={3}>Favori — clôture</th>
                <th colSpan={3}>Value — clôture</th>
                <th colSpan={3}>Favori — ouverture</th>
                <th colSpan={3}>Value — ouverture</th>
              </tr>
              <tr>
                {Array.from({ length: 4 }).flatMap((_, i) => [
                  <th key={`n${i}`} className="num">Paris</th>,
                  <th key={`r${i}`} className="num">ROI</th>,
                  <th key={`c${i}`} className="num">IC 95 %</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr className="total">
                <td><strong>Total saison</strong></td>
                <AggCells agg={strategies.favori.global.close} />
                <AggCells agg={strategies.value.global.close} />
                <AggCells agg={strategies.favori.global.open} />
                <AggCells agg={strategies.value.global.open} />
              </tr>
              {strategies.favori.tournois.map((t, i) => {
                const v = strategies.value.tournois.find((x) => x.tmtId === t.tmtId);
                return (
                  <tr key={t.tmtId}>
                    <td>{t.name}</td>
                    <AggCells agg={t.close} />
                    <AggCells agg={v?.close} />
                    <AggCells agg={t.open} />
                    <AggCells agg={v?.open} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Analyse 3 : tranches de confiance */}
      <section className="card">
        <h2>Par tranche de confiance</h2>
        <p>
          Les paris « favori », regroupés par la probabilité annoncée. Répond à : « et si je ne
          pariais que sur les quasi-certitudes ? » (attention, leurs cotes sont très basses).
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Confiance</th><th className="num">Paris</th><th className="num">ROI clôture</th><th className="num">IC 95 %</th><th className="num">Paris</th><th className="num">ROI ouverture</th><th className="num">IC 95 %</th></tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.band}>
                  <td>{b.band} %</td>
                  <AggCells agg={b.close} />
                  <AggCells agg={b.open} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Analyse 4 : balayage du seuil d'EV */}
      <section className="card">
        <h2>Exiger plus de marge : le seuil d'EV</h2>
        <p>
          La stratégie value avec un seuil de plus en plus exigeant : EV &gt; 0 mise dès que la
          cote paie mieux que notre proba ; EV &gt; 0,10 exige 10 centimes d'avantage théorique
          par euro. Plus de marge = moins de paris : le tableau montre si la sélectivité paie.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Seuil</th><th className="num">Paris</th><th className="num">ROI clôture</th><th className="num">IC 95 %</th><th className="num">Paris</th><th className="num">ROI ouverture</th><th className="num">IC 95 %</th></tr>
            </thead>
            <tbody>
              {evSweep.map((e) => (
                <tr key={e.threshold}>
                  <td>EV &gt; {e.threshold.toFixed(2)}</td>
                  <AggCells agg={e.close} />
                  <AggCells agg={e.open} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Analyse 5 : désaccord avec le marché */}
      <section className="card">
        <h2>Quand on contredit le marché</h2>
        <p>
          Paris placés uniquement quand notre favori est l'outsider du bookmaker (cote &gt; 2) :
          peu de paris, grosses cotes — le modèle voit-il des choses que le marché rate ?
        </p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Instant</th><th className="num">Paris</th><th className="num">ROI</th><th className="num">IC 95 %</th></tr></thead>
            <tbody>
              <tr><td>Clôture</td><AggCells agg={disagreement.close} /></tr>
              <tr><td>Ouverture</td><AggCells agg={disagreement.open} /></tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Analyse 6 : quel bookmaker paie le mieux */}
      <section className="card">
        <h2>Quel bookmaker paie le mieux ?</h2>
        <p>
          Chaque stratégie rejouée avec les cotes d'un seul bookmaker. La colonne « panier
          commun » ne garde que les matchs cotés par les trois : c'est la seule comparaison
          équitable (même liste de paris partout). « Tous ses matchs » reflète la réalité d'un
          compte unique chez ce bookmaker.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Bookmaker</th>
                <th colSpan={3}>Favori, clôture — panier commun</th>
                <th colSpan={3}>Favori, clôture — tous ses matchs</th>
              </tr>
              <tr>
                {Array.from({ length: 2 }).flatMap((_, i) => [
                  <th key={`n${i}`} className="num">Paris</th>,
                  <th key={`r${i}`} className="num">ROI</th>,
                  <th key={`c${i}`} className="num">IC 95 %</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {byBook.map((b) => (
                <tr key={b.book}>
                  <td style={{ textTransform: "capitalize" }}>{b.book}</td>
                  <AggCells agg={b.favori.common.close} />
                  <AggCells agg={b.favori.all.close} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
```

Notes d'implémentation :
- Le style inline `textTransform` doit être remplacé par une classe si le design system en a une — décision au moment du skill UI.
- Si `.num`, `.total`, `.error`, `.loading`, `.empty` n'existent pas dans `styles.css`, réutiliser les équivalents du projet (vérifier `Reliability.jsx` / `Sante.jsx`) ou les créer avec les variables CSS existantes.
- Le tableau par tournoi a 13 colonnes : c'est LE cas `.table-scroll` obligatoire (scroll interne, jamais la page).

- [ ] **Step 4 : vérifier en dev**

Run : `cd web && npm run dev:vite` puis ouvrir `http://localhost:5173/#/rentabilite`.
Attendu : la page charge roi.json, le total saison correspond au résumé console de la Task 4, les 6 sections s'affichent, l'entrée de menu « Rentabilité » est active.

- [ ] **Step 5 : commit**

```bash
git add web/src/pages/Rentabilite.jsx web/src/main.jsx web/src/components/Layout.jsx web/src/styles.css
git commit -m "feat(roi): page Rentabilité — 6 analyses avec IC, encarts pédagogiques

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: détail auditable des paris + vérification mobile

**Files:**
- Modify: `web/src/pages/Rentabilite.jsx`, `web/src/styles.css` (si besoin)

**Interfaces:**
- Consumes : `roi.bets` (journal des paris, champ produit en Task 3-4).
- Produces : le détail des paris d'un tournoi, déplié au clic depuis le tableau par tournoi.

- [ ] **Step 1 : dépliage par tournoi**

Dans `Rentabilite.jsx`, ajouter un état `const [openTmt, setOpenTmt] = useState(null);` et rendre la cellule tournoi cliquable (bouton, pas un `td` cliquable nu — accessibilité) :

```jsx
<td>
  <button className="linklike" onClick={() => setOpenTmt(openTmt === t.tmtId ? null : t.tmtId)}
          aria-expanded={openTmt === t.tmtId}>
    {t.name}
  </button>
</td>
```

Sous la ligne du tournoi ouvert, une ligne pleine largeur avec le journal filtré (stratégie favori + value, clôture — l'ouverture au survol via `title`) :

```jsx
{openTmt === t.tmtId && (
  <tr>
    <td colSpan={13}>
      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Match</th><th>Disc.</th><th className="num">Proba</th><th>Stratégie</th><th>Camp misé</th><th className="num">Cote (book)</th><th className="num">Gain</th></tr>
          </thead>
          <tbody>
            {roi.bets
              .filter((b) => b.tmtId === t.tmtId && b.instant === "close" && b.strategy !== "desaccord")
              .map((b, i) => (
                <tr key={i} className={b.won ? "won" : "lost"}>
                  <td>{b.team1} vs {b.team2}</td>
                  <td>{b.disc}</td>
                  <td className="num">{b.side === 1 ? b.prob : 100 - b.prob} %</td>
                  <td>{b.strategy === "value" ? `value (EV ${b.ev >= 0 ? "+" : ""}${b.ev?.toFixed(2)})` : b.strategy}</td>
                  <td>{b.side === 1 ? b.team1 : b.team2}</td>
                  <td className="num">{b.odd.toFixed(2)} ({b.book})</td>
                  <td className="num">{b.gain > 0 ? "+" : ""}{b.gain.toFixed(2)} €</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </td>
  </tr>
)}
```

(Si `.linklike`, `.won`, `.lost` n'existent pas, les créer dans `styles.css` avec les variables — vert/rouge du design system, focus visible.)

- [ ] **Step 2 : vérifier en dev** — dev server, déplier un tournoi : chaque ligne du tableau (paris, gains) doit se recouper avec les agrégats affichés au-dessus.

- [ ] **Step 3 : vérification mobile ~375 px (règle du projet, AVANT de conclure)**

Avec le dev server lancé, capture Playwright :

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 375, height: 812 } });
  await p.goto('http://localhost:5173/#/rentabilite');
  await p.waitForTimeout(2500);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('débordement horizontal de la page (px) :', overflow);
  await p.screenshot({ path: '/tmp/rentabilite-375.png', fullPage: true });
  await b.close();
})();
"
```

Attendu : `débordement horizontal : 0` (les tableaux scrollent DANS `.table-scroll`). Regarder la capture : lisibilité, cibles tactiles ≥ 40 px. Corriger tant que ce n'est pas propre.

- [ ] **Step 4 : build complet** — `cd web && npm run build` : succès sans warning bloquant.

- [ ] **Step 5 : suite de tests racine** — `npm test` (à la racine) : PASS.

- [ ] **Step 6 : commit**

```bash
git add web/src/pages/Rentabilite.jsx web/src/styles.css
git commit -m "feat(roi): détail auditable des paris par tournoi + passe mobile 375px

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Vérification finale (critères de succès du spec)

- [ ] `npm run build-data` produit `roi.json` sans ralentissement notable (le build restait ~au même ordre de grandeur qu'avant).
- [ ] Total saison de la page = résumé console de build-data = agrégats recalculables depuis `bets`.
- [ ] Chaque notion de la page est expliquée en français simple (ROI, EV, clôture, IC).
- [ ] Rendu impeccable à 375 px, zéro débordement horizontal de page.
- [ ] `npm test` vert, tout commité (jamais `web/public/data/`).

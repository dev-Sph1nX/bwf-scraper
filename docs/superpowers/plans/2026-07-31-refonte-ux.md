# Refonte UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Passer de 8 écrans à 3 pages + Coulisses, avec un Accueil « sur quoi parier aujourd'hui ? » : carte de match à deux lignes joueur (drapeau · nom · #mondial · #Elo · prédiction · cotes par opérateur choisi · 📈(n) · EV calibrée), modale d'évolution multi-opérateurs, Classement enrichi, Coulisses pédagogiques.

**Architecture:** Les calculs purs (EV, orientation des cotes vers team1/team2, règle n ≥ 2) vivent dans `lib/` et sont testés en node. `build-data.mjs` enrichit `upcoming-matches.json` (rang Elo, proba calibrée, cotes jointes par match) — l'UI ne calcule rien d'autre que de l'affichage. Les pages React réutilisent le design system existant (`styles.css`, `.card`, `.tabs`, `.range-btn`, `OddsChart`).

**Tech Stack:** Node 22 (ESM, `node --test`), React 18 + Vite, react-router (HashRouter), Playwright pour la vérification visuelle. Aucune dépendance nouvelle.

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-31-refonte-ux-design.md` — la carte suit l'ordre EXACT : drapeau · nom · rang mondial · rang Elo · prédiction · cotes (1 colonne par opérateur sélectionné) · 📈(n) · EV.
- Mobile 375 px : tout tableau large scrolle DANS son conteneur (`.table-scroll`), jamais la page ; cibles tactiles ≥ 40 px ; vérification Playwright obligatoire avant de conclure.
- Couleurs UNIQUEMENT via les variables CSS de `web/src/styles.css` (`--accent` pour texte rouge, `--green`, `--muted`…), Verdana, thème sombre mono-thème.
- 3 états (chargement / vide / données) sur chaque vue ; boutons = `<button>`, navigation = `<Link>`.
- EV = `cote × p − 1` avec p CALIBRÉE (`recalibrate(p, disc)` de `lib/calibrate.mjs`, p ∈ (0,1)) — jamais la proba brute.
- Bouton 📈 actif si n ≥ 2 points traçables toutes courbes confondues ; grisé sinon avec title « Un seul relevé pour l'instant — prochain passage dans moins de 2 h ».
- Textes UI en français, libellé « sous-coté BWF » pour l'écart Elo↔mondial (jamais « value »).
- Commits fréquents, messages français conventionnels, terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `npm test` doit rester vert après chaque tâche (288 tests au départ).

---

### Task 1: lib/ev.mjs — EV et meilleures cotes (pur, testé)

**Files:**
- Create: `lib/ev.mjs`
- Test: `test/ev.test.mjs`

**Interfaces:**
- Produces: `ev(odd, p) -> number|null` ; `bestOdd(booksBySide, side) -> {odd, book}|null` où `booksBySide = {betclic: {odd1, odd2}, ...}` et `side ∈ {1,2}` ; `pointsTotal(books) -> number` (somme des `points.length`).

- [x] **Step 1: Écrire les tests qui échouent**

```js
// test/ev.test.mjs
// Valeur attendue d'un pari et meilleures cotes par camp.
//   node --test test/ev.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ev, bestOdd, pointsTotal } from "../lib/ev.mjs";

test("ev : cote 1,58 à 62 % -> négative ; à 68 % -> positive", () => {
  assert.ok(Math.abs(ev(1.58, 0.62) - (-0.0204)) < 1e-4);
  assert.ok(ev(1.58, 0.68) > 0.07);
});

test("ev : cote absente ou proba absente -> null (jamais 0, qui voudrait dire « équitable »)", () => {
  assert.equal(ev(null, 0.62), null);
  assert.equal(ev(1.58, null), null);
  assert.equal(ev(1, 0.62), null); // cote qui ne paie pas
});

test("bestOdd : la meilleure cote du camp, avec son opérateur", () => {
  const books = { betclic: { odd1: 1.52, odd2: 1.9 }, winamax: { odd1: 1.58, odd2: 1.95 }, unibet: { odd1: null, odd2: 2.0 } };
  assert.deepEqual(bestOdd(books, 1), { odd: 1.58, book: "winamax" });
  assert.deepEqual(bestOdd(books, 2), { odd: 2.0, book: "unibet" });
  assert.equal(bestOdd({}, 1), null);
});

test("pointsTotal : somme des points traçables (règle du bouton graphe : actif si ≥ 2)", () => {
  const books = { betclic: { points: [{}, {}] }, unibet: { points: [{}] }, winamax: {} };
  assert.equal(pointsTotal(books), 3);
  assert.equal(pointsTotal({}), 0);
});
```

- [x] **Step 2: Vérifier l'échec** — `node --test test/ev.test.mjs` → FAIL `Cannot find module '../lib/ev.mjs'`.

- [x] **Step 3: Implémentation minimale**

```js
// lib/ev.mjs
// Valeur attendue d'un pari : EV = cote × p − 1 (p = proba CALIBRÉE, cf. spec).
// EV > 0 : à la longue, ce pari rapporte. La marge du bookmaker (~6-9 %) rend
// presque tout négatif : le rôle de l'écran est de débusquer les exceptions.

/** EV par euro misé ; null si la cote ne paie pas ou si p est inconnue. */
export function ev(odd, p) {
  if (!(odd > 1) || p == null || !Number.isFinite(p)) return null;
  return odd * p - 1;
}

/** Meilleure cote d'un camp parmi les opérateurs. side : 1 ou 2. */
export function bestOdd(books, side) {
  let best = null;
  for (const [book, b] of Object.entries(books || {})) {
    const odd = side === 1 ? b?.odd1 : b?.odd2;
    if (odd > 1 && (!best || odd > best.odd)) best = { odd, book };
  }
  return best;
}

/** Nombre total de points traçables (le bouton graphe s'active à partir de 2). */
export function pointsTotal(books) {
  return Object.values(books || {}).reduce((s, b) => s + (b?.points?.length || 0), 0);
}
```

- [x] **Step 4: Vérifier le vert** — `node --test test/ev.test.mjs` → PASS ; puis `npm test` complet → 0 fail.
- [x] **Step 5: Commit** — `git add lib/ev.mjs test/ev.test.mjs && git commit -m "feat(ev): valeur attendue et meilleure cote par camp (pur, testé)"`

---

### Task 2: lib/home-data.mjs — jonction cotes ↔ match BWF orientée team1/team2 (pur, testé)

**Files:**
- Create: `lib/home-data.mjs`
- Test: `test/home-data.test.mjs`

**Interfaces:**
- Consumes: groupes de `groupBooks` (lib/books-history.mjs) : `{key, books: {op: {odd1, odd2, points, readings}}}` — `odd1/odd2` orientées vers p1 DU GROUPE ; et `swapped` du résultat `matchBooks` (true = p1 du groupe correspond à team2 BWF).
- Produces: `oddsForMatch(group, swapped) -> {bookKey, n, books: {op: {odd1, odd2, points}}}` avec `odd1` = cote de TEAM1 BWF (points réorientés pareil, impliedP1 retourné si swapped).

- [x] **Step 1: Test qui échoue**

```js
// test/home-data.test.mjs
// La carte d'accueil affiche les cotes dans l'ordre BWF (team1 en haut).
//   node --test test/home-data.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { oddsForMatch } from "../lib/home-data.mjs";

const group = {
  key: "73288292",
  books: {
    winamax: { odd1: 1.58, odd2: 2.0, points: [{ at: "t1", odd1: 1.58, odd2: 2.0, impliedP1: 0.55 }] },
    unibet: { odd1: 1.55, odd2: 2.0, points: [] },
  },
};

test("swapped=false : les cotes du groupe sont déjà dans l'ordre BWF", () => {
  const o = oddsForMatch(group, false);
  assert.equal(o.bookKey, "73288292");
  assert.equal(o.books.winamax.odd1, 1.58);
  assert.equal(o.n, 1);
});

test("swapped=true : cotes ET points retournés vers team1 BWF", () => {
  const o = oddsForMatch(group, true);
  assert.equal(o.books.winamax.odd1, 2.0);       // team1 BWF = p2 du groupe
  assert.equal(o.books.winamax.points[0].odd1, 2.0);
  assert.ok(Math.abs(o.books.winamax.points[0].impliedP1 - 0.45) < 1e-9);
});
```

- [x] **Step 2: Vérifier l'échec** — `node --test test/home-data.test.mjs` → FAIL module manquant.

- [x] **Step 3: Implémentation**

```js
// lib/home-data.mjs
// Prépare les cotes d'un groupe bookmakers pour la carte d'accueil :
// tout est réorienté vers team1/team2 BWF (le groupe, lui, est orienté vers
// son propre p1 — `swapped` du rapprochement dit si les deux ordres diffèrent).

const flipPoint = (p) => ({ ...p, odd1: p.odd2, odd2: p.odd1, impliedP1: p.impliedP1 == null ? null : 1 - p.impliedP1 });

export function oddsForMatch(group, swapped) {
  const books = {};
  let n = 0;
  for (const [op, b] of Object.entries(group.books || {})) {
    const points = (b.points || []).map((p) => (swapped ? flipPoint(p) : p));
    n += points.length;
    books[op] = {
      odd1: swapped ? b.odd2 ?? null : b.odd1 ?? null,
      odd2: swapped ? b.odd1 ?? null : b.odd2 ?? null,
      points,
    };
  }
  return { bookKey: group.key, n, books };
}
```

- [x] **Step 4: Vert** — `node --test test/home-data.test.mjs` puis `npm test`.
- [x] **Step 5: Commit** — `git commit -m "feat(home): cotes d'un match réorientées vers team1/team2 BWF (pur, testé)"`

---

### Task 3: build-data — rang Elo, proba calibrée, cotes embarquées dans upcoming-matches.json

**Files:**
- Modify: `build-data.mjs` (fonction `withElo` ~l.273 ; push `oddsCandidates` ~l.418 ; écriture `upcoming-matches.json` ~l.435 À DÉPLACER après la section bookmakers ~l.545+)

**Interfaces:**
- Consumes: `recalibrate(p, disc)` (lib/calibrate.mjs, p ∈ (0,1)) ; `oddsForMatch` (Task 2) ; `res.matched` de `matchBooks` (chaque m : `{group, bwf, swapped}`) ; `ev`/`bestOdd` (Task 1).
- Produces: chaque entrée de `upcoming-matches.json` gagne : `team1.eloRank`/`team2.eloRank` (rang dans le classement Elo de la discipline, null si non classé), `probCal` (proba calibrée team1, entier %, null si prob null), et — si le match est apparié à des cotes — `odds = {bookKey, n, books, ev1, ev2}` où `ev1/ev2` = EV de la MEILLEURE cote de chaque camp (null si probCal null).

- [x] **Step 1: Ajouter `eloRank` dans `withElo`** — l'entité de `eloLookup` est une entrée du classement (elle porte `rank`) :

```js
const withElo = (team, entity) => ({
  ...team,
  elo: entity?.rating ?? null,
  eloRank: entity?.rank ?? null,
  bwfRank: entity?.bwfRank ?? null,
  form: entity?.form ?? null,
});
```

- [x] **Step 2: Proba calibrée à la création du match à venir** — juste après le calcul de `prob` (~l.404), importer `recalibrate` en tête de fichier (`import { recalibrate } from "./lib/calibrate.mjs";`) et pousser :

```js
const probCal = prob == null ? null : Math.round(recalibrate(prob / 100, m.eventName) * 100);
```

et ajouter `probCal` à l'objet poussé dans `upcomingMatches`.

- [x] **Step 3: Relier candidat de cotes → entrée upcoming** — dans le push `oddsCandidates`, ajouter `uIdx: upcomingMatches.length - 1` (le candidat est créé juste après son entrée upcoming, même itération).

- [x] **Step 4: Déplacer l'écriture** — supprimer la ligne `await write("upcoming-matches.json", …)` actuelle (~l.435, garder le `console.log`) ; dans la section bookmakers, APRÈS `const res = matchBooks(...)`, enrichir puis écrire :

```js
// Embarque les cotes appariées dans les matchs à venir : la carte d'accueil
// lit UN seul fichier, orienté team1/team2, avec l'EV déjà calculée.
for (const m of res.matched) {
  const i = m.bwf.uIdx;
  if (i == null || m.bwf.played) continue;
  const u = upcomingMatches[i];
  const o = oddsForMatch(m.group, m.swapped);
  const p1 = u.probCal == null ? null : u.probCal / 100;
  const b1 = bestOdd(o.books, 1), b2 = bestOdd(o.books, 2);
  u.odds = {
    ...o,
    ev1: p1 == null || !b1 ? null : ev(b1.odd, p1),
    ev2: p1 == null || !b2 ? null : ev(b2.odd, 1 - p1),
  };
}
await write("upcoming-matches.json", { generatedAt: ranking.generatedAt, matches: upcomingMatches });
```

avec les imports `import { ev, bestOdd } from "./lib/ev.mjs";` et `import { oddsForMatch } from "./lib/home-data.mjs";`.

- [x] **Step 5: Vérifier sur données réelles** — `node build-data.mjs` puis :

```bash
python3 -c "
import json
u = json.load(open('web/public/data/upcoming-matches.json'))
avec = [m for m in u['matches'] if m.get('odds')]
print('matchs avec cotes embarquées :', len(avec))
m = avec[0] if avec else u['matches'][0]
print('probCal', m.get('probCal'), '| eloRank t1', m['team1'].get('eloRank'), '| odds n', (m.get('odds') or {}).get('n'))
"
```

Attendu : ≥ 1 match avec cotes quand un tournoi est coté (sinon 0 en période creuse — vérifier alors `probCal`/`eloRank` seuls), aucun crash, `npm test` vert.

- [x] **Step 6: Commit** — `git commit -m "feat(build-data): rang Elo, proba calibrée et cotes embarquées dans les matchs à venir"`

---

### Task 4: MultiOddsChart + modale d'évolution

**Files:**
- Create: `web/src/components/MultiOddsChart.jsx`
- Create: `web/src/components/OddsModal.jsx`
- Modify: `web/src/styles.css` (styles `.odds-modal*`)

**Interfaces:**
- Consumes: `series = [{ book, label, points: [{at, lastSeen, odd1, odd2, impliedP1}] }]` (points orientés team1) ; `BOOK_LABEL` local.
- Produces: `<MultiOddsChart series={series} label1={nomJoueur1} label2={nomJoueur2} />` et `<OddsModal open onClose title>` (overlay plein écran, ferme sur ✕, clic fond et touche Échap).

- [x] **Step 1: MultiOddsChart** — adapter `OddsChart.jsx` (copie assumée, le mono-série reste utilisé par les Coulisses) : mêmes constantes viewBox 360×210, mêmes paliers, mais une `<path>` par série avec couleurs `["var(--accent)", "var(--accent-2)", "var(--green)"]` dans l'ordre des séries, légende `.chart-legend` AVANT le graphe (`.chart-leg-swatch` de la couleur de la série + nom opérateur + `(n)`), et un point isolé rendu par un `<circle>` seul. Axe temps commun = min/max de toutes les séries (lastSeen inclus). Pas de tooltip au survol multi-séries (hors périmètre) : le dernier % de chaque série s'affiche dans la légende.

- [x] **Step 2: OddsModal**

```jsx
// web/src/components/OddsModal.jsx
import { useEffect } from "react";

// Modale plein écran du graphe d'évolution (fond cliquable + Échap pour fermer).
export default function OddsModal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="odds-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="odds-modal card" onClick={(e) => e.stopPropagation()}>
        <div className="odds-modal-head">
          <h2>{title}</h2>
          <button type="button" className="range-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

CSS (dans styles.css, section commentée `/* Modale d'évolution des cotes */`) :

```css
.odds-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
.odds-modal { width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; }
.odds-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
```

- [x] **Step 3: Vérifier** — `cd web && npm run build` (compile sans erreur ; l'intégration visuelle se vérifie en Task 5).
- [x] **Step 4: Commit** — `git commit -m "feat(ui): graphe d'évolution multi-opérateurs + modale"`

---

### Task 5: BetCard — la carte de match de la spec

**Files:**
- Create: `web/src/components/BetCard.jsx`
- Modify: `web/src/styles.css` (styles `.bc-*`)

**Interfaces:**
- Consumes: une entrée d'`upcoming-matches.json` enrichie (Task 3) ; `books` = tableau des opérateurs sélectionnés (`["betclic","unibet","winamax"]` filtré) ; `ev`, `bestOdd`, `pointsTotal` recodés côté UI ? NON — l'EV vient précalculée (`odds.ev1/ev2`), la meilleure cote se déduit en comparant les colonnes affichées (max), `n` vient de `odds.n`.
- Produces: `<BetCard match={m} selectedBooks={[...]} />` — carte autonome, ouvre sa propre `OddsModal`.

- [x] **Step 1: Composant** — structure (classes CSS nouvelles préfixées `.bc-`, tableau dans `.table-scroll`) :

```jsx
// web/src/components/BetCard.jsx
import { useState } from "react";
import { Link } from "react-router-dom";
import OddsModal from "./OddsModal.jsx";
import MultiOddsChart from "./MultiOddsChart.jsx";
import { ROUND_LABEL } from "./UpcomingMatch.jsx";

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const fmtOdd = (v) => (v == null ? "—" : v.toFixed(2));
const fmtEv = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} %`);

// Une ligne joueur : drapeau · nom · #mondial · #Elo · prédiction · cotes · EV.
function PlayerRow({ team, prob, odds, side, selected, best }) {
  const players = team?.players || [];
  const fiche = players.length === 1 ? `/player/${players[0].id}` : `/pair/${players.map((p) => p.id).sort().join("-")}`;
  const evVal = side === 1 ? odds?.ev1 : odds?.ev2;
  return (
    <tr>
      <td>{players.map((p, i) => p.countryFlagUrl ? <img key={i} className="um-flag" src={p.countryFlagUrl} alt="" /> : null)}</td>
      <td className="bc-name"><Link to={fiche}>{players.map((p) => p.nameDisplay).join(" / ")}</Link></td>
      <td className="oa-num">{team.bwfRank ? `#${team.bwfRank}` : "—"}</td>
      <td className="oa-num">{team.eloRank ? `#${team.eloRank}` : "—"}</td>
      <td className={`bc-proba${prob != null && prob >= 50 ? "" : " dim"}`}>{prob == null ? "—" : `${prob} %`}</td>
      {selected.map((op) => {
        const odd = side === 1 ? odds?.books?.[op]?.odd1 : odds?.books?.[op]?.odd2;
        return <td key={op} className={`oa-num${odd != null && odd === best ? " ba-best" : ""}`}>{fmtOdd(odd)}</td>;
      })}
      <td>
        {/* UN bouton graphe PAR LIGNE JOUEUR (maquette B validée) : la modale
            trace la proba implicite de CE joueur, une courbe par opérateur. */}
        <button type="button" className="range-btn" disabled={n < 2}
                title={n < 2 ? "Un seul relevé pour l'instant — prochain passage dans moins de 2 h" : "Évolution des cotes"}
                onClick={onGraph}>📈 ({n})</button>
      </td>
      <td>{evVal == null ? <span className="bc-ev dim">—</span> : <span className={`bc-ev${evVal > 0 ? " pos" : ""}`}>{fmtEv(evVal)}</span>}</td>
    </tr>
  );
}
```

`PlayerRow` reçoit donc aussi `n` (= `match.odds?.n ?? 0`) et `onGraph` (= `() => setGraphe(side)`).

puis le corps de `BetCard` : en-tête `.oa-head` réutilisé (badge discipline, `ROUND_LABEL`, `<Link to={`/tournament/${m.tmtId}`}>` sur le nom du tournoi, heure locale) ; `<table className="ligne">` dans `.table-scroll` avec `<thead>` (Joueur/Mondial/Elo/Préd./colonnes opérateurs sélectionnés/EV) et les deux `PlayerRow` (`prob = m.probCal`, `100 − m.probCal`) ; sous le tableau, la ligne « pourquoi » :

```jsx
const gap = m.team1.elo != null && m.team2.elo != null ? Math.abs(m.team1.elo - m.team2.elo) : null;
<p className="bc-pourquoi">
  {gap != null && <> <b>{m.team1.elo >= m.team2.elo ? m.team1.players[0]?.nameDisplay : m.team2.players[0]?.nameDisplay}</b> a +{gap} points d'Elo</>}
  {m.probCal != null && <> · proba calibrée sur 8 800 matchs ✓</>}
  {m.tags?.includes("value") && <> · <b>sous-coté BWF</b></>}
</p>
```

et la modale (état `graphe` = null | 1 | 2 : la ligne cliquée oriente le graphe
vers CE joueur — pour la ligne 2, les points sont retournés) :

```jsx
const [graphe, setGraphe] = useState(null); // null | 1 | 2
const flip = (p) => ({ ...p, odd1: p.odd2, odd2: p.odd1, impliedP1: p.impliedP1 == null ? null : 1 - p.impliedP1 });
const nomDe = (side) => (side === 1 ? m.team1 : m.team2).players.map((p) => p.nameDisplay).join(" / ");
{graphe != null && (
  <OddsModal open onClose={() => setGraphe(null)} title={`Évolution — ${nomDe(graphe)}`}>
    <MultiOddsChart
      series={selected.filter((op) => m.odds?.books?.[op]?.points?.length)
        .map((op) => ({
          book: op, label: BOOK_LABEL[op],
          points: graphe === 1 ? m.odds.books[op].points : m.odds.books[op].points.map(flip),
        }))}
      label1={nomDe(graphe)}
      label2={nomDe(graphe === 1 ? 2 : 1)}
    />
  </OddsModal>
)}
```

CSS `.bc-*` : `.bc-name a { color: var(--ink); font-weight: bold; }`, `.bc-proba { color: var(--accent); font-weight: bold; font-size: 14px; }`, `.bc-proba.dim { color: var(--muted); }`, `.bc-ev { background: var(--surface-2); color: var(--muted); border-radius: 5px; padding: 2px 7px; font-weight: bold; }`, `.bc-ev.pos { background: rgba(53,196,139,.15); color: var(--green); }`, `.bc-pourquoi { color: var(--muted); font-size: 11px; margin: 8px 0 0; border-top: 1px dashed var(--line); padding-top: 8px; }`.

- [x] **Step 2: Build** — `cd web && npm run build` sans erreur.
- [x] **Step 3: Commit** — `git commit -m "feat(ui): BetCard — carte de match à deux lignes joueur (spec refonte)"`

---

### Task 6: Accueil — sélecteur de bookmakers + trois sections

**Files:**
- Create: `web/src/pages/Home.jsx`
- Modify: `web/src/main.jsx` (route `/` → `Home`)
- Delete: `web/src/pages/Upcoming.jsx` (après bascule ; `ROUND_LABEL` vit dans UpcomingMatch.jsx qui RESTE — utilisé par Tournament.jsx)

**Interfaces:**
- Consumes: `upcoming-matches.json` (Task 3), `localStorage["books-selected"]` (JSON array), `BetCard` (Task 5).
- Produces: page par défaut de l'app.

- [x] **Step 1: Page**

```jsx
// web/src/pages/Home.jsx — « Sur quoi parier aujourd'hui ? »
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";
import BetCard from "../components/BetCard.jsx";
import UpcomingMatch from "../components/UpcomingMatch.jsx";

const BOOKS = ["betclic", "unibet", "winamax"];
const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const lireSelection = () => {
  try { const v = JSON.parse(localStorage.getItem("books-selected")); return Array.isArray(v) && v.length ? v.filter((b) => BOOKS.includes(b)) : BOOKS; }
  catch { return BOOKS; }
};

export default function Home() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(lireSelection);

  useEffect(() => { setTitle("Sur quoi parier aujourd'hui ?"); }, [setTitle]);
  useEffect(() => { getJSON("upcoming-matches.json").then(setData).catch(() => setData(false)); }, []);
  useEffect(() => { localStorage.setItem("books-selected", JSON.stringify(selected)); }, [selected]);

  const toggle = (b) => setSelected((s) => (s.includes(b) ? (s.length > 1 ? s.filter((x) => x !== b) : s) : [...s, b]));

  const { cotes, autres } = useMemo(() => {
    const ms = data?.matches || [];
    const heure = (m) => m.odds?.books && Object.values(m.odds.books)[0]?.points?.[0]?.at || m.startDate || "";
    const cotes = ms.filter((m) => m.odds).sort((a, b) => String(heure(a)).localeCompare(String(heure(b))));
    const autres = ms.filter((m) => !m.odds);
    return { cotes, autres };
  }, [data]);

  if (data === false) return <div className="card muted">Données indisponibles. Lance <code>npm run build-data</code>.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  return (
    <>
      <div className="tabs">
        {BOOKS.map((b) => (
          <button key={b} type="button" className={`tab${selected.includes(b) ? " active" : ""}`}
                  aria-pressed={selected.includes(b)} onClick={() => toggle(b)}>
            {BOOK_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="card">
        <h2>Matchs cotés — {cotes.length}</h2>
        {cotes.length === 0
          ? <p className="muted">Aucun match coté pour l'instant — prochain relevé dans moins de 2 h.</p>
          : cotes.map((m) => <BetCard key={`${m.tmtId}|${m.a}|${m.b}`} match={m} selectedBooks={selected} />)}
      </div>

      {autres.length > 0 && (
        <details className="card">
          <summary><h2 style={{ display: "inline" }}>Autres matchs à venir — {autres.length}</h2></summary>
          {autres.map((m, i) => <UpcomingMatch key={i} match={m} />)}
        </details>
      )}
    </>
  );
}
```

La prop d'`UpcomingMatch` est `m` (vérifié : `export default function UpcomingMatch({ m, detailed })`) — écrire `<UpcomingMatch key={i} m={m} />`. Le tri par heure des cotés utilise l'heure du premier relevé faute d'heure BWF (91 % absents) ; quand `matchTime` existera côté BWF il primera — laisser un commentaire le disant.

- [x] **Step 2: Route** — dans `main.jsx` : `import Home from "./pages/Home.jsx";` et `<Route path="/" element={<Home />} />` ; supprimer l'import `Upcoming`.
- [x] **Step 3: Vérifier en local** — `node build-data.mjs && cd web && npm run build && npx vite preview --port 4180 &`, Playwright : ouvrir `/#/`, vérifier 0 débordement à 375 px, chips cliquables (colonnes qui apparaissent/disparaissent), modale 📈 qui s'ouvre sur un match à n ≥ 2, capture d'écran à lire.
- [x] **Step 4: Supprimer `Upcoming.jsx`**, re-build, re-tester.
- [x] **Step 5: Commit** — `git commit -m "feat(ui): Accueil « sur quoi parier aujourd'hui ? » (chips bookmakers, cartes, modale)"`

---

### Task 7: Classement enrichi (remplace Dashboard)

**Files:**
- Create: `web/src/pages/Ranking.jsx`
- Modify: `web/src/main.jsx` (route `/classement` → `Ranking`)
- Delete: `web/src/pages/Dashboard.jsx`

**Interfaces:**
- Consumes: `elo/ranking.json` → `disciplines[disc].entities[]` : `{rank, key, name, country, players[{id, slug, flag}], rating, bwfRank, form, provisional, matches}`.
- Produces: page Classement (onglets disciplines, tri Elo/progression, colonne « sous-coté BWF »).

- [x] **Step 1: Page** — onglets `.tabs` MS/WS/MD/WD/XD ; tableau `.table-scroll` : `# | Joueur/Paire (Link fiche) | Elo | # mondial | sous-coté BWF | Progression`. `sous-coté BWF = bwfRank − rank` (positif = le mondial le sous-estime ; « — » si bwfRank null). Tri : boutons `.range-btn` « Par Elo » (défaut, ordre `rank`) / « Par progression » (tri `form` décroissant, null en dernier). Sous le tableau : `<p className="hint">La progression (variation d'Elo sur les 5 derniers matchs) est un outil de découverte, pas un pronostic : mesurée, elle ne prédit pas le vainqueur (journal §2.1).</p>`. Masquer les entités `provisional` derrière un toggle « inclure les Elo provisoires ». Trois états gérés comme dans Home.
- [x] **Step 2: Route + suppression Dashboard** — remplacer l'élément de la route `/classement` ; supprimer `Dashboard.jsx` et son import. Chercher les liens internes : `grep -rn '"/classement"' web/src` → ils continuent de marcher (même chemin).
- [x] **Step 3: Vérifier** — build + Playwright 375 px (`/#/classement`) : onglets, tri, aucun débordement ; capture lue.
- [x] **Step 4: Commit** — `git commit -m "feat(ui): Classement enrichi (sous-coté BWF, tri progression) — remplace Dashboard"`

---

### Task 8: Coulisses — une page pédagogique qui absorbe 5 écrans

**Files:**
- Create: `web/src/pages/Coulisses.jsx`
- Modify: `web/src/pages/Reliability.jsx`, `Predictor.jsx`, `Data.jsx`, `Changelog.jsx` (retirer `useOutletContext`/`setTitle`, export inchangé)
- Modify: `web/src/components/BooksAudit.jsx` (déjà sans setTitle — rien à faire, vérifier)
- Delete: `web/src/pages/Odds.jsx`

**Interfaces:**
- Consumes: les 5 composants existants, montés à la demande.
- Produces: `/coulisses`, sections dépliables ; anciennes routes redirigées (Task 9).

- [x] **Step 1: Neutraliser setTitle** — dans Reliability/Predictor/Data/Changelog : supprimer `const { setTitle } = useOutletContext();`, le `useEffect` de titre et l'import `useOutletContext` (garder le reste intact).
- [x] **Step 2: Page Coulisses** — accordéon maison (`<button>` ≥ 40 px, montage à l'ouverture) :

```jsx
// web/src/pages/Coulisses.jsx — « est-ce que ça marche ? », expliqué pour humains.
import { useEffect, useState, lazy, Suspense } from "react";
import { useOutletContext } from "react-router-dom";
const Reliability = lazy(() => import("./Reliability.jsx"));
const BooksAudit = lazy(() => import("../components/BooksAudit.jsx"));
const Predictor = lazy(() => import("./Predictor.jsx"));
const Data = lazy(() => import("./Data.jsx"));
const Changelog = lazy(() => import("./Changelog.jsx"));

const SECTIONS = [
  { key: "modele", titre: "Le modèle est-il bon ?", resume:
    "Oui, mesuré : il désigne le bon vainqueur 71,8 % du temps sur 13 700 matchs rejoués, mieux que le classement mondial (68,7 %). Et quand il annonce 70 %, ça se réalise ~70 % du temps depuis la correction de calibration.", C: Reliability },
  { key: "cotes", titre: "D'où viennent les cotes ?", resume:
    "Relevées toutes les 2 h chez Betclic, Unibet et Winamax (avant match seulement), historisées sans jamais rien réécrire, puis rapprochées de nos matchs. Cette section montre les relevés, l'évolution de chaque cote et les rapprochements douteux.", C: BooksAudit },
  { key: "duel", titre: "Simuler un duel", resume:
    "Choisis deux joueurs, le modèle donne sa probabilité — utile pour une finale hypothétique.", C: Predictor },
  { key: "donnees", titre: "Les données", resume:
    "Ce qu'on a téléchargé : tournois, matchs, classements, et leur fraîcheur.", C: Data },
  { key: "versions", titre: "Notes de version", resume: "Ce qui a changé dans l'app, au fil des jours.", C: Changelog },
];

export default function Coulisses() {
  const { setTitle } = useOutletContext();
  const [open, setOpen] = useState(null);
  useEffect(() => { setTitle("Coulisses"); }, [setTitle]);
  return (
    <>
      <div className="card">
        <p className="lead">Tout ce qui permet de vérifier que l'outil dit vrai : chaque section commence par la
        réponse en une phrase, et se déplie pour montrer les preuves.</p>
      </div>
      {SECTIONS.map(({ key, titre, resume, C }) => (
        <div className="card" key={key}>
          <button type="button" className="coulisse-head" aria-expanded={open === key}
                  onClick={() => setOpen(open === key ? null : key)}>
            <h2>{titre}</h2><span className="coulisse-chevron">{open === key ? "▴" : "▾"}</span>
          </button>
          <p className="lead">{resume}</p>
          {open === key && <Suspense fallback={<p className="muted">Chargement…</p>}><C /></Suspense>}
        </div>
      ))}
    </>
  );
}
```

CSS : `.coulisse-head { display: flex; width: 100%; justify-content: space-between; align-items: center; background: none; border: 0; color: var(--ink); font: inherit; cursor: pointer; min-height: 40px; padding: 0; } .coulisse-chevron { color: var(--muted); }`.

- [x] **Step 3: Réécrire les 2 leads les plus jargonneux** — dans `Reliability.jsx`, remplacer le premier paragraphe d'intro par un texte qui définit chaque terme à la première utilisation (réussite, calibration, Brier expliqué comme « distance entre l'annonce et la réalité, plus bas = mieux ») ; dans `BooksAudit.jsx`, le lead « Comment lire cette page » définit déjà marge/jointure — vérifier qu'aucun terme (drift, overround, srId) n'apparaît sans sa définition française à l'écran, corriger sinon.
- [x] **Step 4: Vérifier** — build + Playwright `/#/coulisses` : chaque section s'ouvre et charge son contenu, 375 px sans débordement.
- [x] **Step 5: Commit** — `git commit -m "feat(ui): page Coulisses — fiabilité, cotes, duel, données, versions, expliqués"`

---

### Task 9: Navigation 3+1 et redirections

**Files:**
- Modify: `web/src/components/Layout.jsx` (nav ~l.50-57)
- Modify: `web/src/main.jsx` (routes)

**Interfaces:**
- Produces: nav `Accueil · Tournois · Classement` + lien discret `Coulisses` ; anciennes URL (`/odds`, `/fiabilite`, `/predictor`, `/data`, `/changelog`) redirigées vers `/coulisses`.

- [x] **Step 1: Nav** — remplacer les 8 `NavLink` par :

```jsx
<NavLink to="/" end>Accueil</NavLink>
<NavLink to="/tournaments">Tournois</NavLink>
<NavLink to="/classement">Classement</NavLink>
<NavLink to="/coulisses" className="nav-coulisses">Coulisses</NavLink>
```

CSS : `.nav-coulisses { margin-top: auto; font-size: 12px; color: var(--muted); }` (en bas de sidebar ; < 700 px la barre horizontale le garde en dernier). Vérifier la structure flex de la sidebar pour que `margin-top:auto` fonctionne (sinon classe `.nav-sep` avec marge fixe).

- [x] **Step 2: Routes** — `import { Navigate } from "react-router-dom";` puis :

```jsx
<Route path="/coulisses" element={<Coulisses />} />
{["/odds", "/fiabilite", "/predictor", "/data", "/changelog"].map((p) => (
  <Route key={p} path={p} element={<Navigate to="/coulisses" replace />} />
))}
```

et supprimer les imports des pages retirées (`Odds`, `Reliability`… restent importées UNIQUEMENT par Coulisses via lazy).

- [x] **Step 3: Chasse aux liens morts** — `grep -rn '"/odds"\|"/fiabilite"\|"/predictor"\|"/data"\|"/changelog"' web/src` : remplacer chaque `<Link>` interne par `/coulisses` (ou supprimer si redondant).
- [x] **Step 4: Vérifier + commit** — build, Playwright : nav 4 entrées, anciennes URL redirigent ; `git commit -m "feat(ui): navigation 3 pages + Coulisses, redirections des anciennes URL"`

---

### Task 10: Vérification finale, docs et livraison

**Files:**
- Modify: `docs/roadmap-outil-de-pari.md` (lot A absorbé → Fait), `docs/superpowers/plans/2026-07-31-refonte-ux.md` (cases cochées)

- [x] **Step 1: Suite complète** — `npm test` (≥ 292 tests, 0 fail), `node build-data.mjs`, `cd web && npm run build`.
- [x] **Step 2: Tour Playwright complet** — 375 px ET 1280 px sur `/#/`, `/#/tournaments`, `/#/classement`, `/#/coulisses` (chaque section ouverte une fois) : `scrollWidth − clientWidth === 0` partout, captures LUES (pas seulement prises). Ouvrir une modale 📈 et la fermer à l'Échap.
- [x] **Step 3: Critères de la spec** — relire la section « Critères de succès » de la spec un par un et vérifier chacun explicitement.
- [x] **Step 4: Roadmap** — dans `docs/roadmap-outil-de-pari.md`, déplacer « Lot A — EV sur les écrans » dans le tableau Fait avec renvoi à cette refonte ; le lot B devient le prochain.
- [ ] **Step 5: Commit final + push** — `git add -A -- ':!docs/notes-idees.md'` (le carnet reste local), commit `feat(ux): refonte — 3 pages + coulisses, accueil de pari avec EV`, `git pull --rebase origin main && git push origin main`, surveiller le run GitHub Actions jusqu'au vert et vérifier la page publiée.

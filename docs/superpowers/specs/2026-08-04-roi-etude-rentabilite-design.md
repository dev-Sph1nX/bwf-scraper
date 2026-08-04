# Étude de rentabilité (ROI) des pronostics — design

Date : 2026-08-04 · Statut : validé (brainstorming avec Lucas)

## Contexte et objectif

Le backfill Flashscore (saison 2026) a joint des cotes aux matchs joués :
**1398 matchs disposent à la fois d'un prono et de cotes** (ouverture + clôture,
par bookmaker parmi Betclic/Unibet/Winamax), répartis sur 19 tournois.

Les probas des pronos sont **honnêtes** : figées pendant le rejeu de l'Elo avec
l'état des connaissances d'avant chaque match (modèle « Elo recalibré », même
règle d'abstention que le prédicteur — aucun prono si un camp est provisoire).

Objectif : mesurer si suivre les pronos aurait été **rentable** en misant chez
les bookmakers, tournoi par tournoi et en global, selon plusieurs stratégies de
mise. C'est la brique « preuve » de l'outil d'aide au pari.

## Règles de simulation communes

- **Mise plate : 1 € par pari.** Mesure standard pour juger un modèle.
  Kelly (mise proportionnelle à l'avantage) : hors périmètre, plus tard si le
  flat est positif.
- **Meilleure cote** : pour un camp et un instant donnés, max des cotes
  disponibles parmi les 3 bookmakers. Calculée séparément à l'**ouverture**
  (`open1`/`open2`) et à la **clôture** (`odd1`/`odd2`) → chaque stratégie a
  2 variantes.
- **Gain d'un pari** : `cote − 1` si le camp misé gagne, `−1` sinon.
  ROI = gain net / mise totale.
- **Exclusions** : forfaits (jamais pronostiqués), matchs sans prono (Elo
  provisoire), camps sans cote à l'instant considéré (les couples ouverture et
  clôture se traitent indépendamment : un match peut compter à la clôture et
  pas à l'ouverture).
- **Incertitude** : intervalle de confiance à 95 % sur le ROI par bootstrap
  (rééchantillonnage des paris, graine fixe, même esprit que `backtest.mjs`).
  Indispensable : 30 à 120 paris par tournoi, c'est bruité.

## Les 5 analyses

| # | Analyse | Règle de mise | Granularité |
|---|---------|---------------|-------------|
| 1 | **Favori** | 1 € sur notre pick (proba ≥ 50 %) à chaque match coté | par tournoi + global |
| 2 | **Value EV+** | pour *chaque camp* : si `proba × meilleure cote > 1`, 1 € dessus (0, 1 ou rarement 2 paris par match) | par tournoi + global |
| 3 | **Tranches de confiance** | paris « favori » regroupés par proba du pick : 50–60, 60–70, 70–80, 80–90, 90–100 % | global saison |
| 4 | **Balayage du seuil EV** | value betting avec seuil variable : EV > 1,00 / 1,05 / 1,10 / 1,15 / 1,20 — ROI et volume de chacun | global saison |
| 5 | **Désaccord bookmaker** | 1 € sur notre favori uniquement quand le marché le donne outsider (sa meilleure cote > 2) | global saison |

Les analyses 3–5 restent globales : par tranche ET par tournoi, les effectifs
seraient minuscules (bruit pur).

Hors périmètre (différé) : Kelly, découpage par discipline, cote moyenne au
lieu de la meilleure, simulation mono-bookmaker. Exclu définitivement :
placement automatique des paris (CGU).

## Architecture

- **`lib/roi.mjs`** — module **pur** (aucune E/S) : sélection de la meilleure
  cote, décision de mise de chaque stratégie, accumulation des agrégats,
  bootstrap. Entrée : les entrées de match des pronos (proba, pick, vainqueur,
  cotes jointes). Sortie : l'objet `roi.json`.
- **Branchement dans `build-data.mjs`** — à l'endroit où les `pronos/<tmtId>.json`
  sont écrits (section 5b), tout est déjà en mémoire (pronosByTmt + cotes
  jointes). On appelle `lib/roi.mjs` et on écrit `web/public/data/roi.json`
  à côté de `backtest.json`. Le nom du tournoi vient du calendrier déjà chargé.
- **Page web « Rentabilité »** — nouvelle page du site (menu), construite en
  passant par le skill `ui-ux-pro-max-skill` (variables CSS, mobile 375 px,
  3 états, accessibilité).

## Format de `web/public/data/roi.json`

```jsonc
{
  "generatedAt": "…",
  "totalMatches": 1398,          // matchs prono + cotes
  "strategies": {                 // analyses 1 et 2
    "favori":  { "global": {…}, "tournois": [ { "tmtId", "name", "open": {…}, "close": {…} } ] },
    "value":   { … même forme … }
  },
  "bands":    [ { "band": "90-100", "open": {…}, "close": {…} } ],   // analyse 3
  "evSweep":  [ { "threshold": 1.05, "open": {…}, "close": {…} } ],  // analyse 4
  "disagreement": { "open": {…}, "close": {…} },                     // analyse 5
  "bets": [ /* détail auditable de chaque pari : tmtId, disc, camps, proba,
               stratégie(s), instant, cote prise + bookmaker, résultat, gain */ ]
}
```

Chaque agrégat `{…}` = `{ n, staked, net, roi, ci: [lo, hi], won }`.
Le détail `bets` rend chaque ligne du tableau auditable depuis l'interface —
pas de boîte noire.

## Page web (grandes lignes, affinées à l'implémentation)

- Encart pédagogique : définitions (ROI, EV+, cote de clôture = juge de paix,
  pourquoi l'intervalle de confiance), rappel mise plate 1 €.
- Tableau par tournoi (stratégies 1–2, ouverture/clôture), ligne Total en tête.
- Sections globales : tranches de confiance, balayage du seuil, désaccord.
- Détail des paris d'un tournoi au clic (audit).
- Mobile : tableaux dans `.table-scroll`, vérif rendu ~375 px.

## Tests (TDD sur `lib/roi.mjs`)

- Meilleure cote : 3 bookmakers, bookmakers partiels (cote d'un seul camp),
  aucun bookmaker, ouverture présente sans clôture et inversement.
- Stratégie favori : gain/perte, match sans cote du pick ignoré.
- Value EV+ : mise sur l'outsider, cas 2 paris sur le même match, cas 0 pari.
- Tranches : bornes (50 % → tranche 50–60 ; 100 % → 90–100).
- Balayage : monotonie du volume (plus le seuil monte, moins de paris).
- Désaccord : déclenchement uniquement si cote du favori > 2.
- Bootstrap : reproductible à graine fixe ; IC contient le ROI ponctuel.
- Agrégats : somme des tournois = global (pour une même stratégie/instant).

## Critères de succès

- `npm run build-data` produit `roi.json` sans ralentissement notable.
- Chaque chiffre affiché est traçable jusqu'aux paris individuels.
- La page explique chaque notion en français simple (règle « pas de boîte
  noire ») et tourne impeccablement à 375 px.

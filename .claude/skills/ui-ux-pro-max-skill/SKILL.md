---
name: ui-ux-pro-max-skill
description: >-
  À utiliser AVANT toute création ou modification d'interface dans ce projet
  (composants React, pages, CSS, layout, couleurs, typographie, états de
  chargement/erreur, responsive, accessibilité). Fournit le design system du
  projet et une check-list UI/UX à respecter. Déclencheurs : "UI", "UX",
  "design", "page", "composant", "style", "CSS", "affichage", "mise en page",
  "responsive", "accessibilité", "couleur", "bouton", "tableau", "carte".
---

# UI/UX Pro Max — guide du projet BWF

Objectif : produire une interface **cohérente, lisible, accessible et responsive**,
fidèle à la direction artistique BWF. Applique ce guide à chaque modification d'UI,
puis vérifie avec la check-list finale.

## 1. Design system (source de vérité)

Toutes les valeurs vivent dans `web/src/styles.css` (variables `:root`). **Ne jamais
coder une couleur en dur** dans un composant : utiliser les variables.

**L'app est en THÈME SOMBRE, mono-thème.** Il n'y a pas de thème clair à gérer, et
aucun `prefers-color-scheme` dans le CSS. Un fond clair ou un texte foncé en dur
serait illisible.

Couleurs, telles que définies dans `styles.css` :

| Variable | Valeur | Usage |
|---|---|---|
| `--bwf-red` | `#e4002b` | aplats de marque : boutons, onglet actif, remplissage de barre |
| `--bwf-red-dark` | `#b3001f` | survol des éléments rouges |
| `--accent` | `#ff4d63` | **rouge clair, pour le TEXTE et les traits** sur fond sombre (Elo, liens, 1ʳᵉ série de graphe). `--bwf-red` en texte manque de contraste sur `--surface` |
| `--accent-2` | `#4aa3ff` | **2ᵉ série de graphe** (comparaison, rang mondial) |
| `--bwf-red-soft` | `rgba(228,0,43,.14)` | survol de ligne, surbrillance teintée |
| `--bg` | `#161719` | fond de page |
| `--surface` | `#202126` | cartes |
| `--surface-2` | `#2a2b31` | survol de ligne, champs, fonds de piste de barre |
| `--line` | `#34353c` | bordures, séparateurs, lignes de grille |
| `--ink` | `#f0f0f1` | texte principal (clair) |
| `--muted` | `#9a9ba2` | texte secondaire, graduations d'axe |
| `--green` | `#35c48b` | statut positif (forme en hausse). Le rouge = marque, **pas** « erreur » |
| `--white` | `#ffffff` | texte sur aplat rouge |

Typographie : **Verdana** partout (imposée sur `:root`). Tailles : titres de page
16px bold, H2 16px, corps 13–14px, notes et graduations 12px. Ne pas multiplier
les tailles.

Espacement : multiples de ~4px. Cartes `padding: 18px`, `border-radius: 10px`,
marge basse 20px. Rester régulier.

**Contraste vérifié :** `--accent-2` sur `--surface` = 6,1:1 (AA ✅).

## 2. Principes non négociables

- **Hiérarchie claire** : une seule idée dominante par écran ; le rouge attire l'œil,
  ne pas le disperser partout (sinon plus rien ne ressort).
- **Cohérence** : réutiliser les classes existantes (`.card`, `.stat`, `.badge`,
  `.tab`, `.primary`, `.bracket-*`) plutôt que de réinventer.
- **États systématiques** : chaque vue qui charge des données gère **3 états** —
  chargement (« Chargement… »), vide (« Aucune donnée »), et données. Jamais d'écran
  blanc muet.
- **Feedback** : toute action (clic, filtre) doit produire un retour visible immédiat.
- **Densité maîtrisée** : préférer l'espace et le regroupement à l'entassement.

## 3. Accessibilité (à respecter)

- **Contraste** : texte sur fond doit passer AA (≥ 4.5:1). Le blanc sur `--bwf-red`
  passe ; `--muted` sur `--surface` reste lisible pour du secondaire, jamais pour
  l'info clé. Pour du texte rouge, utiliser `--accent` et non `--bwf-red`.
- **Images** : toujours un `alt` (vide `alt=""` si décoratif, ex. drapeaux).
- **Sémantique** : `<button>` pour une action, `<a>`/`<Link>` pour naviguer. Jamais un
  `<div>` cliquable.
- **Focus clavier** : ne pas supprimer l'outline sans en fournir un visible.
- **Cibles tactiles** : ≥ 40px de haut pour les éléments cliquables.

## 4. Responsive

- Layout en flex ; la sidebar bascule en barre horizontale < 700px (déjà géré).
- Tout contenu large (bracket, grands tableaux) doit scroller **dans son conteneur** :
  envelopper dans `<div className="table-scroll">`, jamais faire déborder la page.
- Les grilles multi-colonnes (`.vs-grid`, `.h2h-grid`, `.form-blocks`) repassent en
  1 colonne sous 700px — c'est déjà dans le CSS, ne pas le refaire.
- **Vérifier à ~375px**, idéalement par capture Playwright, pas seulement mentalement.
- **Piège connu des SVG** : le `viewBox` est mis à l'échelle, donc un `font-size="12"`
  dans un `viewBox` de 720 unités rendu sur 305px s'affiche à **5px** — illisible.
  Pour un graphe destiné au mobile, garder un `viewBox` étroit (~460 unités) ou
  agrandir les tailles de texte en conséquence. `EloChart` et `EloCompareChart`
  souffrent de ce défaut (viewBox 720), non corrigé à ce jour.

## 5. Patterns du projet (réutiliser tels quels)

- **Page type** : `useOutletContext().setTitle("…")` au montage → titre dans la topbar.
- **Chargement de données** : `getJSON("fichier.json").then(setX).catch(() => setX(false))`,
  puis `if (x === false) …indisponible / if (!x) …Chargement…` — c'est le motif des
  3 états utilisé par toutes les pages.
- **Carte** : `<div className="card"><h2>Titre</h2>…</div>`.
- **Stat** : `.stats > .stat > .stat-value + .stat-label`.
- **Statut** : `.badge` + classe d'état (`post`/`live`/`future`).
- **Tableau** : `<table>` avec `<thead>`, enveloppé dans `.table-scroll`.
- **Barres comparatives** : `.bars > .bar-row > .bar-label + .bar-track > .bar-fill + .bar-val`.
- **Variation chiffrée** : `.form` + `up`/`down`/`flat` (vert / rouge / neutre).
- **Texte explicatif** : `.lead` sous un titre, `.hint` pour une note secondaire.
- **Graphe** : `.chart > .chart-legend + .chart-plot`. La légende va **avant** le
  graphe (`.chart-legend` porte un `margin-bottom`), avec
  `.chart-leg > .chart-leg-swatch + .chart-leg-name`.
- **Bracket** : composant `Bracket` — ne pas dupliquer sa logique.

## 6. Check-list avant de livrer une UI

1. Couleurs = variables CSS, aucune valeur en dur ?
2. Verdana + tailles/espacements cohérents avec l'existant ?
3. Les 3 états (chargement / vide / données) sont gérés ?
4. Contraste AA, `alt` sur images, bons éléments sémantiques, focus visible ?
5. Responsive OK (sidebar mobile, contenu large qui scrolle, pas de débordement) ?
6. Réutilise les classes/composants existants plutôt que d'en créer d'autres ?
7. Le rouge reste un accent (pas envahissant) et guide bien l'œil ?

Si un point ne passe pas, corrige avant de conclure.

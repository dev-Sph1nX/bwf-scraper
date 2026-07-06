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
fidèle à la direction artistique BWF (rouge & blanc). Applique ce guide à chaque
modification d'UI, puis vérifie avec la check-list finale.

## 1. Design system (source de vérité)

Toutes les valeurs vivent dans `web/src/styles.css` (variables `:root`). **Ne jamais
coder une couleur en dur** dans un composant : utiliser les variables.

Couleurs :
- `--bwf-red #e4002b` : couleur de marque → accents, en-têtes, éléments actifs, gagnant.
- `--bwf-red-dark #b3001f` : survol des éléments rouges.
- `--bwf-red-soft #ffe5ea` : survol de ligne, fonds légers.
- `--ink #1a1a1a` : texte principal.
- `--muted #7a7a7a` : texte secondaire.
- `--line #ececec` : bordures/séparateurs.
- `--bg #f5f5f6` : fond de page. `--white #fff` : cartes.
- `--green #1e9e6a` : statut positif uniquement (point vainqueur). Rouge = marque, PAS « erreur ».

Typographie : **Verdana** partout (charte). Tailles : titres de page 16px bold,
H2 16px, corps 13–14px, notes 12px. Ne pas multiplier les tailles.

Espacement : multiples de ~4px. Cartes `padding: 18px`, `border-radius: 10px`,
marge basse 20px. Rester régulier.

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
  passe ; `--muted` sur blanc reste lisible pour du secondaire, jamais pour l'info clé.
- **Images** : toujours un `alt` (vide `alt=""` si décoratif, ex. drapeaux).
- **Sémantique** : `<button>` pour une action, `<a>`/`<Link>` pour naviguer. Jamais un
  `<div>` cliquable.
- **Focus clavier** : ne pas supprimer l'outline sans en fournir un visible.
- **Cibles tactiles** : ≥ 40px de haut pour les éléments cliquables.

## 4. Responsive

- Layout en flex ; la sidebar bascule en barre horizontale < 700px (déjà géré).
- Tout contenu large (bracket, grands tableaux) doit scroller **dans son conteneur**
  (`overflow-x:auto`), jamais faire déborder la page.
- Tester mentalement à ~375px de large.

## 5. Patterns du projet (réutiliser tels quels)

- **Page type** : `useOutletContext().setTitle("…")` au montage → titre dans la topbar.
- **Carte** : `<div className="card"><h2>Titre</h2>…</div>`.
- **Stat** : `.stat > .stat-value + .stat-label`.
- **Statut** : `.badge` + classe d'état (`post`/`live`/`future`).
- **Tableau** : `<table>` avec `<thead>` rouge ; lien en gras rouge dans les cellules.
- **Bracket** : composant `Bracket` (thème sombre BWF) — ne pas dupliquer sa logique.

## 6. Check-list avant de livrer une UI

1. Couleurs = variables CSS, aucune valeur en dur ?
2. Verdana + tailles/espacements cohérents avec l'existant ?
3. Les 3 états (chargement / vide / données) sont gérés ?
4. Contraste AA, `alt` sur images, bons éléments sémantiques, focus visible ?
5. Responsive OK (sidebar mobile, contenu large qui scrolle, pas de débordement) ?
6. Réutilise les classes/composants existants plutôt que d'en créer d'autres ?
7. Le rouge reste un accent (pas envahissant) et guide bien l'œil ?

Si un point ne passe pas, corrige avant de conclure.

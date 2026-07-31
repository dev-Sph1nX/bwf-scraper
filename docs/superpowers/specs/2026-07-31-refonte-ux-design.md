# Refonte UX — design validé

**Date :** 2026-07-31 · **Validé par :** le propriétaire (session de cadrage + maquettes navigateur)

## Problème

L'app a grossi écran par écran : 8 entrées de navigation (Matchs à venir,
Classement, Prédicteur, Fiabilité, Calendrier, Audit cotes, Données, Notes de
version) + 3 pages de détail. Le propriétaire n'utilise **aucun** de ces écrans
chaque semaine hors accueil et cotes, trouve les pages de vérification
**incompréhensibles**, et veut « un truc simple ».

Cadrage : la question à laquelle l'app doit répondre en ouvrant est
« **sur quoi parier aujourd'hui ?** ». Tout le reste s'organise derrière.

## Décision d'ensemble

**3 pages + une porte discrète**, fiches accessibles en contexte :

| Page | Rôle |
|---|---|
| **Accueil** | l'écran de pari : matchs cotés, probas, cotes par opérateur, EV |
| **Tournois** | calendrier (passés / en cours / à venir) + fiche tournoi avec brackets (existant conservé) |
| **Classement** | Elo par discipline, enrichi (rang mondial, « sous-coté BWF », tri multiple) |
| *Coulisses* | lien discret en bas de nav : tout le « est-ce que ça marche ? », réécrit pour humains |

Fiches joueur/paire et fiche tournoi : conservées, accessibles depuis les cartes
de match (clic sur un nom, clic sur le tournoi) et depuis le Classement.

**Hors périmètre** (décisions explicites) : journal de paris (lot B — le
propriétaire doute de vouloir saisir chaque pari à la main, à retraiter au
lot B) ; aucun changement de modèle ni de scraping.

## Accueil — l'écran de pari

### Sélecteur de bookmakers

En tête de page, chips **Betclic / Unibet / Winamax** :
- multi-sélection (1 à 3), au moins un actif ;
- choix mémorisé (`localStorage`) ;
- la carte de match n'affiche que les colonnes de cotes des opérateurs choisis.

### Sections, dans l'ordre

1. **Matchs cotés** — tri par **heure de match** (l'EV se repère à sa couleur,
   pas au tri) ;
2. **Autres matchs à venir** (affiche connue, pas de cote) — repliés par tournoi ;
3. **Joués récemment** — repliés, avec résultat et dernière cote prématch.

États : chargement / « aucun match coté — prochain relevé dans moins de 2 h » /
données. En période creuse, les sections 2-3 gardent l'écran vivant.

### La carte de match (spec exacte du propriétaire, maquette B validée)

Un match = un en-tête (discipline, tour, tournoi cliquable, heure locale,
badge à venir/live/joué) + **deux lignes, une par joueur/paire**, colonnes de
gauche à droite :

| Colonne | Contenu |
|---|---|
| Drapeau | icône pays |
| Joueur | NOM Prénom (cliquable → fiche joueur/paire) |
| Mondial | rang au classement mondial BWF (publication précédant le match) |
| Elo | rang dans notre classement Elo de la discipline |
| Prédiction | proba du modèle calibré, favori en `--accent`, autre camp en `--muted` |
| Cotes | **une colonne par opérateur sélectionné** ; meilleure cote du camp en `--accent` |
| 📈 (n) | UN bouton par ligne joueur ; ouvre la **modale d'évolution** |
| EV | `cote × proba − 1`, badge vert si positive, gris sinon |

Sous les deux lignes, **la ligne « pourquoi »** (toujours visible, une phrase) :
écart d'Elo, facteurs notables (« domicile »), et mention calibration —
ex. « +84 Elo · domicile · calibré ✓ ».

### Modale d'évolution des cotes

- `n` = nombre total de **points traçables** toutes courbes confondues
  (valeurs distinctes — les séries fusionnent déjà les relevés identiques) ;
- bouton **actif si n ≥ 2** (une évolution chez un opérateur OU deux opérateurs
  comparables), **grisé si n = 1** avec l'infobulle « un seul relevé pour
  l'instant — prochain passage dans moins de 2 h » ;
- la modale trace **une courbe par opérateur sélectionné**, superposées, une
  couleur chacune (légende) ; un opérateur à point unique s'affiche quand même
  (point posé sur l'axe du temps) ;
- réutilise la logique d'`OddsChart` (probabilité implicite dé-margée, paliers) —
  à étendre au multi-séries.

### EV — le lot A absorbé

La carte affiche l'EV, donc cette refonte **inclut le lot A** de la roadmap :
- `EV = cote × p − 1`, avec `p` la probabilité **calibrée** (lib/calibrate,
  comme le backtest) — jamais la proba brute ;
- EV calculée par camp et par opérateur ; le badge affiche celle de la
  **meilleure cote** ;
- s'affiche seulement si le match est apparié BWF avec confiance (sinon « — ») ;
- **renommage** du tag `value` actuel → « **sous-coté BWF** » (il compare Elo et
  classement mondial, aucune cote — le mot *value* est libéré pour l'EV).

## Tournois

La page calendrier et la fiche tournoi actuelles, inchangées sur le fond.
Nettoyage éditorial seulement (titres, textes d'aide) pour coller au ton de la
refonte.

## Classement

Par discipline (onglets MS/WS/MD/WD/XD) :
- colonnes : rang Elo, entité (cliquable → fiche), Elo, rang mondial,
  **« sous-coté BWF »** (écart rang mondial − rang Elo, l'ex-tag `value`),
  progression récente (delta Elo sur N matchs) ;
- tri par Elo (défaut) ou par progression ;
- note honnête sous le tableau : la progression est un outil de **découverte**,
  pas un pronostic (mesuré : elle ne prédit pas — journal §2.1).

## Coulisses — une page, pédagogique

Une seule page, sections dépliables, **réécrites pour un non-statisticien** :
chaque chiffre est expliqué en français simple avec un exemple concret. C'est
une réécriture éditoriale, pas un déménagement d'écrans.

| Section | Contenu (source actuelle) |
|---|---|
| « Le modèle est-il bon ? » | réussite 71,8 % expliquée, baselines, calibration en français, limites (ex-Fiabilité) |
| « D'où viennent les cotes ? » | les relevés toutes les 2 h, le journal d'évolution, l'audit d'appariement avec ses cas douteux (ex-Audit cotes) |
| « Simuler un duel » | l'actuel Prédicteur, conservé tel quel (usage occasionnel) |
| « Les données » | couverture, fraîcheur, années (ex-Données) |
| « Notes de version » | l'existant (ex-Changelog) |

Chaque section commence par une phrase de résumé lisible sans rien déplier.

## Supprimé

- La nav à 8 entrées → 3 + lien Coulisses ;
- la page Dashboard actuelle (route `/classement`, redondante avec le nouveau
  Classement) ;
- l'ancienne page « Matchs à venir » (remplacée par l'Accueil).

Aucune donnée, aucun calcul, aucun scraping supprimé — uniquement des écrans.

## Contraintes transverses

- **Mobile d'abord** (375 px) : le tableau de la carte scrolle dans la carte,
  jamais la page ; cibles ≥ 40 px ; vérification Playwright avant de conclure ;
- design system de `styles.css` uniquement (variables, classes existantes),
  thème sombre mono-thème, Verdana ;
- 3 états (chargement / vide / données) sur chaque vue ;
- accessibilité : contraste AA, `alt`, sémantique bouton/lien, focus visible ;
- les textes en français, ton « pas de boîte noire » : tout chiffre affiché
  doit être explicable par un clic ou une phrase adjacente.

## Critères de succès

1. Ouvrir l'app répond à « sur quoi parier aujourd'hui ? » sans un seul clic ;
2. choisir son bookmaker filtre réellement toutes les cotes affichées ;
3. le propriétaire comprend chaque section des Coulisses sans aide ;
4. zéro régression sur les fiches joueur/paire/tournoi ;
5. mobile 375 px impeccable (capture vérifiée) ;
6. les tests existants passent, l'EV est couverte par des tests (calibration
   incluse), le renommage « sous-coté BWF » est complet (aucune occurrence
   ambiguë de `value` côté UI).

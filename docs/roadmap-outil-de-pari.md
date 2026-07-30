# Feuille de route — outil de pari

**Dernière mise à jour :** 2026-07-30

Ce document est la liste ordonnée des chantiers. Les dépendances sont **strictes** :
chaque lot exige le précédent, et l'ordre n'est pas un choix de confort.

## Les 5 couches

Toute idée entrante se range dans l'une de ces couches. Les confondre est la
principale source de désordre.

| # | Couche | Ce qu'elle produit |
|---|---|---|
| 1 | **Modèle** | `p`, la probabilité de victoire |
| 2 | **Calibration** | *est-ce que `p` est juste ?* |
| 3 | **Détection** | `p` comparé au marché |
| 4 | **Mise** | combien miser |
| 5 | **Journal** | *est-ce que je gagne ?* |

Les couches 2 et 5 ne mesurent pas la même chose : la 2 juge le **modèle** (mes
70 % se réalisent-ils 70 % du temps ?), la 5 juge le **parieur** (timing,
sélection, exécution). La CLV appartient à la couche 5 et ne dit rien de la
qualité du modèle. Deux écrans distincts, jamais fusionnés.

## Prérequis — fait

**Historique du classement mondial BWF.** Spec `2026-07-30-historique-classement-mondial-design.md`,
plan `2026-07-30-historique-classement-mondial.md`, 8 tâches implémentées et relues.

60 semaines archivées (2025-06-10 → 2026-07-28) dans `data/rankings/`, série
`worldRank` par joueur, courbe superposée au graphe Elo.

Ce chantier n'était pas prévu : il est devenu obligatoire pour que le baseline
« le mieux classé gagne » du lot 1 soit calculable sans fuite de données — ce
baseline exige le classement **tel qu'il était la semaine du match**, le rang
d'aujourd'hui contenant déjà le résultat du match qu'on cherche à prédire.

**À noter — la fenêtre de l'API BWF ne fait que 60 semaines glissantes.** Une
publication qui en sort est définitivement irrécupérable ; `data/rankings/` est
donc la seule archive existante, et son commit n'est pas négociable.

## Lot 1 — Backtest, baselines et modèle additif explicable

**Spec :** `docs/superpowers/specs/2026-07-30-backtest-baselines-modele-additif-design.md`
**État :** spec écrit, pas commencé. **C'est le point de décision du projet.**

Répond par la mesure à trois questions, sur les 13 638 matchs déjà téléchargés :

1. **Notre modèle vaut-il mieux que des règles triviales ?** Cinq baselines
   comparées sur un socle commun : hasard, tête de série, classement mondial,
   Elo simple, modèle additif. Le chiffre intéressant n'est pas celui de chaque
   ligne, c'est **l'écart entre les lignes**.
2. **Quelle est l'incertitude propre à chaque discipline ?** L'hypothèse « le
   double mixte est le plus stable, le simple hommes le moins » devient un
   chiffre mesuré, avec barres d'erreur, et l'écran dit explicitement quelles
   disciplines ne sont **pas** départageables.
3. **Quels signaux méritent d'être affichés ?** Les poids de la forme récente,
   de la fraîcheur, du face-à-face et de la sous-cotation BWF sont **mesurés**.
   Un signal qui n'améliore pas la prédiction est **retiré** de l'interface.

Deux précautions méthodologiques qui décident de la validité de tout l'écran :
backtest **en marche avant** (chaque match prédit avec l'état de l'Elo *avant*
ce match), et **séparation temporelle** — poids ajustés sur 2024-2025, métriques
publiées sur 2026 (2 937 matchs jamais vus par l'ajustement).

**Pourquoi en premier :** calculer une valeur attendue ou une mise de Kelly avant
de savoir si `p` est juste, c'est bâtir sur du sable. Kelly dimensionne
proportionnellement à l'edge estimé : avec un `p` surconfiant, il mise **le plus
gros précisément sur les pires erreurs**. C'est la ruine accélérée, pas un
mauvais rendement.

## Lot 2 — Fraîcheur et stabilité par discipline

**État :** pas commencé. Meilleur rapport valeur/effort de la liste.

Le champ `duration` (durée du match en minutes) est présent dans **toutes** les
données depuis 2024 et **n'est lu par aucune ligne de code** — il n'apparaît que
dans `types.ts`. Avec le score par manche, il permet de calculer la charge
cumulée d'un joueur dans un tournoi en cours.

Repères mesurés : durée médiane **36 min** en 2 manches contre **61 min** en 3.

**Limite connue :** la fraîcheur n'est mesurable que pour un match **déjà joué**.
Pour un match à venir, seuls 40 des 416 matchs non joués de 2026 ont un horaire
publié — l'indicateur sera donc souvent indisponible en pronostic.

**Piège :** exclure les `Walkover` (`duration: 0` avec `score: []`), sinon les
forfaits comptent comme des matchs de 0 minute.

## Lot 3 — Glicko-2 : `p ± incertitude`

**État :** pas commencé. **Décision volontairement reportée après le lot 1.**

L'Elo donne un seul chiffre et ne peut donc pas exprimer deux choses
différentes : deux joueurs à 1800 sont traités identiquement, que l'un ait joué
40 matchs cette année ou 3 avant huit mois d'absence.

Glicko-2 garde la note **et** une marge d'erreur qui grandit avec l'inactivité.
Trois bénéfices : une prédiction sous forme d'intervalle (`58 % ± 7 %`) au lieu
d'un point trompeur, une raison principielle de réduire la mise quand
l'incertitude est élevée, et le traitement correct de l'inactivité — un joueur
absent devient **imprévisible**, ce qui est la vérité, plutôt qu'artificiellement
**mauvais**. Son troisième paramètre, la volatilité, mesure en outre la
régularité d'un joueur (stable / instable).

C'est une réécriture du cœur du calcul et tous les chiffres affichés changent de
forme. Le lot 1 dira si le changement se justifie.

## Lot 4 — Valeur attendue sur les écrans

**État :** pas commencé. Coût faible.

Les deux ingrédients sont **déjà côte à côte** dans `odds-report.json` : `prob`
(Elo) et `oddsTeam1`/`oddsTeam2` (cotes). Il ne manque que l'arithmétique.

Inclut un **renommage nécessaire** : le tag `value` actuel ne regarde aucune cote
— c'est un écart Elo ↔ classement mondial. Il devient « sous-coté BWF », pour
libérer le mot *value* au sens de la valeur attendue. Sans ce renommage, les deux
notions seront confondues d'ici six mois.

**Réserve à afficher :** la cote scrapée est la **meilleure du marché**, donc
l'EV calculé est biaisé à la hausse par rapport à ce qu'un opérateur servira.

**Contrainte de couverture :** environ 20 cotes appariées pour 125 matchs BWF à
venir. Un écran trié par edge serait souvent vide — il doit rester peuplé par les
signaux du modèle, avec les lignes cotées mises en avant.

## Lot 5 — Miser et journal

**État :** pas commencé.

Tiroir de mise sur la fiche d'un match (bankroll, fraction de Kelly, mise
calculée, enregistrement en un geste), puis le journal et ses métriques : ROI,
hit rate, drawdown maximum, profit factor.

**Décision en attente :** l'app est un site statique sur GitHub Pages, sans
backend. Recommandation — `localStorage` + export JSON, l'export étant
committable dans `data/` pour sauvegarde. Alternative : un fichier versionné,
au prix d'un commit par pari.

## Lot 6 — Historisation des cotes et CLV

**État :** pas commencé.

Aujourd'hui `scrape-odds.mjs` **écrase** le fichier de la date à chaque run, et
les cotes des matchs terminés sont **jetées** — alors qu'elles sont la meilleure
approximation de *closing line* disponible.

Or la cote de fermeture est le benchmark de référence du marché. Elle sert deux
fois : pour la CLV (couche 5), et surtout pour le lot 1 — « mon modèle bat-il le
closing line ? » est la seule question qui prédit une rentabilité future. Un
backtest peut afficher 60 % de réussite et perdre de l'argent.

Chantier de persistance (stockage append-only horodaté par relevé, scrape
récurrent, inversion de la règle sur les matchs terminés), pas un ajout de calcul.

---

## Écarté définitivement

- **Arbitrage multi-bookmakers.** La source ne fournit qu'une **cote agrégée par
  côté**, sans nom d'opérateur. Appliquer la formule de détection sur ces valeurs
  produirait des opportunités **fantômes** — cotes non simultanées, opérateurs
  différents, limites de mise ignorées. Ce n'est pas un raccourci imparfait, c'est
  un piège actif.
- **Avantage du gaucher.** Aucune donnée de latéralité dans les 13 champs joueur
  de l'API BWF.
- **Style de jeu.** Aucune donnée de jeu exploitable : `lastPointWinner` et
  `serve` sont **toujours `null`**, il n'y a pas de point par point.
- **Météo et conditions d'air.** Le lieu et les dates sont présents pour 100 % des
  tournois, mais sans coordonnées — il faudrait un géocodage puis une API externe,
  pour un signal marginal.

Ces quatre points ne sont pas « à faire plus tard » : ils sortent de la feuille de
route. À ne rouvrir que si une nouvelle source de données apparaît.

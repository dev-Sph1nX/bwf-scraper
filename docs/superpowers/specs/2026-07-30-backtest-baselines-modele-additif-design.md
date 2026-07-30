# Backtest, baselines comparées et modèle additif explicable

**Date :** 2026-07-30
**Statut :** design validé, à implémenter
**Dépend de :** `2026-07-30-historique-classement-mondial-design.md` (baseline n°2 impossible sans)

## Objectif

Répondre par la mesure, sur les **13 638 matchs déjà téléchargés**, à trois
questions qui conditionnent tout le reste de l'outil de paris :

1. **Notre modèle vaut-il mieux que des règles triviales ?** Comparer le taux de
   réussite du classement mondial, des têtes de série, de l'Elo simple et de notre
   modèle, sur les mêmes matchs.
2. **Quelle est l'incertitude propre à chaque discipline ?** Transformer la
   supposition « le double mixte est la discipline la plus stable, le simple hommes
   la moins » en un chiffre mesuré, avec sa barre d'erreur.
3. **Quels signaux méritent d'être affichés ?** Mesurer l'apport réel de la forme
   récente, de la fraîcheur, du face-à-face et de la sous-cotation BWF, pour que le
   panneau d'explication de chaque pronostic repose sur l'arithmétique du calcul et
   non sur une narration ajoutée après coup.

Ce lot est le **préalable à tout le reste** : sans réponse à la question 1, calculer
une valeur attendue ou une mise de Kelly revient à bâtir sur du sable, et le
dimensionnement de mise amplifierait précisément les erreurs du modèle.

## Périmètre

### Dans le périmètre

- Un moteur de backtest **en marche avant** produisant, pour chaque match joué, la
  photographie de ce qu'on savait **avant** ce match.
- Cinq baselines comparées sur un socle commun de matchs.
- Métriques : taux de réussite, score de Brier, log loss, courbe de calibration,
  taux de surprise — toutes assorties d'un intervalle de confiance par bootstrap.
- Mesure de l'incertitude par discipline, à information constante.
- Ajustement des poids d'un **modèle additif** par régression logistique, avec
  séparation temporelle apprentissage / vérification.
- Un fichier `web/public/data/backtest.json` et un écran « Fiabilité » qui le lit.

### Hors périmètre (explicite)

- **Pas de passage à Glicko-2.** Décision assumée : on mesure d'abord ce que vaut
  l'Elo actuel. Le résultat de ce lot dira si le changement de moteur se justifie.
- Pas de calcul de valeur attendue, de mise de Kelly, ni de journal de paris.
- Pas de modification du panneau d'explication des matchs à venir (`upcoming`) :
  ce lot **mesure** les poids, leur mise en production dans l'UI des pronostics est
  un lot suivant.
- Pas de signaux météo, de latéralité (gaucher) ni de style de jeu : données
  absentes, cf. « Limites connues ».
- Pas de parsing des PDF de classement 2024 (cf. « Limites connues »).
- Aucune nouvelle dépendance npm.

## Faits établis — vérifiés dans les données

| Fait | Valeur | Preuve |
|---|---|---|
| Matchs avec vainqueur défini | **13 638** sur 84 tournois | `winner` ∈ {1,2} : 5 270 + 5 433 + 2 935 |
| dont **avec durée renseignée** | **13 220** | les 418 restants sont forfaits / walkovers |
| Années disponibles | 2024, 2025, 2026 uniquement | `data/2024`, `data/2025`, `data/2026` |
| Répartition (terminés) | 2024 : 5 268 · 2025 : 5 432 · 2026 : 2 937 | comptage par `matchStatus` |
| **Durée de match** | présente, **jamais lue par le code** | `duration` (minutes), déclarée `types.ts:48` et `:73` ; `grep -rn duration` hors `data/` ne renvoie que ces deux lignes |
| Score par manche | présent | `score: [{set, home, away}]`, `types.ts:110-116` |
| Durée médiane | **36 min** en 2 manches, **61 min** en 3 manches | mesuré sur 2025 (n = 3 551 / 1 707) |
| Forme récente | déjà calculée | `PARAMS.formWindow = 5`, `formOf()` → `lib/elo.mjs:179-203` |
| Dernier match joué | déjà calculé | `lastPlayed` → `lib/elo.mjs:137`, `:164-165`, `:202` |
| Discipline | sur 100 % des matchs | `eventName` ∈ {MS, WS, MD, WD, XD} |
| Matchs par discipline et par an | ≈ 1 050 à 1 175 | 2025 : MS 1173 · WS 1077 · MD 1069 · WD 1049 · XD 1065 |
| Historique Elo par point | note **et** delta enregistrés | `lib/elo.mjs:171-174` : `{t, r, d, disc, tmtId, round, won, opp, vs}` |

Le champ `d` (delta) permet de retrouver la note **d'avant match** par `r − d`. Le
moteur de backtest n'en dépendra pas — il enregistrera la note d'avant match
directement — mais c'est un moyen de contrôle croisé indépendant.

## Architecture

### Vue d'ensemble

```
lib/dataset.mjs      NOUVEAU  1 passe chronologique -> 1 ligne par match,
                              uniquement des features d'AVANT match
lib/models.mjs       NOUVEAU  les 5 modèles, fonctions pures sur une ligne
lib/metrics.mjs      NOUVEAU  réussite, Brier, log loss, calibration, bootstrap
lib/logistic.mjs     NOUVEAU  régression logistique (~60 lignes, sans dépendance)
backtest.mjs         NOUVEAU  orchestre, écrit web/public/data/backtest.json
web/src/pages/Reliability.jsx  NOUVEAU  écran « Fiabilité »
```

Découpage voulu : `dataset` produit la donnée, `models` et `metrics` sont des
**fonctions pures** testables sans réseau ni fichier, `backtest.mjs` n'est que de
l'orchestration. C'est le seul découpage qui permet de tester la partie critique
(l'absence de fuite de données) de façon isolée.

### 1. Le jeu de données d'avant match — `lib/dataset.mjs`

**Le point critique de tout le lot.** Une seule passe chronologique sur les 13 638
matchs. Pour chaque match, **avant** d'appliquer la mise à jour Elo, on enregistre
une ligne décrivant l'état des connaissances à cet instant :

```js
{
  // identité
  t, disc, tmtId, drawId, matchKey, year,
  aKey, bKey,                    // entités (joueur ou paire)
  // cible
  won,                           // 1 si A gagne — A/B dans l'ordre du draw
  // features d'AVANT match
  eloA, eloB,                    // notes avant mise à jour
  nA, nB,                        // nombre de matchs joués avant
  formA, formB,                  // somme des 5 derniers deltas, avant
  daysOffA, daysOffB,            // jours depuis lastPlayed, avant
  h2hA, h2hB,                    // confrontations gagnées avant, même discipline
  loadA, loadB,                  // minutes jouées dans CE tournoi avant ce match
  sets3A, sets3B,                // le match précédent dans ce tournoi était-il en 3 manches
  seedA, seedB,                  // tête de série (null si non classé)
  bwfRankA, bwfRankB,            // rang mondial de la semaine précédant le match
  bwfRankAt,                     // date de la publication utilisée (traçabilité)
}
```

**Règles d'intégrité, non négociables :**

- Aucune valeur postérieure au match ne peut entrer dans la ligne. C'est
  garanti structurellement par l'ordre : on écrit la ligne, **puis** on met à jour
  l'Elo, la forme, `lastPlayed`, le H2H et la charge.
- `bwfRank*` provient de la **publication hebdomadaire précédant strictement** la
  date du match, jamais de la publication courante. Utiliser le classement
  d'aujourd'hui serait une fuite : le rang actuel d'un joueur intègre déjà le
  résultat du match qu'on cherche à prédire.
- Les matchs `Walkover` sont **exclus** : `duration: 0` avec `score: []` et
  `scoreStatusValue: "Walkover"` existe réellement (constaté dans
  `data/2026/5209/draw-1.json`). Les compter fausserait à la fois la charge (un
  match de 0 minute) et le résultat (une victoire sans match joué).
- `loadA`/`loadB` n'additionnent que des `duration > 0` du **même tournoi**, avant
  la date du match.

Sortie : en mémoire par défaut. Un drapeau `--dump` écrit le jeu de données pour
inspection dans un fichier ignoré par git — il est intégralement dérivable de
`data/`, donc il n'a pas à être versionné.

### 2. Les cinq modèles — `lib/models.mjs`

Chaque modèle est une fonction pure `(row) => number | null`, renvoyant la
probabilité que A gagne, ou `null` si le modèle ne peut pas se prononcer sur ce
match.

| # | Modèle | Règle | `null` quand |
|---|---|---|---|
| 0 | `random` | `0.5` constant | jamais |
| 1 | `seed` | le mieux placé en tête de série gagne | l'un des deux n'est pas tête de série |
| 2 | `bwf` | le mieux classé au mondial gagne | l'un des deux n'est pas classé cette semaine-là |
| 3 | `elo` | `1/(1+10^((eloB−eloA)/400))` | l'un des deux est provisoire (`n` sous le seuil) |
| 4 | `additive` | somme pondérée, cf. section 4 | idem |

Les modèles 1 et 2 sont **binaires** (0 ou 1) : ils désignent un vainqueur sans
nuance. C'est voulu — c'est ce que « le mieux classé gagne » signifie. Leur score
de Brier en sera pénalisé, ce qui est l'information exacte qu'on cherche : une
règle sans nuance est mauvaise pour parier même si elle a souvent raison.

Le renvoi de `null` est ce qui rend la comparaison honnête. La couverture de chaque
modèle est différente, donc :

- **socle commun** = les matchs où **tous** les modèles se prononcent. C'est le seul
  ensemble sur lequel les chiffres sont comparables entre eux ;
- **couverture propre** = chaque modèle est aussi mesuré sur tous les matchs où il
  peut se prononcer, avec son `n` affiché.

Les deux sont publiés. Comparer un taux obtenu sur 13 638 matchs à un taux obtenu
sur 800 matchs n'a aucun sens, et ne pas afficher les deux invite à le faire.

### 3. Métriques — `lib/metrics.mjs`

- **Taux de réussite** : part des matchs où le camp donné gagnant par le modèle
  gagne effectivement. `p = 0.5` compte pour un demi-succès.
- **Score de Brier** : moyenne de `(p − résultat)²`. Plus bas est meilleur.
- **Log loss** : pénalise durement les certitudes fausses.
- **Courbe de calibration** : 10 tranches de probabilité prédite, avec le taux
  observé dans chacune et son effectif.
- **Taux de surprise** : part des matchs où le camp le moins bien noté gagne.
- **Intervalle de confiance** : bootstrap par rééchantillonnage, **1 000 tirages**,
  sur chaque métrique et chaque sous-groupe.

Le bootstrap utilise un **générateur pseudo-aléatoire à graine fixe** défini dans
`lib/metrics.mjs`, pas `Math.random()`. Deux exécutions sur les mêmes données
doivent produire exactement les mêmes intervalles : sans cela, un écart entre deux
disciplines pourrait apparaître ou disparaître d'un run à l'autre, et les chiffres
publiés ne seraient pas reproductibles.

**Pourquoi le taux de réussite ne suffit pas, et pourquoi il reste en tête
d'affiche.** Un modèle qui annonce `51 %` et un qui annonce `95 %` comptent
identiquement au taux de réussite quand ils ont raison. Pour parier, l'écart est
décisif : c'est lui qui détermine la mise. Deux modèles à 70 % de réussite peuvent
être l'un rentable, l'autre ruineux. Le taux de réussite reste néanmoins la colonne
principale de l'écran parce que c'est la grandeur qui se lit sans formation ; le
Brier l'accompagne avec une simple indication « plus bas = mieux ».

### 4. Incertitude par discipline — à information constante

**Une correction méthodologique par rapport à ce qui avait été esquissé en
discussion.** La décomposition classique du score de Brier isole un terme
d'« incertitude irréductible » égal à `p̄(1−p̄)`, où `p̄` est le taux de base de
l'événement. Or ici l'événement est « A gagne », et A est simplement le premier
camp dans l'ordre du tableau : `p̄ ≈ 0,5` **par construction, pour toutes les
disciplines**. Le terme serait donc ≈ 0,25 partout et ne mesurerait rien.

La mesure correcte exige d'**orienter** chaque match. Convention retenue :

> Chaque match est orienté de sorte que le camp « favori » soit celui que l'**Elo
> simple** désigne, et l'événement mesuré est « le favori gagne ».

Alors `p̄` devient le taux de victoire du favori, qui varie réellement d'une
discipline à l'autre, et les trois termes reprennent un sens :

| Terme | Lecture | Ce qu'il dit |
|---|---|---|
| **Incertitude irréductible** | `p̄(1−p̄)` avec `p̄` = taux de victoire du favori | à quel point le plateau de la discipline est resserré |
| **Pouvoir de séparation** | de combien le modèle s'écarte utilement du taux de base | ce que le modèle apporte |
| **Erreur de calibration** | écart entre probabilités annoncées et taux observés | si le modèle exagère sa confiance |

L'orientation est **fixée par l'Elo simple pour toutes les disciplines**, y compris
quand on évalue le modèle additif. C'est ce qui rend la comparaison entre
disciplines valide : elles sont jugées à information constante. Utiliser
l'orientation propre à chaque modèle rendrait les colonnes incomparables.

**La conclusion doit pouvoir contredire l'hypothèse de départ.** L'écran affichera
explicitement quels écarts sont réels et lesquels ne le sont pas :

- si les intervalles de confiance de deux disciplines se chevauchent, elles sont
  déclarées **non départageables** et il est interdit de les traiter différemment
  dans le modèle ;
- si l'ordre mesuré contredit l'hypothèse « XD la plus stable, MS la moins », c'est
  l'ordre mesuré qui est publié.

Avec **≈ 2 730 matchs par discipline** (13 638 / 5 ; le simple hommes est un peu
sur-représenté — 1 173 contre 1 065 en XD sur 2025), les intervalles attendus sont
de l'ordre de ± 0,01 sur le Brier : suffisant pour
départager des disciplines nettement différentes, insuffisant pour trancher entre
deux disciplines voisines. C'est précisément pourquoi les barres d'erreur sont
obligatoires et pas décoratives.

### 5. Le modèle additif — `lib/logistic.mjs`

Le modèle actuel écrase toute l'information dans un seul nombre :
`p = 1/(1+10^((eloB−eloA)/400))`. Rien n'y est décomposable, donc aucun panneau
d'explication ne peut être honnête : les phrases du champ `reasons`
(`build-data.mjs`) sont une narration produite **à côté** du calcul, pas une
décomposition de celui-ci.

Le modèle additif rend l'explication arithmétiquement vraie. La formule Elo étant
déjà une fonction logistique de l'écart de notes, l'extension est naturelle : on
somme des contributions dans la même échelle, puis on convertit en probabilité.

```
z = β₀
  + β_elo   × (eloA − eloB) / 400
  + β_form  × (formA − formB) / 50
  + β_h2h   × signalH2H
  + β_fresh × (loadB − loadA) / 60        // charge de l'adversaire = avantage
  + β_off   × (fatigueRepos)
  + β_bwf   × (bwfRankB − bwfRankA) normalisé
p = 1 / (1 + e^(−z))
```

Chaque variable est **normalisée** (échelles indiquées ci-dessus) pour que les
coefficients soient comparables entre eux, et donc lisibles dans l'écran.

**Ajustement.** Régression logistique par maximum de vraisemblance, descente de
gradient avec régularisation L2 légère. Environ 60 lignes de JavaScript : aucune
dépendance npm n'est ajoutée (le dépôt n'a que `playwright`, et ce lot ne
nécessite aucun réseau).

**Séparation temporelle, obligatoire.** Les poids sont ajustés sur
**2024-01 → 2025-12** (≈ 10 700 matchs) et les métriques publiées sont celles
mesurées sur **2026** (2 937 matchs jamais vus par l'ajustement). Ajuster puis
mesurer sur les mêmes données ne mesurerait que notre capacité à décrire le passé.

**Deux variantes, à cause de la couverture du classement mondial :**

| Variante | Variables | Période d'ajustement |
|---|---|---|
| **A** | Elo, forme, H2H, fraîcheur, repos, têtes de série | 2024-01 → 2025-12 |
| **B** | A + écart au classement mondial | 2025-06-10 → 2025-12 |

La variante B a un ajustement plus court parce que l'historique du classement
mondial commence au 2025-06-10 (cf. spec dépendant). Les deux sont publiées et
comparées : si B n'apporte rien à A, l'écart au classement mondial est retiré du
modèle.

**Un signal qui n'améliore pas significativement la prédiction est retiré du
modèle et de l'interface.** Critère : le coefficient doit être significativement
non nul (son intervalle de confiance bootstrap ne contient pas zéro) **et**
l'ajouter doit améliorer le Brier sur 2026. Chaque ligne affichée dans un panneau
d'explication aura donc gagné sa place, avec l'effectif sur lequel elle l'a gagnée.

### 6. Affichage des contributions — cascade exacte

Une contribution exprimée en points de pourcentage dépend du point de départ : un
même coefficient ne déplace pas `p` du même nombre de points selon qu'on part de
50 % ou de 90 %. Afficher une liste de `+4 %, +2 %, −5 %` qui ne s'additionne pas
au total réintroduirait exactement le flou qu'on cherche à supprimer.

Le calcul publié est donc une **cascade** : on part du niveau de base et chaque
signal montre le saut réel qu'il provoque, dans un ordre fixé (Elo d'abord, puis
les ajustements). La somme des sauts égale le total **par construction**.

```
Niveau de base — écart Elo                55 %
+ Forme récente                    ▲ +4   59 %
+ Fraîcheur                        ▲ +2   61 %
+ Face-à-face                      ▼ −5   56 %
+ Sous-cotation BWF                ▲ +2   58 %
────────────────────────────────────────────────
= PRÉDICTION                              58 %
```

Ce lot **produit et teste** cette fonction de cascade (`explain(row) => étapes[]`).
Son branchement dans l'écran des matchs à venir est un lot suivant ; ici elle est
seulement vérifiée par test : la somme des sauts doit égaler la probabilité finale
à la précision d'affichage près.

### 7. Sortie — `web/public/data/backtest.json`

```json
{
  "generatedAt": "...",
  "coverage": {
    "common": { "n": 5412, "from": "2025-06-10", "to": "2026-07-28" },
    "full":   { "n": 13638, "from": "2024-01-09", "to": "2026-07-30" },
    "withDuration": 13220,
    "excluded": { "walkover": 0, "provisional": 0, "unranked": 0 }
  },
  "baselines": [
    { "key": "random", "label": "Hasard", "scope": "common",
      "accuracy": 0.500, "accuracyCi": [0.487, 0.513],
      "brier": 0.250, "brierCi": [0.250, 0.250], "n": 5412 }
  ],
  "byDiscipline": [
    { "disc": "XD", "favWinRate": 0.76, "irreducible": 0.181,
      "irreducibleCi": [0.172, 0.190], "upsetRate": 0.24,
      "sharpness": 0.71, "calibrationError": 0.004, "n": 2731 }
  ],
  "indistinguishable": [["WD", "MD"]],
  "calibration": [
    { "bin": "50-55", "predicted": 0.526, "observed": 0.519, "n": 812 }
  ],
  "signals": [
    { "key": "form", "label": "Forme récente", "coef": 0.31,
      "coefCi": [0.22, 0.40], "brierGain": 0.006, "kept": true, "n": 10700 }
  ],
  "models": { "A": { }, "B": { } }
}
```

Le champ `indistinguishable` est produit par le calcul, pas rédigé à la main : il
liste les paires de disciplines dont les intervalles se chevauchent, et l'écran
l'affiche comme un avertissement.

### 8. Écran « Fiabilité » — `web/src/pages/Reliability.jsx`

Route `/fiabilite`, entrée de sidebar dans le groupe « Parier ». Quatre blocs :

1. **Comparaison des méthodes** — le tableau des 5 baselines sur le socle commun,
   avec la colonne « apport » (l'écart à la ligne précédente), puis le même tableau
   sur couverture propre. C'est le bloc qui répond à « notre modèle sert-il ? ».
2. **Courbe de calibration** — probabilité prédite en abscisse, taux observé en
   ordonnée, diagonale de référence. Une phrase de lecture générée
   automatiquement (« vos 70 % gagnent 68 % du temps : léger excès de confiance »).
3. **Prévisibilité par discipline** — le tableau avec barres d'erreur, la mention
   explicite des paires non départageables, et la confirmation ou l'infirmation de
   l'hypothèse de départ.
4. **Apport de chaque signal** — coefficient, intervalle, gain de Brier, et statut
   conservé / retiré.

**Contraintes projet.** Le skill `ui-ux-pro-max-skill` est invoqué avant écriture
(règle du `CLAUDE.md`). Réutilisation des classes existantes : `.card`, `.stats` /
`.stat`, `.table-scroll`, `.tabs` / `.tab`, `.chart` / `.chart-plot` /
`.chart-legend`, `.badge`, `.muted`, `.lead`. Couleurs uniquement par variables CSS
(`--accent`, `--accent-2`, `--green`, `--muted`, `--line`) ; l'app est mono-thème
sombre, il n'y a pas de thème clair à gérer. SVG en `viewBox` + `width: 100%`, sans
largeur fixe. Les trois états sont traités : chargement, données absentes
(`backtest.json` non généré), données présentes. Rendu vérifié à ~375px, tables
larges dans `.table-scroll`, cibles tactiles ≥ 40px.

Le vocabulaire technique est traduit à l'écran : « incertitude irréductible »
plutôt que « composante d'incertitude », « plus bas = mieux » à côté du Brier,
« sur N matchs » systématiquement affiché.

## Tests

Modèle du dépôt : `node --test test/*.test.mjs`, fixtures JSON, aucun réseau.

- **`test/dataset-leak.test.mjs` — le test le plus important du lot.** Sur une
  série synthétique de matchs chronologiques, vérifier que la ligne du match `k` ne
  contient **aucune** information issue des matchs `≥ k` : notes Elo, forme, H2H,
  charge et `daysOff` doivent correspondre exactement à l'état reconstruit à la
  main après les `k−1` premiers matchs. Vérifier aussi que `bwfRankAt` est
  strictement antérieur à la date du match.
- `test/dataset-edge.test.mjs` — exclusion des `Walkover`, charge remise à zéro au
  changement de tournoi, `daysOff` nul au premier match d'une entité, paires de
  double traitées comme une entité unique.
- `test/models.test.mjs` — les 5 modèles sur des lignes construites à la main,
  y compris tous les cas de renvoi `null`, et le calcul du socle commun.
- `test/metrics.test.mjs` — Brier, log loss et taux de réussite sur des exemples
  calculés à la main ; `p = 0.5` compte pour un demi-succès ; binning de la courbe
  de calibration aux bornes ; **reproductibilité du bootstrap** (deux appels
  successifs donnent des intervalles identiques).
- `test/logistic.test.mjs` — ajuster sur des données synthétiques générées à partir
  de coefficients connus, et vérifier qu'ils sont retrouvés à une tolérance près ;
  vérifier que la régularisation L2 rétrécit bien les coefficients.
- `test/explain.test.mjs` — la somme des sauts de la cascade égale la probabilité
  finale ; l'ordre des étapes est déterministe ; un signal retiré n'apparaît pas.
- `test/discipline-orientation.test.mjs` — sur un jeu synthétique où le favori Elo
  gagne dans une proportion connue, vérifier que le taux de base orienté et
  l'incertitude irréductible valent bien les valeurs attendues, et **qu'ils ne
  valent pas 0,25** (contrôle contre la régression méthodologique décrite en
  section 4).

## Décisions

**On mesure l'Elo actuel avant de le remplacer.** Glicko-2 réglerait proprement
deux besoins réels (l'inactivité qui accroît l'incertitude au lieu de baisser la
note, et la classification stable / instable via la volatilité), mais c'est une
réécriture du cœur du calcul qui change tous les chiffres affichés. Le faire avant
de savoir ce que vaut l'Elo actuel serait dépenser cet effort à l'aveugle. Ce lot
produit précisément l'information qui permettra de décider.

**Le taux de réussite en colonne principale, le Brier à côté.** Le taux de réussite
est la seule grandeur qui se lit sans formation ; le Brier est celle qui décide de
la rentabilité. Masquer le second serait malhonnête, mettre le premier au second
plan rendrait l'écran inutilisable.

**Orientation fixée par l'Elo simple pour la comparaison entre disciplines.** Seule
façon de comparer les disciplines à information constante. Documenté dans l'écran
lui-même, parce qu'un lecteur qui l'ignore surinterpréterait le tableau.

**Bootstrap à graine fixe.** Des intervalles qui bougent d'un run à l'autre
rendraient les conclusions non reproductibles, et un écart entre disciplines
pourrait apparaître ou disparaître au hasard.

**Aucune dépendance npm ajoutée.** La régression logistique fait ~60 lignes ; le
dépôt est public, déployé par GitHub Actions, et n'a aujourd'hui que `playwright`.

**Un signal non significatif est supprimé, pas atténué.** Le but déclaré est qu'un
pronostic soit explicable ; une ligne d'explication qui ne correspond à aucun gain
mesuré produit une confiance sans fondement, ce qui est pire que pas d'explication.

**Le jeu de données d'avant match n'est pas versionné.** Intégralement dérivable de
`data/`, il pèserait pour rien dans un dépôt public.

## Limites connues

- **Le baseline « classement mondial » ne portera que sur ~5 700 matchs** (à partir
  du 2025-06-10), pas 13 638, faute d'historique antérieur. C'est assez pour
  conclure, et c'est affiché. Les PDF hebdomadaires trouvés sur le site corporate
  BWF couvriraient 2024 mais exigeraient un parseur PDF — hors périmètre. Note
  pour ce jour-là : la date des noms de fichiers n'est **pas** fiable (`Week-24`
  est daté `2024-04-11`, seule des 53 dates de 2024 à ne pas être un mardi ; la
  séquence prouve qu'il fallait lire `2024-06-11`), il faudra faire foi au numéro
  de semaine.
- **La fraîcheur n'est mesurable qu'à l'intérieur d'un tournoi**, et seulement pour
  les matchs déjà joués. Pour un match **à venir**, seuls 40 des 416 matchs non
  joués de 2026 ont un horaire publié : en production, l'indicateur sera souvent
  indisponible. Cela n'affecte pas le backtest (qui ne porte que sur des matchs
  joués) mais limitera l'usage en pronostic.
- **Aucune donnée de latéralité** (gaucher) dans les 13 champs `Player` de la BWF,
  et **aucune donnée point par point** (`lastPointWinner` et `serve` sont toujours
  `null`) : les signaux « avantage du gaucher » et « style de jeu » ne sont pas
  mesurables et sont hors périmètre.
- **La météo est hors périmètre** : le lieu et les dates sont présents pour 100 %
  des tournois des trois années, mais sans latitude/longitude — il faudrait un
  géocodage puis une API externe, et 3 salles de 2026 portent
  `locationName: "Main Location"`.
- **2024 compte 32 tournois sur 33** : les Jeux Olympiques de Paris sont exclus
  volontairement (source HTML sur un autre domaine, garde-fou `lib/updater.mjs:53-56`).
- **`manifest.json` contient une entrée `years["2023"]`** alors qu'aucun
  `data/2023/` n'existe : seul le calendrier 2023 avait été sondé. L'historique
  exploitable commence au **2024-01-09**.
- Le résultat peut être décevant. Il est possible que le modèle additif n'apporte
  presque rien à l'Elo simple, ou que l'Elo simple ne batte pas le classement
  mondial. C'est une issue acceptable et informative : elle éviterait de construire
  une couche de mise sur un modèle sans avantage.

## Ordre d'implémentation

1. `lib/dataset.mjs` + `test/dataset-leak.test.mjs` et `test/dataset-edge.test.mjs`.
   Le test de fuite passe **avant** tout le reste : si le jeu de données est
   contaminé, tous les chiffres qui suivent sont faux et paraîtront excellents.
2. `lib/metrics.mjs` + tests (bootstrap reproductible inclus).
3. `lib/models.mjs` + tests, baselines 0 à 3, calcul du socle commun.
4. Premier `backtest.mjs` : publier les baselines 0-3 et la calibration. **Point de
   contrôle** — c'est ici qu'on sait si l'Elo actuel vaut quelque chose.
5. Incertitude par discipline (orientation fixe) + son test dédié.
6. `lib/logistic.mjs` + tests, puis variantes A et B du modèle additif, sélection
   des signaux.
7. `explain()` (cascade) + test de somme exacte.
8. `web/src/pages/Reliability.jsx` après `ui-ux-pro-max-skill`, vérification à 375px.

L'étape 4 est un point de décision explicite : selon ce qu'elle montre, la suite
peut être réorientée (par exemple vers Glicko-2 si la calibration se révèle
mauvaise sur les entités peu actives).

# Historique du classement mondial BWF — scrape, backfill et comparaison à l'Elo

**Date :** 2026-07-30
**Statut :** design validé, à implémenter

## Objectif

Constituer et maintenir l'**historique hebdomadaire du classement mondial officiel
BWF** depuis le 2025-06-10, puis afficher son évolution **sur le même graphe que la
cote Elo** afin de comparer directement les deux dynamiques.

L'intérêt pour l'outil de pari : le classement mondial officiel repose sur les 6
meilleures performances (forte inertie), tandis que l'Elo reflète la forme du
moment. Voir les deux courbes superposées rend visible **l'écart entre les deux**,
qui est le signal exploitable.

## Périmètre

### Dans le périmètre

- Récupération de l'index des publications BWF (`vue-rankingweek`) et sa validation.
- Backfill one-shot des 60 publications hebdomadaires dans `data/rankings/`.
- Refonte du run hebdomadaire en **synchronisation** : il télécharge toute
  publication de l'index dont le fichier manque, au lieu d'écraser un instantané
  unique. Un run manqué se rattrape donc de lui-même.
- Suppression de `data/<année>/rankings/world.json` et de son cas particulier dans
  `build-data.mjs`.
- Exposition d'une série `worldRank` par joueur dans les données du front.
- Superposition de cette série sur `EloChart.jsx` (axe Y droit inversé).

### Hors périmètre (explicite)

- Aucune modification du calcul Elo (`lib/elo.mjs`) ni de ses paramètres.
- Pas de page dédiée aux « plus fortes progressions / chutes » (feature distincte).
- Pas d'historique des classements par paire (doubles) sur la page `Pair.jsx` :
  la donnée sera présente dans `data/`, son affichage viendra plus tard si besoin.
- Pas de rétro-historique avant 2025-06-10 (voir « Limites connues »).
- Pas de modification de `EloCompareChart.jsx`.

## Faisabilité — vérifiée par sondage

Quatre sondes Playwright sur `extranet-lv.bwfbadminton.com/api/vue-rankingtable`
ont établi les faits suivants.

**L'historique est accessible.** Le paramètre `publicationId` est respecté : les
publications passées renvoient bien des données distinctes (`total` = 1898, 1900,
1939, 1949 pour quatre semaines consécutives de 2025).

**La réponse ne contient aucune date.** Le seul identifiant temporel est
`ranking_publication_id`, répété sur chaque ligne. La date doit donc être déduite,
pas lue.

**L'incrément des ids n'est pas constant.** Ancres confirmées :

| `publicationId` | Semaine | Date | Écart au précédent |
|---|---|---|---|
| 3821 | w24 2025 | 2025-06-10 | — |
| 3828 | w25 2025 | 2025-06-17 | +7 |
| 3835 | w26 2025 | 2025-06-24 | +7 |
| 3842 | w27 2025 | 2025-07-01 | +7 |
| 4387 | w29 2026 | 2026-07-14 | — |
| 4394 | w30 2026 | 2026-07-21 | +7 |
| 4402 | w31 2026 | 2026-07-28 | **+8** |

L'extrapolation naïve en +7 est donc **fausse** : elle a été testée et tous les ids
de 3849 à 4038 renvoient `total = 0`. L'index récupéré depuis `vue-rankingweek`
explique pourquoi — la semaine 28 de 2025 porte l'id **3850**, pas 3849 ; le pas
réel de cette semaine-là est de 8.

**Un endpoint liste les publications, avec leurs dates.** Trouvé par interception
des requêtes de `https://bwfbadminton.com/rankings/` (14 noms devinés au hasard
avaient d'abord échoué — deviner ne remplace pas observer) :

```
GET /api/vue-rankingweek?rankId=2
[ { "id": 4402, "year": 2026, "week": 31,
    "date": "2026-07-28 00:00:00",
    "key": "2026-31-4402",
    "display": "Week 31 (2026-07-28)" }, … ]
```

**Une seule requête renvoie les 60 publications, date incluse.** Aucune datation
n'a donc à être déduite. Contrôles effectués sur la réponse réelle :

| Contrôle | Résultat |
|---|---|
| Nombre d'entrées | **60** |
| Plage | 2025-06-10 → 2026-07-28 |
| Trous | **aucun** (59 semaines d'écart pour 60 entrées) |
| Concordance avec les 7 ancres relevées à la main | **7 / 7** |
| Dates qui ne sont pas un mardi | 0 |
| Dates en doublon | 0 |

Endpoint voisin : `vue-rankingdata?rankId=2` renvoie la seule publication
courante (mêmes champs). `vue-rankingweek` la contient aussi, donc un seul appel
suffit.

**La fenêtre de l'API fait exactement 60 semaines, et elle est glissante.** Une
publication qui en sort n'est plus récupérable : c'est ce qui rend le backfill
urgent, son versionnement non négociable, et l'historique antérieur au 2025-06-10
définitivement hors de portée de l'API.

**Une marche avant par sondage aurait échoué.** Approche initialement retenue,
abandonnée après avoir mesuré la distribution réelle des écarts d'id :

```
écart :  4   5   6   7   8   9  10  11  13  22  46  50
count :  1   1   3  11  17  14   4   4   1   1   1   1
```

Le minimum est **4** (et non 7) et le maximum **50**. Une fenêtre `+7…+30` aurait
sauté les 5 publications espacées de moins de 7, puis se serait arrêtée net sur
l'écart de 50 (3955 → 4005), avec 18 publications sur 60. Conservé ici comme
justification de la décision, pas comme piste.

**La publication courante est identifiable.** `publicationId=0` renvoie des lignes
dont `ranking_publication_id` vaut **4402**, ce qui correspond à la semaine 31
(2026-07-28). L'id réel de la publication courante est donc lisible dans la réponse.

**Les dates de publication sont toujours un mardi.** 2025-06-10 et 2026-07-28 sont
tous deux des mardis, cohérent avec le rythme de publication hebdomadaire BWF déjà
documenté dans `fetch-rankings.mjs`.

## Architecture

### Vue d'ensemble

```
lib/publications.mjs    NOUVEAU — index des publications (1 requête) + validation
lib/rankings.mjs        REFONTE — fetch d'une publication, profondeur 250
lib/rank-history.mjs    NOUVEAU — séries worldRank, fonctions pures
backfill-rankings.mjs   NOUVEAU — one-shot, remplit l'historique
fetch-rankings.mjs      REFONTE — synchronise l'index et les fichiers manquants
build-data.mjs          lit la série, produit worldRank par joueur
EloChart.jsx            REFONTE — deux séries, deux axes Y
```

### 1. Index des publications — `lib/publications.mjs`

Un seul appel, aucune déduction :

```
GET /api/vue-rankingweek?rankId=2   ->   60 entrées {id, year, week, date, key, display}
```

Le module normalise la réponse et la trie par date croissante :

```js
fetchPublicationIndex(client) -> {
  source: "vue-rankingweek",
  fetchedAt: "2026-07-30T...",
  publications: [
    { publicationId: 3821, date: "2025-06-10", week: 24, year: 2025 },
    { publicationId: 3828, date: "2025-06-17", week: 25, year: 2025 }
  ]
}
```

`date` est le champ `date` de l'API, tronqué au jour (`"2026-07-28 00:00:00"` →
`"2026-07-28"`). `week` et `year` viennent aussi de l'API. **Rien n'est calculé**,
donc rien ne peut dériver.

**Garde-fous de cohérence — bloquants.** Peu coûteux et conservés, car l'API peut
changer sans préavis :

1. la liste n'est pas vide et chaque entrée a un `id`, une `date` et une `week` ;
2. les dates sont **toutes des mardis**, sans doublon ;
3. les dates forment une **suite hebdomadaire sans trou** : `(dernière − première)
   / 7 + 1` doit égaler le nombre d'entrées ;
4. les **7 ancres** relevées à la main sur le site (`3821→2025-06-10`,
   `3828→2025-06-17`, `3835→2025-06-24`, `3842→2025-07-01`, `4387→2026-07-14`,
   `4394→2026-07-21`, `4402→2026-07-28`) doivent être présentes avec ces dates
   exactes. Une ancre absente parce que sortie de la fenêtre glissante n'est pas
   une erreur ; une ancre présente avec une **autre** date en est une.

Vérifié sur la réponse réelle du 2026-07-30 : 60 entrées, 2025-06-10 → 2026-07-28,
aucun trou, aucun doublon, 0 date non-mardi, **7/7 ancres concordantes**.

Si un garde-fou échoue, le script **s'arrête sans rien écrire**. Écrire de mauvaises
dates rendrait l'historique silencieusement mensonger.

Sortie : `data/rankings/publications.json` — l'index tel que normalisé, versionné.
Contrairement à la conception précédente, il n'est **pas définitif** : chaque run
hebdomadaire le rafraîchit depuis l'API et le fusionne avec les entrées locales
plus anciennes que la fenêtre de 60 semaines.

**Fenêtre glissante — conséquence structurante.** L'API n'expose que 60 semaines.
Une publication qui en sort devient définitivement irrécupérable : `data/rankings/`
est alors la **seule** archive existante. D'où deux règles : le backfill doit être
lancé et committé sans attendre, et l'index local ne doit jamais être remplacé par
la réponse de l'API — seulement fusionné avec elle.

### 2. Fetch d'une publication — `lib/rankings.mjs`

La fonction existante `fetchWorldRankings` est généralisée pour accepter un
`publicationId` et une profondeur :

```js
fetchPublication(client, { publicationId, depth = 250, onProgress })
  -> { publicationId, rankId: 2, fetchedAt, disciplines: { MS, WS, MD, WD, XD } }
```

Le mapping discipline → `catId` (`MS:6, WS:7, MD:8, WD:9, XD:10`) et le drapeau
`doubles` sont conservés tels quels.

**Profondeur.** On veut le top 250 par discipline. `pageKey=250` en une requête est
à privilégier, mais la réponse observée renvoie `per_page: 100` quand on demande
`pageKey=100` — il faut donc **vérifier à l'implémentation** que l'API honore
`pageKey=250`. Si elle plafonne à 100, on récupère 3 pages de 100 puis on tronque à
250. Le comportement retenu doit être couvert par une assertion : le nombre de
lignes obtenu par discipline vaut `min(250, total)`.

**Champs conservés par ligne** (ajout de deux champs aujourd'hui jetés) :

```json
{
  "rank": 1,
  "rankPrevious": 1,
  "rankChange": 0,
  "points": 97179,
  "tournaments": 18,
  "players": [{ "id": "64032", "slug": "…", "name": "…", "country": "…" }]
}
```

`points` est converti en nombre (l'API renvoie la chaîne `"97179.0000"`). Les noms
sont débarrassés de leurs balises HTML par le `stripTags` existant.

### 3. Stockage brut — `data/rankings/`

```
data/rankings/publications.json
data/rankings/2025-06-10.json
data/rankings/2025-06-17.json
…
data/rankings/2026-07-28.json
```

Un fichier par publication, nommé par sa date, contenant son `publicationId`, sa
date, sa semaine et les 5 disciplines.

**Poids réel, mesuré après backfill** (l'estimation initiale de ce spec, ~7 Mo,
était fausse d'un facteur 2,3) : **274 Ko par fichier** (1 250 lignes), soit
**16 Mo** pour 60 semaines — 12,4 % de `data/`, qui pèse déjà 129 Mo. Ces JSON
compressent 4,2×, donc l'empreinte réelle dans `.git` est de **~3,9 Mo**
(`.git` passe de 18 à ~22 Mo). Coût jugé justifié pour une donnée irremplaçable.

Ce répertoire est **délibérément hors de `data/<année>/`** : l'historique traverse
2025 et 2026, un découpage annuel obligerait à recoller les morceaux à chaque
lecture pour aucun bénéfice.

**Suppression de l'ancien instantané.** `data/<année>/rankings/world.json` est
supprimé, ainsi que son chargement en `build-data.mjs:57`. La publication courante
n'est plus un cas particulier : c'est le fichier le plus récent de la série. Cela
retire une branche de code au lieu d'en ajouter une.

### 4. Backfill one-shot — `backfill-rankings.mjs`

Script à lancer une fois, avec reprise sur incident :

1. récupérer l'index (section 1), le valider, le fusionner avec l'index local
   existant puis l'écrire ;
2. pour chaque publication de l'index, si `data/rankings/<date>.json` est absent,
   la télécharger et l'écrire ;
3. journaliser la progression (`n/60`).

Le point 2 rend le script **relançable sans perte** : une interruption réseau se
reprend là où elle s'est arrêtée. Un `--force` permet de réécrire.

Coût : **1 requête d'index** + 300 à 900 requêtes de téléchargement (60 publications
× 5 disciplines × 1 à 3 pages selon que l'API honore `pageKey=250`), soit **10 à 20
minutes**. Il n'y a plus de phase de découverte.

### 5. Run hebdomadaire — `fetch-rankings.mjs`

Le script devient une **synchronisation** plutôt qu'un ajout, ce qui le rend
strictement plus robuste :

1. récupérer l'index depuis `vue-rankingweek` (1 requête) et le valider ;
2. le fusionner avec l'index local (les entrées locales sorties de la fenêtre de
   60 semaines sont conservées, jamais écrasées) ;
3. télécharger **toutes** les publications de l'index dont le fichier est absent ;
4. réécrire l'index fusionné.

L'idempotence vient de l'existence du fichier `data/rankings/<date>.json`, donc de
l'identité BWF elle-même. Deux propriétés en découlent gratuitement :

- un run lancé plusieurs fois le même jour ne fait rien la deuxième fois ;
- **un run manqué se rattrape tout seul.** Si le cron ne tourne pas pendant trois
  semaines, le run suivant voit trois fichiers manquants et les télécharge. La
  conception précédente (« ajouter la publication courante ») laissait un trou
  définitif dans ce cas — c'est la principale amélioration apportée par la
  découverte de l'endpoint.

Ce mécanisme n'a pas de garde-fou « id supérieur au dernier connu » : il n'en a plus
besoin, puisqu'on ne déduit plus aucune date d'un ordre d'arrivée.

`package.json` : la cible `refresh` reste inchangée dans sa forme
(`update && fetch-rankings && scrape-odds && build-data`).

### 6. Génération des données front — `build-data.mjs`

Le chargement de `world.json` est remplacé par une lecture de la série :

- **publication courante** = fichier de date maximale → alimente le `worldMeta` /
  `ranking.worldRanking` existant (`build-data.mjs:90` et `:443`), de sorte que
  tout ce qui consomme déjà le classement courant continue de fonctionner à
  l'identique ;
- **historique par joueur** → nouvelle série ajoutée à chaque fiche joueur, à côté
  de l'`elo` existante (`build-data.mjs:156`) :

```json
"worldRank": [
  { "t": "2025-06-10", "rank": 12, "points": 54320, "disc": "MS" },
  { "t": "2025-06-17", "rank": 11, "points": 55100, "disc": "MS" }
]
```

Un joueur peut apparaître dans plusieurs disciplines (un joueur de double joue
aussi le mixte) : la série est donc **groupée par discipline**, comme l'est déjà
`eloByDisc` côté `Player.jsx`.

Les entrées sont indexées par `players[].id`, qui est dans le **même espace d'ids**
que les draws et donc que les clés Elo — le rapprochement est direct, sans matching
approximatif (déjà documenté dans `lib/rankings.mjs`).

### 7. Affichage — `EloChart.jsx`

Le composant reçoit une seconde série optionnelle `rankPoints`.

**Le vrai travail est l'échelle X.** Aujourd'hui `xFrac` est calculé depuis le seul
tableau `points` (`EloChart.jsx:19-23`) : le domaine temporel est déduit du premier
et du dernier point de l'Elo. Il faut le généraliser à un domaine **partagé** par
les deux séries (`min` et `max` de l'union des timestamps), sinon les deux courbes
ne s'alignent pas dans le temps. Les deux séries deviennent alors deux tracés sur
une même géométrie.

**Deux axes Y.**

- gauche : cote Elo, inchangé ;
- droite : rang mondial, **inversé** (rang 1 en haut). Ainsi « la courbe monte » =
  « le joueur progresse » pour les deux séries, ce qui est la condition pour que la
  superposition soit lisible plutôt que trompeuse.

**Rendu.** Ligne pointillée dans une couleur distincte pour le rang, prise dans les
variables CSS de `web/src/styles.css` (jamais de couleur en dur). Légende
identifiant les deux séries et leur axe. L'aire de remplissage reste réservée à
l'Elo, pour ne pas charger le graphe.

**Trous de série.** Un joueur sorti du top 250 disparaît de la donnée. La courbe est
tracée **avec interruption** (segments séparés), jamais par un trait droit qui
relierait deux points distants : ce serait affirmer une continuité qu'on n'a pas
mesurée.

**Cadence différente assumée.** L'Elo est ponctuel (un point par match, timestamps
irréguliers), le classement est hebdomadaire régulier. Les deux cohabitent sur
l'axe temps sans rééchantillonnage ni interpolation.

**Survol.** Le crosshair existant cible le point Elo le plus proche. Il affiche en
complément le rang mondial de la semaine correspondante quand elle existe.

**Contraintes projet.** Le skill `ui-ux-pro-max-skill` est invoqué avant toute
modification de ce composant (règle du `CLAUDE.md`). SVG en `viewBox` +
`width: 100%` (déjà le cas), rendu vérifié à ~375px, légende lisible en contraste
AA, `aria-label` du graphe mis à jour pour décrire les deux séries.

## Tests

Le repo teste par `node --test test/*.test.mjs` sur des fixtures JSON
(`test/fixtures/`), sans réseau. On suit ce modèle.

- `test/publications.test.mjs` — normalisation d'une réponse `vue-rankingweek`
  capturée en fixture (tronquage de `"2026-07-28 00:00:00"` au jour, tri par date),
  fusion index local / index API, et surtout **les quatre garde-fous échouent
  bien** : liste vide ou champ manquant, date qui n'est pas un mardi, trou dans la
  suite hebdomadaire, ancre présente avec une mauvaise date.
- `test/rankings-parse.test.mjs` — normalisation d'une réponse `vue-rankingtable`
  capturée en fixture : `points` chaîne → nombre, `rankPrevious`/`rankChange`
  présents, balises HTML retirées des noms, troncature à 250, simple vs double,
  et repagination quand l'API plafonne `per_page`.
- `test/rank-history.test.mjs` — construction de la série `worldRank` par joueur
  à partir de plusieurs publications : groupement par discipline, ordre
  chronologique, joueur présent dans deux disciplines, joueur engagé dans deux
  paires la même semaine (meilleur rang retenu), joueur absent d'une semaine
  (le trou ne doit pas être comblé).

La fixture de réponse API est capturée depuis l'appel réel puis réduite à quelques
lignes par discipline, comme `test/fixtures/oddsportal-2026-07-30.json`.

## Décisions

**Top 250 par discipline plutôt que le classement complet.** Le complet pèse 1,5 Mo
par publication, soit ~90 Mo versionnés dans un repo public — inacceptable. Le top
**Profondeur validée par mesure, après coup.** L'ancien `world.json` avait une
profondeur illimitée (8 157 lignes) ; la série est plafonnée à 1 250. Le passage
au top 250 fait donc perdre son rang mondial à 1 136 des 1 999 entités Elo
(56,8 %), ce que ce spec n'avait pas anticipé. Mesure faite sur la population qui
compte réellement — les **125 matchs à venir**, c'est-à-dire la surface de pari :

| Indicateur | Valeur |
|---|---|
| Rang mondial médian des camps | **65** |
| 90ᵉ centile | 151 |
| 99ᵉ centile | 397 |
| Couverture à 250 | **97,6 %** (203/208 camps classés) |
| Couverture à 500 | 99,5 % |

Les 56,8 % « perdus » sont donc massivement des entités historiques (joueurs ayant
joué depuis 2024 et qui ne rejoueront pas), pas la surface de pari. Le coût réel
est de **5 camps sur 208** (2,4 %), typiquement des qualifiés. Et 42 camps n'ont de
rang à aucune profondeur — paires de double éphémères, jamais classées.

Décision confirmée : **top 250**, sans fichier de profondeur totale en complément.

Le top 250 tient en 16 Mo sur disque et ~3,9 Mo dans `.git` (mesuré), reste lisible
et diffable en clair, et couvre tous les
joueurs susceptibles d'entrer en tableau principal sur le World Tour. L'alternative
gzip (~9 Mo, couverture 100 %) a été écartée : elle rend les diffs git inutilisables
et impose une décompression au build pour un gain de couverture qui ne sert pas
l'objectif de pari.

**Dates lues, jamais déduites.** La conception initiale déduisait les dates d'une
ancre par arithmétique hebdomadaire, faute d'endpoint connu. La découverte de
`vue-rankingweek` a rendu cette déduction inutile — et a montré qu'elle aurait
échoué : les écarts d'id réels vont de 4 à 50, alors que l'algorithme supposait
7 à 30. Toute datation calculée est désormais interdite dans ce module.

**Index de publications versionné mais rafraîchi.** L'API n'expose que 60 semaines
glissantes ; l'index local doit donc survivre à ce que l'API oublie. Il est
rafraîchi à chaque run et **fusionné**, jamais remplacé.

**`rank_previous` / `rank_change` conservés.** Déjà présents dans la réponse et
aujourd'hui jetés. Ils donnent la variation hebdomadaire sans recalcul et
constituent un contrôle de cohérence gratuit sur notre propre chaînage des semaines.

**Axe du rang inversé.** Sans inversion, une amélioration de classement ferait
descendre la courbe pendant que l'Elo monte : le lecteur conclurait à une
divergence là où les deux signaux concordent. L'inversion est ce qui rend la
comparaison honnête.

## Limites connues

- **L'historique commence au 2025-06-10**, parce que la fenêtre de l'API s'arrête
  là, alors que l'Elo remonte à `data/2024/`. Les fiches joueurs montreront donc
  une courbe Elo plus longue que la courbe de classement.
- **La fenêtre de 60 semaines est glissante et l'oubli est définitif.** Chaque
  semaine qui passe, l'API perd sa publication la plus ancienne. Tout ce qui n'est
  pas dans `data/rankings/` avant d'en sortir est perdu. Le backfill est donc
  urgent, et son commit obligatoire.
- **Sortie du top 250 = trou dans la série.** Visible comme une interruption de
  courbe, ce qui est le comportement voulu.
- **Si `vue-rankingweek` change de forme**, les garde-fous arrêtent le script sans
  rien écrire. Échec bruyant, pas silencieux — mais il faudra alors réinspecter
  l'API. La méthode qui a permis de la trouver est consignée : intercepter les
  requêtes de `https://bwfbadminton.com/rankings/` avec Playwright.
- **10 à 20 minutes de scrape** pour le backfill initial, en une passe, hors CI
  (1 requête d'index + 300 à 900 requêtes de téléchargement).

## Ordre d'implémentation

1. `lib/publications.mjs` (index + validation) + ses tests, garde-fous d'abord.
2. Généralisation de `lib/rankings.mjs` + tests de parsing.
3. `backfill-rankings.mjs`, lancement réel, vérification des 60 fichiers, **commit
   immédiat** (fenêtre glissante).
4. Refonte de `fetch-rankings.mjs` en synchronisation.
5. `lib/rank-history.mjs` (séries `worldRank`) + tests.
6. `build-data.mjs` : bascule sur la série, suppression de `world.json` et de son
   cas particulier.
7. `EloChart.jsx` : échelle X partagée, second axe, légende
   (après `ui-ux-pro-max-skill`), vérification à 375px.

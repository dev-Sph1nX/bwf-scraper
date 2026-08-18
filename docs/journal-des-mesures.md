# Journal des mesures

**Dernière mise à jour :** 2026-08-10 (§9)

Ce document consigne **tout ce qui a été mesuré**, avec les chiffres, la méthode et
le moyen de le refaire. Il existe pour une raison précise : ne pas retester ce qui
l'a déjà été, et ne pas reproposer de bonne foi un facteur déjà écarté.

Les résultats **négatifs y ont autant de place que les positifs** — ce sont eux
qu'on oublie et qu'on refait.

## Comment refaire les mesures

```bash
npm run backtest        # baselines, calibration, prévisibilité par discipline
npm test                # 277 tests, dont les garde-fous méthodologiques
npm run build-data      # régénère les données de l'app
node measures/mesure-gymnase-3sets.mjs   # effet gymnase sur les 3 sets (§7)
node measures/mesure-terrain.mjs         # avantage du terrain (§2.6)
node measures/mesure-ecart-points.mjs    # écart de points, étape 1 (§2.7)
node measures/mesure-roi-modele.mjs      # BANC D'ESSAI du modèle (§9) — après build-data
node measures/mesure-calibration-tranches.mjs  # calibration tranche × discipline (§9.1)
```

Le rapport complet est écrit dans `web/public/data/backtest.json` et affiché sur
la page `/fiabilite`. Tous les intervalles de confiance sont calculés par bootstrap
à **graine fixe** : deux exécutions donnent exactement les mêmes bornes.

## La méthode de validation d'un facteur

Établie avec le propriétaire du projet. Un facteur doit franchir **trois** étapes,
et sauter la première ou la deuxième conduit à des erreurs opposées :

| Étape | Question | Outil |
|---|---|---|
| 1. **Isolation** | ce facteur porte-t-il de l'information ? | `lib/screen.mjs` |
| 2. **Ajustement conjoint** | en apporte-t-il **en plus des autres** ? | `lib/logistic.mjs` |
| 3. **Hors échantillon** | le gain survit-il sur des données neuves ? | réglage 2024-2025, vérification 2026 |

**Pourquoi l'étape 1 est indispensable.** Un test conditionnel — comparer le
résultat observé à la probabilité prédite par l'Elo — peut **masquer** un effet
réel, parce que celui-ci se noie dans la variance d'un échantillon aux écarts de
niveau hétérogènes. L'isolation se fait donc à **niveau contrôlé** : on ne garde
que les matchs entre entités d'Elo quasi identique, la référence devient un 50 %
propre, et aucune hypothèse sur la justesse de la probabilité Elo n'est requise.

**Pourquoi l'étape 2 est indispensable.** Deux facteurs peuvent être excellents
séparément et porter la **même** information. Les pondérer tous les deux revient à
la compter deux fois. La régression donne à chacun son poids *marginal*, ce qu'il
ajoute une fois les autres connus.

**Pourquoi l'étape 3 tranche.** Sélectionner les facteurs *est déjà* une forme
d'ajustement. Screener et régler sur les mêmes données surapprend deux fois.

---

# 1. Le modèle : ce qui prédit

## 1.1 Comparaison des méthodes

Backtest **en marche avant** sur 13 370 matchs (2024-01-09 → 2026-07-30) : chaque
match est prédit avec l'état des connaissances **d'avant ce match**.

| Méthode | Réussite | Brier | n |
|---|---|---|---|
| Hasard | 50,0 % | 0,250 | 13 370 |
| Tête de série | 63,5 % | 0,365 | 951 |
| **Classement mondial officiel** | **68,7 %** | 0,313 | 11 512 |
| **Elo (le nôtre)** | **71,8 %** | **0,189** | 8 798 |

Sur 2026 seul, jamais utilisé pour aucun réglage : **71,4 %**.

**Duel décisif** — sur les 8 750 matchs où les deux se prononcent, l'Elo bat le
classement mondial de **+3,1 points**, intervalles de confiance **disjoints**.
L'écart de Brier est plus net encore (0,189 contre 0,313), parce que le classement
désigne un vainqueur sans dire à quel point il est sûr.

**Non départageables** : « tête de série » et « classement mondial » (63,9 % contre
64,5 % sur 925 matchs, intervalles qui se chevauchent). Logique — le placement des
têtes de série *est* dérivé du classement.

**Couverture** : l'Elo s'abstient quand une entité a moins de 5 matchs joués, soit
34 % des rencontres. Il n'y a pas de pronostic sur celles-là.

## 1.2 Comparaison au marché — la seule qui décide de gagner de l'argent

Sur **47 matchs** du Taipei Open 2026 appariés à leur cote :

| | Réussite | Brier |
|---|---|---|
| Bookmaker | 68,1 % | **0,1923** |
| Notre Elo | 68,1 % | 0,2064 |

Même réussite, mais le bookmaker est **mieux calibré**. Et il prend **9,5 % de
commission** (overround mesuré) : pour gagner, il ne suffit pas de l'égaler.

**n = 47 : ce n'est pas un verdict**, l'intervalle serait énorme. Et la mesure est
optimiste pour nous — ces cotes sont les dernières observées, mais notre Elo a été
calculé avec le recul. Le test propre exige de figer la prédiction *avant* le match
et de la comparer à la cote de clôture : c'est l'objet de l'historisation (§4).

## 1.3 Calibration : le modèle est trop TIMIDE

Sur les 10 tranches de probabilité, **les 10 vont dans le même sens** : le favori
gagne plus souvent qu'annoncé. Biais moyen **+3,0 points**.

| Annoncé | Observé |
|---|---|
| 52 % | 57 % |
| 72 % | 78 % |
| 92 % | 97 % |

Présent sur les trois années (+2,94 / +3,31 / +2,50 pt), donc pas un artefact de
démarrage.

**Correction retenue** (`lib/calibrate.mjs`) : étirement des log-cotes, appliqué
**seulement là où le défaut est démontré**. Facteur ajusté par année puis borné par
bootstrap ; seuls ceux dont l'intervalle **exclut 1** sont retenus :

| Discipline | 2024 | 2025 | 2026 | IC bootstrap | Retenu |
|---|---|---|---|---|---|
| Simple dames | 1,42 | 1,53 | 1,34 | [1,38 ; 1,66] | **oui (1,50)** |
| Double dames | 1,38 | 1,27 | 1,37 | [1,14 ; 1,52] | **oui (1,31)** |
| Double mixte | 1,19 | 1,16 | 0,92 | [1,02 ; 1,32] | non — instable |
| Double messieurs | 1,02 | 1,03 | 1,19 | [0,93 ; 1,16] | non — 1 est dedans |
| Simple messieurs | 1,13 | 0,97 | 0,84 | [0,88 ; 1,18] | non — 1 est dedans |

**Constat de fond : la sous-confiance ne concerne que les disciplines féminines.**

Effet : erreur de calibration **2,98 → 1,20 pt** (−60 %), réussite **inchangée au
centième** (l'étirement ne change jamais qui est favori — un test le verrouille).

**Un facteur global unique était contre-productif** : il dégradait la calibration
(3,00 → 3,13 pt) en moyennant des besoins opposés.

**Pourquoi ça compte alors que le gain de précision est nul.** Parier est une
décision à **seuil**. Un favori sous-estimé implique un outsider surestimé
d'autant, et le signe de la valeur attendue s'inverse : un outsider à la cote 4,00
a besoin de 25 % pour valoir le pari ; annoncer 28 % au lieu de 22 % transforme un
pari perdant en « opportunité ». C'est un prérequis de **sécurité**, pas une
amélioration du modèle.

## 1.4 Réglage des paramètres de l'Elo : aucun gain

Les 5 paramètres avaient été choisis à la main au démarrage et jamais évalués.
Balayage avec sélection sur 2024-2025 et vérification sur 2026 :

| Paramètre | Actuel | Meilleur sur la sélection | Effet sur 2026 |
|---|---|---|---|
| `scale` (échelle Elo→proba) | 400 | 300 | réussite **−0,20 pt** |
| `k` | 32 | 48 | réussite **−0,48 pt** |
| `threeSetMultiplier` | 0,85 | 1,0 | réussite −0,12 pt |
| `kProvisional` | 48 | 80 | réussite +0,04 pt |
| **Combinaison** | | | **+0,00 pt**, calibration 3,02 → 3,45 pt |

Le log loss s'améliore sur la sélection (0,5607 → 0,5550) mais **ne se transfère
pas**. Signature du surapprentissage. **Valeurs actuelles conservées.**

À noter : `threeSetMultiplier` optimal vaut **1,0**, soit *aucune* décote des
victoires en 3 manches. L'hypothèse de départ du projet (« un 2-1 informe moins
qu'un 2-0 ») n'est pas soutenue par les données — mais l'effet sur 2026 étant nul,
rien ne justifie de changer.

---

# 2. Les facteurs testés

## 2.1 Criblage en isolation, à niveau contrôlé

Trois fenêtres d'écart d'Elo. Un facteur qui ne dépasse pas 50 % de façon
significative ne porte aucune information exploitable.

| Facteur | < 30 | < 50 | < 80 | Verdict |
|---|---|---|---|---|
| Fraîcheur, écart ≥ 20 min | **56,0 %** | **57,2 %** | **55,6 %** | ✅ retenu |
| Repos (moins de jours d'arrêt) | **55,6 %** | **55,1 %** | **55,4 %** | ✅ retenu |
| Fraîcheur (tout écart) | **54,7 %** | **54,1 %** | **53,1 %** | ✅ retenu |
| Classement mondial | **53,0 %** | **53,4 %** | **54,4 %** | ✅ retenu |
| Forme récente | 48,7 % | 50,4 % | 51,4 % | ❌ écarté |
| Face-à-face | 46,6 % | 50,4 % | 52,3 % | ❌ écarté |
| Tête de série | 54,4 % | 50,4 % | 54,2 % | ❌ écarté |
| Expérience (plus de matchs joués) | 49,8 % | 50,0 % | 50,2 % | ❌ écarté |

**Deux enseignements majeurs.**

**La forme récente et le face-à-face ne prédisent rien à niveau égal** — 48,7 % et
46,6 % sur les matchs les plus serrés, donc *sous* le hasard. Ils ne
« fonctionnaient » que par leur corrélation au niveau, que l'Elo dit déjà mieux.
⚠️ **L'app les affiche pourtant comme des indices utiles** (forme sur la fiche
joueur, alerte H2H dans le prédicteur) : à revoir.

**Contrôle de validité de la méthode** : l'« expérience », qu'on n'attendait pas
prédictive, ressort à 49,8 / 50,0 / 50,2 %. La méthode ne fabrique pas de faux
signaux.

## 2.2 Ajustement conjoint — poids marginaux

Ajustés sur 6 359 matchs (2024-2025), intervalles par bootstrap :

| Variable | Poids marginal | Intervalle | Verdict |
|---|---|---|---|
| Écart Elo | **1,296** | [1,19 ; 1,42] | ✅ |
| Fraîcheur **à seuil** (≥ 20 min) | **0,111** | [0,04 ; 0,23] | ✅ |
| Repos | **−0,087** | [−0,14 ; −0,02] | ✅ |
| Forme récente | 0,136 | [0,09 ; 0,19] | ⚠️ voir ci-dessous |
| Face-à-face | 0,056 | [0,03 ; 0,13] | ⚠️ voir ci-dessous |
| Fraîcheur (écart continu) | −0,030 | [−0,13 ; 0,06] | ❌ redondante |
| Classement mondial (log) | −0,001 | [−0,12 ; 0,15] | ❌ redondant |
| Têtes de série | 0,011 | [−0,02 ; 0,06] | ❌ redondant |

⚠️ **Forme et face-à-face passent l'étape 2 mais échouent l'étape 1.** Leur poids
marginal est significatif, et pourtant le criblage à niveau contrôlé les donne
*sous* le hasard (48,7 % et 46,6 %). C'est le cas d'école qui justifie de faire
**les deux** tests : la régression capte leur corrélation au niveau, que
l'isolation démasque. Ils sont donc écartés.

**Le classement mondial n'apporte rien au-delà de l'Elo.** Seul, il prédit à
68,7 % ; ajouté à l'Elo, sa contribution marginale est indiscernable de zéro.

**Le signe du repos est négatif** : l'inactivité nuit. Cela confirme l'intuition de
départ du propriétaire (« faire baisser l'Elo quand on ne joue pas ») — mais comme
signal séparé, pas comme décote de la note.

**C'est la forme à SEUIL qui survit, pas la proportionnelle** : l'effet est un
palier, pas une progression (cf. §2.4).

## 2.3 Vérification hors échantillon : NON DÉPARTAGEABLE

Sur 2 439 matchs de 2026 jamais vus par l'ajustement :

| | Réussite | Brier |
|---|---|---|
| Elo recalibré | **71,4 %** | **0,1899** |
| Modèle additif | 71,0 % | 0,1902 |

Non départageable sur les deux métriques. Et **aucun sous-ensemble ne gagne** :

| Sous-ensemble | n | Brier |
|---|---|---|
| Fraîcheur active | 699 | 0,1962 → 0,1968 ❌ |
| Fraîcheur active **et** match serré | 329 | 0,2385 → 0,2361 ❌ |
| Matchs serrés | 1 078 | 0,2373 → 0,2360 ❌ |

**L'arithmétique explique tout** : la fraîcheur n'est active que sur **29 %** des
matchs, **13 %** en croisant avec « match serré ». Un effet de 2 points sur 13 %
des matchs pèse **0,26 point** sur l'ensemble — il faudrait environ **dix fois
plus** de matchs de vérification pour le distinguer de zéro.

**Conclusion : l'Elo recalibré reste le meilleur prédicteur disponible.** Les
facteurs sont réels mais trop rares pour être exploitables.

## 2.4 La fatigue, en détail

Investigation approfondie, plusieurs mesures successives.

**L'écart de charge se construit bien avec les tours** :

| Tour | Matchs | Écart nul | Écart médian | ≥ 20 min |
|---|---|---|---|---|
| 1er match | 3 698 | **100 %** | 0 | 0 % |
| 2e match | 2 477 | 2 % | 16 min | 43 % |
| 3e match | 1 456 | 1 % | 25 min | 60 % |
| 4e match | 768 | 1 % | 31 min | 66 % |
| 5e match | 379 | 1 % | 35 min | 71 % |

**Mais l'effet ne suit pas** : significatif uniquement au 2e match (+4,6 pt,
[1,9 ; 6,9]), puis +1,2 / +2,9 / −0,9 pt. **L'effet est le plus fort là où l'écart
est le plus petit** — le contraire d'une relation dose-effet.

**Pas de relation dose-effet.** Régression sur les 5 019 matchs avec écart : pente
**0,55 pt par 30 min**, intervalle **[−0,94 ; 2,06]** — zéro dedans. Détail par
tranche erratique : −0,2 / +2,5 / +3,3 / −1,6 / +3,5 / −1,0.

**Pousser le seuil détruit l'échantillon** : ≥120 min d'écart ne concerne que
**40 matchs** sur 13 370. Structurel — dans un tableau à élimination directe, les
deux joueurs ont disputé le même nombre de tours (88,7 % des cas), l'écart ne vient
que de la durée.

**Le nombre de matchs joués n'est pas mesurable** : 991 matchs seulement avec un
écart (11,3 %), effet +1,8 pt [−0,6 ; 4,5]. Il faudrait ~2 000-2 500 matchs.

**Simple contre double : hypothèse non soutenue.** Double +3,2 pt [0,9 ; 5,6]
significatif, simple +2,2 pt [−0,4 ; 4,7] non — mais **les intervalles se
chevauchent largement**, les deux ne sont pas départageables.

**Le taux brut est trompeur.** À partir du 3e match, le plus frais gagne 55 à 60 %
du temps — mais **l'Elo l'attendait déjà** (59,5 % observé contre 59,6 % prédit).
Le plus frais est aussi le plus fort : Elo moyen **1652 contre 1580**, et il est le
mieux noté dans **68 %** des cas. Il gagne parce qu'il est meilleur, pas parce
qu'il est frais.

**Le critère seul vaut 55,7 %** contre 71,2 % pour « le mieux noté », sur les mêmes
matchs. Et surtout : dans les **42 %** de matchs où les deux critères désignent des
joueurs **différents**, la fraîcheur a raison **31,7 %** du temps contre **68,3 %**
pour l'Elo. Elle n'a raison que quand elle est d'accord avec l'Elo — donc quand
elle n'apporte rien.

**Ce qui est malgré tout établi** (isolation à niveau contrôlé) : à niveau égal, le
plus frais gagne **54,9 à 57,2 %** au lieu de 50 %. L'effet existe, il est juste
inexploitable en agrégat.

## 2.5 Facteur écarté sur décision, vérification faite

**« L'adversaire sortait d'un 3 manches »** sortait **premier** du criblage
(57,5 / 57,3 / 55,6 %). Écarté sur décision du propriétaire, après vérification :

- 93 % d'accord avec « fraîcheur ≥ 20 min » (330 cas sur 355)
- ses 113 matchs propres donnent 56,6 % **[46,9 ; 65,5]** — non significatif

Ce n'était pas un signal distinct : un match qui part au 3e set est un match long.

**Test discriminant fatigue / information** : au 2e tour, sur 692 matchs à écart
≥ 20 min, la répartition est **89 %** « frais 2-0 / fatigué 2-1 », 7 % « les deux
2-0 », 5 % « les deux 2-1 », et **0 %** de cas inverse. Le cas qui isolerait la
fatigue pure (marge identique, durée différente) ne compte que 45 matchs, et le
cas contradictoire **n'existe jamais**. Les deux explications sont **collinéaires
par construction** : impossible de les départager avec ces données.

---

## 2.6 L'avantage du terrain : réel, petit, et seulement en SIMPLE

*Mesuré le 2026-07-31 — `node measures/mesure-terrain.mjs`.*

« À domicile » = tous les joueurs du camp ont le code pays du tournoi (code
extrait du drapeau, le champ texte étant un nom anglais). 1 569 matchs ont
exactement un camp à domicile et deux Elo non provisoires — **12 % des matchs**.

| Test | Résultat |
|---|---|
| Conditionnel (vs proba Elo) | domicile gagne **55,8 %** contre 53,6 % attendus : **+2,2 pt**, z = 2,0 |
| **Isolation, \|ΔElo\| ≤ 50** | **55,6 %** (349 matchs, z = 2,1) |
| Isolation, \|ΔElo\| ≤ 100 | **55,5 %** (634 matchs, z = 2,8) |

L'effet survit à l'isolation à niveau contrôlé : ce n'est **pas** un artefact de
la sous-confiance de l'Elo (§1.3). Ordre de grandeur : **≈ 16 points d'Elo**.

Par discipline (conditionnel) : tout l'effet est en **simple** — MS z = 1,7 et
WS z = 1,7, rien d'interprétable en double (MD 0,8 ; WD −0,3 ; XD 0,2).

**Limites.** Le facteur ne touche que 12 % des rencontres — le piège documenté :
un facteur rare ne déplace pas les métriques agrégées, même réel (cf. fraîcheur,
§2.4). Et une part de l'effet peut être de la **sélection** (wild-cards et
invitations locales font entrer des joueurs du pays plus motivés/avantagés que
leur Elo ne le dit). Étapes 2 (apport marginal) et 3 (hors échantillon) **non
faites** : à faire avant toute intégration au modèle.

## 2.7 L'écart de POINTS : le plus fort criblage jamais mesuré ici

*Mesuré le 2026-07-31 — `node measures/mesure-ecart-points.mjs`. Étape 1 seulement.*

L'Elo ne compte que les manches : 21-19 et 21-5 produisent la même mise à jour.
Facteur testé : la **domination passée** — part moyenne de points gagnés sur les
10 derniers matchs (0,5 = équilibre), accumulée chronologiquement et lue avant
mise à jour (mêmes garanties anti-fuite que le jeu de données). Le facteur
désigne le camp le plus dominateur (écart minimal d'1 pt de %) ; il se prononce
sur **8 752 matchs** (~65 %).

| Fenêtre \|ΔElo\| | n | Réussite | IC 95 % |
|---|---|---|---|
| ≤ 30 | 910 | **58,4 %** | [55,2 ; 61,6] ✅ |
| ≤ 50 | 1 483 | **57,2 %** | [54,7 ; 59,8] ✅ |
| ≤ 80 | 2 283 | **57,9 %** | [55,9 ; 59,9] ✅ |

Significatif sur les **trois** fenêtres. Référence : la fatigue plafonnait à
56-57 % sur une fraction des matchs, la forme à 48,7 %. À niveau Elo égal, celui
qui écrase ses adversaires aux points bat celui qui gagne petit — l'information
existe, l'Elo ne la voit pas, et elle agit sur les deux tiers des rencontres.

**Ne pas confondre** avec le `threeSetMultiplier` (§1.4) : lui ne compte que les
MANCHES, et son balayage ne portait que sur le poids de mise à jour de l'Elo —
pas sur un signal de points par match.

**Étapes restantes avant intégration** : 2) ajustement conjoint (la domination
apporte-t-elle quelque chose EN PLUS de l'Elo et des autres facteurs ? — c'est le
vrai risque : elle est corrélée au niveau) puis 3) vérification hors échantillon
sur 2026. Un facteur qui brille en isolation peut mourir en marginal — forme et
face-à-face l'ont prouvé.

## 2.8 Elo-bis à marge de points : mieux partout, mais PAS prouvé sur 2026

*Mesuré le 2026-07-31 — `node measures/mesure-elo-points.mjs`. Idée du
propriétaire : injecter l'écart de points dans la CONSTRUCTION de la note (un
21-5 met à jour plus fort qu'un 21-19), plutôt que comme signal externe.*

Implémentation : `pointsFactor` dans `lib/elo.mjs` (0 = désactivé, production
inchangée — verrouillé par test). Multiplicateur linéaire autour de la marge de
référence mesurée (part de points du vainqueur − 0,5 = **0,078** en moyenne),
borné [0,25 ; 2,5], avec option d'**amortissement anti-autocorrélation** façon
FiveThirtyEight (une victoire large du favori annoncé compte moins que la même
victoire par l'outsider — sans ce frein, les notes des dominants s'envolent).

Protocole : grille réglée sur 2024-2025, verdict sur 2026 seul, comparaison
**appariée** sur exactement les mêmes 2 439 matchs.

| | log loss | Brier | Réussite |
|---|---|---|---|
| Sélection 24-25 — Elo actuel | 0,5558 | 0,1881 | 71,9 % |
| Sélection 24-25 — meilleure variante (factor 1,5 + amorti) | **0,5489** | 0,1854 | 72,0 % |
| **2026 — Elo actuel** | 0,5615 | 0,1910 | 71,4 % |
| **2026 — variante** | 0,5593 | 0,1904 | 71,1 % |

Δ log loss 2026 (variante − actuel) : **−0,0022, IC 95 % [−0,0079 ; +0,0035]**
→ **NON DÉPARTAGEABLE**. Trois nuances honnêtes :

- le signe est favorable **partout** (les 6 configs de la grille battent
  l'actuel en sélection, et la meilleure reste devant sur 2026) — ce n'est pas
  le profil d'un pur surapprentissage comme au §1.4, où le « gain » s'inversait ;
- mais l'intervalle contient 0 et la réussite brute recule (71,1 vs 71,4 %) :
  au standard du projet, **on n'adopte pas** ;
- l'amplitude est petite parce que l'info de marge est en partie redondante
  avec ce que l'Elo apprend déjà en accumulant les victoires.

**Décision : variante conservée dans le code (désactivée), à re-mesurer quand
2026 sera plus fourni** — l'IC se resserre avec les matchs. Si le −0,002 tient
avec un intervalle qui exclut 0, on l'adopte.

---

# 3. Prévisibilité par discipline

Mesurée **à information constante** : le favori est toujours celui que l'Elo
simple désigne, pour que les disciplines soient comparables entre elles.

| Discipline | Brier | Le favori gagne | Surprises | n |
|---|---|---|---|---|
| **Simple dames** | **0,168 ± 0,008** | 76,0 % | 24,0 % | 2 038 |
| Double dames | 0,172 ± 0,009 | 76,7 % | 23,3 % | 1 363 |
| Double mixte | 0,186 ± 0,010 | 72,3 % | 27,7 % | 1 519 |
| Double messieurs | 0,198 ± 0,008 | 69,9 % | 30,1 % | 1 642 |
| **Simple messieurs** | **0,214 ± 0,007** | 66,0 % | 34,0 % | 2 236 |

**Non départageables** (intervalles qui se chevauchent) : WS/WD, WD/XD, XD/MD. Il
serait abusif de les traiter différemment dans le modèle. Seul **MS** se distingue
nettement.

**L'hypothèse de départ était à moitié fausse.** Le propriétaire supposait « XD le
plus stable, MS le moins ». MS est bien le moins prévisible — mais le plus stable
est le **simple dames**, pas le double mixte (3e).

## 3.1 Décomposition par niveau de confiance

Le taux de surprise global mélange deux phénomènes : un match donné à 51 % y compte
autant qu'un match donné à 95 %.

| Discipline | Serrés 50-60 % | Nets 60-75 % | **Francs 75-90 %** | Écrasants 90 %+ |
|---|---|---|---|---|
| Simple dames | 41,4 % | 25,4 % | **10,9 %** | 1,8 % |
| Double dames | 35,8 % | 25,8 % | **13,2 %** | 4,4 % |
| Double mixte | 43,5 % | 29,1 % | **18,0 %** | 3,6 % |
| Double messieurs | 43,6 % | 31,7 % | **17,0 %** | 3,6 % |
| Simple messieurs | 43,4 % | 34,2 % | **20,9 %** | 2,9 % |

**Sur les matchs serrés, toutes les disciplines se tiennent** (41-44 %) : un
pile-ou-face reste un pile-ou-face, cette colonne ne distingue rien.

**C'est la colonne « francs » qui départage** : 10,9 % contre 20,9 %, presque le
double. Là on ne peut plus invoquer l'indécision du modèle.

Et MS a **35 %** de matchs serrés contre 25-29 % ailleurs : il cumule un plateau
plus homogène **et** plus de surprises à confiance égale.

---

# 4. Historisation des cotes

**Démarrée le 2026-07-30.** Aucun historique antérieur n'existe — les cotes du
passé ne sont pas récupérables.

**Stockage** : `data/odds/runs/<horodatage>.json`, un fichier par passage, jamais
réécrit. L'append-only est structurel : un nom horodaté ne peut pas entrer en
collision.

**Mesuré à ce jour** : commission du bookmaker **9,5 %** en moyenne (overround).

**Deux défauts corrigés :**

1. `matchOdds` écartait les matchs joués **avant** de tenter l'appariement, donc
   jetait les cotes de clôture — la donnée la plus précieuse du projet.
2. Le drapeau `settled` d'oddsportal est une propriété **de l'instant du relevé**,
   traitée comme une vérité intemporelle : un match scrapé la veille reste marqué
   « à venir » après avoir été joué. Corrigé en faisant autorité sur nos données.
   Cotes classées à tort « orphelines » : **21 → 1**.

**Ce que ça débloquera** : la comparaison à la cote de clôture, seul étalon qui
dise si le modèle peut rapporter. Il faut au moins deux relevés d'un même match
pour voir un mouvement — donc quelques jours de scraping.

---

# 5. Abandonné définitivement

| Piste | Raison |
|---|---|
| **Arbitrage multi-bookmakers** | la source ne fournit qu'une cote **agrégée** par côté, sans opérateur nommé. La formule de détection produirait des opportunités **fantômes** (cotes non simultanées, limites de mise ignorées). Piège actif, pas raccourci imparfait. |
| **Avantage du gaucher** | aucune donnée de latéralité dans les 13 champs joueur de l'API BWF. |
| **Style de jeu** | `lastPointWinner` et `serve` sont **toujours `null`** : pas de point par point. |
| **Météo / conditions d'air** | lieu et dates présents pour 100 % des tournois, mais sans coordonnées. Géocodage + API externe pour un signal marginal. |
| **Glicko-2** (repoussé, pas abandonné) | proposé pour corriger la surconfiance sur les joueurs peu actifs. Or le défaut mesuré est **l'inverse** (sous-confiance). Reste utile pour afficher un intervalle, mais n'est plus prioritaire. |
| **Panneau « POURQUOI » à 5 signaux** | les signaux ne battent pas l'Elo (§2.3). Un panneau attribuant des points à des signaux sans valeur prédictive produirait de la **confiance sans fondement** — pire qu'aucune explication. |

---

# 6. Erreurs commises, et ce qu'elles ont appris

Consignées parce qu'elles sont instructives et qu'elles pourraient se répéter.

| Erreur | Détection | Leçon |
|---|---|---|
| Conclure que la fraîcheur ne valait rien | criblage à niveau contrôlé | un test conditionnel peut **masquer** un effet réel |
| Retenir forme et face-à-face (poids « significatifs » 0,136 et 0,055) | criblage à niveau contrôlé | un poids significatif peut n'être que de la corrélation au niveau |
| Annoncer « 3 points à récupérer » via la recalibration | mesure du gain réel | erreur de calibration ≠ gain de performance |
| Variable de fraîcheur **linéaire** | mesure par tranches | l'effet est un **palier**, pas une proportion |
| Variable de fraîcheur **globale** | duels par sous-ensemble | l'effet se concentre sur les matchs serrés |
| Taux de surprise global | question du propriétaire | mélangeait pile-ou-face et vraies surprises |
| `process.exit()` dans un `try` | revue de code | saute le `finally`, laissait Chromium orphelin 6 j/7 |
| `team1seed` stocké en **chaîne** | test de type | `"10" < "9"` en lexicographique aurait inversé le baseline |
| Fenêtre de découverte `+7…+30` | interception de l'API | les écarts réels vont de **4 à 50** |
| `marginMultiplier` hors de `computeElo` | contrôle d'effet | surcharger le paramètre restait **sans effet** |

**Le fil commun** : chaque erreur a été trouvée par une **mesure**, jamais par
relecture. D'où les garde-fous en tests — notamment celui qui vérifie qu'un facteur
sans lien avec le résultat **ne ressort pas** (`test/screen.test.mjs`), et le test
anti-fuite du jeu de données (`test/dataset-leak.test.mjs`), le seul dont l'échec
serait invisible.

---

# 7. Effet gymnase sur les matchs en 3 sets

*Mesuré le 2026-07-31 — `node measures/mesure-gymnase-3sets.mjs`. Intuition du
propriétaire : dans certaines salles, un côté du terrain est défavorisé
(courants d'air) → matchs plus accrochés → plus de 3 sets. Le marché « match en
3 sets » existe chez les bookmakers.*

**Verdict : l'effet lieu est réel, fort, et STABLE d'une année sur l'autre.**

Méthode : 13 368 matchs, gymnase = ville du tournoi (normalisée). Le taux de
3 sets attendu de chaque gymnase est contrôlé par la composition de ses affiches
(tranche d'écart Elo de 50 × discipline, taux empiriques globaux — aucune
hypothèse de calibration). z par gymnase = (observé − attendu)/écart-type.

| Test | Résultat |
|---|---|
| Taux global de 3 sets | 32,8 % |
| Sur-dispersion (35 lieux ≥ 60 matchs) | Σz² = 86 pour 35 attendus → **+6,1 σ** : le hasard est exclu |
| **Persistance N → N+1** (37 paires) | **r = 0,42** — le classement d'une année prédit la suivante |

Extrêmes (z au-delà de ±2) :

| Gymnase | Matchs | 3 sets obs. | Attendu | z |
|---|---|---|---|---|
| Séoul | 152 | 42,8 % | 32,8 % | +2,7 |
| Changzhou | 440 | 37,3 % | 31,5 % | +2,6 |
| Shenzhen | 303 | 37,6 % | 31,8 % | +2,2 |
| Lucknow | 353 | 25,8 % | 33,9 % | −3,2 |
| Sarrebruck | 324 | 24,7 % | 33,3 % | −3,3 |
| Sydney | 515 | 23,9 % | 32,5 % | **−4,2** |

**Ce qui est prouvé / pas prouvé.** Un effet *lieu* stable est prouvé. Son
*mécanisme* (courants d'air, vitesse du volant, altitude, sol) est indiscernable
dans ces données — et pour parier sur « plus/moins de 3 sets », le mécanisme
importe peu. Limites : regroupement par ville (pas par salle) ; le contrôle par
écart d'Elo ne capture pas tout ce qui rend un plateau homogène — mais la
persistance inter-années ne peut pas venir d'un défaut de contrôle ponctuel.

**Suite logique.** Relever les cotes « nombre de sets » chez les bookmakers
(marchés déjà présents dans leurs flux) et confronter : le marché price-t-il
Sydney et Séoul pareil ? L'écart éventuel est la valeur exploitable.

# 8. Étude de rentabilité : suivre les pronos PERD de l'argent (2026-08-04)

**Question.** En misant 1 € sur chaque prono du modèle aux cotes réelles
(backfill Flashscore 2026 : 1398 matchs prono+cotes, 19 tournois, meilleure
cote entre Betclic/Unibet/Winamax), gagne-t-on de l'argent ?

**Méthode.** `lib/roi.mjs` (+22 tests), rapport `web/public/data/roi.json`,
page /rentabilite. Probas figées d'avant match (Elo recalibré, le même que le
backtest), mise plate 1 €, IC 95 % par bootstrap (500 tirages, graine 42).
Refaire : `npm run build-data` (ligne « ROI : … » en console).

| Stratégie (clôture) | Paris | ROI | IC 95 % |
|---|---|---|---|
| Favori (1 € sur notre pick) | 1398 | **−8,2 %** | [−11,5 ; −5,1] — perte PROUVÉE |
| Value EV>0 (meilleure cote) | 709 | −7,3 % | [−17,4 ; +3,2] |
| Value EV>0,20 | 270 | −0,0 % | [−21,9 ; +23,8] |
| Tranche 90-100 % (favori) | 234 | −1,1 % | [−4,8 ; +1,8] |
| Désaccord marché (cote pick > 2) | 72 | −3,5 % | [−28,4 ; +20,8] |

**Lecture.** La perte « favori » ≈ la marge du bookmaker (6-9 %) : le modèle ne
la compense pas. Le value betting ne prouve PAS qu'on bat le marché (IC
contient 0 mais point négatif). Signaux les moins mauvais : les quasi-
certitudes (90-100 %) frôlent l'équilibre, et exiger EV>0,20 remonte vers 0 —
sans jamais passer positif. À l'ouverture, même tableau (favori −7,0 %).

**Par bookmaker** (favori, clôture, panier commun de 553 paris) : Winamax
−10,8 % < Unibet −11,3 % < Betclic −12,1 %. Prendre la meilleure des 3 cotes
récupère ~3 points de ROI (−8,2 % contre −11/−12 % mono-compte) : comparer
les comptes est le levier le plus sûr mesuré ici.

**Ce qui est prouvé / pas prouvé.** Prouvé : suivre naïvement le favori du
modèle perd de l'argent. Pas prouvé : qu'une stratégie sélective (EV élevée,
hautes confiances) soit rentable — les IC sont trop larges, il faut plus de
saison. Limite : cotes Flashscore = clôture/ouverture d'agrégateur, pas
forcément la cote réellement disponible au moment où on aurait cliqué.

## 8.1 ROI par discipline : le simple DAMES surnage, MS et XD coulent (2026-08-04)

Découpage du journal des paris de §8 par discipline (même méthode, IC bootstrap).
Refaire : filtrer `roi.json .bets` par `disc` et agréger via `lib/roi.mjs`.

| Favori, clôture | Paris | ROI | IC 95 % |
|---|---|---|---|
| **WS** | 317 | **−2,5 %** | [−9,1 ; +3,9] |
| WD | 231 | −5,7 % | [−13,0 ; +1,3] |
| MD | 248 | −6,5 % | [−14,9 ; +1,2] |
| XD | 275 | −11,2 % | [−19,6 ; −4,4] — perte prouvée |
| MS | 327 | **−14,3 %** | [−22,0 ; −6,7] — perte prouvée |

Le classement est le MÊME aux deux instants et en value (WS value clôture :
+0,7 % [−12,8 ; +14,3] ; MS value : −17,6 %). Croisement le plus net :
**favori WS à confiance ≥ 80 % : +1,3 % [−3,5 ; +5,5] sur 176 paris** — seule
case quasi neutre avec du volume.

**Lecture.** Cohérent avec §3 (WS = discipline la plus prévisible pour le
modèle) : là où le modèle est le plus fort, il rattrape la marge du bookmaker.
MS/XD : le modèle est le plus faible ET le marché n'y est pas plus tendre.

**Garde-fou.** Découpage exploratoire : en regardant 5 disciplines, la
meilleure paraît toujours bonne (biais de sélection). AUCUNE case n'est
prouvée positive. À retester quand le backfill 2024-2025 aura triplé
l'échantillon — si WS reste en tête hors échantillon, là ce sera un signal.

## 8.2 CLV : le modèle bat la cote de clôture — premier signal positif PROUVÉ (2026-08-04)

CLV (Closing Line Value) = cote prise à l'ouverture / meilleure cote de clôture
du même camp − 1. Positive : le marché a fini par nous donner raison. C'est le
test standard d'un avantage réel, indépendant de la chance des résultats.
Refaire : `roi.json .clv` (calcul dans `lib/roi.mjs`, IC bootstrap).

| Paris à l'ouverture | n | Battent la clôture | CLV moyenne | IC 95 % |
|---|---|---|---|---|
| Favori | 1387 | 49,5 % | **+1,28 %** | [+0,93 ; +1,66] — prouvé |
| **Value EV+** | 761 | **62,7 %** | **+3,11 %** | [+2,22 ; +4,16] — prouvé |

Et la CLV **prédit** la performance : ROI (ouverture) des paris qui battent la
clôture −4,2 % (favori) / −5,4 % (value), contre −9,7 % / −14,5 % pour les
autres.

**Lecture.** Quand le modèle voit de la valeur à l'ouverture, le marché bouge
ensuite DANS NOTRE SENS bien plus souvent que le hasard : le modèle possède un
vrai contenu informationnel en avance sur le marché. Mais l'avantage (+3 % de
cote) ne couvre pas la marge du bookmaker (~7 %) : d'où un ROI encore négatif.
Conséquences : (a) parier tôt, jamais à la clôture ; (b) l'écart à combler est
chiffré : ~4 points — c'est l'objectif du chantier « là où le modèle saigne ».

**Croisements WS (exploratoires, AUCUN prouvé positif)** : favori WS 80-90 % :
+2,0 % [−8,9 ; +12,1] (62 paris) ; 90-100 % : +0,9 % [−3,6 ; +5,0] (114 paris) ;
value WS : points positifs à presque tous les seuils d'EV mais n minuscules
(EV>0,20 : +15,4 % sur 22 paris, IC [−46 ; +79]). À revoir après le backfill
2024-2025.

## 8.3 Hypothèses GELÉES avant le hors-échantillon 2024-2025 (2026-08-04)

Les croisements de /rentabilite font briller des cases vertes. Toutes sont
exploratoires (biais de sélection, IC contenant 0) : on fige ICI, AVANT de voir
les données 2024-2025, les stratégies candidates. Le backfill Flashscore
2024-2025 servira de test hors échantillon — une case choisie après coup ne
compte que si elle ressort positive sur ces données neuves.

1. **WS et XD seraient les deux disciplines exploitables** (posée par Lucas,
   2026-08-04) : le simple dames et le double mixte sont suspectés d'être les
   plus « prévisibles » pour nous face au marché — chacun par une voie
   différente en 2026 : WS via le favori (−2,5 % au global, +1,3 % à confiance
   ≥ 80 %, seule discipline où le modèle rattrape presque la marge) ; XD via le
   value (colonne de seuils d'EV entièrement positive, mais net porté par
   3 paris dont 2 cotes à 9 — à confirmer impérativement). Nuance à trancher :
   pour le MODÈLE seul (§3), WS est bien la plus prévisible mais XD est parmi
   les pires — l'hypothèse XD est donc « le marché price encore plus mal le
   mixte que nous », pas « notre modèle y est bon ».
2. **Parier à l'ouverture plutôt qu'à la clôture** (CLV §8.2, seule hypothèse
   déjà PROUVÉE en 2026) : à confirmer sur 2024-2025.

Verdict attendu : IC hors de 0 sur 2024-2025 pour adopter ; sinon, retour au
chantier modèle (lot C n° 0).

## 8.4 Hors-échantillon 2024-2025 : H1 rejetée, H2 confirmée (2026-08-05)

**Prérequis réalisé le 2026-08-04/05 :** backfill Flashscore 2024-2025 complet
— 62/62 tournois joués couverts (manquent 2 annulés + JO), 8 130 matchs avec
cotes au total, jointure 7 982/8 064 (99 %, 0 ambigu), **étude ROI sur 6 297
matchs prono+cotes** (×4,5). Présentation d'ensemble :
[`bilan-backfill-cotes-2024-2025.md`](bilan-backfill-cotes-2024-2025.md).
Méthode : `tools/flashscore/backfill-odds.mjs --seasons=2024,2025` (pages
archives + fenêtres de dates pour les éditions encore « courantes » + `--cats=`
pour les Mondiaux). Verdicts calculés sur les paris `matchTime < 2026` du
journal `bets[]` de `web/public/data/roi.json` (mise plate, IC normal 95 %).

**❌ H1 (« WS et XD exploitables ») rejetée des deux côtés :**
- WS favori clôture : −6,0 % [−9,2 ; −2,7] (n=1 092) ; à confiance ≥ 80 % :
  −4,4 % [−8,4 ; −0,4] (n=264) — le +1,3 % de 2026 ne se reproduit pas ;
- XD value clôture : **−22,1 % [−35,9 ; −8,3]** (n=480) ; à EV ≥ 0,20 :
  −22,9 % [−43,4 ; −2,3] — la colonne verte de 2026 était bien 2 cotes à 9.

**✅ H2 (« parier à l'ouverture ») confirmée, en comparaison appariée**
(même stratégie aux deux instants, sur les mêmes matchs, 2024-2025) :
favori +2,0 pts [+1,7 ; +2,2] (n=4 888), value +2,8 pts [+1,4 ; +4,3]
(n=2 087). L'ouverture rend *moins perdant*, pas gagnant ; l'écart s'érode
d'année en année (value : +5,8 % en 2024 → +2,8 % en 2025 → +0,4 % en 2026).

**Au global, les IC tranchent désormais** : favori −9,6 % [−11,2 ; −8,1]
(n=6 287), value −14,5 % [−19,2 ; −10,0] (n=3 094) — la stratégie value, « non
départagée » sur 2026 seul, est prouvée perdante et pire que le favori. 2024
est uniformément pire (−12,7 %, S1 comme S2) : Elo à faible historique toute
l'année, à pondérer dans les mesures fines. Conséquence actée par le protocole
du §8.3 : **retour au chantier modèle (lot C n° 0)**, avec le banc d'essai
[`banc-essai-modele.md`](banc-essai-modele.md) désormais alimenté.

---

# 9. Le banc d'essai du modèle : construit, validé, premiers verdicts (2026-08-10)

**Le script du protocole [`banc-essai-modele.md`](banc-essai-modele.md) existe :
`measures/mesure-roi-modele.mjs`.** C'est désormais LE passage obligé de toute
modification du modèle (facteur âge, Elo à marge de points, calibration…).

**S'en servir :**

```bash
npm run build-data                        # prérequis : la jointure prono ↔ cotes
node measures/mesure-roi-modele.mjs       # table par défaut (référence + elo-brut)
node measures/mesure-roi-modele.mjs --toutes --annees=2025,2026  # + variantes d'étude
node measures/mesure-roi-modele.mjs --devig=power                # sensibilité au dé-vig
```

Une variante = une entrée dans le tableau `VARIANTES` du script : `p(row)` rend
la proba (team1) d'avant match, `prepare(rows)` (optionnel) ajuste ses
paramètres **en marche avant** (jamais avec des données du match jugé).

**Comment il tient le protocole.** Probas d'avant match par le crochet
`onMatch` de `lib/elo.mjs` (le même rejeu walk-forward que le backtest et que
la prod) ; cotes lues dans la **jointure de production**
(`web/public/data/pronos/*.json`, écrite par build-data — pas de deuxième
jointure qui pourrait diverger) ; mêmes matchs pour toutes les variantes ;
paris construits par `lib/roi.mjs` (stratégie value EV>0, meilleure cote,
probas arrondies au pourcent comme dans l'app) ; graine 42 partout ; dé-vig
multiplicatif par défaut, `power` et `Shin` en test de sensibilité. Un contrôle
de parité recalcule la proba de prod et la compare à celle des fichiers
pronos : **0 écart sur 6 297 matchs**.

**Validation (non-régression contre les chiffres publiés) :**

| Chiffre | Publié (§8/§8.2, roi.json) | Banc d'essai |
|---|---|---|
| ROI favori clôture | −9,64 % (n=6 287) | −9,63 % (n=6 286) |
| ROI value clôture | −14,49 % (n=3 094) | −14,32 % (n=3 088) |
| CLV value ouverture 2024-2026 | +5,94 % | +5,97 % |
| CLV value ouverture 2026 seul | +3,11 % (n=761, §8.2) | **+3,11 % (n=761)** — exact |

Les micro-écarts viennent de 11 matchs sans proba marché exploitable (aucun
bookmaker ne cote les deux camps à plus de 1,00 à la clôture), écartés du banc
car M0/M1 y sont incalculables.

**La table de référence (2024-2026, 6 286 matchs jugés, dé-vig mult, graine 42) :**

| modèle | M0 Δll global | M0 Δll paris | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC 95 %] | log loss | calib. |
|---|---|---|---|---|---|---|---|
| elo-recalibré (réf) | +0,0198 | +0,0528 | −6,42 % [−7,1 ; −5,7] | +5,97 % [+5,5 ; +6,5] | (référence) | 0,5472 | 1,1 pt |
| elo-brut | +0,0236 | +0,0522 | −4,62 % [−5,3 ; −3,9] | +6,14 % [+5,6 ; +6,7] | **−3,5 pt [−5,9 ; −1,4]** | 0,5509 | 2,1 pt |

Lecture : M0 > 0 = le marché prédit mieux que nous (attendu, cf. §1.2) ; M1
négatif = en moyenne nos paris achètent des cotes que la clôture dé-viggée juge
perdantes (c'est la marge non compensée) ; M2 positif = mais pris à l'ouverture
ils battent la clôture (§8.2) ; M3 : l'elo-brut fait perdre **3,5 points de ROI
de plus** que la référence sur les mêmes matchs, IC entièrement négatif — le
contrôle de cohérence attendu (la recalibration §1.3 vaut de l'argent réel, pas
seulement de la calibration).

**Leçon de méthode découverte en validant : le dé-vig multiplicatif peut MAL
CLASSER les variantes sur M1.** Sous `mult`, l'elo-brut paraît meilleur que la
référence (M1 −4,62 % contre −6,42 %) ; sous `power` et `shin` (qui modélisent
la marge chargée sur l'outsider), l'ordre s'inverse (−36,2 % contre −30,8 %) —
et c'est cet ordre-là que confirme l'argent réel (M3 : brut pire de 3,5 pts,
prouvé). Explication : l'elo-brut, trop timide, surestime les outsiders et
mise dessus ; le dé-vig multiplicatif redistribue la marge au prorata et rend
ces cotes d'outsiders artificiellement « pas si mauvaises ». **Règle
pratique : ne jamais lire M1 sans sa ligne de sensibilité (imprimée par le
script) ; si le classement dépend de la méthode de dé-vig, c'est M3 qui parle.**
Au passage, cela éclaire le « saignement » des tranches moyennes (§3.1, §8) :
la marge y est structurellement plus chère pour l'outsider que ne le dit la
lecture multiplicative.

## 9.1 Calibration tranche × discipline : la piste « un 75 % vaut 68-70 % » ne tient PAS (2026-08-10)

**Question (lot C n° 0).** La tranche 70-80 % perd le plus en ROI ; suspicion
d'un défaut de calibration localisé, d'autant que le correctif §1.3 n'a été
appliqué qu'à WS/WD alors que MS/XD sont les pires en ROI (§8.1).

**Méthode.** `node measures/mesure-calibration-tranches.mjs` (options
`--annees=`, `--paries`) : prédictions walk-forward 2024-2026 (8 840 matchs),
probabilité repliée sur le favori, 5 tranches × 5 disciplines, IC 95 %
binomial (Wilson) sur la fréquence observée ; une case est « en défaut » si la
proba annoncée sort de l'IC. Garde-fou : 25 cases testées à 95 % ≈ 1 fausse
alerte attendue — ne lire que les motifs cohérents.

**Modèle de production (annoncé → observé, ⚠️ = significatif) :**

| | 50-60 | 60-70 | 70-80 | 80-90 | 90-100 | toutes |
|---|---|---|---|---|---|---|
| MS | 54,9→56,4 (777) | 65,0→62,4 (684) | 74,8→73,8 (504) | 84,3→84,6 (247) | 92,0→97,1 (35) | 66,2→65,9 |
| WS | 55,0→57,4 (420) | 65,0→66,4 (360) | 74,9→71,8 (390) | 85,3→87,9 (405) | **95,0→93,0 (470) ⚠️** | 75,7→75,9 |
| MD | 54,7→56,4 (477) | 65,0→65,5 (443) | 74,8→78,2 (399) | 84,3→83,6 (274) | 92,5→96,4 (56) | 68,5→70,0 |
| WD | **55,0→62,5 (304) ⚠️** | **65,0→71,1 (287) ⚠️** | 75,0→74,5 (267) | 85,2→84,9 (258) | 94,3→93,0 (257) | 74,0→76,5 ⚠️ |
| XD | 54,9→56,7 (388) | 65,2→69,0 (410) | 74,7→76,8 (341) | 84,5→83,6 (275) | 93,4→96,4 (112) | 70,2→72,3 |
| TOUT | 54,9→57,4 ⚠️ | 65,0→66,1 | **74,8→75,0** | 84,8→85,2 | 94,4→93,8 | |

**Verdicts.**

1. **La suspicion du n° 0 est REJETÉE : la tranche 70-80 % est bien calibrée.**
   74,8 % annoncé → 75,0 % observé au global (n=1 901) ; aucune discipline n'y
   est significative ; sur le sous-ensemble parié (`--paries`, le terrain exact
   de l'étude ROI) : 74,8 → 73,9 (n=1 385), l'annoncé reste dans l'IC. Le
   saignement en ROI de cette tranche n'est donc **pas un problème de modèle**
   mais un problème de **prix** : c'est la zone où la marge du bookmaker,
   chargée sur l'outsider (cf. leçon dé-vig du §9), est la plus chère par
   rapport à notre avantage.
2. **Ne pas avoir corrigé MS/XD (§1.3) était justifié.** MS : 66,2 → 65,9 au
   global, aucune tranche en défaut (les points 2026 confirment même un léger
   excès de confiance non significatif). XD : 70,2 → 72,3, IC contient
   l'annoncé.
3. **Deux défauts résiduels réels, localisés PAR TRANCHE :** WD reste timide en
   bas de gamme malgré le 1,31 (50-60 : 55,0 → 62,5, +7,5 pts ; 60-70 :
   65,0 → 71,1, +6,1 pts) et WS est légèrement sur-corrigée tout en haut
   (90-100 : 95,0 → 93,0, −2,0 pts, n=470). Un étirement de log-cotes ne PEUT
   PAS corriger cela : il agit d'un bloc, dans le même sens, sur toutes les
   tranches d'une discipline. Un correctif par tranche exigerait un modèle à
   2+ paramètres ajusté walk-forward sur des cases de ~300 matchs — au risque
   d'apprendre du bruit ; on ne le tente pas tant qu'un gain M3 n'est pas
   plausible (les paris WD 50-70 et WS 90-100 ne pèsent qu'une fraction du
   volume).

## 9.2 Variante « recalibration walk-forward 5 disciplines » : NEUTRE — production inchangée (2026-08-10)

Correctif candidat passé au banc : le même étirement de log-cotes que §1.3,
mais ajusté **sans fuite** (facteur de l'année N ajusté sur les années < N,
appliqué seulement si l'IC bootstrap exclut 1) et **ouvert aux 5 disciplines**.
Rappel honnête : le facteur de production (WS 1,50 / WD 1,31) a été ajusté sur
2024-2026 entier, période jugée comprise — cette variante teste donc aussi si
la prod tient sans cet avantage.

Facteurs trouvés en marche avant : WS 1,43 (2025) / 1,49 (2026) ; WD 1,38 /
1,31 ; **XD 1,18 en 2026** (IC [1,04 ; 1,35] sur 2024-2025 — la règle mécanique
l'applique, là où §1.3 l'avait écarté pour instabilité) ; MS et MD : 1 (IC
contient 1). Jugement sur 2025-2026 (2024 n'a pas d'antériorité pour
s'ajuster ; 4 233 matchs) :

| modèle | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC 95 %] | log loss | calib. |
|---|---|---|---|---|---|
| elo-recalibré (réf) | −4,02 % | +4,86 % | (référence) | 0,5366 | 1,6 pt |
| elo-brut | −1,38 % | +5,09 % | −5,0 pt [−7,6 ; −2,3] | 0,5411 | 2,2 pt |
| recal-wf-5disc | −4,01 % | +4,88 % | **+0,4 pt [−0,7 ; +1,6]** | 0,5375 | 1,5 pt |

Refaire : `node measures/mesure-roi-modele.mjs --toutes --annees=2025,2026`.

**Verdict : NON DÉPARTAGEABLE (M3 contient 0), la production reste inchangée**
— règle du protocole : on ne touche pas au modèle sans preuve M3. Deux
enseignements quand même :

- **La recalibration de production est validée hors fuite** : un ajustement
  n'utilisant que le passé retrouve quasi exactement ses facteurs et son ROI
  (M1/M2/M3 confondus avec la réf). Le +3,5 pts de la recalibration sur
  l'elo-brut n'était donc pas un artefact d'ajustement rétrospectif.
- **Étendre la correction à XD (1,18) n'apporte rien de mesurable** en argent
  réel : la décision §1.3 de l'écarter ne coûte rien.

La variante reste dans le script (`actif: false`) : elle servira de base de
comparaison aux prochains candidats (âge, Elo à marge de points).

## 9.3 Facteur âge : signal RÉEL au-delà de l'Elo (les jeunes sont sous-cotés), mais variante non départageable en argent (2026-08-10)

**Question (lot C n° 0, jamais mesurée).** Les dates de naissance sont
collectées depuis fin juillet (`data/players/birthdates.json`) : l'âge
apporte-t-il une information EN PLUS de l'Elo ? Deux temps : une mesure
descriptive (le signal existe-t-il ?), puis une variante au banc d'essai §9
(vaut-il de l'argent ?). Logique et mesures : `measures/variante-age.mjs`.

**Les données et la jointure.** `birthdates.json` : 1 432 joueurs, format
`id → {name, country, dob, hand, source, confidence}` — 100 % avec `dob`
exacte (sources : Wikidata 1 274, BWF 158). Jointure par id de joueur, âge
calculé AU JOUR du match (années décimales). Sur les 8 840 matchs prédictibles
du banc (2024-2026, joueurs « provisoires » exclus) : **8 839 matchs ont l'âge
complet des deux camps (100,0 %)**, dans les 5 disciplines — la couverture de
97,7 % pondérée annoncée à la collecte portait sur TOUTES les apparitions ;
une fois retirés les joueurs à moins de 10 matchs (déjà exclus des pronos),
il ne manque plus personne. **En double, l'âge d'une équipe = moyenne des
deux joueurs** (les deux jouent chaque point ; vérifié plus bas que min/max ne
changent rien).

**Mesure descriptive (`node measures/variante-age.mjs`).** Si l'âge n'apportait
rien au-delà de l'Elo, le résidu (victoire observée − proba du modèle de prod)
serait ≈ 0 dans chaque tranche d'écart d'âge. Il ne l'est pas — et le motif est
monotone, pas une case isolée :

| écart d'âge A−B (ans) | n | obs − attendu | IC 95 % |
|---|---|---|---|
| ≤ −8 (A bien plus jeune) | 374 | **+11,0 pt** | [+6,5 ; +15,4] ⚠️ |
| −8 à −3 | 1 873 | +1,3 pt | [−0,6 ; +3,3] |
| −3 à +3 | 4 268 | −1,0 pt | [−2,3 ; +0,3] |
| +3 à +8 | 1 855 | −2,2 pt | [−4,1 ; −0,2] ⚠️ |
| > +8 (A bien plus vieux) | 469 | **−5,4 pt** | [−9,3 ; −1,5] ⚠️ |

Régression logistique du résidu — victoire ~ sigmoïde(logit(p_prod) + b ×
écart d'âge), b en log-cotes par année d'écart, IC bootstrap 500 tirages
graine 42 : **global b = −0,027/an [−0,036 ; −0,018], significatif**. En
clair : à Elo égal, le camp le plus vieux gagne moins souvent que le modèle
ne l'annonce ; l'explication classique est que **l'Elo est en retard sur les
trajectoires** — il sous-note les jeunes qui progressent vite et sur-note les
vétérans qui déclinent. Ordre de grandeur : à 50/50 Elo, 5 ans d'écart
déplacent la vraie proba vers ~53,4 % pour le plus jeune. Le signal est
**concentré en SIMPLE** (MS −0,041 [−0,058 ; −0,023] ; WS −0,044
[−0,065 ; −0,024]) et **absent en double** (MD/WD/XD : IC contiennent tous 0,
que l'âge d'équipe soit moyenne, min ou max), et il est stable en direction
sur les 3 années (2024 −0,014 n.s. ; 2025 −0,020 ⚠️ ; 2026 −0,048 ⚠️).

**La variante `elo-age` (motif recal-wf-5disc, aucune fuite).** Terme b ×
écart d'âge ajouté au logit de la proba de production ; b ajusté PAR
DISCIPLINE en marche avant (année N sur les années < N, minimum 300 matchs),
appliqué seulement si l'IC bootstrap (200 tirages, graine 42) exclut 0 ; pas
d'ordonnée à l'origine (l'écart d'âge est antisymétrique, le modèle reste
symétrique par construction) ; proba de prod inchangée si b = 0 ou date de
naissance manquante. La règle mécanique ouvre la porte à : WS 2025 (−0,055),
WS 2026 (−0,046), MS 2026 (−0,023) — les 7 autres cases restent à 0 (IC
contient 0), en accord avec le descriptif. 2024 reste sans correction (rien
d'antérieur), donc jugement sur 2025-2026 (4 233 matchs, parité prod 0 écart) :

| modèle | M0 Δll global | M0 Δll paris | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC 95 %] | log loss | calib. |
|---|---|---|---|---|---|---|---|
| elo-recalibré (réf) | +0,0161 | +0,0486 | −4,02 % | +4,86 % | (référence) | 0,5366 | 1,6 pt |
| elo-age | +0,0154 | +0,0471 | −3,94 % | +4,87 % | **+0,9 pt [−0,6 ; +2,4]** | 0,5359 | 1,5 pt |

Refaire : `node measures/variante-age.mjs` (descriptif) puis
`node measures/mesure-roi-modele.mjs --variantes=elo-age --annees=2025,2026`.

**Verdict : NON DÉPARTAGEABLE — production inchangée** (règle du protocole :
M3 doit exclure 0 ; +0,9 pt [−0,6 ; +2,4] ne le fait pas). La variante reste
dans le script (`actif: false`). À noter honnêtement, dans les deux sens :

- **Le signal probabiliste, lui, est prouvé** (descriptif significatif), et la
  variante améliore TOUT le tableau d'un cran : meilleur log loss jamais vu
  sur ce banc (0,5359 contre 0,5366), M0 global et « paris » en baisse,
  calibration 1,5 pt, M1 +0,08 pt, sensibilité au dé-vig sans inversion de
  classement (power −28,55 % vs −28,44 % : égalité pratique). Rien ne se
  dégrade — c'est un candidat sérieux à re-juger quand le banc aura plus
  d'années (le coefficient 2026 est le plus fort mesuré : −0,048).
- **Pourquoi si peu d'argent pour un signal si net ?** La correction ne touche
  que le simple (WS dès 2025, MS en 2026 seulement) ; pour l'écart d'âge
  médian (≈ 3 ans) elle ne déplace la proba que d'environ 1,5 pt (MS) à 3 pts
  (WS) autour de 50/50, et la stratégie value ne change de décision que près
  des seuils d'EV : le signal est réel mais son levier monétaire est dilué.

**Limites honnêtes.** Deux années jugées seulement (2025-2026), et le gel
« par discipline » de la variante a été choisi APRÈS avoir vu le descriptif
complet — le motif mécanique (5 disciplines, porte IC) limite ce biais mais ne
l'annule pas ; l'écart d'âge est peut-être le proxy d'autre chose que l'Elo ne
voit pas (montée en gamme des jeunes du circuit secondaire, blessures des
vétérans) — pour parier, peu importe la cause, mais l'extrapoler serait
hasardeux ; enfin la tranche extrême « A plus jeune de 8 ans+ » (n=374,
+11 pts) suggère un effet NON linéaire que le terme linéaire n'exploite pas —
piste ouverte si le facteur repasse au banc.

## 9.4 Avantage du terrain — étapes 2 et 3 : marginal réel mais NON DÉPARTAGEABLE au banc (2026-08-10)

*Mesuré le 2026-08-10 — `node measures/variante-terrain.mjs` (étape 2) puis
`node measures/mesure-roi-modele.mjs --variantes=elo-terrain --annees=2025,2026`
(étape 3, banc d'essai). Fait suite au §2.6 (étape 1 : isolation passée,
+2,2 pt, simple seulement).*

**En une phrase : le facteur terrain apporte bien quelque chose EN PLUS de
l'Elo (étape 2 passée, de justesse), mais il touche trop peu de matchs pour
faire bouger le banc d'essai — M3 non départageable, on n'adopte pas.**

### Étape 2 — apport marginal, à Elo donné

La question : l'Elo capte-t-il déjà l'effet domicile ? Réponse par **ajustement
conjoint** : on garde la formule de proba Elo telle quelle et on n'ajoute qu'un
seul paramètre libre, un bonus H (en points d'Elo) au camp à domicile, ajusté
par maximum de vraisemblance. Si H ressort de zéro, le facteur ajoute de
l'information que l'Elo n'a pas. Même définition du « domicile » que l'étape 1
(tous les joueurs du camp ont le code pays du tournoi, exactement un camp à
domicile), simple (MS+WS) seulement puisque §2.6 n'a rien prouvé en double.

Sur 8 840 matchs rejoués (2024-2026, Elo non provisoire des 2 côtés), 736
matchs de simple ont exactement un camp à domicile :

| Ajustement (MLE, IC bootstrap 1000 tirages, graine 42) | H (points d'Elo) | IC 95 % | Verdict |
|---|---|---|---|
| **Simple (MS+WS), 2024-2026** | **+30,4** | **[+2,7 ; +57,5]** | ✅ exclut 0 |
| MS seul (n=390) | +28,5 | [−8,9 ; +67,7] | 0 dans l'IC |
| WS seul (n=346) | +32,7 | [−5,9 ; +74,6] | 0 dans l'IC |
| MD (contrôle, n=304) | +18,9 | [−26,0 ; +59,8] | 0 dans l'IC |
| WD (contrôle, n=256) | −8,5 | [−52,0 ; +37,0] | 0 dans l'IC |
| XD (contrôle, n=289) | +5,0 | [−40,2 ; +49,2] | 0 dans l'IC |

Lecture vulgarisée : +30 points d'Elo ≈ +4 points de probabilité sur un match
équilibré. **L'étape 2 passe, de justesse** : l'IC groupé simple exclut 0, mais
son bord bas (+2,7) frôle zéro, et aucune discipline seule n'y suffit (trop peu
de matchs chacune). Cohérent avec l'étape 1 : §2.6 donnait ≈ 16 points d'Elo
toutes disciplines confondues — en ne gardant que le simple (où l'effet vit),
on retrouve logiquement plus.

Δ log loss sur ces 736 matchs, avec vs sans bonus : **−0,0031, IC
[−0,0086 ; +0,0025]** — le signe aide mais l'IC contient 0, et surtout **H est
ajusté sur ces mêmes matchs : ce chiffre est optimiste par construction**.
C'est l'étape 3 qui tranche.

### Étape 3 — hors échantillon, au banc d'essai

Variante `elo-terrain` du banc (`measures/variante-terrain.mjs`) : Elo du camp
à domicile + H, puis la chaîne de production inchangée (recalibration comprise).
H est ajusté **en marche avant** (motif `recal-wf-5disc`, aucune fuite) :
l'année N n'utilise que les années < N, et le bonus n'est appliqué que si son
IC bootstrap (200 tirages, graine 42) exclut 0.

| Année jugée | H ajusté sur le passé | IC | Appliqué |
|---|---|---|---|
| 2024 | — (pas d'antériorité) | — | 0 |
| 2025 (réglé sur 2024, n=223) | +46,4 | [−3,7 ; +104,8] | **0** (0 dans l'IC : rien de prouvé) |
| 2026 (réglé sur 2024-2025, n=554) | +35,6 | [+4,5 ; +77,8] | **+35,6** |

Le garde-fou anti-bruit ne laisse donc passer un bonus qu'en 2026 — c'est
exactement le schéma « réglage 2024-2025, vérification 2026 » de la méthode.

**La ligne du banc (sortie réelle), jugée sur 2025-2026 (4 233 matchs)** :

| modèle | M0 Δll global | M0 Δll paris | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC] | logloss | calib. |
|---|---|---|---|---|---|---|---|
| elo-recalibré (réf) | +0,0161 | +0,0486 | −4,02 % [−4,9 ; −3,0] | +4,86 % [+4,2 ; +5,5] | (référence) | 0,5366 | 1,6 pt |
| **elo-terrain (wf)** | +0,0163 | +0,0489 | −4,04 % [−5,0 ; −3,0] | +4,87 % [+4,3 ; +5,5] | **+0,2 pt [−0,2 ; +0,5]** | 0,5367 | 1,5 pt |

Et sur **2026 seul** (1 398 matchs — le vrai hors échantillon, seul 2026 porte
un bonus) :

| modèle | M0 Δll global | M0 Δll paris | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC] | logloss | calib. |
|---|---|---|---|---|---|---|---|
| elo-recalibré (réf) | +0,0139 | +0,0387 | −6,42 % [−7,3 ; −5,5] | +3,11 % [+2,2 ; +4,0] | (référence) | 0,5515 | 4,0 pt |
| **elo-terrain (wf)** | +0,0144 | +0,0397 | −6,48 % [−7,3 ; −5,5] | +3,13 % [+2,2 ; +4,1] | **+0,5 pt [−0,6 ; +1,7]** | 0,5520 | 3,8 pt |

Sensibilité au dé-vig : le classement réf/terrain ne bouge pas (mult/power/shin
quasi identiques des deux côtés).

### Verdict (règle du banc : décider avec M3, IC hors de 0)

**NON DÉPARTAGEABLE → on n'adopte pas.** M3 = +0,2 pt [−0,2 ; +0,5] sur
2025-2026 et +0,5 pt [−0,6 ; +1,7] sur 2026 seul : le signe est favorable mais
l'IC contient 0 des deux côtés. Les autres métriques n'apportent aucun feu
vert : M0 et M1 se dégradent d'un cheveu, M2 est plate, log loss quasi
identique (seule la calibration s'améliore d'un dixième de point).

C'était le scénario annoncé par §2.6 (« un facteur rare ne déplace pas les
métriques agrégées, même réel ») et il se chiffre : le bonus ne touche que les
matchs de simple avec un camp à domicile, soit **98 des 1 398 matchs jugés de
2026 (7,0 %)** — 8,8 % en 2024, 8,1 % en 2025. Même si le bonus valait +2 pt
de ROI sur ces matchs-là, l'effet global serait ~+0,15 pt : indétectable avec
cet échantillon. **Un M3 non départageable est ici un résultat valide, pas un
échec du facteur** — le marginal existe (étape 2), il est juste trop rare pour
être prouvé rentable aujourd'hui.

**Décision : variante conservée dans le code, désactivée (`actif: false`),
même statut que l'Elo-bis à marge de points (§2.8) — à re-mesurer quand 2026
sera plus fourni.** Deux issues possibles alors : l'IC de M3 se resserre autour
d'un positif (on adopte), ou le bord bas reste sous 0 (on enterre).

### Limites honnêtes

- **Sélection non exclue** : comme au §2.6, une partie de l'effet peut venir
  des wild-cards/invitations locales (joueurs du pays plus en forme que leur
  Elo ne le dit) — le bonus capterait alors un biais d'échantillon, pas un
  vrai avantage du terrain. Indiscernable avec ces données.
- **Bord bas de l'étape 2 à +2,7** : l'IC exclut 0 de justesse ; avec une autre
  graine ou un autre découpage, il pourrait le toucher. L'étape 2 est passée
  au sens strict, pas confortablement.
- **H commun MS+WS, sur l'échelle Elo brute** : pour WS, la recalibration de
  production (étirement 1,50 des log-cotes) amplifie mécaniquement le bonus
  d'environ moitié en logit. Un H par discipline serait plus propre, mais les
  n par discipline ne le supportent pas (aucun IC par discipline n'exclut 0).
- **2025 jugé sans bonus** : le garde-fou (IC sur 2024 seul contient 0) a mis
  H=0 en 2025 ; la comparaison 2025-2026 ne mesure donc l'effet que sur 2026.
  C'est le prix de la règle anti-bruit, assumé.
- **Puissance faible par construction** : 98 matchs touchés en 2026 — le banc
  ne peut pas trancher un effet aussi rare ; il faudra du volume, pas une
  meilleure méthode.
- Appariement des matchs par clé `tournoi|discipline|jour|entités` (la même
  que le banc) : deux matchs des mêmes entités le même jour dans le même
  tableau se confondraient — cas marginal, déjà accepté par le banc.

### Refaire les mesures

```bash
node measures/variante-terrain.mjs                                        # étape 2 + réglages walk-forward
node measures/mesure-roi-modele.mjs --variantes=elo-terrain --annees=2025,2026   # étape 3 (banc)
node measures/mesure-roi-modele.mjs --variantes=elo-terrain --annees=2026        # 2026 seul (hors échantillon strict)
```

Fichiers : `measures/variante-terrain.mjs` (toute la logique : carte domicile,
ajustement MLE, bootstrap, variante du banc, mode autonome étape 2) ;
`measures/mesure-roi-modele.mjs` (edit additif : 1 import + l'entrée
`varianteTerrain` dans VARIANTES, `actif: false` — la production est inchangée).
Non-régression du banc vérifiée après l'edit (favori −9,63 %, value −14,32 %,
CLV +5,97 % : ✅ conformes à roi.json).

## 9.5 Elo-bis à marge de points : TRANCHÉ sur le banc d'essai — on n'adopte pas (2026-08-10)

*Mesuré le 2026-08-10 — lot C n°0 de la roadmap (ex-§2.8). Commandes :
`node measures/mesure-roi-modele.mjs --variantes=elo-points-brut,elo-points-recal-wf,recal-wf-5disc`
(+ `--annees=2025,2026` et `--annees=2026` en sensibilité), et re-run de
`node measures/mesure-elo-points.mjs`. Code des variantes :
`measures/variante-elo-points.mjs` (la production ne bouge pas : `pointsFactor`
reste à 0 dans `lib/elo.mjs`, variantes `actif: false` dans le banc).*

### Rappel vulgarisé : c'est quoi, l'Elo-bis ?

L'Elo actuel ne regarde que **qui a gagné** : un 21-5, 21-5 et un 22-20, 21-19
font monter la note du vainqueur exactement pareil. L'Elo-bis (§2.8) module la
mise à jour par la **domination aux points** — une démonstration compte plus
qu'un match arraché — avec un frein anti-emballement façon FiveThirtyEight (une
victoire large du favori annoncé n'apprend presque rien ; la même victoire par
l'outsider apprend beaucoup). Config figée en §2.8 sur la grille 2024-2025 :
`pointsFactor 1,5 + amorti`, marge de référence mesurée 0,0778 (0,0788 hors
2026 : ce scalaire est une constante du sport, pas un réglage par époque).

Le §2.8 avait conclu « meilleur partout, mais NON DÉPARTAGEABLE sur 2026 seul »
(Δ log loss −0,0022, IC contenant 0) et gelé le code. Deux choses ont changé :
le backfill des cotes 2024-2026 (**6 286 matchs jugés** au lieu de ~1 400) et le
banc d'essai figé (`docs/banc-essai-modele.md`, juge **financier** M3 et non
plus seulement le log loss).

### Méthode — comparaison loyale

- **Walk-forward strict** : un second rejeu `computeElo` avec les paramètres
  Elo-bis, crochet d'avant match (mêmes garanties que la production) ; chaque
  ligne du banc est appariée à sa proba Elo-bis par clé de match. Couverture
  100 % (le code CASSE si une ligne manquait — aucune n'a manqué).
- **Piège évité** : la référence de production est RE-CALIBRÉE (§1.3). Comparer
  l'Elo-bis brut au modèle de prod mélangerait « meilleure note » et « meilleure
  calibration ». Donc deux formes jugées : `elo-points-brut` (tel quel) et
  `elo-points-recal-wf` (recalibré par discipline **en marche avant**, motif
  identique à `recal-wf-5disc` : l'année N corrigée sur les années < N, facteur
  appliqué seulement si l'IC bootstrap exclut 1 — aucune fuite). `recal-wf-5disc`
  était dans le tableau pour l'apples-to-apples. Fait rassurant : les facteurs
  ajustés sur l'Elo-bis retombent sur le même motif qu'en prod (WS ~1,37,
  WD ~1,18-1,30, rien de prouvé en MS/MD ; XD s'active en 2026 côté Elo actuel
  mais pas côté Elo-bis).

### Les chiffres du banc (sortie réelle, dé-vig mult, graine 42)

**2024-2026, 6 286 matchs** (non-régression vs roi.json ✅, parité prod 0 écart) :

| modèle | M0 Δll global | M0 Δll paris | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC] | logloss | calib. |
|---|---|---|---|---|---|---|---|
| elo-recalibré (réf) | +0,0198 | +0,0528 | −6,42 % | +5,97 % | (référence) | 0,5472 | 1,1 pt |
| elo-brut | +0,0236 | +0,0522 | −4,62 % | +6,14 % | −3,5 pt [−5,9 ; −1,4] | 0,5509 | 2,1 pt |
| recal-wf-5disc | +0,0211 | +0,0542 | −6,49 % | +6,00 % | +0,1 pt [−1,5 ; +1,6] | 0,5484 | 0,9 pt |
| **elo-points-brut** | +0,0186 | +0,0481 | −5,53 % | +6,18 % | **−0,1 pt [−3,5 ; +3,1]** | 0,5459 | 0,6 pt |
| **elo-points-recal-wf** | +0,0175 | +0,0468 | −7,01 % | +6,09 % | **+2,2 pt [−1,1 ; +5,5]** | 0,5448 | 0,7 pt |

**2025-2026, 4 233 matchs** : elo-points-brut M3 −2,5 pt [−7,0 ; +1,6] ;
elo-points-recal-wf M3 **+0,9 pt [−3,1 ; +4,9]** (logloss 0,5356 vs réf 0,5366).

**2026 seul, 1 398 matchs** : elo-points-brut M3 −2,3 pt [−9,6 ; +5,4] ;
elo-points-recal-wf M3 **+0,9 pt [−5,6 ; +7,8]** — tout est noyé dans le bruit.

**Re-run de la mesure §2.8 d'origine** (log loss apparié, 2026 passé de 2 439 à
2 481 matchs) : Δ log loss −0,0022, IC 95 % **[−0,0076 ; +0,0033]** → toujours
non départageable, l'intervalle n'a presque pas bougé en 10 jours.

### Verdict selon la règle du banc : ON N'ADOPTE PAS

La règle : décider avec M3, IC bootstrap apparié hors de 0. **Aucune des deux
formes n'y arrive**, sur aucune fenêtre. Et le dossier est plus net que « pas
encore assez de données » :

1. **Le juge financier dégonfle le « meilleur partout » du §2.8.** L'Elo-bis
   brut, celui qui battait l'Elo actuel sur toutes les configs en log loss,
   fait **ΔROI ≈ 0** (−0,1 pt) sur 6 286 matchs — et −2,5 pt sur 2025-2026. Le
   micro-gain de log loss (~−0,002, réel mais jamais hors de l'IC) ne se
   convertit pas en euros.
2. **Le +2,2 pt de la forme recalibrée n'est pas corroboré.** Son M1 — le juge
   d'entraînement — est **pire que la référence partout** (−7,01 vs −6,42 % ;
   −5,01 vs −4,02 % ; −7,22 vs −6,42 %) : au verdict du marché, elle achète des
   cotes légèrement moins bonnes, pas meilleures. Un M3 positif que M1
   contredit, avec un IC qui contient 0, c'est le profil du bruit qui sourit.
3. **La sensibilité au dé-vig confirme la fragilité** : en dé-vig mult,
   elo-points-recal-wf est dernier au M1 ; en power et shin il devient premier
   (−29,38 vs −30,81 % ; −18,19 vs −18,65 %). Un classement qui dépend de la
   méthode de retrait de marge = écarts plus petits que l'incertitude de mesure.
4. À mettre au crédit de l'Elo-bis, pour être honnête : **les garde-fous sont
   ses meilleurs alliés** — meilleur log loss du tableau (0,5448) et meilleure
   calibration (0,6-0,7 pt vs 1,1) sur 2024-2026, M2 (CLV) toujours un cheveu
   au-dessus de la référence (+6,09/+6,18 vs +5,97 %). L'idée n'est pas
   absurde ; son effet est simplement trop petit pour être prouvé, en partie
   parce que la marge de points est redondante avec ce que l'Elo apprend déjà
   en accumulant les victoires (déjà noté en §2.8).

**Décision : le code reste conservé et désactivé (`pointsFactor: 0` en prod),
et on RAYE ce candidat de la liste des espoirs actifs.** Le §2.8 disait « à
re-mesurer quand 2026 sera plus fourni » ; c'est fait, avec 4,5× plus de matchs
et le juge financier : rien à adopter. Rouvrir seulement si une refonte change
la nature du signal (p. ex. marge par set plutôt que par match), pas pour
re-goûter la même config.

### Limites honnêtes

- **2024-2025 a servi à choisir la config** (grille §2.8) : sur la fenêtre
  2024-2026 du banc, ces deux années sont partiellement « à domicile » pour
  l'Elo-bis. La seule fenêtre 100 % hors échantillon pour la config est 2026,
  où l'IC de M3 fait ±7 pts. Ça ne change pas le verdict (même à domicile, M3
  ne sort pas de 0), ça l'aggrave plutôt.
- **La marge de référence (0,0778) est mesurée sur tout l'historique**, comme
  en §2.8 — regard en arrière théorique, mais c'est un scalaire global stable
  (0,0788 hors 2026), pas un paramètre par époque : effet négligeable, vérifié.
- **M3 compare chaque variante à la référence**, pas les variantes entre elles :
  « +2,2 vs +0,1 » (elo-points-recal-wf vs recal-wf-5disc) n'est pas un test
  apparié entre les deux ; ne pas sur-lire cet écart.
- Le banc juge la **stratégie value EV>0 à la clôture** ; un autre style de mise
  (favori, ouverture) pourrait réagir autrement, mais M2 (ouverture) ne montre
  pas non plus d'écart prouvé.

### Fichiers et reproduction

- **Créé** : `measures/variante-elo-points.mjs` — rejeu Elo-bis walk-forward
  (déclenché seulement si demandé, pour ne pas ralentir les autres runs du
  banc) + recalibration marche avant + les deux variantes exportées.
- **Modifié (additif)** : `measures/mesure-roi-modele.mjs` — un import + spread
  `...VARIANTES_ELO_POINTS` dans `VARIANTES` (`actif: false`). Rien d'autre ;
  `lib/elo.mjs` et la production intacts.
- **Rejouer** :
  `node measures/mesure-roi-modele.mjs --variantes=elo-points-brut,elo-points-recal-wf,recal-wf-5disc`
  puis `--annees=2025,2026` et `--annees=2026` ; `node measures/mesure-elo-points.mjs`
  pour le test log loss d'origine. Prérequis : `npm run build-data` déjà passé.

## 9.6 Main dominante (gaucher) : signal descriptif léger mais INSTABLE, variante non départageable au banc — on n'adopte pas (2026-08-10)

*Mesuré le 2026-08-10 — lot C n° 2 de la roadmap, juste après la fin de la
collecte des mains (675 mains dans `data/players/birthdates.json`). Commandes :
`node measures/variante-hand.mjs` (descriptif) puis
`node measures/mesure-roi-modele.mjs --variantes=elo-hand --annees=2025,2026`
(+ `--annees=2026` en sensibilité). Logique et mesures :
`measures/variante-hand.mjs` (calqué sur le facteur âge, §9.3).*

**En une phrase : à Elo égal, le camp gaucher gagne un peu plus souvent que le
modèle ne l'annonce (b = +0,12 par gaucher d'écart, IC [+0,01 ; +0,21]), mais
le signal est fragile — instable d'une année à l'autre, porté par des cases
rares — et la variante `elo-hand` ne fait rien bouger au banc (M3 −0,1 pt
[−0,6 ; +0,4]) : on n'adopte pas.**

### L'hypothèse et le codage

Classique des sports de raquette : les gauchers, rares, imposent des angles que
leurs adversaires ont peu l'habitude de travailler — un avantage que l'Elo
capte peut-être déjà (un gaucher qui gagne grâce à sa main a une note qui
monte). La question du journal est donc, comme pour l'âge : **reste-t-il un
signal AU-DELÀ de l'Elo ?**

Codage : « gaucherie » d'un camp = **nombre de gauchers** (0/1 en simple,
0/1/2 en double) — chaque gaucher d'une paire impose ses angles sur une partie
des échanges, le comptage est l'extension linéaire naturelle (même esprit que
la moyenne d'âge du §9.3) ; écart du match = gaucherie(A) − gaucherie(B),
antisymétrique, donc pas d'ordonnée à l'origine (le modèle reste symétrique).
Vérifié plus bas que le codage binaire « au moins un gaucher » ne change pas
la conclusion en double. Main inconnue pour un seul joueur du match : exclu du
descriptif, et la variante rend la proba de production telle quelle.

### Les données et la jointure

`birthdates.json` porte **675 joueurs à main connue, dont 82 gauchers
(12,1 %)** — l'API BWF (`vue-player-bio`) ne renseigne pas tout le monde,
contrairement aux dates de naissance (100 % au §9.3). Sur les 8 840 matchs
prédictibles du banc (2024-2026) :

- **matchs où la main de TOUS les joueurs est connue : 6 154/8 840 (69,6 %)**
  — les autres sont exclus du descriptif ;
- par discipline : MS 88,7 %, WS 78,1 %, MD 58,5 %, WD 53,8 %, XD 56,4 %
  (en double il faut 4 mains, la couverture chute mécaniquement) ;
- 83,8 % des apparitions de joueurs sont datées en main (les 72,9 % pondérés
  annoncés à la collecte portaient sur toutes les apparitions ; le banc exclut
  déjà les joueurs « provisoires », moins bien couverts) ;
- **19,2 % des camps ont au moins un gaucher** — la rareté annoncée.

### Mesure descriptive (`node measures/variante-hand.mjs`)

Résidu = victoire observée − proba du modèle de prod, pris **du point de vue
du camp le plus gaucher** dans les configurations asymétriques (dans les
configurations miroir — D vs D, G vs G — l'avantage disparaît par
construction : elles servent de contrôle, résidu pris du point de vue du
camp A, arbitraire).

| configuration | n | obs − attendu | IC 95 % |
|---|---|---|---|
| SIMPLE — D vs D (contrôle) | 2 797 | −1,5 pt | [−3,1 ; +0,1] |
| SIMPLE — **G vs D (résidu du gaucher)** | 749 | **+3,1 pt** | [−0,2 ; +6,4] |
| SIMPLE — G vs G (contrôle miroir) | 46 | +7,7 pt | [−5,6 ; +21,0] (trop peu) |
| — dont MS : G vs D | 498 | **+4,3 pt** | [+0,1 ; +8,5] ⚠️ |
| — dont WS : G vs D | 251 | +0,8 pt | [−4,4 ; +6,1] |
| DOUBLE — 0G vs 0G (contrôle) | 1 241 | −0,9 pt | [−3,4 ; +1,6] |
| DOUBLE — **camp plus gaucher** | 1 155 | +1,7 pt | [−0,9 ; +4,3] |
| — dont écart de 2 gauchers | 101 | +7,1 pt | [−2,0 ; +16,2] |
| — dont MD | 420 | +1,6 pt | [−2,6 ; +5,9] |
| — dont WD | 302 | **+6,3 pt** | [+1,2 ; +11,4] ⚠️ |
| — dont XD | 433 | −1,4 pt | [−5,7 ; +2,8] |

Régression logistique du résidu — victoire ~ sigmoïde(logit(p_prod) + b ×
écart de gaucherie), IC bootstrap 500 tirages graine 42 :

- **global b = +0,117 [+0,010 ; +0,205], significatif** — mais le bord bas
  frôle 0 (à 50/50 Elo, un gaucher contre un droitier vaudrait ~52,9 %) ;
- par discipline : MS **+0,203 [+0,022 ; +0,396] ⚠️** ; WD **+0,362
  [+0,064 ; +0,500] ⚠️** (borne haute = le garde-fou numérique ±0,5 de
  l'ajusteur : l'IC est écrasé contre le plafond, signe d'un n trop petit) ;
  WS +0,047, MD +0,122, XD **−0,035** : IC contenant tous 0 ;
- **par année : 2024 +0,132 n.s. ; 2025 +0,196 ⚠️ ; 2026 −0,058 n.s.** — la
  direction ne tient pas en 2026, contrairement au facteur âge (§9.3, stable
  sur les 3 années) ;
- sensibilité au codage en double : comptage +0,096 vs « ≥1 gaucher » +0,111,
  tous deux n.s. — la conclusion ne dépend pas du codage.

### La variante `elo-hand` au banc (motif elo-age, aucune fuite)

Terme b × écart de gaucherie ajouté au logit de la proba de production ; b
ajusté PAR DISCIPLINE en marche avant (année N sur les années < N, minimum
300 matchs à mains connues), appliqué seulement si l'IC bootstrap (200
tirages, graine 42) exclut 0. La porte mécanique ne s'ouvre que pour **une
seule case : WD 2026 (b = +0,419, IC [+0,085 ; +0,500])** — les 8 autres
restent à 0. Conséquence de puissance : la variante ne diffère de la référence
que sur **54 des 1 398 matchs jugés de 2026 (3,9 %)** — encore moins que le
terrain (§9.4, 7 %).

Jugement sur 2025-2026 (4 233 matchs, parité prod 0 écart, non-régression
roi.json ✅) :

| modèle | M0 Δll global | M0 Δll paris | M1 EV/clôture | M2 CLV ouv. | M3 ΔROI vs réf [IC] | log loss | calib. |
|---|---|---|---|---|---|---|---|
| elo-recalibré (réf) | +0,0161 | +0,0486 | −4,02 % | +4,86 % | (référence) | 0,5366 | 1,6 pt |
| **elo-hand** | +0,0163 | +0,0488 | −4,03 % | +4,87 % | **−0,1 pt [−0,6 ; +0,4]** | 0,5367 | 1,6 pt |

Sur **2026 seul** (1 398 matchs, la seule année où la variante agit) : M3
**−0,2 pt [−1,7 ; +1,2]**, log loss 0,5520 vs 0,5515, M0 +0,0144 vs +0,0139.
Sensibilité au dé-vig : aucun changement de classement (mult −4,03 vs −4,02 %,
power et shin identiques à l'arrondi).

### Verdict (règle du banc : décider avec M3, IC hors de 0)

**NON DÉPARTAGEABLE, et rien ne plaide pour insister → on n'adopte pas ;
variante conservée désactivée (`actif: false`).** Contrairement au facteur âge
(§9.3), qui améliorait TOUT le tableau sans être départageable, `elo-hand`
n'améliore **rien** : M3 de signe négatif (−0,1 / −0,2 pt), M0, M1 et log loss
un cheveu plus mauvais, M2 plate. Lecture honnête du dossier :

- **le signal descriptif global existe** (IC hors de 0) mais il est **léger et
  mal assis** : bord bas à +0,01, absent de 3 disciplines sur 5, négatif en
  2026, et les deux cases significatives (MS, WD) sortent d'une grille de
  ~10 tests — à ce niveau, une fausse découverte n'aurait rien d'étonnant ;
- **l'essentiel de l'avantage du gaucher est déjà DANS l'Elo** : un gaucher
  qui gagne grâce à sa main a une note qui monte comme n'importe quel
  vainqueur ; ce qu'on mesure ici n'est que le reliquat ;
- **la puissance est structurellement trop faible** : la seule correction que
  la marche avant autorise (WD 2026) touche 54 matchs jugés. Même un vrai
  effet y serait invisible en argent (leçon du terrain, §9.4).

### Limites honnêtes

- **Biais de couverture plausible** : la main n'est connue que si la fiche BWF
  est remplie — plutôt les joueurs en vue. En double (couverture ~55 %),
  l'échantillon joint n'est pas forcément représentatif du circuit entier.
- **Le garde-fou numérique ±0,5** de l'ajusteur (hérité de `variante-age.mjs`)
  écrase l'IC de WD contre le plafond : le b WD (+0,36, +0,42 en marche avant)
  est en réalité « au moins ça, mal estimé » — un n si petit (302 matchs à
  écart non nul) ne mérite pas mieux.
- **Multiplicité** : ~10 IC regardés au descriptif (disciplines × configs ×
  années) sans correction — les deux ⚠️ isolés valent moins que le global.
- Le contrôle miroir G vs G en simple (n = 46) est trop petit pour vérifier
  quoi que ce soit ; l'écart de 2 gauchers en double (n = 101) idem.
- **2025-2026 jugés, mais 2025 sans correction** (aucun IC ne s'ouvrait sur
  2024 seul) : le M3 de la fenêtre 2025-2026 ne mesure l'effet que sur 2026,
  comme pour le terrain (§9.4). Prix de la règle anti-bruit, assumé.
- La main vient d'une source unique par joueur (API BWF/Wikidata, champ
  déclaratif) : quelques erreurs de saisie sont possibles, non vérifiables ici.

### Refaire les mesures

```bash
node measures/variante-hand.mjs                                          # descriptif + réglages marche avant
node measures/mesure-roi-modele.mjs --variantes=elo-hand --annees=2025,2026   # le banc (juge)
node measures/mesure-roi-modele.mjs --variantes=elo-hand --annees=2026        # 2026 seul (là où la variante agit)
```

Fichiers : **créé** `measures/variante-hand.mjs` (jointure mains, codage,
descriptif, variante marche avant — réutilise l'ajusteur et le bootstrap
exportés par `variante-age.mjs`) ; **modifié (additif)**
`measures/mesure-roi-modele.mjs` — un import + l'entrée `makeVarianteHand()`
dans VARIANTES (`actif: false`). La production est inchangée. Non-régression
du banc vérifiée après l'edit (favori −9,63 %, value −14,32 %, CLV +5,97 % :
✅ conformes à roi.json).

# 10. Le marché « nombre de sets » (2026-08-18)

Lot C n°1. Le marché vainqueur est prouvé perdant pour nous (§8.4 : value
−14,5 %) ; le pari est qu'un marché moins travaillé laisse davantage de place,
d'autant que l'effet gymnase (§7) y est réel et persistant. Trois étapes :
**que sait-on prédire (§10.1) → le prix le sait-il déjà (§10.2) → est-ce
rentable (§10.3)**.

## 10.1 Étape 1 — ce qu'on sait prédire : très peu au-delà du taux de base (2026-08-18)

`node measures/mesure-marche-sets.mjs` — 13 684 matchs joués (2024-2026),
écart d'Elo d'AVANT match (crochet `onMatch`, mêmes garanties anti-fuite que
le backtest), aucune cote regardée à ce stade.

**Taux de base : 32,8 % de matchs en 3 sets.** Stable d'une année sur l'autre
(32,0 % / 32,5 % / 34,5 % — la hausse 2026 est à la limite des intervalles).

Par discipline, l'écart est réel (9 points entre extrêmes, intervalles disjoints) :

| Discipline | n | 3 sets |
|---|---|---|
| MS | 3 046 | **37,2 %** ± 1,7 |
| MD | 2 715 | 33,4 % ± 1,8 |
| WS | 2 738 | 32,7 % ± 1,8 |
| XD | 2 679 | 32,0 % ± 1,8 |
| WD | 2 506 | **28,0 %** ± 1,8 |

Par écart d'Elo, la relation **n'est pas monotone** — fait à retenir :

| ΔElo | n | 3 sets |
|---|---|---|
| 0-50 | 4 205 | 33,9 % |
| 50-100 | 2 561 | **37,6 %** ← sommet |
| 100-150 | 1 982 | 35,5 % |
| 150-200 | 1 496 | 32,9 % |
| 200-300 | 1 971 | 29,8 % |
| 300-400 | 972 | 25,0 % |
| 400+ | 497 | **15,7 %** |

Les matchs les plus serrés (ΔElo < 50) produisent MOINS de 3 sets que la
tranche 50-100. Hypothèse à tester plus tard : cette tranche concentre les
joueurs mal notés (peu de matchs au compteur, Elo proche de la valeur d'amorce)
dont les rencontres sont en réalité déséquilibrées — l'Elo y est du bruit, pas
une égalité de niveau.

**Jugement hors échantillon** (entraînement sur les années strictement
antérieures, log loss, plus bas = mieux) :

| Année testée | n | constante | case disc×ΔElo | modèle A (ΔElo+disc) | modèle B (A + résidu de lieu) |
|---|---|---|---|---|---|
| 2025 | 5 222 | 0,6308 | 0,6308 | **0,6239** | 0,6255 |
| 2026 | 3 476 | 0,6454 | 0,6445 | 0,6435 | **0,6429** |

**VERDICT : le nombre de sets est presque imprévisible au-delà du taux de
base.** Le gain sur la constante est de 1,1 % de log loss en 2025 et 0,3 % en
2026 — à comparer aux 6-8 % de marge que le bookmaker charge sur ce marché.
Le résidu de gymnase pèse pourtant lourd dans les coefficients (+0,203, du même
ordre que l'écart d'Elo à −0,226) mais **n'améliore pas la prédiction hors
échantillon** (pire que A en 2025, mieux de 0,0006 en 2026) : l'effet §7 est
réel en descriptif, il ne se transporte pas en prédiction match par match.

**Calibration hors échantillon (modèle B), le point qui coince :**

| Décile | prédit | observé | écart |
|---|---|---|---|
| 1 | 18,1 % | 21,8 % | +3,8 pt |
| 3 | 27,1 % | 31,6 % | +4,5 pt |
| 7 | 34,9 % | 39,1 % | +4,2 pt |
| 10 | 42,6 % | 37,8 % | −4,8 pt |

Erreur de calibration moyenne **3,06 pt**, et le motif est systématique : le
modèle **étale trop** ses probabilités (46 pt d'étendue prédite pour ~16 pt
d'étendue observée). Il faudra le rétrécir (shrinkage) avant tout pari — une
proba de 42,6 % annoncée qui en vaut 37,8 % transforme un « pari value » en
perte mécanique.

**Ce que ça implique pour les étapes suivantes.** L'edge ne viendra pas d'une
meilleure prédiction du nombre de sets : on ne bat le taux de base que de
quelques millièmes de log loss. Il ne peut venir que d'une **erreur de prix**
du bookmaker sur ce marché (§10.2), et il faudra qu'elle dépasse à la fois sa
marge et notre erreur de calibration de 3 points.

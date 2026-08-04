# Journal des mesures

**Dernière mise à jour :** 2026-08-04 (§8.2)

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

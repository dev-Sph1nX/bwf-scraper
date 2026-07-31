# Notes d'idées — outil de pari BWF

**Dernière mise à jour :** 2026-07-30

Ce qui a été **mesuré** est retiré de la liste des choses à faire et résumé en tête,
pour ne pas être reproposé. Les chiffres et la méthode sont dans
[`journal-des-mesures.md`](journal-des-mesures.md) ; la feuille de route dans
[`roadmap-outil-de-pari.md`](roadmap-outil-de-pari.md).

---

# ✅ Répondu — ne pas retester

| Idée de départ | Ce que la mesure a donné |
|---|---|
| **Scraper l'évolution du classement mondial** | Fait. 135 semaines, 2024-01 → 2026-07. Attention : l'API n'expose que **60 semaines glissantes**, le reste vient de tes CSV. |
| **Rejouer l'historique et mesurer la réussite de l'Elo** | Fait. **71,4 %** sur 2026 (jamais utilisé pour régler), contre **68,7 %** pour le classement mondial officiel et 50 % pour le hasard. Écart réel, intervalles disjoints. |
| **Faire baisser l'Elo quand on ne joue pas** | Ton intuition est **confirmée** : l'inactivité nuit (poids −0,087, significatif). Mais comme **signal séparé**, pas comme décote de la note. Et l'ajouter au modèle **n'améliore pas** la prédiction. |
| **Importance de la forme récente** | **Écartée.** À niveau égal, la forme prédit **48,7 %** — sous le hasard. Elle ne « marchait » que par corrélation avec le niveau, que l'Elo dit déjà mieux. ⚠️ L'app l'affiche encore comme un indice utile. |
| **Fraîcheur / durée des matchs dans le tournoi** | Effet **réel** (56-57 % à niveau égal) mais **inexploitable** : il n'agit que sur 13 % des matchs, son poids se noie dans l'agrégat. Ce n'est pas non plus de la fatigue — c'est un proxy de « l'adversaire a lutté au tour précédent ». |
| **Stabilité par discipline** | Mesurée, et ton hypothèse était **à moitié fausse**. Le simple hommes est bien le moins prévisible (34 % de surprises) ✅. Mais le plus stable est le **simple dames**, pas le double mixte (3e). Et WS/WD, WD/XD, XD/MD **ne sont pas départageables**. |
| **Face-à-face comme signal** | **Écarté.** 46,6 % à niveau égal. ⚠️ Le prédicteur affiche encore une alerte quand le H2H contredit l'Elo. |
| **L'avantage du terrain** | **Réel mais petit** : +2,2 pt vs l'Elo, et 55,6 % à niveau égal (z = 2,1). Tout en **simple**, rien en double. Ne touche que 12 % des matchs — le piège habituel. Étapes 2-3 non faites. (§2.6 du journal) |
| **Gymnases → matchs en 3 sets** | **Intuition confirmée.** Effet lieu à +6 σ, et **persistant** (r = 0,42 année N→N+1). Sydney 24 % de 3 sets vs 33 % attendus, Séoul 43 % vs 33 %. Piste de pari « nombre de sets ». (§7 du journal) |
| **L'écart de points (étape 1)** | **Le plus fort criblage du projet** : le plus dominateur aux points gagne **58,4 %** à Elo égal (IC [55,2 ; 61,6]), sur 65 % des matchs. Restent l'ajustement conjoint et le hors-échantillon avant intégration. (§2.7) |

**Découvert au passage :** notre Elo est **trop timide** — quand il annonce 72 %, le
favori gagne 78 %. Corrigé, mais seulement sur les disciplines **féminines**, seules
où le défaut est démontré. Erreur de calibration : 2,98 → 1,20 point.

**Aussi mesuré :** régler les paramètres de l'Elo (K, échelle, multiplicateur de
manches) **n'apporte rien** — le gain sur le passé ne se transfère pas.

---

# 🔨 À faire — décidé, pas encore construit

## Récupérer des cotes exploitables

**Le verrou principal a sauté le 2026-07-31** : Betclic, Unibet et Winamax se
scrapent en **HTTP pur** (sans navigateur), avec jointure **exacte** entre
opérateurs par identifiant Sportradar. En place : `scrape-books.mjs` (cron
quotidien, append-only dans `data/books/runs/`), page « Audit des cotes » →
onglet Bookmakers FR. Les cotes **par opérateur nommé** existent donc désormais.

- [x] Cotes **par opérateur nommé** ✅ — condition de l'arbitrage et de l'EV réel
- [ ] Relever aussi le marché « **nombre de sets** » chez les 3 opérateurs (débouché
      direct de la mesure gymnases, §7 du journal)
- [ ] Fréquence : le cron est quotidien (minuit) ; pour de vraies cotes de clôture,
      envisager un workflow léger toutes les 1-2 h (HTTP pur = quasi gratuit)
- [ ] **The Odds API**, **SportsGameOdds**, **Betfair Developer** — à comparer
- [ ] Priorité à **Betfair** : c'est une bourse d'échange, donc **sans marge de
      bookmaker**. Sa cote est la probabilité de marché la plus propre qui existe,
      et donc le meilleur étalon possible pour juger notre modèle.
- [ ] Cotes **par opérateur nommé** — condition nécessaire à l'arbitrage
- [ ] **Cotes historiques passées** ⭐ — le plus gros débloqueur : permettrait de
      répondre *tout de suite* à « bat-on le marché ? » sur 13 000 matchs, au lieu
      d'attendre des mois d'accumulation
- [ ] Diagnostiquer pourquoi 105 matchs BWF n'ont aucune cote : absence réelle chez
      la source, ou échec de notre appariement ?

## Historique des pronostics

- [ ] Figer le pronostic **avant** le match, puis le confronter au résultat
- [ ] Suivre le taux de réussite dans le temps
- [ ] À terme : détecter des dérives pour réajuster les paramètres

*Note : l'historisation des cotes est déjà en place (append-only, un fichier par
relevé). Il manque le versant pronostics.*

## Nettoyer les signaux trompeurs ⚠️

- [ ] Retirer ou requalifier l'affichage de la **forme récente** (fiche joueur)
- [ ] Retirer ou requalifier l'**alerte face-à-face** (prédicteur)
- [ ] Renommer le tag `value` en « **sous-coté BWF** » — il ne regarde aucune cote,
      c'est un écart Elo ↔ classement mondial. Sans ce renommage, confusion garantie
      avec la vraie valeur attendue.

## Interface

- [ ] **Revoir l'UX**, mobile *et* desktop
- [x] Corrigé : les 8 pages débordaient horizontalement sous 700px
- [ ] Piège connu : le `viewBox` des graphes Elo fait 720 unités, donc le texte
      tombe à **5 px** sur mobile. `EloChart` et `EloCompareChart` sont concernés.

## Écran « joueurs à suivre »

- [ ] Classement des joueurs dont l'**Elo dépasse le classement mondial**

*À savoir : l'écart Elo ↔ classement mondial n'apporte rien au modèle de prédiction
(poids marginal indiscernable de zéro). Mais comme **outil de découverte**, l'écran
garde son sens — ce n'est pas la même fonction.*

## Couche de pari

- [ ] **Valeur attendue (EV)** sur les écrans — le verrou de sécurité est levé
      (recalibration faite), les ingrédients sont déjà côte à côte dans
      `odds-report.json`
- [ ] **Critère de Kelly** — après l'EV
- [ ] **Journal de paris** + métriques (ROI, hit rate, drawdown, profit factor)
- [ ] **CLV** — nécessite les cotes de clôture, donc l'historisation en cours
- [ ] Décision en attente : où stocker le journal ? L'app est statique sur GitHub
      Pages, sans backend. Recommandation : `localStorage` + export JSON.

---

# 🔍 À découvrir — nécessite de la donnée qu'on n'a pas

Classé par valeur attendue. Le critère qui compte, appris à nos dépens : **un
facteur qui n'agit que sur une fraction des matchs ne déplace rien**, même réel.
Privilégier ce qui touche 100 % des rencontres et qui est **orthogonal au niveau**.

## Gratuit — déjà dans nos données, jamais exploité ⭐

- [x] **L'écart de points.** ✅ Étape 1 passée haut la main (58,4 % à niveau égal,
      §2.7). L'**Elo-bis à marge de points** (idée : moduler la mise à jour par la
      domination) a été construit et mesuré (§2.8) : mieux partout mais **non
      départageable sur 2026** (IC contient 0) → pas adopté, code conservé
      (`pointsFactor`, désactivé), à re-mesurer quand 2026 s'étoffera.
- [x] **L'avantage du terrain.** ✅ Mesuré (§2.6) : réel, ~16 pts d'Elo, simple
      uniquement, 12 % des matchs. Pas intégré au modèle (étapes 2-3 à faire).
- [ ] **Les abandons.** `scoreStatusValue: "Retired"` est dans nos données — un
      joueur ayant abandonné au tour précédent est probablement diminué.
- [ ] **La catégorie du tournoi** (Super 300 → 1000). Un joueur du top se motive-t-il
      autant sur un Super 300 ? Donnée présente, jamais testée.

## À aller chercher dehors

- [x] **Date de naissance des joueurs** ⭐ ✅ — COLLECTÉE le 2026-07-31 :
      `data/players/birthdates.json`, 1 432 joueurs, **97,7 % des apparitions en
      match**, jointure par ID BWF (Wikidata P3620 + API BWF), 0 ambigu forcé.
      Reste à MESURER le facteur âge (méthode des 3 étapes).
- [x] **Main dominante (gaucher)** ✅ — récupérée dans la même passe : 620 joueurs
      renseignés (73 gauchers), même fichier. Reste à mesurer.
- [ ] **Classification stable / instable des joueurs** — Glicko-2 fournirait ça
      nativement via son paramètre de volatilité. Repoussé mais pas abandonné.

## Hors de portée aujourd'hui

- **Style de jeu.** Demanderait du point par point : `lastPointWinner` et `serve`
  sont **toujours `null`** dans l'API. Ne pourrait être construit qu'à partir de
  proxys (durées, écarts de points), pas mesuré.

---

# ❌ Abandonné

| Piste | Raison |
|---|---|
| **oddsportal** (retiré le 2026-07-31) | remplacé par les 3 bookmakers FR : cotes par opérateur nommé et réellement misables, jointure Sportradar exacte, scrape HTTP robuste — là où oddsportal donnait une meilleure-cote agrégée anonyme via un scrape DOM fragile, jamais branché au cron (historique : 3 jours). Son archive `data/odds/runs/` est conservée ; les briques partagées (normalisation de noms, appariement) restent dans `lib/`. À rouvrir seulement si un besoin « consensus du marché » émerge. |
| **Arbitrage multi-bookmakers** | avec une cote **agrégée**, la formule de détection produit des opportunités **fantômes** — cotes non simultanées, opérateurs différents, limites de mise ignorées. Piège actif. À rouvrir **seulement** avec des cotes par opérateur nommé et simultanées. |
| **Météo et conditions d'air** | lieu et dates disponibles pour 100 % des tournois, mais sans coordonnées : géocodage + API externe pour un signal jugé marginal. Le badminton se joue en salle. |
| **Panneau « pourquoi » à 5 signaux** | les signaux ne battent pas l'Elo. Un panneau attribuant des points à des signaux sans valeur prédictive produirait de la **confiance sans fondement** — pire qu'aucune explication. |
| **Distribution de Poisson** | adaptée aux sports à score cumulatif (football). Le badminton est un sport à **manches** avec un vainqueur binaire : la loi de Poisson n'y a pas d'objet. |

---

# ❓ Question ouverte, non élucidée

**Pourquoi cette paire a-t-elle un Elo si fort alors qu'elle n'a pas tant gagné ?**
https://dev-sph1nx.github.io/bwf-scraper/#/pair/79198-80871

Piste à vérifier : le **seed initial**. L'Elo de départ d'une entité est déduit de
son classement mondial (1750 pour le n°1, 1350 au-delà du top 60). Une paire bien
classée au démarrage part donc haut et peut le rester longtemps si elle joue peu —
c'est le même mécanisme que l'inertie du classement officiel, qu'on voulait
justement éviter. À investiguer.

---

# 📐 Formules de référence

## Valeur attendue (EV)

```
Valeur = Cote proposée × Probabilité estimée − 1
```

Supérieur à 0 → le pari a de la valeur. Inférieur → défavorable.

⚠️ **Notre cote scrapée est la meilleure du marché**, donc l'EV calculé est **biaisé
à la hausse** par rapport à ce qu'un opérateur donné servira réellement.

## Critère de Kelly

```
f* = (b·p − q) / b
```
`f*` = fraction de bankroll · `b` = cote décimale − 1 · `p` = probabilité estimée ·
`q` = 1 − p

⚠️ Kelly dimensionne proportionnellement à l'edge estimé : avec un `p` surconfiant,
il mise **le plus gros sur les pires erreurs**. C'est la ruine accélérée, pas un
mauvais rendement. D'où la recalibration en prérequis.

## Arbitrage (abandonné — voir plus haut)

```
Détection : (1/Cote1_meilleure) + (1/Cote2_meilleure) + … < 1
Mise sur i = (Investissement × (1/Cote_i)) / Σ(1/Cotes)
```

## Closing Line Value

```
CLV = (Cote obtenue / Cote de fermeture) − 1
```

Positive → tu as battu la ligne de fermeture. La cote de fermeture est la référence
du marché : elle intègre toute l'information disponible.

- **+2 à +5 % constants** → avantage réel
- **~0 %** → tu prends le prix du marché, aucun avantage
- **négative constante** → problème de timing ou de sélection

**Mesuré chez nous : la commission du bookmaker est de 9,5 %.** Il ne suffit donc pas
d'égaler le marché, il faut le battre de plus que ça.

## Données à collecter par pari

Date et heure **du pari** (pas du match) · événement · marché · sélection · cote
obtenue · **cote de fermeture** · mise · opérateur · **probabilité estimée au moment
du pari** · résultat · profit/perte · tags

## Métriques

| Métrique | Formule |
|---|---|
| ROI | Profit total / Volume misé × 100 |
| CLV moyenne | Moyenne des (Cote obtenue / Cote de fermeture − 1) |
| Hit rate | Paris gagnants / Total × 100 |
| Drawdown max | Plus grande perte cumulée depuis un pic de bankroll |
| Profit factor | Gains / Pertes (> 1 = rentable) |

**Distinction à ne pas perdre :** ces métriques jugent le **parieur** (timing,
sélection, exécution). La calibration et le backtest jugent le **modèle**. Deux
choses différentes, deux écrans distincts.

Source des techniques : https://paris-sportifs.lefigaro.fr/strategie/

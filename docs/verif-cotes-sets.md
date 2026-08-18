# Vérification du scrape des cotes « nombre de sets » — constat et extension

Date : 2026-08-10. Préalable du lot C n°1 de la roadmap (marché « nombre de
sets », lié à l'effet gymnase prouvé au journal §7) : savoir si `scrape-books`
capte ce marché chez Betclic, Unibet et Winamax.

**Jargon.** Le marché « nombre de sets » (ou *over/under sets*) fait parier sur
la durée du match : finira-t-il en 2 sets (victoire sèche) ou en 3 (match
accroché) ? Au badminton tout match est en 2 sets gagnants (*best of 3*), donc
« Moins de 2,5 sets » = « match en 2 sets », exactement.

## 1. Verdict rétrospectif — Korea Masters (4-9 août 2026)

**Le marché des sets n'a été capté chez AUCUN des trois opérateurs** (cause
structurelle, voir §1b/§2 : le code ne l'a jamais demandé). Et la capture du
marché vainqueur lui-même a été très dégradée pendant le tournoi.

### 1a. Le relevé 2 h a bien tourné — mais 2 opérateurs sur 3 n'ont rien donné

*(Première conclusion corrigée le 2026-08-10 : une analyse initiale sur le
dépôt LOCAL — en retard sur origin — avait conclu à tort que le relevé s'était
arrêté le 4 août. En réalité `scrape-books.yml` a committé ses relevés sur
origin/main toutes les 2 h sans interruption : 50 relevés du 5 au 9 août.
Leçon : toujours vérifier `origin/main`, les relevés sont committés par le
cron GitHub, pas par la machine locale.)*

Bilan réel des 50 relevés d'origin/main pendant les jours de jeu (agrégat
recalculé le 2026-08-10, commande en §5) :

| Opérateur | Pendant le Korea Masters (5-9 août, 50 relevés) | Détail |
|---|---|---|
| Betclic | **Rien : 50 relevés sur 50 en erreur `HTTP 403`** | Blocage du runner GitHub (IP datacenter, très probablement) : en local le même code passe (badminton délisté lu proprement). À traiter, sinon le prochain tournoi sera pareil. |
| Unibet | **Partiel : 177 lignes sur 28 relevés** (12 lignes le 6/08, 105 le 7, 50 le 8, 10 le 9 ; 19 relevés en erreur 404) | Seule source réelle du tournoi. Marché vainqueur uniquement (`odd1`/`odd2`). |
| Winamax | **Rien : 0 ligne sur les 50 relevés** (1 seule erreur) | Les pages répondaient : Winamax n'a simplement pas listé ce Super 300 — ou le parseur ne voit plus la page actuelle. À départager au prochain tournoi (check-list §5). |

Conséquence pour la CLV et le futur marché des sets : sur ce tournoi, seul
Unibet est exploitable, partiellement. Les erreurs 403 Betclic côté GitHub
Actions sont le point dur — pistes : réessais espacés dans le run, en-têtes
plus proches d'un navigateur, ou relevé exécuté hors datacenter (machine
locale/raspberry en cron). Décision propriétaire requise.

### 1c. Et même quand le scrape marchait : jamais de marché sets

Dans les runs pleins (ex. `2026-07-31T15-33-51-236Z.json`, 27 lignes, Taipei
Open), chaque ligne ne porte que `odd1`/`odd2` — le marché vainqueur. Aucune
trace d'un marché de sets, conforme au code (§2).

## 2. Ce que sert chaque API (analyse du code au 2026-08-10)

Dans les trois cas, **ce n'est pas un filtre au parsing : la source interrogée
ne sert QUE le marché vainqueur.** Le marché des sets vit ailleurs (pages
match), jamais demandé avant ce jour.

- **Betclic** (`lib/book-betclic.mjs`) : la page sport SSR ne porte que le
  marché principal par match — `toRow()` lit `match.market.mainSelections`
  (l. 54) ; le tableau `match.markets` de la page liste est vide (vérifié sur
  le tennis). Les autres marchés sont dans le ng-state de la page **match**.
- **Unibet** (`lib/book-unibet.mjs`) : le flux `/lvs-api/next/<n>/p5000`
  renvoie « les événements à venir avec UN marché chacun : le *top market*,
  toujours “Face à Face” » (en-tête du fichier, l. 8-11 ; filtre
  `markettypeId === 8500`, `MARKET_FACE_A_FACE`, dans `parseUnibetLvs`). Les
  autres marchés sont rendus en HTML SSR sur la page **match**.
- **Winamax** (`lib/book-winamax.mjs`) : la page sport n'embarque qu'UN bet par
  match (vérifié sur le tennis : 25 bets pour 27 matchs) ; `parseWinamaxState`
  suit `m.mainBetId` (l. 67) et n'accepte que `marketId 186` « Vainqueur »
  (l. 72). Tous les bets d'un match sont dans le PRELOADED_STATE de la page
  **match** (`/paris-sportifs/match/<id>`).

## 3. Extension livrée (2026-08-10)

Chaque ligne prématch gagne, quand l'opérateur cote le marché, un champ
**optionnel** `sets` (format documenté dans `lib/books.mjs`) :

```json
"sets": { "market": "Nombre exact de sets", "odd2": 1.44, "odd3": 2.1 }
```

`odd2` = cote « match en 2 sets », `odd3` = « en 3 sets », `market` = libellé
exact chez l'opérateur. Repli Betclic : si seul « Score final (sets) » est
coté, on stocke `scores: {"2-0": …, "2-1": …}` **sans recombiner** (une cote
2 sets synthétisée depuis 2-0 + 0-2 ne serait pas une cote offerte).

Garanties :

- **Compatibilité ascendante stricte** : ajout purement additif — les relevés
  antérieurs restent lisibles tels quels ; `lib/books-history.mjs`,
  `build-data.mjs` et `lib/roi.mjs` ne lisent que des champs nommés et ignorent
  `sets` (327 tests existants verts, inchangés).
- **Défensif** : l'enrichissement tourne APRÈS la capture du vainqueur, sous
  double try/catch (par opérateur dans `scrape-books.mjs`, par match dans
  chaque `enrich*Sets`) — un marché absent ou une page match illisible ne
  coûte jamais une ligne vainqueur.
- **Prématch seulement**, plafonné (40 pages match max/opérateur), pauses
  600 ms (« on reste courtois ») — compter jusqu'à ~2 min de plus par relevé
  en plein tournoi.

Fichiers modifiés :

| Fichier | Changement |
|---|---|
| `lib/books.mjs` | `setsFromOutcomes()` (issues « 2 »/« 3 », « Plus/Moins de 2,5 ») + doc du champ `sets` |
| `lib/book-winamax.mjs` | `parseWinamaxMatchSets()` (marketId 196 « Nombre exact de sets » préféré, sinon 314 O/U 2,5), `enrichWinamaxSets()` |
| `lib/book-betclic.mjs` | `parseBetclicMatchMarkets()` (page match `/x-c1/x-m<id>`, l'id de compétition est ignoré — vérifié), `setsFromBetclicMarkets()` (direct → « Les deux joueurs gagnent un set » → « Score final (sets) »), `enrichBetclicSets()` ; **hors saison** : badminton absent de la liste des sports du ng-state ⇒ 0 ligne au lieu d'une fausse erreur |
| `lib/book-unibet.mjs` | token avec repli sur l'accueil (le 404 de §1b ne bloque plus), `unibetMatchPaths()` (URL de page match reconstruite : slugs non libres, vérifié), `parseUnibetMarketCards()` + `setsFromUnibetCards()` (HTML SSR), `enrichUnibetSets()` ; `fetchUnibet` renvoie en plus `ctx` (chemins de pages match, jamais écrit dans les relevés) |
| `scrape-books.mjs` | câblage best-effort de l'enrichissement + journal `sets: n/N` par opérateur |
| `test/books-parse.test.mjs` | +6 tests sur les nouvelles fonctions pures (fixtures = captures réelles du 2026-08-10) |

## 4. Validation hors saison

**Attention au piège du calendrier** : `data/2026/tournaments.json` ne liste que
le **World Tour** (rien avant mi-septembre), mais les **Championnats du monde
(~17-23 août)** n'y figurent pas — et les bookmakers les cotent (preuve :
`data/flashscore/odds/championnats-du-monde-2025.json`). **La vraie prochaine
fenêtre de validation est donc ~le 17 août**, pas mi-septembre.

**(a) Forme des réponses vérifiée sur le TENNIS** (marché équivalent), appels
de lecture au rythme humain, le 2026-08-10 — les trois enrichisseurs ont
produit des cotes réelles :

```
WINAMAX  {"market":"Nombre exact de sets","odd2":1.44,"odd3":2.1}      (Darderi–Nakashima)
BETCLIC  {"market":"Les deux joueurs gagnent un set","odd2":1.51,"odd3":2.05}
UNIBET   {"market":"Nombre de sets dans le match - Match","odd2":1.38,"odd3":2.15}
```

**(b) Run à vide** : `node scrape-books.mjs` (2026-08-10, relevé
`2026-08-10T07-40-32-440Z.json`) se déroule normalement :

```
📗 betclic — 0 lignes prématch
📗 unibet — 0 lignes prématch
📗 winamax — 0 lignes prématch
⚠ aucune ligne récupérée : relevé vide écrit (erreurs consignées)
```

Zéro erreur (contre 2 opérateurs en erreur avant : le repli de token Unibet et
la lecture « badminton délisté » Betclic assainissent le hors-saison).

**(c) Tests** : `node --test test/*.test.mjs` → **333 pass, 0 fail**.

## 5. Check-list de validation au prochain tournoi (Championnats du monde ~17-23 août, sinon mi-septembre)

À dérouler dès la VEILLE du 1er jour (les cotes prématch sortent la veille) :

1. **Le relevé tourne-t-il ?** `ls data/books/runs/ | tail` — des fichiers
   toutes les ~2 h. C'est le point qui a fait défaut au Korea Masters (§1a) :
   vérifier la tâche AVANT le tournoi.
2. **Le vainqueur revient-il ?** `node scrape-books.mjs` à la main : les trois
   opérateurs doivent afficher des lignes > 0 (sinon consigner : opérateur qui
   ne cote pas ce tournoi, ou 403 Betclic — intermittents depuis le 1er août).
3. **Le champ `sets` est-il là ?**
   `grep -l '"sets"' data/books/runs/*.json | tail` puis inspection : noter le
   **libellé réel** du marché badminton par opérateur (les nommages actuels
   sont extrapolés du tennis) et l'ajouter ici.
4. **Unibet : l'URL de page match badminton tient-elle ?** Si `sets` manque
   côté Unibet alors que le site l'affiche, la reconstruction
   catégorie/ligue/id/slug (`unibetMatchPaths`) est fausse pour le badminton
   (`path.Category` réel inconnu hors saison) — comparer aux hrefs de
   `/paris-badminton`.
5. **Betclic : le SSR badminton porte-t-il un marché sets ?** Au tennis, seul
   l'onglet « Le Top » est rendu côté serveur. Si aucune des trois formes
   (direct / « Les deux gagnent un set » / « Score final (sets) ») n'y figure
   au badminton, le marché est côté gRPC uniquement → consigner et arbitrer.
6. **Durée du relevé** : vérifier qu'un run en plein tournoi reste < ~3 min
   (plafond 40 pages match/opérateur, pause 600 ms).
7. Reporter le verdict (libellés réels + éventuels écarts) ici même, et
   seulement ensuite lancer le chantier du marché des sets (lot C).

## 6. Verdict de la fenêtre — Championnats du monde, 2026-08-18 (jour 2)

Check-list §5 déroulée pendant le tournoi. **Les libellés extrapolés du tennis
étaient bons pour Betclic et Unibet, faux pour Winamax.**

| # | Point | Verdict |
|---|---|---|
| 1 | Le relevé tourne | ✅ toutes les 2 h sans trou depuis le 17/08 |
| 2 | Le vainqueur revient | ✅ **en local, 3/3 opérateurs** (55 / 55 / 52 lignes, 0 erreur) — ❌ **en CI, Betclic 403 sur 19 relevés sur 19** (§1a, non traité) |
| 3 | Libellés réels badminton | consignés ci-dessous |
| 4 | URL de page match Unibet | ✅ `unibetMatchPaths` valide en badminton (19 lignes enrichies) |
| 5 | SSR Betclic | ✅ marché sets présent sous forme directe, sans passer par les replis |
| 6 | Durée du relevé | ✅ 2 min 01 en plein tournoi |

**Libellés réels (relevé `2026-08-18T11-58-13-368Z`) :**

```
BETCLIC  "Nombre de sets"          23/55 lignes
UNIBET   "Nombre de Sets - Match"  19/55 lignes
WINAMAX  "Nombre de sets"          22/52 lignes   (marketId 241, special variant=sr:exact_games:bestof:3)
```

17 matchs sont cotés par les **trois** opérateurs simultanément ; les cotes
concordent à un ou deux crans près (ex. Kuenzi–Tan : 1,30 / 1,30 / 1,30 en
2 sets ; 2,45 / 2,50 / 2,50 en 3 sets).

La couverture partielle (~40 %) n'est pas un défaut de scrape : **Winamax et
Betclic n'ouvrent les marchés annexes que sur une partie de l'affiche** — 2 des
3 pages match inspectées ne portaient qu'un seul bet, « Vainqueur ».

### 6a. Correction Winamax (2026-08-18) — 0/52 → 22/52

Winamax captait le vainqueur mais **jamais les sets**. Cause racine : le bet
badminton tombait entre les deux prédicats de `parseWinamaxMatchSets`, tous
deux calibrés sur le tennis.

```
marketId=241  betTitle="Nombre de sets"  special="variant=sr:exact_games:bestof:3"  ::  2@1.3 | 3@2.5
```

- prédicat « exact » : exigeait `marketId 196` **ou** un titre « Nombre **exact**
  de sets » → le titre badminton n'a pas le mot « exact » ;
- prédicat « over/under » : le titre matchait, mais la garde
  `(!specialBetValue || /total=2.5/)` — écrite pour l'over/under du tennis —
  rejetait `variant=sr:exact_games:bestof:3`.

**Leçon : les `marketId` Winamax changent d'un sport à l'autre.** Le code ne s'y
fie donc plus seul : un bet est retenu s'il parle de sets *au niveau du match*
(rejet de `gamenr=` — marchés d'un set précis — et de tout `total=` autre que
2,5, qui viserait le best of 5), et c'est `setsFromOutcomes` qui valide
réellement le contenu. Tous les marchés de sets du match sont essayés, plus
seulement le premier trouvé. 2 tests ajoutés (structure réelle du match
73767394 + non-régression du best of 5) ; suite complète : 335 pass, 0 fail.

### 6b. Betclic 403 en CI — diagnostic du 2026-08-18 : c'est l'IP, rien d'autre

Sonde `tools/diag-betclic-ci.mjs` exécutée sur un runner (workflow
`diag-betclic.yml`, manuel). Depuis GitHub Actions — IP Azure US
(`4.242.44.213` Washington, puis `64.236.200.86` Illinois) :

| Client | Résultat |
|---|---|
| en-têtes de production | 403, page d'erreur de marque Betclic (3 537 o), `x-cache: Error from cloudfront` |
| Chrome complet (`sec-ch-ua`, `sec-fetch-*`, `referer`) | 403 **identique à l'octet près** |
| User-Agent nu | 403 identique |
| curl (autre pile TLS, autre JA3) | 403 identique |
| témoin Winamax | ✅ 200 |

Texte de la page : « Betclic Error 403 - Forbidden / Please try again in a few
minutes / Err (0x2005002) » — aucun motif nommé.

**Conclusions fermes :**

- ce n'est **pas** une empreinte d'en-têtes ni de TLS (curl et Chrome complet
  bloqués pareil ; en local, un User-Agent nu passe) — donc **aucun réglage du
  code ne contourne le refus** ;
- ce n'est **pas** un anti-bot : la réponse ne porte aucune signature de ce
  type. Contraste dans la même sonde : l'accueil Unibet, lui, est bloqué par
  **DataDome** (`x-datadome-botname: Inconsistent HTTP headers`) — sans effet
  sur la production, qui passe par l'API LVS et répond (63 lignes en CI) ;
- ce n'est **pas** une réputation qu'on aurait dégradée en scrapant : deux IP
  Azure distinctes, jamais utilisées par nous, refusées dès la 1re requête.
  C'est une règle permanente sur ces plages.

**Indéterminé :** règle par *pays* (US) ou par *plages datacenter*. La page
d'erreur ne le dit pas. Conséquence pratique : une IP française de datacenter
(VPS) suffit dans le premier cas seulement ; une IP résidentielle française
marche dans les deux.

**DÉCISION PRISE (2026-08-18) : on acte 2 opérateurs sur 3 en CI.** Betclic
reste bloqué sur GitHub Actions ; on le relève à la main depuis une machine
française (`node scrape-books.mjs`, ~2 min, 3/3 opérateurs) quand on le veut —
les relevés sont des fichiers autonomes horodatés, un relevé local coexiste
sans conflit avec ceux du cron GitHub. Écartés : cron local sur la machine du
propriétaire (dépend d'une machine allumée), VPS français (~2-5 €/mois, et
l'hypothèse « plages datacenter » n'est pas écartée), proxy à sortie française
(payant, et un secret de plus dans un dépôt public). **Ne pas rouvrir sans
élément nouveau** — il n'y a pas de correctif côté code à chercher.

Conséquence à garder en tête pour les mesures : sur les tournois relevés en CI
seule, la jointure inter-opérateurs porte sur Unibet + Winamax, et la « meilleure
cote » est prise sur 2 books au lieu de 3 (l'étude ROI §8.1 chiffrait le
multi-comptes à +3 pts vs mono-bookmaker).

La sonde `tools/diag-betclic-ci.mjs` est conservée (elle tourne en local) ; le
workflow `diag-betclic.yml` qui l'exécutait sur un runner est supprimé — pour
le refaire tourner en CI, 6 lignes de `workflow_dispatch` suffisent.

### 6c. Ce qui reste ouvert
1. **Betclic `complete: false`** — la liste s'arrête avant `totalCount` : des
   matchs du site manquent.
2. Le **chantier lot C n°1** lui-même (le prix des sets intègre-t-il l'effet
   gymnase ?) attend d'avoir de la matière : cette fenêtre sert à collecter,
   pas encore à mesurer.

Commandes utiles : `node scrape-books.mjs` ; `node --test test/books-parse.test.mjs` ;
`grep -o '"sets":[^}]*}' data/books/runs/<run>.json | sort | uniq -c`.

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

Commandes utiles : `node scrape-books.mjs` ; `node --test test/books-parse.test.mjs` ;
`grep -o '"sets":[^}]*}' data/books/runs/<run>.json | sort | uniq -c`.

# Partie C — la disponibilite des prix

Source : `data/books/runs/`, **344 instantanes** du 2026-07-31 11:44 au 2026-08-28 07:38.

## C1 — inventaire

| grandeur | valeur |
|---|---|
| instantanes | 344 |
| instantanes sans aucune ligne | 176 (51.2 %) |
| lignes-instantane totales | 5170 |
| cadence : ecart median entre deux instantanes | 1.85 h |
| cadence : 1er / 9e decile | 0.21 h / 3.31 h |

| operateur | lignes-instantane | matchs distincts (srId) | instantanes ou il apparait |
|---|---|---|---|
| betclic | 276 | 120 | 16 |
| unibet | 4629 | 319 | 167 |
| winamax | 265 | 114 | 16 |

## C2 — quels marches sont reellement releves

Recensement **exhaustif** des champs presents sur les 5170 lignes-instantane :

| champ | occurrences | part |
|---|---|---|
| `book` | 5170 | 100.0 % |
| `bookMatchId` | 5170 | 100.0 % |
| `srId` | 5170 | 100.0 % |
| `tournament` | 5170 | 100.0 % |
| `discipline` | 5170 | 100.0 % |
| `p1` | 5170 | 100.0 % |
| `p2` | 5170 | 100.0 % |
| `odd1` | 5170 | 100.0 % |
| `odd2` | 5170 | 100.0 % |
| `startUtc` | 5170 | 100.0 % |
| `isLive` | 5170 | 100.0 % |
| `sets` | 1965 | 38.0 % |

Sous-champs de `sets` : `market` 1965, `odd2` 1965, `odd3` 1965.

> **Aucun champ de total de points n'existe dans ces relevés.** Le schema normalise de `lib/books.mjs` porte le marche vainqueur (`odd1`, `odd2`) et, depuis le 2026-08-10, le marche « nombre de sets » (`sets`). Le marche over/under du total de points n'y a jamais ete collecte.

**Consequence directe : les trois questions de la partie C portant sur les lignes de totaux — delai d'apparition, duree de vie d'un prix, mouvement de la ligne — sont sans reponse dans ce depot.** Ce n'est pas un trou de couverture qu'on pourrait combler en cherchant mieux : la donnee n'a pas ete captee. Tout ce qui suit porte donc sur le marche **vainqueur**, que la commande demandait « pour comparaison », et sur le marche **sets**.

## C3 — le marche vainqueur : apparition, duree de vie, mouvements

Lignes-instantane a cote vainqueur absente, ecartees des series : **41 / 5170** (0.8 %).

| operateur | series (operateur x match) | instantanes par serie : median | max |
|---|---|---|---|
| betclic | 119 | 2 | 4 |
| unibet | 319 | 12 | 39 |
| winamax | 109 | 2 | 4 |

### Delai entre la premiere apparition et l'heure du match

| operateur | series | delai median (h) | 1er decile | 9e decile | max |
|---|---|---|---|---|---|
| betclic | 119 | 12.6 | 0.4 | 20.2 | 23.0 |
| unibet | 319 | 17.3 | 8.8 | 24.5 | 35.5 |
| winamax | 109 | 3.1 | 0.4 | 20.2 | 23.0 |

*Le delai est mesure a partir du **premier instantane du depot** (2026-07-31) : pour un match deja ouvert a cette date, il minore le delai reel. Il est aussi borne par la cadence de releve (~1.8 h de mediane).*

### Duree de vie d'un prix

Un « prix » = une valeur de `odd1`. On compte les plages consecutives ou elle ne bouge pas, en nombre d'instantanes et en heures.

| operateur | plages de prix | instantanes par plage : moyenne / mediane | heures par plage : mediane | series a prix constant |
|---|---|---|---|---|
| betclic | 104 | 2.25 / 2 | 0.12 | 57 / 79 (72 %) |
| unibet | 1264 | 3.66 / 2 | 1.49 | 55 / 315 (17 %) |
| winamax | 97 | 2.14 / 2 | 0.09 | 47 / 70 (67 %) |

### Frequence et amplitude des changements de cote

| operateur | series suivies (>= 2 instantanes) | changements par serie : moyenne | part de series qui bougent | |delta| median | |delta| relatif median | delta max |
|---|---|---|---|---|---|---|
| betclic | 79 | 0.32 | 22 / 79 (28 %) | 0.100 | 4.7 % | 2.500 |
| unibet | 315 | 3.01 | 260 / 315 (83 %) | 0.050 | 2.0 % | 6.030 |
| winamax | 70 | 0.39 | 23 / 70 (33 %) | 0.080 | 4.0 % | 1.800 |

## C4 — le marche « nombre de sets »

Present sur **1965 / 5170** lignes-instantane (38.0 %), a partir du 2026-08-16.

| operateur | lignes avec `sets` | series | changements de `odd3` par serie | part qui bougent |
|---|---|---|---|---|
| betclic | 138 | 66 | 0.23 | 8 / 39 |
| unibet | 1713 | 186 | 1.13 | 112 / 183 |
| winamax | 114 | 64 | 0.21 | 5 / 28 |

## C5 — le prix « ouverture » de l'export est-il le premier instantane observe ?

Fenetre de recouvrement : les relevés commencent le **2026-07-31**, les cotes de l'export s'arretent au **2026-08-02**. Le chevauchement ne fait donc que **3 jours de matchs**.

| resultat de l'appariement | series |
|---|---|
| appariees a un match cote de l'export | 31 |
| ambigues (plusieurs matchs candidats) | 2 |
| sans correspondance (match hors export, ou operateur absent de l'export) | 514 |

| grandeur | valeur |
|---|---|
| couples compares | 31 |
| premier releve identique a l'ouverture de l'export | 10 (32 %) |
| ecart moyen (premier releve - ouverture export) | +0.0606 |
| ecart median | +0.0000 |
| ecart absolu median | 0.0200 |
| ecart absolu max | 1.8000 |

Detail des 31 couples :

| operateur | date | ouverture export | premier instantane | ecart |
|---|---|---|---|---|
| betclic | 2026-07-31 | 1.62 | 1.38 | -0.24 |
| betclic | 2026-07-31 | 1.22 | 1.01 | -0.21 |
| betclic | 2026-07-31 | 2.70 | 4.50 | +1.80 |
| betclic | 2026-07-31 | 1.16 | 1.13 | -0.03 |
| betclic | 2026-07-31 | 1.78 | 1.70 | -0.08 |
| betclic | 2026-07-31 | 1.90 | 1.80 | -0.10 |
| betclic | 2026-07-31 | 1.40 | 1.42 | +0.02 |
| winamax | 2026-07-31 | 1.58 | 1.32 | -0.26 |
| winamax | 2026-07-31 | 1.21 | 1.01 | -0.20 |
| winamax | 2026-07-31 | 2.60 | 4.20 | +1.60 |
| winamax | 2026-07-31 | 1.14 | 1.15 | +0.01 |
| winamax | 2026-07-31 | 1.78 | 1.78 | +0.00 |
| winamax | 2026-07-31 | 1.88 | 1.88 | +0.00 |
| winamax | 2026-07-31 | 1.37 | 1.42 | +0.05 |
| betclic | 2026-08-01 | 1.35 | 1.33 | -0.02 |
| betclic | 2026-08-01 | 3.00 | 3.00 | +0.00 |
| betclic | 2026-08-01 | 1.60 | 1.65 | +0.05 |
| betclic | 2026-08-01 | 1.40 | 1.40 | +0.00 |
| betclic | 2026-08-01 | 1.90 | 1.88 | -0.02 |
| betclic | 2026-08-01 | 1.04 | 1.03 | -0.01 |
| betclic | 2026-08-01 | 3.75 | 3.75 | +0.00 |
| betclic | 2026-08-01 | 3.20 | 3.10 | -0.10 |
| winamax | 2026-08-01 | 1.34 | 1.31 | -0.03 |
| winamax | 2026-08-01 | 2.90 | 2.90 | +0.00 |
| winamax | 2026-08-01 | 1.56 | 1.62 | +0.06 |
| winamax | 2026-08-01 | 4.70 | 4.30 | -0.40 |
| winamax | 2026-08-01 | 1.37 | 1.37 | +0.00 |
| winamax | 2026-08-01 | 1.84 | 1.84 | +0.00 |
| winamax | 2026-08-01 | 1.03 | 1.02 | -0.01 |
| winamax | 2026-08-01 | 3.55 | 3.55 | +0.00 |
| winamax | 2026-08-01 | 2.95 | 2.95 | +0.00 |


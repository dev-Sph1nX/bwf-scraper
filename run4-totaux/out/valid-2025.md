# Validation 2025 — modele de points contre la ligne Betclic

Modele regle sur 13181 matchs 2022-2024. Lignes misables 2025 rattachees a un match : **4483** (2533 matchs distincts).

## H1 — log-loss sur les lignes 2025

| predicteur | log-loss |
|---|---|
| constante 50 % | 0.6931 |
| constante = taux d'over realise 2025 (52.0 %, oracle) | 0.6923 |
| marche, ouverture de-viguee | 0.6933 |
| marche, cloture de-viguee | 0.6929 |
| **modele (2022-2024, sans cote)** | **0.6931** |

Gain du modele sur le marche a l'ouverture : **+0.0002**.

## H2 — le modele voit-il plus d'over que le marche ?

| grandeur | moyenne |
|---|---|
| P(over) modele | 51.23 % |
| P(over) marche ouverture | 49.96 % |
| **ecart moyen modele - marche** | **+1.28 pts** |
| over realise | 52.04 % |

## Calibration du modele sur 2025, par decile de P(over) modele

| decile | lignes | matchs | P modele moy | over realise | ecart |
|---|---|---|---|---|---|
| 1 | 448 | 336 | 36.32 % | 47.10 % | +10.78 pts |
| 2 | 448 | 421 | 42.68 % | 48.88 % | +6.20 pts |
| 3 | 448 | 442 | 45.83 % | 50.45 % | +4.62 pts |
| 4 | 449 | 447 | 48.21 % | 46.77 % | -1.44 pts |
| 5 | 448 | 446 | 50.30 % | 53.57 % | +3.27 pts |
| 6 | 448 | 447 | 52.32 % | 50.89 % | -1.43 pts |
| 7 | 449 | 449 | 54.51 % | 52.78 % | -1.72 pts |
| 8 | 448 | 447 | 56.88 % | 52.01 % | -4.87 pts |
| 9 | 448 | 440 | 59.79 % | 57.37 % | -2.43 pts |
| 10 | 449 | 332 | 65.46 % | 60.58 % | -4.88 pts |

Meme table pour le marche a l'ouverture :

| decile | lignes | P marche moy | over realise | ecart |
|---|---|---|---|---|
| 1 | 448 | 48.17 % | 53.57 % | +5.40 pts |
| 2 | 448 | 48.94 % | 51.56 % | +2.62 pts |
| 3 | 448 | 49.08 % | 52.68 % | +3.60 pts |
| 4 | 449 | 49.54 % | 52.78 % | +3.25 pts |
| 5 | 448 | 49.94 % | 51.12 % | +1.17 pts |
| 6 | 448 | 50.01 % | 47.99 % | -2.02 pts |
| 7 | 449 | 50.38 % | 52.56 % | +2.18 pts |
| 8 | 448 | 50.85 % | 49.78 % | -1.07 pts |
| 9 | 448 | 51.00 % | 53.35 % | +2.35 pts |
| 10 | 449 | 51.67 % | 55.01 % | +3.34 pts |

## H3 — ROI over par decile d'ecart modele - marche

| decile d'ecart | lignes | matchs | ecart moyen | P(over) realise | ROI over | ROI under |
|---|---|---|---|---|---|---|
| 1 | 448 | 321 | -13.57 pts | 47.10 % | -14.80 % | -4.44 % |
| 2 | 448 | 384 | -7.27 pts | 49.55 % | -10.23 % | -8.74 % |
| 3 | 448 | 404 | -4.12 pts | 49.33 % | -10.86 % | -8.44 % |
| 4 | 449 | 419 | -1.72 pts | 47.22 % | -14.30 % | -4.59 % |
| 5 | 448 | 423 | +0.39 pts | 52.68 % | -4.46 % | -14.24 % |
| 6 | 448 | 422 | +2.40 pts | 54.46 % | -1.22 % | -17.65 % |
| 7 | 449 | 424 | +4.62 pts | 51.67 % | -6.32 % | -12.77 % |
| 8 | 448 | 409 | +6.92 pts | 48.88 % | -11.46 % | -7.73 % |
| 9 | 448 | 392 | +9.76 pts | 57.37 % | +3.89 % | -22.73 % |
| 10 | 449 | 305 | +15.32 pts | 62.14 % | +12.55 % | -31.42 % |

## Grille de seuils (calibration de la strategie sur 2025)

Regle : parier **over** si `ecart >= +s`, **under** si `ecart <= -s`. Une ligne = un pari (toutes les lignes du match retenues).

| seuil s | paris over | ROI over | paris under | ROI under | paris total | matchs | ROI total |
|---|---|---|---|---|---|---|---|
| 0.02 | 2105 | +0.09 % | 1512 | -6.97 % | 3617 | 2262 | -2.86 % |
| 0.03 | 1897 | -0.66 % | 1320 | -7.03 % | 3217 | 2066 | -3.27 % |
| 0.04 | 1684 | +0.58 % | 1131 | -6.21 % | 2815 | 1835 | -2.15 % |
| 0.05 | 1487 | +0.77 % | 969 | -6.36 % | 2456 | 1618 | -2.04 % |
| 0.06 | 1315 | +2.06 % | 820 | -5.87 % | 2135 | 1423 | -0.99 % |
| 0.07 | 1096 | +4.61 % | 695 | -5.07 % | 1791 | 1199 | +0.85 % |
| 0.08 | 920 | +7.30 % | 584 | -5.92 % | 1504 | 1022 | +2.16 % |
| 0.10 | 638 | +9.04 % | 390 | -0.86 % | 1028 | 715 | +5.29 % |
| 0.12 | 412 | +13.78 % | 248 | -2.48 % | 660 | 463 | +7.67 % |
| 0.15 | 186 | +19.61 % | 119 | -4.37 % | 305 | 216 | +10.26 % |

## Choix de ligne quand un match en propose plusieurs (seuil 0,05, over seul)

| regle de choix | seuil | paris | matchs | ROI over |
|---|---|---|---|---|
| toutes les lignes eligibles | 0.03 | 1897 | 1214 | -0.66 % |
| la plus basse eligible | 0.03 | 1214 | 1214 | -0.02 % |
| le plus fort ecart | 0.03 | 1214 | 1214 | -0.02 % |
| la plus haute eligible | 0.03 | 1214 | 1214 | -2.61 % |
| toutes les lignes eligibles | 0.05 | 1487 | 963 | +0.77 % |
| la plus basse eligible | 0.05 | 963 | 963 | +1.50 % |
| le plus fort ecart | 0.05 | 963 | 963 | +1.51 % |
| la plus haute eligible | 0.05 | 963 | 963 | -0.53 % |
| toutes les lignes eligibles | 0.07 | 1096 | 726 | +4.61 % |
| la plus basse eligible | 0.07 | 726 | 726 | +5.35 % |
| le plus fort ecart | 0.07 | 726 | 726 | +5.36 % |
| la plus haute eligible | 0.07 | 726 | 726 | +4.26 % |


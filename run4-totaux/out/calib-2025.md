# Calibration de la strategie sur 2025

## H4 — calibration de Platt hors echantillon, estimee sur 2022-2024

Plis chronologiques : 5. Couples (match, ligne candidate) hors echantillon : 65905.

Platt `logit' = a + b x logit` : **a = 0.0207, b = 0.9975**.

| predicteur (lignes misables 2025) | log-loss |
|---|---|
| constante 50 % | 0.6931 |
| marche ouverture | 0.6933 |
| modele brut | 0.6931 |
| **modele calibre Platt (2022-2024)** | **0.6930** |

| decile de P modele calibre | lignes | P moy | over realise | ecart |
|---|---|---|---|---|
| 1 | 448 | 36.83 % | 47.10 % | +10.27 pts |
| 2 | 448 | 43.21 % | 48.88 % | +5.68 pts |
| 3 | 448 | 46.35 % | 50.45 % | +4.09 pts |
| 4 | 449 | 48.73 % | 46.77 % | -1.96 pts |
| 5 | 448 | 50.82 % | 53.57 % | +2.75 pts |
| 6 | 448 | 52.83 % | 50.89 % | -1.94 pts |
| 7 | 449 | 55.01 % | 52.78 % | -2.23 pts |
| 8 | 448 | 57.37 % | 52.01 % | -5.37 pts |
| 9 | 448 | 60.27 % | 57.37 % | -2.90 pts |
| 10 | 449 | 65.89 % | 60.58 % | -5.31 pts |

Le classement est-il inchange ? corrélation de rang brut/calibre = 1,000 (Platt est monotone croissante, b > 0).

## H5 — le prix de Betclic dit-il quelque chose de la position de la ligne ?

Ecart-type de `P_marche_ouverture(over)` sur 2025 : **1.03 points** (min 46.6 %, max 52.5 %).

Correlation entre `P_marche(over)` et l'ecart de la ligne a la ligne principale du match : **-0.225** (4483 lignes).

| ecart a la ligne principale | lignes | P marche moy | P modele calibre moy | over realise |
|---|---|---|---|---|
| -3 | 108 | 50.21 % | 55.20 % | 52.78 % |
| -2 | 245 | 50.23 % | 54.85 % | 55.51 % |
| -1 | 493 | 50.43 % | 54.62 % | 54.97 % |
| +0 | 2533 | 50.06 % | 51.56 % | 51.80 % |
| +1 | 786 | 49.40 % | 49.95 % | 50.13 % |
| +2 | 222 | 49.35 % | 47.87 % | 50.45 % |
| +3 | 35 | 49.79 % | 47.54 % | 57.14 % |

## H6 — grille de seuils, ROI net du placebo (2025)

Placebos 2025 (ROI over moyen de toutes les lignes misables de la cellule) :

| seau | discipline | lignes | placebo ROI over |
|---|---|---|---|
| rel <= -2 | MD | 297 | +3.94 % |
| rel <= -2 | MS | 420 | +4.30 % |
| rel <= -2 | WD | 211 | +4.88 % |
| rel <= -2 | WS | 322 | -1.49 % |
| rel <= -2 | XD | 323 | -7.33 % |
| -2 < rel < +2 | MD | 355 | -8.95 % |
| -2 < rel < +2 | MS | 593 | -12.17 % |
| -2 < rel < +2 | WD | 175 | -1.18 % |
| -2 < rel < +2 | WS | 293 | +1.75 % |
| -2 < rel < +2 | XD | 339 | -0.83 % |
| rel >= +2 | MD | 318 | -15.01 % |
| rel >= +2 | MS | 126 | -14.40 % |
| rel >= +2 | WD | 267 | -16.56 % |
| rel >= +2 | WS | 313 | -8.35 % |
| rel >= +2 | XD | 131 | -21.48 % |

| seuil | paris over | matchs | taux de selection | ROI over | placebo attendu | ROI net | IC 95 % net | volume 2026 projete |
|---|---|---|---|---|---|---|---|---|
| 0.02 | 2209 | 1390 | 49.3 % | -0.50 % | -5.00 % | **+4.50 %** | [-0.83 % ; +9.64 %] | ~1068 paris / ~689 matchs |
| 0.03 | 1996 | 1274 | 44.5 % | +0.18 % | -4.85 % | **+5.04 %** | [-0.28 % ; +10.32 %] | ~965 paris / ~632 matchs |
| 0.04 | 1784 | 1145 | 39.8 % | -0.18 % | -4.64 % | **+4.46 %** | [-1.27 % ; +10.11 %] | ~863 paris / ~568 matchs |
| 0.05 | 1594 | 1025 | 35.6 % | +0.81 % | -4.40 % | **+5.20 %** | [-0.69 % ; +11.54 %] | ~771 paris / ~508 matchs |
| 0.06 | 1404 | 914 | 31.3 % | +1.55 % | -4.11 % | **+5.66 %** | [-0.74 % ; +12.09 %] | ~679 paris / ~453 matchs |
| 0.07 | 1207 | 796 | 26.9 % | +3.06 % | -3.89 % | **+6.95 %** | [+0.05 % ; +13.25 %] | ~584 paris / ~395 matchs |
| 0.08 | 992 | 666 | 22.1 % | +6.43 % | -3.37 % | **+9.80 %** | [+2.75 % ; +16.88 %] | ~480 paris / ~330 matchs |
| 0.09 | 833 | 559 | 18.6 % | +8.04 % | -2.95 % | **+11.00 %** | [+2.88 % ; +18.59 %] | ~403 paris / ~277 matchs |
| 0.10 | 705 | 476 | 15.7 % | +8.16 % | -2.60 % | **+10.76 %** | [+1.89 % ; +19.31 %] | ~341 paris / ~236 matchs |
| 0.12 | 457 | 310 | 10.2 % | +12.17 % | -1.40 % | **+13.58 %** | [+3.67 % ; +23.77 %] | ~221 paris / ~154 matchs |
| 0.15 | 208 | 147 | 4.6 % | +17.44 % | +0.70 % | **+16.74 %** | [+2.31 % ; +31.08 %] | ~101 paris / ~73 matchs |

Jambe **under** (symetrique) sur 2025 :

| seuil | paris under | matchs | ROI under |
|---|---|---|---|
| 0.02 | 1402 | 947 | -6.65 % |
| 0.03 | 1219 | 815 | -6.28 % |
| 0.04 | 1049 | 705 | -6.95 % |
| 0.05 | 892 | 607 | -6.58 % |
| 0.06 | 753 | 518 | -5.16 % |
| 0.07 | 631 | 432 | -4.90 % |
| 0.08 | 533 | 379 | -6.42 % |
| 0.09 | 423 | 303 | -1.78 % |
| 0.10 | 353 | 259 | -1.72 % |
| 0.12 | 223 | 164 | -2.92 % |
| 0.15 | 107 | 71 | -3.50 % |


# Partie A - replique diagnostique

Source `export/cotes-totaux.csv` : **6843 lignes** brutes.

| filtre | lignes |
|---|---|
| ecartees `misable != true` | 0 |
| ecartees cote manquante (une des 4) | 0 |
| ecartees `resultat_over` manquant | 0 |
| **retenues** | **6843** |

Matchs distincts retenus : **3858**.

## A1 - Couverture : lignes et matchs distincts par (annee, operateur)

| annee | operateur | lignes | matchs distincts | lignes/match |
|---|---|---|---|---|
| 2024 | betclic | 192 | 69 | 2.78 |
| 2025 | betclic | 4483 | 2533 | 1.77 |
| 2026 | betclic | 2168 | 1256 | 1.73 |
| **2024** | *tous* | **192** | **69** | 2.78 |
| **2025** | *tous* | **4483** | **2533** | 1.77 |
| **2026** | *tous* | **2168** | **1256** | 1.73 |
| **total** | *tous* | **6843** | **3858** | 1.77 |

## A2 - Marge a l'ouverture `moy(1/over_ouv + 1/under_ouv) - 1`

| perimetre | lignes | marge ouverture | marge cloture (info) |
|---|---|---|---|
| **global** | 6843 | 10.973 % | 10.969 % |
| 2024 | 192 | 9.261 % | 8.928 % |
| 2025 | 4483 | 10.542 % | 10.547 % |
| 2026 | 2168 | 12.017 % | 12.023 % |

## A3 - Calibration a l'ouverture : P(over) implicite de-viguee vs over realise

| perimetre | lignes | matchs | P(over) implicite | over realise | ecart |
|---|---|---|---|---|---|
| **global** | 6843 | 3858 | 49.96 % | 53.09 % | +3.13 pts |
| annee 2024 | 192 | 69 | 49.07 % | 49.48 % | +0.41 pts |
| annee 2025 | 4483 | 2533 | 49.96 % | 52.04 % | +2.08 pts |
| annee 2026 | 2168 | 1256 | 50.04 % | 55.58 % | +5.54 pts |
| discipline MD | 1398 | 790 | 49.91 % | 52.22 % | +2.30 pts |
| discipline MS | 1721 | 958 | 50.03 % | 52.76 % | +2.73 pts |
| discipline WD | 1037 | 569 | 50.00 % | 51.40 % | +1.40 pts |
| discipline WS | 1464 | 836 | 50.01 % | 54.64 % | +4.64 pts |
| discipline XD | 1223 | 705 | 49.82 % | 54.13 % | +4.31 pts |

## A4 - ROI over et ROI under a l'ouverture (mise 1, prix brut)

| perimetre | lignes | matchs | ROI over | ROI under | somme |
|---|---|---|---|---|---|
| **global** | 6843 | 3858 | -4.24 % | -15.50 % | -19.74 % |
| annee 2024 | 192 | 69 | -7.67 % | -9.29 % | -16.96 % |
| annee 2025 | 4483 | 2533 | -5.72 % | -13.28 % | -19.00 % |
| annee 2026 | 2168 | 1256 | -0.87 % | -20.66 % | -21.53 % |
| discipline MD | 1398 | 790 | -5.61 % | -13.86 % | -19.47 % |
| discipline MS | 1721 | 958 | -5.02 % | -14.86 % | -19.89 % |
| discipline WD | 1037 | 569 | -7.41 % | -12.45 % | -19.86 % |
| discipline WS | 1464 | 836 | -1.62 % | -18.34 % | -19.97 % |
| discipline XD | 1223 | 705 | -2.00 % | -17.48 % | -19.47 % |
| tercile bas (ligne <= 75.5) | 2790 | 1587 | +3.19 % | -22.96 % | -19.78 % |
| tercile milieu (75.5 < ligne < 78.5) | 1731 | 1360 | -6.37 % | -13.46 % | -19.83 % |
| tercile haut (ligne >= 78.5) | 2322 | 1762 | -11.56 % | -8.07 % | -19.63 % |

Bornes de tercile sur la distribution triee des 6843 lignes brutes, toutes annees : 1/3 = **75.5**, 2/3 = **78.5** (min 66.5, mediane 76.5, max 113.5).

## A5 - Ligne relative (`ligne - mediane de la discipline`) x annee

| discipline | mediane des lignes misables (toutes annees) |
|---|---|
| MD | 77.5 |
| MS | 77.5 |
| WD | 75.5 |
| WS | 75.5 |
| XD | 77.5 |

| seau | annee | lignes | matchs | P(over) realise | ROI over | IC 95 % (bootstrap match, 2000, graine 42) |
|---|---|---|---|---|---|---|
| rel <= -2 | 2024 | 33 | 16 | 75.76 % | +43.61 % | [+2.26 % ; +73.72 %] |
| rel <= -2 | 2025 | 1573 | 924 | 55.75 % | +0.74 % | [-5.40 % ; +7.19 %] |
| rel <= -2 | 2026 | 698 | 400 | 61.32 % | +8.87 % | [-0.01 % ; +17.69 %] |
| **rel <= -2** | *toutes* | **2304** | **1340** | 57.73 % | **+3.82 %** | [-1.29 % ; +8.87 %] |
| -2 < rel < +2 | 2024 | 48 | 30 | 43.75 % | -18.44 % | [-50.61 % ; +18.38 %] |
| -2 < rel < +2 | 2025 | 1755 | 1290 | 51.91 % | -5.91 % | [-11.19 % ; -0.62 %] |
| -2 < rel < +2 | 2026 | 995 | 705 | 53.57 % | -4.32 % | [-11.03 % ; +2.49 %] |
| **-2 < rel < +2** | *toutes* | **2798** | **2025** | 52.36 % | **-5.56 %** | [-9.66 % ; -0.92 %] |
| rel >= +2 | 2024 | 111 | 48 | 44.14 % | -18.26 % | [-49.44 % ; +16.13 %] |
| rel >= +2 | 2025 | 1155 | 896 | 47.19 % | -14.23 % | [-20.24 % ; -7.65 %] |
| rel >= +2 | 2026 | 475 | 406 | 51.37 % | -7.94 % | [-17.13 % ; +1.49 %] |
| **rel >= +2** | *toutes* | **1741** | **1350** | 48.13 % | **-12.77 %** | [-18.00 % ; -7.33 %] |

## A6 - Une seule ligne par match (la plus basse disponible)

| perimetre | paris | matchs | P(over) realise | ROI over | IC 95 % |
|---|---|---|---|---|---|
| **global** | 3858 | 3858 | 54.04 % | -3.27 % | [-6.24 % ; -0.58 %] |
| annee 2024 | 69 | 69 | 53.62 % | -0.28 % | [-21.77 % ; +23.13 %] |
| annee 2025 | 2533 | 2533 | 52.98 % | -4.67 % | [-8.12 % ; -1.15 %] |
| annee 2026 | 1256 | 1256 | 56.21 % | -0.60 % | [-5.43 % ; +4.24 %] |

## A7 - La cloture (descriptif)

| perimetre | lignes | P(over) implicite cloture | over realise | ecart |
|---|---|---|---|---|
| **global** | 6843 | 49.88 % | 53.09 % | +3.21 pts |
| annee 2024 | 192 | 49.06 % | 49.48 % | +0.42 pts |
| annee 2025 | 4483 | 49.88 % | 52.04 % | +2.16 pts |
| annee 2026 | 2168 | 49.96 % | 55.58 % | +5.62 pts |

Lignes dont la cote over a bouge de plus de 0,01 entre ouverture et cloture : **3055 / 6843 = 44.64 %**.

| annee | lignes | cote over bougee > 0,01 | part |
|---|---|---|---|
| 2024 | 192 | 55 | 28.65 % |
| 2025 | 4483 | 1938 | 43.23 % |
| 2026 | 2168 | 1062 | 48.99 % |

**CLV over descriptive** `P_over_cloture_devig x cote_over_ouverture - 1`, moyenne globale : **-10.008 %**.

| annee | lignes | CLV over moyenne |
|---|---|---|
| 2024 | 192 | -8.478 % |
| 2025 | 4483 | -9.661 % |
| 2026 | 2168 | -10.861 % |

*Rappel protocole : la cloture des totaux n'est pas un arbitre. Section descriptive.*

# Run 4-bis — Les totaux : réplique indépendante dans le dépôt source

**Date de génération de l'export : 2026-08-28** (`npm run export`).

| fichier | mes lignes | référence du jumeau (export du 2026-08-20) | écart |
|---|---|---|---|
| `matches.csv` | **22 038** | 21 967 | **+71** |
| `cotes.csv` | **22 844** | 22 844 | **0** |
| `cotes-totaux.csv` | **6 843** | 6 843 | **0** |
| `players.csv` | **2 372** | 2 372 | **0** |

Les trois fichiers qui portent les cotes et les joueurs sont **identiques en
effectif**. L'écart de 71 lignes de `matches.csv` correspond exactement aux
matchs joués du **2026-08-20 au 2026-08-23** (38 + 18 + 10 + 5), ajoutés au
dépôt entre les deux exports. La dernière cote de l'export date du
**2026-08-02** : ces 71 matchs sont donc tous postérieurs à toute donnée de
marché, et comme l'Elo et les moyennes glissantes sont calculés dans l'ordre
chronologique, **ils ne peuvent influencer aucun chiffre des parties A et B**.
Toute divergence avec le jumeau sur ces parties viendra d'un choix de méthode,
pas des données.

---

## 1. La réponse en trois lignes

1. **Le biais est réel et son mécanisme est identifié.** Betclic annonce 49,96 %
   d'over à l'ouverture et l'over sort à **53,09 %** (55,58 % en 2026), parce
   qu'il **recopie le même prix ~1,85 / 1,85 à chaque barreau de son escalier**
   au lieu de coter une distribution : l'écart-type de sa probabilité implicite
   sur tout l'escalier 2025 est de **1,03 point**.
2. **Un modèle de points entraîné sans jamais voir une cote ne transforme pas ce
   biais en argent.** Sur le test 2026 scellé : 470 paris, 309 matchs,
   **ROI +2,80 %, IC 95 % [−7,53 % ; +13,42 %]** — l'intervalle contient zéro, et
   **63 tirages au hasard sur 200**, à profil identique, font aussi bien.
   Le critère de succès pré-enregistré est **échoué**.
3. **Décision : ne pas miser.** L'espérance annuelle à 100 € la mise est de
   **+2 341 €** pour **83 683 €** engagés, avec un IC de
   **[−6 299 € ; +11 234 €]**. C'est un pile ou face à 84 k€ la partie.

---

## 2. Ce que j'ai mesuré, et comment

**Partie A — diagnostic prescrit.** Arithmétique pure sur les 6 843 lignes de
`cotes-totaux.csv` : couverture, marge, calibration, ROI over/under à
l'ouverture par année, discipline, tercile de ligne brute et seau de ligne
relative, une-ligne-par-match, et la clôture en descriptif. Aucune exclusion
au-delà de celles demandées — et il n'y en a eu aucune à faire : les 6 843
lignes sont toutes misables, complètes et réglées.

**Partie B — étude pré-enregistrée.**

- **Le modèle** (`code/modele.py`) décompose
  `P(total > L) = P3·S3(L−μ3) + (1−P3)·S2(L−μ2)` : une logistique pour la
  probabilité de 3ᵉ manche, deux régressions pour l'espérance de total à 2 et à
  3 manches, et la **survie empirique des résidus** d'entraînement pour la
  dispersion. Ce découpage vient de la donnée : un match en 2 manches fait
  39 à 100 points, un match en 3 manches 86 à 146 — les deux nuages se touchent
  à peine, donc c'est P3 qui porte le signal.
- **12 variables**, toutes issues de `matches.csv` : discipline, écart Elo et
  son carré tronqué, niveau Elo, moyenne glissante causale du total de points
  des deux camps, tour, qualification, entité neuve. **Aucune cote, d'aucun
  marché, n'entre nulle part** — ni cible, ni variable, ni poids, ni filtre.
- **L'Elo** est recalculé en Python (`code/moteur.py`) avec les paramètres de
  `lib/elo.mjs`, en ordre chronologique strict. Contrôle de santé : log-loss du
  vainqueur 0,5455 (2023), 0,5555 (2024), 0,5375 (2025), 0,5548 (2026), exactitude
  71-73 %.
- **Réglage 2022-2024** (13 181 matchs) ; **calibration de la stratégie sur les
  cotes 2025** ; **test 2026 scellé**, ouvert une seule fois après le commit
  `5ba007b` de `preenregistrement.md`.
- **16 hypothèses** écrites avant leur résultat avec prédiction chiffrée
  (`journal.md`), sur un budget de 20. Les trois dernières (H14, H15, H16) sont
  des diagnostics et des audits de mon propre harnais, écrites après l'ouverture
  et signalées comme telles ; elles n'ont aucun pouvoir sur le verdict.
- **Bootstrap toujours groupé par `match_id`**, 2 000 tirages, graine 42.

**Partie C — descriptif.** Les 344 instantanés de `data/books/runs/`.

---

## 3. Les chiffres

### 3.1 Le marché (partie A)

| grandeur | 2024 | 2025 | 2026 | global |
|---|---|---|---|---|
| lignes misables | 192 | 4 483 | 2 168 | **6 843** |
| matchs distincts | 69 | 2 533 | 1 256 | **3 858** |
| marge à l'ouverture | 9,26 % | 10,54 % | **12,02 %** | **10,97 %** |
| P(over) implicite ouverture | 49,07 % | 49,96 % | 50,04 % | **49,96 %** |
| over réalisé | 49,48 % | 52,04 % | **55,58 %** | **53,09 %** |
| **écart** | +0,41 pt | +2,08 pts | **+5,54 pts** | **+3,13 pts** |
| ROI over (ouverture) | −7,67 % | −5,72 % | **−0,87 %** | −4,24 % |
| ROI under (ouverture) | −9,29 % | −13,28 % | −20,66 % | −15,50 % |

Un seul opérateur : **Betclic**, sur toutes les lignes, à toutes les années.

**Le biais est dans le niveau de la ligne, pas dans le prix.** Par tercile de
ligne brute, toutes années :

| tercile | lignes | matchs | ROI over | ROI under |
|---|---|---|---|---|
| ligne ≤ 75,5 | 2 790 | 1 587 | **+3,19 %** | −22,96 % |
| 75,5 < ligne < 78,5 | 1 731 | 1 360 | −6,37 % | −13,46 % |
| ligne ≥ 78,5 | 2 322 | 1 762 | **−11,56 %** | −8,07 % |

Par seau de ligne relative à la médiane de la discipline, avec IC 95 % groupé
par match :

| seau | année | lignes | matchs | over réalisé | ROI over | IC 95 % |
|---|---|---|---|---|---|---|
| rel ≤ −2 | 2025 | 1 573 | 924 | 55,75 % | +0,74 % | [−5,40 ; +7,19] |
| rel ≤ −2 | 2026 | 698 | 400 | 61,32 % | **+8,87 %** | [−0,01 ; +17,69] |
| rel ≤ −2 | toutes | 2 304 | 1 340 | 57,73 % | +3,82 % | [−1,29 ; +8,87] |
| −2 < rel < +2 | toutes | 2 798 | 2 025 | 52,36 % | −5,56 % | [−9,66 ; −0,92] |
| rel ≥ +2 | toutes | 1 741 | 1 350 | 48,13 % | **−12,77 %** | [−18,00 ; −7,33] |

Aucun seau ne dégage un IC excluant zéro du bon côté, y compris `rel ≤ −2` en
2026 dont la borne basse frôle zéro à −0,01 point.

**Une seule ligne par match** (la plus basse) : 3 858 paris, ROI over
**−3,27 %** [−6,24 ; −0,58] ; 2026 seul : 1 256 paris, **−0,60 %**
[−5,43 ; +4,24].

**La clôture** ne corrige rien : P(over) implicite de clôture 49,88 % contre
53,09 % réalisés, soit **+3,21 points** d'erreur — plus qu'à l'ouverture. La
cote over bouge de plus de 0,01 sur **44,64 %** des lignes (28,7 % en 2024,
43,2 % en 2025, 49,0 % en 2026). CLV over descriptive : **−10,01 %**.
C'est la confirmation directe que la clôture des totaux n'est pas un arbitre.

### 3.2 Le mécanisme (H5)

Sur les 4 483 lignes 2025, écart-type de la probabilité implicite d'ouverture :
**1,03 point**, l'escalier entier tenant entre 46,6 % et 52,5 %.

| écart à la ligne principale | lignes | P annoncée par Betclic | P du modèle | over réalisé |
|---|---|---|---|---|
| −3 | 108 | 50,21 % | 55,20 % | 52,78 % |
| −2 | 245 | 50,23 % | 54,85 % | 55,51 % |
| −1 | 493 | 50,43 % | 54,62 % | 54,97 % |
| **0** | 2 533 | 50,06 % | 51,56 % | 51,80 % |
| +1 | 786 | 49,40 % | 49,95 % | 50,13 % |
| +2 | 222 | 49,35 % | 47,87 % | 50,45 % |

Betclic descend de 50,2 % à 49,4 % quand on parcourt cinq barreaux ; le réalisé
descend de 52,8 % à 50,1 % ; le modèle de 55,2 % à 50,0 %. **L'opérateur ne cote
pas son escalier.** Ce fait ne dépend d'aucun modèle et c'est le résultat le
plus solide de l'étude.

### 3.3 Le test 2026 (partie B)

Stratégie gelée : over, prix d'ouverture, seuil `p_modèle − p_marché ≥ 0,060`,
toutes les lignes éligibles du match, jambe under désactivée.

| critère pré-enregistré | valeur | verdict |
|---|---|---|
| paris ≥ 300 | **470** | ✅ |
| matchs distincts ≥ 250 | **309** | ✅ |
| ROI > 0 | **+2,80 %** | ✅ |
| IC 95 % groupé par match excluant zéro | **[−7,53 % ; +13,42 %]** | ❌ |
| contrôle à blanc passant | IC contient zéro | ✅ |

**Protocole échoué**, sur le seul critère qui décide.

| | 2025 (calibration) | 2026 (test) |
|---|---|---|
| paris / matchs | 1 094 / 718 | 470 / 309 |
| ROI over | +4,17 % | +2,80 % |
| placebo attendu de la sélection | **−3,64 %** | **+1,11 %** |
| ROI net du placebo | **+7,81 %** | **+1,68 %** |
| IC 95 % du net | [+0,90 ; +14,70] | [−8,36 ; +12,18] |
| tirages à blanc stricts ≥ sélection | **5 / 200** (p = 0,030) | **63 / 200** (p = 0,318) |

Le **placebo n'est pas stationnaire** : les cellules où la stratégie parie
rapportaient −3,64 % en 2025 et rapportent **+1,11 %** en 2026 toutes seules.
C'est lui qui mange le résultat.

**Le pouvoir de rangement du modèle s'est effondré** (H15) :

| année | ROI over quintile bas de P | quintile haut | écart | IC 95 % |
|---|---|---|---|---|
| 2025 | −12,83 % | +6,43 % | **+19,26 pts** | [+8,76 ; +30,17] — exclut zéro |
| 2026 | −2,45 % | +3,12 % | **+5,57 pts** | [−10,24 ; +20,89] — **contient zéro** |

En taux d'over réalisé, l'écart entre quintile haut et bas tombe de 11,0 points
(2025) à 3,6 points (2026).

**Contrôle miroir (H13), parfait :** marge d'ouverture de la sélection 12,016 %,
ROI over +2,80 %, ROI under des mêmes lignes −24,38 %, somme **−21,58 %** contre
**−21,45 %** attendus par `−2m/(1+m)`. Écart 0,13 point. La jambe under
symétrique, désactivée sur la foi de 2025, rend **−20,29 %** [−31,61 ; −8,32] sur
2026 : la désactivation était le bon choix.

**Calibration du modèle sur 2026**, tout l'univers, par décile : le modèle est
faux dans un sens systématique — décile 1, annoncé 36,39 %, réalisé 52,78 %
(**+16,38 pts**) ; décile 10, annoncé 62,42 %, réalisé 59,45 % (−2,97 pts).
Un modèle qui aurait gagné là-dessus aurait été suspect ; il n'a pas gagné.

### 3.4 L'euro

Période couverte par les lignes 2026 : du 2026-01-07 au 2026-08-02, **0,56 an**.

| grandeur | valeur |
|---|---|
| paris par an | **837** |
| mise | 100 € |
| capital engagé par an | **83 683 €** |
| **espérance annuelle** | **+2 341 €** |
| **IC 95 %** | **[−6 299 € ; +11 234 €]** |

### 3.5 La disponibilité des prix (partie C)

**Le résultat principal de la partie C est négatif : `data/books/runs/` ne
contient aucun marché de totaux.** Recensement exhaustif des champs sur les
5 170 lignes-instantané : `book`, `bookMatchId`, `srId`, `tournament`,
`discipline`, `p1`, `p2`, `odd1`, `odd2`, `startUtc`, `isLive` (100 % chacun) et
`sets` (38,0 %, depuis le 2026-08-16). Rien d'autre. Le schéma normalisé de
`lib/books.mjs` ne prévoit pas ce marché.

**Les trois questions de la commande sur les lignes de totaux — délai
d'apparition, durée de vie d'un prix, mouvement de la ligne — restent donc sans
réponse.** Ce n'est pas un trou de couverture : la donnée n'a jamais été captée.
Et l'ironie est complète : **Betclic, le seul opérateur qui cote les totaux, est
le plus mal relevé** — 276 lignes sur 5 170, présent dans 16 des 344 instantanés,
contre 4 629 lignes et 167 instantanés pour Unibet.

Sur le marché **vainqueur**, à titre de comparaison, tout est mesurable :

| opérateur | séries | instantanés/série (médiane) | délai 1ʳᵉ vue → match (médiane) | plage de prix (médiane) | séries qui bougent |
|---|---|---|---|---|---|
| betclic | 119 | 2 | 12,6 h | 0,12 h | 28 % |
| unibet | 319 | **12** | 17,3 h | **1,49 h** | **83 %** |
| winamax | 109 | 2 | 3,1 h | 0,09 h | 33 % |

Seul Unibet est suivi assez densément pour que ces chiffres veuillent dire
quelque chose : un prix y tient **1,5 heure** de médiane, une série connaît
**3,0 changements** en moyenne, d'amplitude médiane 0,05 (2,0 % relatif).
Cadence des relevés : 1,85 h de médiane, et **51,2 % des instantanés sont vides**.

**Le prix « ouverture » de l'export est-il le premier instantané ?** La fenêtre
de recouvrement ne fait que **3 jours** (les relevés commencent le 2026-07-31,
les cotes de l'export s'arrêtent le 2026-08-02) : **31 couples** comparables.
**10 sur 31 (32 %)** sont identiques ; écart absolu médian **0,02** ; écart moyen
**+0,061**, tiré par deux valeurs aberrantes (+1,80 et +1,60) sur le même match
chez deux opérateurs — soit un vrai repricing, soit un appariement de noms qui
m'a échappé. Sur 31 couples et 3 jours, **je ne considère pas la question
tranchée.**

---

## 4. Ce qui a échoué

C'est la section la plus longue, et c'est normal.

**H1 — le modèle ne bat rien en log-loss.** Annoncé un gain de +0,005 à +0,025
sur le marché ; obtenu **+0,0002**. Le modèle sort à 0,6931, exactement la
constante 50 %. Il discrimine (13,5 points d'écart réalisé entre ses déciles
extrêmes sur 2025) mais annonce 29 points : il paie en log-loss ce qu'il gagne
en ordonnancement.

**H4 — la calibration hors échantillon ne corrige rien.** J'ai prédit une pente
de Platt entre 0,35 et 0,75 ; obtenu **0,9975** sur 65 905 couples. Le modèle est
**déjà parfaitement calibré sur sa propre période**. Donc l'excès de confiance
n'est pas du sur-ajustement.

**H7 — la dérive du sport n'explique pas l'écart.** Annoncé +1,0 point de total
moyen et +1,5 point de 3ᵉ manche entre 2022-2024 et 2025 ; obtenu **+0,36** et
**+0,97**. Un déplacement de 0,36 point sur une distribution d'écart-type 19,7
ne produit pas 10 points d'erreur de calibration.

**H9 — le modèle n'est pas meilleur que la ligne.** Annoncé une corrélation
modèle/réalisé supérieure à 0,25 ; obtenu **0,150**, contre **0,146** pour la
ligne Betclic seule. Corrélation entre les deux : 0,725. R² de la régression
jointe : **0,025**. Le total de points d'un match de badminton est très largement
imprévisible, par moi comme par l'opérateur. **S'il y avait de l'argent à faire,
ce ne serait donc pas en prévoyant mieux.**

**H10 — l'origine de l'excès de confiance n'est expliquée qu'en partie.**
Restreindre la calibration aux barreaux centraux fait tomber la pente de 0,9975
à **0,8522** — c'est bien le régime de ligne qui est en cause, et pas le
périmètre de matchs (0,8522 vs 1,0010 en restreignant aux matchs cotés). Mais
pour expliquer l'étalement observé sur 2025 il faudrait une pente d'environ
**0,45**. Le gros du phénomène **reste inexpliqué**.

**H11 — le test.** ROI +2,80 %, IC contenant zéro. La stratégie a été calibrée
sur une année (2025) où elle rendait +7,81 % net avec un IC dont la borne basse
était à **+0,90 %**. Cet effet, fragile dès la calibration, ne s'est pas
reproduit.

**H12 — le contrôle à blanc passe, mais pas comme annoncé.** J'avais prédit un
ROI net entre −4 et +4 % pour le tirage à blanc 2026 ; il a rendu **+8,07 %**,
donc davantage que la sélection réelle. L'IC contenant zéro, le contrôle est
formellement passant — mais la prédiction est ratée, et pour une raison qui
tenait à mon code (voir H14).

**H14 — mon propre contrôle à blanc était biaisé, et je m'en suis aperçu après
coup.** Le tirage à blanc concentrait ses paris sur des matchs à barreaux
nombreux (265 matchs pour 470 paris, contre 309 pour la sélection réelle). Or
sur 2026 le ROI over des matchs à 3 barreaux ou plus dépasse de **+11,51 points**
celui des matchs à un seul barreau. Le +8,07 % que ce tirage rendait était donc
en partie un artefact de mon code. Refait à profil de barreaux strict (H16), le
hasard rend **−1,93 %** — et la conclusion ne bouge pas : 63 tirages sur 200
atteignent quand même la sélection réelle.

**Ce qui a marché**, pour l'équilibre : H2, H3, H5, H6, H8, H13, H15, H16.
Notamment H5 (le mécanisme du biais), H13 (le miroir, à 0,13 point près) et H15
(l'effondrement du pouvoir de rangement), qui sont les trois résultats sur
lesquels je m'appuie le plus.

---

## 5. Ce que je ne sais pas

1. **Pourquoi le modèle est sur-étalé hors de sa période d'entraînement.** H4
   exclut le sur-ajustement, H7 exclut la dérive du sport, H10 n'explique
   qu'une pente de 0,85 sur les ~0,45 qu'il faudrait. Il reste un phénomène
   non identifié. Tant qu'il ne l'est pas, tout modèle de totaux construit sur
   cette base est à traiter comme non calibré.

2. **Si le prix d'ouverture des totaux était réellement misable.** C'était la
   question bloquante des études antérieures, et mon dépôt était censé pouvoir
   y répondre. Il ne le peut pas : le marché n'est pas dans les relevés. Sur le
   marché vainqueur et 31 couples seulement, l'ouverture de l'export coïncide
   avec le premier instantané dans 32 % des cas. **Ce n'est pas une réponse.**

3. **Si le biais de +3 points d'over survivrait à une exposition réelle.** Un
   opérateur qui recopie 1,85 / 1,85 sur tout son escalier le fait probablement
   parce que le volume y est nul. Rien dans ces données ne dit quelle mise
   passe, ni combien de temps un compte gagnant survit.

4. **Si `rel ≤ −2` est un vrai gisement.** Sur 2026 seul : +8,87 %,
   IC [−0,01 ; +17,69], 400 matchs — la borne basse frôle zéro. Sur toutes les
   années : +3,82 %, IC [−1,29 ; +8,87]. C'est le meilleur candidat restant,
   **et il n'est pas démontré.** Il mériterait sa propre étude scellée, sur
   2027, avec une règle décidée aujourd'hui.

5. **Ce que dirait un modèle par entité.** Mes 12 variables sont volontairement
   grossières. Un modèle qui apprendrait la longueur de match propre à chaque
   joueur ou paire ferait peut-être mieux — mais H9 dit que même l'opérateur,
   avec ses moyens, plafonne à R² = 0,025 sur le total.

---

## 6. La décision recommandée

**Ne pas miser sur le marché over/under des totaux BWF de Betclic.**

Les trois raisons, dans l'ordre d'importance :

1. **Le talent de sélection n'est pas démontré.** Sur 2026, un tirage au hasard
   à profil identique fait aussi bien que la stratégie une fois sur trois
   (p = 0,318). Ce qui rendait p = 0,030 sur 2025 ne s'est pas reproduit.
2. **L'espérance ne paie pas le risque.** +2 341 € par an pour 83 683 € engagés,
   IC [−6 299 € ; +11 234 €]. Une année perdante à −6 000 € est dans
   l'intervalle, sur un marché dont l'opérateur peut fermer le compte.
3. **Le placebo n'est pas stationnaire.** Il a basculé de −3,64 % à +1,11 % sur
   la même sélection d'une année à l'autre. Toute stratégie calibrée sur une
   année et jouée l'année suivante est exposée à ce basculement, qui est plus
   grand que l'effet recherché.

**Ce qui reste vrai et vaut d'être gardé**, indépendamment de toute décision de
mise :

- Betclic **ne cote pas son escalier de totaux** : écart-type de 1,03 point sur
  toute la ladder, contre 5 points d'écart réel entre les barreaux extrêmes.
  C'est un défaut de produit, mesuré, reproductible, et il ne dépend d'aucun
  modèle.
- **Sa clôture ne le corrige pas** (+3,21 points d'erreur, pire qu'à
  l'ouverture) : personne n'arbitre ce marché. La règle d'or de la commande est
  vérifiée sur les données.
- **La marge monte** : 9,26 % en 2024, 10,54 % en 2025, **12,02 % en 2026**. La
  barre de rentabilité s'élève à mesure qu'on regarde.

**Ce que je ferais ensuite**, si quelqu'un veut continuer :

1. **Collecter les totaux dans `data/books/runs/`** — c'est une extension du
   parseur Betclic, pas une étude. Sans ça, la question de la misabilité restera
   ouverte quoi qu'on mesure par ailleurs, et une deuxième année de test sera
   perdue.
2. **Sceller dès aujourd'hui une règle « over sur `rel ≤ −2` »** pour 2027. Elle
   ne demande aucun modèle, elle est le meilleur candidat restant, et sa
   faiblesse actuelle (IC frôlant zéro) est un problème de volume que le temps
   règle tout seul.
3. **Ne pas ré-essayer un modèle de points sans avoir compris le point 1 de la
   section 5.** Un modèle non calibré hors de sa période, pour une raison
   inconnue, ne peut pas porter une décision financière.

---

## 7. Comment reproduire

Voir **`REPRODUIRE.md`** : les commandes exactes, dans l'ordre, avec les durées
mesurées. Tout est en Python 3.9 stdlib pure, graine 42, sans dépendance.

Le scellé est le commit **`5ba007b`** : `preenregistrement.md`,
`modele-final.json` et les hypothèses H11-H13 y sont figés **avant** la première
lecture de 2026 au grain stratégie. `git show 5ba007b --stat` le vérifie.

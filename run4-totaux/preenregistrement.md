# Pré-enregistrement — run4-totaux, partie B

**Figé le 2026-08-28**, commité avant toute lecture de 2026 au grain stratégie.
Tout ce qui suit est décidé ; rien n'est réestimé après ce document.

Fuite déclarée et connue au moment d'écrire : la partie A a mesuré 2026 **en
agrégat** (couverture, marge, calibration, ROI over/under global et par
discipline, seaux de ligne relative). Je sais donc, en écrivant ceci, que le
marché 2026 sur-réalise l'over de +5,54 points et que le ROI over global 2026
vaut −0,87 %. Ces deux chiffres entrent dans mes prédictions ci-dessous — c'est
honnête de le dire, ça les rend moins impressionnantes si elles tombent juste.
Ce qui reste scellé est la **stratégie** : aucune sélection, aucun seuil, aucun
ROI de sélection 2026 n'a été calculé.

---

## 1. La question

Un modèle du total de points, entraîné sans jamais voir une cote de total,
bat-il la ligne Betclic de plus que la marge, sur 2026 ?

## 2. Le modèle — gelé

Fichier : `modele-final.json`. Reproduit par `code/gel.py`.

**Entrées** : `matches.csv` seul (score, discipline, tour, rang mondial
pré-match) et l'Elo causal dérivé de ces mêmes matchs. **Aucune cote d'aucun
marché** n'entre dans l'estimation — ni en cible, ni en variable, ni en poids,
ni en filtre d'échantillon.

**Structure** :

```
P(total > L) = P3 · S3(L − μ3) + (1 − P3) · S2(L − μ2)
```

- `P3` : régression logistique, P(le match va en 3 manches) ;
- `μ2`, `μ3` : moindres carrés, E[total | 2 manches] et E[total | 3 manches] ;
- `S2`, `S3` : survie **empirique** des résidus d'entraînement, interpolée.

12 variables : constante, 4 indicatrices de discipline (MD = référence),
écart Elo / 100, écart Elo tronqué au carré, niveau Elo moyen, moyenne
glissante causale du total de points des deux camps, indicatrice de tour élevé
(QF+), indicatrice de qualification, indicatrice d'entité neuve (< 5 matchs).

**Période de réglage** : les 13 181 matchs de 2022, 2023 et 2024.

**Calibration** : Platt `logit' = a + b·logit`, `a = 0,000688`, `b = 0,852242`,
estimée hors échantillon (5 plis chronologiques) sur les mêmes années, à la
**ligne médiane de la discipline** — le régime de ligne que Betclic propose
réellement. Aucune cote consultée pour l'estimer.

L'Elo est recalculé en Python (`code/moteur.py`) avec les paramètres de
`lib/elo.mjs` : initial 1500, K 32 (48 sous 5 matchs), multiplicateur 0,85 pour
un match en 3 manches, amorce linéaire par rang mondial sur le top 60, amorce
d'une paire neuve depuis les notes individuelles de ses joueurs (poids 1,
minimum 10 matchs). Il est **causal** : la note lue pour un match est
antérieure à ce match.

## 3. La stratégie — gelée

**Univers** : `cotes-totaux.csv`, `misable = true`, quatre cotes
(over/under × ouverture/clôture) et `resultat_over` présents, match rattachable
à `matches.csv`.

**Règle** : parier **over**, mise 1, au **prix d'ouverture**, sur toute ligne
telle que

```
p_modèle_calibré(over)  −  p_marché_ouverture_dévigué(over)  ≥  0,060
```

Dé-vig proportionnel `(1/o) / (1/o + 1/u)`.

**Choix de ligne** : **toutes** les lignes éligibles du match sont pariées. Un
match peut donc porter plusieurs paris ; le contrôle à blanc reprend le même
profil de lignes par match.

**Jambe under : désactivée.** Sur 2025, aucun seuil de la grille ne la rend
rentable (le meilleur, s = 0,120, donne +0,23 % sur 155 paris ; tous les autres
sont entre −7,1 % et −2,9 %). Elle sera néanmoins calculée et rapportée sur
2026 au titre du contrôle miroir.

**Origine du seuil 0,060** : plus petit seuil de la grille
{0,02 ; 0,03 ; 0,04 ; 0,05 ; 0,06 ; 0,065 ; 0,07 ; 0,08 ; 0,09 ; 0,10 ; 0,12}
tel que (1) l'IC 95 % du ROI net du placebo exclut zéro sur 2025 **et**
(2) le volume 2026 projeté atteint 400 paris et 300 matchs distincts — une marge
sur le minimum de 300/250 du critère de succès. Résultat sur 2025 : 1 094 paris,
718 matchs, ROI over +4,17 %, placebo attendu −3,64 %, **ROI net +7,81 %**,
IC 95 % [+0,90 % ; +14,70 %].

## 4. Le harnais de contrôle — gelé

**Placebo d'une cellule** = ROI over moyen de **toutes** les lignes misables de
la cellule, calculé **sur la période évaluée** (jamais empruntée à une autre).
Cellule = (seau de ligne relative × discipline), avec
`rel = ligne − médiane des lignes misables de la discipline, toutes années`
et les trois seaux `rel ≤ −2`, `−2 < rel < +2`, `rel ≥ +2`.
Médianes gelées : MD 77,5 · MS 77,5 · WD 75,5 · WS 75,5 · XD 77,5.

**ROI net** = ROI de la sélection − moyenne des placebos des cellules des paris
de la sélection.

**Contrôle 1 — tirage à blanc.** Pour chaque match de la sélection, on tire un
match au hasard de la même période capable de fournir le même nombre de lignes
dans les mêmes cellules (graine 42). Son ROI net du placebo doit avoir un
IC 95 % contenant zéro. Rapporté aussi sur 200 tirages indépendants
(graines 1000-1199).

**Contrôle 2 — miroir.** L'under des mêmes lignes. La somme des deux ROI doit
valoir environ `−2·marge/(1+marge)`.

**Contrôle 3 — comptage.** Paris **et** matchs distincts partout.

**Bootstrap** : toujours groupé par `match_id`, rééchantillonnage des matchs
avec remise à effectif constant, 2 000 tirages, graine 42, percentiles
2,5 / 97,5. Jamais par ligne.

## 5. Le critère de succès

Le protocole est **réussi** si, sur 2026 :

1. ROI de la sélection **> 0** ;
2. IC 95 % groupé par match **excluant zéro** ;
3. au moins **300 paris et 250 matchs distincts** ;
4. contrôle 1 passant (IC du tirage à blanc contenant zéro).

En dessous du volume : **pas de verdict**, quel que soit le ROI.

Sont rapportés en plus, sans pouvoir de décision : la calibration du modèle par
décile sur 2026, la CLV (descriptive seulement — la clôture des totaux n'est
pas un arbitre), et l'euro final (paris/an, mise 100 €, espérance annuelle
avec IC).

## 6. Les prédictions chiffrées, écrites avant l'ouverture

Voir `journal.md`, hypothèses **H11 à H13**, écrites et commitées en même temps
que ce document.

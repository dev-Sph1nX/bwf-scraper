# Journal des hypothèses — run4-totaux

Budget : **20 hypothèses**. Chacune est écrite **avant** son résultat, avec une
prédiction chiffrée. Toute ligne ajoutée après coup est marquée
`[ÉCRIT APRÈS COUP — confirmatoire, disqualifié]`.

Conventions : bootstrap toujours groupé par `match_id`, 2 000 tirages, graine 42,
percentiles 2,5 / 97,5. « Lignes » = lignes de `cotes-totaux.csv` misables ;
« matchs » = `match_id` distincts.

La **partie A** n'a pas d'hypothèse : c'est un calcul prescrit par la commande,
publié tel quel.

---

## H1 — Le modèle de points bat la constante sur les lignes 2025

*Écrite le 2026-08-28, avant tout calcul sur 2025.*

Le modèle (P3 logistique + μ₂/μ₃ moindres carrés + survie empirique des résidus),
réglé sur les seuls résultats 2022-2024, produit sur les lignes misables 2025 un
**log-loss inférieur à 0,6931** (la constante 50 %) et inférieur à celui du
marché à l'ouverture dé-vigué.

Prédiction chiffrée : log-loss modèle ∈ [0,660 ; 0,690] ; log-loss marché
ouverture ≈ 0,690 ± 0,003. Gain du modèle sur le marché : **+0,005 à +0,025**.

**Verdict : ÉCHEC.** Log-loss modèle **0,6931**, exactement la constante 50 %.
Marché ouverture 0,6933, clôture 0,6929, oracle constant 0,6923. Gain du modèle
sur le marché : **+0,0002**, cent fois moins que prédit.

La cause est lisible dans la table de calibration : le modèle **discrimine**
(décile 1 → 47,1 % d'over réalisé, décile 10 → 60,6 %, soit 13,5 points d'écart)
mais il est **trop étalé** (il annonce 36,3 % → 65,5 %, soit 29 points). Il paie
en log-loss ce qu'il gagne en ordonnancement. Deuxième fait, plus important pour
la suite : le marché, lui, ne discrimine **pas du tout** — de son décile 1 à son
décile 10 le taux d'over réalisé passe de 53,6 % à 55,0 %.

---

## H2 — Le modèle voit plus d'over que le marché

*Écrite le 2026-08-28, avant tout calcul sur 2025.*

La partie A montre un marché dont le P(over) implicite reste collé à 50 % alors
que l'over sort à 52 % en 2025. Si le modèle est correct et le marché biaisé,
la moyenne de `P_modèle(over)` doit dépasser la moyenne de
`P_marché_ouverture(over)` sur les mêmes lignes 2025.

Prédiction chiffrée : écart moyen `P_modèle − P_marché` = **+1,0 à +4,0 points**
sur les lignes misables 2025.

**Verdict : CONFIRMÉE.** P(over) modèle 51,23 %, P(over) marché ouverture
49,96 %, écart **+1,28 pt**, dans la fourchette annoncée. L'over réalisé 2025
sort à 52,04 % : le modèle est du bon côté, mais ne va pas assez loin.

---

## H3 — L'écart modèle/marché est monotone en ROI sur 2025

*Écrite le 2026-08-28, avant tout calcul sur 2025.*

Si l'écart porte de l'information et pas du bruit, le ROI over à l'ouverture
doit croître avec `P_modèle(over) − P_marché(over)` : négatif dans le décile où
le modèle voit **moins** d'over que le marché, positif dans le décile où il en
voit **plus**.

Prédiction chiffrée : ROI over du décile haut d'écart **> +3 %** et supérieur
d'au moins **8 points** au ROI over du décile bas, sur 2025.

**Verdict : CONFIRMÉE, largement.** Décile 10 : ROI over **+12,55 %** (449
lignes, 305 matchs, écart moyen +15,3 pts, over réalisé 62,1 %). Décile 1 :
**−14,80 %**. Écart entre extrêmes **27,4 points**, contre 8 prédits. La
progression est monotone sur les 6 derniers déciles.

**Réserve à porter au rapport, écrite ici avant toute suite :** `P_marché`
varie très peu (48,2 % au décile 1, 51,7 % au décile 10), donc
`écart = P_modèle − P_marché ≈ P_modèle − 0,50`. Cette hypothèse ne teste donc
pas « le modèle bat le marché », elle teste « le modèle range les matchs ». Le
risque est que ce rangement ne soit qu'une redite de la partie A (ligne basse →
over gagne). C'est exactement ce que le contrôle placebo doit trancher — cf. H6.

---

## H4 — Une calibration hors-échantillon sur 2022-2024 corrige l'étalement

*Écrite le 2026-08-28, avant calcul.*

Le défaut vu en H1 est de l'excès de confiance, pas un manque de signal. Une
calibration de Platt (`logit' = a + b·logit`) estimée **hors échantillon** par
5 plis chronologiques à l'intérieur de 2022-2024 — donc sans toucher ni 2025 ni
2026, ni la moindre cote — doit ramener l'étalement au niveau du signal réel.

Prédictions chiffrées, sur les lignes misables 2025 :
- pente `b` estimée **entre 0,35 et 0,75** (compression) ;
- log-loss du modèle calibré **< 0,6905** ;
- écart de calibration du décile 1 ramené sous **+5 points** (contre +10,8) ;
- **le classement des lignes est inchangé** (Platt est monotone), donc le ROI
  par décile d'écart de H3 doit être identique à la 3ᵉ décimale près.

**Verdict : ÉCHEC sur les trois premières prédictions, CONFIRMÉE sur la
quatrième.** Sur 65 905 couples (match, ligne candidate) hors échantillon
— lignes candidates = percentiles 20/35/50/65/80 du total de points de la
discipline, calculés sur le pli d'entraînement, **aucune cote consultée** —
Platt donne **a = 0,0207, b = 0,9975**. La pente est à 1 : le modèle est
**déjà parfaitement calibré sur sa propre période**. Log-loss 2025 : 0,6930
(prédit < 0,6905). Décile 1 : +10,27 pts d'écart (prédit < +5).

**Ce que ça change.** L'excès de confiance vu en H1 n'est pas du sur-ajustement
— sinon la validation croisée l'aurait vu. C'est de la **dérive** : le modèle
est juste sur 2022-2024 et faux sur 2025, dans un sens précis (il annonce trop
peu d'over). Ce diagnostic ouvre H7. La calibration Platt est conservée dans
`modele-final.json`, mais dans cette variante-ci (pente 0,9975) elle ne fait
rien. C'est une autre variante, identifiée en H10, qui sera finalement gelée.

---

## H5 — Le prix de Betclic ne dit rien de la position de la ligne

*Écrite le 2026-08-28, avant calcul.*

Observation dérivée de H1 : les prix de tout l'escalier semblent collés à
50/50. Si c'est vrai, l'opérateur ne cote pas une distribution — il duplique un
prix de référence à chaque barreau, et la seule information qu'il publie est le
**niveau** de la ligne principale.

Prédiction chiffrée, sur les lignes misables 2025 : l'écart-type de
`P_marché_ouverture(over)` est **inférieur à 3 points** ; la corrélation entre
`P_marché(over)` et l'écart de la ligne à la ligne principale du match est
**inférieure à 0,35 en valeur absolue**.

**Verdict : CONFIRMÉE sur les deux prédictions.** Écart-type **1,03 point**
(tout l'escalier tient entre 46,6 % et 52,5 %). Corrélation **−0,225**.

Le détail est plus parlant que les deux chiffres. À trois barreaux sous la ligne
principale, Betclic annonce toujours 50,2 % d'over, et l'over sort à 52,8 % ;
à un barreau au-dessus, il annonce 49,4 % et l'over sort à 50,1 %. Le modèle,
lui, passe de 55,2 % à 50,0 % sur le même trajet. **L'opérateur recopie son prix
de référence à chaque barreau au lieu de coter une distribution.** C'est le
mécanisme du biais, et il est indépendant de tout modèle.

---

## H6 — La sélection survit au placebo de seau de ligne relative × discipline

*Écrite le 2026-08-28, avant calcul.*

C'est l'hypothèse qui décide. Placebo d'une cellule (seau de `rel` × discipline)
= ROI over moyen de **toutes** les lignes misables de la cellule **sur la période
évaluée**. ROI net = ROI de la stratégie − placebo pondéré par le profil de
cellules de la stratégie.

Prédiction chiffrée, sur 2025, au seuil qui sera retenu : ROI over **net du
placebo ≥ +4 points**, IC 95 % bootstrap groupé par match **excluant zéro**.

**Verdict : CONFIRMÉE.** Au seuil retenu s = 0,08 (voir `preenregistrement.md`
pour la règle de choix) : 992 paris, 666 matchs, ROI over brut **+6,43 %**,
placebo attendu par profil de cellules **−3,37 %**, **ROI net +9,80 %**,
IC 95 % **[+2,75 % ; +16,88 %]** — exclut zéro.

Détail utile : le placebo de la sélection (−3,37 %) est proche du placebo global
2025 (−5,72 %) et très loin des cellules `rel ≤ −2` (entre −7,3 % et +4,9 %). La
sélection **n'est donc pas** une redite de « parier over sur les lignes basses » ;
elle vit à l'intérieur des cellules.

*Chiffres établis avec la calibration de H4 (pente 0,9975).* H10 a ensuite fait
adopter la calibration à pente 0,852, qui comprime les écarts : le seuil
équivalent devient **0,060** et donne 1 094 paris / 718 matchs, ROI over
+4,17 %, placebo −3,64 %, **ROI net +7,81 %**, IC [+0,90 % ; +14,70 %]. Même
conclusion, mêmes paris à l'ordre près : Platt est monotone.

---

## H7 — Les matchs se sont allongés entre l'époque de réglage et aujourd'hui

*Écrite le 2026-08-28, après H4, avant calcul. Mesurée sur 2022-2025 seulement
(2026 reste scellé au grain stratégie ; le prolongement à 2026 est ajouté après
l'ouverture et signalé comme tel).*

Si le modèle est calibré sur 2022-2024 et sous-estime l'over sur 2025, c'est que
la cible a bougé : les matchs produisent plus de points qu'à l'époque du réglage.

Prédictions chiffrées, sur **tous** les matchs de `matches.csv` (cotés ou non) :
- total de points moyen 2025 supérieur d'au moins **+1,0 point** à la moyenne
  2022-2024 ;
- part de matchs en 3 manches 2025 supérieure d'au moins **+1,5 point** à
  2022-2024.

**Verdict : ÉCHEC.** La dérive existe mais elle est trop petite : total moyen
83,38 → 83,74 (**+0,36 point**, prédit ≥ +1,0) ; part de 3 manches 31,55 % →
32,52 % (**+0,97 point**, prédit ≥ +1,5). Elle est concentrée sur WS
(+1,55 point de total, +3,96 de P3) et négative sur XD.

Un déplacement de 0,36 point sur une distribution d'écart-type 19,7 ne peut pas
produire les 10 points d'erreur du décile 1. **L'explication est ailleurs** —
d'où H9.

---

## H8 — Le tirage à blanc ne gagne rien (validation du harnais sur 2025)

*Écrite le 2026-08-28, avant calcul.*

Le contrôle à blanc tire, pour chaque match parié, un match au hasard de la même
période fournissant le même nombre de lignes dans les mêmes cellules
(seau × discipline), graine 42. S'il rapporte quelque chose net du placebo, le
harnais est cassé et rien de ce qui suit ne vaut.

Prédiction chiffrée : ROI net du placebo du tirage à blanc **entre −3 et +3 %**,
IC 95 % contenant zéro. Sur 200 tirages indépendants, la moyenne des ROI nets
doit tomber **entre −1,5 et +1,5 %**.

**Verdict : CONFIRMÉE.** Tirage graine 42 : 992 paris, ROI over −0,69 %,
**ROI net +2,68 %**, IC 95 % **[−6,07 % ; +10,62 %]** — contient zéro. Sur 200
tirages (graines 1000-1199) : net moyen **+0,42 %**, écart-type 3,81 pts,
percentiles 2,5/97,5 [−7,51 % ; +7,60 %]. **0 tirage sur 200** atteint le
+9,80 % de la sélection réelle (p empirique 0,005).

Réserve : le tirage à blanc concentre plus de lignes par match que la sélection
réelle (561 matchs pour 992 paris, contre 666). Le profil de cellules est
respecté, celui de lignes-par-match l'est imparfaitement — cela rend le contrôle
légèrement **plus** favorable au hasard (paris plus corrélés, variance plus
haute), donc conservateur dans le bon sens.

---

## H9 — La ligne de Betclic sait des choses que le modèle ignore

*Écrite le 2026-08-28, après H7, avant calcul.*

Reste une explication à l'excès de confiance : le modèle est extrême là où la
ligne est extrême, et **la ligne est posée par quelqu'un qui en sait plus que
le modèle sur la longueur attendue de ce match précis**. Si c'est vrai, le prix
peut être plat (H5) et la ligne informative en même temps : ce sont deux
produits différents de l'opérateur.

Test : sur les matchs cotés 2025, régresser le total réalisé sur (a) le total
attendu du modèle μ = (1−P3)·μ₂ + P3·μ₃ seul, (b) la ligne principale Betclic
seule, (c) les deux.

Prédictions chiffrées :
- corrélation(μ modèle, total réalisé) **> 0,25** ;
- corrélation(ligne principale, total réalisé) **entre 0,08 et 0,20** ;
- dans la régression jointe, le coefficient de la ligne reste **positif et
  significatif (|t| > 3)**, ce qui prouverait que la ligne porte une information
  absente du modèle.

**Verdict : PARTIELLE — deux prédictions sur trois manquées.** Sur 2 533 matchs
cotés 2025 : corrélation(μ modèle, total réalisé) = **0,150** (prédit > 0,25,
raté) ; corrélation(ligne, total réalisé) = **0,146** (prédit 0,08-0,20,
touché) ; corrélation(μ, ligne) = **0,725**.

Régression jointe : μ garde **+0,419 (t = +3,29)**, la ligne garde **+0,517
(t = +2,73)** — donc la ligne apporte bien quelque chose que le modèle n'a pas,
mais faiblement, et le contraire est vrai aussi. R² de la régression jointe :
**0,025**. Le total de points d'un match de badminton est très largement
imprévisible, par le modèle comme par l'opérateur.

Conséquence directe et gênante pour l'interprétation : **le modèle n'est pas
meilleur que la ligne pour prédire le total**. Il ne peut donc pas gagner par
supériorité prédictive. S'il gagne, c'est en exploitant le fait que le **prix**
est plat alors que la ligne, elle, bouge (H5). Le mécanisme du gain n'est pas
« mieux prévoir », c'est « lire l'escalier que l'opérateur ne cote pas ».

Ceci n'explique toujours pas l'excès de confiance de H1 — d'où H10.

---

## H10 — L'excès de confiance vient du périmètre, pas du modèle

*Écrite le 2026-08-28, après H9, avant calcul.*

Le modèle est calibré hors échantillon sur 2022-2024 (H4, pente 0,9975) et
sur-étalé sur 2025 (H1). Deux différences de périmètre peuvent l'expliquer :

1. **les lignes** : la calibration H4 utilisait des lignes candidates aux
   percentiles 20/35/50/65/80 des totaux, donc très étalées, où le pronostic est
   facile ; Betclic ne propose que des barreaux **centraux** ;
2. **les matchs** : Betclic ne cote que ~57 % des matchs, plutôt les affiches,
   où les niveaux sont proches et la longueur moins prévisible.

Test : refaire la calibration Platt hors échantillon sur 2022-2024, (b) à la
seule ligne médiane, (c) sur les seuls matchs couverts par `cotes.csv`
(indicateur de couverture uniquement — aucun prix lu), (d) les deux.

Prédiction chiffrée : au moins une des restrictions ramène la pente `b` **sous
0,85**, et la combinaison (d) la ramène **sous 0,80**.

**Verdict : PARTIELLE, et les deux seuils chiffrés sont manqués de peu.**

| variante | couples | pente `b` |
|---|---|---|
| (a) référence H4 — p20/35/50/65/80, tous les matchs | 65 905 | 0,9975 |
| (b) **ligne médiane seule**, tous les matchs | 13 181 | **0,8522** |
| (c) p20/35/50/65/80, matchs cotés seulement | 36 905 | 1,0010 |
| (d) médiane + matchs cotés | 7 381 | 0,8623 |

La **cause est le régime de ligne**, pas le périmètre de matchs : restreindre
aux matchs cotés ne bouge rien (1,0010), restreindre aux barreaux centraux fait
tomber la pente à 0,852. Prédiction « au moins une sous 0,85 » : ratée de
0,0022. Prédiction « (d) sous 0,80 » : ratée.

**Et ça n'explique qu'une partie du problème.** Pour ramener l'étalement annoncé
sur 2025 (29 points) au réalisé (13,5 points), il faudrait une pente d'environ
0,45. Le régime de ligne en explique 0,85. **Le reste — l'essentiel — n'est pas
expliqué.** C'est porté en clair dans « ce que je ne sais pas ».

**Décision de protocole prise ici, avant le scellé :** la calibration retenue
pour `modele-final.json` est la variante (b) — `a = 0,0007, b = 0,8522` — parce
que c'est celle dont le régime de ligne correspond à ce que Betclic propose.
Elle est estimée sur les seuls résultats 2022-2024, sans aucune cote. Étant
monotone, elle ne change pas l'ordre des paris ; elle change la valeur numérique
du seuil, qui est donc re-choisi sur 2025 après application.

# Scellé — les trois hypothèses du test 2026

Écrites le 2026-08-28 **avant** toute lecture de 2026 au grain stratégie, et
commitées en même temps que `preenregistrement.md`. Le commit fait foi.

## H11 — Le test 2026

La stratégie gelée (over, seuil 0,060, toutes les lignes éligibles, prix
d'ouverture) est rentable sur 2026.

Prédictions chiffrées :
- volume : **450 à 620 paris**, **300 à 400 matchs distincts** (la projection du
  gel donne 529 / 356) ;
- **ROI over entre +2 % et +14 %** — la fourchette est large parce qu'elle
  additionne deux inconnues : le niveau 2026 (que je connais, −0,87 % pour un
  over aveugle) et l'apport de la sélection (+7,8 points nets sur 2025) ;
- **ROI net du placebo entre +3 % et +13 %**, IC 95 % groupé par match
  **excluant zéro** ;
- calibration : le modèle restera **sur-étalé** sur 2026 comme sur 2025 — écart
  du décile 1 supérieur à +5 points, écart du décile 10 inférieur à −2 points.

## H12 — Le tirage à blanc ne gagne rien sur 2026 non plus

Prédiction chiffrée : ROI net du placebo du tirage à blanc 2026 **entre −4 et
+4 %**, IC 95 % contenant zéro ; sur 200 tirages, moyenne **entre −2 et +2 %**.

## H13 — Le miroir rend la marge, pas autre chose

Sur les lignes sélectionnées, `ROI over + ROI under` doit valoir
`−2·marge/(1+marge)`.

Prédiction chiffrée : marge d'ouverture de la sélection 2026 ≈ **12,0 %**, donc
somme des deux jambes **entre −22,5 % et −20,5 %**. Le ROI under des mêmes
lignes doit donc être **négatif**, autour de **−28 %** si l'over sort à +7 %.

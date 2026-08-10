# Banc d'essai du modèle — protocole d'évaluation figé

**Acté le :** 2026-08-04 · **Statut : à construire** (script `measures/mesure-roi-modele.mjs`)

## Pourquoi ce banc d'essai

Le ROI brut est le pire des juges pour améliorer un modèle : sur les 1398 paris de
l'étude ROI (journal §8), son intervalle de confiance fait **±3 points**. Une
amélioration réelle de +1 point y est invisible, et un changement néfaste peut
paraître bon grâce à deux cotes à 9 qui passent. Optimiser là-dessus, c'est
apprendre le bruit.

Décision : toute modification du modèle (facteur âge, calibration 70-80 %, Elo à
marge de points…) passe sur un banc d'essai **fixe** de 4 métriques + 2 garde-fous,
toujours calculées sur le même protocole. Ceci **amende le cap du 2026-08-04**
(« comparer les résultats en ROI toujours ») : l'objectif reste le ROI, mais le
juge d'entraînement devient M1, le ROI ne tranche qu'en comparaison appariée (M3).

## Le protocole (figé une fois pour toutes)

- **Mêmes matchs** pour toutes les variantes : l'intersection prono + cotes.
- **Probas d'avant match** uniquement (walk-forward du backtest, aucune fuite).
- **Graine fixe : 42** pour tout ce qui est bootstrap/échantillonnage.
- Référence = le modèle en production au moment de la comparaison
  (aujourd'hui : elo-recalibré).

## Les métriques

### M0 — Δlog-loss contre le marché (le juge purement mathématique)

Log loss du modèle **moins** log loss des probabilités du marché dé-viggées, sur
les mêmes matchs. C'est le test le plus pur : « mon modèle prédit-il mieux que le
marché ? ». Théorème sous-jacent : battre durablement le marché en log loss
implique qu'une stratégie de mise rentable existe (critère de Kelly). Calculé
globalement **et** sur le sous-ensemble des matchs pariés (là où ça compte).

### M1 — ROI théorique contre la clôture dé-viggée (le juge principal, pour entraîner)

On prend la cote de clôture, on retire la marge du bookmaker (voir dé-vig
ci-dessous) pour obtenir la probabilité du marché, traitée comme meilleure
estimation de la vérité. Chaque pari du modèle est noté sur son espérance :
`proba_marché × cote_prise − 1`. C'est un ROI en centimes par euro **sans aucun
bruit de résultat** : on mesure directement « le modèle achète-t-il des cotes
objectivement bonnes ? ». Stable, monétaire, bouge dès que le modèle s'améliore
vraiment. Note : c'est une métrique statistique déguisée — l'espérance des
sélections mesurée contre la proba du marché ; l'unité en euros est juste plus
parlante que des nats de log loss.

### M2 — CLV moyenne des paris value à l'ouverture (à surveiller)

Déjà mesurée (journal §8.2) : +3,11 % avec un IC de **±1 point** — dix fois plus
précise que le ROI. Répond à « est-ce que je détecte la valeur avant le marché ? ».
Si un changement fait monter la CLV, le modèle voit mieux ; verdict en une saison
au lieu de cinq.

### M3 — ROI réel en comparaison APPARIÉE (le chiffre final, pour décider)

Le ROI mise plate reste le chiffre qu'on veut au bout. Mais pour comparer modèle
A vs modèle B, on ne compare **jamais** leurs deux ROI séparés : on calcule la
**différence de gain match par match sur les mêmes matchs** (les paris identiques
s'annulent, la chance commune s'annule), avec un IC bootstrap sur cette
différence. Beaucoup plus tranchant que deux ROI côte à côte.

### Garde-fous — log loss absolu et calibration (anti-triche)

Un modèle peut « tricher » avec M1/M2 en se contentant de copier le marché. Le
log loss et la calibration (déjà dans le backtest) vérifient qu'il reste un bon
prédicteur par lui-même. M0 complète : si M0 et M1 divergent, creuser avant de
conclure.

## Le dé-vig (retirer la marge du bookmaker)

Les cotes publiées somment à plus de 100 % en probabilités implicites — l'excédent
est la marge. Exemple : cotes 1,60 / 2,30 → 62,5 % + 43,5 % = 106 %.

- **Méthode retenue : multiplicative** — chaque proba implicite divisée par la
  somme (59,0 % / 41,0 % dans l'exemple). Trois lignes de code, standard sur un
  marché à deux issues.
- **En option (test de sensibilité)** : méthode **puissance** et méthode de
  **Shin**, qui corrigent le biais favori-outsider (le book charge plus la marge
  sur l'outsider). Si le classement des variantes dépend du choix de dé-vig,
  c'est louche → creuser.
- On dé-vigge **la clôture** (cote la plus affûtée), pas l'ouverture. C'est notre
  meilleur proxy de la vérité, pas la vérité elle-même.

## Sortie attendue

Un script unique (`measures/mesure-roi-modele.mjs`), une ligne par variante :

| modèle | M0 Δlogloss/marché | M1 EV/clôture | M2 CLV | M3 ΔROI vs réf [IC] | logloss |
|---|---|---|---|---|---|
| elo-recalibré (réf) | … | −4,1 % | +3,11 % | (référence) | … |
| elo + âge | … | −3,2 % ✓ | +3,60 % ✓ | +1,1 pt [−0,4 ; +2,6] | 0,54 ✓ |

*(chiffres de la ligne « elo + âge » fictifs — exemple de format)*

## Règle de décision

**Entraîner sur M1, surveiller M2, décider avec M3 ; M0 comme juge mathématique,
log loss + calibration comme garde-fous anti-copie du marché.**

## S'appuie sur l'existant

- `lib/roi.mjs` : construction des paris (mêmes seuils d'EV).
- Backtest : walk-forward, log loss, calibration.
- `data/books/runs/` : ouvertures et clôtures par opérateur (CLV).
- **À écrire :** le dé-vig et la comparaison appariée (bootstrap sur la
  différence, graine 42).

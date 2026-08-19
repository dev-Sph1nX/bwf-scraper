# Feuille de route — outil de pari

**Dernière mise à jour :** 2026-08-18 (remise à plat)

Cette page ne dit que **ce qui est ouvert**. Tout ce qui a été mesuré — méthode,
chiffres, verdicts, résultats négatifs inclus — vit dans
[`journal-des-mesures.md`](journal-des-mesures.md), qui est le registre. Avant de
proposer un facteur ou un marché, l'y chercher : beaucoup ont déjà été testés et
écartés, preuves à l'appui.

---

## Où on en est, en trois phrases

Le modèle est bon : il prédit à 71,8 %, il bat le classement mondial
(intervalles disjoints, §1.1) et surtout il bat la **cote de clôture** —
CLV +3,11 % prouvée (§8.2). C'est le seul résultat positif du projet, et il
signifie qu'on possède une information que le marché n'a pas.

**Ce qui bloque n'est pas la prédiction, c'est le péage.** Notre avantage vaut
~3 %, la marge des bookmakers 8 % sur le vainqueur et 11 à 29 % sur les marchés
annexes. D'où le verdict de l'étude ROI : suivre les pronos perd de l'argent
(§8, §8.4), et l'exploration des nouveaux marchés a échoué pour la même raison
(§10).

**Conséquence, tirée le 2026-08-18 : on arrête de chercher à gagner de
l'argent avec.** Les deux façons d'agir sur le péage — ajouter des opérateurs
(2,5 points, §10.5) et changer de marché (§10) — ont été mesurées : la première
ne renverse pas l'économie du problème, la seconde est un cul-de-sac. Et aucun
facteur ajouté au modèle ne comble 8 points de marge : le modèle n'a jamais été
le problème.

Ce qui reste vaut pour ce que l'outil montre, pas pour ce qu'il rapporte.

---

## Ouvert — un seul chantier

### Rapport quotidien par e-mail

Un mail par jour : matchs des prochaines 24 h triés par heure, cotes,
écarts modèle/marché. Étude de faisabilité faite le 2026-08-02
([`etude-rapport-email-quotidien.md`](etude-rapport-email-quotidien.md)) :
**~½ journée, 0 €**, API Brevo (300 mails/j gratuits), workflow GitHub Actions
dédié, sans commit ni déploiement. Sa seule dépendance (l'EV affichée) est
faite.

Ce lot ne dépend d'aucun autre et ne suppose aucun edge : il rend l'outil
utile même si on ne parie jamais.

**En attente du propriétaire :** créer le compte Brevo, poser les secrets
`BREVO_API_KEY` et `EMAIL_TO`, choisir l'heure d'envoi (la veille 21 h UTC —
préconisé, cotes ouvertes et rien de commencé — ou 04h30 UTC, plus proche de
la clôture mais les premiers matchs asiatiques peuvent être lancés).

On informe seulement : aucune mise placée automatiquement (CGU Unibet
art. 7.1).

---

## En sommeil, avec la raison

- **Mise (Kelly) et journal de paris.** Sans connexion à la plateforme
  (exclue, CGU art. 7.1), tenir un journal impose une double saisie. Et tant
  qu'aucune stratégie n'est prouvée gagnante, il n'y a rien à y enregistrer.
  À rouvrir le jour où une stratégie l'est — pas avant.
- **Arbitrage multi-bookmakers.** Sa condition (cotes par opérateur nommé et
  simultanées) est remplie depuis le 2026-07-31. Devient réaliste si le
  chantier n°1 aboutit : 5 opérateurs offrent plus de croisements que 3.
  Contraintes réelles à traiter : simultanéité des relevés (2 h d'écart max),
  limites de mise, comptes ouverts partout.
- **Glicko-2** (`p ± incertitude`). Le défaut mesuré est la **sous**-confiance
  (§1.3), pas la surconfiance des inactifs que Glicko corrige. Réécriture du
  cœur du calcul : ne s'engage que sur un bénéfice démontré.
- **Marché du total de points.** Fermé faute de rentabilité, mais c'est le
  seul endroit où le marché se trompe de façon **répétée** : les matchs
  dépassent la ligne de 3 à 4,5 points plus souvent que le prix ne le dit, sur
  les deux saisons mesurées (§10.4). Trop petit pour 11 % de marge. À ressortir
  si le coût d'accès baisse.

---

## Fermé — ne pas rouvrir sans élément nouveau

Chacun a été tranché par une mesure ; le détail est au journal.

| Sujet | Verdict | Réf. |
|---|---|---|
| Backtest, baselines, forme, face-à-face | l'Elo bat le classement mondial ; forme et H2H écartés | §1.1, §1.4, §2 |
| Calibration | corrigée là où c'était démontré (disciplines féminines) | §1.3 |
| Fraîcheur | effet réel mais inexploitable (13 % des matchs, collinéaire) | §2.4 |
| ROI rétrospectif et hors échantillon 2024-2025 | suivre les pronos perd ; « WS+XD exploitables » rejetée, « parier à l'ouverture » confirmée ; dernier tiroir « WS ≥ 80 % » fermé sur 2026 complet | §8, §8.4, §10.11 |
| Âge, main dominante, terrain, Elo à marge de points | signaux parfois réels, tous **non départageables** au banc | §9.3-§9.6 |
| Marché « nombre de sets » + effet gymnase | hypothèse **retournée** : marché plus cher (17-29 %), mieux prédit par le marché que par nous ; l'effet gymnase ne se transporte pas | §10 |
| Catégorie du tournoi | gradient descriptif réel, apport **nul** au banc (déjà capté par le classement) | §10.1 |
| Machine learning (arbres boostés, et par extension NN) | GBM toutes features au banc : non départageable en M3, **pire** en M1 et aux garde-fous — ni facteur, ni somme, ni interaction | §10.10 |
| Betclic en CI | refus par IP à l'edge CloudFront, aucun correctif côté code — on tourne à 2 opérateurs sur 3 | `verif-cotes-sets.md` §6b |
| Ajouter bwin.fr et netbet.fr | 2,5 points de péage mesurés (§10.5), mais ça n'inverse pas l'économie du problème — **écarté par le propriétaire le 2026-08-18** | §10.5 |
| Les abandons (`Retired`) | jamais mesuré, et abandonné : aucun facteur isolé ne comble 8 points de marge — **écarté par le propriétaire le 2026-08-18** | — |
| oddsportal, style de jeu, météo | source retirée / données absentes / signal marginal déjà capté par le lieu | — |

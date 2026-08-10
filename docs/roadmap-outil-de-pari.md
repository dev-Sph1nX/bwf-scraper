# Feuille de route — outil de pari

**Dernière mise à jour :** 2026-08-10

Ce document est la liste ordonnée des chantiers. Les dépendances sont **strictes** :
chaque lot exige le précédent, et l'ordre n'est pas un choix de confort.

> **Tout ce qui a été mesuré est consigné dans [`journal-des-mesures.md`](journal-des-mesures.md)**,
> avec les chiffres, la méthode et le moyen de refaire chaque mesure — résultats
> négatifs inclus. À lire avant de proposer un facteur : plusieurs ont déjà été
> testés et écartés, preuves à l'appui.

## Les 5 couches

Toute idée entrante se range dans l'une de ces couches. Les confondre est la
principale source de désordre.

| # | Couche | Ce qu'elle produit | État |
|---|---|---|---|
| 1 | **Modèle** | `p`, la probabilité de victoire | ✅ mesuré, il bat le classement mondial (§1.1) |
| 2 | **Calibration** | *est-ce que `p` est juste ?* | ✅ corrigée là où c'était démontré (§1.3) |
| 3 | **Détection** | `p` comparé au marché | ✅ EV affichée par match/opérateur sur l'Accueil (refonte du 2026-07-31) |
| 4 | **Mise** | combien miser | à faire, après la couche 3 (lot B) |
| 5 | **Journal** | *est-ce que je gagne ?* | à faire ; la CLV s'accumule déjà toute seule |

Les couches 2 et 5 ne mesurent pas la même chose : la 2 juge le **modèle** (mes
70 % se réalisent-ils 70 % du temps ?), la 5 juge le **parieur** (timing,
sélection, exécution). La CLV appartient à la couche 5 et ne dit rien de la
qualité du modèle. Deux écrans distincts, jamais fusionnés.

---

# ✅ Fait — ne pas rouvrir, tout est au journal

| Chantier | Verdict | Référence |
|---|---|---|
| **Historique du classement mondial** | 135 publications archivées (fenêtre API : 60 semaines glissantes → `data/rankings/` est la seule archive, commit non négociable) | prérequis |
| **Backtest, baselines, signaux** (ex-lot 1) | l'Elo bat le classement mondial (71,8 % vs 68,7 %, intervalles disjoints) ; forme et face-à-face écartés par la mesure ; réglage des paramètres sans gain | journal §1.1, §1.4, §2 |
| **Calibration** | sous-confiance corrigée sur les disciplines féminines seulement (erreur 2,98 → 1,20 pt) — le verrou de sécurité de Kelly est levé | §1.3 |
| **Fraîcheur** (ex-lot 2) | effet réel mais inexploitable (13 % des matchs, collinéaire avec « sort d'un 3 sets ») — fermé sans code | §2.4 |
| **Historisation des cotes** (ex-lot 6) | fait et dépassé : relevés append-only **par opérateur nommé** (Betclic/Unibet/Winamax), cron toutes les 2 h, **prématch seulement**, jointure inter-opérateurs exacte (id Sportradar) | `data/books/runs/` |
| **Dates de naissance + main dominante** | collectées (97,7 % des apparitions ; 675 mains) — mesurées le 2026-08-10 : âge §9.3 et gaucher §9.6, non départageables au banc | `data/players/` |
| Mesures ponctuelles | gymnases→3 sets (réel, persistant r = 0,42) ; terrain (+2,2 pt, simple seulement) ; écart de points (étape 1 : 58,4 %) ; Elo-bis à marge de points (non départageable sur 2026, code conservé désactivé) | §7, §2.6, §2.7, §2.8 |
| **ROI rétrospectif (ex-étude n° 0 du lot C)** | fait le 2026-08-04, en avance grâce au backfill Flashscore (1398 matchs 2026 au lieu d'attendre ~200 paris) : `lib/roi.mjs` + page /rentabilite. **Verdict : favori −8,2 % (perte prouvée ≈ marge bookmaker), value EV>0 −7,3 % (non départagé)**. Poches les moins mauvaises : WS (−2,5 %, et +1,3 % à confiance ≥ 80 %), tranche 90-100 % (−1,1 %), EV > 0,20 (~0 %) ; multi-comptes = +3 pts vs mono-bookmaker | §8, §8.1 |
| **EV sur les écrans** (ex-lot A) | absorbée par la refonte UX : `EV = cote × p − 1` (p calibrée) calculée par camp et par opérateur, affichée sur la carte de match (Accueil) pour la meilleure cote ; renommage du tag `value` → « sous-coté BWF » complet côté UI | refonte du 2026-07-31, `docs/superpowers/specs/2026-07-31-refonte-ux-design.md` |
| **Backfill cotes 2024-2025 + test hors échantillon** | fait le 2026-08-05 : 62/62 tournois joués, 8 130 matchs cotés, jointure 99 %, ROI sur 6 297 matchs. **Verdict §8.4 : « WS+XD exploitables » rejetée (WS ≥80 % : −4,4 % ; XD value : −22,1 %) ; « parier à l'ouverture » confirmée (+2,0/+2,8 pts, appariée, IC hors de 0) ; value prouvée perdante (−14,5 %)** → retour au chantier modèle (n° 0) | §8.4, [`bilan-backfill-cotes-2024-2025.md`](bilan-backfill-cotes-2024-2025.md) |

---

# Lot B — Mise (Kelly fractionné) et journal de paris ⭐ prochain

**Couches 4 et 5. Après l'EV affichée (ex-lot A, fait) — sans elle, rien à enregistrer.**

Tiroir de mise sur la fiche d'un match (bankroll, fraction de Kelly, mise
calculée, enregistrement en un geste), puis le journal : chaque pari **figé au
moment où il est pris** (date du pari, opérateur, cote obtenue, proba estimée à
cet instant, mise), complété par le résultat. Métriques : ROI, hit rate,
drawdown max, profit factor, et **CLV** (cote obtenue vs cote de clôture — le
relevé 2 h collecte les clôtures depuis le 2026-07-31).

**Décision en attente (propriétaire) :** stockage des paris — l'app est
statique sans backend. Recommandation : `localStorage` + export JSON
committable dans `data/`. Alternative : fichier versionné, au prix d'un commit
par pari.

# Lot C — Mesures en file d'attente (méthode des 3 étapes, une par une)

> **⭐ Cap affiché du propriétaire (2026-08-04, après le verdict de l'étude ROI) :**
> « Améliorer le modèle là où il saigne. La méthode de travail sera de comparer
> les résultats en ROI toujours — notre recherche doit se concentrer là-dessus,
> c'est l'objectif final de l'outil. Trouver d'autres facteurs, ajuster les
> poids, etc. »
>
> Conséquence méthodologique (amendée le 2026-08-04) : le ROI brut est trop
> bruité pour juger seul (IC ±3 pts sur 1398 paris) — **toute modification du
> modèle passe désormais sur le banc d'essai figé
> [`banc-essai-modele.md`](banc-essai-modele.md)** (M0 Δlog-loss vs marché,
> M1 EV vs clôture dé-viggée, M2 CLV, M3 ΔROI apparié, garde-fous log
> loss/calibration). Règle : entraîner sur M1, surveiller M2, décider avec M3.
> Le script `measures/mesure-roi-modele.mjs` est **écrit et validé**
> (2026-08-10, journal §9 — non-régression exacte sur §8/§8.2, elo-brut
> correctement départagé à −3,5 pts de ROI apparié). Le prérequis
> transverse est **fait** (2026-08-05) : cotes Flashscore 2024-2025
> backfillées, étude ROI sur 6 297 matchs (×4,5) — et le hors-échantillon a
> rendu son verdict (§8.4) : hypothèse « WS+XD exploitables » rejetée,
> « parier à l'ouverture » confirmée (+2 à +2,8 pts, appariée).

Par valeur attendue décroissante :

0. **Là où le modèle saigne** ⭐ (2026-08-04) — **étape calibration FAITE le
   2026-08-10** (`measures/mesure-calibration-tranches.mjs`, journal §9.1-§9.2) :
   la suspicion « un 75 % annoncé vaudrait ~68-70 % » est **rejetée** (70-80 % :
   74,8 % annoncé → 75,0 % observé, bien calibrée partout) — le saignement de
   cette tranche est un problème de **prix** (marge chargée sur l'outsider),
   pas de modèle ; ne pas avoir corrigé MS/XD était justifié ; le correctif
   walk-forward 5 disciplines passé au banc d'essai est **neutre** (M3 +0,4 pt
   [−0,7 ; +1,6]) → production inchangée. **L'âge : MESURÉ le 2026-08-10**
   (journal §9.3, `measures/variante-age.mjs`) : signal réel prouvé au-delà de
   l'Elo (les jeunes sont sous-cotés, b = −0,027/an [−0,036 ; −0,018], simple
   seulement), mais la variante `elo-age` au banc est **non départageable**
   (M3 +0,9 pt [−0,6 ; +2,4] contient 0, tous les garde-fous s'améliorent
   pourtant) → production inchangée, candidat à re-juger avec plus d'années.
   **L'Elo-bis à marge de points : TRANCHÉ le 2026-08-10** (journal §9.5,
   `measures/variante-elo-points.mjs`) : au juge financier sur 6 286 matchs,
   ni le brut (M3 −0,1 pt) ni le recalibré (M3 +2,2 pt [−1,1 ; +5,5], M1
   contradictoire) ne sortent du bruit → **non adopté, rayé des espoirs
   actifs** (ne rouvrir que pour un signal repensé, ex. marge par set).
   Reste : le réajustement des poids. Chaque étape passe
   sur le banc d'essai (M1 pour entraîner, M3 pour décider).
1. **Marché « nombre de sets » + effet gymnase** ⭐ (inscrit par le propriétaire
   le 2026-08-04) — débouché direct de la mesure gymnases (§7 : effet réel à
   +6,1 σ, persistant r = 0,42). Relever ce marché chez les 3 opérateurs et
   vérifier si le prix intègre l'effet lieu (Sydney vs Séoul) : l'écart éventuel
   est la valeur exploitable. C'est une **nouvelle famille de paris**, pas une
   amélioration du modèle vainqueur — potentiellement notre edge le plus
   crédible, car le marché « vainqueur » est le plus efficace (§8).
   **Préalable : FAIT rétrospectivement le 2026-08-10**
   ([`verif-cotes-sets.md`](verif-cotes-sets.md)) sur les 50 relevés du Korea
   Masters : le marché des sets n'était demandé nulle part (les API de liste ne
   servent que le vainqueur) → **extension livrée** (champ optionnel `sets` lu
   sur les pages match, rétro-compatible, parsing validé sur le tennis).
   Restent : valider les libellés badminton au prochain tournoi (check-list
   dans le doc) et surtout régler les trous de capture découverts au passage —
   **Betclic 403 sur 100 % des relevés GitHub Actions pendant le tournoi**
   (IP datacenter bloquée ; passe en local) et Winamax à 0 ligne : décision
   propriétaire (réessais/en-têtes vs relevé hors datacenter).
2. **Main dominante (gaucher)** — rouvert : la donnée existe pour 620 joueurs
   (Wikidata), et l'API BWF la sert directement (découverte du propriétaire) :
   `GET https://extranet-lv.bwfbadminton.com/api/vue-player-bio?activeTab=1&playerId=<id>`
   avec en-têtes `origin: https://bwfbadminton.com` + `referer: https://bwfbadminton.com/`
   → `{"hand": "R"|"L", "height": …, "age": …}`. Jointure par id exacte —
   **collecte TERMINÉE le 2026-08-10** (1 535/1 538 fiches lues) :
   `data/players/birthdates.json` porte désormais **675 mains (72,9 % pondéré
   par apparitions)** — l'API BWF ne renseigne pas la main de tout le monde —
   et, bonus, la **taille de 403 joueurs** (48,1 % pondéré, futur facteur
   possible). **MESURE FAITE le 2026-08-10** (journal §9.6,
   `measures/variante-hand.mjs`) : signal descriptif léger au-delà de l'Elo
   (b = +0,12 par gaucher d'écart, IC [+0,01 ; +0,21]) mais instable (négatif
   en 2026) et porté par des cases rares ; au banc, la variante `elo-hand`
   (marche avant) n'agit que sur WD 2026 (54 matchs jugés) et fait
   **M3 −0,1 pt [−0,6 ; +0,4] : non départageable, on n'adopte pas** →
   variante conservée désactivée, l'essentiel de l'avantage du gaucher est
   déjà dans l'Elo.
3. **Avantage du terrain, étapes 2-3 — FAIT le 2026-08-10** (journal §9.4,
   `measures/variante-terrain.mjs`) : l'apport marginal est réel (bonus
   ≈ +30 pts d'Elo en simple, IC excluant 0 de justesse) mais le hors-échantillon
   au banc est **non départageable** (M3 +0,2 pt [−0,2 ; +0,5] — le facteur ne
   touche que 7 % des matchs jugés, indétectable à cet échantillon) → variante
   conservée désactivée, à re-mesurer quand 2026 sera plus fourni.
4. **Les abandons** (`Retired` au tour précédent) et **la catégorie du
   tournoi** — données présentes, jamais testées.
   (L'Elo-bis à marge de points, ex-n° 5, est absorbé par le chantier n° 0.)

# Lot D — Rouverts sous conditions

- **Arbitrage multi-bookmakers.** Sa condition de réouverture (« cotes par
  opérateur nommé et simultanées ») est **remplie** depuis le 2026-07-31. À
  n'aborder qu'après le lot B, et avec les vraies contraintes : simultanéité
  des relevés (2 h d'écart max), limites de mise, comptes chez les 3 opérateurs.
- **Glicko-2** (`p ± incertitude`). Repoussé, et le lot 1 a affaibli sa
  motivation : le défaut mesuré est la **sous**-confiance (§1.3), pas la
  surconfiance des inactifs que Glicko corrige. Reste pertinent pour afficher
  un intervalle et pour la volatilité (joueurs stables/instables). Réécriture
  du cœur du calcul : ne s'engage que sur un bénéfice démontré.

# Lot E — Rapport quotidien par e-mail (indépendant, s'intercale quand on veut)

**Étude de faisabilité faite le 2026-08-02 : [`etude-rapport-email-quotidien.md`](etude-rapport-email-quotidien.md).
Verdict : ~½ journée, 0 €.** Seule dépendance : la couche 3 (EV affichée) — déjà
faite. Aucun lien avec les lots B-D : ce lot peut se glisser avant ou après.

Un e-mail par jour avec les matchs des prochaines 24 h et les cotes
intéressantes (EV positives, sous-cotés BWF, programme trié par heure), composé
depuis `upcoming-matches.json` et envoyé depuis un workflow GitHub Actions
dédié (relevé de cotes frais, sans commit ni déploiement). Reco de l'étude :
API **Brevo** (300 mails/j gratuits, `fetch` natif, zéro dépendance), secrets
`BREVO_API_KEY` + `EMAIL_TO`.

**Décisions en attente (propriétaire) :**
- créer le compte Brevo et poser les 2 secrets GitHub ;
- heure d'envoi : la veille 21h UTC (préconisé — cotes ouvertes, rien de
  commencé) ou le matin 04h30 UTC (cotes plus proches de la clôture, mais les
  premiers matchs asiatiques peuvent être lancés).

On informe seulement : aucune mise placée automatiquement (décision existante,
CGU Unibet art. 7.1).

---

# ❌ Écarté définitivement

- **oddsportal** (retiré le 2026-07-31). Cote agrégée anonyme, scrape DOM
  fragile, jamais branché au cron : remplacé par les bookmakers FR. Archive
  conservée dans `data/odds/runs/`, briques partagées conservées dans `lib/`.
  À rouvrir seulement si un besoin « consensus du marché » émerge.
- **Style de jeu.** `lastPointWinner` et `serve` sont toujours `null` : pas de
  point par point.
- **Météo et conditions d'air.** Géocodage + API externe pour un signal jugé
  marginal — et la mesure gymnases (§7) capte déjà l'effet *lieu* sans exiger
  d'en connaître le mécanisme.

Ces points sortent de la feuille de route. À ne rouvrir que si une nouvelle
source de données apparaît.

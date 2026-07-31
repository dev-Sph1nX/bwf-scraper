# Feuille de route — outil de pari

**Dernière mise à jour :** 2026-07-31

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
| **Dates de naissance + main dominante** | collectées (97,7 % des apparitions ; 620 mains) — la MESURE du facteur âge reste à faire | `data/players/` |
| Mesures ponctuelles | gymnases→3 sets (réel, persistant r = 0,42) ; terrain (+2,2 pt, simple seulement) ; écart de points (étape 1 : 58,4 %) ; Elo-bis à marge de points (non départageable sur 2026, code conservé désactivé) | §7, §2.6, §2.7, §2.8 |
| **EV sur les écrans** (ex-lot A) | absorbée par la refonte UX : `EV = cote × p − 1` (p calibrée) calculée par camp et par opérateur, affichée sur la carte de match (Accueil) pour la meilleure cote ; renommage du tag `value` → « sous-coté BWF » complet côté UI | refonte du 2026-07-31, `docs/superpowers/specs/2026-07-31-refonte-ux-design.md` |

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

Par valeur attendue décroissante :

1. **L'âge** ⭐ — données prêtes (97,7 % pondéré), orthogonal au niveau, agit
   sur tous les matchs. Écrire `measures/mesure-age.mjs` : courbe âge →
   performance à niveau contrôlé, puis apport marginal.
2. **Marché « nombre de sets »** — débouché direct de la mesure gymnases (§7) :
   relever ce marché chez les 3 opérateurs et vérifier si le prix intègre
   l'effet lieu (Sydney vs Séoul). C'est une **nouvelle famille de paris**, pas
   une amélioration du modèle vainqueur.
3. **Main dominante (gaucher)** — rouvert : la donnée existe pour 620 joueurs
   (Wikidata), et l'API BWF la sert directement (découverte du propriétaire) :
   `GET https://extranet-lv.bwfbadminton.com/api/vue-player-bio?activeTab=1&playerId=<id>`
   avec en-têtes `origin: https://bwfbadminton.com` + `referer: https://bwfbadminton.com/`
   → `{"hand": "R"|"L", "height": …, "age": …}`. Jointure par id exacte —
   collecte du reste du panel en cours (2026-07-31).
4. **Avantage du terrain, étapes 2-3** — l'isolation est passée (§2.6), reste
   l'apport marginal et le hors-échantillon. Ne touche que 12 % des matchs :
   espérance modeste.
5. **Elo-bis à marge de points** — re-mesurer quand 2026 sera plus fourni
   (`node measures/mesure-elo-points.mjs`) ; adopter si l'IC exclut 0 (§2.8).
6. **Les abandons** (`Retired` au tour précédent) et **la catégorie du
   tournoi** — données présentes, jamais testées.

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

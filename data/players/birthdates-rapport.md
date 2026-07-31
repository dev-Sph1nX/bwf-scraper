# Dates de naissance des joueurs BWF — rapport

Généré le 2026-07-31.

## Couverture

| Mesure | Valeur |
|---|---|
| Joueurs dans les données (draws 2024-2026, dédupliqués par id) | 1935 |
| Joueurs avec date de naissance | 1432 (74.0 %) |
| **Couverture pondérée par apparitions en match** | **42846/43876 (97.7 %)** |
| Main dominante connue | 620 joueurs |
| Cas ambigus non résolus | 0 |

La couverture pondérée est la métrique utile pour l'Elo : un joueur à 200 matchs pèse
100 fois plus qu'un joueur à 2 matchs dans les paires de matchs à prédire.

## Sources

| Source | Joueurs |
|---|---|
| Wikidata | 1274 |
| API BWF (extranet-lv.bwfbadminton.com) | 158 |

Confiance : 1432 `exact`, 0 `probable`.

## Méthode

1. **Extraction** : parcours de `data/<année>/<tournoi>/draw-*.json` (668 fichiers,
   14 114 matchs), déduplication par `id`, tri par nombre d'apparitions.
2. **Wikidata en masse** : une requête SPARQL (P106 = joueur de badminton, P569 date de
   naissance ≥ 1970, P27 nationalité → code CIO P984, P552 main dominante, P3620 ID BWF).
   1276 joueurs appariés :
   - **1214 par ID BWF (P3620)** : jointure directe sur l'identifiant
     numérique de nos données → `exact`, aucun risque d'homonyme.
   - 62 par nom normalisé (accents, casse, ordre des mots trié) + pays
     (table BWF→CIO : ENG/SCO/WAL→GBR, AIN→RUS/BLR, HKG/MAC→+CHN…).
3. **Vérification des appariements par nom** via l'API BWF (`vue-player-summary`,
   jointure par ID donc certaine) : 60 confirmés (promus `exact`),
   2 contredits (la date BWF remplace celle de Wikidata),
   0 non vérifiables (restent `probable`).
4. **Homonymes Wikidata** (même nom + même pays, ou tri de tokens identique type
   « KIM Min Seung » vs « Kim Seung-min ») : jamais forcés. 6 tranchés par l'API BWF,
   0 restent dans `ambiguous.json`.
5. **Non-appariés** : les 150 plus actifs interrogés sur l'API BWF
   (`vue-player-summary` pour la date, `vue-player-bio` pour la main), via le
   `BwfClient` Playwright du projet (franchissement Cloudflare, même contexte
   navigateur, ~1,5 s entre appels). 150 dates récupérées.

## Limites

- **Main dominante** : couverte surtout via Wikidata (P552) ; `vue-player-bio` la
  renvoie presque toujours `null`. 620/1432 joueurs seulement.
- **Joueurs restants sans date** (503, 2.3 % des apparitions) : quasi tous
  peu actifs (492 ont ≤ 4 matchs). Les 10 plus actifs :
  - Julie FRANCONVILLE (SUI, 5 matchs, id 76311)
  - Jayden LIM (AUS, 5 matchs, id 68039)
  - Sunisa LEKJURA (THA, 5 matchs, id 60686)
  - Sirapat TEPNARONG (THA, 5 matchs, id 74374)
  - Emma GOYETTE (CAN, 5 matchs, id 16825)
  - Clarence CHAU (CAN, 5 matchs, id 61088)
  - Riduvarshini RAMASAMY (IND, 5 matchs, id 56548)
  - CHO Hyeon Woo (KOR, 5 matchs, id 86283)
  - CHOI Ji Hun (KOR, 5 matchs, id 73779)
  - KIM Min Gun (KOR, 5 matchs, id 91485)
  Ils sont tous récupérables par la même API BWF si besoin (script `scrape-bwf-api.mjs`,
  reprise incrémentale — il suffit d'augmenter la limite).
- Wikidata peut contenir des erreurs ; 2 conflit(s) Wikidata/BWF détecté(s)
  sur l'échantillon vérifié (~68 joueurs), résolus en faveur de la fiche BWF.
- Dates à précision année/mois sur Wikidata : exclues du livrable (jamais de fausse
  précision) ; les joueurs concernés ont été re-tentés via l'API BWF.

## Fichiers

- `players-birthdates.json` — { id: { name, country, dob, hand, source, confidence } }
- `ambiguous.json` — cas douteux avec candidats et raison
- `players.json` — liste extraite (id, nom, pays, slug, nb matchs)
- Scripts : `extract-players.mjs`, `fetch-wikidata.mjs`, `match.mjs`,
  `scrape-bwf-api.mjs`, `verify-probables.mjs`, `finalize.mjs`

# Bilan — backfill des cotes 2024-2025 et test hors échantillon

**Date :** 2026-08-05 · **Demande :** récupérer les cotes Flashscore jusqu'au
premier match de la base (Malaysia Open, 09/01/2024), relancer `build-data` et
re-runner l'étude ROI. Les chiffres détaillés sont consignés au
[journal §8.4](journal-des-mesures.md) ; ce document présente l'ensemble.

## 1. Ce qui a été vérifié puis récolté

**La question de départ : Flashscore stocke-t-il ses cotes aussi loin ? Oui.**
L'endpoint GraphQL sert encore ouverture ET clôture pour janvier 2024 (et les
archives remontent à 2018). Betclic et Unibet sont présents quasi partout ;
Winamax est rare avant 2026 ; bwin/NetBet existent mais restent hors périmètre.

| | Volume |
|---|---|
| Tournois couverts | **62/62 tournois joués 2024-2025** (manquent : 2 annulés + les JO, exclus de la base) |
| Matchs avec cotes (tous fichiers, 2024→2026) | **8 130** (~1 540 avant) |
| Jointure aux matchs BWF | **7 982 joints / 8 064 (99 %), 0 ambigu** |
| Matchs prono + cotes pour l'étude ROI | **6 297** (1 398 avant, ×4,5) |

Trois obstacles réglés en route (détail dans l'en-tête de
`tools/flashscore/backfill-odds.mjs`, nouveau mode `--seasons` / `--from/--to/--suffix` / `--cats`) :

1. les pages d'archives tronquent le feed que lisait le script → lecture en
   union des deux feeds embarqués ;
2. 9 tournois d'automne 2025 (Hylo, France, Danemark…) n'ont pas de lien
   d'archive : leur édition 2025 est encore la page « courante » de la ligue →
   seconde passe fenêtrée par dates ;
3. les Mondiaux 2025 ne sont pas une ligue `bwf-world-tour-*` → option `--cats=`.

À noter : le « Masters de Chine » de Flashscore n'a de cotes chez aucun
bookmaker (0/170 en 2024, 0/171 en 2025, déjà 0 en 2026) — le vrai China
Masters avec cotes est la ligue `china-masters-3` (155/155 en 2025).

## 2. Le verdict global — l'échantillon ×4,5 fait trancher les IC

ROI mise plate à 1 €, par année (IC ≈ 95 %) :

| Année | Favori (clôture) | Favori (ouverture) | Value EV>0 (clôture) | Value EV>0 (ouverture) |
|---|---|---|---|---|
| 2024 | −12,7 % [−15,4 ; −10,0] | −11,0 % | −23,4 % [−31,8 ; −15,0] | −14,8 % |
| 2025 | −8,1 % [−10,5 ; −5,8] | −5,9 % | −12,2 % [−20,2 ; −4,1] | −9,9 % |
| 2026 | −8,2 % [−11,5 ; −4,9] | −6,9 % | −7,3 % [−17,8 ; **+3,1**] | −8,8 % |
| **Total** | **−9,6 % [−11,2 ; −8,1]** | −7,8 % | **−14,5 % [−19,2 ; −10,0]** | −11,2 % |

Deux lectures :

- **La stratégie « value » est désormais PROUVÉE perdante.** Sur 2026 seul, son
  IC contenait encore 0 (« non départagé ») ; sur 3 094 paris, il est
  franchement négatif. Elle fait *pire* que suivre le favori : nos écarts au
  marché sont plus souvent des erreurs de notre modèle que des erreurs du
  marché.
- **2024 est uniformément pire** (−12,7 % vs −8 % ensuite), S1 comme S2 — donc
  pas un simple démarrage à froid de l'Elo sur les premiers mois ; l'Elo de
  toute l'année 2024 travaille avec peu d'historique. Les mesures fines
  gagneront à pondérer ou écarter 2024-S1.

## 3. Les deux hypothèses gelées (journal §8.3) — verdict hors échantillon

Gelées le 2026-08-04 AVANT de voir les données 2024-2025, testées sur 2024-2025
uniquement :

### ❌ H1 « WS et XD sont exploitables » — rejetée des deux côtés

| Poche gelée | 2026 (in-sample) | 2024-2025 (hors échantillon) |
|---|---|---|
| WS favori | −2,5 % | −6,0 % [−9,2 ; −2,7] (n=1092) |
| WS favori, confiance ≥ 80 % | **+1,3 %** | **−4,4 % [−8,4 ; −0,4]** (n=264) |
| XD value | colonne d'EV toute verte | **−22,1 % [−35,9 ; −8,3]** (n=480) |
| XD value, EV ≥ 0,20 | ~0 % | −22,9 % [−43,4 ; −2,3] (n=275) |

Le « +1,3 % à confiance ≥ 80 % » ne se reproduit pas, et la case XD était bien
ce qu'on soupçonnait : deux cotes à 9 qui passent. C'est exactement le biais de
sélection que le gel des hypothèses devait attraper — il l'a attrapé.

### ✅ H2 « parier à l'ouverture plutôt qu'à la clôture » — confirmée

Comparaison **appariée** match par match (la même stratégie exécutée aux deux
instants, la chance commune s'annule), sur 2024-2025 :

- favori : ouverture meilleure de **+2,0 pts [+1,7 ; +2,2]** (n=4 888)
- value : ouverture meilleure de **+2,8 pts [+1,4 ; +4,3]** (n=2 087)

Les IC sont franchement hors de 0 : quand on parie, il faut parier tôt. Nuance
importante : l'ouverture rend les stratégies *moins perdantes*, pas gagnantes —
et l'avantage semble s'éroder (écart ouverture→clôture value : +5,8 % en 2024,
+2,8 % en 2025, +0,4 % en 2026).

## 4. Conséquences

1. **Aucune poche exploitable en l'état** → retour au chantier modèle
   (feuille de route, lot C n° 0 : calibration de la tranche 70-80 %, facteur
   âge, Elo à marge de points), exactement le scénario prévu par le §8.3 en cas
   de rejet.
2. **Le banc d'essai figé** ([banc-essai-modele.md](banc-essai-modele.md))
   dispose maintenant de l'échantillon qui rend ses juges tranchants : M1/M3
   sur 6 297 matchs au lieu de 1 398 (~×2 sur la précision des IC).
3. **La seule brique validée reste le timing** : détecter tôt (CLV positive,
   §8.2) et parier à l'ouverture (H2). C'est une propriété du *marché*, pas de
   notre modèle — elle vaudra pour toute stratégie future.
4. Données à committer : `data/flashscore/odds/*.json` (+ index), nécessaires
   au prochain build CI.

## Refaire / vérifier

```bash
node tools/flashscore/backfill-odds.mjs --seasons=2024,2025 --skip-existing   # archives
npm run build-data          # jointure + roi.json (web/public/data/roi.json)
node backtest.mjs --quiet
# verdicts hors échantillon : filtrer web/public/data/roi.json `bets[]` sur
# matchTime < 2026, champs {disc, strategy, instant, prob, ev, gain}
```

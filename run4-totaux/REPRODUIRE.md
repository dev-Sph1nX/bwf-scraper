# Reproduire run4-totaux

Python **3.9+, stdlib pure** — ni pandas, ni numpy, ni sklearn. Graine **42**
partout. Durées mesurées sur un MacBook (Darwin 25.5, Python 3.9.6).

Tous les scripts se lancent **depuis la racine du dépôt** et écrivent dans
`run4-totaux/out/`. Aucun n'écrit ailleurs, sauf `gel.py` qui produit
`run4-totaux/modele-final.json`.

## 0. L'export

```bash
npm run export                      # node tools/export-dataset.mjs   ~25 s
```

Écrit `export/{matches,players,cotes,cotes-totaux}.csv` + `export/README.md`.
**Ne lancer aucun scraping** (`npm run update`, `refresh`, `scrape-books`) :
tout part de `data/` tel qu'il est.

Version utilisée ici : export du **2026-08-28**, `matches.csv` 22 038,
`cotes.csv` 22 844, `cotes-totaux.csv` 6 843, `players.csv` 2 372.

## 1. Partie A — diagnostic

```bash
python3 run4-totaux/code/partie-a.py           # ~12 s  -> out/partie-a.md
```

Déterministe et sans modèle. C'est la table à comparer avec le jumeau.

## 2. Partie B — dans l'ordre

```bash
python3 run4-totaux/code/valid-2025.py         # ~1 s   H1 H2 H3
python3 run4-totaux/code/calib-2025.py         # ~11 s  H4 H5 H6
python3 run4-totaux/code/h7-h8.py              # ~5 s   H7 H8
python3 run4-totaux/code/h9.py                 # ~1 s   H9
python3 run4-totaux/code/h10.py                # ~9 s   H10
python3 run4-totaux/code/gel.py                # ~9 s   -> modele-final.json
```

`gel.py` fige le modèle, la calibration et le seuil. **À ce point le protocole
exige un commit** — c'est `5ba007b` :

```bash
git show 5ba007b --stat        # preenregistrement.md + modele-final.json + H11-H13
```

Puis, et seulement puis, l'ouverture du scellé :

```bash
python3 run4-totaux/code/test-2026.py          # ~4 s   H11 H12 H13
python3 run4-totaux/code/h14-h15.py            # ~5 s   H14 H15 (diagnostics)
python3 run4-totaux/code/h16.py                # ~4 s   H16 (contrôle corrigé)
```

`test-2026.py` **charge** `modele-final.json` et ne réestime rien : on peut le
relancer autant de fois qu'on veut, il rendra les mêmes chiffres.

## 3. Partie C — descriptif

```bash
python3 run4-totaux/code/partie-c.py           # ~2 s   -> out/partie-c.md
```

Lit `data/books/runs/*.json` (344 fichiers) en lecture seule.

## 4. Tout d'un coup

```bash
npm run export && for s in partie-a valid-2025 calib-2025 h7-h8 h9 h10 gel \
                          test-2026 h14-h15 h16 partie-c; do
  echo "=== $s"; python3 "run4-totaux/code/$s.py" > /dev/null || exit 1
done
```

Environ **1 min 25 s** au total, export compris.

## Les modules

| fichier | rôle |
|---|---|
| `code/common.py` | lecture CSV, dé-vig proportionnel, ROI, percentiles, **bootstrap groupé par match** (graine 42, 2 000 tirages) |
| `code/moteur.py` | Elo causal par discipline (paramètres de `lib/elo.mjs`), moyennes glissantes causales, vecteur de features |
| `code/modele.py` | le modèle de points : P3 logistique, μ₂/μ₃ moindres carrés, survie empirique des résidus. Algèbre linéaire à la main (pivot partiel, IRLS) |
| `code/strategie.py` | seaux de ligne relative, placebos par cellule, ROI net, tirage à blanc (version d'origine **et** version stricte de H16) |

## Points de vigilance pour qui rejoue

- **`misable = true` partout.** Sur `cotes-totaux.csv` c'est sans effet (les
  6 843 lignes sont toutes misables), mais la règle est appliquée quand même.
- **Bootstrap groupé par match, jamais par ligne.** 6 843 lignes ne font que
  3 858 observations ; un bootstrap par ligne divise les IC par ~1,3 et fait
  conclure n'importe quoi.
- **Le placebo se calcule sur la période évaluée**, jamais emprunté à une autre.
  C'est ce qui fait passer le résultat 2026 de « prometteur » à « nul » : le
  placebo de la sélection vaut −3,64 % en 2025 et +1,11 % en 2026.
- **Le tirage à blanc doit respecter le profil de lignes-par-match**, pas
  seulement le profil de cellules (leçon de H14 : +11,5 points de ROI over
  d'écart entre un match à 3 barreaux et un match à 1 barreau, sur 2026).
  Utiliser `tirage_a_blanc_strict`, pas `tirage_a_blanc`.
- **Le modèle ne doit jamais voir une cote.** `modele.py` et `moteur.py` ne lisent
  que `matches.csv` ; la seule exception est `h10.py`, qui lit la **liste des
  match_id couverts** de `cotes.csv` (pas les prix) pour un diagnostic de
  périmètre, et qui ne sert pas à l'entraînement.

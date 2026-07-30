# Cotes oddsportal — scrape, matching et page de vérification

**Date :** 2026-07-29
**Statut :** design validé, à implémenter

## Objectif

Récupérer les cotes de match du circuit BWF sur oddsportal.com et les apparier aux
matchs à venir déjà connus côté BWF, afin de pouvoir **vérifier la qualité de
l'appariement** dans une page dédiée de l'app.

C'est une **étape 1 exploratoire**. L'intégration des cotes au reste de
l'application (cartes de match, calcul de value, tri « À surveiller ») fera l'objet
d'une spec distincte.

## Périmètre

### Dans le périmètre

- Scrape de la page liste quotidienne `oddsportal.com/matches/badminton/YYYYMMDD/`
  pour **aujourd'hui + 4 jours** (5 dates).
- Extraction des **2 cotes** par match (colonnes « 1 » et « 2 » = meilleure cote
  toutes books confondues pour le joueur/paire 1 et 2).
- Appariement avec les matchs à venir issus de `data/`.
- Une page `/odds` dans l'app web permettant l'audit ligne par ligne.

### Hors périmètre (explicite)

- Aucune modification de `upcoming-matches.json`, de `prob`, du score d'intérêt ou
  du tri « À surveiller ».
- Pas de cote par bookmaker nommé (imposerait d'ouvrir la page de chaque match).
- Pas de calcul de value / edge / probabilité implicite.
- Pas d'ajout au workflow GitHub Actions (voir « Décisions »).

## Faisabilité — vérifiée par spike

Un spike Playwright sur `https://www.oddsportal.com/matches/badminton/20260730/` a
donné : **HTTP 200, aucun challenge Cloudflare, 20 matchs extraits avec leurs
cotes**, en un seul chargement de page.

Le DOM expose plus que l'affichage visible :

| Donnée | Source DOM | Simple | Double |
| --- | --- | --- | --- |
| Nom complet | slug du lien H2H (`lee-zii-jia`) | oui | non (noms de famille seuls : `watanabe-taguchi`) |
| Nom affiché | attribut `title` (`Prannoy H. S.`) | oui | oui |
| Pays | `alt` du drapeau (`my`, ISO2) | oui | absent |
| Discipline + tournoi | entête `header-tournament-item` | oui | oui |
| Cotes | `p[data-testid="odd-container-default"]` | oui | oui |

**Piège confirmé par le spike :** l'ordre des slugs dans l'URL H2H ne suit pas
l'ordre d'affichage (ligne 1 : href = `hoh…/shujiwo…` mais affichage =
`Shujiwo P. B.` / `Hoh J.`). L'appariement slug ↔ participant doit se faire **par
nom de famille**, jamais par position. Les cotes, elles, suivent bien l'ordre
d'affichage (2.60 → participant 1).

## Architecture

Quatre pièces, chacune une responsabilité, dans le prolongement des conventions du
dépôt.

```
scrape-odds.mjs  ──(lib/odds.mjs)──>  data/odds/YYYY-MM-DD.json
                                              │
build-data.mjs  ──(lib/odds-match.mjs)─────────┘
                          │
                          v
              web/public/data/odds-report.json  ──>  page /odds
```

### `lib/odds.mjs` — client de scrape

Classe `OddsClient`, même forme que `BwfClient` (`start()` / `close()`), mais
séparée : l'une lit du JSON d'API BWF, l'autre du DOM oddsportal. Pas de
généralisation prématurée du navigateur.

```js
await client.fetchDate("2026-07-30") // -> OddsRow[]
```

Le contexte navigateur force `timezoneId: "UTC"` pour que les heures extraites
soient déterministes quelle que soit la machine (local ou CI).

Sélecteurs : uniquement des `data-testid` (`game-row`, `event-participants`,
`odd-container-default`, `header-tournament-item`), jamais les classes utilitaires
Tailwind, qui sont volatiles.

Gestion du lazy-load : scroll en bas de page jusqu'à stabilisation du nombre de
lignes (max 15 itérations).

**Forme d'une ligne (`OddsRow`) :**

```js
{
  date: "2026-07-30",          // depuis l'URL, pas depuis l'entête relatif ("Tomorrow")
  time: "04:00",               // UTC
  eventId: "pQj9MZp4",         // ancre du lien -> clé stable côté oddsportal
  href: "/badminton/h2h/...",
  country: "Taiwan",
  league: "BWF World Tour - Men Taipei Open",
  discipline: "MS",            // dérivé de league
  tournamentLabel: "taipei open", // league normalisé
  p1: { display: "Shujiwo P. B.", iso2: "id", slug: "shujiwo-prahdiska-bagas" },
  p2: { display: "Hoh J.", iso2: "my", slug: "hoh-justin-shou-wei" },
  odd1: 2.60,
  odd2: 1.42
}
```

Si l'alignement slug ↔ participant est ambigu, `slug` vaut `null` et seul
`display` est exploité en aval. Une ligne sans les 2 cotes est conservée avec
`odd1`/`odd2` à `null` (le spike en a relevé 4 sur 20).

### `scrape-odds.mjs` — CLI

À la racine, comme `run-update.mjs` :

```bash
node scrape-odds.mjs                 # aujourd'hui + 4 jours
node scrape-odds.mjs 2026-07-30      # une date précise
node scrape-odds.mjs 2026-07-30 5    # 5 dates à partir de celle-ci
```

- Ne conserve que les lignes dont la ligue matche `/BWF/i` (écarte les compétitions
  nationales et autres badminton non-BWF).
- Écrit `data/odds/YYYY-MM-DD.json`, **versionné** comme `data/` : c'est une source
  d'entrée du build, et cela constitue gratuitement un historique de cotes.
- Écrase toujours le fichier de la date visée (une cote évolue ; pas d'incrémental
  ici).
- Pause de 2 s entre deux dates.
- Script npm : `npm run scrape-odds`.

### `lib/odds-match.mjs` — le matcher

**Fonctions pures, zéro I/O**, donc testables sans navigateur.

```js
matchOdds(bwfUpcoming, oddsRows)
// -> { matched, ambiguous, unmatchedOdds, unmatchedBwf, stats }
```

L'espace de recherche est d'abord réduit à **même discipline + même tournoi**, ce
qui rend les collisions de noms de famille quasi impossibles.

**Discipline**, depuis le libellé de ligue (tester les doubles *avant* les simples,
sinon « Doubles Men » matcherait « Men ») :

| Libellé oddsportal | Discipline |
| --- | --- |
| `Doubles Men` | MD |
| `Doubles Women` | WD |
| `Mixed Doubles` | XD |
| `Men` | MS |
| `Women` | WS |

**Tournoi** : normalisation des deux côtés vers une clé commune.
`YONEX Taipei Open 2026` et `BWF World Tour - Men Taipei Open` → `taipei open`
(retrait du préfixe `BWF World Tour -`, du segment de discipline, de l'année et des
sponsors connus). Si aucun tournoi ne correspond, on retombe sur discipline seule
avec un seuil de score plus exigeant.

**Appariement d'un joueur**, trois signaux combinés :

1. **Slug H2H** — signal le plus fort. `lee-zii-jia` ↔ slug BWF `zii-jia-lee` :
   comparaison en **ensembles de tokens**, insensible à l'ordre.
2. **Nom de famille + initiales** — `Prannoy H. S.` → nom `prannoy`, initiales
   `h,s` ↔ BWF `lastName: "PRANNOY"`, `firstName: "H. S."`. Cas particulier : un
   affichage sans initiales (`Lin Chun-Yi`) est traité comme un nom complet et
   comparé au nom complet BWF.
3. **Pays** — `alt="my"` → ISO2 → code BWF (`MAS`). Signal de confirmation
   uniquement, et disponible en simple seulement. Nécessite une table ISO2 → code
   BWF (les codes BWF ne sont pas ISO3 : Indonésie = `INA`, pas `IDN`).

Toutes les comparaisons se font sur des chaînes normalisées : minuscules, sans
diacritiques, sans ponctuation.

**Appariement d'un match** : une équipe n'est matchée que si **les deux joueurs**
matchent (les deux ordres team1/team2 sont testés) et si le **deuxième meilleur
candidat est nettement moins bon** (marge minimale). Sinon la ligne part dans
`ambiguous` et **aucune cote n'est attachée**.

> Principe directeur : **une cote absente vaut mieux qu'une cote fausse.**

En double, l'absence de prénoms et de drapeau impose un seuil plus exigeant ; un
taux d'appariement plus faible y est attendu et sera visible dans les stats.

### `build-data.mjs` — assemblage

Lit `data/odds/*.json`, appelle `matchOdds` avec les matchs à venir déjà calculés,
puis écrit `odds-report.json`. **Ne modifie aucune sortie existante.** L'absence du
dossier `data/odds/` n'est pas une erreur : le rapport est alors vide.

### Page `/odds` — vérification

Objectif : **auditer ligne par ligne**, pas séduire.

- Bandeau de stats : cotes scrapées, matchées (%), ambiguës, cotes orphelines,
  matchs BWF sans cote.
- Quatre onglets (classe `.tab` existante) : **Matchés · Ambigus · Cotes
  orphelines · BWF sans cote**.
- Table « Matchés » : heure · discipline · tournoi · **côté BWF** (noms complets) ·
  **côté oddsportal** (affichage + slug) · cote 1 · cote 2 · score de confiance.
  Les deux colonnes côte à côte rendent une erreur d'appariement immédiatement
  visible.
- Entrée dans la sidebar de `Layout.jsx`, route dans `main.jsx`.
- Contraintes projet : couleurs via les variables CSS de `styles.css`, scroll
  horizontal confiné dans `.table-scroll`, passage en cartes sous 700px, les trois
  états chargement / vide / données. Le skill `ui-ux-pro-max-skill` est invoqué
  avant écriture de la page.

## Tests

`lib/odds-match.mjs` étant pur, les tests précèdent l'implémentation
(`node --test`).

Fixture : la sortie réelle du spike figée dans
`test/fixtures/oddsportal-20260730.json` (20 lignes, 3 tournois).

Cas couverts :

- slugs inversés par rapport à l'ordre d'affichage ;
- affichage sans initiales (`Lin Chun-Yi`) ;
- initiales multiples (`Prannoy H. S.`) ;
- double avec noms de famille seuls (`watanabe-taguchi`) ;
- collision de noms de famille dans la même discipline → doit produire `ambiguous`,
  pas un faux match ;
- tournoi introuvable → repli discipline seule ;
- ligne sans cote ;
- entrée BWF sans ligne oddsportal correspondante.

## Décisions

| Décision | Raison |
| --- | --- |
| Page liste uniquement, pas de page par match | 1 requête par date au lieu de ~50 ; moins de risque de blocage. La colonne 1/2 donne déjà la meilleure cote du marché. |
| Aujourd'hui + 4 jours | Les draws BWF sont rarement connus au-delà d'une semaine ; oddsportal expose des onglets jusqu'à +6. |
| `data/odds/` versionné | Source d'entrée du build, et historique de cotes gratuit. |
| Matcher = module pur séparé | C'est la pièce risquée ; l'isoler la rend testable sans navigateur et remplaçable. |
| **Pas d'ajout à `deploy.yml`** à cette étape | Cloudflare est plus sévère depuis les IP datacenter de GitHub Actions. On valide la qualité en local avant de risquer le déploiement quotidien. Câblage CI = étape suivante. |
| Page visible dans la sidebar | Outil personnel, accès direct assumé. |

## Risques

- **Données BWF périmées** — le Taipei Open (id 5514) est absent de `data/` (dernier
  scrape 2026-07-07). Un `npm run update` est nécessaire avant de pouvoir vérifier
  quoi que ce soit, sinon la page affichera des cotes sans match BWF en face.
- **Taux d'appariement des doubles** — potentiellement faible. La page le chiffrera ;
  c'est précisément ce qu'on cherche à mesurer à cette étape.
- **Évolution du DOM oddsportal** — mitigé par l'usage exclusif des `data-testid`.
  Si le scrape retourne 0 ligne, `scrape-odds.mjs` sort en erreur explicite plutôt
  que d'écrire un fichier vide.

## Suite

Une fois le taux d'appariement jugé acceptable : spec d'intégration (cotes sur les
cartes de match à venir, probabilité implicite, écart avec notre Elo, câblage CI).

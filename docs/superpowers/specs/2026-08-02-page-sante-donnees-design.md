# Page « Santé des données » (`/sante`) — design

Date : 2026-08-02 · Statut : approuvé (design validé en session)

## But

Vérifier directement dans l'app que chaque JSON servi est chargeable et à jour,
et rendre visibles les refresh bookmakers un par un — y compris leurs échecs
(ex. `betclic → HTTP 403` présent dans `data/books/runs/*.json` mais invisible
aujourd'hui, `books-report.json` ne gardant que les horodatages).

## 1. Côté build (`build-data.mjs`)

Nouveau fichier généré : `web/public/data/health.json`, écrit en dernier.

- `generatedAt` : ISO.
- `files` : manifeste des fichiers écrits par le build — le helper `write()`
  enregistre chaque écriture : `{ name, bytes }`. Les fichiers par
  joueur/paire/tournoi sont agrégés en compteurs (`playerFiles: n`, etc.),
  pas listés un par un.
- `bookRuns` : pour chacun des ~30 derniers runs de `data/books/runs/` :
  `{ fetchedAt, books: { <op>: { rows, complete, error } } }` — infos déjà
  présentes dans les fichiers bruts, jamais exportées jusqu'ici.

## 2. Côté app (`web/src/pages/Sante.jsx`, route `/sante`)

Trois blocs :

1. **Verdict** en une phrase (style Coulisses) : « Tout est vert » ou
   « N problèmes détectés », calculé à partir des deux blocs suivants.
2. **Fichiers de l'app** : tableau ; pour chaque JSON connu (`summary`,
   `status`, `updates`, `upcoming-matches`, `books-report`, `backtest`,
   `elo/ranking`, `health`), l'app le télécharge réellement (test de bout en
   bout : ce que le navigateur reçoit) et affiche : statut (✓ chargé / ✗
   erreur), horodatage, badge de fraîcheur (à jour / vieillissant / périmé —
   seuil ~30 h pour les données quotidiennes, ~4 h pour les cotes), taille,
   compteur clé (nb matchs, joueurs…).
3. **Refresh bookmakers** : tableau, un run par ligne (récent → ancien) :
   heure, puis par opérateur « ✓ 17 lignes » ou « ✗ HTTP 403 » (en rouge),
   badge « incomplet » si le run n'a pas tout relevé.

## 3. Accès

Lien discret « Santé » en bas de la sidebar (et de la barre horizontale
mobile), pas au niveau des 3 pages principales.

## Gestion d'erreur / états

- `health.json` absent (ancien build) → mode dégradé : bloc 2 seul, testé côté
  navigateur ; blocs 1 et 3 affichent l'explication.
- Trois états gérés partout : chargement / vide / données.
- Mobile 375 px : aucun débordement de page, tableaux dans `.table-scroll`.

## Hors périmètre (YAGNI)

Pas de test des fichiers par joueur/paire/tournoi (des centaines), pas
d'alerte automatique, pas d'historique de santé.

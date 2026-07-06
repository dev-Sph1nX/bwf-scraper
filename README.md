# BWF Scraper

Récupère les résultats du circuit BWF (World Tour) et les affiche dans une petite
application web (calendrier des tournois, tableaux en arbre, fiches joueurs).

## Comment ça marche

Le projet est séparé en deux :

1. **Le scraper** (Node + Playwright) franchit la protection Cloudflare via un vrai
   navigateur et télécharge les données dans `data/` (mode incrémental : ne reprend
   pas ce qui est déjà là ; rafraîchit les tournois en cours).
2. **L'app React** (`web/`, Vite) affiche des fichiers JSON statiques → hébergeable
   gratuitement sur GitHub Pages.

```
run-update.mjs  (scrape)  →  data/  →  build-data.mjs  →  web/public/data/*.json
                                                                 ↓
                                        web (React)  →  build  →  GitHub Pages
```

## Automatisation

`.github/workflows/deploy.yml` fait tourner tout ça automatiquement (cron toutes les
6 h + lancement manuel) : scrape → génération des données → build → déploiement Pages,
et re-commit `data/` pour garder l'incrémental d'un run à l'autre.

## En local

```bash
npm install                 # dépendances du scraper
npx playwright install chromium
node run-update.mjs 2026    # scrape l'année (long au 1er lancement)
node build-data.mjs 2026    # génère les JSON pour l'app

cd web
npm install
npm run dev                 # http://localhost:5173
```

## Structure

- `lib/` — client Cloudflare, appels API BWF, store disque, vues, orchestration
- `run-update.mjs` — lance le scrape d'une année
- `build-data.mjs` — génère les JSON statiques dans `web/public/data/`
- `web/` — application React (Vite)
- `data/` — données téléchargées (versionnées pour l'incrémental)
- `types.ts` — types TypeScript des réponses de l'API BWF

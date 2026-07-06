# CLAUDE.md

Contexte pour Claude Code sur ce dépôt.

## Le projet

Scraper du circuit BWF (World Tour) + application web d'affichage. Deux moitiés :

- **Scraper** (Node + Playwright) : franchit Cloudflare via un vrai navigateur,
  télécharge dans `data/` en mode incrémental. Voir `lib/` (`client`, `api`, `store`,
  `views`, `updater`), `run-update.mjs`, `build-data.mjs`.
- **App web** (`web/`, React + Vite) : lit des JSON statiques générés dans
  `web/public/data/` → hébergée gratuitement sur GitHub Pages.

Chaîne : `run-update.mjs` (scrape) → `data/` → `build-data.mjs` → `web/public/data/*.json`
→ build React → GitHub Pages. Automatisé par `.github/workflows/deploy.yml` (cron 6 h).

## Règle UI/UX — IMPORTANTE

**Avant toute création ou modification d'interface** (composant React, page, CSS,
layout, couleur, typographie, état de chargement/erreur, responsive, accessibilité),
**invoque d'abord le skill `ui-ux-pro-max-skill`** puis applique sa check-list avant de
conclure. Il contient le design system du projet et les règles à respecter.

Rappels rapides (détaillés dans le skill) :
- Couleurs uniquement via les variables CSS de `web/src/styles.css` (jamais en dur).
- Typographie Verdana (charte). Réutiliser les classes existantes (`.card`, `.stat`,
  `.badge`, `.tab`, `.primary`, `.bracket-*`).
- Toujours gérer les 3 états : chargement / vide / données.
- Accessibilité (contraste AA, `alt`, sémantique, focus) et responsive obligatoires.

## Commandes

```bash
# Scraper (racine)
npm install && npx playwright install chromium
npm run update       # scrape l'année
npm run build-data   # génère les JSON pour l'app
npm run refresh      # les deux d'un coup

# App web
cd web && npm install
npm run dev          # dev local (http://localhost:5173)
npm run build        # build statique -> web/dist
```

## Conventions

- Données brutes `data/` = versionnées (nécessaire à l'incrémental). Dérivés
  `web/public/data/` et `web/dist/` = ignorés (régénérés).
- Réponses de l'API BWF typées dans `types.ts`.
- Ne pas committer de secret/token (le repo est public). Pas de déclenchement de
  workflow côté client exposant un token.

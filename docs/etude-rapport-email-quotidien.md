# Étude de faisabilité — rapport quotidien par e-mail

Date : 2026-08-02 · Statut : étude (rien d'implémenté) · Demandeur : Lucas

## La demande

Recevoir chaque jour un e-mail avec les **matchs du jour** et les **cotes
intéressantes** (EV positive, sous-cotés, gros écarts Elo), sans avoir à ouvrir
le site.

## Verdict : faisable, ~½ journée, 0 €

Tout ce qu'il faut existe déjà : les données (`upcoming-matches.json` contient
heure, probas calibrées, cotes par opérateur, EV et tags `value` — aujourd'hui
même : 6 matchs cotés, 3 EV > 0, 8 « sous-cotés BWF »), et un pipeline GitHub
Actions qui tourne déjà. Il manque seulement : un script qui compose l'e-mail,
et un moyen de l'envoyer. Aucune contrainte CGU : on **informe**, on ne place
aucune mise (cf. décision existante « pas d'automatisation des mises »).

## Contrainte structurante : le site est statique

GitHub Pages ne peut rien envoyer. L'envoi doit donc partir soit du **pipeline
GitHub Actions** (recommandé : tout y est déjà), soit d'un service tiers qui
« lirait » le site (fragile, on écarte).

Le dépôt est **public** : la clé d'envoi et l'adresse destinataire vont dans
les **GitHub Actions Secrets** (chiffrés, masqués dans les logs, non exposés
aux forks ; les workflows `schedule` tournent uniquement sur ce dépôt). Rien à
committer, conforme à la règle « pas de secret dans le repo ».

## Options d'envoi comparées

| Option | Coût | Mise en place | Limites / risques |
|---|---|---|---|
| **A. API Brevo** (recommandé) | 0 € (300 mails/j) | Compte + valider son adresse d'expéditeur + 1 secret | Appel HTTP en `fetch` natif, zéro dépendance npm ; pas besoin de domaine |
| B. API Resend | 0 € (100/j) | Compte + 1 secret | Expéditeur personnalisé exige un **domaine vérifié** (sinon `onboarding@resend.dev`) — on n'a pas de domaine |
| C. SMTP Gmail (mot de passe d'application) | 0 € | 2FA + app password + dépendance `nodemailer` | Ajoute une dépendance ; Google peut couper les app passwords ; compte perso engagé dans CI |
| D. Telegram/Discord (alternative, pas e-mail) | 0 € | 1 webhook/bot token | Le plus simple techniquement et meilleures notifs mobiles — mais ce n'est pas ce qui est demandé ; possible en 2ᵉ canal |

**Recommandation : A (Brevo)** — gratuit sans carte, expéditeur = ta propre
adresse validée, envoi par simple `fetch` HTTPS depuis un script Node du dépôt
(aucune dépendance). Secrets nécessaires : `BREVO_API_KEY`, `EMAIL_TO`.

## Architecture proposée

```
(workflow dédié, cron)               réutilise l'existant
┌───────────────────────┐   lit    ┌─────────────────────────────┐
│ report-daily.yml      │ ───────► │ scrape-books.mjs (cotes 2 h) │
│  1. checkout          │          │ build-data.mjs  (EV, tags)   │
│  2. node scrape-books │          └─────────────────────────────┘
│  3. node build-data   │
│  4. node report-daily.mjs  → compose le HTML + POST API Brevo
└───────────────────────┘
```

- **`report-daily.mjs`** (nouveau, ~150 lignes) : lit
  `web/public/data/upcoming-matches.json`, filtre les matchs des prochaines
  24 h, sectionne l'e-mail : ① EV positives (meilleure cote, opérateur, proba
  calibrée), ② sous-cotés BWF, ③ le programme du jour trié par heure. HTML
  simple en tableaux inline (compatible clients mail), mêmes chiffres que le
  site. Lien vers le site et vers /sante.
- **Workflow dédié** (pas dans deploy.yml) : il relève les cotes fraîches
  juste avant l'envoi, sans committer ni déployer — le site, lui, continue
  d'être reconstruit à minuit comme aujourd'hui. Runner public = minutes
  Actions illimitées, coût 0.
- **Si rien d'intéressant** (aucun match coté) : ne rien envoyer, ou un
  one-liner « rien aujourd'hui » — à trancher, je préconise ne rien envoyer.

## Le choix qui reste à faire : l'heure d'envoi

Les tournois sont surtout asiatiques : premiers matchs vers **04h–06h UTC**
(06h–08h Paris). Deux stratégies :

1. **La veille à 21h UTC (23h Paris)** — les cotes du lendemain sont déjà
   ouvertes chez les opérateurs (on le voit dans les relevés existants) : tu
   peux parier avant de dormir, aucun match n'est commencé. **Préconisé.**
2. Le matin à 04h30 UTC (06h30 Paris) — cotes plus proches de la clôture
   (meilleure info) mais les tout premiers matchs peuvent être déjà lancés.

Les deux sont le même workflow avec un cron différent ; on peut même faire les
deux (ex. veille = programme complet, matin = rappel des EV restantes).

## Risques et parades

- **Délivrabilité (spam)** : expéditeur validé chez Brevo, HTML sobre, envoi à
  soi-même → risque faible ; marquer « pas spam » au premier mail.
- **Échec du relevé de cotes** (ex. Betclic HTTP 403 actuel) : le rapport se
  compose avec ce qui reste (Unibet/Winamax) et le signale en pied de mail —
  même philosophie que la page /sante.
- **Clé API compromise** : clé Brevo restreinte à l'envoi, révocable en un
  clic, jamais dans le code.
- **Dérive silencieuse** (le mail ne part plus) : le workflow échoue → GitHub
  notifie par e-mail les échecs de workflow, filet de sécurité gratuit.

## Estimation

| Lot | Effort |
|---|---|
| Script `report-daily.mjs` (sélection + HTML) | ~2 h |
| Workflow + secrets + test bout en bout | ~1 h |
| Ajustements de contenu après les 2-3 premiers mails | ~1 h |

**Prochaine étape si validé** : créer le compte Brevo (2 min, à faire par
Lucas), poser les 2 secrets dans GitHub, puis implémentation en une session.

// Notes de version — affichées sur la page « Notes de version ».
// Convention : à chaque commit de fonctionnalité, ajouter une entrée ici (même
// commit). `type` : "feat" (nouveau) · "improve" (amélioration) · "fix" (correctif).
// Le plus récent en haut.

export const CHANGELOG = [
  {
    date: "2026-08-02",
    title: "Santé des données, accueil unifié & navigation revue",
    items: [
      { type: "feat", text: "Nouvelle page « Santé des données » (lien en pied de menu) : chaque fichier JSON du site est réellement téléchargé et vérifié (chargement, fraîcheur, taille, contenu), et chaque relevé de cotes est détaillé opérateur par opérateur — les échecs (ex. HTTP 403 chez Betclic) deviennent enfin visibles." },
      { type: "feat", text: "Accueil : une seule liste « À venir » triée par heure de match (heure relevée chez les bookmakers, affichée sur chaque carte), avec filtre Tous / Avec cote / Sans cote. Les matchs sans cote l'affichent simplement." },
      { type: "feat", text: "Bouton « ⚔️ Duel » sur chaque carte de match : ouvre le simulateur pré-rempli avec les deux joueurs." },
      { type: "improve", text: "Le simulateur de duel redevient une page dédiée (les anciens liens continuent de fonctionner)." },
      { type: "improve", text: "Cartes de match : une seule colonne joueur — drapeau, nom, classement mondial, puis score Elo avec son rang." },
      { type: "improve", text: "Coulisses : un menu latéral remplace les accordéons ; la section ouverte est dans l'URL, donc partageable." },
      { type: "feat", text: "Un graphe par match (📈 à côté de Duel) : l'évolution des DEUX cotes, rouge = camp 1, bleu = camp 2, un opérateur à la fois. Actif seulement quand un même opérateur a plusieurs relevés — sinon il n'y aurait qu'un point par courbe." },
      { type: "feat", text: "Accueil : filtres par tournoi et par discipline (MS, WS, MD, WD, XD), en plus du filtre avec/sans cote. Le choix des opérateurs passe dans un menu ⋮ « préférences d'affichage »." },
      { type: "feat", text: "Santé des données : visionneuse JSON intégrée — le contenu réel de chaque fichier, brut et dépliable (+ lien vers le fichier tel que servi)." },
      { type: "improve", text: "Confrontations directes : lien vers le head-to-head officiel bwfbadminton.com (notre historique ne couvre que le World Tour depuis 2024)." },
      { type: "improve", text: "npm run dev rafraîchit d'abord les données (cotes + build + backtest) ; npm run dev:vite pour s'en passer." },
    ],
  },
  {
    date: "2026-07-07",
    title: "Matchs à venir, analyse « value » & Mondiaux",
    items: [
      { type: "feat", text: "Nouvelle page « Matchs à venir » : les affiches publiées par la BWF avant chaque tournoi, avec cote Elo, classement mondial, forme et probabilité de victoire de chaque côté. Devient la page d'accueil." },
      { type: "feat", text: "Tri par intérêt des matchs à venir : « À surveiller » (score de valeur), « Serrés » (issue incertaine), « Chocs » (deux tops), avec le détail des raisons match par match." },
      { type: "feat", text: "Comparaison de forme dans le prédicteur : les deux courbes Elo superposées, avec filtre de période (3 mois → tout) et dates sur l'axe." },
      { type: "feat", text: "Palmarès sur chaque fiche tournoi : vainqueur, finaliste et demi-finalistes par tableau." },
      { type: "feat", text: "Championnats du monde intégrés au classement Elo (en plus du World Tour et des World Tour Finals)." },
      { type: "improve", text: "Calendrier : onglets « À venir » / « Passés », mise en avant du tournoi en cours (ou du prochain), recherche par nom avec compteurs." },
      { type: "improve", text: "Fiches joueur & paire : le tête-à-tête ouvre désormais directement le comparatif dans le prédicteur." },
      { type: "improve", text: "Fiches tournoi : les poules (round-robin) affichent un classement + les matchs, au lieu d'un arbre vide." },
      { type: "improve", text: "Classement mondial BWF rafraîchi une fois par semaine (le mercredi), au lieu de chaque jour." },
      { type: "fix", text: "Suivi quotidien des mises à jour : les jours sans nouveau match sont désormais tracés dans la page Données." },
    ],
  },
];

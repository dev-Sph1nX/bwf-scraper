// Notes de version — affichées sur la page « Notes de version ».
// Convention : à chaque commit de fonctionnalité, ajouter une entrée ici (même
// commit). `type` : "feat" (nouveau) · "improve" (amélioration) · "fix" (correctif).
// Le plus récent en haut.

export const CHANGELOG = [
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

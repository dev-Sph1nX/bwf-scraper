// lib/export-schema.mjs
// Colonnes du jeu de données exporté, et garde-fou de neutralité.
//
// L'export est la SEULE surface d'analyse : ce qui y figure sera pris pour un
// fait. Deux familles en sont donc bannies, et le bannissement est vérifié par
// test (test/export-schema.test.mjs) plutôt que confié à la vigilance :
//
//   1. LES AGRÉGATS DE CARRIÈRE (taux_victoire, rang_actuel, meilleur_rang_*).
//      Ils résument toute la période couverte, donc décrire un match de 2022
//      avec eux revient à le décrire par ce qui s'est passé en 2026. Une
//      jointure d'une ligne suffit à fuiter le futur. Ils se refont par un
//      GROUP BY sur matches.csv — ce qui force à déclarer la fenêtre, et c'est
//      exactement la discipline recherchée.
//
//   2. LES PROBABILITÉS ET MARGES (proba1_cloture, marge_*, derive_*, ecart_*).
//      Une cote est un prix affiché, donc un fait. Une probabilité implicite
//      est une convention : elle suppose une normalisation de la marge
//      (proportionnelle, logarithmique, Shin) jamais mesurée ici. Pré-calculée,
//      ce choix devient invisible ; recalculée à la demande, c'est un paramètre.
//
// Rien n'est perdu : chaque colonne retirée se recalcule depuis les cotes
// brutes, toutes conservées.
//
//   proba1_cloture         = (1/c1) / (1/c1 + 1/c2)
//   marge_cloture          = 1/c1 + 1/c2 - 1
//   derive_proba1          = proba1_cloture - proba1_ouverture
//   proba_3manches_cloture = (cs_2_1 + cs_1_2) normalisé sur les quatre scores
//   taux_victoire à une date = GROUP BY sur matches.csv WHERE date < borne

/** matches.csv — une ligne par match joué. Faits observés uniquement. */
export const MATCH_COLS = [
  "match_id", "date", "datetime_utc", "saison", "discipline", "tour",
  "tournoi_id", "tournoi", "lieu", "pays_tournoi",
  "equipe1_id", "equipe1", "pays1", "equipe2_id", "equipe2", "pays2",
  "vainqueur", "score", "manches", "points1", "points2", "duree_min",
  // `rang*` vient de la dernière publication ANTÉRIEURE au match (recherche
  // dichotomique stricte, cf. makeRankLookup). `rang*_date` publie CETTE date :
  // sans elle, l'absence de fuite se croit sur parole ; avec elle, elle se
  // vérifie ligne à ligne.
  "rang1", "rang1_date", "rang2", "rang2_date",
];

/** players.csv — une ligne par joueur. Identité et biologie, rien de plus. */
export const PLAYER_COLS = [
  "player_id", "nom", "prenom", "nom_famille", "slug", "pays",
  "date_naissance", "main", "taille_cm", "source_bio", "photo_url",
];

/** cotes.csv — une ligne par match × opérateur. Prix affichés et issues. */
export const ODDS_COLS = [
  "match_id", "date", "discipline", "fs_id", "book", "misable",
  // Issues observées : ce sont les étiquettes, pas des prédictions.
  "vainqueur", "manches", "points_total",
  "cote1_ouverture", "cote1_cloture", "cote2_ouverture", "cote2_cloture",
  "cs_2_0_ouverture", "cs_2_0_cloture", "cs_2_1_ouverture", "cs_2_1_cloture",
  "cs_1_2_ouverture", "cs_1_2_cloture", "cs_0_2_ouverture", "cs_0_2_cloture",
  "total_ligne", "cote_over_ouverture", "cote_over_cloture",
  "cote_under_ouverture", "cote_under_cloture", "total_lignes",
];

/** cotes-totaux.csv — une ligne par match × opérateur × seuil. */
export const TOTALS_COLS = [
  "match_id", "date", "book", "misable", "total",
  "cote_over_ouverture", "cote_over_cloture",
  "cote_under_ouverture", "cote_under_cloture",
  "points_total", "resultat_over",
];

/**
 * Motifs de nom trahissant une quantité dérivée.
 *
 * Volontairement grossiers : mieux vaut refuser une colonne innocente et
 * devoir la renommer que laisser passer une opinion déguisée en fait.
 */
export const MOTIFS_DERIVES = [
  /proba/i,     // probabilité implicite : suppose une normalisation
  /marge/i,     // overround : idem
  /derive/i,    // dérive entre deux relevés
  /ecart/i,     // écart entre deux estimations
  /taux/i,      // agrégat sur une fenêtre non déclarée
  /actuel/i,    // état au moment de l'export = futur pour toute ligne passée
  /meilleur/i,  // extremum sur toute la période
  /\belo\b|_elo|elo_/i, // note du modèle du projet
  /calibr/i,    // sortie d'un recalibrage
];

/** Colonnes d'une liste qui tombent sous un motif dérivé. */
export function colonnesDerivees(cols) {
  return cols.filter((c) => MOTIFS_DERIVES.some((m) => m.test(c)));
}

/**
 * Jette si une colonne dérivée se glisse dans un fichier exporté.
 * Appelé à l'écriture de chaque CSV : la neutralité échoue bruyamment
 * plutôt que silencieusement.
 */
export function assertPur(cols, fichier = "export") {
  const sales = colonnesDerivees(cols);
  if (sales.length) {
    throw new Error(
      `${fichier} : colonne(s) dérivée(s) interdite(s) — ${sales.join(", ")}. ` +
      `Une quantité calculée n'est pas une donnée : la retirer, ou la recalculer à l'analyse.`
    );
  }
  return cols;
}

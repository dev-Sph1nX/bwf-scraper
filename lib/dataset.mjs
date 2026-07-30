// lib/dataset.mjs
// Jeu de données d'AVANT match : une ligne par match joué, ne contenant que ce
// qu'on savait avant que ce match ne soit joué.
//
// C'est la pièce critique du backtest. Si une seule valeur postérieure au match
// s'y glisse, tous les chiffres publiés seront faux ET paraîtront excellents —
// c'est le seul échec du chantier qui serait invisible. D'où deux garanties
// structurelles :
//
//   1. les variables issues de l'Elo viennent du crochet `onMatch` de
//      lib/elo.mjs, appelé AVANT que la mise à jour ne soit appliquée. On ne
//      réimplémente pas la boucle chronologique : deux passes concurrentes
//      finiraient par diverger, et le backtest mesurerait alors autre chose que
//      ce que l'application affiche ;
//   2. les variables que l'Elo ne suit pas (face-à-face, charge dans le tournoi,
//      rang mondial) sont accumulées dans l'ordre d'appel du crochet, donc
//      chronologiquement, et lues AVANT d'être mises à jour avec le match courant.
//
// Le rang mondial provient de la publication précédant STRICTEMENT la date du
// match. Utiliser la publication courante serait une fuite : le rang d'un joueur
// intègre déjà le résultat du match qu'on cherche à prédire.

import { computeElo, PARAMS } from "./elo.mjs";
import { buildWorldMap } from "./rank-history.mjs";

const DAY_MS = 86_400_000;

/** Somme des deltas Elo des N derniers matchs — même définition que lib/elo.mjs. */
export function formOf(history, fenetre = PARAMS.formWindow) {
  const recents = (history || []).slice(-fenetre);
  return Math.round(recents.reduce((s, h) => s + (h.d || 0), 0));
}

/** Jours écoulés depuis le dernier match joué, ou null si jamais joué. */
export function daysSince(lastPlayed, maintenant) {
  if (!lastPlayed || !maintenant) return null;
  const a = Date.parse(String(lastPlayed).replace(" ", "T"));
  const b = Date.parse(String(maintenant).replace(" ", "T"));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

/** Un match s'est-il joué en 3 manches ? */
export const wentThreeSets = (score) => Array.isArray(score) && score.length >= 3;

/**
 * Tête de série en NOMBRE. L'API la renvoie en chaîne (« 1 », « 10 »), et un
 * baseline qui comparerait ces chaînes classerait « 10 » avant « 9 » en ordre
 * lexicographique — donc la 10e tête de série devant la 9e. Toute valeur non
 * numérique (« Q » pour qualifié, chaîne vide) devient null.
 */
export function seedNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Forfait : à exclure du jeu de données — ce n'est pas un match à prédire. */
export const isWalkover = (match) =>
  /walkover|retired|no match/i.test(String(match?.scoreStatusValue || "")) ||
  (!(match?.duration > 0) && !(Array.isArray(match?.score) && match.score.length));

/**
 * Table de correspondance date → rang mondial, par discipline et par entité.
 *
 * Rend une fonction `(dateMatch, disc, cleEntite)` qui cherche la publication
 * précédant STRICTEMENT `dateMatch`, et renvoie
 * `{ rank, points, at }` ou null.
 *
 * @param {Array<{date:string, disciplines:object}>} publications  triées par date croissante
 */
export function makeRankLookup(publications) {
  const dates = [];
  const cartes = [];
  for (const p of publications || []) {
    dates.push(p.date);
    cartes.push(buildWorldMap(p));
  }

  // Dernier indice dont la date est < cible (recherche dichotomique).
  const indexAvant = (cible) => {
    let lo = 0, hi = dates.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] < cible) { res = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return res;
  };

  return (dateMatch, disc, cle) => {
    if (!dateMatch || !dates.length) return null;
    const jour = String(dateMatch).slice(0, 10);
    const i = indexAvant(jour);
    if (i < 0) return null;
    const v = cartes[i][disc]?.get(cle);
    return v ? { rank: v.rank, points: v.points, at: dates[i] } : null;
  };
}

const cleTournoi = (tmtId, cle) => `${tmtId}|${cle}`;
const cleH2h = (disc, a, b) => `${disc}|${[a, b].sort().join("|")}`;

/**
 * Fabrique le collecteur. Séparé de l'orchestration pour être testable sans
 * disque ni réseau : on lui envoie des appels de crochet synthétiques.
 *
 * @param {{rankLookup?: Function}} o
 */
export function createCollector({ rankLookup = () => null } = {}) {
  const rows = [];
  const stats = { vus: 0, retenus: 0, walkovers: 0, sansDate: 0 };

  // Accumulateurs, alimentés dans l'ordre chronologique des appels.
  const h2h = new Map();     // "disc|a|b" -> { [cle]: victoires }
  const charge = new Map();  // "tmtId|cle" -> minutes jouées dans ce tournoi
  const trois = new Map();   // "tmtId|cle" -> le match précédent était en 3 manches

  function onMatch(ctx) {
    const { tmtId, drawId, disc, match, won, a, b } = ctx;
    stats.vus++;

    if (isWalkover(match)) { stats.walkovers++; return; }
    if (!match.matchTime) { stats.sansDate++; return; }

    const t = match.matchTime;
    const kH = cleH2h(disc, a.key, b.key);
    const compte = h2h.get(kH) || {};

    // --- LECTURE de l'état d'avant match ---
    const rangA = rankLookup(t, disc, a.key);
    const rangB = rankLookup(t, disc, b.key);

    rows.push({
      // identité
      t, disc, tmtId, drawId, year: Number(String(t).slice(0, 4)),
      matchKey: `${tmtId}|${drawId}|${t}|${a.key}|${b.key}`,
      aKey: a.key, bKey: b.key,
      // cible : 1 si le camp A (team1) gagne, 0 sinon — c'est la valeur produite
      // par lib/elo.mjs (`match.winner === 1 ? 1 : 0`), directement utilisable
      // comme cible binaire par les modèles.
      won,
      // Elo, d'avant match (fourni par le crochet)
      eloA: Math.round(a.entity.rating), eloB: Math.round(b.entity.rating),
      nA: a.entity.matches, nB: b.entity.matches,
      formA: formOf(a.entity.history), formB: formOf(b.entity.history),
      daysOffA: daysSince(a.entity.lastPlayed, t), daysOffB: daysSince(b.entity.lastPlayed, t),
      // face-à-face antérieur, même discipline
      h2hA: compte[a.key] || 0, h2hB: compte[b.key] || 0,
      // charge dans CE tournoi, avant ce match
      loadA: charge.get(cleTournoi(tmtId, a.key)) || 0,
      loadB: charge.get(cleTournoi(tmtId, b.key)) || 0,
      sets3A: trois.get(cleTournoi(tmtId, a.key)) || false,
      sets3B: trois.get(cleTournoi(tmtId, b.key)) || false,
      // têtes de série du tableau, converties en nombre (cf. seedNumber)
      seedA: seedNumber(match.team1seed), seedB: seedNumber(match.team2seed),
      // rang mondial de la publication PRÉCÉDANT le match
      bwfRankA: rangA?.rank ?? null, bwfRankB: rangB?.rank ?? null,
      bwfRankAt: rangA?.at ?? rangB?.at ?? null,
    });
    stats.retenus++;

    // --- MISE À JOUR des accumulateurs, après l'écriture de la ligne ---
    compte[won === 1 ? a.key : b.key] = (compte[won === 1 ? a.key : b.key] || 0) + 1;
    h2h.set(kH, compte);

    const minutes = Number(match.duration) || 0;
    if (minutes > 0) {
      charge.set(cleTournoi(tmtId, a.key), (charge.get(cleTournoi(tmtId, a.key)) || 0) + minutes);
      charge.set(cleTournoi(tmtId, b.key), (charge.get(cleTournoi(tmtId, b.key)) || 0) + minutes);
    }
    const troisManches = wentThreeSets(match.score);
    trois.set(cleTournoi(tmtId, a.key), troisManches);
    trois.set(cleTournoi(tmtId, b.key), troisManches);
  }

  return { onMatch, rows, stats };
}

/**
 * Construit le jeu de données complet, en une passe chronologique.
 *
 * @param {{years: number[], seeds?: object, publications?: Array}} o
 * @returns {Promise<{rows: Array, stats: object, elo: object}>}
 */
export async function buildDataset({ years, seeds, publications = [] }) {
  const collector = createCollector({ rankLookup: makeRankLookup(publications) });
  const elo = await computeElo(years, seeds, { onMatch: collector.onMatch });
  return { rows: collector.rows, stats: collector.stats, elo };
}

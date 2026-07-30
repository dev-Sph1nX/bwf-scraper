// lib/odds-match.mjs
// Appariement des lignes de cotes oddsportal avec les matchs à venir BWF.
//
// Module PUR : aucun I/O, aucun navigateur. C'est la pièce risquée du dispositif,
// donc elle est isolée et testée (test/odds-match.test.mjs).
//
// Principe directeur : une cote absente vaut mieux qu'une cote fausse. Tout doute
// envoie la ligne dans `ambiguous` plutôt que de produire un appariement.

import { normalizeLabel } from "./odds.mjs";

// Score minimal pour considérer qu'un joueur est le même de part et d'autre.
const MIN_PLAYER = 60;
// Écart minimal entre le meilleur candidat et le suivant. En dessous : ambigu.
const MIN_MARGIN = 20;

// Tokens trop courants pour identifier un tournoi à eux seuls.
const GENERIC_TOKENS = new Set([
  "open", "masters", "international", "championships", "championship", "super",
  "world", "tour", "bwf", "challenge", "series", "grand", "prix", "finals", "cup",
]);

// ISO2 (drapeau oddsportal) -> code pays BWF. Les codes BWF ne sont pas des ISO3
// (Indonésie = INA, pas IDN), d'où cette table. Un code absent ne produit AUCUN
// signal — jamais de pénalité sur une inconnue.
const ISO2_TO_BWF = {
  id: "INA", my: "MAS", jp: "JPN", cn: "CHN", tw: "TPE", kr: "KOR", in: "IND",
  th: "THA", dk: "DEN", fr: "FRA", de: "GER", gb: "ENG", es: "ESP", nl: "NED",
  se: "SWE", fi: "FIN", no: "NOR", ie: "IRL", be: "BEL", ch: "SUI", at: "AUT",
  it: "ITA", pt: "POR", pl: "POL", cz: "CZE", sk: "SVK", bg: "BUL", hu: "HUN",
  ee: "EST", lv: "LAT", lt: "LTU", ua: "UKR", tr: "TUR", il: "ISR", is: "ISL",
  us: "USA", ca: "CAN", br: "BRA", mx: "MEX", pe: "PER", cl: "CHI", au: "AUS",
  nz: "NZL", hk: "HKG", sg: "SGP", vn: "VIE", mm: "MYA", ph: "PHI", kh: "CAM",
  lk: "SRI", np: "NEP", pk: "PAK", bd: "BAN", mv: "MDV", mn: "MGL", kz: "KAZ",
  uz: "UZB", ir: "IRI", eg: "EGY", za: "RSA", ng: "NGR", ma: "MAR", dz: "ALG",
  mu: "MRI", ug: "UGA", gt: "GUA", sc: "SEY", cy: "CYP", mt: "MLT", gr: "GRE",
  ro: "ROU", si: "SLO", hr: "CRO", rs: "SRB", by: "BLR", ru: "RUS", sa: "KSA",
  ae: "UAE", qa: "QAT", kw: "KUW", jo: "JOR", lb: "LBN", tt: "TTO", jm: "JAM",
  sr: "SUR", bb: "BAR", do: "DOM", cu: "CUB", ec: "ECU", bo: "BOL", py: "PAR",
  uy: "URU", ar: "ARG", co: "COL", ve: "VEN", fj: "FIJ", lu: "LUX", mc: "MON",
  az: "AZE", ge: "GEO", am: "ARM", tm: "TKM", kg: "KGZ", bh: "BRN", om: "OMA",
  et: "ETH", ke: "KEN", tz: "TAN", gh: "GHA", ci: "CIV", cm: "CMR", zm: "ZAM",
  bw: "BOT", na: "NAM", mz: "MOZ", mg: "MAD", re: "REU", pf: "TAH", gu: "GUM",
};

const tokens = (s) => (s || "").split(" ").filter(Boolean);
const setOf = (s) => new Set(tokens(s));
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const sharedCount = (arr, set) => arr.filter((t) => set.has(t)).length;

/** Initiales d'un prénom : "Su Yu" -> ["s","y"], "H. S." -> ["h","s"]. */
export function initialsOf(firstName) {
  return tokens(normalizeLabel(firstName)).map((t) => t[0]);
}

/** Nom de tournoi BWF -> clé normalisée sans année. */
export function tournamentKeyFromBwfName(name) {
  return tokens(normalizeLabel(name)).filter((t) => !/^(19|20)\d{2}$/.test(t)).join(" ");
}

/**
 * La clé de tournoi oddsportal est-elle compatible avec le nom BWF ?
 *
 * On exige que tous les tokens oddsportal soient présents côté BWF (le nom BWF
 * porte en plus le sponsor et l'année), plus au moins un token discriminant.
 * Cela évite d'avoir à maintenir une liste de sponsors, et distingue bien
 * « Korea Masters » de « Korea Open ».
 */
export function tournamentsCompatible(opKey, bwfName) {
  const op = tokens(opKey);
  if (op.length === 0) return false;
  const bwf = setOf(tournamentKeyFromBwfName(bwfName));
  if (!op.every((t) => bwf.has(t))) return false;
  return op.some((t) => !GENERIC_TOKENS.has(t));
}

/**
 * Score de ressemblance entre un joueur BWF et un joueur affiché sur oddsportal.
 * @returns {number} score, ou -1 si les deux ne peuvent pas être la même personne.
 */
export function playerScore(bwfPlayer, opPlayer, opSlugTokens, opIso2) {
  const bLast = normalizeLabel(bwfPlayer.lastName || "");
  const bFirst = normalizeLabel(bwfPlayer.firstName || "");
  const bFull = `${bFirst} ${bLast}`.trim();
  const opSur = opPlayer.surname || "";
  if (!opSur) return -1;

  // 1) Nom de famille. oddsportal affiche parfois le nom complet sans initiales
  //    ("Lin Chun-Yi") : on le compare alors au nom complet BWF.
  const fullAsSurname = bFull && sameSet(setOf(opSur), setOf(bFull));
  let score;
  if (bLast && opSur === bLast) score = 50;
  else if (fullAsSurname) score = 55;
  else if (sharedCount(tokens(opSur), setOf(bLast)) > 0) score = 25;
  else return -1; // aucun token de nom de famille en commun

  // 2) Initiales du prénom : signal fort dans les deux sens.
  if (opPlayer.initials.length > 0) {
    const bi = initialsOf(bwfPlayer.firstName);
    const op = opPlayer.initials;
    if (bi.length > 0) {
      const ordered = op.every((c, i) => bi[i] === c);
      const asSet = op.every((c) => bi.includes(c));
      if (ordered || asSet) score += 25;
      else if (bi[0] === op[0] && bi.length < op.length) {
        // Le prénom BWF est parfois stocké non découpé ("LEE JONGMIN" → firstName
        // "JONGMIN", donc une seule initiale) alors qu'oddsportal affiche bien
        // "Lee J. M.". La première initiale concorde et BWF en a moins : ce n'est
        // pas une contradiction, seulement une information manquante → neutre.
        score += 0;
      } else score -= 60;
    }
  } else if (fullAsSurname) {
    score += 10;
  }

  // 3) Slug H2H. En simple il porte le nom complet, en double seulement les noms
  //    de famille — d'où un bonus dégradé plutôt que binaire.
  const bwfSlugTokens = tokens((bwfPlayer.slug || "").replaceAll("-", " "));
  if (bwfSlugTokens.length > 0 && opSlugTokens.size > 0) {
    const shared = sharedCount(bwfSlugTokens, opSlugTokens);
    score += shared === bwfSlugTokens.length ? 40 : Math.min(20, shared * 10);
  }

  // 4) Pays : confirmation seulement, et absent en double (pas de drapeau).
  const mapped = opIso2 ? ISO2_TO_BWF[opIso2.toLowerCase()] : null;
  if (mapped && bwfPlayer.countryCode) score += mapped === bwfPlayer.countryCode ? 15 : -25;

  return score;
}

/**
 * Score d'une équipe BWF face à un participant oddsportal.
 * @returns {number} score total, ou -1 si l'équipe ne correspond pas.
 */
export function teamScore(bwfTeam, opParticipant) {
  const bp = bwfTeam?.players || [];
  const op = opParticipant?.players || [];
  if (bp.length === 0 || bp.length !== op.length) return -1;
  const slugTokens = setOf(normalizeLabel((opParticipant.slug || "").replaceAll("-", " ")));
  const iso2 = opParticipant.iso2;

  if (bp.length === 1) {
    const s = playerScore(bp[0], op[0], slugTokens, iso2);
    return s >= MIN_PLAYER ? s : -1;
  }
  // Double : l'ordre des joueurs dans la paire n'est pas garanti, on teste les deux.
  const best = [
    [playerScore(bp[0], op[0], slugTokens, iso2), playerScore(bp[1], op[1], slugTokens, iso2)],
    [playerScore(bp[0], op[1], slugTokens, iso2), playerScore(bp[1], op[0], slugTokens, iso2)],
  ]
    .filter(([a, b]) => a >= MIN_PLAYER && b >= MIN_PLAYER)
    .map(([a, b]) => a + b);
  return best.length ? Math.max(...best) : -1;
}

/**
 * Apparie des lignes de cotes avec des matchs à venir BWF.
 *
 * @param {object[]} bwfCandidates matchs BWF (tournamentName, eventName, team1/team2
 *   avec players[{lastName, firstName, slug, countryCode}])
 * @param {object[]} oddsRows lignes produites par lib/odds.mjs
 * @returns {{matched, ambiguous, unmatchedOdds, noOdds, settled, unmatchedBwf, stats}}
 */
export function matchOdds(bwfCandidates, oddsRows) {
  const matched = [], ambiguous = [], unmatchedOdds = [], noOdds = [], settled = [];
  const usedBwf = new Set();

  for (const row of oddsRows) {
    // Un match déjà décidé n'est pas « à venir » : sa cote de clôture ne nous sert pas.
    if (row.settled) { settled.push(row); continue; }
    if (row.odd1 == null || row.odd2 == null) { noOdds.push(row); continue; }

    const pool = bwfCandidates.filter(
      (c) => c.eventName === row.discipline && tournamentsCompatible(row.tournamentKey, c.tournamentName)
    );

    // Pour chaque candidat, on retient la meilleure des deux orientations
    // (team1↔p1/p2), car l'ordre d'affichage oddsportal est arbitraire.
    const scored = [];
    for (const c of pool) {
      const direct = pair(teamScore(c.team1, row.p1), teamScore(c.team2, row.p2));
      const swapped = pair(teamScore(c.team1, row.p2), teamScore(c.team2, row.p1));
      if (direct == null && swapped == null) continue;
      if (swapped == null || (direct != null && direct >= swapped)) scored.push({ c, score: direct, swapped: false });
      else scored.push({ c, score: swapped, swapped: true });
    }
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) { unmatchedOdds.push(row); continue; }
    const margin = scored.length > 1 ? scored[0].score - scored[1].score : Infinity;
    if (margin < MIN_MARGIN) {
      ambiguous.push({ odds: row, candidates: scored.slice(0, 3).map((s) => ({ bwf: s.c, score: s.score })) });
      continue;
    }

    const { c, score, swapped } = scored[0];
    usedBwf.add(c);
    matched.push({
      bwf: c,
      odds: row,
      // Les cotes suivent l'ordre d'affichage oddsportal : on les réoriente vers
      // team1/team2 côté BWF.
      oddsTeam1: swapped ? row.odd2 : row.odd1,
      oddsTeam2: swapped ? row.odd1 : row.odd2,
      swapped,
      score,
      margin: margin === Infinity ? null : margin,
    });
  }

  const unmatchedBwf = bwfCandidates.filter((c) => !usedBwf.has(c));
  return {
    matched, ambiguous, unmatchedOdds, noOdds, settled, unmatchedBwf,
    stats: {
      oddsRows: oddsRows.length,
      matched: matched.length,
      ambiguous: ambiguous.length,
      unmatchedOdds: unmatchedOdds.length,
      noOdds: noOdds.length,
      settled: settled.length,
      bwfTotal: bwfCandidates.length,
      unmatchedBwf: unmatchedBwf.length,
      // Taux calculé sur les seules lignes réellement appariables.
      matchRate: rate(matched.length, matched.length + ambiguous.length + unmatchedOdds.length),
    },
  };
}

/** Somme de deux scores d'équipe, ou null si l'une des deux ne correspond pas. */
function pair(a, b) {
  return a < 0 || b < 0 ? null : a + b;
}

function rate(num, den) {
  return den === 0 ? null : Math.round((num / den) * 100);
}

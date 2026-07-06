// Types for the BWF draw/results endpoint.
// Derived and verified against raw.json (62 matches, 124 teams, 248 players).
//
// Notes on fields that are ALWAYS null in the sampled data — kept nullable so
// the types stay honest, but flagged in case the API populates them elsewhere:
//   Team.teamId / teamName / linkName, Player.countryName,
//   SetScore.lastPointWinner / serve, Match.matchOrder, MatchDetail.matchTypeNo,
//   and the nested `matches` array (always empty -> never[]).

/** Root payload returned by the endpoint. */
export interface BwfDrawResponse {
  /** Grid cells keyed by "row-col" (e.g. "0-0", "3-1"). Lightweight match form. */
  results: Record<string, { match: Match }>;
  /** Flat list of all matches. Richer form (see MatchDetail). */
  matches: MatchDetail[];
  /** Draw size, e.g. 16, 32. */
  drawsize: number;
  /** Null in the sample; likely a column index when present. */
  drawendcol: number | null;
  gameTypeId: number;
}

/** Fields shared by both match representations. */
interface MatchBase {
  code: string; // "269"
  scoreStatus: number; // 0
  scoreStatusValue: string; // "Normal"
  /** 1 = team1 won, 2 = team2 won. */
  winner: 1 | 2;
  team1: Team;
  team2: Team;
  /** Seed as a string ("1".."8"), or null if unseeded. */
  team1seed: string | null;
  team2seed: string | null;
  matchTime: string; // "2025-07-01 16:10:00" (local)
  matchTimeUtc: string; // "2025-07-01 20:10:00"
  matchStatus: string; // "F" (finished) in sample
  oopRound: string; // order-of-play round, "8"
  oopText: string; // "Followed by", "Starting at 4:10 PM", "Not before 5:30 PM"
  oopTypeId: number; // 0 | 1 | 2
  eventName: string; // "MD"
  roundName: string; // "R32" | "R16" | "QF" | "SF" | "Final"
  drawName: string; // "MD"
  courtName: string; // "Court 4"
  courtCode: string; // "4"
  courtIndex: number; // 3
  locationName: string; // "Markham Pan Am Centre"
  duration: number; // minutes
  matchOrder: number | null; // always null in sample
  matchTypeId: number; // 3
  matchTypeValue: string; // "Men's Doubles"
  reliability: number; // 0 | 1
  score: SetScore[];
  /** Sub-matches (team ties). Always empty here. */
  matches: never[];
}

/** Lightweight match — value of results["r-c"].match. */
export interface Match extends MatchBase {
  /** Numeric tournament id here (differs from MatchDetail). */
  tournamentCode: number; // 5254
}

/** Detailed match — element of the root `matches` array. */
export interface MatchDetail extends MatchBase {
  id: number; // 1441433
  /** GUID string here (differs from Match). */
  tournamentCode: string; // "9B0A466D-4601-4B6A-9FDE-60208870A5BC"
  tournamentName: string; // "YONEX Canada Open 2025"
  isTeamMatch: boolean;
  matchStatusValue: string; // "Finished"
  drawCode: string; // "8"
  time: string; // "00:29" (duration formatted)
  matchTypeNo: number | null; // always null in sample
}

export interface Team {
  /** null when the pair is mixed-nationality. */
  countryCode: string | null;
  countryFlagUrl: string | null;
  teamId: string | null; // always null in sample
  teamName: string | null; // always null in sample
  players: Player[];
  linkName: string | null; // always null in sample
}

export interface Player {
  id: string; // "57424"
  nameDisplay: string; // "Fang-Chih LEE"
  /** 0 = "First LAST" (western), 1 = "LAST First" (e.g. asian names). */
  nameType: 0 | 1;
  firstName: string;
  lastName: string;
  initials: string; // "FL"
  nameShort: string; // "F LEE"
  nameShort2: string; // "LEE"
  slug: string; // "fang-chih-lee"
  countryCode: string; // "TPE"
  countryName: string | null; // always null in sample
  countryFlagUrl: string;
  avatar: PlayerAvatar;
}

export interface PlayerAvatar {
  title: string; // "Fang-Chih LEE"
  /** May be a real photo or the ".../profile_male.jpg" placeholder. */
  thumbnailUrl: string;
}

export interface SetScore {
  set: number; // 1, 2, 3
  home: number; // team1 points
  away: number; // team2 points
  lastPointWinner: number | null; // always null in sample
  serve: number | null; // always null in sample
}

// ---------------------------------------------------------------------------
// Endpoint /api/vue-grouped-year-tournaments — calendrier annuel des tournois,
// groupés par mois.
// ---------------------------------------------------------------------------

/** Réponse racine de la liste annuelle des tournois. */
export interface YearTournamentsResponse {
  results: MonthGroup[];
  /** Nombre de tournois à venir. */
  remaining: number;
  /** Nombre de tournois terminés. */
  completed: number;
}

export interface MonthGroup {
  month: string; // "January"
  monthNo: number; // 1..12
  tournaments: Tournament[];
}

export interface Tournament {
  /** Dotation formatée ("1,450,000") ou null si non communiquée. */
  prize_money: string | null;
  start_date: string; // "2026-01-06 00:00:00"
  end_date: string; // "2026-01-11 00:00:00"
  name: string; // "PETRONAS Malaysia Open 2026"
  url: string; // page vitrine du tournoi
  /** Id numérique (= tmtId / tournamentCode de la forme légère). */
  id: number; // 5227
  /** GUID (= tournamentCode de la forme détaillée). */
  code: string; // "41287386-9043-4062-99C8-3FFBB9B26C1E"
  has_live_scores: boolean;
  date: string; // "06  - 11 Jan" (libellé d'affichage)
  location: string; // "Kuala Lumpur, Malaysia"
  country: string; // "Malaysia"
  flag_url: string;
  logo: string;
  cat_logo: string;
  category: string; // "HSBC BWF World Tour Super 1000"
  header_url_tpl: string; // contient le placeholder {transform}
  header_url: string;
  header_url_mobile: string;
  is_etihad: boolean;
  /** État temporel : "post" (passé), "future" (à venir), probablement "live". */
  live_status: string;
  status: TournamentStatus;
  month: string; // redondant avec MonthGroup.month
  monthNo: number;
  /** Rang global du tournoi dans l'année (1..N). */
  order: number;
}

export interface TournamentStatus {
  status: string; // "0", "101"
  code: string; // "normal" | "finished" | ...
  label: string; // "Normal" | "Finished" | ...
}

// ---------------------------------------------------------------------------
// Endpoint /api/vue-tournament-draws — liste des tableaux (disciplines) d'un
// tournoi. Chaque entrée donne le drawId à passer à vue-tournament-draw-data.
// ---------------------------------------------------------------------------

export interface TournamentDrawsResponse {
  results: DrawInfo[];
}

export interface DrawInfo {
  /** drawId à utiliser pour récupérer le tableau (chaîne). */
  value: string; // "8"
  text: string; // "MD", "MD - Qualification"
  /** 1 = tableau de qualification, 0 = tableau principal. */
  qualification: 0 | 1;
  type: number; // 0 (principal) | 5 (qualif)
  size: number; // 8, 16, 32
  slug: string; // "md", "md-qualification"
  doubles: boolean;
  stage_name: string; // "Main Draw" | "Qualifying"
  stage_type: number; // 1 (principal) | 2 (qualif)
  stage_order: number;
}

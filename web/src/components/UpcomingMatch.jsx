import { Link } from "react-router-dom";

// Carte d'un match à venir (affiche + Elo/rang/forme + proba + lien prédicteur).
// Partagée entre la page « Matchs à venir » et la vue « À suivre » d'un tournoi.
// `detailed` : ajoute l'en-tête score + les raisons (utilisé dans les tris).

export const ROUND_LABEL = {
  RR: "Poules", R128: "1/64", R64: "1/32", R32: "1/16", R16: "1/8",
  QF: "1/4", SF: "1/2", F: "Finale", Final: "Finale",
};

function TeamCell({ team, right }) {
  const players = team?.players || [];
  const flags = (
    <span className="um-flags">
      {players.map((p, i) => p.countryFlagUrl
        ? <img key={i} className="um-flag" src={p.countryFlagUrl} alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
        : <span key={i} className="um-flag" />)}
    </span>
  );
  const name = <span className="um-names">{players.map((p) => p.nameDisplay).join(" / ")}</span>;
  const seed = team?.seed ? <span className="um-seed">({team.seed})</span> : null;
  return <div className="um-team">{right ? <>{seed}{name}{flags}</> : <>{flags}{name}{seed}</>}</div>;
}

function FormTag({ v }) {
  if (v == null) return null;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return <span className={`form ${cls}`}>{v > 0 ? `▲ ${v}` : v < 0 ? `▼ ${-v}` : "→ 0"}</span>;
}

function SideStats({ team }) {
  if (team.elo == null) return <span className="um-stats muted">Non classé</span>;
  return (
    <span className="um-stats">
      <span className="um-elo">{team.elo}</span>
      {team.bwfRank ? <span className="um-rank">· #{team.bwfRank} mondial</span> : null}
      <FormTag v={team.form} />
    </span>
  );
}

const whyFor = (m) => (m.reasons?.length ? m.reasons : ["Notre Elo (forme récente) s'écarte du classement mondial"]);

export default function UpcomingMatch({ m, detailed }) {
  const pa = m.prob, pb = pa == null ? null : 100 - pa;
  const why = detailed ? whyFor(m) : [];
  return (
    <Link className="um-match" to={`/predictor?disc=${m.eventName}&a=${encodeURIComponent(m.a)}&b=${encodeURIComponent(m.b)}`}>
      {detailed && (
        <div className="um-dhead">
          <span className={`um-score ${m.score < 25 ? "low" : ""}`} title="Score d'intérêt (0–100)">{m.score}</span>
          <span className="um-dtmt">{m.tournamentName}</span>
        </div>
      )}
      <div className="um-row">
        <span className="um-round">
          <span className="um-round-r">{ROUND_LABEL[m.roundName] || m.roundName}</span>
          <span className="um-round-d">{m.eventName}</span>
        </span>
        <div className="um-side">
          <TeamCell team={m.team1} />
          <SideStats team={m.team1} />
        </div>
        {pa != null ? (
          <span className="um-prob">
            <b className={pa >= 50 ? "fav" : ""}>{pa}%</b>
            <span className="um-bar"><span className="um-fill" style={{ width: `${pa}%` }} /></span>
            <b className={pb > 50 ? "fav" : ""}>{pb}%</b>
          </span>
        ) : (
          <span className="um-prob muted">—</span>
        )}
        <div className="um-side um-side-r">
          <TeamCell team={m.team2} right />
          <SideStats team={m.team2} />
        </div>
        <span className="um-cta" aria-hidden="true">Analyser →</span>
      </div>
      {detailed && why.length > 0 && (
        <ul className="um-why">{why.map((r, i) => <li key={i}>{r}</li>)}</ul>
      )}
    </Link>
  );
}

import { Link } from "react-router-dom";
import { setsFor } from "../data.js";

// Noms d'une équipe, cliquables :
//   - simple (1 joueur)  -> fiche joueur  /player/:id
//   - double (2 joueurs) -> fiche paire   /pair/:id1-id2
// Utilisé partout où l'on affiche un match (bracket de tournoi, listes de matchs
// des fiches joueur & paire) : la logique de lien est centralisée ici.
function TeamNames({ players }) {
  if (!players || players.length === 0) return <>{" "}</>;
  if (players.length >= 2) {
    const key = players.map((p) => String(p.id)).sort().join("-");
    const label = players.map((p) => p.nameDisplay).join(" / ");
    return <Link className="mlink" to={`/pair/${key}`}>{label}</Link>;
  }
  const p = players[0];
  return <Link className="mlink" to={`/player/${p.id}`}>{p.nameDisplay}</Link>;
}

export default function MatchTeam({ match, side, seed }) {
  const team = match[side === 1 ? "team1" : "team2"];
  const isWin = match.winner === side;
  const players = team?.players ?? [];
  const flag = team?.countryFlagUrl || players[0]?.countryFlagUrl || "";
  return (
    <div className={`mteam ${isWin ? "win" : ""}`}>
      {flag
        ? <img className="mav" src={flag} alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
        : <span className="mav" />}
      <div className="mnames">
        <TeamNames players={players} />
        {seed ? <span className="mseed">({seed})</span> : null}
      </div>
      <div className="mscore">
        {isWin ? <span className="mdot" /> : null}
        {setsFor(match, side).map((s, i) => (
          <span key={i} className={`mset ${s.won ? "won" : ""}`}>{s.value}</span>
        ))}
      </div>
    </div>
  );
}

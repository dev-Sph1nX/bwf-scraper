import { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

function partner(m, id) {
  const team = m.side === "team1" ? m.team1 : m.team2;
  return (team.players || []).filter((p) => p.id !== id).map((p) => p.nameDisplay).join(" / ") || "—";
}
function opponents(m) {
  const opp = m.side === "team1" ? m.team2 : m.team1;
  return (opp.players || []).map((p) => p.nameDisplay).join(" / ");
}
function scoreFor(m) {
  const mine = m.side === "team1";
  return (m.score || []).map((s) => (mine ? `${s.home}-${s.away}` : `${s.away}-${s.home}`)).join(", ");
}

export default function Player() {
  const { id } = useParams();
  const { setTitle, setRight } = useOutletContext();
  const [data, setData] = useState(null);

  useEffect(() => {
    setRight(<Link className="tb-right" to="/players">← Tous les joueurs</Link>);
    return () => setRight(null);
  }, [setRight]);

  useEffect(() => {
    getJSON(`player/${id}.json`).then((d) => {
      setData(d);
      setTitle(d.player.nameDisplay);
    }).catch(() => setData(false));
  }, [id, setTitle]);

  if (data === false) return <div className="card muted">Joueur introuvable.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  const matches = [...data.matches].sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || ""));
  const wins = matches.filter((m) => m.won).length;

  return (
    <>
      <div className="card">
        <h2>{data.player.nameDisplay}</h2>
        <p className="muted">
          {data.player.countryCode || ""} · {matches.length} matchs ·{" "}
          <span className="win">{wins} V</span> / <span className="loss">{matches.length - wins} D</span>
        </p>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Tournoi</th><th>Épreuve</th><th>Tour</th><th>Partenaire</th><th>Adversaires</th><th>Score</th><th>Résultat</th></tr>
          </thead>
          <tbody>
            {matches.map((m, i) => (
              <tr key={i}>
                <td><Link to={`/tournament/${m.tmtId}`}>{m.tournamentName || m.tmtId}</Link></td>
                <td>{m.eventName}</td>
                <td>{m.roundName}</td>
                <td>{partner(m, id)}</td>
                <td>{opponents(m)}</td>
                <td>{scoreFor(m)}</td>
                <td className={m.won ? "win" : "loss"}>{m.won ? "Victoire" : "Défaite"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

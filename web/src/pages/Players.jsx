import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

export default function Players() {
  const { setTitle } = useOutletContext();
  const [all, setAll] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => { setTitle("Joueurs"); }, [setTitle]);
  useEffect(() => { getJSON("players.json").then((d) => setAll(d.players)).catch(() => setAll([])); }, []);

  const list = useMemo(
    () => (all ?? []).filter((p) => p.nameDisplay.toLowerCase().includes(q.toLowerCase())),
    [all, q]
  );

  return (
    <div className="card">
      <h2>Joueurs</h2>
      <input className="search" placeholder="Rechercher un joueur…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-scroll">
      <table>
        <thead><tr><th>Joueur</th><th>Pays</th><th>Matchs</th></tr></thead>
        <tbody>
          {!all ? (
            <tr><td colSpan="3" className="muted">Chargement…</td></tr>
          ) : list.length === 0 ? (
            <tr><td colSpan="3" className="muted">Aucun joueur.</td></tr>
          ) : list.map((p) => (
            <tr key={p.id}>
              <td><Link to={`/player/${p.id}`}>{p.nameDisplay}</Link></td>
              <td>{p.countryCode || "—"}</td>
              <td>{p.matchCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

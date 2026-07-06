import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

export default function Players() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [year, setYear] = useState(null); // null = toutes saisons

  useEffect(() => { setTitle("Joueurs"); }, [setTitle]);
  useEffect(() => { getJSON("players.json").then(setData).catch(() => setData({ years: [], players: [] })); }, []);

  const years = data?.years ?? [];
  const list = useMemo(() => {
    const t = q.toLowerCase();
    return (data?.players ?? [])
      .filter((p) => (!year || (p.years || []).includes(year)))
      .filter((p) => p.nameDisplay.toLowerCase().includes(t));
  }, [data, q, year]);

  return (
    <div className="card">
      <h2>Joueurs</h2>
      {years.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Saison">
          <button role="tab" aria-selected={year === null} className={`tab ${year === null ? "active" : ""}`} onClick={() => setYear(null)}>Toutes</button>
          {[...years].reverse().map((y) => (
            <button key={y} role="tab" aria-selected={y === year} className={`tab ${y === year ? "active" : ""}`} onClick={() => setYear(y)}>{y}</button>
          ))}
        </div>
      )}
      <input className="search" placeholder="Rechercher un joueur…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="table-scroll">
        <table>
          <thead><tr><th>Joueur</th><th>Pays</th><th>Matchs</th></tr></thead>
          <tbody>
            {!data ? (
              <tr><td colSpan="3" className="muted">Chargement…</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan="3" className="muted">Aucun joueur.</td></tr>
            ) : list.slice(0, 300).map((p) => (
              <tr key={p.id}>
                <td><Link to={`/player/${p.id}`}>{p.nameDisplay}</Link></td>
                <td>{p.countryCode || "—"}</td>
                <td>{p.matchCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && list.length > 300 && (
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          300 premiers affichés sur {list.length}. Affine avec la recherche.
        </p>
      )}
    </div>
  );
}

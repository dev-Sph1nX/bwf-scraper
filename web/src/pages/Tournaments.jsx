import { useEffect, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

export default function Tournaments() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);

  useEffect(() => { setTitle("Tournois"); }, [setTitle]);
  useEffect(() => { getJSON("status.json").then(setData).catch(() => setData({ tournaments: [] })); }, []);

  return (
    <div className="card">
      <h2>Tournois</h2>
      <table>
        <thead>
          <tr><th>Tournoi</th><th>Dates</th><th>Catégorie</th><th>État</th><th>Draws</th><th>Matchs</th></tr>
        </thead>
        <tbody>
          {!data ? (
            <tr><td colSpan="6" className="muted">Chargement…</td></tr>
          ) : data.tournaments.length === 0 ? (
            <tr><td colSpan="6" className="muted">Aucune donnée.</td></tr>
          ) : data.tournaments.map((t) => (
            <tr key={t.id}>
              <td>
                {t.flag_url && <img className="flag" src={t.flag_url} alt="" style={{ width: 18, height: 18, borderRadius: "50%", verticalAlign: "middle", marginRight: 6 }} onError={(e) => (e.target.style.display = "none")} />}
                <Link to={`/tournament/${t.id}`}>{t.name}</Link>
              </td>
              <td>{t.date}</td>
              <td>{t.category.replace("HSBC BWF World Tour ", "")}</td>
              <td><span className={`badge ${t.live_status}`}>{t.live_status}</span></td>
              <td>{t.drawCount}/{t.drawsTotal}</td>
              <td>{t.matchCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

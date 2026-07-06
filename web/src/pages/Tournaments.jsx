import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

export default function Tournaments() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [year, setYear] = useState(null);

  useEffect(() => { setTitle("Tournois"); }, [setTitle]);
  useEffect(() => {
    getJSON("status.json")
      .then((d) => { setData(d); setYear((d.years || [])[d.years.length - 1] ?? null); })
      .catch(() => setData({ years: [], tournaments: [] }));
  }, []);

  const years = data?.years ?? [];
  const rows = useMemo(
    () => (data?.tournaments ?? []).filter((t) => t.year === year),
    [data, year]
  );

  return (
    <>
      {years.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Saison">
          {[...years].reverse().map((y) => (
            <button key={y} role="tab" aria-selected={y === year}
              className={`tab ${y === year ? "active" : ""}`} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}
      <div className="card">
        <h2>Tournois {year ? <span className="muted" style={{ fontWeight: "normal" }}>· {year}</span> : null}</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Tournoi</th><th>Dates</th><th>Catégorie</th><th>État</th><th>Draws</th><th>Matchs</th></tr>
            </thead>
            <tbody>
              {!data ? (
                <tr><td colSpan="6" className="muted">Chargement…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan="6" className="muted">Aucune donnée.</td></tr>
              ) : rows.map((t) => (
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
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

export default function Dashboard() {
  const { setTitle } = useOutletContext();
  const [s, setS] = useState(null);

  useEffect(() => { setTitle("Tableau de bord"); }, [setTitle]);
  useEffect(() => { getJSON("summary.json").then(setS).catch(() => setS(false)); }, []);

  if (s === false) return <div className="card muted">Aucune donnée pour l'instant.</div>;
  if (!s) return <div className="card muted">Chargement…</div>;

  const last = s.lastUpdate
    ? new Date(s.lastUpdate).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })
    : "jamais";

  return (
    <>
      <div className="card">
        <h2>Données BWF {s.year}</h2>
        <p className="muted">Les données sont mises à jour automatiquement (GitHub Actions).</p>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-value">{s.tournamentsDownloaded}/{s.tournamentsTotal}</div><div className="stat-label">Tournois téléchargés</div></div>
        <div className="stat"><div className="stat-value">{s.matchCount}</div><div className="stat-label">Matchs</div></div>
        <div className="stat"><div className="stat-value">{s.playerCount}</div><div className="stat-label">Joueurs</div></div>
        <div className="stat"><div className="stat-value">{last}</div><div className="stat-label">Dernière mise à jour</div></div>
      </div>

      {s.downloadedList?.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <h2>Contenu téléchargé</h2>
          <p className="muted">{s.downloadedList.length} tournois en base.</p>
          <ul className="recap">
            {s.downloadedList.map((it) => (
              <li key={it.id}>
                <Link to={`/tournament/${it.id}`}>{it.name}</Link>
                <span className="draws"> — {it.drawCount} tableaux, {it.matchCount} matchs</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

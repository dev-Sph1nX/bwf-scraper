import { useEffect, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];
const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

// "2026-01-06 09:00:00" -> "6 janvier 2026"
function fmtDay(s) {
  if (!s) return "—";
  return new Date(s.replace(" ", "T")).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export default function Data() {
  const { setTitle } = useOutletContext();
  const [s, setS] = useState(null);        // null=chargement, false=erreur
  const [status, setStatus] = useState(null);

  useEffect(() => { setTitle("Données"); }, [setTitle]);
  useEffect(() => {
    getJSON("summary.json").then(setS).catch(() => setS(false));
    getJSON("status.json").then(setStatus).catch(() => setStatus(null));
  }, []);

  if (s === false) return <div className="card muted">Données indisponibles pour l'instant.</div>;
  if (!s) return <div className="card muted">Chargement…</div>;

  const disc = s.matchesByDiscipline || {};
  const maxDisc = Math.max(1, ...ORDER.map((c) => disc[c] || 0));

  // Couverture par catégorie de tournoi (à partir de status.json)
  const cats = {};
  for (const t of status?.tournaments || []) {
    const c = (t.category || "").replace("HSBC BWF World Tour ", "") || "Autre";
    cats[c] ??= { total: 0, downloaded: 0 };
    cats[c].total++;
    if (t.matchCount > 0) cats[c].downloaded++;
  }

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="stat-value">{s.matchCount.toLocaleString("fr-FR")}</div><div className="stat-label">Matchs</div></div>
        <div className="stat"><div className="stat-value">{s.tournamentsDownloaded}/{s.tournamentsTotal}</div><div className="stat-label">Tournois récupérés</div></div>
        <div className="stat"><div className="stat-value">{s.playerCount.toLocaleString("fr-FR")}</div><div className="stat-label">Joueurs</div></div>
        <div className="stat"><div className="stat-value">5</div><div className="stat-label">Disciplines</div></div>
      </div>

      <div className="card">
        <h2>Période couverte</h2>
        <p className="lead">
          Du <b>{fmtDay(s.firstMatch)}</b> au <b>{fmtDay(s.lastMatch)}</b> — saison {s.year}.
        </p>
        <p className="lead">
          Dernière mise à jour : <b>{fmtDateTime(s.lastUpdate)}</b>. Rafraîchissement automatique toutes les 6 h.
        </p>
      </div>

      <div className="card">
        <h2>Matchs par discipline</h2>
        <div className="bars">
          {ORDER.map((code) => {
            const n = disc[code] || 0;
            return (
              <div className="bar-row" key={code}>
                <span className="bar-label">{DISC_LABEL[code]}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.round((n / maxDisc) * 100)}%` }} />
                </span>
                <span className="bar-val">{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Couverture par catégorie</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Catégorie</th><th style={{ textAlign: "center" }}>Récupérés</th></tr></thead>
            <tbody>
              {Object.keys(cats).length === 0 ? (
                <tr><td colSpan="2" className="muted">—</td></tr>
              ) : Object.entries(cats).map(([c, v]) => (
                <tr key={c}><td>{c}</td><td className="lb-num">{v.downloaded}/{v.total}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Tournois en base ({s.downloadedList?.length || 0})</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Tournoi</th><th style={{ textAlign: "center" }}>Tableaux</th><th style={{ textAlign: "center" }}>Matchs</th></tr></thead>
            <tbody>
              {(s.downloadedList || []).map((it) => (
                <tr key={it.id}>
                  <td><Link to={`/tournament/${it.id}`}>{it.name}</Link></td>
                  <td className="lb-num">{it.drawCount}</td>
                  <td className="lb-num">{it.matchCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

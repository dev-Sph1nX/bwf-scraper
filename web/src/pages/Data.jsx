import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];
const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

function fmtDay(s) {
  if (!s) return "—";
  return new Date(s.replace(" ", "T")).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}h${p(d.getMinutes())}`;
}
const nf = (n) => (n ?? 0).toLocaleString("fr-FR");

export default function Data() {
  const { setTitle } = useOutletContext();
  const [s, setS] = useState(null);

  useEffect(() => { setTitle("Données"); }, [setTitle]);
  useEffect(() => { getJSON("summary.json").then(setS).catch(() => setS(false)); }, []);

  if (s === false) return <div className="card muted">Données indisponibles pour l'instant.</div>;
  if (!s) return <div className="card muted">Chargement…</div>;

  const disc = s.matchesByDiscipline || {};
  const maxDisc = Math.max(1, ...ORDER.map((c) => disc[c] || 0));
  const byYear = [...(s.byYear || [])].sort((a, b) => b.year - a.year);

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="stat-value">{nf(s.matchCount)}</div><div className="stat-label">Matchs</div></div>
        <div className="stat"><div className="stat-value">{nf(s.playerCount)}</div><div className="stat-label">Joueurs</div></div>
        <div className="stat"><div className="stat-value">{s.tournamentsDownloaded}</div><div className="stat-label">Tournois</div></div>
        <div className="stat"><div className="stat-value">{(s.years || []).length}</div><div className="stat-label">Saisons</div></div>
      </div>

      <div className="card">
        <h2>Période couverte</h2>
        <p className="lead">
          Saisons <b>{(s.years || []).join(", ")}</b> — du <b>{fmtDay(s.firstMatch)}</b> au <b>{fmtDay(s.lastMatch)}</b>.
        </p>
        <p className="lead">
          Dernière mise à jour : <b>{fmtDateTime(s.lastUpdate)}</b> (auto une fois par jour).
          {s.worldRanking?.fetchedAt && <> Classement mondial BWF : <b>{fmtDateTime(s.worldRanking.fetchedAt)}</b>.</>}
        </p>
      </div>

      <div className="card">
        <h2>Par saison</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Saison</th><th style={{ textAlign: "center" }}>Tournois</th><th style={{ textAlign: "center" }}>Matchs</th></tr></thead>
            <tbody>
              {byYear.map((y) => (
                <tr key={y.year}><td>{y.year}</td><td className="lb-num">{y.tournaments}</td><td className="lb-num">{nf(y.matchCount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Matchs par discipline</h2>
        <div className="bars">
          {ORDER.map((code) => {
            const n = disc[code] || 0;
            return (
              <div className="bar-row" key={code}>
                <span className="bar-label">{DISC_LABEL[code]}</span>
                <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.round((n / maxDisc) * 100)}%` }} /></span>
                <span className="bar-val">{nf(n)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

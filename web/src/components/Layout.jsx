import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { YEAR, getJSON } from "../data.js";

// Prochaine mise à jour = prochain 22:00 UTC (cron "0 22 * * *" ≈ minuit à Paris), 1×/jour.
function nextCronSlot(from) {
  const d = new Date(from);
  d.setUTCHours(22, 0, 0, 0);
  while (d <= from) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const p2 = (n) => String(n).padStart(2, "0");
const fmt = (d) =>
  `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}h${p2(d.getMinutes())}`;

export default function Layout() {
  const [title, setTitle] = useState("");
  const [right, setRight] = useState(null);
  const [last, setLast] = useState(undefined); // undefined = en cours, null = inconnu

  useEffect(() => {
    getJSON("summary.json")
      .then((s) => setLast(s.lastUpdate ? new Date(s.lastUpdate) : null))
      .catch(() => setLast(null));
  }, []);

  const next = last ? nextCronSlot(last > new Date() ? last : new Date()) : null;

  const updates = (
    <span className="tb-updates" title="Les données sont rafraîchies toutes les 6 h">
      {last === undefined ? (
        <span className="u-item muted">Chargement…</span>
      ) : last === null ? (
        <span className="u-item muted">Année <b>{YEAR}</b></span>
      ) : (
        <>
          <span className="u-item">Données mise à jour le <b>{fmt(last)}</b></span>
          <span className="u-sep">·</span>
          <span className="u-item"><span className="u-k">Prochaine</span> {fmt(next)}</span>
        </>
      )}
    </span>
  );

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🏸 <span>BWF Elo</span></div>
        <nav>
          <NavLink to="/" end>Accueil</NavLink>
          <NavLink to="/tournaments">Tournois</NavLink>
          <NavLink to="/classement">Classement</NavLink>
          <NavLink to="/rentabilite">Rentabilité</NavLink>
          <NavLink to="/plus-over">Plus/Over</NavLink>
          <NavLink to="/gymnases">Gymnases</NavLink>
          <NavLink to="/coulisses" className="nav-coulisses">Coulisses</NavLink>
          {/* Sur mobile le pied de sidebar est masqué : le lien Santé remonte dans la barre. */}
          <NavLink to="/sante" className="nav-sante">Santé</NavLink>
        </nav>
        <div className="side-foot">
          Saison <b>{YEAR}</b>
          <NavLink to="/sante" className="foot-link">Santé des données</NavLink>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <h1 className="page-title">{title}</h1>
          <div className="spacer"></div>
          <span className="tb-right">{right ?? updates}</span>
        </header>
        <main>
          <Outlet context={{ setTitle, setRight }} />
        </main>
      </div>
    </div>
  );
}

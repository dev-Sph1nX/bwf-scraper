import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { YEAR } from "../data.js";

export default function Layout() {
  const [title, setTitle] = useState("");
  const [right, setRight] = useState(null);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">🏸 <span>BWF Scraper</span></div>
        <nav>
          <NavLink to="/" end>Tableau de bord</NavLink>
          <NavLink to="/tournaments">Tournois</NavLink>
          <NavLink to="/players">Joueurs</NavLink>
        </nav>
        <div className="side-foot">Année <b>{YEAR}</b></div>
      </aside>

      <div className="content">
        <header className="topbar">
          <h1 className="page-title">{title}</h1>
          <div className="spacer"></div>
          <span className="tb-right">{right ?? <>Année <b>{YEAR}</b></>}</span>
        </header>
        <main>
          <Outlet context={{ setTitle, setRight }} />
        </main>
      </div>
    </div>
  );
}

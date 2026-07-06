import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];

// Avatars : 1 en simple, 2 (superposés) en double. Repli sur le drapeau, puis masqué.
function Avatars({ players }) {
  return (
    <span className="avatars">
      {players.map((p) => (
        <img
          key={p.id}
          className="av"
          src={p.avatar || p.flag || ""}
          alt=""
          onError={(e) => {
            if (p.flag && e.target.src !== p.flag) e.target.src = p.flag;
            else e.target.style.visibility = "hidden";
          }}
        />
      ))}
    </span>
  );
}

function Form({ value }) {
  const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const label = value > 0 ? `▲ +${value}` : value < 0 ? `▼ ${Math.abs(value)}` : "→ 0";
  return <span className={`form ${cls}`} title="Variation d'Elo sur les 5 derniers matchs">{label}</span>;
}

export default function Dashboard() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null); // null=chargement, false=erreur
  const [disc, setDisc] = useState("MS");
  const [hideProv, setHideProv] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => { setTitle("Classement Elo"); }, [setTitle]);
  useEffect(() => { getJSON("elo/ranking.json").then(setData).catch(() => setData(false)); }, []);

  // Fermeture du menu Filtres au clic extérieur / touche Échap
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [menuOpen]);

  const d = data && data.disciplines ? data.disciplines[disc] : null;
  const rows = useMemo(() => {
    const all = d?.entities ?? [];
    return (hideProv ? all.filter((e) => !e.provisional) : all);
  }, [d, hideProv]);

  return (
    <>
      {data === false ? (
        <div className="card muted">Classement indisponible pour l'instant.</div>
      ) : !data ? (
        <div className="card muted">Chargement du classement…</div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Disciplines">
            {ORDER.map((code) => (
              <button
                key={code}
                role="tab"
                aria-selected={code === disc}
                className={`tab ${code === disc ? "active" : ""}`}
                onClick={() => setDisc(code)}
              >
                {data.disciplines[code]?.label ?? code}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="lb-head">
              <span className="muted lb-count">
                {rows.length} {d?.type === "pair" ? "paires" : "joueurs"}
              </span>
              <div className="filters" ref={menuRef}>
                <button
                  type="button"
                  className={`filter-btn ${hideProv ? "on" : ""}`}
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  Filtres <span aria-hidden="true">▾</span>
                </button>
                {menuOpen && (
                  <div className="menu" role="menu">
                    <label className="prov-toggle">
                      <input type="checkbox" checked={hideProv} onChange={(e) => setHideProv(e.target.checked)} />
                      Masquer les provisoires (&lt; 5 matchs)
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="table-scroll">
              <table className="lb-table">
                <thead>
                  <tr>
                    <th className="lb-rank">#</th>
                    <th>{d?.type === "pair" ? "Paire" : "Joueur"}</th>
                    <th style={{ textAlign: "right" }}>Elo</th>
                    <th style={{ textAlign: "center" }}>Forme</th>
                    <th style={{ textAlign: "center" }}>Mondial</th>
                    <th style={{ textAlign: "center" }}>Matchs</th>
                    <th style={{ textAlign: "center" }}>V–D</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan="7" className="muted">Aucune donnée.</td></tr>
                  ) : rows.map((e, i) => (
                    <tr key={e.key}>
                      <td className={`lb-rank ${i < 3 ? "top" : ""}`}>{i + 1}</td>
                      <td>
                        <span className="lb-entity">
                          <Avatars players={e.players} />
                          <span className="lb-name">
                            <span className="nm">
                              {e.type === "player" && e.players[0]?.slug
                                ? <Link to={`/player/${e.players[0].id}`}>{e.name}</Link>
                                : e.name}
                              {e.provisional && <span className="tag-prov">prov.</span>}
                            </span>
                            <span className="sub">{e.country || "—"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="lb-rating">{e.rating}</td>
                      <td style={{ textAlign: "center" }}><Form value={e.form} /></td>
                      <td className="lb-num">{e.bwfRank ? `#${e.bwfRank}` : "—"}</td>
                      <td className="lb-num">{e.matches}</td>
                      <td className="lb-num">{e.wins}–{e.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

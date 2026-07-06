import { useEffect, useMemo, useState } from "react";
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
  const [sort, setSort] = useState("elo");
  const [q, setQ] = useState("");

  useEffect(() => { setTitle("Classement Elo"); }, [setTitle]);
  useEffect(() => { getJSON("elo/ranking.json").then(setData).catch(() => setData(false)); }, []);

  const searching = q.trim().length > 0;
  const ql = q.trim().toLowerCase();
  // Une discipline a des résultats si au moins une entité (non provisoire, sauf en recherche) matche.
  const matchIn = (code) =>
    (data?.disciplines?.[code]?.entities ?? []).some(
      (e) => (searching || !e.provisional) && (!ql || e.name.toLowerCase().includes(ql))
    );
  const shownDiscs = data?.disciplines ? (searching ? ORDER.filter(matchIn) : ORDER) : ORDER;
  const activeDisc = shownDiscs.includes(disc) ? disc : (shownDiscs[0] ?? disc);
  const d = data?.disciplines?.[activeDisc] ?? null;
  const rows = useMemo(() => {
    let list = (d?.entities ?? []).filter((e) => searching || !e.provisional);
    if (ql) list = list.filter((e) => e.name.toLowerCase().includes(ql));
    list = [...list];
    if (sort === "world") list.sort((a, b) => (a.bwfRank ?? Infinity) - (b.bwfRank ?? Infinity));
    else if (sort === "form") list.sort((a, b) => b.form - a.form);
    else list.sort((a, b) => b.rating - a.rating);
    return list;
  }, [d, ql, searching, sort]);

  return (
    <>
      {data === false ? (
        <div className="card muted">Classement indisponible pour l'instant.</div>
      ) : !data ? (
        <div className="card muted">Chargement du classement…</div>
      ) : (
        <>
          {shownDiscs.length > 0 && (
            <div className="tabs" role="tablist" aria-label="Disciplines">
              {shownDiscs.map((code) => (
                <button
                  key={code}
                  role="tab"
                  aria-selected={code === activeDisc}
                  className={`tab ${code === activeDisc ? "active" : ""}`}
                  onClick={() => setDisc(code)}
                >
                  {data.disciplines[code]?.label ?? code}
                </button>
              ))}
            </div>
          )}

          <div className="card">
            <input
              className="search"
              placeholder={d?.type === "pair" ? "Rechercher une paire…" : "Rechercher un joueur…"}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="lb-head">
              <span className="muted lb-count">
                {rows.length} {d?.type === "pair" ? "paires" : "joueurs"}
              </span>
              <div className="lb-sort">
                <span className="lb-sort-label">Trier :</span>
                {[["elo", "Elo"], ["world", "Mondial"], ["form", "Forme"]].map(([k, lbl]) => (
                  <button key={k} className={`range-btn ${sort === k ? "active" : ""}`} onClick={() => setSort(k)}>{lbl}</button>
                ))}
              </div>
            </div>

            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
              <b>Forme</b> = variation de la cote Elo sur les 5 derniers matchs (▲ en hausse · ▼ en baisse).
            </p>
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

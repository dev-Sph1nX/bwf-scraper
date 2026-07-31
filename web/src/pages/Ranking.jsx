// web/src/pages/Ranking.jsx — Classement enrichi (remplace Dashboard) : sous-cotation
// BWF (rang mondial vs rang Elo) + tri par progression, à côté du tri par Elo.
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

// Variation chiffrée générique (forme, sous-cotation) : vert en hausse, neutre sinon.
function Signed({ value, title }) {
  if (value == null) return <span className="muted">—</span>;
  const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const label = value > 0 ? `+${value}` : `${value}`;
  return <span className={`form ${cls}`} title={title}>{label}</span>;
}

function fiche(e) {
  return e.type === "pair"
    ? `/pair/${e.players.map((p) => p.id).sort().join("-")}`
    : `/player/${e.players[0].id}`;
}

export default function Ranking() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null); // null=chargement, false=erreur
  const [disc, setDisc] = useState("MS");
  const [sort, setSort] = useState("elo"); // "elo" | "progression"
  const [includeProvisional, setIncludeProvisional] = useState(false);

  useEffect(() => { setTitle("Classement"); }, [setTitle]);
  useEffect(() => { getJSON("elo/ranking.json").then(setData).catch(() => setData(false)); }, []);

  const d = data?.disciplines?.[disc] ?? null;

  const rows = useMemo(() => {
    let list = (d?.entities ?? []).filter((e) => includeProvisional || !e.provisional);
    list = [...list];
    if (sort === "progression") {
      list.sort((a, b) => {
        if (a.form == null && b.form == null) return 0;
        if (a.form == null) return 1;
        if (b.form == null) return -1;
        return b.form - a.form;
      });
    } else {
      list.sort((a, b) => a.rank - b.rank);
    }
    return list;
  }, [d, sort, includeProvisional]);

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
            <div className="lb-search-row">
              <div className="lb-sort">
                <span className="lb-sort-label">Trier :</span>
                <button
                  type="button"
                  className={`range-btn ${sort === "elo" ? "active" : ""}`}
                  aria-pressed={sort === "elo"}
                  onClick={() => setSort("elo")}
                >
                  Par Elo
                </button>
                <button
                  type="button"
                  className={`range-btn ${sort === "progression" ? "active" : ""}`}
                  aria-pressed={sort === "progression"}
                  onClick={() => setSort("progression")}
                >
                  Par progression
                </button>
              </div>
              <button
                type="button"
                className={`range-btn ${includeProvisional ? "active" : ""}`}
                aria-pressed={includeProvisional}
                onClick={() => setIncludeProvisional((v) => !v)}
              >
                {includeProvisional ? "✓ " : ""}Inclure les Elo provisoires
              </button>
            </div>

            <div className="table-scroll">
              <table className="lb-table">
                <thead>
                  <tr>
                    <th className="lb-rank">#</th>
                    <th>{d?.type === "pair" ? "Paire" : "Joueur"}</th>
                    <th style={{ textAlign: "right" }}>Elo</th>
                    <th style={{ textAlign: "center" }}>Mondial</th>
                    <th style={{ textAlign: "center" }}>Sous-coté BWF</th>
                    <th style={{ textAlign: "center" }}>Progression</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan="6" className="muted">Aucune donnée.</td></tr>
                  ) : rows.map((e, i) => {
                    const souscote = e.bwfRank != null ? e.bwfRank - e.rank : null;
                    return (
                      <tr key={e.key}>
                        <td className={`lb-rank ${i < 3 ? "top" : ""}`}>{i + 1}</td>
                        <td>
                          <span className="lb-entity">
                            <Avatars players={e.players} />
                            <span className="lb-name">
                              <span className={`nm ${e.players.length > 1 ? "stacked" : ""}`}>
                                {e.type === "pair" ? (
                                  <Link to={fiche(e)}>
                                    {e.players.map((p) => <span key={p.id} className="pl">{p.name}</span>)}
                                  </Link>
                                ) : (
                                  e.players.map((p) => (
                                    <Link key={p.id} to={fiche(e)}>{p.name}</Link>
                                  ))
                                )}
                                {e.provisional && <span className="tag-prov">prov.</span>}
                              </span>
                              <span className="sub">{e.country || "—"}</span>
                            </span>
                          </span>
                        </td>
                        <td className="lb-rating">{e.rating}</td>
                        <td className="lb-num">{e.bwfRank ? `#${e.bwfRank}` : "—"}</td>
                        <td style={{ textAlign: "center" }}>
                          <Signed value={souscote} title="Rang mondial BWF moins rang Elo : positif = le classement mondial sous-estime le joueur" />
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <Signed value={e.form} title="Variation d'Elo sur les 5 derniers matchs" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="hint">
              La progression (variation d'Elo sur les 5 derniers matchs) est un outil de découverte, pas un pronostic : mesurée, elle ne prédit pas le vainqueur (journal §2.1).
            </p>
          </div>
        </>
      )}
    </>
  );
}

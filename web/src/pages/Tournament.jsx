import { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";
import Bracket from "../components/Bracket.jsx";

export default function Tournament() {
  const { id } = useParams();
  const { setTitle, setRight } = useOutletContext();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    setRight(<Link className="tb-right" to="/tournaments">← Tous les tournois</Link>);
    return () => setRight(null);
  }, [setRight]);

  useEffect(() => {
    getJSON(`tournament/${id}.json`).then((d) => {
      setData(d);
      setTitle(d.info?.name || "Tournoi");
      const withData = d.disciplines.filter((x) => x.matchCount > 0);
      const def = withData.find((x) => x.stage === "Main Draw") || withData[0];
      setSel(def?.drawId ?? null);
    }).catch(() => setData(false));
  }, [id, setTitle]);

  if (data === false) return <div className="card muted">Tournoi introuvable.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  const withData = data.disciplines.filter((x) => x.matchCount > 0);
  const disc = withData.find((x) => x.drawId === sel);

  return (
    <>
      {data.info && (
        <div className="card">
          <h2>{data.info.name}</h2>
          <p className="muted">
            {data.info.date} · {data.info.location} · {data.info.category}
            {data.info.prize_money ? ` · $${data.info.prize_money}` : ""}
          </p>
        </div>
      )}

      {withData.length === 0 ? (
        <div className="card muted">Aucun match téléchargé pour ce tournoi.</div>
      ) : (
        <>
          <div className="tabs">
            {withData.map((d) => (
              <button key={d.drawId} className={`tab ${d.drawId === sel ? "active" : ""}`} onClick={() => setSel(d.drawId)}>
                {d.label}
              </button>
            ))}
          </div>
          {disc && <Bracket disc={disc} />}
        </>
      )}
    </>
  );
}

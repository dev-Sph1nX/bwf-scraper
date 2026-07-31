// web/src/pages/Home.jsx — « Sur quoi parier aujourd'hui ? »
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";
import BetCard from "../components/BetCard.jsx";
import UpcomingMatch from "../components/UpcomingMatch.jsx";

const BOOKS = ["betclic", "unibet", "winamax"];
const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const lireSelection = () => {
  try {
    const v = JSON.parse(localStorage.getItem("books-selected"));
    if (!Array.isArray(v) || !v.length) return BOOKS;
    const f = v.filter((b) => BOOKS.includes(b));
    return f.length ? f : BOOKS; // stockage corrompu/périmé (valeurs hors BOOKS) -> jamais 0 sélection
  } catch { return BOOKS; }
};

export default function Home() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(lireSelection);

  useEffect(() => { setTitle("Sur quoi parier aujourd'hui ?"); }, [setTitle]);
  useEffect(() => { getJSON("upcoming-matches.json").then(setData).catch(() => setData(false)); }, []);
  useEffect(() => { localStorage.setItem("books-selected", JSON.stringify(selected)); }, [selected]);

  const toggle = (b) => setSelected((s) => (s.includes(b) ? (s.length > 1 ? s.filter((x) => x !== b) : s) : [...s, b]));

  const { cotes, autres } = useMemo(() => {
    const ms = data?.matches || [];
    // Tri par heure du premier relevé de cote faute d'heure BWF (absente sur
    // 91 % des matchs) ; quand `matchTime` existera côté BWF, il primera ici.
    const heure = (m) => m.odds?.books && Object.values(m.odds.books)[0]?.points?.[0]?.at || m.startDate || "";
    const cotes = ms.filter((m) => m.odds).sort((a, b) => String(heure(a)).localeCompare(String(heure(b))));
    const autres = ms.filter((m) => !m.odds);
    return { cotes, autres };
  }, [data]);

  if (data === false) return <div className="card muted">Données indisponibles. Lance <code>npm run build-data</code>.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  return (
    <>
      <div className="tabs">
        {BOOKS.map((b) => (
          <button key={b} type="button" className={`tab${selected.includes(b) ? " active" : ""}`}
                  aria-pressed={selected.includes(b)} onClick={() => toggle(b)}>
            {BOOK_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="card">
        <h2>Matchs cotés — {cotes.length}</h2>
        {cotes.length === 0
          ? <p className="muted">Aucun match coté pour l'instant — prochain relevé dans moins de 2 h.</p>
          : cotes.map((m) => <BetCard key={`${m.tmtId}|${m.a}|${m.b}`} match={m} selectedBooks={selected} />)}
      </div>

      {autres.length > 0 && (
        <details className="card">
          <summary><h2 style={{ display: "inline" }}>Autres matchs à venir — {autres.length}</h2></summary>
          {autres.map((m, i) => <UpcomingMatch key={i} m={m} />)}
        </details>
      )}
    </>
  );
}

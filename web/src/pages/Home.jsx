// web/src/pages/Home.jsx — « Sur quoi parier aujourd'hui ? »
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";
import BetCard from "../components/BetCard.jsx";

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
  const [filtre, setFiltre] = useState("tous"); // tous | cote | sans

  useEffect(() => { setTitle("Sur quoi parier aujourd'hui ?"); }, [setTitle]);
  useEffect(() => { getJSON("upcoming-matches.json").then(setData).catch(() => setData(false)); }, []);
  useEffect(() => { localStorage.setItem("books-selected", JSON.stringify(selected)); }, [selected]);

  const toggle = (b) => setSelected((s) => (s.includes(b) ? (s.length > 1 ? s.filter((x) => x !== b) : s) : [...s, b]));

  const matchs = useMemo(() => {
    const ms = data?.matches || [];
    // Ordre horaire : l'heure de départ vient des bookmakers (odds.startUtc),
    // le flux BWF ne la donnant presque jamais. À défaut : heure du premier
    // relevé de cote. Les matchs SANS heure connue passent après, triés par
    // date de tournoi (leur startDate, souvent déjà entamé, ne dit rien de
    // l'heure réelle du match).
    const heure = (m) => m.odds?.startUtc
      || (m.odds?.books && Object.values(m.odds.books)[0]?.points?.[0]?.at)
      || null;
    const ts = (v) => (v ? Date.parse(String(v).replace(" ", "T")) : NaN);
    return [...ms].sort((a, b) => {
      const ha = ts(heure(a)), hb = ts(heure(b));
      if (!Number.isNaN(ha) && !Number.isNaN(hb)) return ha - hb;
      if (!Number.isNaN(ha)) return -1;
      if (!Number.isNaN(hb)) return 1;
      return (ts(a.startDate) || 0) - (ts(b.startDate) || 0);
    });
  }, [data]);

  if (data === false) return <div className="card muted">Données indisponibles. Lance <code>npm run build-data</code>.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  const nbCote = matchs.filter((m) => m.odds).length;
  const visibles = matchs.filter((m) =>
    filtre === "tous" ? true : filtre === "cote" ? !!m.odds : !m.odds);

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
        <h2>À venir — {visibles.length}</h2>
        <div className="tabs">
          {[["tous", `Tous (${matchs.length})`], ["cote", `Avec cote (${nbCote})`], ["sans", `Sans cote (${matchs.length - nbCote})`]].map(([k, lbl]) => (
            <button key={k} type="button" className={`tab${filtre === k ? " active" : ""}`}
                    aria-pressed={filtre === k} onClick={() => setFiltre(k)}>
              {lbl}
            </button>
          ))}
        </div>
        {visibles.length === 0
          ? <p className="muted">Aucun match dans ce filtre pour l'instant.</p>
          : visibles.map((m, i) => <BetCard key={`${m.tmtId}|${m.a ?? i}|${m.b ?? ""}`} match={m} selectedBooks={selected} />)}
      </div>
    </>
  );
}

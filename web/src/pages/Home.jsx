// web/src/pages/Home.jsx — « Sur quoi parier aujourd'hui ? »
import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";
import BetCard from "../components/BetCard.jsx";

const BOOKS = ["betclic", "unibet", "winamax"];
const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const DISC_ORDER = ["MS", "WS", "MD", "WD", "XD"];
const lireSelection = () => {
  try {
    const v = JSON.parse(localStorage.getItem("books-selected"));
    if (!Array.isArray(v) || !v.length) return BOOKS;
    const f = v.filter((b) => BOOKS.includes(b));
    return f.length ? f : BOOKS; // stockage corrompu/périmé (valeurs hors BOOKS) -> jamais 0 sélection
  } catch { return BOOKS; }
};

// Menu ⋮ « préférences d'affichage » : quels opérateurs afficher sur les cartes.
// Fermé au clic extérieur et à Échap.
function MenuPreferences({ selected, toggle }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!ouvert) return;
    const clic = (e) => { if (ref.current && !ref.current.contains(e.target)) setOuvert(false); };
    const touche = (e) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", clic);
    document.addEventListener("keydown", touche);
    return () => { document.removeEventListener("mousedown", clic); document.removeEventListener("keydown", touche); };
  }, [ouvert]);

  return (
    <div className="kebab-wrap" ref={ref}>
      <button type="button" className="kebab-btn" aria-haspopup="true" aria-expanded={ouvert}
              aria-label="Préférences d'affichage" title="Préférences d'affichage"
              onClick={() => setOuvert(!ouvert)}>
        ⋮
      </button>
      {ouvert && (
        <div className="kebab-menu">
          <div className="kebab-title">Opérateurs affichés</div>
          {BOOKS.map((b) => (
            <label className="prov-toggle kebab-item" key={b}>
              <input type="checkbox" checked={selected.includes(b)} onChange={() => toggle(b)} />
              {BOOK_LABEL[b]}
            </label>
          ))}
          <p className="kebab-hint">Au moins un opérateur reste affiché ; la meilleure cote et l'EV se comparent entre eux.</p>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(lireSelection);
  const [filtre, setFiltre] = useState("tous"); // tous | cote | sans
  const [tmt, setTmt] = useState("tous");       // "tous" | tmtId (string)
  const [disc, setDisc] = useState("tous");     // "tous" | MS | WS | MD | WD | XD

  useEffect(() => { setTitle("Sur quoi parier aujourd'hui ?"); }, [setTitle]);
  useEffect(() => { getJSON("upcoming-matches.json").then(setData).catch(() => setData(false)); }, []);
  useEffect(() => { localStorage.setItem("books-selected", JSON.stringify(selected)); }, [selected]);

  const toggle = (b) => setSelected((s) => (s.includes(b) ? (s.length > 1 ? s.filter((x) => x !== b) : s) : [...s, b]));

  const matchs = useMemo(() => {
    const ms = data?.matches || [];
    // Ordre horaire : d'abord l'heure officielle du planning BWF (matchTimeUtc,
    // propagée par build-data), sinon l'heure de départ relevée chez les
    // bookmakers (odds.startUtc), à défaut l'heure du premier relevé de cote.
    // Les matchs SANS heure connue passent après, triés par date de tournoi
    // (leur startDate, souvent déjà entamé, ne dit rien de l'heure réelle du match).
    const heure = (m) => m.matchTimeUtc
      || m.odds?.startUtc
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

  // Filtres en cascade : tournoi → discipline → avec/sans cote.
  const tournois = [];
  for (const m of matchs) {
    const t = tournois.find((x) => x.id === String(m.tmtId));
    if (t) t.n++;
    else tournois.push({ id: String(m.tmtId), nom: m.tournamentName, n: 1 });
  }
  const parTmt = matchs.filter((m) => tmt === "tous" || String(m.tmtId) === tmt);
  // Tableaux (mêmes libellés que les onglets de la page tournoi : la
  // qualification est un tableau à part entière). Repli sur la discipline
  // pour un build antérieur à drawName.
  const nomTableau = (m) => m.drawName || m.eventName;
  const tableaux = [];
  for (const m of parTmt) {
    const key = nomTableau(m);
    const t = tableaux.find((x) => x.key === key);
    if (t) t.n++;
    else tableaux.push({ key, eventName: m.eventName, n: 1 });
  }
  tableaux.sort((a, b) =>
    DISC_ORDER.indexOf(a.eventName) - DISC_ORDER.indexOf(b.eventName)
    || b.key.length - a.key.length); // « … - Qualification » avant le tableau final
  const parDisc = parTmt.filter((m) => disc === "tous" || nomTableau(m) === disc);
  const nbCote = parDisc.filter((m) => m.odds).length;
  const visibles = parDisc.filter((m) =>
    filtre === "tous" ? true : filtre === "cote" ? !!m.odds : !m.odds);

  return (
    <div className="card">
      <div className="home-head">
        <h2>À venir — {visibles.length}</h2>
        <MenuPreferences selected={selected} toggle={toggle} />
      </div>
      {tournois.length > 1 && (
        <div className="tabs">
          <button type="button" className={`tab${tmt === "tous" ? " active" : ""}`}
                  aria-pressed={tmt === "tous"} onClick={() => { setTmt("tous"); setDisc("tous"); }}>
            Tous les tournois ({matchs.length})
          </button>
          {tournois.map((t) => (
            <button key={t.id} type="button" className={`tab${tmt === t.id ? " active" : ""}`}
                    aria-pressed={tmt === t.id} onClick={() => { setTmt(t.id); setDisc("tous"); }}>
              {t.nom} ({t.n})
            </button>
          ))}
        </div>
      )}
      {tableaux.length > 1 && (
        <div className="tabs">
          <button type="button" className={`tab${disc === "tous" ? " active" : ""}`}
                  aria-pressed={disc === "tous"} onClick={() => setDisc("tous")}>
            Tous les tableaux ({parTmt.length})
          </button>
          {tableaux.map((t) => (
            <button key={t.key} type="button" className={`tab${disc === t.key ? " active" : ""}`}
                    aria-pressed={disc === t.key} onClick={() => setDisc(t.key)}>
              {t.key} · {t.n}
            </button>
          ))}
        </div>
      )}
      <div className="tabs">
        {[["tous", `Tous (${parDisc.length})`], ["cote", `Avec cote (${nbCote})`], ["sans", `Sans cote (${parDisc.length - nbCote})`]].map(([k, lbl]) => (
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
  );
}

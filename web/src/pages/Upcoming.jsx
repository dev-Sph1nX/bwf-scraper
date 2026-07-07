import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";
import UpcomingMatch from "../components/UpcomingMatch.jsx";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];
const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

// Tris "intérêt" : chacun a un libellé, une explication et un filtre/tri.
const MODES = {
  all: { label: "Tous les matchs" },
  surveiller: {
    label: "⚡ À surveiller",
    explain: "Contre-pronostic : notre cote Elo (forme récente) donne une vraie chance (≥ 45 %) à un joueur nettement moins bien classé au mondial (écart ≥ 10 places), avec un Elo fiable. Autrement dit, là où le classement — et souvent les cotes — sous-estiment potentiellement le joueur. Trié par score d'intérêt.",
    filter: (m) => m.tags.includes("value"),
    sort: (a, b) => b.score - a.score,
  },
  bogey: {
    label: "Bête noire",
    explain: "Un joueur moins bien classé qui domine les confrontations directes face à son adversaire mieux classé — un mauvais client pour lui, indépendamment de l'écart de niveau. (Au moins 2 confrontations, et notre Elo lui donne ≥ 40 %.)",
    filter: (m) => m.tags.includes("bogey"),
    sort: (a, b) => b.score - a.score,
  },
};

const parseDate = (s) => (s ? new Date(s.replace(" ", "T")).getTime() : null);

export default function Upcoming() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [disc, setDisc] = useState("all");
  const [mode, setMode] = useState("all");

  useEffect(() => { setTitle("Matchs à venir"); }, [setTitle]);
  useEffect(() => {
    getJSON("upcoming-matches.json").then(setData).catch(() => setData({ matches: [] }));
  }, []);

  const matches = data?.matches ?? [];
  const discsPresent = useMemo(() => ORDER.filter((c) => matches.some((m) => m.eventName === c)), [matches]);
  const discCounts = useMemo(() => {
    const c = { all: matches.length };
    for (const d of ORDER) c[d] = matches.filter((m) => m.eventName === d).length;
    return c;
  }, [matches]);
  const byDisc = useMemo(() => (disc === "all" ? matches : matches.filter((m) => m.eventName === disc)), [matches, disc]);

  // Vue normale : regroupée par tournoi (ordonnée par date de début).
  const groups = useMemo(() => {
    const byT = new Map();
    for (const m of byDisc) {
      let g = byT.get(m.tmtId);
      if (!g) { g = { tmtId: m.tmtId, name: m.tournamentName, date: m.date, year: m.year, flag_url: m.flag_url, startDate: m.startDate, live_status: m.live_status, items: [] }; byT.set(m.tmtId, g); }
      g.items.push(m);
    }
    const arr = [...byT.values()];
    for (const g of arr) g.items.sort((a, b) => ORDER.indexOf(a.eventName) - ORDER.indexOf(b.eventName) || (a.roundName || "").localeCompare(b.roundName || ""));
    arr.sort((a, b) => (parseDate(a.startDate) ?? Infinity) - (parseDate(b.startDate) ?? Infinity));
    return arr;
  }, [byDisc]);

  // Compteurs par mode (selon la discipline sélectionnée) pour les chips de tri.
  const modeCounts = useMemo(() => ({
    all: byDisc.length,
    surveiller: byDisc.filter(MODES.surveiller.filter).length,
    bogey: byDisc.filter(MODES.bogey.filter).length,
  }), [byDisc]);

  // Vue triée (mode ≠ all) : liste à plat filtrée + triée.
  const ranked = useMemo(() => {
    if (mode === "all") return [];
    const cfg = MODES[mode];
    return byDisc.filter(cfg.filter).sort(cfg.sort);
  }, [byDisc, mode]);

  if (!data) return <div className="card muted">Chargement…</div>;

  return (
    <>
      <div className="card">
        <h2>Matchs à venir</h2>
        <p className="lead">
          Les affiches publiées par la BWF pour les tournois qui arrivent. Clique sur un match pour
          l'analyser dans le <b>prédicteur</b>, ou trie par intérêt pour repérer les matchs à valeur.
        </p>
      </div>

      {matches.length === 0 ? (
        <div className="card muted">Aucun match à venir publié pour le moment. Les tableaux paraissent quelques jours avant chaque tournoi.</div>
      ) : (
        <>
          {discsPresent.length > 0 && (
            <div className="tabs" role="tablist" aria-label="Discipline">
              <button role="tab" aria-selected={disc === "all"} className={`tab ${disc === "all" ? "active" : ""}`} onClick={() => setDisc("all")}>Toutes disciplines · {discCounts.all}</button>
              {discsPresent.map((c) => (
                <button key={c} role="tab" aria-selected={disc === c} className={`tab ${disc === c ? "active" : ""}`} onClick={() => setDisc(c)}>{DISC_LABEL[c]} · {discCounts[c]}</button>
              ))}
            </div>
          )}

          <div className="tabs" role="tablist" aria-label="Tri par intérêt">
            {Object.entries(MODES).map(([k, v]) => (
              <button key={k} role="tab" aria-selected={mode === k} className={`tab ${mode === k ? "active" : ""}`} onClick={() => setMode(k)}>{v.label} · {modeCounts[k] ?? 0}</button>
            ))}
          </div>

          {mode === "all" ? (
            groups.length === 0 ? (
              <div className="card muted">Aucun match dans cette discipline.</div>
            ) : groups.map((g) => (
              <div className="card" key={g.tmtId}>
                <div className="um-thead">
                  {g.flag_url && <img className="um-tflag" src={g.flag_url} alt="" onError={(e) => (e.target.style.display = "none")} />}
                  <div className="um-tinfo">
                    <Link className="um-tname" to={`/tournament/${g.tmtId}`}>{g.name}</Link>
                    <div className="um-tmeta">
                      {g.date}{g.year ? ` ${g.year}` : ""}
                      <span className="um-count">· {g.items.length} match{g.items.length > 1 ? "s" : ""}</span>
                      {g.live_status === "live" && <span className="badge live" style={{ marginLeft: 8 }}>En cours</span>}
                    </div>
                  </div>
                </div>
                <div className="um-list">
                  {g.items.map((m, i) => <UpcomingMatch key={i} m={m} />)}
                </div>
              </div>
            ))
          ) : (
            <>
              <div className="card">
                <div className="um-explain-title">{MODES[mode].label}</div>
                <p className="lead" style={{ marginTop: 6 }}>{MODES[mode].explain}</p>
              </div>
              {ranked.length === 0 ? (
                <div className="card muted">Aucun match ne correspond dans cette sélection.</div>
              ) : (
                <div className="um-list">
                  {ranked.map((m, i) => <UpcomingMatch key={i} m={m} detailed />)}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

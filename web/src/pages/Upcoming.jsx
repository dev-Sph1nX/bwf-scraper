import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];
const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};
const ROUND_LABEL = {
  RR: "Poules", R128: "1/64", R64: "1/32", R32: "1/16", R16: "1/8",
  QF: "1/4", SF: "1/2", F: "Finale", Final: "Finale",
};

// Tris "intérêt" : chacun a un libellé, une explication et un filtre/tri.
const MODES = {
  all: { label: "Tous les matchs" },
  surveiller: {
    label: "⚡ À surveiller",
    explain: "Trié par score d'intérêt. Le score mesure l'écart entre notre cote Elo (forme récente) et le classement mondial (le consensus), pondéré par la fiabilité de notre Elo — puis majoré si les confrontations directes contredisent le favori, si la dynamique de forme est opposée, ou si un joueur est sous-coté (bien mieux classé à l'Elo qu'au mondial). Plus le score est élevé, plus notre modèle diverge du consensus : c'est là qu'il y a potentiellement de la valeur.",
    filter: (m) => m.tags.includes("upset") || m.score >= 25,
    sort: (a, b) => b.score - a.score,
  },
  close: {
    label: "Serrés",
    explain: "Les matchs à l'issue la plus incertaine selon notre Elo : probabilité proche de 50/50. À pile ou face.",
    filter: (m) => m.tags.includes("close"),
    sort: (a, b) => Math.abs((a.prob ?? 50) - 50) - Math.abs((b.prob ?? 50) - 50),
  },
  clash: {
    label: "Chocs",
    explain: "Affiches entre deux joueurs/paires du top 16 mondial — souvent dès les premiers tours.",
    filter: (m) => m.tags.includes("clash"),
    sort: (a, b) => ((a.team1.bwfRank || 99) + (a.team2.bwfRank || 99)) - ((b.team1.bwfRank || 99) + (b.team2.bwfRank || 99)),
  },
};

function TeamCell({ team, right }) {
  const players = team?.players || [];
  const flags = (
    <span className="um-flags">
      {players.map((p, i) => p.countryFlagUrl
        ? <img key={i} className="um-flag" src={p.countryFlagUrl} alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
        : <span key={i} className="um-flag" />)}
    </span>
  );
  const name = <span className="um-names">{players.map((p) => p.nameDisplay).join(" / ")}</span>;
  const seed = team?.seed ? <span className="um-seed">({team.seed})</span> : null;
  return <div className="um-team">{right ? <>{seed}{name}{flags}</> : <>{flags}{name}{seed}</>}</div>;
}

function FormTag({ v }) {
  if (v == null) return null;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "flat";
  return <span className={`form ${cls}`}>{v > 0 ? `▲ ${v}` : v < 0 ? `▼ ${-v}` : "→ 0"}</span>;
}

function SideStats({ team }) {
  if (team.elo == null) return <span className="um-stats muted">Non classé</span>;
  return (
    <span className="um-stats">
      <span className="um-elo">{team.elo}</span>
      {team.bwfRank ? <span className="um-rank">· #{team.bwfRank} mondial</span> : null}
      <FormTag v={team.form} />
    </span>
  );
}

// Raisons affichées : celles calculées au build, sinon un repli selon le mode.
function whyFor(m, mode) {
  if (m.reasons?.length) return m.reasons;
  const pa = m.prob, pb = pa == null ? null : 100 - pa;
  if (mode === "close" && pa != null) return [`Issue très incertaine : ${pa}% / ${pb}% selon l'Elo`];
  if (mode === "clash") return [`Deux du top mondial : #${m.team1.bwfRank} vs #${m.team2.bwfRank}`];
  return [];
}

function MatchRow({ m, detailed, mode }) {
  const pa = m.prob, pb = pa == null ? null : 100 - pa;
  const why = detailed ? whyFor(m, mode) : [];
  return (
    <Link className="um-match" to={`/predictor?disc=${m.eventName}&a=${encodeURIComponent(m.a)}&b=${encodeURIComponent(m.b)}`}>
      {detailed && (
        <div className="um-dhead">
          <span className={`um-score ${m.score < 25 ? "low" : ""}`} title="Score d'intérêt (0–100)">{m.score}</span>
          <span className="um-dtmt">{m.tournamentName}</span>
        </div>
      )}
      <div className="um-row">
        <span className="um-round">
          <span className="um-round-r">{ROUND_LABEL[m.roundName] || m.roundName}</span>
          <span className="um-round-d">{m.eventName}</span>
        </span>
        <div className="um-side">
          <TeamCell team={m.team1} />
          <SideStats team={m.team1} />
        </div>
        {pa != null ? (
          <span className="um-prob">
            <b className={pa >= 50 ? "fav" : ""}>{pa}%</b>
            <span className="um-bar"><span className="um-fill" style={{ width: `${pa}%` }} /></span>
            <b className={pb > 50 ? "fav" : ""}>{pb}%</b>
          </span>
        ) : (
          <span className="um-prob muted">—</span>
        )}
        <div className="um-side um-side-r">
          <TeamCell team={m.team2} right />
          <SideStats team={m.team2} />
        </div>
        <span className="um-cta" aria-hidden="true">Analyser →</span>
      </div>
      {detailed && why.length > 0 && (
        <ul className="um-why">{why.map((r, i) => <li key={i}>{r}</li>)}</ul>
      )}
    </Link>
  );
}

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
  const modeCounts = useMemo(() => {
    const c = { all: byDisc.length };
    for (const k of ["surveiller", "close", "clash"]) c[k] = byDisc.filter(MODES[k].filter).length;
    return c;
  }, [byDisc]);

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
                  {g.items.map((m, i) => <MatchRow key={i} m={m} />)}
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
                  {ranked.map((m, i) => <MatchRow key={i} m={m} detailed mode={mode} />)}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";
import EloChart from "../components/EloChart.jsx";
import MatchTeam from "../components/MatchTeam.jsx";

const fmtPts = (n) => (n != null ? Math.round(n).toLocaleString("fr-FR") + " pts" : "");
function cmpNote(eloRank, bwfRank) {
  const diff = bwfRank - eloRank;
  if (diff > 0) return `Notre Elo place la paire ${diff} rang${diff > 1 ? "s" : ""} plus haut que le classement officiel — forme sous-estimée par le mondial.`;
  if (diff < 0) return `Notre Elo place la paire ${-diff} rang${-diff > 1 ? "s" : ""} plus bas — le classement officiel la sur-évalue (forme récente en retrait).`;
  return "Alignée avec le classement mondial officiel.";
}

const RANGES = [
  { k: "3m", label: "3 mois", months: 3 },
  { k: "6m", label: "6 mois", months: 6 },
  { k: "1y", label: "1 an", months: 12 },
  { k: "all", label: "Tout", months: null },
];
function rangeCutoff(k, lastT) {
  const r = RANGES.find((x) => x.k === k);
  if (!r || r.months == null || !lastT) return null;
  const d = new Date(lastT.replace(" ", "T"));
  d.setMonth(d.getMonth() - r.months);
  return d;
}

function fmtMatchDate(s) {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const ROUND_LABEL = {
  F: "Finaliste", Final: "Finaliste", SF: "1/2 finale", QF: "1/4 de finale",
  R16: "1/8 de finale", R32: "1/16 de finale", R64: "1/32 de finale", R128: "1/64 de finale", RR: "Poules",
};
function tournamentResult(matches) {
  const last = [...matches].sort((a, b) => (b.matchTime || "").localeCompare(a.matchTime || ""))[0];
  if (!last) return "—";
  const isFinal = last.roundName === "F" || last.roundName === "Final";
  if (last.won && isFinal) return "🏆 Vainqueur";
  return ROUND_LABEL[last.roundName] || last.roundName || "—";
}

const oppSide = (m) => (m.side === "team1" ? "team2" : "team1");
function opponents(m) {
  return (m[oppSide(m)]?.players || []).map((p) => p.nameDisplay).join(" / ");
}
function oppPairKey(m) {
  return (m[oppSide(m)]?.players || []).map((p) => String(p.id)).sort().join("-");
}

// Sélecteur de paire adverse déjà affrontée (combobox)
function OpponentPicker({ list, value, onChange }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return list.filter((o) => !t || o.name.toLowerCase().includes(t)).slice(0, 40);
  }, [list, q]);

  if (value) {
    return (
      <div className="chosen">
        <span className="grow"><span className="nm">{value.name}</span><span className="sub muted"> · {value.count} confrontation{value.count > 1 ? "s" : ""}</span></span>
        <button className="clear" aria-label="Changer d'adversaire" onClick={() => { onChange(null); setQ(""); }}>×</button>
      </div>
    );
  }
  return (
    <div className="combobox">
      <input type="text" value={q} placeholder="Choisir une paire déjà affrontée…" aria-label="Paire adverse"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} />
      {open && (
        <div className="cb-list" role="listbox">
          {matches.length === 0 ? <div className="cb-empty">Aucune paire</div> :
            matches.map((o) => (
              <button key={o.id} type="button" role="option" aria-selected="false" className="cb-item"
                onMouseDown={(ev) => ev.preventDefault()} onClick={() => { onChange(o); setOpen(false); }}>
                <span>{o.name}</span><span className="cb-rt">{o.count}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// Avatar d'un joueur de la paire, repli drapeau puis masqué.
function PlayerAvatar({ p }) {
  return (
    <img className="phead-av" src={p.avatar || p.flag || ""} alt=""
      onError={(e) => { if (p.flag && e.target.src !== p.flag) e.target.src = p.flag; else e.target.style.visibility = "hidden"; }} />
  );
}

export default function Pair() {
  const { key } = useParams();
  const { setTitle, setRight } = useOutletContext();
  const [data, setData] = useState(null);
  const [opp, setOpp] = useState(null);
  const [range, setRange] = useState("3m");
  const [openTmts, setOpenTmts] = useState(() => new Set());
  const [tmtQuery, setTmtQuery] = useState("");
  const toggleTmt = (id) => setOpenTmts((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [highlight, setHighlight] = useState(null);
  const goToMatch = (pt) => {
    if (!pt?.tmtId) return;
    setTmtQuery("");
    setOpenTmts((s) => new Set(s).add(pt.tmtId));
    setHighlight(`${pt.tmtId}|${pt.t}|${pt.disc}`);
  };

  useEffect(() => {
    setRight(<Link className="tb-right" to="/classement">← Classement</Link>);
    return () => setRight(null);
  }, [setRight]);

  useEffect(() => {
    setOpp(null);
    getJSON(`pair/${key}.json`)
      .then((d) => { setData(d); setTitle(d.players.map((p) => p.name).join(" / ")); })
      .catch(() => setData(false));
  }, [key, setTitle]);


  useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector(`[data-mkey="${highlight}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [highlight]);

  const matches = useMemo(
    () => (data && data !== false ? [...data.matchList].sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || "")) : []),
    [data]
  );

  // Paires adverses déjà affrontées (avec nombre de confrontations)
  const opponentsList = useMemo(() => {
    const map = new Map();
    for (const m of matches) {
      const k = oppPairKey(m);
      if (!k) continue;
      const e = map.get(k) || { id: k, name: opponents(m), count: 0 };
      e.count++; map.set(k, e);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [matches]);

  const h2h = useMemo(() => {
    if (!opp) return null;
    const list = matches.filter((m) => oppPairKey(m) === opp.id)
      .sort((a, b) => (b.matchTime || "").localeCompare(a.matchTime || ""));
    const w = list.filter((m) => m.won).length;
    return { list, w, l: list.length - w };
  }, [opp, matches]);

  if (data === false) return <div className="card muted">Paire introuvable.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  const wins = matches.filter((m) => m.won).length;
  const rate = matches.length ? Math.round((wins / matches.length) * 100) : 0;

  // Historique Elo de la paire, filtré par la temporalité choisie
  const allElo = data.elo || [];
  const lastElo = allElo[allElo.length - 1];
  const cutoff = rangeCutoff(range, lastElo?.t);
  const eloPoints = allElo.filter((pt) => !(cutoff && pt.t && new Date(pt.t.replace(" ", "T")) < cutoff));

  // Δelo par match
  const eloByMatch = new Map();
  for (const pt of allElo) eloByMatch.set(`${pt.tmtId}|${pt.t}|${pt.disc}`, pt.d);

  // Matchs groupés par tournoi (récents d'abord)
  const groups = {};
  for (const m of matches) {
    const g = groups[m.tmtId] ??= { tmtId: m.tmtId, name: m.tournamentName || m.tmtId, year: m.year, matches: [], last: "" };
    g.matches.push(m);
    if ((m.matchTime || "") > g.last) g.last = m.matchTime || "";
  }
  const grouped = Object.values(groups).sort((a, b) => b.last.localeCompare(a.last));

  return (
    <>
      <div className="card">
        <div className="phead">
          <div className="phead-avs">
            {data.players.map((p) => <PlayerAvatar key={p.id} p={p} />)}
          </div>
          <div className="phead-info">
            <h2>
              {data.players.map((p, i) => (
                <span key={p.id}>
                  {i > 0 ? <span className="phead-sep"> / </span> : ""}
                  <Link to={`/player/${p.id}`}>{p.name}</Link>
                </span>
              ))}
            </h2>
            <div className="phead-meta">
              <span>{data.country || "—"} · {data.discLabel}</span>
              <span>{matches.length} matchs · <span className="win">{wins} V</span> / <span className="loss">{matches.length - wins} D</span> · {rate}%</span>
            </div>
          </div>
          <div className="phead-elo">
            <div className="v">{data.rating}</div>
            <div className="l">Cote Elo de la paire</div>
          </div>
        </div>
      </div>

      {Array.isArray(data.upcoming) && data.upcoming.length > 0 && (
        <div className="card">
          <h2>Prochains matchs</h2>
          <div className="up-mini-list">
            {data.upcoming.map((m, i) => {
              const opp = m.side === "team1" ? m.team2 : m.team1;
              const idOf = (t) => { const ids = (t.players || []).map((p) => String(p.id)).sort(); return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0]; };
              const oppName = (opp.players || []).map((p) => p.nameDisplay).join(" / ") || "—";
              return (
                <Link className="up-mini" key={i} to={`/predictor?disc=${m.eventName}&a=${encodeURIComponent(data.key)}&b=${encodeURIComponent(idOf(opp))}`}>
                  <span className="up-mini-main">
                    <span className="up-mini-vs">vs {oppName}</span>
                    <span className="up-mini-sub">{m.tournamentName} · {ROUND_LABEL[m.roundName] || m.roundName}</span>
                  </span>
                  <span className="um-cta" aria-hidden="true">Analyser →</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {allElo.length > 0 && (
        <div className="card">
          <h2>Évolution de la cote</h2>
          <div className="chart-ranges" role="tablist" aria-label="Période">
            {RANGES.map((r) => (
              <button key={r.k} role="tab" aria-selected={r.k === range}
                className={`range-btn ${r.k === range ? "active" : ""}`} onClick={() => setRange(r.k)}>
                {r.label}
              </button>
            ))}
          </div>
          {eloPoints.length === 0 ? (
            <p className="muted">Aucun match sur cette période.</p>
          ) : (
            <EloChart points={eloPoints} label={data.discLabel} onPointClick={goToMatch} />
          )}
        </div>
      )}

      {data.bwfRank != null && (
        <div className="card">
          <h2>Elo vs classement mondial BWF</h2>
          <p className="lead">
            Le classement mondial officiel repose sur les 6 meilleures perfs (inertie). Notre Elo
            reflète la forme du moment. L'écart entre les deux est le signal intéressant pour parier.
          </p>
          <div className="cmp">
            <div className="cmp-cols">
              <div className="cmp-col">
                <div className="cmp-k">Notre Elo</div>
                <div className="cmp-rank">#{data.rank}</div>
                <div className="cmp-sub">{data.rating} pts · {data.matches} matchs</div>
              </div>
              <div className="cmp-vs">vs</div>
              <div className="cmp-col">
                <div className="cmp-k">Mondial BWF</div>
                <div className="cmp-rank">#{data.bwfRank}</div>
                <div className="cmp-sub">{data.bwfPoints ? fmtPts(data.bwfPoints) : "hors classement"}</div>
              </div>
            </div>
            <div className="cmp-note">{cmpNote(data.rank, data.bwfRank)}</div>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Tête-à-tête</h2>
        <p className="lead">Choisis une paire déjà affrontée, puis ouvre le comparatif complet dans le prédicteur (probabilités, forme, confrontations directes).</p>
        <OpponentPicker list={opponentsList} value={opp} onChange={setOpp} />
        {h2h && (
          h2h.list.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Aucune confrontation trouvée.</p>
          ) : (
            <div className="h2h-cta">
              <div className="h2h-cta-sum">
                <span className="big"><span className="win">{h2h.w}</span> – <span className="loss">{h2h.l}</span></span>
                <span className="muted">face à {opp.name} · {h2h.list.length} confrontation{h2h.list.length > 1 ? "s" : ""}</span>
              </div>
              <Link className="primary" to={`/predictor?disc=${data.disc}&a=${encodeURIComponent(data.key)}&b=${encodeURIComponent("pair:" + opp.id)}`}>
                Comparer dans le prédicteur →
              </Link>
            </div>
          )
        )}
      </div>

      <div className="card">
        <h2>Derniers tournois</h2>
        <input className="search" placeholder="Rechercher un tournoi…" value={tmtQuery} onChange={(e) => setTmtQuery(e.target.value)} />
        {grouped.filter((g) => g.name.toLowerCase().includes(tmtQuery.toLowerCase())).map((g) => {
          let totalDelta = 0, hasDelta = false;
          for (const m of g.matches) {
            const d = eloByMatch.get(`${m.tmtId}|${m.matchTime}|${m.eventName}`);
            if (typeof d === "number") { totalDelta += d; hasDelta = true; }
          }
          const open = openTmts.has(g.tmtId);
          const cls = totalDelta > 0 ? "up" : totalDelta < 0 ? "down" : "flat";
          return (
            <div className={`tsum ${open ? "open" : ""}`} key={g.tmtId}>
              <button className="tsum-head" aria-expanded={open} onClick={() => toggleTmt(g.tmtId)}>
                <span className="tsum-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
                <span className="tsum-main">
                  <span className="tsum-name">{g.name}{g.year ? <span className="muted"> · {g.year}</span> : null}</span>
                  <span className="tsum-sub">
                    {fmtMatchDate(g.matches[0]?.matchTime)} · {tournamentResult(g.matches)} · {g.matches.length} match{g.matches.length > 1 ? "s" : ""}
                  </span>
                </span>
                {hasDelta && (
                  <span className={`tsum-elo form ${cls}`}>
                    {totalDelta > 0 ? `▲ +${totalDelta}` : totalDelta < 0 ? `▼ ${Math.abs(totalDelta)}` : "→ 0"}
                  </span>
                )}
              </button>
              {open && (
                <div className="tsum-body">
                  <div className="match-list">
                    {g.matches.map((m, i) => {
                      const mkey = `${m.tmtId}|${m.matchTime}|${m.eventName}`;
                      const delta = eloByMatch.get(mkey);
                      return (
                        <div className={`match-item ${highlight === mkey ? "flash" : ""}`} data-mkey={mkey} key={i}>
                          <div className="match-meta">
                            <span className="match-ev">{m.eventName} · {m.roundName}</span>
                            <span className="match-date">{fmtMatchDate(m.matchTime)}</span>
                            {typeof delta === "number" ? (
                              <span className={`form ${delta > 0 ? "up" : delta < 0 ? "down" : "flat"}`}>
                                {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${Math.abs(delta)}` : "→ 0"} Elo
                              </span>
                            ) : <span className="muted">—</span>}
                          </div>
                          <div className="mcard mcard-flow">
                            <MatchTeam match={m} side={1} />
                            <MatchTeam match={m} side={2} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Link className="tsum-link" to={`/tournament/${g.tmtId}`}>Voir le bracket →</Link>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

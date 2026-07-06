import { useEffect, useMemo, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";
import EloChart from "../components/EloChart.jsx";

const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

const fmtPts = (n) => (n != null ? Math.round(n).toLocaleString("fr-FR") + " pts" : "");
function cmpNote(eloRank, bwfRank) {
  const diff = bwfRank - eloRank;
  if (diff > 0) return `Notre Elo le place ${diff} rang${diff > 1 ? "s" : ""} plus haut que le classement officiel — bonne forme sous-estimée par le mondial.`;
  if (diff < 0) return `Notre Elo le place ${-diff} rang${-diff > 1 ? "s" : ""} plus bas — le classement officiel le sur-évalue (forme récente en retrait).`;
  return "Aligné avec le classement mondial officiel.";
}

const oppSide = (m) => (m.side === "team1" ? "team2" : "team1");
function partner(m, id) {
  const team = m.side === "team1" ? m.team1 : m.team2;
  return (team.players || []).filter((p) => String(p.id) !== String(id)).map((p) => p.nameDisplay).join(" / ") || "—";
}
function opponents(m) {
  return (m[oppSide(m)]?.players || []).map((p) => p.nameDisplay).join(" / ");
}
function scoreFor(m) {
  const mine = m.side === "team1";
  return (m.score || []).map((s) => (mine ? `${s.home}-${s.away}` : `${s.away}-${s.home}`)).join(", ");
}
function findMeta(matches, id) {
  for (const m of matches) {
    for (const side of ["team1", "team2"]) {
      const pl = (m[side]?.players || []).find((p) => String(p.id) === String(id));
      if (pl) return { avatar: pl.avatar?.thumbnailUrl, flag: pl.countryFlagUrl };
    }
  }
  return {};
}

// Petit sélecteur d'adversaire (combobox)
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
      <input type="text" value={q} placeholder="Choisir un adversaire déjà affronté…" aria-label="Adversaire"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} />
      {open && (
        <div className="cb-list" role="listbox">
          {matches.length === 0 ? <div className="cb-empty">Aucun adversaire</div> :
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

export default function Player() {
  const { id } = useParams();
  const { setTitle, setRight } = useOutletContext();
  const [data, setData] = useState(null);
  const [opp, setOpp] = useState(null);

  useEffect(() => {
    setRight(<Link className="tb-right" to="/players">← Tous les joueurs</Link>);
    return () => setRight(null);
  }, [setRight]);

  useEffect(() => {
    setOpp(null);
    getJSON(`player/${id}.json`).then((d) => { setData(d); setTitle(d.player.nameDisplay); }).catch(() => setData(false));
  }, [id, setTitle]);

  const matches = useMemo(
    () => (data && data !== false ? [...data.matches].sort((a, b) => (a.matchTime || "").localeCompare(b.matchTime || "")) : []),
    [data]
  );

  // Adversaires déjà affrontés (avec nombre de confrontations)
  const opponentsList = useMemo(() => {
    const map = new Map();
    for (const m of matches) {
      for (const p of m[oppSide(m)]?.players || []) {
        const e = map.get(String(p.id)) || { id: String(p.id), name: p.nameDisplay, count: 0 };
        e.count++; map.set(String(p.id), e);
      }
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [matches]);

  const h2h = useMemo(() => {
    if (!opp) return null;
    const list = matches.filter((m) => (m[oppSide(m)]?.players || []).some((p) => String(p.id) === String(opp.id)))
      .sort((a, b) => (b.matchTime || "").localeCompare(a.matchTime || ""));
    const w = list.filter((m) => m.won).length;
    return { list, w, l: list.length - w };
  }, [opp, matches]);

  if (data === false) return <div className="card muted">Joueur introuvable.</div>;
  if (!data) return <div className="card muted">Chargement…</div>;

  const wins = matches.filter((m) => m.won).length;
  const rate = matches.length ? Math.round((wins / matches.length) * 100) : 0;
  const meta = findMeta(matches, data.player.id);

  // Historique Elo groupé par discipline (ordre : plus de matchs d'abord)
  const eloByDisc = {};
  for (const pt of data.elo || []) (eloByDisc[pt.disc] ??= []).push(pt);
  const discOrder = Object.keys(eloByDisc).sort((a, b) => eloByDisc[b].length - eloByDisc[a].length);
  const lastElo = (data.elo || [])[data.elo?.length - 1];

  // Matchs groupés par tournoi (tournois récents d'abord)
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
          <img className="phead-av" src={meta.avatar || meta.flag || ""} alt=""
            onError={(e) => { if (meta.flag && e.target.src !== meta.flag) e.target.src = meta.flag; else e.target.style.visibility = "hidden"; }} />
          <div className="phead-info">
            <h2>{data.player.nameDisplay}</h2>
            <div className="phead-meta">
              <span>{meta.flag && <img className="phead-flag" src={meta.flag} alt="" />}{data.player.countryCode || "—"}</span>
              <span>{matches.length} matchs · <span className="win">{wins} V</span> / <span className="loss">{matches.length - wins} D</span> · {rate}%</span>
            </div>
          </div>
          {lastElo && (
            <div className="phead-elo">
              <div className="v">{lastElo.r}</div>
              <div className="l">Cote Elo · {DISC_LABEL[lastElo.disc] || lastElo.disc}</div>
            </div>
          )}
        </div>
      </div>

      {discOrder.length > 0 && (
        <div className="card">
          <h2>Évolution de la cote</h2>
          {discOrder.map((code) => (
            <EloChart key={code} points={eloByDisc[code]} label={DISC_LABEL[code] || code} />
          ))}
        </div>
      )}

      {(data.comparison || []).length > 0 && (
        <div className="card">
          <h2>Elo vs classement mondial BWF</h2>
          <p className="lead">
            Le classement mondial officiel repose sur les 6 meilleures perfs (inertie). Notre Elo
            reflète la forme du moment. L'écart entre les deux est le signal intéressant pour parier.
          </p>
          {data.comparison.map((c) => (
            <div className="cmp" key={c.key}>
              <div className="cmp-disc">{DISC_LABEL[c.disc] || c.disc}</div>
              <div className="cmp-cols">
                <div className="cmp-col">
                  <div className="cmp-k">Notre Elo</div>
                  <div className="cmp-rank">#{c.eloRank}</div>
                  <div className="cmp-sub">{c.eloRating} pts · {c.matches} matchs</div>
                </div>
                <div className="cmp-vs">vs</div>
                <div className="cmp-col">
                  <div className="cmp-k">Mondial BWF</div>
                  <div className="cmp-rank">{c.bwfRank ? `#${c.bwfRank}` : "—"}</div>
                  <div className="cmp-sub">{c.bwfPoints ? fmtPts(c.bwfPoints) : "hors classement"}</div>
                </div>
              </div>
              {c.bwfRank != null && <div className="cmp-note">{cmpNote(c.eloRank, c.bwfRank)}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Tête-à-tête</h2>
        <p className="lead">Choisis un adversaire déjà affronté pour voir vos confrontations.</p>
        <OpponentPicker list={opponentsList} value={opp} onChange={setOpp} />
        {h2h && (
          h2h.list.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Aucune confrontation trouvée.</p>
          ) : (
            <>
              <div className="h2h-sum">
                <span className="big"><span className="win">{h2h.w}</span> – <span className="loss">{h2h.l}</span></span>
                <span className="muted">face à {opp.name}</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead><tr><th>Tournoi</th><th>Épreuve</th><th>Tour</th><th>Score</th><th>Résultat</th></tr></thead>
                  <tbody>
                    {h2h.list.map((m, i) => (
                      <tr key={i}>
                        <td><Link to={`/tournament/${m.tmtId}`}>{m.tournamentName || m.tmtId}</Link></td>
                        <td>{m.eventName}</td>
                        <td>{m.roundName}</td>
                        <td>{scoreFor(m)}</td>
                        <td className={m.won ? "win" : "loss"}>{m.won ? "Victoire" : "Défaite"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>

      <div className="card">
        <h2>Derniers matchs par tournoi</h2>
        {grouped.map((g) => (
          <div className="tgroup" key={g.tmtId}>
            <h3><Link to={`/tournament/${g.tmtId}`}>{g.name}</Link>{g.year ? <span className="muted"> · {g.year}</span> : null}</h3>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Épreuve</th><th>Tour</th><th>Partenaire</th><th>Adversaires</th><th>Score</th><th>Résultat</th></tr></thead>
                <tbody>
                  {g.matches.map((m, i) => (
                    <tr key={i}>
                      <td>{m.eventName}</td>
                      <td>{m.roundName}</td>
                      <td>{partner(m, data.player.id)}</td>
                      <td>{opponents(m)}</td>
                      <td>{scoreFor(m)}</td>
                      <td className={m.won ? "win" : "loss"}>{m.won ? "Victoire" : "Défaite"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

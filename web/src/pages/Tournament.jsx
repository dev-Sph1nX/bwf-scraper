import { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";
import Bracket from "../components/Bracket.jsx";
import MatchTeam from "../components/MatchTeam.jsx";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];
const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

// Lien vers la fiche d'une équipe : simple -> joueur, double -> paire.
function EntityLink({ team }) {
  const players = team?.players ?? [];
  if (players.length === 0) return <span className="muted">—</span>;
  if (players.length >= 2) {
    const key = players.map((p) => String(p.id)).sort().join("-");
    return <Link to={`/pair/${key}`}>{players.map((p) => p.nameDisplay).join(" / ")}</Link>;
  }
  return <Link to={`/player/${players[0].id}`}>{players[0].nameDisplay}</Link>;
}

// Extrait vainqueur / finaliste / demi-finalistes de la grille d'un tableau.
// La dernière colonne (maxCol) porte la finale ; la colonne précédente, les demies.
function podium(disc) {
  const grid = disc.results || {};
  let maxCol = -1;
  for (const k of Object.keys(grid)) { const c = Number(k.split("-")[0]); if (c > maxCol) maxCol = c; }
  if (maxCol < 0) return null;

  const finalMatch = grid[`${maxCol}-0`]?.match ?? null;
  const decided = finalMatch && (finalMatch.winner === 1 || finalMatch.winner === 2);
  const winnerTeam = decided ? finalMatch[finalMatch.winner === 1 ? "team1" : "team2"] : null;
  const runnerTeam = decided ? finalMatch[finalMatch.winner === 1 ? "team2" : "team1"] : null;

  // Demi-finalistes = équipes battues en demi-finale (colonne maxCol-1).
  const semis = [];
  if (maxCol - 1 >= 0) {
    for (const r of [0, 1]) {
      const m = grid[`${maxCol - 1}-${r}`]?.match;
      if (m && (m.winner === 1 || m.winner === 2)) {
        semis.push(m[m.winner === 1 ? "team2" : "team1"]);
      }
    }
  }
  return { decided, winnerTeam, runnerTeam, semis };
}

// Une entrée de palmarès par tableau (Main Draw prioritaire ; repli sur le plus grand tableau).
function buildPalmares(disciplines) {
  const byLabel = new Map();
  for (const d of disciplines) {
    if (!DISC_LABEL[d.label] || d.matchCount === 0) continue;
    const prev = byLabel.get(d.label);
    const isMain = d.stage === "Main Draw";
    const prevMain = prev?.stage === "Main Draw";
    // Garde le Main Draw ; sinon le tableau ayant le plus de matchs.
    if (!prev || (isMain && !prevMain) || (isMain === prevMain && d.matchCount > prev.matchCount)) {
      byLabel.set(d.label, d);
    }
  }
  return ORDER.filter((c) => byLabel.has(c)).map((c) => ({ code: c, disc: byLabel.get(c), p: podium(byLabel.get(c)) }));
}

function Palmares({ disciplines }) {
  const rows = buildPalmares(disciplines);
  if (rows.length === 0) return null;

  const anyDecided = rows.some((r) => r.p?.decided);

  return (
    <div className="card">
      <h2>Palmarès</h2>
      {!anyDecided ? (
        <p className="lead">Tournoi en cours — le palmarès s'affichera ici une fois le tournoi terminé.</p>
      ) : (
        <>
          {rows.some((r) => !r.p?.decided) && (
            <p className="lead">Tournoi en cours — les tableaux non terminés se compléteront à la fin.</p>
          )}
          <div className="table-scroll">
            <table className="palmares">
              <thead>
                <tr><th>Tableau</th><th>🏆 Vainqueur</th><th>Finaliste</th><th>Demi-finalistes</th></tr>
              </thead>
              <tbody>
                {rows.map(({ code, p }) => (
                  <tr key={code}>
                    <td className="pal-disc">{DISC_LABEL[code]}</td>
                    {p?.decided ? (
                      <>
                        <td className="pal-win"><EntityLink team={p.winnerTeam} /></td>
                        <td><EntityLink team={p.runnerTeam} /></td>
                        <td>
                          {p.semis.length === 0 ? <span className="muted">—</span> : (
                            <div className="pal-semis">
                              {p.semis.map((t, i) => <EntityLink key={i} team={t} />)}
                            </div>
                          )}
                        </td>
                      </>
                    ) : (
                      <td colSpan="3"><span className="badge live">En cours</span></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// Classement d'une poule (round-robin) calculé depuis les matchs joués.
function groupStandings(matches) {
  const map = new Map();
  for (const m of matches) {
    for (const side of [1, 2]) {
      const team = m[side === 1 ? "team1" : "team2"];
      const players = team?.players || [];
      if (!players.length) continue;
      const key = players.map((p) => String(p.id)).sort().join("-");
      let e = map.get(key);
      if (!e) { e = { key, team, w: 0, l: 0 }; map.set(key, e); }
      if (m.winner === 1 || m.winner === 2) (m.winner === side ? e.w++ : e.l++);
    }
  }
  return [...map.values()].sort((a, b) => b.w - a.w || a.l - b.l);
}

// Vue d'une poule : petit classement + la liste des matchs (profil de match).
function GroupView({ disc }) {
  const matches = disc.matches || [];
  if (matches.length === 0) return <div className="card muted">Pas de matchs pour cette poule.</div>;
  const table = groupStandings(matches);
  const ordered = [...matches].sort((a, b) => (a.roundName || "").localeCompare(b.roundName || ""));
  return (
    <div className="card">
      <h2>{disc.label}</h2>
      <div className="table-scroll">
        <table className="grp-standings">
          <thead><tr><th>Équipe</th><th>J</th><th>V</th><th>D</th></tr></thead>
          <tbody>
            {table.map((e) => (
              <tr key={e.key}>
                <td><EntityLink team={e.team} /></td>
                <td className="lb-num">{e.w + e.l}</td>
                <td className="lb-num">{e.w}</td>
                <td className="lb-num">{e.l}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="match-list" style={{ marginTop: 16 }}>
        {ordered.map((m, i) => (
          <div className="match-item" key={i}>
            <div className="match-meta"><span className="match-ev">{m.roundName}</span></div>
            <div className="mcard mcard-flow">
              <MatchTeam match={m} side={1} />
              <MatchTeam match={m} side={2} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Tournament() {
  const { id } = useParams();
  const { setTitle, setRight } = useOutletContext();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);

  useEffect(() => {
    setRight(<Link className="tb-right" to="/tournaments">← Calendrier</Link>);
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
          <Palmares disciplines={data.disciplines} />
          <div className="tabs">
            {withData.map((d) => (
              <button key={d.drawId} className={`tab ${d.drawId === sel ? "active" : ""}`} onClick={() => setSel(d.drawId)}>
                {d.label}
              </button>
            ))}
          </div>
          {disc && (disc.group ? <GroupView disc={disc} /> : <Bracket disc={disc} />)}
        </>
      )}
    </>
  );
}

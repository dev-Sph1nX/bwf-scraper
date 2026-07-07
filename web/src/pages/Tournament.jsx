import { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";
import Bracket from "../components/Bracket.jsx";
import MatchTeam from "../components/MatchTeam.jsx";
import UpcomingMatch from "../components/UpcomingMatch.jsx";

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

// Avatars + forme : repris du classement Elo pour un rendu identique.
function Avatars({ players }) {
  return (
    <span className="avatars">
      {players.map((p) => (
        <img key={p.id} className="av" src={p.avatar || p.flag || ""} alt=""
          onError={(e) => { if (p.flag && e.target.src !== p.flag) e.target.src = p.flag; else e.target.style.visibility = "hidden"; }} />
      ))}
    </span>
  );
}
function Form({ value }) {
  const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
  const label = value > 0 ? `▲ +${value}` : value < 0 ? `▼ ${Math.abs(value)}` : "→ 0";
  return <span className={`form ${cls}`} title="Variation d'Elo sur les 5 derniers matchs">{label}</span>;
}

const idsKeyOf = (players) => (players || []).map((p) => String(p.id)).sort().join("-");
// Code discipline (MS/WS/…) d'un tableau, depuis le 1er match trouvé.
function discCode(disc) {
  for (const cell of Object.values(disc.results || {})) { const m = cell?.match; if (m?.eventName) return m.eventName; }
  return null;
}
// Clés (ids triés) des participants d'un tableau.
function participantKeys(disc) {
  const set = new Set();
  for (const cell of Object.values(disc.results || {})) {
    const m = cell?.match; if (!m) continue;
    for (const side of ["team1", "team2"]) {
      const players = m[side]?.players || [];
      if (players.length) set.add(idsKeyOf(players));
    }
  }
  return set;
}

// Ensemble des entités éliminées (perdantes d'un match à élimination directe) du
// tournoi, par discipline. Clé : `${code}|${idsTriés}`.
function eliminatedSet(disciplines) {
  const set = new Set();
  for (const d of disciplines) {
    if (!d.matchCount || d.group) continue; // KO uniquement (une défaite = éliminé)
    const code = discCode(d);
    for (const cell of Object.values(d.results || {})) {
      const m = cell?.match;
      if (!m || (m.winner !== 1 && m.winner !== 2)) continue;
      const loser = m[m.winner === 1 ? "team2" : "team1"]?.players || [];
      if (loser.length) set.add(`${code}|${idsKeyOf(loser)}`);
    }
  }
  return set;
}

// Classement Elo restreint aux participants du tableau sélectionné (qui est en forme ?).
function EloStandings({ ranking, disc, eliminated }) {
  const [sort, setSort] = useState("elo");
  const code = disc && discCode(disc);
  const d = ranking?.disciplines?.[code];
  if (!d) return null;
  const keys = participantKeys(disc);
  const rows = d.entities.filter((e) => keys.has(idsKeyOf(e.players)));
  if (rows.length === 0) return null;
  const sorted = [...rows];
  if (sort === "world") sorted.sort((a, b) => (a.bwfRank ?? Infinity) - (b.bwfRank ?? Infinity));
  else if (sort === "formBest") sorted.sort((a, b) => b.form - a.form);
  else if (sort === "formWorst") sorted.sort((a, b) => a.form - b.form);
  else sorted.sort((a, b) => b.rating - a.rating);
  return (
    <div className="card">
      <h2>Forme des participants ({disc.label})</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Classement Elo des {d.type === "pair" ? "paires" : "joueurs"} engagé{d.type === "pair" ? "es" : "s"} dans ce tableau.
        <b> Forme</b> = variation d'Elo sur les 5 derniers matchs.
      </p>
      <div className="lb-sort" style={{ marginBottom: 12 }}>
        <span className="lb-sort-label">Trier :</span>
        {[["elo", "Elo"], ["world", "Mondial"], ["formBest", "Meilleure forme"], ["formWorst", "Pire forme"]].map(([k, lbl]) => (
          <button key={k} className={`range-btn ${sort === k ? "active" : ""}`} onClick={() => setSort(k)}>{lbl}</button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="lb-table">
          <thead>
            <tr>
              <th className="lb-rank">#</th>
              <th>{d.type === "pair" ? "Paire" : "Joueur"}</th>
              <th style={{ textAlign: "right" }}>Elo</th>
              <th style={{ textAlign: "center" }}>Forme</th>
              <th style={{ textAlign: "center" }}>Mondial</th>
              <th style={{ textAlign: "center" }}>V–D</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => {
              const out = eliminated?.has(`${code}|${idsKeyOf(e.players)}`);
              return (
              <tr key={e.key} className={out ? "lb-elim" : ""}>
                <td className={`lb-rank ${i < 3 && !out ? "top" : ""}`}>{i + 1}</td>
                <td>
                  <span className="lb-entity">
                    <Avatars players={e.players} />
                    <span className="lb-name">
                      <span className={`nm ${e.players.length > 1 ? "stacked" : ""}`}>
                        {e.type === "pair" ? (
                          <Link to={`/pair/${e.key.slice(5)}`}>{e.players.map((p) => <span key={p.id} className="pl">{p.name}</span>)}</Link>
                        ) : (
                          e.players.map((p) => <Link key={p.id} to={`/player/${p.id}`}>{p.name}</Link>)
                        )}
                        {e.provisional && <span className="tag-prov">prov.</span>}
                        {out && <span className="tag-elim">éliminé</span>}
                      </span>
                      <span className="sub">{e.country || "—"}</span>
                    </span>
                  </span>
                </td>
                <td className="lb-rating">{e.rating}</td>
                <td style={{ textAlign: "center" }}><Form value={e.form} /></td>
                <td className="lb-num">{e.bwfRank ? `#${e.bwfRank}` : "—"}</td>
                <td className="lb-num">{e.wins}–{e.losses}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Vue « matchs prévus » filtrée par un critère de participant :
//   mode "form"  : participant en forte hausse de forme (ΔElo >= +40)
//   mode "under" : participant sous-coté (bien mieux classé à l'Elo qu'au mondial)
const WATCH_FORM_MIN = 40, UNDER_GAP_MIN = 8;
function WatchList({ matches, ranking, eliminated, mode }) {
  const lookup = (team, code) => {
    const d = ranking?.disciplines?.[code];
    if (!d) return null;
    const k = idsKeyOf(team?.players || []);
    return d.entities.find((e) => idsKeyOf(e.players) === k) || null;
  };
  // Métrique du côté selon le mode.
  const metric = (team, code) => {
    if (mode === "under") { const e = lookup(team, code); return e?.bwfRank && e?.rank ? e.bwfRank - e.rank : -1e9; }
    return team?.form ?? -1e9;
  };
  const MIN = mode === "under" ? UNDER_GAP_MIN : WATCH_FORM_MIN;
  const best = (m) => Math.max(metric(m.team1, m.eventName), metric(m.team2, m.eventName));
  const isOut = (team, code) => eliminated?.has(`${code}|${idsKeyOf(team?.players || [])}`);
  const rows = matches.filter((m) => best(m) >= MIN).sort((a, b) => best(b) - best(a));

  const title = mode === "under" ? "Sous-cotés — matchs prévus" : "Bonne forme — matchs prévus";
  const intro = mode === "under"
    ? <>Matchs impliquant un participant <b>sous-coté</b> : bien mieux classé à notre Elo qu'au classement mondial. Clique pour analyser.</>
    : <>Matchs impliquant un participant en <b>forte hausse</b> de forme (Elo <b>+{WATCH_FORM_MIN}</b> ou plus sur les 5 derniers matchs). Clique pour analyser.</>;
  const empty = mode === "under" ? "Aucun participant sous-coté avec un match déjà programmé." : "Aucun participant en forme avec un match déjà programmé.";

  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{intro}</p>
      {rows.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <div className="um-list">
          {rows.map((m, i) => {
            const t = metric(m.team1, m.eventName) >= metric(m.team2, m.eventName) ? m.team1 : m.team2;
            const name = (t.players || []).map((p) => p.nameDisplay).join(" / ");
            const out = isOut(t, m.eventName);
            const ent = mode === "under" ? lookup(t, m.eventName) : null;
            return (
              <div className={`watch-item ${out ? "lb-elim" : ""}`} key={i}>
                <div className="watch-head">
                  <span aria-hidden="true">⭐</span>
                  <span className="watch-name">{name}</span>
                  {out ? <span className="tag-elim">éliminé</span>
                    : mode === "under"
                      ? <span className="muted">sous-coté · Elo #{ent?.rank} vs mondial #{ent?.bwfRank}</span>
                      : <><span className="muted">en forme</span><Form value={t.form} /></>}
                </div>
                <UpcomingMatch m={m} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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
  const [ranking, setRanking] = useState(null);
  const [view, setView] = useState("bracket"); // bracket | players | palmares
  const [pv, setPv] = useState("disc"); // vue Joueurs : disc | form | under
  const [upcoming, setUpcoming] = useState([]); // matchs à venir de CE tournoi

  useEffect(() => {
    setRight(<Link className="tb-right" to="/tournaments">← Calendrier</Link>);
    return () => setRight(null);
  }, [setRight]);

  useEffect(() => { getJSON("elo/ranking.json").then(setRanking).catch(() => setRanking(false)); }, []);
  useEffect(() => {
    getJSON("upcoming-matches.json")
      .then((u) => setUpcoming((u.matches || []).filter((m) => String(m.tmtId) === String(id))))
      .catch(() => setUpcoming([]));
  }, [id]);

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
  const eliminated = eliminatedSet(data.disciplines);

  // Compteurs pour les onglets Joueurs (Bonne forme / Sous-cotés).
  const underGap = (team, code) => {
    const d = ranking?.disciplines?.[code];
    const e = d?.entities.find((x) => idsKeyOf(x.players) === idsKeyOf(team?.players || []));
    return e?.bwfRank && e?.rank ? e.bwfRank - e.rank : -1e9;
  };
  const formCount = upcoming.filter((m) => Math.max(m.team1?.form ?? -1e9, m.team2?.form ?? -1e9) >= WATCH_FORM_MIN).length;
  const underCount = upcoming.filter((m) => Math.max(underGap(m.team1, m.eventName), underGap(m.team2, m.eventName)) >= UNDER_GAP_MIN).length;

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
          <div className="tabs" role="tablist" aria-label="Vue">
            {[["bracket", "Tableau"], ["players", "Joueurs"], ["palmares", "Palmarès"]].map(([k, lbl]) => (
              <button key={k} role="tab" aria-selected={view === k} className={`tab ${view === k ? "active" : ""}`} onClick={() => setView(k)}>
                {lbl}
              </button>
            ))}
          </div>

          {view === "palmares" ? (
            <Palmares disciplines={data.disciplines} />
          ) : (
            <>
              <div className="tabs" role="tablist" aria-label="Discipline">
                {withData.map((d) => (
                  <button key={d.drawId} role="tab" aria-selected={pv === "disc" && d.drawId === sel} className={`tab ${pv === "disc" && d.drawId === sel ? "active" : ""}`} onClick={() => { setPv("disc"); setSel(d.drawId); }}>
                    {d.label} · {participantKeys(d).size}
                  </button>
                ))}
                {view === "players" && (
                  <>
                    <button role="tab" aria-selected={pv === "form"} className={`tab ${pv === "form" ? "active" : ""}`} style={{ marginLeft: "auto" }} onClick={() => setPv("form")}>
                      ⭐ Bonne forme · {formCount}
                    </button>
                    <button role="tab" aria-selected={pv === "under"} className={`tab ${pv === "under" ? "active" : ""}`} onClick={() => setPv("under")}>
                      Sous-cotés · {underCount}
                    </button>
                  </>
                )}
              </div>
              {view === "bracket"
                ? (disc && (disc.group ? <GroupView disc={disc} /> : <Bracket disc={disc} />))
                : pv === "form"
                  ? <WatchList matches={upcoming} ranking={ranking} eliminated={eliminated} mode="form" />
                  : pv === "under"
                    ? <WatchList matches={upcoming} ranking={ranking} eliminated={eliminated} mode="under" />
                    : (disc && ranking && <EloStandings ranking={ranking} disc={disc} eliminated={eliminated} />)}
            </>
          )}
        </>
      )}
    </>
  );
}

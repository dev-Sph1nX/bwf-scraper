import { useEffect, useMemo, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { getJSON, entityKeyOf } from "../data.js";
import MatchTeam from "../components/MatchTeam.jsx";
import PointsChart from "../components/PointsChart.jsx";
import PronoVerdict, { BOOK_LABEL, sansPronoWhy } from "../components/PronoVerdict.jsx";
import { ROUND_LABEL } from "../components/UpcomingMatch.jsx";

// Fiche d'UN match joué : tout ce que le projet sait de lui — résultat manche
// par manche, point par point, pronostic du modèle, cotes de clôture, état Elo
// actuel des deux camps. URL : /match/<tmtId>/<disc|jour|a|b> (même clé que
// pronos/<tmtId>.json et points/<tmtId>.json côté build-data).

const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

// "2026-07-31 18:45:00" -> "31/07/2026 · 18h45" (l'heure manque parfois).
function fmtMatchTime(t) {
  if (!t) return "—";
  const [d, h] = String(t).split(" ");
  const [Y, M, D] = d.split("-");
  const heure = h && h !== "00:00:00" ? ` · ${h.slice(0, 5).replace(":", "h")}` : "";
  return `${D}/${M}/${Y}${heure}`;
}

const nomDe = (t) => (t?.players || []).map((p) => p.nameDisplay).join(" / ");

// Lien vers la fiche d'un camp : simple -> joueur, double -> paire.
function EntityLink({ team }) {
  const players = team?.players ?? [];
  if (players.length === 0) return <span className="muted">—</span>;
  if (players.length >= 2) {
    const key = players.map((p) => String(p.id)).sort().join("-");
    return <Link to={`/pair/${key}`}>{players.map((p) => p.nameDisplay).join(" / ")}</Link>;
  }
  return <Link to={`/player/${players[0].id}`}>{players[0].nameDisplay}</Link>;
}

// Score manche par manche : une ligne par camp, une colonne par manche.
function ScoreTable({ m }) {
  if (!m.score?.length) return null;
  const total = (champ) => m.score.reduce((s, x) => s + x[champ], 0);
  return (
    <div className="table-scroll" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>Camp</th>
            {m.score.map((s, i) => <th key={i} style={{ textAlign: "center" }}>M{i + 1}</th>)}
            <th style={{ textAlign: "center" }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2].map((side) => {
            const champ = side === 1 ? "home" : "away";
            const autre = side === 1 ? "away" : "home";
            const nom = nomDe(m[`team${side}`]);
            return (
              <tr key={side}>
                <td>{m.winner === side ? <b>🏆 {nom}</b> : nom}</td>
                {m.score.map((s, i) => (
                  <td key={i} style={{ textAlign: "center" }}>
                    {s[champ] > s[autre] ? <b>{s[champ]}</b> : s[champ]}
                  </td>
                ))}
                <td style={{ textAlign: "center" }}>{total(champ)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Probabilité d'avant match, en barres (camp 1 / camp 2).
function ProbBars({ m }) {
  const rows = [
    { nom: nomDe(m.team1), p: m.prob },
    { nom: nomDe(m.team2), p: 100 - m.prob },
  ];
  return (
    <div className="bars" style={{ marginTop: 10 }}>
      {rows.map((r, i) => (
        <div className="bar-row" key={i}>
          <span className="bar-label">{r.nom}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${r.p}%` }} /></span>
          <span className="bar-val">{r.p}%</span>
        </div>
      ))}
    </div>
  );
}

// Les deux camps dans le classement Elo ACTUEL (pas celui du jour du match).
function EloNow({ ranking, m }) {
  const d = ranking?.disciplines?.[m.disc];
  if (!d) return null;
  const rows = [1, 2]
    .map((side) => {
      const team = m[`team${side}`];
      const k = entityKeyOf(team?.players);
      const e = d.entities.find((x) => entityKeyOf(x.players) === k);
      return e ? { team, e } : null;
    })
    .filter(Boolean);
  if (!rows.length) return null;
  return (
    <div className="card">
      <h2>Les camps aujourd'hui</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Classement Elo <b>actuel</b> des deux camps — pas celui du jour du match,
        que le pronostic ci-dessus utilisait.
      </p>
      <div className="table-scroll">
        <table className="lb-table">
          <thead>
            <tr>
              <th>{d.type === "pair" ? "Paire" : "Joueur"}</th>
              <th style={{ textAlign: "right" }}>Elo</th>
              <th style={{ textAlign: "center" }}>Forme</th>
              <th style={{ textAlign: "center" }}>Mondial</th>
              <th style={{ textAlign: "center" }}>V–D</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ team, e }) => (
              <tr key={e.key}>
                <td><EntityLink team={team} /></td>
                <td className="lb-rating">{e.rating}</td>
                <td style={{ textAlign: "center" }}>
                  <span className={`form ${e.form > 0 ? "up" : e.form < 0 ? "down" : "flat"}`}>
                    {e.form > 0 ? `▲ +${e.form}` : e.form < 0 ? `▼ ${Math.abs(e.form)}` : "→ 0"}
                  </span>
                </td>
                <td className="lb-num">{e.bwfRank ? `#${e.bwfRank}` : "—"}</td>
                <td className="lb-num">{e.wins}–{e.losses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Match() {
  const { tmtId, key } = useParams();
  const { setTitle, setRight } = useOutletContext();
  const [pronos, setPronos] = useState(null);   // pronos/<tmtId>.json
  const [points, setPoints] = useState(null);   // points/<tmtId>.json (à la demande)
  const [tmt, setTmt] = useState(null);         // tournament/<tmtId>.json (entête)
  const [ranking, setRanking] = useState(null); // elo/ranking.json (camps aujourd'hui)

  useEffect(() => { getJSON(`pronos/${tmtId}.json`).then(setPronos).catch(() => setPronos(false)); }, [tmtId]);
  useEffect(() => { getJSON(`tournament/${tmtId}.json`).then(setTmt).catch(() => setTmt(false)); }, [tmtId]);
  useEffect(() => { getJSON("elo/ranking.json").then(setRanking).catch(() => setRanking(false)); }, []);

  // Le match : retrouvé dans les pronos du tournoi par sa clé d'URL.
  const m = useMemo(() => {
    if (!pronos?.matches) return pronos === false ? false : null;
    const found = pronos.matches.find(
      (x) => `${x.disc}|${String(x.matchTime || "").slice(0, 10)}|${x.a}|${x.b}` === key,
    );
    return found || false;
  }, [pronos, key]);

  useEffect(() => {
    setRight(<Link className="tb-right" to={`/tournament/${tmtId}`}>← Tournoi</Link>);
    return () => setRight(null);
  }, [setRight, tmtId]);

  useEffect(() => {
    if (m) setTitle(`${nomDe(m.team1)} vs ${nomDe(m.team2)}`);
    else setTitle("Match");
  }, [m, setTitle]);

  useEffect(() => {
    if (!m?.pts) return;
    getJSON(`points/${tmtId}.json`).then(setPoints).catch(() => setPoints(false));
  }, [m, tmtId]);

  if (pronos === null) return <div className="card muted">Chargement…</div>;
  if (m === false) return <div className="card muted">Match introuvable.</div>;
  if (!m) return <div className="card muted">Chargement…</div>;

  const sets = points?.matches?.[key] || null;
  const tmtName = tmt?.info?.name || `Tournoi ${tmtId}`;

  return (
    <>
      <div className="card">
        <h2>{nomDe(m.team1)} <span className="muted">vs</span> {nomDe(m.team2)}</h2>
        <p className="muted">
          <Link to={`/tournament/${tmtId}`}>{tmtName}</Link>
          {" · "}{DISC_LABEL[m.disc] || m.disc}
          {" · "}{ROUND_LABEL[m.roundName] || m.roundName}
          {" · "}{fmtMatchTime(m.matchTime)}
          {tmt?.info?.location ? ` · ${tmt.info.location}` : ""}
        </p>
        {m.walkover
          ? <span className="badge warn">{m.status || "Forfait"}</span>
          : <span className="badge post">Terminé</span>}
      </div>

      <div className="card">
        <h2>Résultat</h2>
        <div className="mcard mcard-flow">
          <MatchTeam match={m} side={1} seed={m.team1?.seed} />
          <MatchTeam match={m} side={2} seed={m.team2?.seed} />
        </div>
        <ScoreTable m={m} />
      </div>

      <div className="card">
        <h2>Point par point</h2>
        {!m.pts ? (
          <p className="muted">
            Pas de point par point pour ce match — les relevés Flashscore ne
            couvrent ni les qualifications ni les flux incomplets.
          </p>
        ) : points === null ? (
          <p className="muted">Chargement…</p>
        ) : !sets ? (
          <p className="muted">Point par point indisponible.</p>
        ) : (
          <PointsChart sets={sets} label1={nomDe(m.team1)} label2={nomDe(m.team2)} />
        )}
      </div>

      <div className="card">
        <h2>Pronostic du modèle</h2>
        {m.walkover ? (
          <p className="muted">Forfait / abandon : pas un match à prédire.</p>
        ) : m.prob == null ? (
          <p className="muted">{sansPronoWhy(m)}</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
              Probabilité que notre Elo donnait <b>avant</b> le match (modèle
              « Elo recalibré », le même que le prédicteur).
            </p>
            <ProbBars m={m} />
            <div style={{ marginTop: 12 }}>
              <PronoVerdict m={{ ...m, odds: null }} />
            </div>
          </>
        )}
      </div>

      {m.odds && (
        <div className="card">
          <h2>Cotes de clôture</h2>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
            Dernières cotes relevées avant le match (ouverture → clôture).
            En <b>gras</b>, le camp qui l'a emporté.
            {m.odds.via === "flashscore"
              ? " Source : historique Flashscore."
              : " Source : nos relevés Betclic / Unibet / Winamax."}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Opérateur</th>
                  <th style={{ textAlign: "right" }}>{nomDe(m.team1)}</th>
                  <th style={{ textAlign: "right" }}>{nomDe(m.team2)}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(m.odds.books).map(([op, b]) => {
                  const cell = (open, close, side) => {
                    const c = close?.toLocaleString("fr-FR") ?? "—";
                    const o = open != null && open !== close ? `${open.toLocaleString("fr-FR")} → ` : "";
                    return <>{o}{m.winner === side ? <b>{c}</b> : c}</>;
                  };
                  return (
                    <tr key={op}>
                      <td>{BOOK_LABEL[op] || op}</td>
                      <td style={{ textAlign: "right" }}>{cell(b.open1, b.odd1, 1)}</td>
                      <td style={{ textAlign: "right" }}>{cell(b.open2, b.odd2, 2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <EloNow ranking={ranking} m={m} />
    </>
  );
}

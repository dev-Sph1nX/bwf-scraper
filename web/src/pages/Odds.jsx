import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";
import { ROUND_LABEL } from "../components/UpcomingMatch.jsx";

// Page d'audit de l'appariement cotes oddsportal <-> matchs BWF.
// Objectif : vérifier ligne par ligne que la bonne cote est collée au bon match.
// Les cotes n'alimentent pas encore les prédictions.

const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};
const ORDER = ["MS", "WS", "MD", "WD", "XD"];

const TABS = [
  { key: "matched", label: "Appariés", hint: "Cote collée à un match BWF. Vérifie que le nom BWF et le nom oddsportal désignent bien la même personne, de chaque côté." },
  { key: "ambiguous", label: "Ambigus", hint: "Plusieurs matchs BWF collaient presque aussi bien : aucune cote n'a été attribuée, par sécurité. Les candidats envisagés sont listés." },
  { key: "unmatchedOdds", label: "Orphelins", hint: "Cote sans match BWF correspondant. Souvent un tournoi ou un tour absent de nos données, parfois un nom qu'on n'a pas su reconnaître." },
  { key: "noOdds", label: "Sans cote", hint: "Match listé par oddsportal mais sans cote publiée. Rien à apparier." },
];

const fmtDate = (s) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—");
const fmtOdd = (v) => (v == null ? "—" : v.toFixed(2));

// Une cote et son nom des deux côtés : c'est l'unité d'audit.
function Side({ bwf, op, odd, fav }) {
  return (
    <div className="oa-side">
      <div className="oa-names">
        {bwf ? <div className="oa-bwf">{bwf}</div> : null}
        <div className="oa-op">
          {op.display}
          {op.slug ? <span className="oa-slug">{op.slug}</span> : <span className="oa-slug oa-noslug">slug non identifié</span>}
        </div>
      </div>
      <div className={`oa-odd${fav ? " fav" : ""}`}>{fmtOdd(odd)}</div>
    </div>
  );
}

function Head({ row, right }) {
  return (
    <div className="oa-head">
      <span className="oa-disc">{row.discipline}</span>
      <span className="oa-round">{ROUND_LABEL[row.roundName] || row.roundName || row.league}</span>
      <span className="oa-tmt">{row.tournamentName || row.tournament}</span>
      <span className="oa-when">{fmtDate(row.date)} · {row.time} UTC</span>
      {right}
    </div>
  );
}

function MatchedItem({ m }) {
  const o1 = m.oddsTeam1, o2 = m.oddsTeam2;
  return (
    <li className="oa-item">
      <Head
        row={m}
        right={
          <span className="oa-flags">
            {m.swapped && <span className="badge post" title="L'ordre d'affichage oddsportal est inversé par rapport à team1/team2 côté BWF. Les cotes ont été réorientées.">ordre inversé</span>}
            <span className="oa-conf" title="Score de confiance de l'appariement (plus haut = plus sûr).">{m.score}</span>
          </span>
        }
      />
      <div className="oa-sides">
        <Side bwf={m.bwf1} op={m.op1} odd={o1} fav={o1 != null && o2 != null && o1 < o2} />
        <Side bwf={m.bwf2} op={m.op2} odd={o2} fav={o1 != null && o2 != null && o2 < o1} />
      </div>
    </li>
  );
}

function OddsOnlyItem({ row }) {
  const { odd1: o1, odd2: o2 } = row;
  return (
    <li className="oa-item">
      <Head row={row} />
      <div className="oa-sides">
        <Side op={row.op1} odd={o1} fav={o1 != null && o2 != null && o1 < o2} />
        <Side op={row.op2} odd={o2} fav={o1 != null && o2 != null && o2 < o1} />
      </div>
    </li>
  );
}

function AmbiguousItem({ row }) {
  return (
    <li className="oa-item">
      <Head row={row} />
      <div className="oa-sides">
        <Side op={row.op1} odd={row.odd1} />
        <Side op={row.op2} odd={row.odd2} />
      </div>
      <div className="oa-cands">
        <div className="oa-cands-t">Candidats BWF écartés faute de départage :</div>
        <ul>
          {row.candidates.map((c, i) => (
            <li key={i}>
              <b>{c.bwf1}</b> vs <b>{c.bwf2}</b>
              <span className="muted"> — {c.tournamentName}, {ROUND_LABEL[c.roundName] || c.roundName} (score {c.score})</span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export default function Odds() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("matched");
  const [disc, setDisc] = useState("all");

  useEffect(() => { setTitle("Audit des cotes"); }, [setTitle]);
  useEffect(() => { getJSON("odds-report.json").then(setData).catch(() => setData(false)); }, []);

  // Taux d'appariement par discipline : c'est l'indicateur qui décide si on peut
  // intégrer les cotes au reste de l'app (les doubles sont les plus risqués).
  const byDisc = useMemo(() => {
    if (!data) return [];
    const acc = {};
    const bump = (d, k) => {
      if (!d) return;
      acc[d] = acc[d] || { discipline: d, matched: 0, ambiguous: 0, unmatchedOdds: 0 };
      acc[d][k]++;
    };
    for (const m of data.matched || []) bump(m.discipline, "matched");
    for (const m of data.ambiguous || []) bump(m.discipline, "ambiguous");
    for (const m of data.unmatchedOdds || []) bump(m.discipline, "unmatchedOdds");
    return ORDER.filter((d) => acc[d]).map((d) => {
      const r = acc[d];
      const total = r.matched + r.ambiguous + r.unmatchedOdds;
      return { ...r, total, rate: total ? Math.round((r.matched / total) * 100) : null };
    });
  }, [data]);

  if (data === false) {
    return (
      <div className="card muted">
        Rapport de cotes indisponible. Lance <code>npm run scrape-odds</code> puis <code>npm run build-data</code>.
      </div>
    );
  }
  if (!data) return <div className="card muted">Chargement…</div>;

  const s = data.stats || {};
  const lists = {
    matched: data.matched || [],
    ambiguous: data.ambiguous || [],
    unmatchedOdds: data.unmatchedOdds || [],
    noOdds: data.noOdds || [],
  };
  const discsPresent = ORDER.filter((d) => Object.values(lists).some((l) => l.some((x) => x.discipline === d)));
  const current = lists[tab].filter((x) => disc === "all" || x.discipline === disc);
  const activeTab = TABS.find((t) => t.key === tab);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{s.matchRate == null ? "—" : `${s.matchRate} %`}</div>
          <div className="stat-label">Taux d'appariement</div>
        </div>
        <div className="stat">
          <div className="stat-value">{s.matched ?? 0}</div>
          <div className="stat-label">Cotes appariées</div>
        </div>
        <div className="stat">
          <div className="stat-value">{s.ambiguous ?? 0}</div>
          <div className="stat-label">Ambiguïtés écartées</div>
        </div>
        <div className="stat">
          <div className="stat-value">{s.unmatchedOdds ?? 0}</div>
          <div className="stat-label">Cotes orphelines</div>
        </div>
      </div>

      <div className="card">
        <h2>Comment lire cette page</h2>
        <p className="lead">
          Chaque bloc montre, pour les deux côtés d'un match, le nom tel que le donne <b>BWF</b>{" "}
          puis le nom tel que l'affiche <b>oddsportal</b>, avec la cote associée. Si les deux
          lignes ne désignent pas la même personne, l'appariement est faux.
        </p>
        <p className="lead muted">
          Dates couvertes : {(data.dates || []).map(fmtDate).join(", ") || "—"}. {s.settled ?? 0} matchs
          déjà joués ont été écartés (leur cote de clôture ne sert à rien), et {s.noOdds ?? 0} lignes
          n'avaient pas de cote publiée. Les cotes ne sont pas encore utilisées dans les prédictions.
        </p>
        {byDisc.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Discipline</th><th>Appariés</th><th>Ambigus</th><th>Orphelins</th><th>Taux</th>
                </tr>
              </thead>
              <tbody>
                {byDisc.map((r) => (
                  <tr key={r.discipline}>
                    <td>{DISC_LABEL[r.discipline] || r.discipline}</td>
                    <td className="oa-num">{r.matched}</td>
                    <td className="oa-num">{r.ambiguous}</td>
                    <td className="oa-num">{r.unmatchedOdds}</td>
                    <td className="oa-num"><b>{r.rate == null ? "—" : `${r.rate} %`}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab${tab === t.key ? " active" : ""}`}
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({lists[t.key].length})
          </button>
        ))}
      </div>

      {discsPresent.length > 1 && (
        <div className="tabs">
          <button type="button" className={`tab${disc === "all" ? " active" : ""}`} aria-pressed={disc === "all"} onClick={() => setDisc("all")}>
            Toutes disciplines
          </button>
          {discsPresent.map((d) => (
            <button key={d} type="button" className={`tab${disc === d ? " active" : ""}`} aria-pressed={disc === d} onClick={() => setDisc(d)}>
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <h2>{activeTab.label} — {current.length}</h2>
        <p className="lead muted">{activeTab.hint}</p>
        {current.length === 0 ? (
          <p className="muted">Aucune ligne dans cette catégorie.</p>
        ) : (
          <ul className="oa-list">
            {current.map((x, i) =>
              tab === "matched" ? <MatchedItem key={x.eventId || i} m={x} />
              : tab === "ambiguous" ? <AmbiguousItem key={x.eventId || i} row={x} />
              : <OddsOnlyItem key={x.eventId || i} row={x} />
            )}
          </ul>
        )}
      </div>
    </>
  );
}

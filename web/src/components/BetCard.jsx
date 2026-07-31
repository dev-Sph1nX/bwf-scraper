import { useState } from "react";
import { Link } from "react-router-dom";
import OddsModal from "./OddsModal.jsx";
import MultiOddsChart from "./MultiOddsChart.jsx";
import { ROUND_LABEL } from "./UpcomingMatch.jsx";

// Carte de match « riche » de la refonte : deux lignes joueur (drapeau · nom ·
// #mondial · #Elo · prédiction · une colonne de cote par opérateur sélectionné ·
// bouton graphe · EV calibrée), plus la ligne « pourquoi » et sa propre modale
// d'évolution des cotes. Autonome : `selectedBooks` vient du sélecteur de
// bookmakers de l'accueil (Task 6), déjà filtré aux clés connues.

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const fmtOdd = (v) => (v == null ? "—" : v.toFixed(2));
const fmtEv = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} %`);

// La meilleure cote AFFICHÉE d'un camp : comparée uniquement entre les
// opérateurs sélectionnés (mêmes colonnes que celles rendues à l'écran).
function meilleureCote(odds, selected, side) {
  let best = null;
  for (const op of selected) {
    const v = side === 1 ? odds?.books?.[op]?.odd1 : odds?.books?.[op]?.odd2;
    if (v != null && (best == null || v > best)) best = v;
  }
  return best;
}

// Une ligne joueur : drapeau · nom · #mondial · #Elo · prédiction · cotes · EV.
function PlayerRow({ team, prob, odds, side, selected, best, n, onGraph }) {
  const players = team?.players || [];
  const fiche = players.length === 1
    ? `/player/${players[0].id}`
    : `/pair/${players.map((p) => p.id).sort().join("-")}`;
  const evVal = side === 1 ? odds?.ev1 : odds?.ev2;
  return (
    <tr>
      <td>
        {players.map((p, i) => (p.countryFlagUrl
          ? <img key={i} className="um-flag" src={p.countryFlagUrl} alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
          : null))}
      </td>
      <td className="bc-name"><Link to={fiche}>{players.map((p) => p.nameDisplay).join(" / ")}</Link></td>
      <td className="oa-num">{team?.bwfRank ? `#${team.bwfRank}` : "—"}</td>
      <td className="oa-num">{team?.eloRank ? `#${team.eloRank}` : "—"}</td>
      <td className={`bc-proba${prob != null && prob >= 50 ? "" : " dim"}`}>{prob == null ? "—" : `${prob} %`}</td>
      {selected.map((op) => {
        const odd = side === 1 ? odds?.books?.[op]?.odd1 : odds?.books?.[op]?.odd2;
        return (
          <td key={op} className={`oa-num${odd != null && odd === best ? " ba-best" : ""}`}>
            {fmtOdd(odd)}
          </td>
        );
      })}
      <td>
        {/* UN bouton graphe PAR LIGNE JOUEUR (maquette B validée) : la modale
            trace la proba implicite de CE joueur, une courbe par opérateur. */}
        <button
          type="button"
          className="range-btn bc-graph"
          disabled={n < 2}
          title={n < 2 ? "Un seul relevé pour l'instant — prochain passage dans moins de 2 h" : "Évolution des cotes"}
          onClick={onGraph}
        >
          📈 ({n})
        </button>
      </td>
      <td>
        {evVal == null
          ? <span className="bc-ev dim">—</span>
          : <span className={`bc-ev${evVal > 0 ? " pos" : ""}`}>{fmtEv(evVal)}</span>}
      </td>
    </tr>
  );
}

export default function BetCard({ match, selectedBooks }) {
  const m = match;
  const [graphe, setGraphe] = useState(null); // null | 1 | 2
  const selected = selectedBooks || [];
  const n = m.odds?.n ?? 0;
  const best1 = meilleureCote(m.odds, selected, 1);
  const best2 = meilleureCote(m.odds, selected, 2);
  const prob2 = m.probCal == null ? null : 100 - m.probCal;

  const gap = m.team1?.elo != null && m.team2?.elo != null ? Math.abs(m.team1.elo - m.team2.elo) : null;
  const flip = (p) => ({ ...p, odd1: p.odd2, odd2: p.odd1, impliedP1: p.impliedP1 == null ? null : 1 - p.impliedP1 });
  const nomDe = (side) => (side === 1 ? m.team1 : m.team2)?.players.map((p) => p.nameDisplay).join(" / ");

  return (
    <div className="card bc-card">
      <div className="oa-head">
        <span className="oa-disc">{m.eventName || "?"}</span>
        <span className="oa-round">{ROUND_LABEL[m.roundName] || m.roundName}</span>
        <Link className="oa-tmt" to={`/tournament/${m.tmtId}`}>{m.tournamentName}</Link>
        <span className="oa-when">{m.date}{m.year ? ` ${m.year}` : ""}</span>
      </div>

      <div className="table-scroll">
        <table className="ligne">
          <thead>
            <tr>
              <th></th>
              <th>Joueur</th>
              <th className="oa-num">Mondial</th>
              <th className="oa-num">Elo</th>
              <th>Préd.</th>
              {selected.map((op) => <th key={op} className="oa-num">{BOOK_LABEL[op] || op}</th>)}
              <th></th>
              <th>EV</th>
            </tr>
          </thead>
          <tbody>
            <PlayerRow team={m.team1} prob={m.probCal} odds={m.odds} side={1} selected={selected} best={best1} n={n} onGraph={() => setGraphe(1)} />
            <PlayerRow team={m.team2} prob={prob2} odds={m.odds} side={2} selected={selected} best={best2} n={n} onGraph={() => setGraphe(2)} />
          </tbody>
        </table>
      </div>

      <p className="bc-pourquoi">
        {gap != null && <> <b>{m.team1.elo >= m.team2.elo ? m.team1.players[0]?.nameDisplay : m.team2.players[0]?.nameDisplay}</b> a +{gap} points d'Elo</>}
        {m.probCal != null && <> · proba calibrée sur 8 800 matchs ✓</>}
        {m.tags?.includes("value") && <> · <b>sous-coté BWF</b></>}
      </p>

      {graphe != null && (
        <OddsModal open onClose={() => setGraphe(null)} title={`Évolution — ${nomDe(graphe)}`}>
          <MultiOddsChart
            series={selected
              .filter((op) => m.odds?.books?.[op]?.points?.length)
              .map((op) => ({
                book: op,
                label: BOOK_LABEL[op],
                points: graphe === 1 ? m.odds.books[op].points : m.odds.books[op].points.map(flip),
              }))}
            label1={nomDe(graphe)}
            label2={nomDe(graphe === 1 ? 2 : 1)}
          />
        </OddsModal>
      )}
    </div>
  );
}

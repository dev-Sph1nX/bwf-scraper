import { useState } from "react";
import { Link } from "react-router-dom";
import OddsModal from "./OddsModal.jsx";
import MatchOddsChart from "./MatchOddsChart.jsx";
import { ROUND_LABEL } from "./UpcomingMatch.jsx";

// Carte de match « riche » de la refonte : deux lignes joueur (une colonne
// identité : drapeau · nom · #mondial · Elo (score + rang) · puis prédiction ·
// une colonne de cote par opérateur sélectionné · EV calibrée), la ligne
// « pourquoi », et DANS L'EN-TÊTE : le bouton ⚔️ Duel et le bouton 📈 qui ouvre
// LE graphe du match (les deux cotes, rouge = camp 1, bleu = camp 2, un
// opérateur à la fois). Autonome : `selectedBooks` vient du sélecteur de
// bookmakers de l'accueil, déjà filtré aux clés connues.

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const fmtOdd = (v) => (v == null ? "—" : v.toFixed(2));
const fmtEv = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} %`);
// Heure de départ relevée chez les bookmakers, affichée dans le fuseau du visiteur.
const fmtHeure = (iso) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
// Heure officielle du match (matchTimeUtc, planning BWF), dans le fuseau du
// visiteur, 24 h : « 14:30 » si c'est aujourd'hui, sinon « mar. 11, 14:30 ».
// null si la date est absente ou invalide (on ne rend alors rien).
function fmtHeureMatch(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const aujourdHui = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (aujourdHui) return heure;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })}, ${heure}`;
}
// Clé prédicteur d'une équipe : id du joueur en simple, clé `pair:` en double.
const cleDuel = (team) => {
  const ids = (team?.players || []).map((p) => String(p.id));
  return ids.length === 1 ? ids[0] : `pair:${ids.sort().join("-")}`;
};

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

// Une ligne joueur : identité dans UNE colonne (drapeau · nom, puis dessous
// #mondial · score Elo avec son classement en petit) · prédiction · cotes · EV.
function PlayerRow({ team, prob, odds, side, selected, best }) {
  const players = team?.players || [];
  const fiche = players.length === 1
    ? `/player/${players[0].id}`
    : `/pair/${players.map((p) => p.id).sort().join("-")}`;
  const evVal = side === 1 ? odds?.ev1 : odds?.ev2;
  return (
    <tr>
      <td className="bc-player">
        <span className="bc-pl-id">
          {players.map((p, i) => (p.countryFlagUrl
            ? <img key={i} className="um-flag" src={p.countryFlagUrl} alt="" onError={(e) => (e.target.style.visibility = "hidden")} />
            : null))}
          <Link to={fiche}>{players.map((p) => p.nameDisplay).join(" / ")}</Link>
        </span>
        <span className="bc-pl-sub">
          Mondial {team?.bwfRank ? `#${team.bwfRank}` : "—"}
          {" · "}Elo {team?.elo != null ? <b>{team.elo}</b> : "—"}
          {team?.eloRank ? <span className="bc-pl-rank"> #{team.eloRank}</span> : null}
        </span>
      </td>
      <td className={`bc-proba${prob != null && prob >= 50 ? "" : " dim"}`}>{prob == null ? "—" : `${prob} %`}</td>
      {/* Match sans cote : les colonnes cotes/EV n'existent pas du tout
          (la carte affiche « pas de cote » dans son en-tête). */}
      {odds && selected.map((op) => {
        const odd = side === 1 ? odds?.books?.[op]?.odd1 : odds?.books?.[op]?.odd2;
        return (
          <td key={op} className={`oa-num${odd != null && odd === best ? " ba-best" : ""}`}>
            {fmtOdd(odd)}
          </td>
        );
      })}
      {odds && (
        <td>
          {evVal == null
            ? <span className="bc-ev dim">—</span>
            : <span className={`bc-ev${evVal > 0 ? " pos" : ""}`}>{fmtEv(evVal)}</span>}
        </td>
      )}
    </tr>
  );
}

export default function BetCard({ match, selectedBooks }) {
  const m = match;
  const [graphe, setGraphe] = useState(false);
  const [opGraphe, setOpGraphe] = useState(null);
  const selected = selectedBooks || [];
  const best1 = meilleureCote(m.odds, selected, 1);
  const best2 = meilleureCote(m.odds, selected, 2);
  const prob2 = m.probCal == null ? null : 100 - m.probCal;

  // Le graphe n'a d'intérêt que si UN MÊME opérateur a plusieurs relevés :
  // deux opérateurs à un relevé chacun ne donnent que des points isolés.
  const releves = (op) => m.odds?.books?.[op]?.points?.length || 0;
  const opsTracables = selected.filter((op) => releves(op) > 0);
  const nMax = Math.max(0, ...opsTracables.map(releves));
  const ouvrirGraphe = () => {
    setOpGraphe(opsTracables.reduce((a, b) => (releves(b) > releves(a) ? b : a)));
    setGraphe(true);
  };

  const gap = m.team1?.elo != null && m.team2?.elo != null ? Math.abs(m.team1.elo - m.team2.elo) : null;
  const nomDe = (side) => (side === 1 ? m.team1 : m.team2)?.players.map((p) => p.nameDisplay).join(" / ");

  return (
    <div className="card bc-card">
      <div className="oa-head">
        <span className="oa-disc">{m.eventName || "?"}</span>
        <span className="oa-round">{ROUND_LABEL[m.roundName] || m.roundName}</span>
        <Link className="oa-tmt" to={`/tournament/${m.tmtId}`}>{m.tournamentName}</Link>
        {/* Heure du match : planning BWF (matchTimeUtc) en priorité, sinon heure
            relevée chez les bookmakers, sinon dates du tournoi. Court en appoint. */}
        <span className="oa-when">
          {fmtHeureMatch(m.matchTimeUtc)
            ?? (m.odds?.startUtc ? fmtHeure(m.odds.startUtc) : `${m.date}${m.year ? ` ${m.year}` : ""}`)}
          {m.courtName ? ` · ${m.courtName}` : ""}
        </span>
        {!m.odds && <span className="muted">pas de cote</span>}
        {m.odds && (
          <button
            type="button"
            className="range-btn bc-graph"
            disabled={nMax < 2}
            title={nMax < 2
              ? "Aucun opérateur n'a encore plusieurs relevés — le graphe n'aurait qu'un point par courbe"
              : "Évolution des deux cotes du match"}
            onClick={ouvrirGraphe}
          >
            📈 ({nMax})
          </button>
        )}
        <Link
          className="range-btn bc-duel"
          title="Rejouer ce match dans le simulateur de duel"
          to={`/predictor?disc=${m.eventName}&a=${cleDuel(m.team1)}&b=${cleDuel(m.team2)}`}
        >
          ⚔️ Duel
        </Link>
      </div>

      <div className="table-scroll">
        <table className="ligne">
          <thead>
            <tr>
              <th>Joueur</th>
              <th>Préd.</th>
              {m.odds && selected.map((op) => <th key={op} className="oa-num">{BOOK_LABEL[op] || op}</th>)}
              {m.odds && <th>EV</th>}
            </tr>
          </thead>
          <tbody>
            <PlayerRow team={m.team1} prob={m.probCal} odds={m.odds} side={1} selected={selected} best={best1} />
            <PlayerRow team={m.team2} prob={prob2} odds={m.odds} side={2} selected={selected} best={best2} />
          </tbody>
        </table>
      </div>

      <p className="bc-pourquoi">
        {gap != null && <> <b>{m.team1.elo >= m.team2.elo ? m.team1.players[0]?.nameDisplay : m.team2.players[0]?.nameDisplay}</b> a +{gap} points d'Elo</>}
        {m.probCal != null && <> · proba calibrée sur 8 800 matchs ✓</>}
        {m.tags?.includes("value") && <> · <b>sous-coté BWF</b></>}
      </p>

      {graphe && m.odds && (
        <OddsModal open onClose={() => setGraphe(false)} title={`Cotes — ${nomDe(1)} vs ${nomDe(2)}`}>
          {opsTracables.length > 1 && (
            <div className="tabs">
              {opsTracables.map((op) => (
                <button key={op} type="button" className={`tab${opGraphe === op ? " active" : ""}`}
                        aria-pressed={opGraphe === op} onClick={() => setOpGraphe(op)}>
                  {BOOK_LABEL[op]} ({releves(op)})
                </button>
              ))}
            </div>
          )}
          <MatchOddsChart
            points={m.odds.books[opGraphe]?.points}
            label1={nomDe(1)}
            label2={nomDe(2)}
          />
        </OddsModal>
      )}
    </div>
  );
}

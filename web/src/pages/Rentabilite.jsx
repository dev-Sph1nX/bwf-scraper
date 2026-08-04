// web/src/pages/Rentabilite.jsx — « et si on avait misé 1 € sur chaque prono ? »
// Lit roi.json (généré par build-data via lib/roi.mjs) : 6 analyses de mise
// plate sur les matchs joués qui ont un prono ET des cotes. Chaque chiffre est
// traçable jusqu'aux paris individuels (journal `bets`, dépliable par tournoi).
import { Fragment, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };

const fmt = (v, digits = 1) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pc = (v, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt(v * 100, digits)} %`);
const eur = (v) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt(v, 2)} €`);
const ciTxt = (ci) => (ci ? `${pc(ci[0], 0)} à ${pc(ci[1], 0)}` : "—");
const trend = (v) => (v == null || v === 0 ? "flat" : v > 0 ? "up" : "down");

// Les 3 cellules d'un agrégat { n, staked, net, roi, ci } : paris, ROI, IC.
function AggCells({ agg }) {
  if (!agg || !agg.n) {
    return (<><td className="oa-num">—</td><td className="oa-num">—</td><td className="oa-num">—</td></>);
  }
  return (
    <>
      <td className="oa-num">{agg.n}</td>
      <td className="oa-num" title={`${agg.won} paris gagnés sur ${agg.n} · gain net ${eur(agg.net)} pour ${agg.staked} € misés`}>
        <span className={`form ${trend(agg.roi)}`}>{pc(agg.roi)}</span>
      </td>
      <td className="oa-num" title="Intervalle de confiance à 95 % (bootstrap) : la fourchette dans laquelle le vrai ROI a 95 chances sur 100 de se trouver. S'il contient 0 %, le résultat peut n'être que du hasard.">
        {ciTxt(agg.ci)}
      </td>
    </>
  );
}

const AGG_HEADS = ["Paris", "ROI", "IC 95 %"];
const aggHeads = (groups) =>
  groups.flatMap((g, i) => AGG_HEADS.map((h) => <th key={`${i}-${h}`} className="oa-num">{h}</th>));

// Journal des paris d'un tournoi (clôture) : la preuve de chaque ligne du tableau.
function BetDetail({ bets, tmtId }) {
  const rows = bets.filter((b) => b.tmtId === tmtId && b.instant === "close" && b.strategy !== "desaccord");
  if (!rows.length) return <p className="hint">Aucun pari à la clôture pour ce tournoi.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Match</th><th>Disc.</th><th className="oa-num">Proba du camp misé</th>
            <th>Stratégie</th><th>Camp misé</th><th className="oa-num">Cote (bookmaker)</th><th className="oa-num">Gain</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i}>
              <td>{b.team1} vs {b.team2}</td>
              <td>{b.disc}</td>
              <td className="oa-num">{b.side === 1 ? b.prob : 100 - b.prob} %</td>
              <td>{b.strategy === "value" ? `value (EV ${b.ev > 0 ? "+" : ""}${fmt(b.ev, 2)})` : b.strategy}</td>
              <td>{b.side === 1 ? b.team1 : b.team2}</td>
              <td className="oa-num">{fmt(b.odd, 2)} ({BOOK_LABEL[b.book] ?? b.book})</td>
              <td className="oa-num"><span className={`form ${b.won ? "up" : "down"}`}>{eur(b.gain)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Rentabilite() {
  const { setTitle } = useOutletContext();
  const [roi, setRoi] = useState(null);
  const [openTmt, setOpenTmt] = useState(null);
  useEffect(() => { setTitle("Rentabilité"); }, [setTitle]);
  useEffect(() => { getJSON("roi.json").then(setRoi).catch(() => setRoi(false)); }, []);

  if (roi === false) return <p className="hint">Étude de rentabilité indisponible (roi.json n'a pas pu être chargé).</p>;
  if (!roi) return <p className="hint">Chargement de l'étude…</p>;
  if (!roi.totalMatches) return <p className="hint">Aucun match avec prono et cotes pour l'instant — l'étude se remplira avec les prochains tournois.</p>;

  const { strategies, bands, evSweep, disagreement, byBook, bets } = roi;
  const favClose = strategies.favori.global.close;
  const valClose = strategies.value.global.close;

  return (
    <div className="roi-page">
      <div className="card">
        <h2>Comment lire cette page</h2>
        <p className="lead">
          On rejoue la saison : <b>1 € misé</b> sur chaque prono du modèle, aux cotes réelles
          (meilleure cote entre Betclic, Unibet et Winamax). Le <b>ROI</b> est le gain net rapporté
          à la mise totale : +5 % = 5 centimes gagnés par euro misé. Deux instants de pari :
          la cote d'<b>ouverture</b> (au lancement du marché, tôt) et la cote de <b>clôture</b>{" "}
          (juste avant le match). La clôture intègre toute l'information du marché : un modèle
          rentable contre la clôture l'est très probablement en vrai. Enfin, l'<b>IC 95 %</b> donne
          la fourchette d'incertitude : si elle contient 0 %, le résultat peut n'être que de la
          chance (ou de la malchance).
        </p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-value">{roi.totalMatches.toLocaleString("fr-FR")}</div>
          <div className="stat-label">matchs joués avec prono + cotes (saison 2026)</div>
        </div>
        <div className="stat">
          <div className="stat-value"><span className={`form ${trend(favClose.roi)}`}>{pc(favClose.roi)}</span></div>
          <div className="stat-label">ROI « favori » à la clôture ({favClose.n} paris)</div>
        </div>
        <div className="stat">
          <div className="stat-value"><span className={`form ${trend(valClose.roi)}`}>{pc(valClose.roi)}</span></div>
          <div className="stat-label">ROI « value EV+ » à la clôture ({valClose.n} paris)</div>
        </div>
      </div>

      <div className="card">
        <h2>Par tournoi</h2>
        <p className="lead">
          <b>Favori</b> : 1 € sur le camp que le modèle donne gagnant, à chaque match coté.{" "}
          <b>Value</b> : 1 € seulement quand la cote paie plus que notre probabilité (EV positive)
          — c'est le test « bat-on le marché ? ». Cliquer un tournoi déplie le journal de ses
          paris, ligne par ligne.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Tournoi</th>
                <th colSpan={3}>Favori — clôture</th>
                <th colSpan={3}>Value — clôture</th>
                <th colSpan={3}>Favori — ouverture</th>
                <th colSpan={3}>Value — ouverture</th>
              </tr>
              <tr>{aggHeads([0, 1, 2, 3])}</tr>
            </thead>
            <tbody>
              <tr>
                <td><b>Total saison</b></td>
                <AggCells agg={strategies.favori.global.close} />
                <AggCells agg={strategies.value.global.close} />
                <AggCells agg={strategies.favori.global.open} />
                <AggCells agg={strategies.value.global.open} />
              </tr>
              {strategies.favori.tournois.map((t) => {
                const v = strategies.value.tournois.find((x) => x.tmtId === t.tmtId);
                const open = openTmt === t.tmtId;
                return (
                  <Fragment key={t.tmtId}>
                    <tr>
                      <td>
                        <button type="button" className="linklike" aria-expanded={open}
                                onClick={() => setOpenTmt(open ? null : t.tmtId)}>
                          {open ? "▾" : "▸"} {t.name}
                        </button>
                      </td>
                      <AggCells agg={t.close} />
                      <AggCells agg={v?.close} />
                      <AggCells agg={t.open} />
                      <AggCells agg={v?.open} />
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={13} className="roi-detail">
                          <BetDetail bets={bets} tmtId={t.tmtId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Par tranche de confiance</h2>
        <p className="lead">
          Les paris « favori », regroupés par la probabilité annoncée par le modèle. Répond à :
          « et si je ne pariais que sur les quasi-certitudes ? » — attention, plus la confiance
          est haute, plus les cotes sont basses : un seul raté efface beaucoup de petits gains.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Confiance du modèle</th><th colSpan={3}>Clôture</th><th colSpan={3}>Ouverture</th></tr>
              <tr><th />{aggHeads([0, 1])}</tr>
            </thead>
            <tbody>
              {bands.map((b) => (
                <tr key={b.band}>
                  <td>{b.band} %</td>
                  <AggCells agg={b.close} />
                  <AggCells agg={b.open} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Exiger plus de marge : le seuil d'EV</h2>
        <p className="lead">
          La stratégie value avec un seuil de plus en plus exigeant. EV &gt; 0 mise dès que la
          cote paie mieux que notre probabilité ; EV &gt; 0,10 exige 10 centimes d'avantage
          théorique par euro misé. Plus de marge = moins de paris : ce tableau montre si la
          sélectivité paie.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Seuil</th><th colSpan={3}>Clôture</th><th colSpan={3}>Ouverture</th></tr>
              <tr><th />{aggHeads([0, 1])}</tr>
            </thead>
            <tbody>
              {evSweep.map((e) => (
                <tr key={e.threshold}>
                  <td>EV &gt; {fmt(e.threshold, 2)}</td>
                  <AggCells agg={e.close} />
                  <AggCells agg={e.open} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Quand on contredit le marché</h2>
        <p className="lead">
          Paris placés uniquement quand notre favori est l'outsider du bookmaker (cote supérieure
          à 2) : peu de paris, grosses cotes — le modèle voit-il des choses que le marché rate ?
          Avec si peu de paris, l'intervalle de confiance est très large : prudence.
        </p>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Instant</th><th className="oa-num">Paris</th><th className="oa-num">ROI</th><th className="oa-num">IC 95 %</th></tr></thead>
            <tbody>
              <tr><td>Clôture</td><AggCells agg={disagreement.close} /></tr>
              <tr><td>Ouverture</td><AggCells agg={disagreement.open} /></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Quel bookmaker paie le mieux ?</h2>
        <p className="lead">
          Chaque stratégie rejouée avec les cotes d'un <b>seul</b> bookmaker. Le « panier
          commun » ne garde que les matchs cotés par les trois : même liste de paris partout,
          seule comparaison équitable. « Tous ses matchs » reflète la réalité d'un compte unique.
          À noter : le tableau « Par tournoi » ci-dessus prend la meilleure des trois cotes —
          comparer plusieurs comptes rapporte déjà quelques points de ROI.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Bookmaker (favori, clôture)</th>
                <th colSpan={3}>Panier commun</th>
                <th colSpan={3}>Tous ses matchs</th>
              </tr>
              <tr>{aggHeads([0, 1])}</tr>
            </thead>
            <tbody>
              {byBook.map((b) => (
                <tr key={b.book}>
                  <td>{BOOK_LABEL[b.book] ?? b.book}</td>
                  <AggCells agg={b.favori.common.close} />
                  <AggCells agg={b.favori.all.close} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Mise plate 1 € par pari, probabilités figées d'avant match (modèle « Elo recalibré »,
          le même que le prédicteur et le backtest). Généré le {new Date(roi.generatedAt).toLocaleDateString("fr-FR")}.
        </p>
      </div>
    </div>
  );
}

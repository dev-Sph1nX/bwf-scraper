// web/src/pages/Rentabilite.jsx — « et si on avait misé 1 € sur chaque prono ? »
// Lit roi.json (généré par build-data via lib/roi.mjs) : 6 analyses de mise
// plate sur les matchs joués qui ont un prono ET des cotes. Chaque chiffre est
// traçable jusqu'aux paris individuels (journal `bets`, dépliable par tournoi).
import { Fragment, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const DISC_LABEL = { MS: "Simple hommes", WS: "Simple dames", MD: "Double hommes", WD: "Double dames", XD: "Double mixte" };

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

// Sommaire latéral : boutons + scrollIntoView (pas d'ancres href="#…", elles
// entreraient en conflit avec le HashRouter).
const SECTIONS = [
  { id: "roi-lecture", label: "Comment lire" },
  { id: "roi-tournois", label: "Par tournoi" },
  { id: "roi-disciplines", label: "Par discipline" },
  { id: "roi-tranches", label: "Confiance" },
  { id: "roi-seuil", label: "Seuil d'EV" },
  { id: "roi-clv", label: "CLV" },
  { id: "roi-desaccord", label: "Désaccord" },
  { id: "roi-books", label: "Bookmakers" },
];
const scrollToSection = (id) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

// Onglets de discipline (Toutes + celles présentes dans l'étude).
function DiscTabs({ discs, value, onChange }) {
  return (
    <div className="tabs">
      <button type="button" className={`tab ${value == null ? "active" : ""}`} onClick={() => onChange(null)}>
        Toutes
      </button>
      {discs.map((d) => (
        <button key={d} type="button" className={`tab ${value === d ? "active" : ""}`}
                title={DISC_LABEL[d] ?? d} onClick={() => onChange(d)}>
          {d}
        </button>
      ))}
    </div>
  );
}

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
  const [discBands, setDiscBands] = useState(null);
  const [discSweep, setDiscSweep] = useState(null);
  useEffect(() => { setTitle("Rentabilité"); }, [setTitle]);
  useEffect(() => { getJSON("roi.json").then(setRoi).catch(() => setRoi(false)); }, []);

  if (roi === false) return <p className="hint">Étude de rentabilité indisponible (roi.json n'a pas pu être chargé).</p>;
  if (!roi) return <p className="hint">Chargement de l'étude…</p>;
  if (!roi.totalMatches) return <p className="hint">Aucun match avec prono et cotes pour l'instant — l'étude se remplira avec les prochains tournois.</p>;

  const { strategies, bands, evSweep, disagreement, byBook, bets, clv, byDisc = [] } = roi;
  const favClose = strategies.favori.global.close;
  const valClose = strategies.value.global.close;
  const discs = byDisc.map((d) => d.disc);
  const bandsShown = discBands ? byDisc.find((d) => d.disc === discBands)?.bands ?? bands : bands;
  const sweepShown = discSweep ? byDisc.find((d) => d.disc === discSweep)?.evSweep ?? evSweep : evSweep;

  return (
    <div className="roi-page roi-layout">
      <nav className="roi-toc" aria-label="Sommaire de l'étude">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => scrollToSection(s.id)}>{s.label}</button>
        ))}
      </nav>
      <div className="roi-content">
      <div className="card" id="roi-lecture">
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

      <div className="card" id="roi-tournois">
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

      <div className="card" id="roi-disciplines">
        <h2>Par discipline</h2>
        <p className="lead">
          Les mêmes stratégies, découpées par tableau. Le modèle n'est pas aussi bon partout
          (le simple dames est sa discipline la plus prévisible) — et le marché non plus :
          c'est dans ces écarts que peut se nicher la rentabilité.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>Discipline</th>
                <th colSpan={3}>Favori — clôture</th>
                <th colSpan={3}>Value — clôture</th>
                <th colSpan={3}>Favori — ouverture</th>
                <th colSpan={3}>Value — ouverture</th>
              </tr>
              <tr>{aggHeads([0, 1, 2, 3])}</tr>
            </thead>
            <tbody>
              {byDisc.map((d) => (
                <tr key={d.disc}>
                  <td title={DISC_LABEL[d.disc] ?? d.disc}>{DISC_LABEL[d.disc] ?? d.disc} ({d.disc})</td>
                  <AggCells agg={d.favori.close} />
                  <AggCells agg={d.value.close} />
                  <AggCells agg={d.favori.open} />
                  <AggCells agg={d.value.open} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Garde-fou : découpage exploratoire — en regardant 5 disciplines, la meilleure paraît
          toujours bonne (biais de sélection). Aucune case n'est prouvée positive à ce stade.
        </p>
      </div>

      <div className="card" id="roi-tranches">
        <h2>Par tranche de confiance</h2>
        <p className="lead">
          Les paris « favori », regroupés par la probabilité annoncée par le modèle. Répond à :
          « et si je ne pariais que sur les quasi-certitudes ? » — attention, plus la confiance
          est haute, plus les cotes sont basses : un seul raté efface beaucoup de petits gains.
          Les onglets croisent avec la discipline (effectifs plus petits : lire l'IC d'abord).
        </p>
        <DiscTabs discs={discs} value={discBands} onChange={setDiscBands} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Confiance du modèle</th><th colSpan={3}>Clôture</th><th colSpan={3}>Ouverture</th></tr>
              <tr><th />{aggHeads([0, 1])}</tr>
            </thead>
            <tbody>
              {bandsShown.map((b) => (
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

      <div className="card" id="roi-seuil">
        <h2>Exiger plus de marge : le seuil d'EV</h2>
        <p className="lead">
          La stratégie value avec un seuil de plus en plus exigeant. EV &gt; 0 mise dès que la
          cote paie mieux que notre probabilité ; EV &gt; 0,10 exige 10 centimes d'avantage
          théorique par euro misé. Plus de marge = moins de paris : ce tableau montre si la
          sélectivité paie. Les onglets croisent avec la discipline.
        </p>
        <DiscTabs discs={discs} value={discSweep} onChange={setDiscSweep} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Seuil</th><th colSpan={3}>Clôture</th><th colSpan={3}>Ouverture</th></tr>
              <tr><th />{aggHeads([0, 1])}</tr>
            </thead>
            <tbody>
              {sweepShown.map((e) => (
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

      <div className="card" id="roi-clv">
        <h2>La CLV : bat-on la cote de clôture ?</h2>
        <p className="lead">
          Le test standard des parieurs professionnels. Pour chaque pari pris à l'<b>ouverture</b>,
          on compare la cote obtenue à la cote de <b>clôture</b> du même camp : si la cote a baissé
          entre-temps (CLV positive), le marché a fini par nous donner raison. Une CLV moyenne
          positive et prouvée est le signal d'un avantage réel — il apparaît bien avant que le
          ROI ne sorte du bruit, car il ne dépend pas de la chance des résultats.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Stratégie (paris à l'ouverture)</th>
                <th className="oa-num">Paris comparés</th>
                <th className="oa-num">Battent la clôture</th>
                <th className="oa-num">CLV moyenne</th>
                <th className="oa-num">IC 95 %</th>
                <th className="oa-num" title="ROI (à l'ouverture) des paris dont la cote a battu la clôture">ROI des CLV+</th>
                <th className="oa-num" title="ROI (à l'ouverture) des paris qui n'ont pas battu la clôture">ROI des autres</th>
              </tr>
            </thead>
            <tbody>
              {["favori", "value"].map((k) => {
                const c = clv?.[k];
                if (!c) return null;
                return (
                  <tr key={k}>
                    <td>{k === "favori" ? "Favori" : "Value EV+"}</td>
                    <td className="oa-num">{c.n}</td>
                    <td className="oa-num">{c.beatPct == null ? "—" : `${c.beat} (${fmt(c.beatPct * 100, 1)} %)`}</td>
                    <td className="oa-num"><span className={`form ${trend(c.avg)}`}>{pc(c.avg, 2)}</span></td>
                    <td className="oa-num">{c.ci ? `${pc(c.ci[0], 2)} à ${pc(c.ci[1], 2)}` : "—"}</td>
                    <td className="oa-num"><span className={`form ${trend(c.roiBeat.roi)}`}>{pc(c.roiBeat.roi)}</span> ({c.roiBeat.n})</td>
                    <td className="oa-num"><span className={`form ${trend(c.roiOther.roi)}`}>{pc(c.roiOther.roi)}</span> ({c.roiOther.n})</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Lecture : une CLV moyenne positive dont l'IC exclut 0 prouve que le modèle détecte de
          la valeur avant le marché. Si le ROI reste négatif malgré tout, l'avantage existe mais
          ne couvre pas encore la marge du bookmaker.
        </p>
      </div>

      <div className="card" id="roi-desaccord">
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

      <div className="card" id="roi-books">
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
    </div>
  );
}

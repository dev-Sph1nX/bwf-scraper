import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

// Écran « Fiabilité » : juge le MODÈLE, pas le parieur.
//
// Il répond à trois questions par la mesure, jamais par l'intuition :
//   1. notre Elo vaut-il mieux que des règles triviales ?
//   2. quelle est l'incertitude propre à chaque discipline ?
//   3. la probabilité annoncée est-elle honnête ?
//
// Parti pris d'affichage : le taux de réussite est en colonne principale parce
// que c'est la seule grandeur qui se lit sans formation ; le score de Brier
// l'accompagne avec la seule mention « plus bas = mieux ». Et un écart dont les
// intervalles de confiance se chevauchent est affiché comme NON DÉPARTAGEABLE
// plutôt que présenté comme un résultat.

const DISC_LABEL = {
  MS: "Simple messieurs", WS: "Simple dames", MD: "Double messieurs",
  WD: "Double dames", XD: "Double mixte",
};

const pc = (v, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)} %`);
const pt = (v, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)} pt`);
const nf = (n) => (n ?? 0).toLocaleString("fr-FR");
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}h${p(d.getMinutes())}`;
};

// --- Courbe de calibration ------------------------------------------------
// SVG en viewBox pour rester responsive. La diagonale est la référence :
// au-dessus = le favori gagne plus souvent qu'annoncé (modèle trop prudent),
// en dessous = excès de confiance.
//
// Le viewBox est VOLONTAIREMENT étroit (360 unités) et la largeur de rendu est
// plafonnée à 380px : un viewBox large mis à l'échelle rétrécit le texte à
// proportion, et un `font-size: 11` dans un viewBox de 720 rendu sur 305px
// s'affiche à 5px — illisible (c'est le défaut d'EloChart). Ici l'échelle reste
// entre 0,85 (à 375px) et 1,06 (au plafond), donc le texte tient ses ~11px
// partout. Un graphe de diagnostic n'a pas besoin d'être immense sur desktop.
const W = 360, H = 300, PAD = { l: 40, r: 14, t: 14, b: 38 };
const PW = W - PAD.l - PAD.r, PH = H - PAD.t - PAD.b;
const PLOT_MAX = 380;

function CalibrationChart({ bins }) {
  const remplis = (bins || []).filter((b) => b.n > 0 && b.predicted != null);
  if (remplis.length < 2) return <p className="muted">Pas assez de données pour tracer la calibration.</p>;

  // domaine 50 % -> 100 % sur les deux axes
  const x = (p) => PAD.l + ((p - 0.5) / 0.5) * PW;
  const y = (p) => PAD.t + (1 - (p - 0.5) / 0.5) * PH;
  const ticks = [0.5, 0.625, 0.75, 0.875, 1];

  const ligne = remplis.map((b, i) => `${i ? "L" : "M"} ${x(b.predicted).toFixed(1)} ${y(b.observed).toFixed(1)}`).join(" ");
  const nMax = Math.max(...remplis.map((b) => b.n));

  return (
    <div className="chart-plot" style={{ maxWidth: PLOT_MAX }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Courbe de calibration : ${remplis.length} tranches de probabilité, comparées à la diagonale de référence`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + PW} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(t * 100)}</text>
            <text x={x(t)} y={H - 18} textAnchor="middle" fontSize="11" fill="var(--muted)">{Math.round(t * 100)}</text>
          </g>
        ))}

        {/* diagonale : modèle parfaitement calibré */}
        <line x1={x(0.5)} y1={y(0.5)} x2={x(1)} y2={y(1)}
              stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" />

        <path d={ligne} fill="none" stroke="var(--accent)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
        {remplis.map((b) => (
          <circle key={b.bin} cx={x(b.predicted)} cy={y(b.observed)}
                  r={3 + 3 * Math.sqrt(b.n / nMax)}
                  fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5">
            <title>{`${b.bin} % annoncé : ${pc(b.observed)} observé sur ${nf(b.n)} matchs`}</title>
          </circle>
        ))}

        <text x={PAD.l + PW / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--muted)">
          probabilité annoncée (%)
        </text>
      </svg>
    </div>
  );
}

export default function Reliability() {
  const { setTitle } = useOutletContext();
  const [d, setD] = useState(null);

  useEffect(() => { setTitle("Fiabilité du modèle"); }, [setTitle]);
  useEffect(() => { getJSON("backtest.json").then(setD).catch(() => setD(false)); }, []);

  if (d === false) {
    return (
      <div className="card">
        <h2>Fiabilité du modèle</h2>
        <p className="muted">
          Rapport indisponible. Il est produit par <code>npm run backtest</code>,
          qui rejoue tout l'historique des matchs.
        </p>
      </div>
    );
  }
  if (!d) return <div className="card muted">Chargement…</div>;

  const elo = (d.models || []).find((m) => m.key === "elo");
  const duelCle = (d.duels || []).find((x) => x.a === "bwf" && x.b === "elo");
  const maxBrier = Math.max(...(d.byDiscipline || []).map((x) => x.brier.value), 0.001);

  // Lecture automatique de la calibration : on ne laisse pas le lecteur
  // interpréter seul un écart de 3 points.
  const bins = (d.calibration || []).filter((b) => b.n > 0);
  const biais = bins.length
    ? bins.reduce((s, b) => s + b.n * (b.observed - b.predicted), 0) / bins.reduce((s, b) => s + b.n, 0)
    : null;
  const sousConf = bins.filter((b) => b.observed > b.predicted).length;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{pc(elo?.accuracy?.value)}</div>
          <div className="stat-label">Réussite de l'Elo</div>
        </div>
        <div className="stat">
          <div className="stat-value">{elo?.brier?.value?.toFixed(3) ?? "—"}</div>
          <div className="stat-label">Brier (plus bas = mieux)</div>
        </div>
        <div className="stat">
          <div className="stat-value">{nf(d.coverage?.rows)}</div>
          <div className="stat-label">Matchs rejoués</div>
        </div>
        <div className="stat">
          <div className="stat-value">{pt(biais)}</div>
          <div className="stat-label">Biais de confiance</div>
        </div>
      </div>

      {/* 1 — la question qui conditionne tout le reste */}
      <div className="card">
        <h2>Notre Elo vaut-il mieux que des règles triviales&nbsp;?</h2>
        <p className="lead">
          Chaque match est prédit avec l'état des connaissances <b>d'avant ce match</b>,
          jamais avec l'état final. Le chiffre intéressant n'est pas celui de chaque
          ligne, c'est <b>l'écart entre les lignes</b>.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Méthode</th><th>Réussite</th><th>Intervalle</th>
                <th>Brier</th><th>Matchs</th><th>Couverture</th>
              </tr>
            </thead>
            <tbody>
              {(d.models || []).map((m) => (
                <tr key={m.key}>
                  <td>
                    <b>{m.label}</b>
                    {m.binary && <> <span className="badge">sans nuance</span></>}
                  </td>
                  <td><b>{pc(m.accuracy?.value)}</b></td>
                  <td className="muted">
                    {m.accuracy?.lo == null ? "—" : `${pc(m.accuracy.lo)} – ${pc(m.accuracy.hi)}`}
                  </td>
                  <td>{m.brier?.value?.toFixed(3) ?? "—"}</td>
                  <td>{nf(m.n)}</td>
                  <td className="muted">{pc(m.coverage, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          « Sans nuance » = la méthode désigne un vainqueur sans dire à quel point elle
          est sûre. Elle peut avoir souvent raison tout en étant mauvaise pour parier,
          car elle ne permet pas de dimensionner une mise — c'est ce que révèle son
          score de Brier.
        </p>
      </div>

      {/* 2 — les duels, chacun sur son intersection */}
      <div className="card">
        <h2>Duels, chacun sur son intersection réelle</h2>
        <p className="lead">
          Les méthodes n'ont pas la même couverture : toutes les paires ne sont pas
          têtes de série, tous les joueurs ne sont pas classés. Chaque duel est donc
          mesuré sur les matchs où <b>les deux</b> se prononcent.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Duel</th><th>Réussite</th><th>Écart</th><th>Brier</th><th>Matchs</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {(d.duels || []).map((x) => (
                <tr key={`${x.a}-${x.b}`}>
                  <td>{x.aLabel} <span className="muted">vs</span> <b>{x.bLabel}</b></td>
                  <td>{pc(x.aAccuracy?.value)} → <b>{pc(x.bAccuracy?.value)}</b></td>
                  <td>
                    <span className={`form ${x.deltaAccuracy > 0 ? "up" : x.deltaAccuracy < 0 ? "down" : "flat"}`}>
                      {pt(x.deltaAccuracy)}
                    </span>
                  </td>
                  <td className="muted">{x.aBrier?.toFixed(3)} → {x.bBrier?.toFixed(3)}</td>
                  <td>{nf(x.n)}</td>
                  <td>
                    {x.separable
                      ? <span className="badge post">écart réel</span>
                      : <span className="badge future">non départageable</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {duelCle && (
          <p className="lead">
            {duelCle.separable ? (
              <>
                <b>Conclusion :</b> l'Elo bat le classement mondial officiel de{" "}
                <b>{pt(duelCle.deltaAccuracy)}</b> sur {nf(duelCle.n)} matchs, et les
                intervalles de confiance sont <b>disjoints</b> — l'écart est réel, pas
                du bruit. L'écart de Brier ({duelCle.aBrier.toFixed(3)} contre{" "}
                {duelCle.bBrier.toFixed(3)}) est plus net encore.
              </>
            ) : (
              <>
                <b>Conclusion :</b> sur {nf(duelCle.n)} matchs, l'écart entre l'Elo et le
                classement mondial <b>n'est pas départageable</b> — les intervalles de
                confiance se chevauchent.
              </>
            )}
          </p>
        )}
      </div>

      {/* 3 — prévisibilité par discipline */}
      <div className="card">
        <h2>Prévisibilité par discipline</h2>
        <p className="lead">
          Mesuré à <b>information constante</b> : le favori est toujours celui que
          l'Elo désigne, pour que les disciplines soient comparables entre elles.
          Plus le score de Brier est bas, plus la discipline est prévisible.
        </p>
        <div className="bars">
          {(d.byDiscipline || []).map((x) => (
            <div className="bar-row" key={x.disc}>
              {/* Pas de badge ici : il forcerait un retour à la ligne dans un
                  libellé déjà contraint, et « non départageable » se comprend
                  mieux avec l'intervalle du tableau ci-dessous. */}
              <span className="bar-label">{DISC_LABEL[x.disc] || x.disc}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${(x.brier.value / maxBrier) * 100}%` }} />
              </span>
              <span className="bar-val">{x.brier.value.toFixed(3)}</span>
            </div>
          ))}
        </div>
        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr><th>Discipline</th><th>Brier</th><th>Le favori gagne</th><th>Surprises</th><th>Matchs</th></tr>
            </thead>
            <tbody>
              {(d.byDiscipline || []).map((x) => (
                <tr key={x.disc}>
                  <td><b>{DISC_LABEL[x.disc] || x.disc}</b></td>
                  <td>
                    {x.brier.value.toFixed(3)}{" "}
                    <span className="muted">± {((x.brier.hi - x.brier.lo) / 2).toFixed(3)}</span>
                  </td>
                  <td>{pc(x.favWinRate)}</td>
                  <td>{pc(x.upsetRate)}</td>
                  <td>{nf(x.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(d.byDiscipline?.[0]?.bands || []).length > 0 && (
          <>
            <h2 style={{ marginTop: 18 }}>Surprises par niveau de confiance</h2>
            <p className="lead">
              Le taux global est trompeur : un match donné à 51 % y compte autant
              qu'un match donné à 95 %. C'est la colonne <b>Francs</b> qui départage
              réellement les disciplines — là, le modèle est affirmatif dans tous les cas.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Discipline</th>
                    {d.byDiscipline[0].bands.map((b) => (
                      <th key={b.key}>{b.label}<br /><span className="muted">{b.range}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.byDiscipline.map((x) => (
                    <tr key={x.disc}>
                      <td><b>{DISC_LABEL[x.disc] || x.disc}</b></td>
                      {x.bands.map((b) => (
                        <td key={b.key}>
                          {b.upsetRate == null ? "—" : pc(b.upsetRate)}
                          <br /><span className="muted">{nf(b.n)} matchs</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Sur les matchs serrés, toutes les disciplines se tiennent (41 à 44 %) :
              un pile-ou-face reste un pile-ou-face. L'écart réel se lit sur les matchs
              francs, où le simple messieurs surprend presque deux fois plus que le
              simple dames.
            </p>
          </>
        )}

        {(d.indistinguishable || []).length > 0 && (
          <p className="hint">
            <b>Non départageables</b> (intervalles qui se chevauchent) :{" "}
            {d.indistinguishable.map((p) => p.map((c) => DISC_LABEL[c] || c).join(" / ")).join(", ")}.
            Il serait abusif de les traiter différemment dans le modèle — l'écart
            observé entre elles peut n'être que du bruit d'échantillonnage.
          </p>
        )}
      </div>

      {/* 4 — calibration */}
      <div className="card">
        <h2>La probabilité annoncée est-elle honnête&nbsp;?</h2>
        <p className="lead">
          Quand le modèle annonce 70 %, le favori gagne-t-il vraiment 70 % du temps ?
          Les points sur la diagonale signifient oui. <b>Au-dessus</b> : le modèle est
          trop prudent. <b>En dessous</b> : il est trop confiant.
        </p>
        <div className="chart">
          <div className="chart-legend">
            <span className="chart-leg">
              <span className="chart-leg-swatch" style={{ background: "var(--accent)" }} />
              <span className="chart-leg-name">taux observé (taille = nombre de matchs)</span>
            </span>
            <span className="chart-leg">
              <span className="chart-leg-swatch" style={{ background: "var(--muted)" }} />
              <span className="chart-leg-name">calibration parfaite</span>
            </span>
          </div>
          <CalibrationChart bins={d.calibration} />
        </div>

        {biais != null && (
          <p className="lead">
            <b>Lecture :</b> le biais moyen est de <b>{pt(biais)}</b>, et{" "}
            <b>{sousConf} tranche{sousConf > 1 ? "s" : ""} sur {bins.length}</b>{" "}
            {biais > 0 ? "vont dans le même sens" : "montrent un excès de confiance"}.
            {biais > 0 && (
              <> Le modèle est donc <b>trop prudent</b> : il annonce moins que ce qui se
              réalise.</>
            )}
          </p>
        )}
        {biais > 0 && (
          <p className="hint">
            Conséquence pour parier : si le favori est sous-estimé, l'outsider est
            mécaniquement <b>surestimé</b> de la même quantité. Le modèle signalerait
            donc de la « value » sur des outsiders qui n'en ont pas — c'est le sens dans
            lequel on perd du capital. À corriger <b>avant</b> tout calcul de valeur
            attendue ou de mise.
          </p>
        )}

        <div className="table-scroll" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr><th>Tranche annoncée</th><th>Annoncé</th><th>Observé</th><th>Écart</th><th>Matchs</th></tr>
            </thead>
            <tbody>
              {bins.map((b) => (
                <tr key={b.bin}>
                  <td>{b.bin} %</td>
                  <td>{pc(b.predicted)}</td>
                  <td><b>{pc(b.observed)}</b></td>
                  <td>
                    <span className={`form ${b.observed > b.predicted ? "up" : b.observed < b.predicted ? "down" : "flat"}`}>
                      {pt(b.observed - b.predicted)}
                    </span>
                  </td>
                  <td>{nf(b.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* méthode */}
      <div className="card">
        <h2>Méthode</h2>
        <p className="lead">
          Rejoué sur <b>{nf(d.coverage?.rows)}</b> matchs
          {d.coverage?.from && <> du <b>{d.coverage.from}</b> au <b>{d.coverage.to}</b></>},
          avec <b>{d.coverage?.publications}</b> publications hebdomadaires du classement
          mondial. {nf(d.coverage?.walkovers)} forfaits exclus : ce ne sont pas des matchs
          à prédire.
        </p>
        <p className="hint">
          Intervalles de confiance à 95 % par bootstrap ({nf(d.method?.bootstrapDraws)} tirages,
          graine fixe) : deux exécutions donnent exactement les mêmes bornes, sans quoi un
          écart entre disciplines pourrait apparaître ou disparaître au hasard.
          Généré le {fmtDateTime(d.generatedAt)}.
        </p>
      </div>
    </>
  );
}

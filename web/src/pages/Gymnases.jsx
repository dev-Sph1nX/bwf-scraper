// web/src/pages/Gymnases.jsx — « le marché des 3 sets est-il rentable dans
// certains gymnases ? ». Lit gymnases-3sets.json, produit par
// measures/mesure-rentabilite-gymnase.mjs et recopié par build-data.
//
// Le fil de la page suit celui de l'étude : le verdict d'abord, puis
// l'arithmétique qui l'explique, le détail lieu par lieu, et enfin le test du
// hasard — celui qui répond à « oui mais tel gymnase gagne ! ».
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

const fmt = (v, d = 1) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pc = (v, d = 1) => (v == null ? "—" : `${fmt(v * 100, d)} %`);
const signed = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt(v * 100, d)} %`);
const pts = (v, d = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${fmt(v * 100, d)} pt`);
const trend = (v) => (v == null || v === 0 ? "flat" : v > 0 ? "up" : "down");

const SECTIONS = [
  { id: "gy-verdict", label: "Le verdict" },
  { id: "gy-arithmetique", label: "L'arithmétique" },
  { id: "gy-tableau", label: "Par gymnase" },
  { id: "gy-hasard", label: "Le test du hasard" },
  { id: "gy-methode", label: "Méthode" },
];
const scrollToSection = (id) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

// Barre d'un taux de 3 sets, sur une échelle commune 0-60 % (au-delà, aucune
// valeur observée : étirer l'échelle jusqu'à 100 % écraserait les écarts).
function TauxBar({ label, value, hint, goal = false }) {
  return (
    <div className="bar-row">
      <div className="bar-label">{label}{hint && <><br /><small>{hint}</small></>}</div>
      <div className="bar-track">
        <span className={`bar-fill ${goal ? "goal" : ""}`} style={{ width: `${Math.min(100, (value / 0.6) * 100)}%` }} />
      </div>
      <div className="bar-val">{pc(value)}</div>
    </div>
  );
}

export default function Gymnases() {
  const { setTitle } = useOutletContext();
  const [etude, setEtude] = useState(null);
  useEffect(() => { setTitle("Gymnases — marché des 3 sets"); }, [setTitle]);
  useEffect(() => { getJSON("gymnases-3sets.json").then(setEtude).catch(() => setEtude(false)); }, []);

  if (etude === false) {
    return (
      <p className="hint">
        Étude indisponible — relancer <code>node measures/mesure-rentabilite-gymnase.mjs</code>
        {" "}puis <code>npm run build-data</code>.
      </p>
    );
  }
  if (!etude) return <p className="hint">Chargement de l'étude…</p>;
  if (!etude.lieux?.length) return <p className="hint">Aucun gymnase n'atteint le minimum de matchs cotés — l'étude se remplira avec les prochains tournois.</p>;

  const { global: g, lieux, hasard: h } = etude;
  const meilleur = lieux[0];
  const manque = g.seuilRentable - g.observe;

  return (
    <div className="roi-page roi-layout">
      <nav className="roi-toc" aria-label="Sommaire de l'étude">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" onClick={() => scrollToSection(s.id)}>{s.label}</button>
        ))}
      </nav>

      <div className="roi-content">
        <div className="card" id="gy-verdict">
          <h2>Le verdict</h2>
          <p className="lead">
            L'idée testée : certains gymnases produisent durablement plus de matchs en 3 manches
            que d'autres, et le bookmaker n'en tient pas compte — son prix est le même partout.
            C'est vrai. Mais parier dessus perd de l'argent <b>dans chacun des {lieux.length} gymnases</b>{" "}
            mesurés, sans exception. Le signal existe ; il est environ deux fois trop petit pour
            franchir la commission du bookmaker.
          </p>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">0</div>
              <div className="stat-label">gymnase rentable sur les {lieux.length} mesurés</div>
            </div>
            <div className="stat">
              <div className="stat-value"><span className={`form ${trend(meilleur.roi3)}`}>{signed(meilleur.roi3)}</span></div>
              <div className="stat-label">le meilleur d'entre eux ({meilleur.label}, {meilleur.n} paris)</div>
            </div>
            <div className="stat">
              <div className="stat-value"><span className={`form ${trend(g.roi3)}`}>{signed(g.roi3)}</span></div>
              <div className="stat-label">parier « 3 sets » partout ({g.nMatchs.toLocaleString("fr-FR")} paris)</div>
            </div>
            <div className="stat">
              <div className="stat-value">{pc(g.marge)}</div>
              <div className="stat-label">commission du bookmaker sur ce marché</div>
            </div>
          </div>
        </div>

        <div className="card" id="gy-arithmetique">
          <h2>L'arithmétique, en une image</h2>
          <p className="lead">
            Un pari « 3 sets » est payé à une cote qui impose un seuil : il faut gagner{" "}
            <b>au moins {pc(g.seuilRentable)} du temps</b> pour ne rien perdre. Or les matchs vont
            en 3 manches {pc(g.observe)} du temps. L'écart, {pts(manque)}, est ce que le bookmaker
            garde — et aucun gymnase ne le comble : même {meilleur.label}, le plus « chaud » du
            circuit, plafonne à {pc(meilleur.observe)}.
          </p>
          <div className="bars gy">
            <TauxBar label="Taux réel de 3 sets" hint="tous gymnases confondus" value={g.observe} />
            <TauxBar label={`Le meilleur gymnase`} hint={meilleur.label} value={meilleur.observe} />
            <TauxBar label="Seuil pour être rentable" hint="imposé par la cote" value={g.seuilRentable} goal />
          </div>
          <p className="hint">
            Échelle commune de 0 à 60 %. La barre encadrée est l'objectif à atteindre ; les deux
            autres sont la réalité. Il manque {pts(g.seuilRentable - meilleur.observe)} au meilleur
            gymnase du circuit.
          </p>
        </div>

        <div className="card" id="gy-tableau">
          <h2>Gymnase par gymnase</h2>
          <p className="lead">
            <b>Réel</b> : part des matchs allés en 3 manches. <b>Prix</b> : ce que le bookmaker
            facturait, converti en probabilité (commission retirée). <b>Écart</b> : notre avantage
            sur lui — positif signifie que le lieu produit plus de 3 manches que le prix ne le dit.
            <b> ROI</b> : ce qu'aurait rapporté 1 € misé sur chaque match, à la meilleure cote des
            trois opérateurs. La dernière colonne parie l'inverse (« 2 manches ») : elle perd aussi,
            ce qui interdit la stratégie miroir.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Gymnase</th>
                  <th className="oa-num">Paris</th>
                  <th className="oa-num">Réel</th>
                  <th className="oa-num">Prix</th>
                  <th className="oa-num">Écart</th>
                  <th className="oa-num">ROI « 3 sets »</th>
                  <th className="oa-num">IC 95 %</th>
                  <th className="oa-num">ROI « 2 sets »</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Tous gymnases</b></td>
                  <td className="oa-num">{g.nMatchs.toLocaleString("fr-FR")}</td>
                  <td className="oa-num">{pc(g.observe)}</td>
                  <td className="oa-num">{pc(g.marche)}</td>
                  <td className="oa-num">{pts(g.observe - g.marche)}</td>
                  <td className="oa-num"><span className={`form ${trend(g.roi3)}`}>{signed(g.roi3)}</span></td>
                  <td className="oa-num">{signed(g.ci3[0], 0)} à {signed(g.ci3[1], 0)}</td>
                  <td className="oa-num">—</td>
                </tr>
                {lieux.map((L) => (
                  <tr key={L.venue}>
                    <td title={`${L.tournois} tournoi(s), saisons ${L.annees.join(" et ")}`}>{L.label}</td>
                    <td className="oa-num">{L.n}</td>
                    <td className="oa-num">{pc(L.observe)}</td>
                    <td className="oa-num">{pc(L.marche)}</td>
                    <td className="oa-num"><span className={`form ${trend(L.avantage)}`}>{pts(L.avantage)}</span></td>
                    <td className="oa-num"><span className={`form ${trend(L.roi3)}`}>{signed(L.roi3)}</span></td>
                    <td className="oa-num">{signed(L.ci3[0], 0)} à {signed(L.ci3[1], 0)}</td>
                    <td className="oa-num">{signed(L.roi2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Trié par ROI décroissant. Seuls les gymnases avec au moins {etude.minN} matchs cotés
            figurent ici. L'intervalle de confiance regroupe les matchs par tournoi (ceux d'un même
            tournoi se ressemblent : les compter comme indépendants gonflerait la précision).
          </p>
        </div>

        <div className="card" id="gy-hasard">
          <h2>« Oui, mais ce gymnase-là gagne ! » — le test du hasard</h2>
          <p className="lead">
            Quand on examine {h.nLieuxEligibles} gymnases, le meilleur paraît toujours bon, même si
            aucun n'a le moindre avantage : c'est le piège qui avait déjà fait croire à une piste
            « simple dames » en 2026. On le chiffre plutôt que de l'invoquer. On rejoue{" "}
            {etude.tirages.toLocaleString("fr-FR")} saisons dans lesquelles <b>le bookmaker a raison
            partout</b> — aux vraies cotes, avec les vrais gymnases — et on regarde ce que le
            hasard seul fabrique.
          </p>
          <div className="stats">
            <div className="stat">
              <div className="stat-value">{pc(h.auMoinsUn, 0)}</div>
              <div className="stat-label">des saisons de pur hasard montrent au moins un gymnase « rentable »</div>
            </div>
            <div className="stat">
              <div className="stat-value">{signed(h.q95Simulee)}</div>
              <div className="stat-label">ROI que le hasard donne au meilleur gymnase, 1 fois sur 20</div>
            </div>
            <div className="stat">
              <div className="stat-value"><span className={`form ${trend(h.meilleurReel.roi3)}`}>{signed(h.meilleurReel.roi3)}</span></div>
              <div className="stat-label">notre meilleur gymnase réel, très en deçà</div>
            </div>
          </div>
          <p className="lead">
            Autrement dit : même sans le moindre avantage, il y avait <b>{pc(h.auMoinsUn, 0)} de
            chances</b> qu'un gymnase paraisse gagnant et nous fasse croire à un filon. Dans les
            faits, <b>aucun ne l'est</b>, et notre meilleur résultat réel ({signed(h.meilleurReel.roi3)})
            est moins bon que ce que le hasard produit dans {pc(h.pValeur, 0)} des saisons simulées.
            Il n'y a rien à chercher de ce côté : ce n'est pas « pas encore prouvé », c'est mesuré.
          </p>
        </div>

        <div className="card" id="gy-methode">
          <h2>Méthode</h2>
          <p className="lead">
            {g.nMatchs.toLocaleString("fr-FR")} matchs cotés sur le marché du nombre de manches
            ({g.nTournois} tournois, saisons {etude.anneesJugees.join(" et ")}), croisés avec le lieu
            de chaque tournoi. Le prix du marché est pris à la clôture, en consensus des opérateurs
            et commission retirée ; la mise, elle, prend la <b>meilleure</b> des trois cotes
            disponibles — l'hypothèse la plus favorable au parieur. Aucune donnée du futur n'entre
            dans le calcul : la réputation d'un gymnase n'est construite qu'avec ses saisons
            passées.
          </p>
          <p className="hint">
            Étude générée le {new Date(etude.genereLe).toLocaleDateString("fr-FR")} par{" "}
            <code>node measures/mesure-rentabilite-gymnase.mjs</code>. Le détail des verdicts et
            leur historique vivent dans le journal des mesures du dépôt (§10.7 et §10.12).
          </p>
        </div>
      </div>
    </div>
  );
}

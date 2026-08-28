// web/src/pages/GuidePari.jsx — « quels matchs parier, et quoi exactement ? »
// Lit guide-totaux.json (généré par build-data via lib/guide-totaux.mjs) : les
// matchs à venir cotés en totaux chez Betclic, passés au crible de la règle
// SCELLÉE « over sur rel ≤ −2 » (bwf-playground/regle-rel-moins-2, 2026-08-28).
// La page ne calcule rien : elle affiche les conseils tels que produits au
// build — toute logique de règle vit côté données, jamais côté écran.
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

const DISC_LABEL = { MS: "Simple hommes", WS: "Simple dames", MD: "Double hommes", WD: "Double dames", XD: "Double mixte" };

const quand = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })
    + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};
const ageHeures = (iso, ref) => {
  if (!iso || !ref) return null;
  const h = (new Date(ref) - new Date(iso)) / 36e5;
  return h < 0 ? null : h;
};
const cote = (v) => (v == null ? "—" : v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function GuidePari() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  useEffect(() => { setTitle("Guide de pari — totaux"); }, [setTitle]);
  useEffect(() => { getJSON("guide-totaux.json").then(setData).catch(() => setData(false)); }, []);

  if (data === false) return <p className="hint">Guide indisponible — données non générées (relancer build-data).</p>;
  if (!data) return <p>Chargement…</p>;

  const conseils = data.matches
    .filter((m) => m.nConseils > 0)
    .flatMap((m) => m.lignes.filter((l) => l.conseil).map((l) => ({ ...m, ligne: l })));
  const sansPari = data.matches.filter((m) => m.nConseils === 0);

  return (
    <>
      <div className="card">
        <h2>La règle, en une phrase</h2>
        <p className="lead">
          Quand Betclic place sa barre de total de points au moins <b>2 points sous
          la barre habituelle</b> de la discipline ({DISC_LABEL.MS} / {DISC_LABEL.MD} /{" "}
          {DISC_LABEL.XD} : 77,5 · {DISC_LABEL.WS} / {DISC_LABEL.WD} : 75,5),
          parier <b>PLUS (over)</b>, au prix affiché, <b>toujours la même mise</b>.
          Rien d'autre — pas d'intuition, pas d'exception.
        </p>
        <p className="hint">
          ⚠️ Règle <b>non prouvée</b> : elle est en test scellé jusqu'à fin 2027
          (pré-enregistrement du {data.regle?.scelle ?? "2026-08-28"}). Sur l'historique elle a rendu
          +0,7 % (2025) puis +8,9 % (2026) — chiffres découverts après coup, sans valeur de preuve.
          Ne miser que de l'argent qu'on peut perdre, et noter chaque ticket
          (cote obtenue, mise acceptée) : c'est la seule mesure de la « misabilité ».
        </p>
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-value">{conseils.length}</div><div className="stat-label">paris conseillés</div></div>
        <div className="stat"><div className="stat-value">{data.matches.length}</div><div className="stat-label">matchs à venir cotés en totaux</div></div>
        <div className="stat"><div className="stat-value">{quand(data.generatedAt)}</div><div className="stat-label">dernier relevé du guide</div></div>
      </div>

      <div className="card">
        <h2>Paris à faire</h2>
        {conseils.length === 0 ? (
          <p className="hint">
            Aucun pari conseillé pour l'instant. Betclic publie ses lignes de
            totaux environ 12 h avant les matchs : la liste se remplit d'elle-même
            la veille des tournois (relevé automatique toutes les 6 h).
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                {/* Le pari et la cote d'abord : sur mobile (scroll horizontal),
                    l'action doit être visible sans scroller. */}
                <tr>
                  <th>Quand</th><th className="oa-num">Pari</th><th className="oa-num">Cote</th>
                  <th>Match</th><th>Discipline</th><th>Tournoi</th><th className="oa-num">Écart à la barre</th>
                </tr>
              </thead>
              <tbody>
                {conseils.map((c, i) => {
                  const age = ageHeures(c.totalsAt, data.generatedAt);
                  return (
                    <tr key={i}>
                      <td>{quand(c.startUtc)}</td>
                      <td className="oa-num"><b>OVER {String(c.ligne.n).replace(".", ",")}</b></td>
                      <td className="oa-num" title={age == null ? "" : `Cote relevée il y a ${age.toFixed(0)} h — vérifier le prix au moment de miser`}>
                        {cote(c.ligne.over)}
                      </td>
                      <td>{c.p1} <span className="hint">vs</span> {c.p2}</td>
                      <td title={DISC_LABEL[c.discipline] ?? ""}>{c.discipline ?? "—"}</td>
                      <td>{c.tournament ?? "—"}</td>
                      <td className="oa-num" title={`Barre habituelle de la discipline : ${String(c.barre).replace(".", ",")}`}>
                        {String(c.ligne.rel).replace(".", ",")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Cotés, mais rien à jouer</h2>
        {sansPari.length === 0 ? (
          <p className="hint">Aucun autre match coté en totaux pour l'instant.</p>
        ) : (
          <>
            <p className="hint">
              Ces matchs ont des lignes de totaux, mais aucune barre n'est 2 points
              sous la normale : la règle dit de <b>ne pas parier</b>. Les lister
              évite de « chercher quand même quelque chose ».
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Quand</th><th>Match</th><th>Discipline</th><th className="oa-num">Barres cotées</th></tr>
                </thead>
                <tbody>
                  {sansPari.map((m, i) => (
                    <tr key={i}>
                      <td>{quand(m.startUtc)}</td>
                      <td>{m.p1} <span className="hint">vs</span> {m.p2}</td>
                      <td title={DISC_LABEL[m.discipline] ?? ""}>{m.discipline ?? "—"}</td>
                      <td className="oa-num">{m.lignes.map((l) => String(l.n).replace(".", ",")).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

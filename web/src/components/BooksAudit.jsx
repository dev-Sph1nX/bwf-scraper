import { useEffect, useMemo, useState } from "react";
import { getJSON } from "../data.js";
import OddsChart from "./OddsChart.jsx";
import { ROUND_LABEL } from "./UpcomingMatch.jsx";

// Cotes par OPÉRATEUR (Betclic, Unibet, Winamax), historisées par le cron.
// Trois points d'entrée de lecture :
//   - « Par match »     : un match = une carte, avec la cote de CHAQUE opérateur
//                         côte à côte (jointes par l'identifiant Sportradar) ;
//   - « Par opérateur » : la vue BRUTE de tout ce qu'on a relevé chez un
//                         opérateur, dans SON ordre d'affichage à lui ;
//   - « Relevés »       : ce que l'historisation a accumulé (append-only).

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const BOOK_ORDER = ["betclic", "unibet", "winamax"];
const DISC_ORDER = ["MS", "WS", "MD", "WD", "XD"];

const fmtOdd = (v) => (v == null ? "—" : v.toFixed(2));
const fmtHeure = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

// Un match est « passé » 3 h après son heure de départ (durée max constatée
// d'un match de badminton), ou dès que le résultat BWF est connu.
const estPasse = (g, maintenant) =>
  g.bwf?.played === true ||
  (g.startUtc && Date.parse(g.startUtc) + 3 * 3600_000 < maintenant && !g.isLive);

function StatutBadge({ g, maintenant }) {
  if (g.isLive) return <span className="badge live">live</span>;
  if (estPasse(g, maintenant)) return <span className="badge post">joué</span>;
  return <span className="badge future">à venir</span>;
}

// La meilleure cote d'un camp parmi les opérateurs : c'est CELLE qui compte
// pour un parieur (à probabilité égale, plus la cote est haute, mieux c'est).
function meilleures(g) {
  const max = (champ) =>
    Math.max(...Object.values(g.books).map((b) => b[champ] ?? -Infinity));
  return { odd1: max("odd1"), odd2: max("odd2") };
}

function LigneOperateur({ book, b, best }) {
  return (
    <tr>
      <td>{BOOK_LABEL[book] || book}</td>
      <td className={`oa-num${b.odd1 != null && b.odd1 === best.odd1 ? " ba-best" : ""}`}>{fmtOdd(b.odd1)}</td>
      <td className={`oa-num${b.odd2 != null && b.odd2 === best.odd2 ? " ba-best" : ""}`}>{fmtOdd(b.odd2)}</td>
      <td className="oa-num">
        {b.driftP1 == null ? "—" : (
          <span className={`form ${b.driftP1 > 0.001 ? "up" : b.driftP1 < -0.001 ? "down" : "flat"}`}>
            {b.driftP1 >= 0 ? "+" : ""}{(b.driftP1 * 100).toFixed(1)} pt
          </span>
        )}
      </td>
      <td className="oa-num">{b.overround == null ? "—" : `${(b.overround * 100).toFixed(1)} %`}</td>
      <td className="oa-num">{b.readings}</td>
    </tr>
  );
}

function CarteMatch({ g, maintenant }) {
  const best = meilleures(g);
  const b1 = best.odd1 === -Infinity ? null : best.odd1;
  const b2 = best.odd2 === -Infinity ? null : best.odd2;
  const livres = BOOK_ORDER.filter((b) => g.books[b]);
  return (
    <li className="oa-item">
      <div className="oa-head">
        <span className="oa-disc">{g.discipline || "?"}</span>
        {g.bwf && <span className="oa-round">{ROUND_LABEL[g.bwf.roundName] || g.bwf.roundName}</span>}
        <span className="oa-tmt">{g.bwf?.tournamentName || g.tournament}</span>
        <span className="oa-when">{fmtHeure(g.startUtc)}</span>
        <StatutBadge g={g} maintenant={maintenant} />
      </div>
      <div className="oa-sides">
        <div className="oa-side">
          <div className="oa-names">
            <div className="oa-bwf">{g.bwf ? (g.bwf.swapped ? g.bwf.bwf2 : g.bwf.bwf1) : g.p1}</div>
            {g.bwf && <div className="oa-op">{g.p1}</div>}
          </div>
          <div className={`oa-odd${b1 != null && b2 != null && b1 < b2 ? " fav" : ""}`}>{fmtOdd(b1)}</div>
        </div>
        <div className="oa-side">
          <div className="oa-names">
            <div className="oa-bwf">{g.bwf ? (g.bwf.swapped ? g.bwf.bwf1 : g.bwf.bwf2) : g.p2}</div>
            {g.bwf && <div className="oa-op">{g.p2}</div>}
          </div>
          <div className={`oa-odd${b1 != null && b2 != null && b2 < b1 ? " fav" : ""}`}>{fmtOdd(b2)}</div>
        </div>
      </div>
      <div className="table-scroll">
        <table className="ba-table">
          <thead>
            <tr>
              <th>Opérateur</th>
              <th className="oa-num">Cote 1</th>
              <th className="oa-num">Cote 2</th>
              <th className="oa-num" title="Déplacement de la probabilité implicite du camp 1 depuis le premier relevé. Positif = le marché croit de plus en plus au camp 1.">Dérive</th>
              <th className="oa-num" title="Commission de l'opérateur sur ce match : somme des probabilités implicites moins 100 %. Plus c'est bas, mieux c'est pour le parieur.">Marge</th>
              <th className="oa-num" title="Nombre de valeurs distinctes observées pour cette cote.">Relevés</th>
            </tr>
          </thead>
          <tbody>
            {livres.map((b) => <LigneOperateur key={b} book={b} b={g.books[b]} best={best} />)}
          </tbody>
        </table>
      </div>
      {!g.bwf && (
        <p className="hint">
          Non rapproché d'un match BWF (noms trop abrégés ou match absent de nos données) :
          les noms affichés sont ceux de l'opérateur.
        </p>
      )}
    </li>
  );
}

// --- Journal des relevés : l'évolution de chaque cote suivie -------------------
// Une ligne par (match, opérateur), « Voir » déplie le graphe. Les points sont
// déjà réorientés vers p1 du groupe : les dérives se comparent entre opérateurs.
function JournalEvolution({ matches }) {
  const [ouvert, setOuvert] = useState(null); // "clé-du-groupe:opérateur"

  const lignes = [];
  for (const g of matches) {
    for (const book of BOOK_ORDER) {
      const b = g.books[book];
      if (b && (b.points || []).length > 0) lignes.push({ g, book, b, cle: `${g.key}:${book}` });
    }
  }
  lignes.sort((x, y) => String(x.g.startUtc).localeCompare(String(y.g.startUtc)) || x.book.localeCompare(y.book));

  if (lignes.length === 0) {
    return <p className="muted">Aucune cote suivie pour l'instant : le prochain relevé remplira ce journal.</p>;
  }

  const actif = lignes.find((l) => l.cle === ouvert);
  const fmtCotes = (p) => (p ? `${fmtOdd(p.odd1)} / ${fmtOdd(p.odd2)}` : "—");

  return (
    <>
      <div className="table-scroll">
        <table className="ba-table">
          <thead>
            <tr>
              <th>Match</th><th>Opérateur</th>
              <th className="oa-num">Ouverture</th><th className="oa-num">Dernière</th>
              <th className="oa-num" title="Déplacement de la probabilité implicite du camp 1 entre le premier et le dernier relevé.">Dérive</th>
              <th className="oa-num">Relevés</th><th></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map(({ g, book, b, cle }) => (
              <tr key={cle}>
                <td>
                  <b>{g.p1}</b> <span className="muted">vs</span> {g.p2}
                  <br /><span className="muted">{fmtHeure(g.startUtc)} · {g.discipline || "?"}</span>
                </td>
                <td>{BOOK_LABEL[book]}</td>
                <td className="oa-num">{fmtCotes(b.opening)}</td>
                <td className="oa-num">{fmtCotes(b.closing)}</td>
                <td className="oa-num">
                  {b.driftP1 == null ? "—" : (
                    <span className={`form ${b.driftP1 > 0.001 ? "up" : b.driftP1 < -0.001 ? "down" : "flat"}`}>
                      {b.driftP1 >= 0 ? "+" : ""}{(b.driftP1 * 100).toFixed(1)} pt
                    </span>
                  )}
                </td>
                <td className="oa-num">{b.readings}</td>
                <td>
                  <button className="range-btn" onClick={() => setOuvert(ouvert === cle ? null : cle)}>
                    {ouvert === cle ? "Masquer" : "Voir"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actif && (
        <OddsChart
          serie={{ points: actif.b.points }}
          label1={`${actif.g.p1} — ${BOOK_LABEL[actif.book]}`}
          label2={actif.g.p2}
        />
      )}
    </>
  );
}

// --- Vue « Par opérateur » : le brut, dans l'ordre d'affichage du site --------
function VueOperateur({ matches, book }) {
  const lignes = matches
    .filter((g) => g.books[book])
    .map((g) => ({ g, b: g.books[book] }))
    .sort((a, b) => String(a.g.startUtc).localeCompare(String(b.g.startUtc)));
  if (lignes.length === 0) return <p className="muted">Aucune ligne relevée chez cet opérateur.</p>;
  return (
    <div className="table-scroll">
      <table className="ba-table">
        <thead>
          <tr>
            <th>Départ</th><th>Tournoi</th><th>Disc.</th><th>Affiche (ordre {BOOK_LABEL[book]})</th>
            <th className="oa-num">Ouverture</th><th className="oa-num">Dernière</th>
            <th className="oa-num">Dérive</th><th className="oa-num">Marge</th><th className="oa-num">Relevés</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map(({ g, b }) => (
            <tr key={`${book}:${b.bookMatchId}`}>
              <td className="oa-when">{fmtHeure(g.startUtc)}</td>
              <td>{b.tournament || g.tournament}</td>
              <td>{g.discipline || "?"}</td>
              <td><b>{b.p1}</b> <span className="muted">vs</span> {b.p2}</td>
              <td className="oa-num">{b.opening ? `${fmtOdd(b.opening.odd1)} / ${fmtOdd(b.opening.odd2)}` : "—"}</td>
              <td className="oa-num">{b.closing ? `${fmtOdd(b.closing.odd1)} / ${fmtOdd(b.closing.odd2)}` : "—"}</td>
              <td className="oa-num">
                {b.driftP1 == null ? "—" : (
                  <span className={`form ${b.driftP1 > 0.001 ? "up" : b.driftP1 < -0.001 ? "down" : "flat"}`}>
                    {b.driftP1 >= 0 ? "+" : ""}{(b.driftP1 * 100).toFixed(1)} pt
                  </span>
                )}
              </td>
              <td className="oa-num">{b.overround == null ? "—" : `${(b.overround * 100).toFixed(1)} %`}</td>
              <td className="oa-num">{b.readings}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BooksAudit() {
  const [data, setData] = useState(null);
  const [vue, setVue] = useState("match");      // match | operateur | releves
  const [book, setBook] = useState("betclic");
  const [disc, setDisc] = useState("all");
  const maintenant = Date.now();

  useEffect(() => { getJSON("books-report.json").then(setData).catch(() => setData(false)); }, []);

  const matches = useMemo(() => (data ? data.matches || [] : []), [data]);
  const discsPresent = DISC_ORDER.filter((d) => matches.some((g) => g.discipline === d));
  const filtres = matches.filter((g) => disc === "all" || g.discipline === disc);
  // À venir d'abord (ordre chronologique), joués ensuite (du plus récent au plus ancien).
  const aVenir = filtres.filter((g) => !estPasse(g, maintenant)).sort((a, b) => String(a.startUtc).localeCompare(String(b.startUtc)));
  const joues = filtres.filter((g) => estPasse(g, maintenant)).sort((a, b) => String(b.startUtc).localeCompare(String(a.startUtc)));

  if (data === false) {
    return (
      <div className="card muted">
        Relevés bookmakers indisponibles. Lance <code>npm run scrape-books</code> puis <code>npm run build-data</code>.
      </div>
    );
  }
  if (!data) return <div className="card muted">Chargement…</div>;

  const s = data.stats || {};
  const perBook = s.perBook || {};

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-value">{matches.length}</div>
          <div className="stat-label">Matchs suivis</div>
        </div>
        <div className="stat">
          <div className="stat-value">{s.matched ?? 0}</div>
          <div className="stat-label">Rapprochés BWF</div>
        </div>
        <div className="stat">
          <div className="stat-value">{Object.keys(perBook).length}</div>
          <div className="stat-label">Opérateurs</div>
        </div>
        <div className="stat">
          <div className="stat-value">{(data.runs || []).length}</div>
          <div className="stat-label">Relevés historisés</div>
        </div>
      </div>

      <div className="card">
        <h2>Comment lire cette page</h2>
        <p className="lead">
          Les cotes « vainqueur du match » sont relevées chez <b>Betclic</b>, <b>Unibet</b> et{" "}
          <b>Winamax</b>, puis un même match est reconnu entre opérateurs par son identifiant de
          flux (Sportradar) — la jointure est exacte, pas un rapprochement de noms. La{" "}
          <b>meilleure cote</b> de chaque camp est surlignée : c'est celle qui paie le plus si le
          pronostic est bon. Heures affichées dans votre fuseau.
        </p>
        <p className="lead muted">
          La « marge » est la commission cachée de l'opérateur (somme des probabilités implicites
          des deux camps moins 100 %) : pour gagner sur la durée, il faut battre le marché de plus
          que cette marge. Ces cotes n'alimentent pas encore les prédictions.
        </p>
      </div>

      <div className="tabs">
        <button type="button" className={`tab${vue === "match" ? " active" : ""}`} aria-pressed={vue === "match"} onClick={() => setVue("match")}>
          Par match ({filtres.length})
        </button>
        <button type="button" className={`tab${vue === "operateur" ? " active" : ""}`} aria-pressed={vue === "operateur"} onClick={() => setVue("operateur")}>
          Par opérateur (brut)
        </button>
        <button type="button" className={`tab${vue === "releves" ? " active" : ""}`} aria-pressed={vue === "releves"} onClick={() => setVue("releves")}>
          Relevés ({(data.runs || []).length})
        </button>
      </div>

      {vue === "match" && (
        <>
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
          {filtres.length === 0 ? (
            <div className="card muted">Aucun match suivi pour l'instant : le prochain passage du cron remplira cette vue.</div>
          ) : (
            <>
              {aVenir.length > 0 && (
                <div className="card">
                  <h2>À venir — {aVenir.length}</h2>
                  <ul className="oa-list">
                    {aVenir.map((g) => <CarteMatch key={g.key} g={g} maintenant={maintenant} />)}
                  </ul>
                </div>
              )}
              {joues.length > 0 && (
                <div className="card">
                  <h2>Joués — {joues.length}</h2>
                  <p className="lead muted">
                    La dernière cote avant le match approche la <b>cote de clôture</b>, la référence
                    du marché : c'est elle qu'on comparera à nos probabilités pour savoir si le
                    modèle bat les bookmakers.
                  </p>
                  <ul className="oa-list">
                    {joues.map((g) => <CarteMatch key={g.key} g={g} maintenant={maintenant} />)}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}

      {vue === "operateur" && (
        <div className="card">
          <div className="tabs">
            {BOOK_ORDER.map((b) => (
              <button key={b} type="button" className={`tab${book === b ? " active" : ""}`} aria-pressed={book === b} onClick={() => setBook(b)}>
                {BOOK_LABEL[b]}{perBook[b] ? ` (${perBook[b].lines})` : ""}
              </button>
            ))}
          </div>
          <p className="lead muted">
            Tout ce qui a été relevé chez {BOOK_LABEL[book]}, tel qu'affiché sur son site (ordre
            des camps et noms de l'opérateur). « Ouverture » = premier relevé, « Dernière » = plus
            récent.
          </p>
          <VueOperateur matches={matches} book={book} />
        </div>
      )}

      {vue === "releves" && (
        <>
        <div className="card">
          <h2>Évolution des cotes</h2>
          <p className="lead">
            Le journal de tout ce qui est suivi : une ligne par cote relevée chez un
            opérateur, de l'<b>ouverture</b> (premier relevé) à la <b>dernière</b> valeur.
            « Voir » déplie le graphe. La dernière cote avant le match approche la{" "}
            <b>cote de clôture</b>, la référence du marché.
          </p>
          <JournalEvolution matches={filtres} />
        </div>
        <div className="card">
          <h2>Relevés historisés</h2>
          <p className="lead">
            Un relevé = un passage du scraper, un fichier immuable dans{" "}
            <code>data/books/runs/</code>. Rien n'est jamais réécrit : c'est cette accumulation qui
            permettra les statistiques futures (cote de clôture, mouvement du marché, CLV).
          </p>
          {(data.runs || []).length === 0 ? (
            <p className="muted">Aucun relevé encore.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="ba-table">
                  <thead>
                    <tr><th>Opérateur</th><th className="oa-num">Lignes suivies</th><th className="oa-num">Avec cote</th><th className="oa-num">Valeurs relevées</th></tr>
                  </thead>
                  <tbody>
                    {BOOK_ORDER.filter((b) => perBook[b]).map((b) => (
                      <tr key={b}>
                        <td>{BOOK_LABEL[b]}</td>
                        <td className="oa-num">{perBook[b].lines}</td>
                        <td className="oa-num">{perBook[b].withOdds}</td>
                        <td className="oa-num">{perBook[b].readingsTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint">Passages : {(data.runs || []).map((r) => fmtHeure(r)).join(" · ")}</p>
            </>
          )}
        </div>
        </>
      )}
    </>
  );
}

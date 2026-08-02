// web/src/pages/Sante.jsx — « les données sont-elles bonnes ? »
// La page télécharge RÉELLEMENT chaque JSON servi à l'app (test de bout en
// bout : ce que le navigateur reçoit, pas ce que le build croit avoir écrit),
// puis vérifie chargement, fraîcheur et refresh bookmakers — y compris les
// échecs par opérateur (ex. HTTP 403), invisibles ailleurs.
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import JsonViewer from "../components/JsonViewer.jsx";

const BASE = import.meta.env.BASE_URL;

// Cadences réelles : le site est reconstruit 1×/jour (cron 22:00 UTC). Les
// cotes sont relevées toutes les 2 h mais n'arrivent en ligne qu'au build
// suivant : toute fraîcheur se juge donc à l'échelle de la journée.
const FRAIS_H = 30; // ≤ 30 h : à jour (un build quotidien + marge)
const VIEUX_H = 54; // ≤ 54 h : vieillissant (un build manqué)

const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };
const BOOK_ORDER = ["betclic", "unibet", "winamax"];

// Les JSON que l'app consomme, avec pour chacun : son rôle, où trouver son
// horodatage (stamp) et un compteur clé (count) prouvant qu'il a du contenu.
const FILES = [
  { path: "summary.json", role: "Résumé global (accueil, topbar)",
    stamp: (j) => j.lastUpdate, count: (j) => `${nf(j.matchCount)} matchs · ${nf(j.playerCount)} joueurs` },
  { path: "status.json", role: "Liste des tournois (page Tournois)",
    stamp: null, count: (j) => `${(j.tournaments || []).length} tournois` },
  { path: "upcoming-matches.json", role: "Matchs à venir + cotes/EV (accueil)",
    stamp: (j) => j.generatedAt, count: (j) => `${(j.matches || []).length} matchs à venir` },
  { path: "elo/ranking.json", role: "Classement Elo (Classement, duel)",
    stamp: (j) => j.generatedAt, count: (j) => `${Object.keys(j.disciplines || {}).length} disciplines` },
  { path: "books-report.json", role: "Cotes bookmakers (coulisses)",
    stamp: (j) => j.generatedAt, count: (j) => `${(j.matches || []).length} matchs suivis · ${(j.runs || []).length} relevés` },
  { path: "backtest.json", role: "Fiabilité du modèle (coulisses)",
    stamp: (j) => j.generatedAt, count: (j) => `${(j.models || []).length} modèles comparés` },
  { path: "updates.json", role: "Historique des mises à jour (coulisses)",
    stamp: (j) => j.generatedAt, count: (j) => `${(j.updates || []).length} jours de MAJ` },
  { path: "players.json", role: "Index des joueurs",
    stamp: null, count: (j) => `${(j.players || []).length} joueurs` },
  { path: "health.json", role: "Manifeste du build (cette page)",
    stamp: (j) => j.generatedAt, count: (j) => `${(j.files || []).length} fichiers · ${(j.dirs || []).length} dossiers` },
];

const nf = (n) => (n ?? 0).toLocaleString("fr-FR");
const fmtBytes = (b) =>
  b >= 1048576
    ? `${(b / 1048576).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`
    : `${Math.max(1, Math.round(b / 1024))} ko`;
const fmtAge = (h) => (h < 1 ? "moins d'1 h" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`);
function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(String(iso).replace(" ", "T"));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}h${p(d.getMinutes())}`;
}
// "https://… -> HTTP 403" → "HTTP 403" (le détail complet reste dans le title).
const erreurCourte = (e) => String(e).split("->").pop().trim().slice(0, 40);

function fraicheur(iso, now) {
  if (!iso) return null;
  const h = Math.max(0, (now - Date.parse(String(iso).replace(" ", "T"))) / 3.6e6);
  if (h <= FRAIS_H) return { cls: "ok", label: "à jour", h };
  if (h <= VIEUX_H) return { cls: "warn", label: "vieillissant", h };
  return { cls: "ko", label: "périmé", h };
}

async function testerFichier(def, now) {
  try {
    const res = await fetch(`${BASE}data/${def.path}`);
    if (!res.ok) return { ...def, ok: false, error: `HTTP ${res.status}` };
    const texte = await res.text();
    let j;
    try { j = JSON.parse(texte); } catch { return { ...def, ok: false, error: "JSON invalide" }; }
    const stamp = def.stamp ? def.stamp(j) : null;
    return {
      ...def, ok: true, bytes: new Blob([texte]).size,
      stamp, fr: fraicheur(stamp, now), contenu: def.count(j),
      json: j, // gardé pour la visionneuse JSON (dépliage à la demande)
    };
  } catch (e) {
    return { ...def, ok: false, error: "injoignable" };
  }
}

// Une ligne du tableau des relevés bookmakers + son expansion : le fichier de
// run BRUT (copié par build-data dans books/runs/), chargé à la demande —
// exactement ce que le scraper a récupéré, ligne par ligne.
function LigneRun({ r, ouvert, onToggle }) {
  const [json, setJson] = useState(undefined); // undefined = pas encore chargé, false = erreur
  useEffect(() => {
    if (!ouvert || json !== undefined || !r.file) return;
    fetch(`${BASE}data/${r.file}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.status))))
      .then(setJson)
      .catch(() => setJson(false));
  }, [ouvert, json, r.file]);

  return (
    <>
      <tr>
        <td className="tmt-dates">{fmtDateTime(r.fetchedAt)}</td>
        {BOOK_ORDER.map((b) => {
          const d = r.books[b];
          return (
            <td key={b}>
              {!d ? <span className="muted" title="Opérateur absent de ce relevé">—</span>
                : d.error ? <span className="sante-ko" title={d.error}>✗ {erreurCourte(d.error)}</span>
                : !d.complete ? <span className="sante-warn" title="Relevé partiel : toutes les pages n'ont pas pu être lues">⚠ partiel ({d.rows ?? 0} lignes)</span>
                : <span className={d.rows > 0 ? "sante-ok" : "muted"}>✓ {d.rows} ligne{d.rows > 1 ? "s" : ""}</span>}
            </td>
          );
        })}
        <td>
          {r.file && (
            <button type="button" className="range-btn rk-ctrl" aria-expanded={ouvert} onClick={onToggle}>
              {ouvert ? "Masquer" : "Voir"}
            </button>
          )}
        </td>
      </tr>
      {ouvert && (
        <tr>
          <td colSpan={2 + BOOK_ORDER.length}>
            <div className="jv-bar">
              <code>{r.file}</code>
              <a href={`${BASE}data/${r.file}`} target="_blank" rel="noreferrer">brut ↗</a>
            </div>
            {json === undefined ? <p className="muted">Chargement…</p>
              : json === false ? <p className="muted">Relevé introuvable (relance <code>npm run build-data</code>).</p>
              : <JsonViewer data={json} />}
          </td>
        </tr>
      )}
    </>
  );
}

// Une ligne du tableau des fichiers + sa ligne d'expansion « visionneuse JSON »
// (le JSON réel, brut, dépliable — pas un résumé). Le lien « brut ↗ » ouvre le
// fichier tel que servi.
function FragmentLigne({ f, vu, setVu }) {
  const ouvert = vu === f.path;
  return (
    <>
      <tr>
        <td><code>{f.path}</code><br /><span className="muted">{f.role}</span></td>
        <td>{f.ok
          ? <span className="sante-ok">✓ chargé</span>
          : <span className="sante-ko">✗ {f.error}</span>}</td>
        <td className="tmt-dates">{fmtDateTime(f.stamp)}</td>
        <td>{f.fr
          ? <span className={`badge ${f.fr.cls}`} title={`il y a ${fmtAge(f.fr.h)}`}>{f.fr.label}</span>
          : <span className="muted">—</span>}</td>
        <td className="oa-num">{f.ok ? fmtBytes(f.bytes) : "—"}</td>
        <td>{f.ok ? f.contenu : <span className="muted">—</span>}</td>
        <td>
          {f.ok && (
            <button type="button" className="range-btn rk-ctrl" aria-expanded={ouvert}
                    onClick={() => setVu(ouvert ? null : f.path)}>
              {ouvert ? "Masquer" : "Voir"}
            </button>
          )}
        </td>
      </tr>
      {ouvert && (
        <tr>
          <td colSpan={7}>
            <div className="jv-bar">
              <code>{f.path}</code>
              <a href={`${BASE}data/${f.path}`} target="_blank" rel="noreferrer">brut ↗</a>
            </div>
            <JsonViewer data={f.json} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Sante() {
  const { setTitle } = useOutletContext();
  const [resultats, setResultats] = useState(null);
  const [vu, setVu] = useState(null);       // fichier ouvert dans la visionneuse JSON
  const [runVu, setRunVu] = useState(null); // relevé bookmaker ouvert (fetchedAt)
  const [now] = useState(() => Date.now());

  useEffect(() => { setTitle("Santé des données"); }, [setTitle]);
  useEffect(() => {
    Promise.all(FILES.map((f) => testerFichier(f, now))).then(setResultats);
  }, [now]);

  if (!resultats) return <div className="card muted">Vérification en cours…</div>;

  const health = resultats.find((f) => f.path === "health.json")?.json || null;
  const runs = health?.bookRuns || [];
  const okCount = resultats.filter((f) => f.ok).length;
  const totalBytes = resultats.reduce((s, f) => s + (f.bytes || 0), 0);
  const fiches = (health?.dirs || []).reduce((s, d) => s + d.count, 0);

  // ---- Verdict : la liste exhaustive de ce qui ne va pas -------------------
  const problemes = [];
  for (const f of resultats) {
    if (!f.ok) problemes.push(<>Le fichier <code>{f.path}</code> ne se charge pas ({f.error}).</>);
    else if (f.fr?.cls === "ko") problemes.push(<><code>{f.path}</code> est périmé : {fmtAge(f.fr.h)} sans mise à jour.</>);
  }
  const dernier = runs[0];
  if (dernier) {
    for (const b of BOOK_ORDER) {
      const d = dernier.books[b];
      if (!d) continue;
      if (d.error) problemes.push(<>{BOOK_LABEL[b]} en échec au dernier relevé de cotes ({erreurCourte(d.error)}).</>);
      else if (!d.complete) problemes.push(<>{BOOK_LABEL[b]} : dernier relevé de cotes incomplet.</>);
    }
    const h = (now - Date.parse(dernier.fetchedAt)) / 3.6e6;
    if (h > FRAIS_H) problemes.push(<>Aucun relevé de cotes exporté depuis {fmtAge(h)}.</>);
  }

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="stat-value">{okCount}/{resultats.length}</div><div className="stat-label">Fichiers chargés</div></div>
        <div className="stat"><div className="stat-value">{fmtBytes(totalBytes)}</div><div className="stat-label">Téléchargés pour ce test</div></div>
        <div className="stat"><div className="stat-value">{runs.length}</div><div className="stat-label">Relevés de cotes exportés</div></div>
        <div className="stat"><div className="stat-value">{nf(fiches)}</div><div className="stat-label">Fiches générées</div></div>
      </div>

      <div className="card">
        <h2>Verdict</h2>
        {problemes.length === 0 ? (
          <p className="lead"><span className="form up">✓ Tout est vert</span> — les {resultats.length} fichiers
          se chargent, sont à jour, et le dernier relevé de cotes est complet.</p>
        ) : (
          <>
            <p className="lead"><span className="sante-ko">✗ {problemes.length} problème{problemes.length > 1 ? "s" : ""} détecté{problemes.length > 1 ? "s" : ""}</span> :</p>
            <ul className="sante-problemes">
              {problemes.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </>
        )}
        <p className="lead muted">
          Cette page télécharge réellement chaque fichier depuis le site : c'est un test de bout en
          bout de ce que reçoit votre navigateur, pas un compte-rendu du serveur.
        </p>
      </div>

      <div className="card">
        <h2>Les fichiers de l'app</h2>
        <p className="lead">
          « À jour » = généré il y a moins de {FRAIS_H} h (le site est reconstruit une fois par
          jour) ; « périmé » = plus de {VIEUX_H} h, un build a été manqué. Les fichiers sans
          horodatage propre sont produits par le même build que les autres.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fichier</th><th>Statut</th><th>Généré le</th><th>Fraîcheur</th>
                <th className="oa-num">Taille</th><th>Contenu</th><th>JSON</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map((f) => (
                <FragmentLigne key={f.path} f={f} vu={vu} setVu={setVu} />
              ))}
            </tbody>
          </table>
        </div>
        {health && (
          <p className="hint">
            Le build a aussi écrit {(health.dirs || []).map((d) =>
              `${nf(d.count)} fichier${d.count > 1 ? "s" : ""} ${d.name}/ (${fmtBytes(d.bytes)})`).join(", ")} —
            non testés un par un ici.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Refresh bookmakers, un par un</h2>
        {health === null ? (
          <p className="muted">
            Détail indisponible : <code>health.json</code> ne se charge pas (ancien build ?). Relance{" "}
            <code>npm run build-data</code> pour l'obtenir.
          </p>
        ) : runs.length === 0 ? (
          <p className="muted">Aucun relevé de cotes exporté pour l'instant.</p>
        ) : (
          <>
            <p className="lead">
              Un relevé = un passage du robot de cotes (toutes les 2 h). Chaque cellule dit ce que
              l'opérateur a donné : <span className="sante-ok">✓ n lignes</span> si tout va bien,{" "}
              <span className="sante-ko">✗ l'erreur exacte</span> sinon. Les {runs.length} derniers
              passages exportés au build, du plus récent au plus ancien.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Relevé</th>
                    {BOOK_ORDER.map((b) => <th key={b}>{BOOK_LABEL[b]}</th>)}
                    <th>JSON</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <LigneRun key={r.fetchedAt} r={r} ouvert={runVu === r.fetchedAt}
                              onToggle={() => setRunVu(runVu === r.fetchedAt ? null : r.fetchedAt)} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              « ✓ 0 ligne » n'est pas une panne : en période creuse, les opérateurs n'affichent
              simplement aucun match de badminton.
            </p>
          </>
        )}
      </div>
    </>
  );
}

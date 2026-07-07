import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

const parseDate = (s) => (s ? new Date(s.replace(" ", "T")) : null);

// Un tournoi est "à venir" tant qu'il n'est pas terminé : on se fie à la date de
// fin quand elle existe (robuste), sinon au statut renvoyé par la BWF.
function isUpcoming(t, now) {
  const end = parseDate(t.end_date);
  if (end) return end.getTime() >= now;
  return t.live_status !== "post";
}
// Clé de tri temporelle (timestamp) avec repli sur l'année pour les vieux tournois
// dépourvus de dates machine.
function timeKey(t) {
  const d = parseDate(t.start_date) || parseDate(t.end_date);
  return d ? d.getTime() : (t.year ? new Date(t.year, 0, 1).getTime() : 0);
}

const DAY = 86400000;
function fmtDMY(s) {
  const d = parseDate(s);
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
// Tournoi en cours = aujourd'hui compris entre le début et la fin (repli : statut live).
function isLive(t, now) {
  const s = parseDate(t.start_date)?.getTime(), e = parseDate(t.end_date)?.getTime();
  if (s != null && e != null) return s <= now && now <= e;
  return t.live_status === "live";
}
// Délai avant le début, en toutes lettres.
function startsIn(t, now) {
  const s = parseDate(t.start_date)?.getTime();
  if (s == null) return "";
  const days = Math.ceil((s - now) / DAY);
  if (days <= 0) return "démarre aujourd'hui";
  if (days === 1) return "démarre demain";
  return `démarre dans ${days} jours`;
}

// Bloc mis en avant : tournoi(s) en cours, sinon le prochain à venir.
function Featured({ featured, now }) {
  if (!featured) return null;
  const live = featured.kind === "live";
  return (
    <div className="feat card">
      <div className="feat-label">
        {live ? <span className="feat-dot" aria-hidden="true" /> : null}
        {live ? "En cours" : "Prochain tournoi"}
      </div>
      <div className="feat-items">
        {featured.items.map((t) => (
          <div className="feat-item" key={t.id}>
            {t.flag_url && (
              <img className="feat-flag" src={t.flag_url} alt=""
                onError={(e) => (e.target.style.display = "none")} />
            )}
            <div className="feat-info">
              <Link className="feat-name" to={`/tournament/${t.id}`}>{t.name}</Link>
              <div className="feat-meta">
                <span>{t.date}{t.year ? ` ${t.year}` : ""}</span>
                <span className="feat-sep">·</span>
                <span>{t.category.replace("HSBC BWF World Tour ", "")}</span>
                {t.country && <><span className="feat-sep">·</span><span>{t.country}</span></>}
              </div>
              <div className="feat-status">
                {live
                  ? `En cours — se termine le ${fmtDMY(t.end_date)}`
                  : startsIn(t, now).replace(/^d/, "D")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TournamentRow({ t }) {
  return (
    <tr>
      <td>
        {t.flag_url && (
          <img className="flag" src={t.flag_url} alt=""
            style={{ width: 18, height: 18, borderRadius: "50%", verticalAlign: "middle", marginRight: 6 }}
            onError={(e) => (e.target.style.display = "none")} />
        )}
        <Link to={`/tournament/${t.id}`}>{t.name}</Link>
      </td>
      <td className="tmt-dates">{t.date}{t.year ? ` ${t.year}` : ""}</td>
      <td>{t.category.replace("HSBC BWF World Tour ", "")}</td>
      <td><span className={`badge ${t.live_status}`}>{t.live_status}</span></td>
      <td>{t.drawCount}/{t.drawsTotal}</td>
      <td>{t.matchCount}</td>
    </tr>
  );
}

function Section({ title, subtitle, rows, empty }) {
  return (
    <div className="card">
      <h2>{title}{subtitle ? <span className="muted" style={{ fontWeight: "normal" }}> · {subtitle}</span> : null}</h2>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: "6px 0 0" }}>{empty}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Tournoi</th><th>Dates</th><th>Catégorie</th><th>État</th><th>Draws</th><th>Matchs</th></tr>
            </thead>
            <tbody>
              {rows.map((t) => <TournamentRow key={t.id} t={t} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Tournaments() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("upcoming"); // "À venir" par défaut
  const [q, setQ] = useState("");

  useEffect(() => { setTitle("Calendrier"); }, [setTitle]);
  useEffect(() => {
    getJSON("status.json")
      .then(setData)
      .catch(() => setData({ years: [], tournaments: [] }));
  }, []);

  const now = Date.now();
  const { upcoming, past, featured } = useMemo(() => {
    const all = data?.tournaments ?? [];
    const up = [], pa = [];
    for (const t of all) (isUpcoming(t, now) ? up : pa).push(t);
    up.sort((a, b) => timeKey(a) - timeKey(b)); // le plus proche d'abord
    pa.sort((a, b) => timeKey(b) - timeKey(a)); // le plus récent d'abord
    // Mise en avant : les tournois en cours, sinon le prochain à démarrer.
    const live = up.filter((t) => isLive(t, now));
    const feat = live.length
      ? { kind: "live", items: live }
      : (up[0] ? { kind: "next", items: [up[0]] } : null);
    return { upcoming: up, past: pa, featured: feat };
  }, [data, now]);

  if (!data) return <div className="card muted">Chargement…</div>;

  const term = q.trim().toLowerCase();
  const match = (t) => !term || t.name.toLowerCase().includes(term);
  // Onglets disponibles = ceux qui ont au moins un résultat (filtré par la recherche).
  const tabsAvail = [
    { key: "upcoming", label: "À venir", rows: upcoming.filter(match) },
    { key: "past", label: "Passés", rows: past.filter(match) },
  ].filter((x) => x.rows.length > 0);
  // Onglet actif : celui sélectionné s'il a des résultats, sinon le premier dispo.
  const active = tabsAvail.find((x) => x.key === tab) || tabsAvail[0] || null;

  return (
    <>
      <Featured featured={featured} now={now} />
      <input
        className="search" type="search" value={q}
        placeholder="Rechercher un tournoi par nom…" aria-label="Rechercher un tournoi"
        onChange={(e) => setQ(e.target.value)}
      />
      {tabsAvail.length > 0 && (
        <div className="tabs" role="tablist" aria-label="Tournois">
          {tabsAvail.map((x) => (
            <button key={x.key} role="tab" aria-selected={active?.key === x.key}
              className={`tab ${active?.key === x.key ? "active" : ""}`} onClick={() => setTab(x.key)}>
              {x.label} · {x.rows.length}
            </button>
          ))}
        </div>
      )}
      {active ? (
        <Section
          title={active.label}
          subtitle={`${active.rows.length} tournoi${active.rows.length > 1 ? "s" : ""}`}
          rows={active.rows}
          empty=""
        />
      ) : (
        <div className="card muted">Aucun tournoi ne correspond à « {q.trim()} ».</div>
      )}
    </>
  );
}

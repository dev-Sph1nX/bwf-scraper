import { useEffect, useMemo, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { getJSON } from "../data.js";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];

// Probabilité de victoire d'A face à B selon l'écart Elo (formule standard).
const winProb = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

const playerTeam = (m) => (m.side === "team1" ? m.team1 : m.team2);
const oppTeam = (m) => (m.side === "team1" ? m.team2 : m.team1);
const idsOf = (team) => (team?.players || []).map((p) => String(p.id));
const fmtD = (s) => {
  if (!s) return "";
  const d = new Date(s.replace(" ", "T"));
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
function scoreStr(m) {
  const mine = m.side === "team1";
  return (m.score || []).map((s) => (mine ? `${s.home}-${s.away}` : `${s.away}-${s.home}`)).join(", ");
}
// Matchs de l'entité (ce joueur / cette paire exacte) dans la discipline, récents d'abord.
function entityMatchesOf(pdata, entity, disc) {
  if (!pdata) return [];
  return pdata.matches
    .filter((m) => m.eventName === disc && entity.players.every((p) => idsOf(playerTeam(m)).includes(String(p.id))))
    .sort((x, y) => (y.matchTime || "").localeCompare(x.matchTime || ""));
}

function Combobox({ label, entities, value, onChange, exclude }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return entities.filter((e) => e.key !== exclude).filter((e) => !t || e.name.toLowerCase().includes(t)).slice(0, 40);
  }, [entities, q, exclude]);

  if (value) {
    return (
      <div>
        <div className="pick-label">{label}</div>
        <div className="chosen">
          <span className="grow"><span className="nm">{value.name}</span><span className="sub muted"> · {value.country || "—"}</span></span>
          <span className="rt">{value.rating}</span>
          <button className="clear" aria-label="Changer de sélection" onClick={() => { onChange(null); setQ(""); }}>×</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="pick-label">{label}</div>
      <div className="combobox">
        <input type="text" value={q} placeholder="Rechercher…" aria-label={label}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)} />
        {open && (
          <div className="cb-list" role="listbox">
            {matches.length === 0 ? <div className="cb-empty">Aucun résultat</div> :
              matches.map((e) => (
                <button key={e.key} type="button" role="option" aria-selected="false" className="cb-item"
                  onMouseDown={(ev) => ev.preventDefault()} onClick={() => { onChange(e); setOpen(false); }}>
                  <span>{e.name}</span><span className="cb-rt">{e.rating}</span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProbaRow({ entity, prob, favorite }) {
  const pct = Math.round(prob * 100);
  const odds = prob > 0 ? (1 / prob).toFixed(2) : "—";
  return (
    <div className={`proba-row ${favorite ? "fav" : "dog"}`}>
      <div className="proba-head">
        <span className="who">{entity.name}</span>
        <span className="odds">cote {odds}</span>
        <span className="pct">{pct}%</span>
      </div>
      <div className="proba-track"><div className="proba-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Pills({ matches }) {
  const last = matches.slice(0, 5);
  if (!last.length) return null;
  return (
    <div className="pills" title="5 derniers matchs (le plus récent à gauche)">
      {last.map((m, i) => (
        <span key={i} className={`pill ${m.won ? "win" : "loss"}`} title={`${m.tournamentName || ""} ${scoreStr(m)}`}>
          {m.won ? "V" : "D"}
        </span>
      ))}
    </div>
  );
}

function PlayerCard({ entity, matches }) {
  const total = entity.wins + entity.losses;
  const rate = total ? Math.round((entity.wins / total) * 100) : 0;
  const flag = entity.players[0]?.flag;
  const f = entity.form;
  return (
    <div className="pcard">
      <div className="pcard-name">{flag && <img className="lb-flag" src={flag} alt="" />}{entity.name}</div>
      <div className="pcard-stats">
        <div><span className="k">Elo</span><span className="v accent">{entity.rating}</span></div>
        <div><span className="k">Mondial BWF</span><span className="v">{entity.bwfRank ? `#${entity.bwfRank}` : "—"}</span></div>
        <div><span className="k">Forme (5 derniers)</span><span className={`v form ${f > 0 ? "up" : f < 0 ? "down" : "flat"}`}>{f > 0 ? `▲ +${f}` : f < 0 ? `▼ ${Math.abs(f)}` : "→ 0"}</span></div>
        <div><span className="k">Saison</span><span className="v">{entity.wins}-{entity.losses} ({rate}%)</span></div>
      </div>
      <Pills matches={matches} />
    </div>
  );
}

export default function Predictor() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [disc, setDisc] = useState("MS");
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [aData, setAData] = useState(null);
  const [bData, setBData] = useState(null);

  useEffect(() => { setTitle("Prédicteur"); }, [setTitle]);
  useEffect(() => { getJSON("elo/ranking.json").then(setData).catch(() => setData(false)); }, []);

  const aId = a?.players?.[0]?.id;
  const bId = b?.players?.[0]?.id;
  useEffect(() => {
    if (!aId) { setAData(null); return; }
    let ok = true; getJSON(`player/${aId}.json`).then((d) => ok && setAData(d)).catch(() => ok && setAData(null));
    return () => { ok = false; };
  }, [aId]);
  useEffect(() => {
    if (!bId) { setBData(null); return; }
    let ok = true; getJSON(`player/${bId}.json`).then((d) => ok && setBData(d)).catch(() => ok && setBData(null));
    return () => { ok = false; };
  }, [bId]);

  const changeDisc = (code) => { setDisc(code); setA(null); setB(null); };

  const entities = data?.disciplines?.[disc]?.entities ?? [];
  const isPair = data?.disciplines?.[disc]?.type === "pair";
  const pA = a && b ? winProb(a.rating, b.rating) : null;

  const aMatches = a ? entityMatchesOf(aData, a, disc) : [];
  const bMatches = b ? entityMatchesOf(bData, b, disc) : [];
  const h2h = a && b ? aMatches.filter((m) => b.players.every((p) => idsOf(oppTeam(m)).includes(String(p.id)))) : [];
  const aWins = h2h.filter((m) => m.won).length;
  const bWins = h2h.length - aWins;
  const eloFav = pA == null ? null : pA >= 0.5 ? a : b;
  const h2hLeader = aWins > bWins ? a : bWins > aWins ? b : null;
  const contradiction = h2h.length > 0 && h2hLeader && eloFav && h2hLeader.key !== eloFav.key;

  return (
    <>
      <div className="card">
        <h2>Prédicteur tête-à-tête</h2>
        <p className="lead">
          Choisis deux {isPair ? "paires" : "joueurs"} d'une même discipline. La <b>probabilité de victoire</b> vient
          de l'écart Elo : <code>P(A) = 1 / (1 + 10^((Elo_B − Elo_A) / 400))</code>. La <b>cote</b> affichée est la
          cote « juste » (implicite) = <code>1 / probabilité</code>, sans marge bookmaker — compare-la à la cote réelle
          pour repérer la valeur. Un modèle de forme, pas une garantie.
        </p>
      </div>

      {data === false ? (
        <div className="card muted">Données indisponibles pour l'instant.</div>
      ) : !data ? (
        <div className="card muted">Chargement…</div>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Disciplines">
            {ORDER.map((code) => (
              <button key={code} role="tab" aria-selected={code === disc}
                className={`tab ${code === disc ? "active" : ""}`} onClick={() => changeDisc(code)}>
                {data.disciplines[code]?.label ?? code}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="vs-grid">
              <Combobox label={isPair ? "Paire A" : "Joueur A"} entities={entities} value={a} onChange={setA} exclude={b?.key} />
              <div className="vs-mid">VS</div>
              <Combobox label={isPair ? "Paire B" : "Joueur B"} entities={entities} value={b} onChange={setB} exclude={a?.key} />
            </div>

            {pA == null ? (
              <div className="hint">Sélectionne deux {isPair ? "paires" : "joueurs"} pour voir la prédiction.</div>
            ) : (
              <div className="proba">
                <ProbaRow entity={a} prob={pA} favorite={pA >= 0.5} />
                <ProbaRow entity={b} prob={1 - pA} favorite={pA < 0.5} />
                <p className="muted" style={{ fontSize: 12, textAlign: "center", margin: "4px 0 0" }}>
                  Écart Elo {Math.abs(a.rating - b.rating)} points
                </p>
                {contradiction && (
                  <div className="h2h-alert">
                    ⚠ L'Elo favorise <b>{eloFav.name}</b>, mais <b>{h2hLeader.name}</b> mène{" "}
                    <b>{Math.max(aWins, bWins)}–{Math.min(aWins, bWins)}</b> dans leurs confrontations directes.
                  </div>
                )}
              </div>
            )}
          </div>

          {a && b && (
            <div className="card">
              <h2>Comparaison</h2>
              <div className="h2h-grid">
                <PlayerCard entity={a} matches={aMatches} />
                <PlayerCard entity={b} matches={bMatches} />
              </div>
            </div>
          )}

          {a && b && (
            <div className="card">
              <h2>Confrontations directes</h2>
              {!aData || !bData ? (
                <p className="muted">Chargement…</p>
              ) : h2h.length === 0 ? (
                <p className="muted">Aucune confrontation directe enregistrée entre ces deux {isPair ? "paires" : "joueurs"} sur la période.</p>
              ) : (
                <>
                  <div className="h2h-sum">
                    <span className="big"><span className="win">{aWins}</span> – <span className="loss">{bWins}</span></span>
                    <span className="muted">{a.name} vs {b.name}</span>
                  </div>
                  <div className="h2h-list">
                    {h2h.map((m, i) => (
                      <div className="h2h-row" key={i}>
                        <span className={`h2h-res ${m.won ? "win" : "loss"}`}>{m.won ? "V" : "D"}</span>
                        <span className="h2h-tmt">
                          <Link to={`/tournament/${m.tmtId}`}>{m.tournamentName || m.tmtId}</Link>
                          <span className="muted"> · {m.roundName} · {fmtD(m.matchTime)}</span>
                        </span>
                        <span className="h2h-score">{scoreStr(m)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

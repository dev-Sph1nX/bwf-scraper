import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { getJSON } from "../data.js";

const ORDER = ["MS", "WS", "MD", "WD", "XD"];

// Probabilité de victoire d'A face à B selon l'écart Elo (formule standard).
const winProb = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));

function Combobox({ label, entities, value, onChange, exclude }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return entities
      .filter((e) => e.key !== exclude)
      .filter((e) => !t || e.name.toLowerCase().includes(t))
      .slice(0, 40);
  }, [entities, q, exclude]);

  if (value) {
    return (
      <div>
        <div className="pick-label">{label}</div>
        <div className="chosen">
          <span className="grow">
            <span className="nm">{value.name}</span>
            <span className="sub muted"> · {value.country || "—"}</span>
          </span>
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
        <input
          type="text"
          value={q}
          placeholder="Rechercher…"
          aria-label={label}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />
        {open && (
          <div className="cb-list" role="listbox">
            {matches.length === 0 ? (
              <div className="cb-empty">Aucun résultat</div>
            ) : matches.map((e) => (
              <button
                key={e.key}
                type="button"
                role="option"
                aria-selected="false"
                className="cb-item"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => { onChange(e); setOpen(false); }}
              >
                <span>{e.name}</span>
                <span className="cb-rt">{e.rating}</span>
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
        <span className="odds">cote implicite {odds}</span>
        <span className="pct">{pct}%</span>
      </div>
      <div className="proba-track"><div className="proba-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function Predictor() {
  const { setTitle } = useOutletContext();
  const [data, setData] = useState(null);
  const [disc, setDisc] = useState("MS");
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);

  useEffect(() => { setTitle("Prédicteur"); }, [setTitle]);
  useEffect(() => { getJSON("elo/ranking.json").then(setData).catch(() => setData(false)); }, []);

  // Changer de discipline réinitialise la sélection.
  const changeDisc = (code) => { setDisc(code); setA(null); setB(null); };

  const entities = data?.disciplines?.[disc]?.entities ?? [];
  const isPair = data?.disciplines?.[disc]?.type === "pair";
  const pA = a && b ? winProb(a.rating, b.rating) : null;

  return (
    <>
      <div className="card">
        <h2>Prédicteur tête-à-tête</h2>
        <p className="lead">
          Choisis deux {isPair ? "paires" : "joueurs"} d'une même discipline : l'écart d'Elo
          donne la <b>probabilité de victoire</b> et la cote implicite associée. Un modèle de
          forme, pas une garantie — à croiser avec le contexte (blessures, terrain, historique).
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
              <button
                key={code}
                role="tab"
                aria-selected={code === disc}
                className={`tab ${code === disc ? "active" : ""}`}
                onClick={() => changeDisc(code)}
              >
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
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

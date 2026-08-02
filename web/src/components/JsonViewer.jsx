import { useState } from "react";

// Visionneuse JSON dépliable, pensée pour de GROS fichiers : les enfants d'un
// nœud ne sont montés dans le DOM qu'à l'ouverture (elo/ranking.json ≈ 1,4 Mo
// mettrait des dizaines de milliers de nœuds sinon), et les collections
// s'affichent par tranches de 100.
const TRANCHE = 100;
const STR_MAX = 300;

function Valeur({ v }) {
  if (v === null) return <span className="jv-null">null</span>;
  if (typeof v === "string")
    return <span className="jv-str">"{v.length > STR_MAX ? `${v.slice(0, STR_MAX)}…` : v}"</span>;
  if (typeof v === "number") return <span className="jv-num">{String(v)}</span>;
  if (typeof v === "boolean") return <span className="jv-bool">{String(v)}</span>;
  return <span className="jv-null">{String(v)}</span>;
}

function Branche({ k, v }) {
  const [open, setOpen] = useState(false);
  const [limite, setLimite] = useState(TRANCHE);
  const estTableau = Array.isArray(v);
  const entrees = estTableau ? v.map((x, i) => [i, x]) : Object.entries(v);
  const n = entrees.length;
  const apercu = estTableau ? `[…] ${n} élément${n > 1 ? "s" : ""}` : `{…} ${n} clé${n > 1 ? "s" : ""}`;

  return (
    <div className="jv-node">
      <button type="button" className="jv-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="jv-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
        {k != null && <span className="jv-key">{k}</span>}
        <span className="jv-preview">{apercu}</span>
      </button>
      {open && (
        <div className="jv-children">
          {entrees.slice(0, limite).map(([kk, vv]) =>
            vv !== null && typeof vv === "object" ? (
              <Branche key={kk} k={String(kk)} v={vv} />
            ) : (
              <div className="jv-line" key={kk}>
                <span className="jv-key">{kk}</span>
                <span className="jv-sep">: </span>
                <Valeur v={vv} />
              </div>
            )
          )}
          {n > limite && (
            <button type="button" className="jv-more" onClick={() => setLimite(limite + TRANCHE)}>
              … afficher {Math.min(TRANCHE, n - limite)} de plus ({n - limite} restants)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function JsonViewer({ data }) {
  return (
    <div className="jv">
      {data !== null && typeof data === "object" ? <Branche v={data} /> : <Valeur v={data} />}
    </div>
  );
}

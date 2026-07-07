import { useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { CHANGELOG } from "../changelog.js";

const TYPE = {
  feat: { label: "Nouveau", cls: "feat" },
  improve: { label: "Amélioration", cls: "improve" },
  fix: { label: "Correctif", cls: "fix" },
};

function fmtDay(s) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

export default function Changelog() {
  const { setTitle } = useOutletContext();
  useEffect(() => { setTitle("Notes de version"); }, [setTitle]);

  return (
    <>
      <div className="card">
        <h2>Notes de version</h2>
        <p className="lead">L'historique des évolutions du site, de la plus récente à la plus ancienne.</p>
      </div>

      {CHANGELOG.map((rel, i) => (
        <div className="card" key={i}>
          <div className="cl-head">
            <span className="cl-date">{fmtDay(rel.date)}</span>
            {rel.title && <span className="cl-title">{rel.title}</span>}
          </div>
          <ul className="cl-list">
            {rel.items.map((it, j) => {
              const t = TYPE[it.type] || TYPE.improve;
              return (
                <li className="cl-item" key={j}>
                  <span className={`cl-tag ${t.cls}`}>{t.label}</span>
                  <span className="cl-text">{it.text}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

// web/src/pages/Coulisses.jsx — « est-ce que ça marche ? », expliqué pour humains.
import { useEffect, useState, lazy, Suspense } from "react";
import { useOutletContext } from "react-router-dom";
const Reliability = lazy(() => import("./Reliability.jsx"));
const BooksAudit = lazy(() => import("../components/BooksAudit.jsx"));
const Predictor = lazy(() => import("./Predictor.jsx"));
const Data = lazy(() => import("./Data.jsx"));
const Changelog = lazy(() => import("./Changelog.jsx"));

const SECTIONS = [
  { key: "modele", titre: "Le modèle est-il bon ?", resume:
    "Oui, mesuré : il désigne le bon vainqueur 71,8 % du temps sur 13 700 matchs rejoués, mieux que le classement mondial (68,7 %). Et quand il annonce 70 %, ça se réalise ~70 % du temps depuis la correction de calibration.", C: Reliability },
  { key: "cotes", titre: "D'où viennent les cotes ?", resume:
    "Relevées toutes les 2 h chez Betclic, Unibet et Winamax (avant match seulement), historisées sans jamais rien réécrire, puis rapprochées de nos matchs. Cette section montre les relevés, l'évolution de chaque cote et les rapprochements douteux.", C: BooksAudit },
  { key: "duel", titre: "Simuler un duel", resume:
    "Choisis deux joueurs, le modèle donne sa probabilité — utile pour une finale hypothétique.", C: Predictor },
  { key: "donnees", titre: "Les données", resume:
    "Ce qu'on a téléchargé : tournois, matchs, classements, et leur fraîcheur.", C: Data },
  { key: "versions", titre: "Notes de version", resume: "Ce qui a changé dans l'app, au fil des jours.", C: Changelog },
];

export default function Coulisses() {
  const { setTitle } = useOutletContext();
  const [open, setOpen] = useState(null);
  useEffect(() => { setTitle("Coulisses"); }, [setTitle]);
  return (
    <>
      <div className="card">
        <p className="lead">Tout ce qui permet de vérifier que l'outil dit vrai : chaque section commence par la
        réponse en une phrase, et se déplie pour montrer les preuves.</p>
      </div>
      {SECTIONS.map(({ key, titre, resume, C }) => (
        <div className="card" key={key}>
          <h2 className="coulisse-h2">
            <button type="button" className="coulisse-head" aria-expanded={open === key}
                    onClick={() => setOpen(open === key ? null : key)}>
              <span className="coulisse-title">{titre}</span>
              <span className="coulisse-chevron" aria-hidden="true">{open === key ? "▴" : "▾"}</span>
            </button>
          </h2>
          <p className="lead">{resume}</p>
          {open === key && <Suspense fallback={<p className="muted">Chargement…</p>}><C /></Suspense>}
        </div>
      ))}
    </>
  );
}

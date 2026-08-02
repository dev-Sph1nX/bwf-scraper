// web/src/pages/Coulisses.jsx — « est-ce que ça marche ? », expliqué pour humains.
// Un menu latéral interne (barre horizontale sur mobile) sélectionne UNE section
// à la fois ; la section active vit dans l'URL (?s=) pour être partageable.
import { useEffect, lazy, Suspense } from "react";
import { useOutletContext, useSearchParams, Navigate, useLocation } from "react-router-dom";
const Reliability = lazy(() => import("./Reliability.jsx"));
const BooksAudit = lazy(() => import("../components/BooksAudit.jsx"));
const Data = lazy(() => import("./Data.jsx"));
const Changelog = lazy(() => import("./Changelog.jsx"));

const SECTIONS = [
  { key: "modele", menu: "Le modèle", titre: "Le modèle est-il bon ?", resume:
    "Oui, mesuré : il désigne le bon vainqueur 71,8 % du temps sur 13 700 matchs rejoués, mieux que le classement mondial (68,7 %). Et quand il annonce 70 %, ça se réalise ~70 % du temps depuis la correction de calibration.", C: Reliability },
  { key: "cotes", menu: "Les cotes", titre: "D'où viennent les cotes ?", resume:
    "Relevées toutes les 2 h chez Betclic, Unibet et Winamax (avant match seulement), historisées sans jamais rien réécrire, puis rapprochées de nos matchs. Cette section montre les relevés, l'évolution de chaque cote et les rapprochements douteux.", C: BooksAudit },
  { key: "donnees", menu: "Les données", titre: "Les données", resume:
    "Ce qu'on a téléchargé : tournois, matchs, classements, et leur fraîcheur.", C: Data },
  { key: "versions", menu: "Notes de version", titre: "Notes de version", resume: "Ce qui a changé dans l'app, au fil des jours.", C: Changelog },
];

export default function Coulisses() {
  const { setTitle } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const { search } = useLocation();
  useEffect(() => { setTitle("Coulisses"); }, [setTitle]);

  // Les anciens liens de comparaison (?a=&b=&disc=) pointaient ici quand le
  // duel était une section des coulisses : on les renvoie vers sa page dédiée.
  if (searchParams.get("a") || searchParams.get("b") || searchParams.get("disc")) {
    return <Navigate to={"/predictor" + search} replace />;
  }

  const demande = searchParams.get("s");
  const actif = SECTIONS.some((x) => x.key === demande) ? demande : SECTIONS[0].key;
  const section = SECTIONS.find((x) => x.key === actif);

  const choisir = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set("s", key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="coulisses-layout">
      <nav className="coulisses-menu" aria-label="Sections des coulisses">
        {SECTIONS.map(({ key, menu }) => (
          <button key={key} type="button" aria-pressed={key === actif}
                  className={key === actif ? "active" : ""} onClick={() => choisir(key)}>
            {menu}
          </button>
        ))}
      </nav>
      <div className="coulisses-body">
        <div className="card">
          <h2>{section.titre}</h2>
          <p className="lead">{section.resume}</p>
        </div>
        <Suspense fallback={<p className="muted">Chargement…</p>}><section.C /></Suspense>
      </div>
    </div>
  );
}

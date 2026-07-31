import { useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import BooksAudit from "../components/BooksAudit.jsx";

// Page d'audit des cotes : Betclic / Unibet / Winamax, par opérateur nommé
// (vue par match, vue brute par opérateur, relevés historisés).
//
// L'audit oddsportal a été RETIRÉ le 2026-07-31 (décision du propriétaire) :
// une cote agrégée anonyme ne sert ni l'EV réel ni le journal de paris, là où
// les trois bookmakers FR donnent des cotes réellement misables, jointes par
// identifiant Sportradar et rafraîchies par le cron. Son historique reste
// archivé dans data/odds/runs/ (append-only), et les briques partagées
// (normalisation des noms, appariement) vivent toujours dans lib/.
export default function Odds() {
  const { setTitle } = useOutletContext();
  useEffect(() => { setTitle("Audit des cotes"); }, [setTitle]);
  return <BooksAudit />;
}

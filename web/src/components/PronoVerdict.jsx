// Verdict du pronostic d'un match joué (badge réussi/raté/sans prono/forfait
// + camp donné + cotes de clôture relevées). Extrait de la page Tournoi pour
// être partagé avec la fiche match.

export const BOOK_LABEL = { betclic: "Betclic", unibet: "Unibet", winamax: "Winamax" };

// Seuil sous lequel un Elo est « provisoire » — même valeur que
// provisionalMatches dans lib/elo.mjs (le modèle s'abstient en dessous).
const PROV_MIN = 5;

// Explication du « Sans prono », construite depuis le nombre de matchs CONNUS
// de chaque camp à l'instant du match (embarqué par build-data).
export function sansPronoWhy(m) {
  const name = (t) => (t?.players || []).map((p) => p.nameDisplay).join(" / ");
  const bout = (t, n) => {
    const paire = (t?.players || []).length > 1;
    if (n === 0) return `${name(t)} n'avait encore jamais joué${paire ? " ensemble" : ""}`;
    return `${name(t)} n'avait que ${n} match${n > 1 ? "s" : ""}${paire ? " ensemble" : ""}`;
  };
  const faibles = [];
  if (m.nA != null && m.nA < PROV_MIN) faibles.push(bout(m.team1, m.nA));
  if (m.nB != null && m.nB < PROV_MIN) faibles.push(bout(m.team2, m.nB));
  if (!faibles.length) return "Pas de pronostic : Elo encore provisoire au moment du match.";
  return `Pas de pronostic : ${faibles.join(" et ")} à notre connaissance au moment du match — ` +
    `en dessous de ${PROV_MIN} matchs, l'Elo est encore provisoire et le modèle s'abstient ` +
    `plutôt que d'inventer une probabilité.`;
}

export default function PronoVerdict({ m }) {
  const pickTeam = m.pick === 1 ? m.team1 : m.team2;
  const pickName = (pickTeam?.players || []).map((p) => p.nameDisplay).join(" / ");
  const pickProb = m.pick === 1 ? m.prob : 100 - m.prob;
  return (
    <div className="prono-cell">
      {m.walkover ? (
        <span className="badge warn" title={m.status || "Forfait / abandon : pas un match à prédire"}>Forfait</span>
      ) : m.pick == null ? (
        <span className="badge warn" tabIndex={0} title={sansPronoWhy(m)}>Sans prono</span>
      ) : (
        <>
          <span className={`badge ${m.ok ? "ok" : "ko"}`}>{m.ok ? "✓ Prono réussi" : "✗ Prono raté"}</span>
          <span className="prono-pick">Donné : <b>{pickName}</b> à <b>{pickProb}%</b></span>
        </>
      )}
      {m.odds && (
        <span className="prono-odds">
          {Object.entries(m.odds.books).map(([op, b]) => (
            <span key={op}>
              {BOOK_LABEL[op] || op}{" "}
              <span className={m.winner === 1 ? "win" : ""}>{b.odd1.toLocaleString("fr-FR")}</span>
              {" / "}
              <span className={m.winner === 2 ? "win" : ""}>{b.odd2.toLocaleString("fr-FR")}</span>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

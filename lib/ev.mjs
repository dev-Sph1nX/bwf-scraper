// Valeur attendue d'un pari : EV = cote × p − 1 (p = proba CALIBRÉE, cf. spec).
// EV > 0 : à la longue, ce pari rapporte. La marge du bookmaker (~6-9 %) rend
// presque tout négatif : le rôle de l'écran est de débusquer les exceptions.

/** EV par euro misé ; null si la cote ne paie pas ou si p est inconnue. */
export function ev(odd, p) {
  if (!(odd > 1) || p == null || !Number.isFinite(p)) return null;
  return odd * p - 1;
}

/** Meilleure cote d'un camp parmi les opérateurs. side : 1 ou 2. */
export function bestOdd(books, side) {
  let best = null;
  for (const [book, b] of Object.entries(books || {})) {
    const odd = side === 1 ? b?.odd1 : b?.odd2;
    if (odd > 1 && (!best || odd > best.odd)) best = { odd, book };
  }
  return best;
}

/** Nombre total de points traçables (le bouton graphe s'active à partir de 2). */
export function pointsTotal(books) {
  return Object.values(books || {}).reduce((s, b) => s + (b?.points?.length || 0), 0);
}

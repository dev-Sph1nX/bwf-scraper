// lib/home-data.mjs
// Prépare les cotes d'un groupe bookmakers pour la carte d'accueil :
// tout est réorienté vers team1/team2 BWF (le groupe, lui, est orienté vers
// son propre p1 — `swapped` du rapprochement dit si les deux ordres diffèrent).

const flipPoint = (p) => ({ ...p, odd1: p.odd2, odd2: p.odd1, impliedP1: p.impliedP1 == null ? null : 1 - p.impliedP1 });

export function oddsForMatch(group, swapped) {
  const books = {};
  let n = 0;
  for (const [op, b] of Object.entries(group.books || {})) {
    const points = (b.points || []).map((p) => (swapped ? flipPoint(p) : p));
    n += points.length;
    books[op] = {
      odd1: swapped ? b.odd2 ?? null : b.odd1 ?? null,
      odd2: swapped ? b.odd1 ?? null : b.odd2 ?? null,
      points,
    };
  }
  return { bookKey: group.key, n, books };
}

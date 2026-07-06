// Accès aux données statiques générées dans public/data/ par build-data.mjs.
export const YEAR = 2026;

const BASE = import.meta.env.BASE_URL; // "./" en prod, "/" en dev

export async function getJSON(path) {
  const res = await fetch(`${BASE}data/${path}`);
  if (!res.ok) throw new Error(`${res.status} sur ${path}`);
  return res.json();
}

// Score d'un set du point de vue d'une équipe
export function setsFor(match, side) {
  return (match.score ?? []).map((s) => {
    const mine = side === 1 ? s.home : s.away;
    const other = side === 1 ? s.away : s.home;
    return { value: mine, won: mine > other };
  });
}

// Accès aux données statiques générées dans public/data/ par build-data.mjs.
export const YEAR = 2026;

const BASE = import.meta.env.BASE_URL; // "./" en prod, "/" en dev

export async function getJSON(path) {
  const res = await fetch(`${BASE}data/${path}`);
  if (!res.ok) throw new Error(`${res.status} sur ${path}`);
  return res.json();
}

// Clé d'entité d'un camp : id du joueur en simple, `pair:<id1>-<id2>` (ids
// triés) en double — même règle que entityId côté build-data.
export function entityKeyOf(players) {
  const ids = (players || []).map((p) => String(p.id)).sort();
  return ids.length > 1 ? `pair:${ids.join("-")}` : ids[0] || "";
}

// Chemin de la fiche d'un match joué : /match/<tmtId>/<disc|jour|a|b> — la
// même clé que build-data côté écriture de pronos/points. `m` accepte les
// entrées de pronos (disc) comme celles des fiches joueur/paire (eventName).
export function matchPath(tmtId, m) {
  const disc = m.disc || m.eventName;
  const day = String(m.matchTime || "").slice(0, 10);
  const key = `${disc}|${day}|${entityKeyOf(m.team1?.players)}|${entityKeyOf(m.team2?.players)}`;
  return `/match/${tmtId}/${encodeURIComponent(key)}`;
}

// Score d'un set du point de vue d'une équipe
export function setsFor(match, side) {
  return (match.score ?? []).map((s) => {
    const mine = side === 1 ? s.home : s.away;
    const other = side === 1 ? s.away : s.home;
    return { value: mine, won: mine > other };
  });
}

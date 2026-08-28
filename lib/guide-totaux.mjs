// lib/guide-totaux.mjs
// Guide de pari « totaux » : applique la règle SCELLÉE du bureau d'études aux
// dernières lignes over/under relevées chez Betclic (champ `totals` des séries
// de lib/books-history.mjs), pour la page /guide-pari du site.
//
// LA RÈGLE N'EST PAS UN RÉGLAGE. Elle est pré-enregistrée et scellée le
// 2026-08-28 dans bwf-playground/regle-rel-moins-2/ (commit 9c8ed94) : over
// dès que la barre est ≤ (barre habituelle de la discipline − 2), au prix
// d'ouverture, mise plate. Les barres habituelles sont les médianes des
// lignes misables Betclic de l'export gelé du 2026-08-20, recopiées ici (le
// site ne lit pas le playground). Modifier une constante = NOUVELLE règle à
// re-sceller là-bas d'abord — jamais un ajustement local.

export const BARRES_TOTAUX = { MS: 77.5, MD: 77.5, XD: 77.5, WS: 75.5, WD: 75.5 };
export const SEUIL_REL = -2;

/**
 * Construit les entrées du guide depuis les séries bookmakers.
 * Betclic seul (seul opérateur français à coter les totaux BWF), prématch
 * seulement, matchs non commencés à `nowIso`. Chaque barre du match est
 * rendue avec son écart à la barre habituelle (`rel`) et `conseil: true` sur
 * les barres éligibles (rel ≤ −2 et cote over disponible).
 * @param {Array<object>} series sorties de buildBookSeries
 * @param {string} nowIso instant du build (ISO)
 * @returns {Array<object>} entrées triées par heure de match, conseils d'abord
 */
export function guideTotaux(series, nowIso) {
  const entries = [];
  for (const s of series || []) {
    if (s.book !== "betclic" || !Array.isArray(s.totals) || !s.totals.length) continue;
    if (s.isLive || !s.startUtc || s.startUtc <= nowIso) continue;
    const barre = BARRES_TOTAUX[s.discipline] ?? null;
    const lignes = s.totals.map((t) => {
      const rel = barre == null ? null : Number((t.n - barre).toFixed(1));
      return {
        n: t.n,
        over: t.over ?? null,
        under: t.under ?? null,
        rel,
        conseil: rel != null && rel <= SEUIL_REL && t.over != null,
      };
    });
    entries.push({
      p1: s.p1,
      p2: s.p2,
      tournament: s.tournament ?? null,
      discipline: s.discipline ?? null,
      startUtc: s.startUtc,
      totalsAt: s.totalsAt ?? null,
      barre,
      lignes,
      nConseils: lignes.filter((l) => l.conseil).length,
    });
  }
  // Les matchs à conseil d'abord, puis par heure de match : le parieur lit le
  // haut de la liste, le reste est le contexte « rien à jouer ici ».
  entries.sort((a, b) =>
    (b.nConseils > 0) - (a.nConseils > 0) || a.startUtc.localeCompare(b.startUtc));
  return entries;
}

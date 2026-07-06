// lib/updater.mjs
// Orchestration du téléchargement, incrémentale et reprenable :
//   1. récupère le calendrier de l'année (liste des tournois)
//   2. pour chaque tournoi PASSÉ ou EN COURS : récupère ses draws
//   3. pour chaque draw : récupère les matchs, en sautant ce qu'on a déjà
//
// Règles pour éviter de re-télécharger :
//   - tournoi "future"          -> ignoré (pas encore de tableaux)
//   - tournoi "post" (terminé)  -> téléchargé une seule fois, puis sauté
//   - tournoi "live" (en cours) -> toujours rafraîchi
//
// onProgress(event) reçoit des objets { type, ... } pour l'affichage live.

import { BwfClient } from "./client.mjs";
import { fetchYear, fetchDraws, fetchDraw, flattenTournaments } from "./api.mjs";
import * as store from "./store.mjs";

const noop = () => {};

/**
 * Lance une mise à jour complète pour une année.
 * @param {number|string} year
 * @param {(event: any) => void} [onProgress]
 */
export async function runUpdate(year, onProgress = noop) {
  const client = await new BwfClient().start();
  const stats = { tournaments: 0, drawsFetched: 0, drawsSkipped: 0, matches: 0 };
  // Récapitulatif de ce qui a été RÉELLEMENT téléchargé cette fois-ci.
  const fetchedByTournament = new Map(); // tmtId -> { name, draws: [] }

  try {
    onProgress({ type: "start", year });

    // 1. Calendrier
    onProgress({ type: "step", message: `Récupération du calendrier ${year}...` });
    const yearData = await fetchYear(client, year);
    await store.saveYear(year, yearData);
    const tournaments = flattenTournaments(yearData);
    stats.tournaments = tournaments.length;
    onProgress({ type: "year", count: tournaments.length });

    // 2. Chaque tournoi
    for (const t of tournaments) {
      const isFuture = t.live_status === "future";
      const isLive = t.live_status === "live";

      if (isFuture) {
        onProgress({ type: "tournament", id: t.id, name: t.name, status: "future", skipped: true });
        continue;
      }

      onProgress({ type: "tournament", id: t.id, name: t.name, status: t.live_status });

      // 2a. Draws du tournoi (re-fetch si live ou si absent)
      let draws = await store.getDraws(year, t.id);
      if (!draws || isLive) {
        draws = await fetchDraws(client, t.id);
        await store.saveDraws(year, t.id, draws);
      }

      // 2b. Chaque draw
      for (const d of draws.results ?? []) {
        const drawId = d.value;
        const already = await store.hasDraw(year, t.id, drawId);

        // On saute si déjà présent ET tournoi terminé (résultats figés).
        if (already && !isLive) {
          stats.drawsSkipped++;
          onProgress({ type: "draw", id: t.id, drawId, label: d.text, skipped: true });
          continue;
        }

        try {
          const drawData = await fetchDraw(client, t.id, drawId);
          await store.saveDraw(year, t.id, drawId, drawData, t.live_status);
          const n = (drawData.matches ?? []).length;
          stats.drawsFetched++;
          stats.matches += n;
          if (!fetchedByTournament.has(t.id)) fetchedByTournament.set(t.id, { name: t.name, draws: [] });
          fetchedByTournament.get(t.id).draws.push({ label: d.text, matchCount: n });
          onProgress({ type: "draw", id: t.id, drawId, label: d.text, matchCount: n });
        } catch (err) {
          onProgress({ type: "error", id: t.id, drawId, message: String(err?.message ?? err) });
        }
      }
    }

    // Sauvegarde du récapitulatif du dernier téléchargement.
    const items = [...fetchedByTournament.entries()].map(([id, v]) => ({ id, name: v.name, draws: v.draws }));
    await store.saveLastRun(year, { finishedAt: new Date().toISOString(), stats, items });

    onProgress({ type: "done", stats });
    return stats;
  } finally {
    await client.close();
  }
}

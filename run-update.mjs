// run-update.mjs
// Lance le scrape complet d'une année (calendrier -> draws -> matchs),
// en mode incrémental. Utilisé en local et par GitHub Actions.
//
//   node run-update.mjs           # année 2026 (défaut)
//   node run-update.mjs 2026

import { runUpdate } from "./lib/updater.mjs";

const YEAR = Number(process.argv[2]) || 2026;

await runUpdate(YEAR, (ev) => {
  if (ev.type === "tournament" && !ev.skipped) console.log(`📍 ${ev.name} [${ev.status}]`);
  else if (ev.type === "draw" && !ev.skipped) console.log(`   ✓ ${ev.label} — ${ev.matchCount} matchs`);
  else if (ev.type === "done") console.log(`✅ ${ev.stats.drawsFetched} draws, ${ev.stats.matches} matchs, ${ev.stats.drawsSkipped} déjà à jour`);
  else if (ev.type === "error") console.log(`⚠ ${ev.message}`);
});

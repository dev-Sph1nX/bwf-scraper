// measures/mesure-ws-favori-80.mjs
// DERNIER TIROIR DE L'HYPOTHÈSE H1 (§8.3) — « favori WS à confiance ≥ 80 % ».
//
// Historique : seule case quasi neutre avec du volume en 2026 partiel
// (+1,3 % [−3,5 ; +5,5] sur 176 paris, §8.1, données arrêtées au 2026-08-04) ;
// déjà REJETÉE hors échantillon sur 2024-2025 (−4,4 % [−8,4 ; −0,4], §8.4).
// Ici : la même case sur le journal de paris COMPLET (2026 y compris la suite
// de la saison), par année et par instant. Même méthode que §8.1/§8.4 :
// filtrer `web/public/data/roi.json .bets`, agréger via lib/roi.mjs (IC
// bootstrap, graine 42). Contexte de décision : même un IC positif ne
// franchirait pas le péage (§10.9 : aucune tranche du marché sous 3 %).
//
//   node measures/mesure-ws-favori-80.mjs

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregate } from "../lib/roi.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const roi = JSON.parse(await readFile(join(ROOT, "web", "public", "data", "roi.json"), "utf8"));

// Confiance = proba repliée sur le camp MISÉ (le favori) — comme les bandes §8.1.
const confidence = (b) => (b.side === 1 ? b.prob : 100 - b.prob);
const favWS = roi.bets.filter((b) => b.strategy === "favori" && b.disc === "WS");
const years = [...new Set(favWS.map((b) => Number(b.matchTime.slice(0, 4))))].sort();

const pct = (v, d = 1) => (v == null ? "—" : (v >= 0 ? "+" : "") + (v * 100).toFixed(d) + " %");
const line = (label, bets) => {
  const a = aggregate(bets);
  console.log(
    `  ${label.padEnd(26)} n=${String(a.n).padStart(4)}  ROI ${pct(a.roi).padStart(8)}` +
    (a.ci ? `  IC [${pct(a.ci[0])} ; ${pct(a.ci[1])}]` : ""),
  );
};

console.log(`Journal de paris : ${roi.bets.length} entrées (généré ${roi.generatedAt || "?"})`);
console.log(`Favori WS : ${favWS.length} paris, années ${years.join(", ")}\n`);

for (const instant of ["close", "open"]) {
  const inst = favWS.filter((b) => b.instant === instant);
  console.log(`--- WS favori, confiance ≥ 80 %, instant « ${instant} » ---`);
  for (const y of years) {
    line(`${y}`, inst.filter((b) => Number(b.matchTime.slice(0, 4)) === y && confidence(b) >= 80));
  }
  line("TOTAL 2024-2026", inst.filter((b) => confidence(b) >= 80));
  line("(contexte : WS toutes conf.)", inst);
  console.log();
}

console.log("Repères : §8.1 (2026 arrêté au 04/08, close) : +1,3 % [−3,5 ; +5,5] sur 176 paris ;");
console.log("          §8.4 (2024-2025, close) : −4,4 % [−8,4 ; −0,4] sur 264 paris.");

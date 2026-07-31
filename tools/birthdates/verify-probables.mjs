// Vérifie via l'API BWF (jointure par ID, donc certaine) :
//  - les 62 appariements Wikidata faits par nom (risque d'inversion de tokens)
//  - les cas ambigus (homonymes) pour les trancher
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { BwfClient } from "/Users/lucasleperlier/Documents/bwf-scraper/lib/client.mjs";

const DIR = "/private/tmp/claude-501/-Users-lucasleperlier-Documents-bwf-scraper/30cbbb29-611a-4142-af78-2a5c6d40cecb/scratchpad/agents/birthdates";
const matched = JSON.parse(readFileSync(`${DIR}/matched-wikidata.json`, "utf8"));
const ambiguous = JSON.parse(readFileSync(`${DIR}/ambiguous.json`, "utf8"));

const ids = [
  ...Object.entries(matched).filter(([, v]) => v.confidence === "probable").map(([id]) => id),
  ...Object.keys(ambiguous),
];
const OUT = `${DIR}/bwf-verify.json`;
const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const BASE = "https://extranet-lv.bwfbadminton.com/api";
const client = await new BwfClient().start();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let done = 0;
for (const id of ids) {
  if (out[id] && !out[id].error) { done++; continue; }
  try {
    const sum = await client.getJson(`${BASE}/vue-player-summary?drawCount=1&playerId=${id}&isPara=false`);
    const r = sum?.results || {};
    out[id] = { dob: (r.date_of_birth || "").slice(0, 10) || null, apiName: r.name_display || null, apiNationality: r.nationality || null };
  } catch (e) {
    out[id] = { error: String(e).slice(0, 150) };
  }
  done++;
  if (done % 10 === 0) { writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`progress ${done}/${ids.length}`); }
  await sleep(900 + Math.random() * 600);
}
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`DONE ${done}/${ids.length}`);
await client.close();

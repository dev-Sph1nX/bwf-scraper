// Étape 2b (v2) : API JSON des fiches joueur BWF via le BwfClient du projet.
// vue-player-summary -> date_of_birth + nationality ; vue-player-bio -> hand.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { BwfClient } from "/Users/lucasleperlier/Documents/bwf-scraper/lib/client.mjs";

const DIR = "/private/tmp/claude-501/-Users-lucasleperlier-Documents-bwf-scraper/30cbbb29-611a-4142-af78-2a5c6d40cecb/scratchpad/agents/birthdates";
const MAX = Number(process.argv[2] || 150);
const unmatched = JSON.parse(readFileSync(`${DIR}/unmatched.json`, "utf8"));
const targets = unmatched.slice(0, MAX);
const OUT = `${DIR}/bwf-api-scraped.json`;
const scraped = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

const BASE = "https://extranet-lv.bwfbadminton.com/api";
const client = await new BwfClient().start();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let done = 0, ok = 0, fail = 0;
for (const p of targets) {
  if (scraped[p.id] && !scraped[p.id].error) { done++; continue; }
  try {
    const sum = await client.getJson(`${BASE}/vue-player-summary?drawCount=1&playerId=${p.id}&isPara=false`);
    const r = sum?.results || {};
    let hand = null;
    try {
      const bio = await client.getJson(`${BASE}/vue-player-bio?activeTab=1&playerId=${p.id}`);
      if (bio?.hand) hand = /left/i.test(bio.hand) ? "left" : /right/i.test(bio.hand) ? "right" : null;
      await sleep(600 + Math.random() * 500);
    } catch {}
    const dob = (r.date_of_birth || "").slice(0, 10) || null;
    scraped[p.id] = {
      name: p.nameDisplay, country: p.countryCode,
      dob, hand,
      apiName: r.name_display || null, apiNationality: r.nationality || null,
      apiId: r.id ?? null,
    };
    if (dob) ok++; else fail++;
  } catch (e) {
    scraped[p.id] = { name: p.nameDisplay, country: p.countryCode, error: String(e).slice(0, 150) };
    fail++;
  }
  done++;
  if (done % 10 === 0) {
    writeFileSync(OUT, JSON.stringify(scraped, null, 1));
    console.log(`progress ${done}/${targets.length} ok=${ok} fail=${fail}`);
  }
  await sleep(900 + Math.random() * 600);
}
writeFileSync(OUT, JSON.stringify(scraped, null, 1));
console.log(`DONE ${done}/${targets.length} ok=${ok} fail=${fail}`);
await client.close();

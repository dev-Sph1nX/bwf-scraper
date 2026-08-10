// Étape 1 : extraire la liste des joueurs depuis data/<année>/<tournoi>/draw-*.json
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA = "/Users/lucasleperlier/Documents/bwf-scraper/data";
// players.json est un dérivé (régénérable à volonté depuis data/) : il vit à
// côté du script — les anciens chemins /tmp disparaissaient entre sessions.
const OUT = new URL("./players.json", import.meta.url).pathname;

const players = new Map(); // id -> {id, nameDisplay, firstName, lastName, countryCode, slug, matches}

function addPlayer(p) {
  if (!p || !p.id) return;
  const id = String(p.id);
  let e = players.get(id);
  if (!e) {
    e = {
      id,
      nameDisplay: p.nameDisplay || "",
      firstName: p.firstName || "",
      lastName: p.lastName || "",
      countryCode: p.countryCode || "",
      slug: p.slug || "",
      matches: 0,
    };
    players.set(id, e);
  }
  e.matches++;
  // garder les champs les plus complets
  if (!e.slug && p.slug) e.slug = p.slug;
  if (!e.countryCode && p.countryCode) e.countryCode = p.countryCode;
}

let files = 0, matches = 0;
for (const year of readdirSync(DATA)) {
  if (!/^\d{4}$/.test(year)) continue;
  const ydir = join(DATA, year);
  for (const t of readdirSync(ydir)) {
    const tdir = join(ydir, t);
    let entries;
    try { entries = readdirSync(tdir); } catch { continue; }
    for (const f of entries) {
      if (!/^draw-.*\.json$/.test(f)) continue;
      files++;
      let doc;
      try { doc = JSON.parse(readFileSync(join(tdir, f), "utf8")); } catch { continue; }
      const results = doc.results || doc;
      for (const key of Object.keys(results)) {
        const m = results[key]?.match;
        if (!m) continue;
        matches++;
        for (const team of [m.team1, m.team2]) {
          for (const p of team?.players || []) addPlayer(p);
        }
      }
    }
  }
}

const list = [...players.values()].sort((a, b) => b.matches - a.matches);
writeFileSync(OUT, JSON.stringify(list, null, 1));
console.log(`files=${files} matches=${matches} players=${list.length}`);
console.log("total appearances:", list.reduce((s, p) => s + p.matches, 0));
console.log("top 5:", list.slice(0, 5).map(p => `${p.nameDisplay}(${p.countryCode},${p.matches})`).join(", "));
const byCountry = {};
for (const p of list) byCountry[p.countryCode] = (byCountry[p.countryCode] || 0) + 1;
console.log("countries:", Object.entries(byCountry).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(" "));

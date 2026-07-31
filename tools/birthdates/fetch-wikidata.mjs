// Étape 2a : récupération en masse des joueurs de badminton sur Wikidata
import { writeFileSync } from "node:fs";

const DIR = "/private/tmp/claude-501/-Users-lucasleperlier-Documents-bwf-scraper/30cbbb29-611a-4142-af78-2a5c6d40cecb/scratchpad/agents/birthdates";
const UA = "bwf-elo-birthdate-research/1.0 (contact: lucas.leperlier@ellistat.com; one-off bulk query)";

const query = `
SELECT ?p ?pLabel ?pAltLabel ?dob ?prec ?ioc ?handLabel ?bwfid WHERE {
  ?p wdt:P106 wd:Q13141064 .
  ?p p:P569 ?dobStmt .
  ?dobStmt psv:P569 ?dobNode .
  ?dobNode wikibase:timeValue ?dob ; wikibase:timePrecision ?prec .
  FILTER(YEAR(?dob) >= 1970)
  OPTIONAL { ?p wdt:P3620 ?bwfid }
  OPTIONAL { ?p wdt:P552 ?hand }
  OPTIONAL { ?p wdt:P27 ?c . OPTIONAL { ?c wdt:P984 ?ioc } }
  SERVICE wikibase:label {
    bd:serviceParam wikibase:language "en".
    ?p rdfs:label ?pLabel .
    ?p skos:altLabel ?pAltLabel .
    ?hand rdfs:label ?handLabel .
  }
}`;

async function run(q) {
  const res = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/sparql-results+json",
    },
    body: new URLSearchParams({ query: q }).toString(),
  });
  console.log("HTTP", res.status);
  const text = await res.text();
  if (!res.ok) { console.error(text.slice(0, 2000)); process.exit(1); }
  return JSON.parse(text);
}

const json = await run(query);
const rows = json.results.bindings;
console.log("rows:", rows.length);

// Agrégation par entité
const ents = new Map();
for (const r of rows) {
  const qid = r.p.value.split("/").pop();
  let e = ents.get(qid);
  if (!e) {
    e = { qid, label: r.pLabel?.value || "", alts: new Set(), dobs: new Set(), iocs: new Set(), hand: null, bwfids: new Set() };
    ents.set(qid, e);
  }
  if (r.pAltLabel?.value) for (const a of r.pAltLabel.value.split(", ")) e.alts.add(a);
  if (r.dob?.value) e.dobs.add(JSON.stringify({ t: r.dob.value, prec: +(r.prec?.value ?? 0) }));
  if (r.ioc?.value) e.iocs.add(r.ioc.value);
  if (r.handLabel?.value) e.hand = r.handLabel.value;
  if (r.bwfid?.value) e.bwfids.add(r.bwfid.value);
}
const out = [...ents.values()].map(e => ({
  qid: e.qid, label: e.label, alts: [...e.alts], dobs: [...e.dobs].map(s => JSON.parse(s)),
  iocs: [...e.iocs], hand: e.hand, bwfids: [...e.bwfids],
}));
writeFileSync(`${DIR}/wikidata-raw.json`, JSON.stringify(out));
console.log("entities:", out.length);
console.log("with bwfid:", out.filter(e => e.bwfids.length).length);
console.log("with hand:", out.filter(e => e.hand).length);

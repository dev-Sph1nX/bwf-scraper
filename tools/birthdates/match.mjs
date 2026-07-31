// Appariement joueurs BWF <-> entités Wikidata
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "/private/tmp/claude-501/-Users-lucasleperlier-Documents-bwf-scraper/30cbbb29-611a-4142-af78-2a5c6d40cecb/scratchpad/agents/birthdates";
const players = JSON.parse(readFileSync(`${DIR}/players.json`, "utf8"));
const wd = JSON.parse(readFileSync(`${DIR}/wikidata-raw.json`, "utf8"));

// --- Table pays BWF -> codes IOC acceptables (P984 du pays de nationalité) ---
// La plupart des codes BWF SONT des codes IOC. Cas particuliers :
const COUNTRY_MAP = {
  ENG: ["GBR"], SCO: ["GBR"], WAL: ["GBR"], NIR: ["GBR", "IRL"],
  AIN: ["RUS", "BLR"],           // athlètes neutres
  HKG: ["HKG", "CHN"],           // citoyenneté parfois saisie "Chine"
  MAC: ["MAC", "CHN"],
  TPE: ["TPE"],
};
function acceptableIocs(bwf) { return COUNTRY_MAP[bwf] || [bwf]; }
function countryCompatible(bwf, iocs) {
  if (!iocs.length) return null; // inconnu côté wikidata
  const acc = acceptableIocs(bwf);
  return iocs.some(c => acc.includes(c));
}

// --- Normalisation de nom : accents, casse, ordre des mots ---
function normTokens(s) {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o").replace(/æ/gi, "ae").replace(/ß/g, "ss").replace(/đ/gi, "d")
    .toLowerCase().replace(/[^a-z]+/g, " ").trim().split(/\s+/).filter(Boolean);
}
const key = toks => [...toks].sort().join(" ");

// --- Choix de la date : précision 11 = jour ---
function pickDob(e) {
  const day = [...new Set(e.dobs.filter(d => d.prec >= 11).map(d => d.t.slice(0, 10)))];
  if (day.length === 1) return { dob: day[0], quality: "day" };
  if (day.length > 1) return { dob: null, quality: "conflict", candidates: day };
  const lesser = [...new Set(e.dobs.map(d => d.t.slice(0, 10)))];
  return { dob: null, quality: "imprecise", candidates: lesser };
}
function pickHand(e) {
  if (!e.hand) return null;
  if (/left/i.test(e.hand)) return "left";
  if (/right/i.test(e.hand)) return "right";
  return null;
}

// --- Index Wikidata ---
const byBwfId = new Map();
for (const e of wd) for (const id of e.bwfids) {
  if (!byBwfId.has(id)) byBwfId.set(id, []);
  byBwfId.get(id).push(e);
}
const byNameKey = new Map(); // clé triée -> Set d'entités
function addName(k, e) {
  if (!byNameKey.has(k)) byNameKey.set(k, new Set());
  byNameKey.get(k).add(e);
}
for (const e of wd) {
  const names = [e.label, ...e.alts];
  for (const n of names) {
    const t = normTokens(n);
    if (t.length >= 2) addName(key(t), e);
  }
}

// --- Appariement ---
const result = {};   // livrable principal
const ambiguous = {}; // cas douteux
const unmatched = []; // pour l'étape BWF/Playwright
const stats = { byId: 0, byName: 0, ambiguous: 0, unmatched: 0, impreciseOnly: 0 };

function record(p, e, confidence, via) {
  const d = pickDob(e);
  if (d.quality === "day") {
    result[p.id] = {
      name: p.nameDisplay, country: p.countryCode, dob: d.dob,
      hand: pickHand(e), source: "wikidata", confidence,
      _qid: e.qid, _via: via,
    };
    return true;
  }
  if (d.quality === "conflict") {
    ambiguous[p.id] = { name: p.nameDisplay, country: p.countryCode, matches: p.matches,
      reason: "dates de naissance contradictoires (précision jour) sur Wikidata",
      candidates: [{ qid: e.qid, label: e.label, dobs: d.candidates }] };
    stats.ambiguous++;
    return true; // traité (pas de re-scrape forcé ? si, on peut re-scraper) -> on le laisse aussi en unmatched
  }
  // imprecise : année/mois seulement -> on préfère tenter la fiche BWF
  stats.impreciseOnly++;
  return false;
}

for (const p of players) {
  // 1) jointure directe par ID BWF (P3620)
  const direct = byBwfId.get(p.id);
  if (direct?.length === 1) {
    if (record(p, direct[0], "exact", "bwfid")) { stats.byId++; continue; }
  } else if (direct?.length > 1) {
    ambiguous[p.id] = { name: p.nameDisplay, country: p.countryCode, matches: p.matches,
      reason: "plusieurs entités Wikidata portent ce même ID BWF (P3620)",
      candidates: direct.map(e => ({ qid: e.qid, label: e.label, iocs: e.iocs })) };
    stats.ambiguous++;
    continue;
  }

  // 2) appariement par nom normalisé + pays
  const toks = normTokens(`${p.firstName} ${p.lastName}`);
  const cands = [...(byNameKey.get(key(toks)) || [])];
  if (cands.length) {
    const compat = cands.filter(e => countryCompatible(p.countryCode, e.iocs) === true);
    const unknown = cands.filter(e => countryCompatible(p.countryCode, e.iocs) === null);
    if (compat.length === 1) {
      if (record(p, compat[0], "probable", "name+country")) { stats.byName++; continue; }
    } else if (compat.length > 1) {
      ambiguous[p.id] = { name: p.nameDisplay, country: p.countryCode, matches: p.matches,
        reason: "homonymes : plusieurs entités Wikidata avec même nom et pays compatible",
        candidates: compat.map(e => ({ qid: e.qid, label: e.label, iocs: e.iocs, dobs: e.dobs.map(d => d.t.slice(0, 10)) })) };
      stats.ambiguous++;
      continue;
    } else if (compat.length === 0 && unknown.length === 1 && cands.length === 1) {
      // nom unique au monde, pays inconnu côté Wikidata -> probable si nom à >=3 tokens sinon douteux
      if (toks.length >= 3) {
        if (record(p, unknown[0], "probable", "name-unique-noCountry")) { stats.byName++; continue; }
      } else {
        ambiguous[p.id] = { name: p.nameDisplay, country: p.countryCode, matches: p.matches,
          reason: "nom court unique sur Wikidata mais nationalité absente : risque d'homonyme",
          candidates: [{ qid: unknown[0].qid, label: unknown[0].label, dobs: unknown[0].dobs.map(d => d.t.slice(0, 10)) }] };
        stats.ambiguous++;
        continue;
      }
    } else if (cands.length >= 1 && compat.length === 0 && unknown.length === 0) {
      // même nom mais pays incompatible -> homonyme d'un autre pays, PAS un match
    }
  }

  unmatched.push(p);
}
stats.unmatched = unmatched.length;

writeFileSync(`${DIR}/matched-wikidata.json`, JSON.stringify(result, null, 1));
writeFileSync(`${DIR}/ambiguous.json`, JSON.stringify(ambiguous, null, 1));
writeFileSync(`${DIR}/unmatched.json`, JSON.stringify(unmatched, null, 1));

// Couverture
const totApp = players.reduce((s, p) => s + p.matches, 0);
const matchedIds = new Set(Object.keys(result));
const covApp = players.filter(p => matchedIds.has(p.id)).reduce((s, p) => s + p.matches, 0);
console.log(JSON.stringify(stats));
console.log(`matched: ${matchedIds.size}/${players.length} (${(100 * matchedIds.size / players.length).toFixed(1)}%)`);
console.log(`weighted by matches: ${covApp}/${totApp} (${(100 * covApp / totApp).toFixed(1)}%)`);
console.log(`hand known: ${Object.values(result).filter(r => r.hand).length}`);
console.log(`unmatched top 15:`, unmatched.slice(0, 15).map(p => `${p.nameDisplay}(${p.countryCode},${p.matches})`).join("; "));

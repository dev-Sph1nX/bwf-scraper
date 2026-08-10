#!/usr/bin/env node
// scrape-hands.mjs — collecte la main dominante (hand) + taille (height) des
// joueurs BWF via l'API vue-player-bio, en franchissant Cloudflare avec
// Playwright (le HTTP pur renvoie 403).
//
// Endpoint : GET https://extranet-lv.bwfbadminton.com/api/vue-player-bio?activeTab=1&playerId=<id>
// PIÈGE : sans `activeTab=1`, `hand` revient null. Les en-têtes origin/referer
// bwfbadminton.com sont envoyés aussi (la réponse peut différer sans eux).
//
// Usage :
//   node scrape-hands.mjs [--max-minutes=40] [--delay-ms=600] [--ids=34,57945]
//
// Reprise incrémentale : l'avancement est écrit dans hands-progress.json
// (même dossier) toutes les 50 requêtes et à l'arrêt ; relancer le script
// reprend là où il s'était arrêté. Ctrl-C = arrêt propre (sauvegarde).
//
// Entrées :
//   - players.json (liste {id, nameDisplay, countryCode, matches}) produit par
//     tools/birthdates/extract-players.mjs — chemin surchargeable via --players=
//   - data/players/birthdates.json (pour connaître les mains déjà connues)
// Sortie : hands-progress.json = { "<id>": { hand: "right"|"left"|null,
//   height: number|null, name, raw, fetchedAt } | { error, fetchedAt } }

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/Users/lucasleperlier/Documents/bwf-scraper/node_modules/playwright/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v ?? true];
  })
);

// players.json vit à côté du script (produit par extract-players.mjs — les
// anciens chemins /tmp disparaissaient entre sessions).
const PLAYERS_PATH = args.players || join(HERE, "players.json");
const BIRTHDATES_PATH =
  args.birthdates || "/Users/lucasleperlier/Documents/bwf-scraper/data/players/birthdates.json";
const PROGRESS_PATH = args.progress || join(HERE, "hands-progress.json");
const MAX_MINUTES = Number(args["max-minutes"] ?? 40);
const DELAY_MS = Number(args["delay-ms"] ?? 600);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const API_HEADERS = {
  accept: "application/json, text/plain, */*",
  origin: "https://bwfbadminton.com",
  referer: "https://bwfbadminton.com/",
};
const bioUrl = (id) =>
  `https://extranet-lv.bwfbadminton.com/api/vue-player-bio?activeTab=1&playerId=${id}`;

// --- normalisation -----------------------------------------------------------
export function normHand(h) {
  if (h === "R" || h === "r") return "right";
  if (h === "L" || h === "l") return "left";
  return null;
}
export function normHeight(h) {
  const n = Number(h);
  return Number.isFinite(n) && n >= 100 && n <= 230 ? n : null;
}

// --- cible : joueurs à interroger --------------------------------------------
function buildTargets() {
  const players = JSON.parse(readFileSync(PLAYERS_PATH, "utf8")); // triés par matchs desc
  const birthdates = JSON.parse(readFileSync(BIRTHDATES_PATH, "utf8"));
  const known = new Set(
    Object.entries(birthdates).filter(([, v]) => v.hand).map(([id]) => id)
  );
  // Priorité 1 : main inconnue (par matchs desc). Priorité 2 : main connue
  // (Wikidata) — pour la taille + détection de contradictions, si temps restant.
  const unknown = players.filter((p) => !known.has(p.id));
  const knownList = players.filter((p) => known.has(p.id));
  return [...unknown, ...knownList];
}

// --- client Cloudflare --------------------------------------------------------
class BioClient {
  async start() {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: API_HEADERS,
    });
    this.page = await this.context.newPage();
    await this.solveChallenge();
  }
  // Navigue vers une URL de l'API : Cloudflare pose son défi une fois, le
  // cookie cf_clearance est ensuite valable pour context.request.
  async solveChallenge() {
    await this.page.goto(bioUrl(34), { waitUntil: "domcontentloaded", timeout: 60000 });
    for (let i = 0; i < 6; i++) {
      const text = await this.page.evaluate(() => document.body?.innerText ?? "");
      try {
        JSON.parse(text);
        return;
      } catch {
        await this.page.waitForTimeout(4000);
        await this.page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      }
    }
    throw new Error("Défi Cloudflare non franchi après 6 tentatives");
  }
  // fetch exécuté DANS la page (même origine extranet-lv) : le cookie
  // cf_clearance et l'empreinte TLS sont ceux du vrai navigateur.
  // NB : context.request (hors navigateur) se fait rejeter en 403.
  async fetchBio(id) {
    const doFetch = (url) =>
      this.page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { accept: "application/json, text/plain, */*" } });
        const text = await r.text();
        return { status: r.status, text };
      }, url);
    let { status, text } = await doFetch(bioUrl(id));
    if (status === 403) {
      // cf_clearance expiré : on repasse le défi puis on réessaie une fois.
      await this.solveChallenge();
      ({ status, text } = await doFetch(bioUrl(id)));
    }
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
    return JSON.parse(text);
  }
  async close() {
    await this.browser?.close();
  }
}

// --- boucle principale ---------------------------------------------------------
async function main() {
  const progress = existsSync(PROGRESS_PATH)
    ? JSON.parse(readFileSync(PROGRESS_PATH, "utf8"))
    : {};
  const save = () => writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 1));

  const onlyIds = args.ids ? String(args.ids).split(",") : null;
  const targets = (onlyIds ? onlyIds.map((id) => ({ id })) : buildTargets()).filter(
    (p) => !(p.id in progress) || (progress[p.id]?.error && args["retry-errors"])
  );
  console.log(`${targets.length} joueurs à interroger (déjà faits : ${Object.keys(progress).length})`);
  if (targets.length === 0) return;

  const client = new BioClient();
  await client.start();
  console.log("Défi Cloudflare franchi.");

  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  const deadline = Date.now() + MAX_MINUTES * 60 * 1000;
  let done = 0, ok = 0, withHand = 0, errStreak = 0;

  for (const p of targets) {
    if (stopping || Date.now() > deadline) {
      console.log(stopping ? "Arrêt demandé." : "Budget temps atteint.");
      break;
    }
    try {
      const bio = await client.fetchBio(p.id);
      const hand = normHand(bio?.hand);
      const height = normHeight(bio?.height);
      progress[p.id] = {
        hand,
        height,
        name: p.nameDisplay ?? null, // la réponse bio ne contient pas le nom
        rawHand: bio?.hand ?? null,
        rawHeight: bio?.height ?? null,
        fetchedAt: new Date().toISOString(),
      };
      ok++;
      if (hand) withHand++;
      errStreak = 0;
    } catch (e) {
      progress[p.id] = { error: String(e?.message ?? e), fetchedAt: new Date().toISOString() };
      errStreak++;
      console.log(`  ! ${p.id} : ${progress[p.id].error}`);
      if (errStreak >= 8) {
        console.log("8 erreurs d'affilée : arrêt (l'API refuse probablement).");
        break;
      }
    }
    done++;
    if (done % 50 === 0) {
      save();
      console.log(`  ${done}/${targets.length} — ok=${ok} hand=${withHand}`);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  save();
  await client.close();
  console.log(`Terminé : ${done} requêtes, ${ok} ok, ${withHand} avec main. Avancement : ${PROGRESS_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

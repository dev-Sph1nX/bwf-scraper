// tools/diag-betclic-ci.mjs
// SONDE de diagnostic du 403 Betclic sur GitHub Actions. Ne corrige rien :
// elle rapporte ce que le runner voit, pour départager les causes possibles.
//
// Betclic est servi par CloudFront (relevé local : `via: … cloudfront.net`,
// POP CDG50, `server: hidden`) et le même code réussit depuis une machine
// française mais échoue en 403 depuis le runner (19 relevés sur 19 pendant les
// Championnats du monde). Trois causes possibles, indiscernables tant qu'on ne
// lit que le statut :
//   (a) géo-blocage — opérateur sous licence ANJ, le runner sort aux US ;
//   (b) réputation d'IP / WAF sur les plages datacenter ;
//   (c) empreinte du client (en-têtes trop pauvres, ou TLS d'undici).
//
// La sonde les sépare : elle affiche l'IP de sortie et son pays, puis compare
// plusieurs jeux d'en-têtes ET deux clients différents (fetch/undici vs curl,
// qui n'ont pas la même empreinte TLS). Elle imprime le CORPS de la réponse —
// c'est lui qui nomme le bloqueur.
//
// Usage : node tools/diag-betclic-ci.mjs   (tourne aussi en local, pour comparer)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BROWSER_HEADERS } from "../lib/books.mjs";

const run = promisify(execFile);
const URL_BETCLIC = "https://www.betclic.fr/badminton-sbadminton";
const INTERESSANT = /^(server|via|x-amz-cf-id|x-amz-cf-pop|x-cache|x-datadome|cf-ray|cf-mitigated|akamai|x-akamai|retry-after|content-type|x-amzn-waf|x-amzn-errortype)/i;

/** En-têtes d'un vrai Chrome : ceux que `BROWSER_HEADERS` n'envoie pas. */
const CHROME_COMPLET = {
  ...BROWSER_HEADERS,
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Ch-Ua": '"Chromium";v="149", "Not.A/Brand";v="24", "Google Chrome";v="149"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"macOS"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://www.betclic.fr/",
};

function entete(resp) {
  const out = [];
  for (const [k, v] of resp.headers) if (INTERESSANT.test(k)) out.push(`      ${k}: ${String(v).slice(0, 100)}`);
  return out.join("\n");
}

async function essai(nom, url, headers) {
  process.stdout.write(`\n  ── ${nom}\n`);
  try {
    const resp = await fetch(url, { headers, redirect: "follow" });
    const corps = await resp.text();
    console.log(`      statut : ${resp.status} ${resp.statusText} — ${corps.length} octets`);
    console.log(entete(resp));
    if (!resp.ok) {
      // Le TEXTE visible, pas le CSS : c'est lui qui nomme le motif du refus
      // (« pays non autorisé » ≠ « accès automatisé détecté »).
      const texte = corps
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      console.log(`      texte  : ${texte.slice(0, 500)}`);
    }
    else console.log(`      ng-state présent : ${corps.includes("ng-state")}`);
  } catch (e) {
    console.log(`      ÉCHEC RÉSEAU : ${e.message}`);
  }
}

console.log("=== Sonde 403 Betclic ===");
console.log(`node ${process.version} — ${new Date().toISOString()}`);

// (a) D'où sort-on, et dans quel pays ? Discrimine le géo-blocage.
console.log("\n[1] IP de sortie et pays");
try {
  const r = await fetch("https://ipinfo.io/json", { headers: { Accept: "application/json" } });
  const j = await r.json();
  console.log(`      ip=${j.ip} pays=${j.country} région=${j.region} org=${j.org}`);
} catch (e) {
  console.log(`      indisponible : ${e.message}`);
}

// (b) Le même appel que la production, puis des variantes de plus en plus
//     proches d'un navigateur. Si SEULE la variante riche passe, la cause est
//     l'empreinte d'en-têtes ; si aucune ne passe, c'est l'IP.
console.log("\n[2] Betclic via fetch (undici), jeux d'en-têtes croissants");
await essai("en-têtes de production (BROWSER_HEADERS)", URL_BETCLIC, BROWSER_HEADERS);
await essai("Chrome complet (sec-ch-ua, sec-fetch-*, referer)", URL_BETCLIC, CHROME_COMPLET);
await essai("User-Agent nu", URL_BETCLIC, { "User-Agent": BROWSER_HEADERS["User-Agent"] });

// (c) curl : autre pile TLS, donc autre empreinte JA3/JA4. Si curl passe là où
//     undici échoue à en-têtes identiques, le blocage est au niveau TLS.
console.log("\n[3] Betclic via curl (empreinte TLS différente)");
try {
  const { stdout } = await run("curl", [
    "-sS", "-o", "/dev/null", "-D", "-", "--max-time", "25",
    "-H", `User-Agent: ${BROWSER_HEADERS["User-Agent"]}`,
    "-H", `Accept-Language: ${BROWSER_HEADERS["Accept-Language"]}`,
    URL_BETCLIC,
  ]);
  console.log(stdout.split("\n").filter((l) => /^HTTP|/.test(l) && (/^HTTP/.test(l) || INTERESSANT.test(l))).slice(0, 12).map((l) => `      ${l.trim()}`).join("\n"));
} catch (e) {
  console.log(`      curl a échoué : ${e.message}`);
}

// (d) Témoins : les deux autres opérateurs passent-ils depuis le même runner ?
//     S'ils passent, la cause est propre à Betclic (et non à l'IP en général).
console.log("\n[4] Témoins — Unibet et Winamax depuis la même IP");
await essai("winamax /sports/31", "https://www.winamax.fr/paris-sportifs/sports/31", BROWSER_HEADERS);
await essai("unibet accueil", "https://www.unibet.fr/", BROWSER_HEADERS);

console.log("\n=== fin de sonde ===");

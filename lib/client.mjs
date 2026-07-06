// lib/client.mjs
// Client HTTP qui franchit Cloudflare via un vrai navigateur Chromium.
//
// Idée clé : on ouvre le navigateur UNE fois, on passe le défi Cloudflare
// UNE fois, puis on réutilise le même contexte (donc le même cookie
// d'autorisation) pour toutes les requêtes suivantes. C'est bien plus rapide
// que de relancer un navigateur par appel.

import { chromium } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const EXTRA_HEADERS = {
  Referer: "https://bwfworldtour.bwfbadminton.com/",
  Accept: "application/json, text/plain, */*",
};

export class BwfClient {
  #browser = null;
  #context = null;
  #page = null;

  /** Lance le navigateur (headless par défaut). */
  async start({ headless = true } = {}) {
    this.#browser = await chromium.launch({ headless });
    this.#context = await this.#browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: EXTRA_HEADERS,
    });
    this.#page = await this.#context.newPage();
    return this;
  }

  /**
   * Récupère et parse le JSON d'une URL d'API.
   * Navigue vers l'URL ; si Cloudflare sert un défi, attend puis réessaie.
   * @param {string} url
   * @returns {Promise<any>}
   */
  async getJson(url) {
    if (!this.#page) throw new Error("BwfClient non démarré : appelez start() d'abord.");

    await this.#page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    for (let attempt = 0; attempt < 4; attempt++) {
      const text = await this.#page.evaluate(() => document.body?.innerText ?? "");
      try {
        return JSON.parse(text);
      } catch {
        // Probablement un défi Cloudflare : on attend puis on recharge.
        await this.#page.waitForTimeout(4000);
        await this.#page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      }
    }
    throw new Error(`Réponse non-JSON après plusieurs tentatives : ${url}`);
  }

  /** Ferme le navigateur. À appeler toujours à la fin. */
  async close() {
    if (this.#browser) await this.#browser.close();
    this.#browser = this.#context = this.#page = null;
  }
}

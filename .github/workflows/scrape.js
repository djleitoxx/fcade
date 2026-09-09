#!/usr/bin/env node
/**
 * Fightcade Scraper (para correr en GitHub Actions)
 * ---------------------------------------------------------
 * Abre un Chromium headless, visita el perfil publico del
 * usuario (asi Cloudflare lo valida como navegador real), y
 * desde esa misma pagina llama a la API de Fightcade para traer
 * perfil, replays y ranking. Guarda todo en data/<usuario>.json.
 *
 * Uso:
 *   node scrape.js usuario1,usuario2,usuario3
 *   node scrape.js usuario1
 *
 * Variable de entorno opcional:
 *   FC_USERNAMES=usuario1,usuario2   (si no se pasa argumento)
 * ---------------------------------------------------------
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const arg = process.argv[2] || process.env.FC_USERNAMES || '';
const usernames = arg.split(',').map(u => u.trim()).filter(Boolean);

if (usernames.length === 0) {
  console.error('Uso: node scrape.js usuario1,usuario2,...');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function callApi(page, payload) {
  return page.evaluate(async (payload) => {
    try {
      const res = await fetch('https://www.fightcade.com/api/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (e) {
      return { res: 'ERR', error: String(e) };
    }
  }, payload);
}

async function scrapeOne(browser, username) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);

  await page.goto(`https://www.fightcade.com/id/${encodeURIComponent(username)}`, {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  const userData = await callApi(page, { req: 'getuser', username });

  let gameid = null;
  if (userData.res === 'OK' && userData.user && userData.user.gameinfo) {
    const games = Object.entries(userData.user.gameinfo)
      .sort((a, b) => (b[1].time_played || 0) - (a[1].time_played || 0));
    if (games.length) gameid = games[0][0];
  }

  const replaysData = await callApi(page, {
    req: 'getreplays', username, offset: 0, limit: 10, best: false,
  });

  let rankingData = null;
  if (gameid) {
    rankingData = await callApi(page, {
      req: 'getrankings', gameid, byElo: true, offset: 0, limit: 15,
    });
  }

  await page.close();

  return {
    fetchedAt: new Date().toISOString(),
    username,
    user: userData,
    replays: replaysData,
    ranking: rankingData,
    rankingGame: gameid,
  };
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let exitCode = 0;
  try {
    for (const username of usernames) {
      try {
        const result = await scrapeOne(browser, username);
        const outFile = path.join(DATA_DIR, username.toLowerCase() + '.json');
        fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
        console.log('OK ->', outFile);
      } catch (err) {
        console.error('Error scrapeando', username, '-', err.message || err);
        exitCode = 1;
      }
    }
  } finally {
    await browser.close();
  }
  process.exitCode = exitCode;
})();

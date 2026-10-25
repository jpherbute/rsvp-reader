// Hors ligne et mises à jour : chaque lancement utilise une version complète, bandeau « Nouvelle version »,
// réparation automatique d'un cache incohérent. Le site est copié dans un dossier qu'on modifie pour simuler
// des déploiements, servi par un serveur propre au test.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { importBooks, until } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SITE_FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'icons'];
const THROTTLE = 10500;   // le service worker vérifie au plus une fois toutes les 10 s

test('hors ligne, nouvelle version annoncée puis chargée d’un bloc, réparation d’un cache incohérent', async ({ browser }, testInfo) => {
  test.setTimeout(150000);
  const site = testInfo.outputPath('site');
  for (const f of SITE_FILES) fs.cpSync(path.join(ROOT, f), path.join(site, f), { recursive: true });
  const port = 4300 + testInfo.workerIndex;
  const server = spawn('python3', ['-m', 'http.server', String(port), '--directory', site], { stdio: 'ignore' });
  try {
    const base = `http://localhost:${port}/`;
    for (let i = 0; i < 50 && !(await fetch(base).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const shellCaches = () => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('eclair-shell-')));
    const marker = () => page.evaluate(() => window.__deployMarker || null);
    const launch = async () => { await page.reload(); await until(page, () => window.__eclairReady === true); };

    // installation : un cache complet, l'app se lance hors ligne
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await until(page, async () => (await caches.keys()).some((k) => k.startsWith('eclair-shell-')));
    await importBooks(page, ['ncx.epub']);
    const first = await shellCaches();
    expect(first).toHaveLength(1);
    await ctx.setOffline(true);
    await launch();
    await expect(page.locator('.book')).toHaveCount(1);
    await ctx.setOffline(false);

    // lancement sans changement : même cache, pas de bandeau
    await page.waitForTimeout(THROTTLE);
    await launch();
    await page.waitForTimeout(2000);
    expect(await shellCaches()).toEqual(first);
    await expect(page.locator('#update')).toBeHidden();

    // déploiement : le lancement suivant exécute encore l'ancienne version en entier, puis le bandeau propose la nouvelle
    fs.appendFileSync(path.join(site, 'js/app.js'), "\nwindow.__deployMarker = 'v2';\n");
    fs.appendFileSync(path.join(site, 'css/app.css'), '\n/* v2 */\n');
    await page.waitForTimeout(THROTTLE);
    await launch();
    expect(await marker()).toBeNull();
    await expect(page.locator('#update')).toBeVisible({ timeout: 15000 });
    const second = await shellCaches();
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
    await Promise.all([page.waitForEvent('load'), page.click('#btnUpdate')]);
    await until(page, () => window.__eclairReady === true);
    expect(await marker()).toBe('v2');
    await expect(page.locator('#update')).toBeHidden();

    // app restée ouverte : vérification au retour, « Plus tard », nouvelle version au lancement suivant
    fs.appendFileSync(path.join(site, 'js/app.js'), "\nwindow.__deployMarker = 'v3';\n");
    await page.waitForTimeout(THROTTLE);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(page.locator('#update')).toBeVisible({ timeout: 15000 });
    await page.click('#btnUpdateLater');
    await expect(page.locator('#update')).toBeHidden();
    await launch();
    expect(await marker()).toBe('v3');

    // cache incohérent (index.html d'une version sans section Sauvegarde, app.js récent) : l'app se répare
    const oldHtml = fs.readFileSync(path.join(site, 'index.html'), 'utf8').replace(/<section class="backup"[\s\S]*?<\/section>/, '');
    await page.evaluate(async (html) => {
      const c = await caches.open((await caches.keys()).find((k) => k.startsWith('eclair-shell-')));
      for (const k of ['./', 'index.html']) await c.put(k, new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    }, oldHtml);
    await page.waitForTimeout(THROTTLE);
    await page.reload().catch(() => {});
    await until(page, () => window.__eclairReady === true);
    expect(await page.evaluate(() => [!!document.querySelector('#btnBackup'), sessionStorage.getItem('eclair.recover')])).toEqual([true, null]);
    await until(page, async () => (await caches.keys()).some((k) => k.startsWith('eclair-shell-')));
    await expect(page.locator('.book')).toHaveCount(1);
    await ctx.close();
  } finally {
    server.kill();
  }
});

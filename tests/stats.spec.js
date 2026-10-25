// Statistiques de lecture : enregistrement, série, graphique des 7 jours, sauvegarde
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { importBooks, openBook, goHome, reader } = require('./helpers');

// Écrit des statistiques pour des jours relatifs à aujourd'hui (0 = aujourd'hui, 1 = hier…), en heure locale du navigateur
const seed = (page, byDaysAgo) => page.evaluate((byDaysAgo) => {
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const st = {};
  for (const [ago, v] of Object.entries(byDaysAgo)) { const d = new Date(); d.setDate(d.getDate() - Number(ago)); st[key(d)] = v; }
  localStorage.setItem('eclair.stats', JSON.stringify(st));
}, byDaysAgo);

test('sans lecture : message d’attente', async ({ page }) => {
  await page.goto('/');
  await page.click('#btnStats');
  await expect(page.locator('#statsEmpty')).toBeVisible();
  await expect(page.locator('#statsBody')).toBeHidden();
});

test('une séance de lecture est comptée (mots, temps, série, colonne du jour)', async ({ page }) => {
  await page.goto('/');
  await importBooks(page, ['roman.epub']);
  await openBook(page, 'Roman');
  const before = (await reader(page)).idx;
  const r = await page.locator('#rail').boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down(); await page.waitForTimeout(2500); await page.mouse.up();
  const read = (await reader(page)).idx - before;
  expect(read).toBeGreaterThan(0);
  await goHome(page);
  await page.click('#btnStats');
  await expect(page.locator('#stToday')).toHaveText(String(read));
  await expect(page.locator('#stTodayTime')).toHaveText(/^mots · (< 1 min|\d+ min) de lecture$/);
  await expect(page.locator('#stStreak')).toHaveText('1 jour');
  await expect(page.locator('#stSpeed')).toHaveText(/^\d+$/);
  const today = page.locator('.col.today');
  await expect(today.locator('.v')).toHaveText(String(read));                 // valeur du jour affichée
  expect((await today.locator('i').boundingBox()).height).toBeGreaterThan(50); // seule valeur : colonne haute
});

test('série, graphique des 7 jours, info-bulle et tableau équivalent', async ({ page }) => {
  await page.goto('/');
  await seed(page, { 0: [1200, 300000], 1: [2400, 600000], 2: [600, 150000], 3: [900, 240000], 5: [3000, 700000], 9: [5000, 900000] });
  await page.reload();
  await page.click('#btnStats');
  await expect(page.locator('#stStreak')).toHaveText('4 jours');              // aujourd'hui + 3 jours ; trou il y a 4 jours
  await expect(page.locator('#stStreakSub')).toHaveText('d’affilée');
  await expect(page.locator('#stToday')).toHaveText('1 200');
  await expect(page.locator('#stTodayTime')).toHaveText('mots · 5 min de lecture');
  await expect(page.locator('#stSpeed')).toHaveText(String(Math.round(13100 / (2890000 / 60000))));
  await expect(page.locator('#stTotal')).toHaveText('Au total : 13 100 mots lus en 48 min.');
  await expect(page.locator('.col')).toHaveCount(7);
  await expect(page.locator('#weekDays span').last()).toHaveText('auj.');
  await expect(page.locator('.gl span')).toHaveText(['5 000', '2 500']);      // 3 000 au plus sur 7 jours → échelle à 5 000
  // hauteurs proportionnelles (colonnes : il y a 6 jours … aujourd'hui)
  const plotH = (await page.locator('#weekPlot').boundingBox()).height;
  const h = await page.locator('.col i').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(h.map((x) => Math.round((x / plotH) * 100))).toEqual([0, 60, 0, 18, 12, 48, 24]);
  // info-bulle au survol et au focus, tableau pour les lecteurs d'écran
  await page.locator('.col').nth(5).hover();
  await expect(page.locator('#weekTip')).toBeVisible();
  await expect(page.locator('#weekTip')).toContainText('2 400 mots');
  await page.locator('.col').nth(6).focus();
  await expect(page.locator('#weekTip')).toHaveText('Aujourd’hui · 1 200 mots · 5 min');
  await expect(page.locator('.col').nth(6)).toHaveAttribute('aria-label', /^Aujourd’hui : 1\s200 mots · 5 min$/);   // espace insécable fine (fr-FR)
  await expect(page.locator('#weekTable tr')).toHaveCount(8);
  await expect(page.locator('#weekTable tr').last()).toHaveText(/Aujourd’hui\s*1\s200\s*5 min/);
});

test('série comptée jusqu’à hier quand on n’a pas encore lu aujourd’hui', async ({ page }) => {
  await page.goto('/');
  await seed(page, { 1: [500, 60000], 2: [500, 60000], 4: [500, 60000] });
  await page.reload();
  await page.click('#btnStats');
  await expect(page.locator('#stStreak')).toHaveText('2 jours');
  await expect(page.locator('#stToday')).toHaveText('0');
  await expect(page.locator('#stTodayTime')).toHaveText('mots · pas encore lu');
  await expect(page.locator('.col.today .v')).toHaveCount(0);
});

test('la sauvegarde emporte les statistiques ; la restauration garde la valeur la plus haute de chaque jour', async ({ browser, page }, testInfo) => {
  const a = await browser.newContext({ acceptDownloads: true });
  const pa = await a.newPage();
  await pa.goto('/');
  await importBooks(pa, ['ncx.epub']);
  await seed(pa, { 1: [2000, 400000], 2: [500, 100000] });
  const [dl] = await Promise.all([pa.waitForEvent('download'), pa.click('#btnBackup')]);
  const file = testInfo.outputPath('s.zip');
  await dl.saveAs(file);
  await a.close();
  await page.goto('/');
  await seed(page, { 1: [800, 150000], 2: [900, 200000], 0: [100, 20000] });
  await page.setInputFiles('#restoreInput', { name: 's.zip', mimeType: 'application/zip', buffer: fs.readFileSync(file) });
  await expect(page.locator('.book')).toHaveCount(1);
  const st = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('eclair.stats'))).map((v) => v[0]).sort((x, y) => x - y));
  expect(st).toEqual([100, 900, 2000]);
});

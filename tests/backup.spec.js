// Sauvegarde et restauration de la bibliothèque
const { test, expect } = require('@playwright/test');
const JSZip = require('../vendor/jszip.min.js');
const fs = require('fs');
const { fixture, importBooks, openBook, goHome, dbBooks } = require('./helpers');

// Passé à la page par son contenu : Playwright ne transmet pas les chemins accentués (dossiers de test)
const zipFile = (file) => ({ name: 'eclair-sauvegarde.zip', mimeType: 'application/zip', buffer: fs.readFileSync(file) });
const summary = (books) => books.map((b) => ({ id: b.id, title: b.title, pos: b.pos, chapters: b.chapters.length, cover: !!b.cover }));

// Bibliothèque de départ : 3 livres, deux déjà avancés ; renvoie le chemin de la sauvegarde
async function makeBackup(browser, testInfo) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.locator('label[for=restoreInput]')).toBeVisible();     // bibliothèque vide : seulement « Restaurer »
  await expect(page.locator('#btnBackup')).toBeHidden();
  await importBooks(page, ['roman.epub', 'cover-byname.epub', 'chapitres.txt']);
  await expect(page.locator('#backupNote')).toContainText('Aucune sauvegarde');
  for (const [title, steps] of [['Roman', 3], ['chapitres', 2]]) {
    await openBook(page, title);
    for (let i = 0; i < steps; i++) await page.click('#btnChapFwd');
    await goHome(page);
  }
  const books = await dbBooks(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnBackup')]);
  expect(dl.suggestedFilename()).toMatch(/^eclair-sauvegarde-\d{4}-\d{2}-\d{2}\.zip$/);
  const file = testInfo.outputPath('sauvegarde.zip');
  await dl.saveAs(file);
  await expect(page.locator('#backupNote')).toContainText('Dernière sauvegarde : aujourd’hui');
  await ctx.close();
  return { file, books };
}

test('la sauvegarde contient la liste des livres, les textes et les couvertures', async ({ browser }, testInfo) => {
  const { file, books } = await makeBackup(browser, testInfo);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter((n) => !n.endsWith('/')).sort();
  expect(names.filter((n) => n.startsWith('textes/'))).toHaveLength(3);
  expect(names.filter((n) => n.startsWith('couvertures/'))).toHaveLength(2);
  const data = JSON.parse(await zip.file('eclair.json').async('string'));
  expect(data.app).toBe('eclair');
  expect(data.books.map((b) => b.id).sort()).toEqual(books.map((b) => b.id).sort());
});

test('restauration sur un appareil vide, puis une deuxième fois sans doublon', async ({ browser, page }, testInfo) => {
  const { file, books } = await makeBackup(browser, testInfo);
  await page.goto('/');
  await page.setInputFiles('#restoreInput', zipFile(file));
  await expect(page.locator('.book')).toHaveCount(3);
  await expect(page.locator('#toast')).toHaveText('Sauvegarde restaurée : 3 livres ajoutés.');
  expect(summary(await dbBooks(page))).toEqual(summary(books));
  await expect(page.locator('.book img.cover')).toHaveCount(2);
  const roman = books.find((b) => b.title.startsWith('Roman'));
  await openBook(page, 'Roman');
  expect(await page.evaluate(() => window.__eclair.S.idx)).toBe(roman.pos);
  await goHome(page);
  await page.setInputFiles('#restoreInput', zipFile(file));
  await expect(page.locator('#toast')).toHaveText('Rien de nouveau dans cette sauvegarde.');
  await expect(page.locator('.book')).toHaveCount(3);
});

test('fusion : livre importé à part reconnu, la lecture la plus récente l’emporte', async ({ browser, page }, testInfo) => {
  const { file, books } = await makeBackup(browser, testInfo);
  const roman = books.find((b) => b.title.startsWith('Roman'));
  // même EPUB importé séparément, jamais ouvert : la position de la sauvegarde s'applique, sans doublon
  await page.goto('/');
  await importBooks(page, ['roman.epub']);
  await page.setInputFiles('#fileInput', zipFile(file));                       // une sauvegarde passe aussi par « Importer »
  await expect(page.locator('.book')).toHaveCount(3);
  await expect(page.locator('#toast')).toHaveText('Sauvegarde restaurée : 2 livres ajoutés, 1 position mise à jour.');
  const mine = (await dbBooks(page)).filter((b) => b.title.startsWith('Roman'));
  expect(mine).toHaveLength(1);
  expect(mine[0].pos).toBe(roman.pos);
  // lecture plus récente sur l'appareil : elle est gardée
  await openBook(page, 'Roman');
  await page.click('#btnChapFwd');
  await goHome(page);
  const newer = (await dbBooks(page)).find((b) => b.title.startsWith('Roman')).pos;
  expect(newer).not.toBe(roman.pos);
  await page.setInputFiles('#restoreInput', zipFile(file));
  await expect(page.locator('#toast')).toHaveText('Rien de nouveau dans cette sauvegarde.');
  expect((await dbBooks(page)).find((b) => b.title.startsWith('Roman')).pos).toBe(newer);
});

test('un fichier qui n’est pas une sauvegarde est refusé', async ({ page }) => {
  await page.goto('/');
  await importBooks(page, ['ncx.epub']);
  await page.setInputFiles('#restoreInput', fixture('pas-une-sauvegarde.zip'));
  await expect(page.locator('#toast')).toHaveText('pas-une-sauvegarde.zip : ce fichier n’est pas une sauvegarde d’Éclair.');
  await expect(page.locator('.book')).toHaveCount(1);
});

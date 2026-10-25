// Import : chapitres (table des matières EPUB 3 / EPUB 2, repli sur les titres, TXT) et couvertures
const { test, expect } = require('@playwright/test');
const { importBooks, openBook, reader, wordsAt, dbBooks } = require('./helpers');

test.beforeEach(async ({ page }) => { await page.goto('/'); });

const firstWord = (title) => title.split(/\s+/)[0];

test('EPUB 3 : chapitres tirés de la table des matières, y compris au milieu des fichiers', async ({ page }) => {
  await importBooks(page, ['roman.epub']);
  await openBook(page, 'Roman');
  const { chapters } = await reader(page);
  expect(chapters.map((c) => `${c.d}:${c.title}`)).toEqual([
    '0:Livre premier — Un début',
    '1:Chapitre I — Le départ',      // numéro et unique sous-titre fusionnés
    '1:Chapitre II — La route',
    '0:Livre deuxième — La suite',
    '1:Chapitre III — La ville',
    '1:Chapitre IV — Le retour',
  ]);
  for (const c of chapters) expect(await wordsAt(page, c.w)).toBe(firstWord(c.title));
  expect(await wordsAt(page, chapters[1].w, 4)).toBe('Chapitre I Le départ');
});

test('EPUB 2 : table des matières NCX', async ({ page }) => {
  await importBooks(page, ['ncx.epub']);
  await openBook(page, 'Livre NCX');
  const { chapters } = await reader(page);
  expect(chapters.map((c) => c.title)).toEqual(['Premier chapitre', 'Deuxième chapitre', 'Troisième chapitre']);
  for (const [i, c] of chapters.entries()) expect(await wordsAt(page, c.w, 2)).toBe(`Chapitre ${i + 1}`);
});

test('sans table des matières : premier titre de chaque fichier', async ({ page }) => {
  await importBooks(page, ['notoc.epub']);
  await openBook(page, 'Sans sommaire');
  expect((await reader(page)).chapters.map((c) => c.title)).toEqual(['Partie 1', 'Partie 2', 'Partie 3']);
});

test('TXT : lignes de titre « CHAPITRE I. »', async ({ page }) => {
  await importBooks(page, ['chapitres.txt']);
  await openBook(page, 'chapitres');
  const { chapters } = await reader(page);
  expect(chapters.map((c) => c.title)).toEqual(['Préface', 'CHAPITRE I. Le commencement.', 'CHAPITRE II La fin.']);
  for (const c of chapters) expect(await wordsAt(page, c.w)).toBe(firstWord(c.title));
});

test('couvertures : vignettes JPEG pour chaque façon de les déclarer, aucune si l’image est illisible', async ({ page }) => {
  const files = ['roman.epub', 'ncx.epub', 'cover-svg.epub', 'cover-byname.epub', 'cover-href.epub', 'cover-broken.epub', 'notoc.epub', 'chapitres.txt'];
  await importBooks(page, files);
  const books = await dbBooks(page);
  const has = Object.fromEntries(books.map((b) => [b.title, !!b.cover]));
  expect(has).toEqual({
    'Roman d’essai': true, 'Livre NCX': true, 'Couverture SVG': true, 'Couverture par nom': true, 'Meta vers href': true,
    'Couverture cassée': false, 'Sans sommaire': false, chapitres: false,
  });
  const sizes = await page.evaluate(async () => {
    const r = await new Promise((res) => { const q = indexedDB.open('eclair'); q.onsuccess = () => { const g = q.result.transaction('covers').objectStore('covers').getAll(); g.onsuccess = () => res(g.result); }; });
    return Promise.all(r.map(async (c) => { const b = await createImageBitmap(c.blob); return [c.blob.type, b.width]; }));
  });
  for (const [type, w] of sizes) { expect(type).toBe('image/jpeg'); expect(w).toBeLessThanOrEqual(240); }
  // bibliothèque : vignettes affichées, initiale pour les livres sans couverture
  await expect(page.locator('.book img.cover')).toHaveCount(5);
  await expect(page.locator('.books li', { hasText: 'Sans sommaire' }).locator('.cover.ph')).toHaveText('S');
});

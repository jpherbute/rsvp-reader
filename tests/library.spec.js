// Bibliothèque : mise à niveau de la base, suppression, partage vers l'app (Android)
const { test, expect } = require('@playwright/test');
const { fixture, importBooks, dbBooks, until } = require('./helpers');

test('base de la première version (v1) mise à niveau sans perte', async ({ page }) => {
  await page.goto('/README.md');   // même origine, sans lancer l'app
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('eclair', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('books', { keyPath: 'id' }); r.result.createObjectStore('texts'); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction(['books', 'texts'], 'readwrite');
      t.objectStore('books').put({ id: 'ancien', title: 'Ancien livre', author: '', words: 3, chapters: [], pos: 1, addedAt: 1, openedAt: 0 });
      t.objectStore('texts').put('un deux trois', 'ancien');
      t.oncomplete = () => { r.result.close(); resolve(); };
    };
  }));
  await page.goto('/');
  await expect(page.locator('.book .t')).toHaveText('Ancien livre');
  await expect(page.locator('.book .cover.ph')).toHaveText('A');
  const stores = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('eclair'); r.onsuccess = () => { res([r.result.version, [...r.result.objectStoreNames]]); r.result.close(); }; }));
  expect(stores[0]).toBeGreaterThanOrEqual(2);
  expect(stores[1]).toEqual(expect.arrayContaining(['books', 'texts', 'covers']));
});

test('supprimer un livre supprime aussi sa couverture', async ({ page }) => {
  await page.goto('/');
  await importBooks(page, ['roman.epub', 'ncx.epub']);
  page.once('dialog', (d) => d.accept());
  await page.locator('.books li', { hasText: 'Roman' }).locator('.del').click();
  await expect(page.locator('.book')).toHaveCount(1);
  const covers = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('eclair'); r.onsuccess = () => { const g = r.result.transaction('covers').objectStore('covers').count(); g.onsuccess = () => res(g.result); }; }));
  expect(covers).toBe(1);
});

test('partage vers l’app : le service worker reçoit les fichiers, l’app les importe au démarrage', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await until(page, () => !!navigator.serviceWorker.controller);
  // envoi comme le fait Android : POST multipart vers share-target, en navigation
  await page.evaluate(() => {
    const f = document.createElement('form');
    f.method = 'post'; f.enctype = 'multipart/form-data'; f.action = 'share-target';
    const i = document.createElement('input'); i.type = 'file'; i.name = 'books'; i.id = 'shareInput'; i.multiple = true;
    f.append(i); document.body.append(f);
  });
  await page.setInputFiles('#shareInput', [fixture('roman.epub'), fixture('chapitres.txt')]);
  await Promise.all([page.waitForURL('**/'), page.evaluate(() => document.querySelector('#shareInput').form.submit())]);
  await expect(page.locator('.book')).toHaveCount(2, { timeout: 20000 });
  expect(page.url()).toBe(new URL('/', page.url()).href);          // adresse nettoyée (?partage retiré)
  expect(await page.evaluate(async () => (await (await caches.open('eclair-shared')).keys()).length)).toBe(0);
  await page.reload();
  await expect(page.locator('.book')).toHaveCount(2);              // pas réimporté au lancement suivant
  expect((await dbBooks(page)).map((b) => b.title)).toEqual(['chapitres', 'Roman d’essai']);
});

test('recherche (sans accents ni majuscules, plusieurs mots) et tri mémorisé', async ({ page }) => {
  await page.goto('/');
  await importBooks(page, ['roman.epub', 'ncx.epub', 'notoc.epub']);
  await expect(page.locator('#libTools')).toBeHidden();             // pas utile pour 3 livres
  await importBooks(page, ['cover-byname.epub', 'cover-broken.epub', 'chapitres.txt']);
  await expect(page.locator('#libTools')).toBeVisible();
  const visible = () => page.locator('.books li:not([hidden]) .book .t').allTextContents();

  await page.fill('#search', 'CASSEE');
  expect(await visible()).toEqual(['Couverture cassée']);
  await page.fill('#search', 'auteur ncx');                         // tous les mots, titre ou auteur
  expect(await visible()).toEqual(['Livre NCX']);
  await page.fill('#search', 'essai');
  expect(await visible()).toEqual(['Roman d’essai']);
  await page.fill('#search', 'introuvable');
  expect(await visible()).toEqual([]);
  await expect(page.locator('#noMatch')).toHaveText('Aucun livre ne correspond à « introuvable ».');
  await page.fill('#search', '');
  expect(await visible()).toHaveLength(6);
  await expect(page.locator('#noMatch')).toBeHidden();

  await page.selectOption('#sort', 'title');
  await expect(page.locator('.book .t')).toHaveText(['chapitres', 'Couverture cassée', 'Couverture par nom', 'Livre NCX', 'Roman d’essai', 'Sans sommaire']);
  await page.selectOption('#sort', 'author');                       // livres avec auteur d'abord
  await expect(page.locator('.book .t')).toHaveText(['Roman d’essai', 'Livre NCX', 'chapitres', 'Couverture cassée', 'Couverture par nom', 'Sans sommaire']);
  await page.locator('.book', { hasText: 'Sans sommaire' }).click();
  await page.click('#btnChapFwd');
  await page.click('#btnHome');
  await page.selectOption('#sort', 'progress');
  await expect(page.locator('.book .t').first()).toHaveText('Sans sommaire');
  await page.reload();
  await expect(page.locator('#sort')).toHaveValue('progress');
  await expect(page.locator('.book .t').first()).toHaveText('Sans sommaire');
});

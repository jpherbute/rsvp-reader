const path = require('path');
const { expect } = require('@playwright/test');

const fixture = (name) => path.join(__dirname, '.fixtures', name);

async function importBooks(page, names) {
  const n = await page.locator('.book').count();
  await page.setInputFiles('#fileInput', names.map(fixture));
  await expect(page.locator('.book')).toHaveCount(n + names.length, { timeout: 20000 });
}

async function openBook(page, title) {
  await page.locator('.book', { hasText: title }).first().click();
  await expect(page.locator('#reader')).toBeVisible();
}

async function goHome(page) {
  await page.click('#btnHome');
  await expect(page.locator('#library')).toBeVisible();
}

// État du lecteur (exposé par l'app dans window.__eclair)
const reader = (page) => page.evaluate(() => {
  const { S } = window.__eclair;
  return { idx: S.idx, n: S.words.length, word: S.words[S.idx], reading: document.body.classList.contains('reading'), chapters: (S.book && S.book.chapters) || [] };
});
const setIdx = (page, i) => page.evaluate((i) => { window.__eclair.S.idx = i; }, i);
const wordsAt = (page, i, n = 1) => page.evaluate(([i, n]) => window.__eclair.S.words.slice(i, i + n).join(' '), [i, n]);

// Livres enregistrés (IndexedDB), triés par titre, avec la présence d'une couverture
const dbBooks = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const r = indexedDB.open('eclair');
  r.onerror = () => reject(r.error);
  r.onsuccess = () => {
    const t = r.result.transaction(['books', 'covers']);
    const b = t.objectStore('books').getAll(), c = t.objectStore('covers').getAll();
    t.oncomplete = () => {
      r.result.close();
      resolve(b.result.map((x) => ({ ...x, cover: c.result.find((k) => k.id === x.id) || null })).sort((a, z) => a.title.localeCompare(z.title)));
    };
  };
}));

// Attente d'une condition asynchrone évaluée dans la page
async function until(page, fn, arg, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    try { if (await page.evaluate(fn, arg)) return; } catch { /* navigation en cours */ }
    if (Date.now() > end) throw new Error(`condition non atteinte : ${fn.toString().slice(0, 100)}`);
    await page.waitForTimeout(200);
  }
}

module.exports = { fixture, importBooks, openBook, goHome, reader, setIdx, wordsAt, dbBooks, until };

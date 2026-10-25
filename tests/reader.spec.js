// Lecteur : liste et navigation des chapitres, modes de lecture, reprise en arrière, contexte, réglages, mise en page
const { test, expect } = require('@playwright/test');
const { importBooks, openBook, goHome, reader, setIdx, wordsAt, dbBooks } = require('./helpers');

// Rafraîchit l'affichage en pause après un setIdx (déplacement aller-retour)
const refresh = async (page) => { await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft'); };
const railCenter = async (page) => { const r = await page.locator('#rail').boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await importBooks(page, ['roman.epub']);
  await openBook(page, 'Roman');
});

test('liste des chapitres : chapitre en cours, choix d’un chapitre, Échap', async ({ page }) => {
  const { chapters: ch } = await reader(page);
  await setIdx(page, ch[4].w + 10); await refresh(page);
  await page.click('#btnToc');
  const cur = page.locator('.toc-item.cur');
  await expect(cur).toContainText(ch[4].title);
  await expect(cur).toBeInViewport();
  await page.keyboard.press('ArrowLeft');                       // ignoré tant que la liste est ouverte
  expect((await reader(page)).idx).toBe(ch[4].w + 10);
  await page.keyboard.press('Escape');
  await expect(page.locator('#toc')).not.toBeVisible();
  await expect(page.locator('#reader')).toBeVisible();          // Échap ferme la liste, pas le lecteur
  await page.click('#btnToc');
  await page.locator('.toc-item', { hasText: ch[2].title }).click();
  await expect(page.locator('#toc')).not.toBeVisible();
  expect((await reader(page)).idx).toBe(ch[2].w);
  await expect(page.locator('#rChapter')).toHaveText(ch[2].title);
  await expect.poll(async () => (await dbBooks(page))[0].pos).toBe(ch[2].w);
});

test('navigation par chapitre : boutons, Page↑/Page↓, temps restant, bornes', async ({ page }) => {
  const { chapters: ch, n } = await reader(page);
  expect(ch[0].w).toBeGreaterThan(0);                           // page de titre avant le premier chapitre
  await setIdx(page, 1); await refresh(page);
  await expect(page.locator('#chapInfo')).toHaveText(/^Premier chapitre dans/);
  await setIdx(page, 0); await refresh(page);
  await expect(page.locator('#btnChapBack')).toBeDisabled();

  await setIdx(page, ch[1].w + 50); await refresh(page);
  await expect(page.locator('#chapInfo')).toHaveText(/^Fin du chapitre dans (≈ \d+ min|< 1 min)$/);
  await page.click('#btnChapFwd');
  expect((await reader(page)).idx).toBe(ch[2].w);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.click('#btnChapBack');
  expect((await reader(page)).idx).toBe(ch[2].w);              // d'abord le début du chapitre en cours
  await page.click('#btnChapBack');
  expect((await reader(page)).idx).toBe(ch[1].w);              // puis le chapitre précédent
  await page.keyboard.press('PageDown');
  expect((await reader(page)).idx).toBe(ch[2].w);
  await page.keyboard.press('PageUp');
  expect((await reader(page)).idx).toBe(ch[1].w);

  await setIdx(page, ch[ch.length - 1].w + 5); await refresh(page);
  await expect(page.locator('#btnChapFwd')).toBeDisabled();
  await expect(page.locator('#chapInfo')).toHaveText(/^Fin du livre dans/);
  expect(n).toBeGreaterThan(ch[ch.length - 1].w);
});

test('livre sans chapitres : ni liste ni ligne de chapitre', async ({ page }) => {
  await goHome(page);
  page.once('dialog', (d) => d.accept());
  await page.locator('.books li', { hasText: 'Roman' }).locator('.del').click();
  await page.click('#btnSample');                               // proposé quand la bibliothèque est vide
  await openBook(page, 'exemple');
  await expect(page.locator('#btnToc')).toBeHidden();
  await expect(page.locator('#chapRow')).toBeHidden();
});

test('mode Maintenir : lecture tant qu’on maintient, pause au relâchement', async ({ page }) => {
  const [x, y] = await railCenter(page);
  const start = (await reader(page)).idx;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.waitForTimeout(2000);
  expect((await reader(page)).reading).toBe(true);
  await page.mouse.up();
  const after = await reader(page);
  expect(after.reading).toBe(false);
  expect(after.idx).toBeGreaterThan(start);
});

test('reprise en arrière : au plus 4 mots, pas avant le début de la phrase, seulement après une vraie pause', async ({ page }) => {
  // début de la longue phrase « Ce soir-là, … »
  const s0 = await page.evaluate(() => window.__eclair.S.words.findIndex((w, i, a) => w === 'Ce' && a[i + 1] === 'soir-là,'));
  expect(s0).toBeGreaterThan(0);
  const [x, y] = await railCenter(page);
  await page.mouse.move(x, y);
  // se placer (déplacement volontaire), lancer puis relâcher avant le premier mot : une pause « en lisant »
  const pauseAt = async (i) => {
    await setIdx(page, i); await refresh(page);
    await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
    expect((await reader(page)).idx).toBe(i);
  };
  const resume = async () => { await page.mouse.down(); const r = await reader(page); await page.mouse.up(); return r; };

  await pauseAt(s0 + 10); await page.waitForTimeout(1700);
  const r1 = await resume();
  expect(r1.idx).toBe(s0 + 6);
  expect(await page.locator('#word').textContent()).toBe(r1.word);   // le mot repris s'affiche tout de suite

  await pauseAt(s0 + 2); await page.waitForTimeout(1700);
  expect((await resume()).idx).toBe(s0);                              // pas avant le début de la phrase

  await pauseAt(s0); await page.waitForTimeout(1700);
  expect((await resume()).idx).toBe(s0);                              // déjà en début de phrase

  await pauseAt(s0 + 10); await page.waitForTimeout(500);
  expect((await resume()).idx).toBe(s0 + 10);                         // pause trop courte

  await pauseAt(s0 + 10); await page.waitForTimeout(1700);
  await refresh(page);                                                // déplacement volontaire après la pause
  expect((await resume()).idx).toBe(s0 + 10);
});

test('réglages : mode Toucher, reprise désactivée, taille, conservés au rechargement', async ({ page }) => {
  await page.click('#btnSettings');
  await expect(page.locator('input[name=mode][value=hold]')).toBeChecked();
  await expect(page.locator('#rewind')).toBeChecked();
  const sheet = await page.locator('#settings').boundingBox(), rail = await page.locator('#rail').boundingBox();
  expect(rail.y + rail.height).toBeLessThanOrEqual(sheet.y + 1);     // le mot reste visible au-dessus du panneau
  await page.locator('#settings label', { hasText: 'Toucher' }).click();
  await page.locator('input[name=size][value="3"] + span').click();
  await page.locator('label.check').click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--scale').trim())).toBe('1.7');
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).not.toBeVisible();
  await expect(page.locator('#hint')).toHaveText(/^Touchez/);

  const [x, y] = await railCenter(page);
  await page.mouse.click(x, y); await page.waitForTimeout(1200);
  expect((await reader(page)).reading).toBe(true);                   // un toucher lance…
  await page.mouse.click(x, y);
  const paused = await reader(page);
  expect(paused.reading).toBe(false);                                // … un autre arrête
  await page.waitForTimeout(1700);
  await page.mouse.click(x, y);
  expect((await reader(page)).idx).toBe(paused.idx);                 // reprise en arrière désactivée
  await page.keyboard.press('Escape');                               // Échap met en pause sans quitter le lecteur
  expect((await reader(page)).reading).toBe(false);
  await expect(page.locator('#reader')).toBeVisible();
  await page.keyboard.press('Space'); await page.waitForTimeout(600);
  expect((await reader(page)).reading).toBe(true);
  await page.keyboard.press('Space');
  expect((await reader(page)).reading).toBe(false);

  await page.reload();
  await openBook(page, 'Roman');
  await expect(page.locator('#hint')).toHaveText(/^Touchez/);
});

test('toucher un mot du contexte y place la lecture sans la lancer', async ({ page }) => {
  await setIdx(page, 200); await refresh(page);
  const span = page.locator('#context span').nth(20);
  const target = Number(await span.getAttribute('data-i'));
  await span.click();
  const r = await reader(page);
  expect(r.idx).toBe(target);
  expect(r.reading).toBe(false);
});

test('barre du haut : chaque bouton répond sur toute sa surface, la barre de progression reste utilisable', async ({ page }) => {
  // (bug : la zone tactile de la barre de progression couvrait le haut des boutons → saut dans le livre)
  for (const id of ['btnHome', 'btnToc', 'btnTheme', 'btnSettings', 'btnChapBack', 'btnChapFwd']) {
    const b = await page.locator(`#${id}`).boundingBox();
    for (const y of [b.y + 1, b.y + b.height / 2, b.y + b.height - 1]) {
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).closest('button')?.id, [b.x + b.width / 2, y]);
      expect(hit, `${id} à y=${Math.round(y)}`).toBe(id);
    }
  }
  const theme = await page.locator('#btnTheme').boundingBox();
  const { idx } = await reader(page);
  await page.mouse.click(theme.x + theme.width / 2, theme.y + 2);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  expect((await reader(page)).idx).toBe(idx);
  const prog = await page.locator('#progress').boundingBox();
  await page.mouse.click(prog.x + prog.width / 2, prog.y + 2);           // la barre elle-même : on se déplace
  const { n, idx: mid } = await reader(page);
  expect(Math.abs(mid / (n - 1) - 0.5)).toBeLessThan(0.02);
});

test('le thème sombre est appliqué avant le script de l’app (barre d’état du téléphone)', async ({ browser, page }) => {
  await page.evaluate(() => localStorage.setItem('eclair.theme', '"dark"'));
  const state = await page.context().storageState();
  // contexte sans service worker (sinon app.js viendrait de son cache) et sans app.js : seul le <head> agit
  const ctx = await browser.newContext({ serviceWorkers: 'block', storageState: state });
  const p = await ctx.newPage();
  await p.route('**/js/app.js', (route) => route.abort());
  await p.goto('/');
  expect(await p.evaluate(() => [document.documentElement.dataset.theme, document.querySelector('meta[name=theme-color]').content, getComputedStyle(document.body).backgroundColor, !!window.__eclair]))
    .toEqual(['dark', '#12110d', 'rgb(18, 17, 13)', false]);
  await ctx.close();
});

test('mise en page : chapitres sous la barre du haut ; en paysage le mot reste dégagé ; sur petit écran le contexte reste visible', async ({ page }) => {
  const home = await page.locator('#btnHome').boundingBox(), chap = await page.locator('#chapRow').boundingBox();
  const rail = await page.locator('#rail').boundingBox();
  expect(chap.y).toBeGreaterThanOrEqual(home.y + home.height);          // sous la ligne du titre…
  expect(chap.y + chap.height).toBeLessThanOrEqual(rail.y);              // … et au-dessus du mot
  await page.setViewportSize({ width: 844, height: 390 });
  await refresh(page);
  const word = await page.locator('#word .c').boundingBox(), bar = await page.locator('.bar.bottom').boundingBox();
  const top = await page.locator('.bar.top').boundingBox();
  expect(word.y + word.height).toBeLessThanOrEqual(bar.y);
  expect(top.y + top.height).toBeLessThanOrEqual(word.y);
  await page.setViewportSize({ width: 375, height: 667 });
  await refresh(page);
  const ctx = await page.locator('#context').boundingBox(), bar2 = await page.locator('.bar.bottom').boundingBox();
  expect(ctx.y + ctx.height).toBeLessThanOrEqual(bar2.y);
});

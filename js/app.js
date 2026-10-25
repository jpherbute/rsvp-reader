'use strict';
// Si le démarrage échoue (par exemple avec des fichiers de deux versions différentes en cache),
// on vide le cache de l'app et on recharge depuis le réseau, une seule fois par session.
addEventListener('error', () => {
  try {
    if (window.__eclairReady || sessionStorage.getItem('eclair.recover')) return;
    sessionStorage.setItem('eclair.recover', '1');
  } catch { return; }
  const reload = () => location.reload();
  if (!('caches' in window)) { reload(); return; }
  caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('eclair-') && k !== 'eclair-shared').map((k) => caches.delete(k))))
    .then(reload, reload);
});

(() => {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => n.toLocaleString('fr-FR');
  const mk = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; };

  /* ------------------------------------------------------------------ *
   *  Préférences
   * ------------------------------------------------------------------ */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('eclair.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('eclair.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    back: '<path d="m14.5 6-6 6 6 6"/>',
    fwd: '<path d="m9.5 6 6 6-6 6"/>',
    dback: '<path d="m12 6-6 6 6 6"/><path d="m19 6-6 6 6 6"/>',
    dfwd: '<path d="m5 6 6 6-6 6"/><path d="m12 6 6 6-6 6"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chart: '<path d="M5 20v-8M12 20V5M19 20v-5M3.5 20h17"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
    upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 4h14"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    cback: '<path d="M6.5 6v12"/><path d="m17.5 6-7 6 7 6"/>',
    cfwd: '<path d="M17.5 6v12"/><path d="m6.5 6 7 6-7 6"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  };
  const svg = (name) =>
    `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = svg(el.dataset.icon); });

  const root = document.documentElement;
  function applyTheme(t) {
    root.dataset.theme = t;
    const meta = $('meta[name=theme-color]');
    if (meta) meta.content = t === 'dark' ? '#12110d' : '#f3efe4';
    document.querySelectorAll('#btnTheme, #libTheme').forEach((b) => { b.innerHTML = svg(t === 'dark' ? 'sun' : 'moon'); });
    LS.set('theme', t);
  }
  const toggleTheme = () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme(LS.get('theme', 'light'));
  $('#btnTheme').addEventListener('click', toggleTheme);
  $('#libTheme').addEventListener('click', toggleTheme);

  const SIZES = [0.75, 1, 1.3, 1.7];
  let sizeIdx = Math.min(SIZES.length - 1, Math.max(0, LS.get('size', 1)));
  const applySize = () => { root.style.setProperty('--scale', SIZES[sizeIdx]); LS.set('size', sizeIdx); };
  applySize();

  let toastTimer;
  function toast(msg, sticky) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  /* ------------------------------------------------------------------ *
   *  Stockage (IndexedDB) : 'books' = métadonnées, 'texts' = contenu,
   *  'covers' = vignette de couverture { id, blob } (depuis la version 2)
   * ------------------------------------------------------------------ */
  const dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open('eclair', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts');
      if (!d.objectStoreNames.contains('covers')) d.createObjectStore('covers', { keyPath: 'id' });
    };
    let blocked = false;
    r.onblocked = () => { blocked = true; toast('Fermez les autres onglets d’Éclair pour terminer la mise à jour.', true); };
    r.onsuccess = () => {
      const d = r.result;
      if (blocked) $('#toast').hidden = true;
      d.onversionchange = () => d.close();   // ne pas bloquer une future mise à jour ouverte dans un autre onglet
      resolve(d);
    };
    r.onerror = () => reject(r.error);
  });
  const getAll = (store) => dbReq(store, 'readonly', (t) => t.objectStore(store).getAll());
  async function dbReq(stores, mode, fn) {
    const db = await dbp;
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      const out = fn(t);
      t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
      t.onerror = t.onabort = () => reject(t.error);
    });
  }

  /* ------------------------------------------------------------------ *
   *  Découpage du texte en mots
   * ------------------------------------------------------------------ */
  const ONLY_PUNCT = /^[^\p{L}\p{N}]+$/u;
  function tokenize(text) {
    const words = [];
    const ends = [];
    for (const line of text.split('\n')) {
      const raw = line.replace(/­/g, '').replace(/([—–])(?=\S)/g, '$1 ').split(/\s+/).filter(Boolean);
      const out = [];
      let carry = '';
      for (const tok of raw) {
        if (ONLY_PUNCT.test(tok)) {
          // ponctuation isolée (« , — , ») : on la colle au mot voisin
          if (out.length && /^[»)\]”’"'?!:;.,…%]+$/.test(tok)) out[out.length - 1] += ' ' + tok;
          else carry += tok + ' ';
        } else { out.push(carry + tok); carry = ''; }
      }
      if (carry) { if (out.length) out[out.length - 1] += ' ' + carry.trim(); else out.push(carry.trim()); }
      for (const w of out) words.push(w);
      if (out.length) ends.push(words.length - 1);
    }
    const paraEnd = new Uint8Array(words.length);
    for (const i of ends) paraEnd[i] = 1;
    return { words, paraEnd };
  }

  /* Point de reconnaissance optimal : lettre à mettre en rouge, alignée sur l'axe */
  function splitWord(w) {
    const m = /^([^\p{L}\p{N}]*)(.*)$/su.exec(w);
    let lead = m[1].length;
    let core = m[2];
    let elision = false;
    const el = /^[\p{L}]{1,2}['’]/u.exec(core);
    if (el && core.length > el[0].length) { lead += el[0].length; core = core.slice(el[0].length); elision = true; }
    const L = core.replace(/[^\p{L}\p{N}]+$/u, '').length || 1;
    let o = L <= 1 ? 0 : L <= 5 ? 1 : L <= 9 ? 2 : L <= 13 ? 3 : 4;
    if (elision) o = Math.max(0, o - 1);
    const pos = Math.min(lead + o, w.length - 1);
    return [w.slice(0, pos), w.charAt(pos), w.slice(pos + 1)];
  }

  /* ------------------------------------------------------------------ *
   *  Import : EPUB / TXT
   * ------------------------------------------------------------------ */
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'TR', 'PRE', 'DT', 'DD', 'FIGCAPTION', 'UL', 'OL', 'TABLE', 'HR']);

  const cleanText = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

  /* anchors : identifiants visés par la table des matières → marks : nombre de mots qui les précèdent */
  function htmlToText(html, anchors) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script,style,nav,svg,img,head,[hidden]').forEach((n) => n.remove());
    d.querySelectorAll('a').forEach((a) => {
      const t = (a.getAttribute('epub:type') || a.getAttribute('role') || '');
      if (/noteref|doc-noteref/.test(t) || (a.parentElement && a.parentElement.tagName === 'SUP')) (a.parentElement.tagName === 'SUP' ? a.parentElement : a).remove();
    });
    const heading = d.querySelector('h1,h2,h3');
    let out = '';
    const at = {};
    (function walk(node) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue.replace(/\s+/g, ' ');
        else if (c.nodeType === 1) {
          if (anchors) { const id = c.id || c.getAttribute('name'); if (id && anchors.has(id) && !(id in at)) at[id] = out.length; }
          if (c.tagName === 'BR') { out += '\n'; continue; }
          const b = BLOCK.has(c.tagName);
          if (b) out += '\n';
          walk(c);
          if (b) out += '\n';
        }
      }
    })(d.body || d);
    // mots avant chaque ancre : lignes complètes déjà comptées + début de la ligne de l'ancre
    const marks = {};
    const lines = out.split('\n');
    let k = 0, start = 0, before = 0;
    for (const id of Object.keys(at).sort((a, b) => at[a] - at[b])) {
      while (start + lines[k].length < at[id]) { before += tokenize(lines[k]).words.length; start += lines[k].length + 1; k++; }
      marks[id] = before + tokenize(out.slice(start, at[id])).words.length;
    }
    return { text: cleanText(out), title: heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '', marks };
  }

  const resolvePath = (base, href) => decodeURIComponent(new URL(href.split('#')[0], 'http://x/' + base).pathname.slice(1));

  /* Table des matières de l'EPUB : nav (EPUB 3), sinon NCX (EPUB 2) → [{ title, path, frag, d }] */
  async function readToc(opf, manifest, base, read) {
    const entries = [];
    const add = (title, href, from, d) => {
      title = (title || '').replace(/\s+/g, ' ').trim();
      if (!title || !href) return;
      const frag = href.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : '';
      entries.push({ title, path: resolvePath(from, href), frag, d });
    };
    const items = Object.values(manifest);

    const navItem = items.find((it) => /\bnav\b/.test(it.getAttribute('properties') || ''));
    const navPath = navItem && resolvePath(base, navItem.getAttribute('href'));
    const navHtml = navPath && await read(navPath);
    if (navHtml) {
      const d = new DOMParser().parseFromString(navHtml, 'text/html');
      const nav = [...d.querySelectorAll('nav')].find((n) => /\btoc\b/.test(n.getAttribute('epub:type') || n.getAttribute('role') || '')) || d.querySelector('nav');
      const walk = (ol, depth) => {
        for (const li of ol.children) {
          const a = li.querySelector(':scope > a, :scope > span');
          if (a) add(a.textContent, a.getAttribute('href'), navPath, depth);
          const sub = li.querySelector(':scope > ol');
          if (sub) walk(sub, depth + 1);
        }
      };
      const ol = nav && nav.querySelector('ol');
      if (ol) walk(ol, 0);
    }
    if (entries.length) return entries;

    const spine = opf.getElementsByTagNameNS('*', 'spine')[0];
    const ncxItem = manifest[spine && spine.getAttribute('toc')] || items.find((it) => /ncx/.test(it.getAttribute('media-type') || ''));
    const ncxPath = ncxItem && resolvePath(base, ncxItem.getAttribute('href'));
    const ncx = ncxPath && await read(ncxPath);
    if (ncx) {
      const doc = new DOMParser().parseFromString(ncx, 'application/xml');
      const kids = (n, name) => [...n.children].filter((c) => c.localName === name);
      const walk = (n, depth) => {
        for (const np of kids(n, 'navPoint')) {
          const label = kids(np, 'navLabel')[0];
          const content = kids(np, 'content')[0];
          add(label && label.textContent, content && content.getAttribute('src'), ncxPath, depth);
          walk(np, depth + 1);
        }
      };
      const map = doc.getElementsByTagNameNS('*', 'navMap')[0];
      if (map) walk(map, 0);
    }
    return entries;
  }

  /* Image de couverture déclarée par l'EPUB : cover-image (EPUB 3), <meta name="cover"> (EPUB 2),
     à défaut une image dont l'identifiant ou le nom contient « cover » */
  function findCover(opf, manifest, base) {
    const items = Object.values(manifest);
    const isImg = (it) => !!it && /^image\//.test(it.getAttribute('media-type') || '');
    let it = items.find((i) => /\bcover-image\b/.test(i.getAttribute('properties') || ''));
    if (!isImg(it)) {
      const m = [...opf.getElementsByTagNameNS('*', 'meta')].find((e) => e.getAttribute('name') === 'cover');
      const ref = m && m.getAttribute('content');
      it = ref && (items.find((i) => i.getAttribute('id') === ref) || items.find((i) => i.getAttribute('href') === ref));
    }
    if (!isImg(it)) it = items.find((i) => isImg(i) && /cover/i.test(`${i.getAttribute('id')} ${i.getAttribute('href')}`));
    return isImg(it) ? { path: resolvePath(base, it.getAttribute('href')), type: it.getAttribute('media-type') } : null;
  }

  // Vignette JPEG de la couverture (240 px de large au plus) pour la bibliothèque
  async function thumbnail(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const nw = img.naturalWidth || 400, nh = img.naturalHeight || 600;
      const w = Math.min(240, nw), h = Math.round((nh * w) / nw);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);   // fond blanc pour les PNG transparents
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.85));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function parseEpub(file) {
    const zip = await JSZip.loadAsync(file);
    const read = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
    const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const container = await read('META-INF/container.xml');
    if (!container) throw new Error('EPUB invalide (container.xml introuvable).');
    const opfPath = xml(container).querySelector('rootfile').getAttribute('full-path');
    const opf = xml(await read(opfPath));
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const meta = (n) => { const e = opf.getElementsByTagNameNS('*', n)[0]; return e ? e.textContent.trim() : ''; };
    const manifest = {};
    for (const it of opf.getElementsByTagNameNS('*', 'item')) manifest[it.getAttribute('id')] = it;

    const toc = await readToc(opf, manifest, base, read);
    const anchors = {};
    for (const e of toc) if (e.frag) (anchors[e.path] ||= new Set()).add(e.frag);

    const parts = [];
    const heads = [];
    const starts = {};
    let count = 0;
    for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
      const item = manifest[ref.getAttribute('idref')];
      if (!item) continue;
      const type = item.getAttribute('media-type') || '';
      if (!/x?html/.test(type)) continue;
      if (/\bnav\b/.test(item.getAttribute('properties') || '')) continue;
      const path = resolvePath(base, item.getAttribute('href'));
      const html = await read(path);
      if (!html) continue;
      const { text, title, marks } = htmlToText(html, anchors[path]);
      starts[path] = { w: count, marks };
      const n = tokenize(text).words.length;
      if (!n) continue;
      if (title) heads.push({ title, w: count });
      parts.push(text);
      count += n;
    }
    if (!count) throw new Error('Aucun texte trouvé dans cet EPUB (DRM ?).');

    // Chapitres : table des matières du livre, à défaut le premier titre de chaque fichier
    const listed = [];
    for (const e of toc) {
      const s = starts[e.path];
      if (!s) continue;
      const w = Math.min(count - 1, s.w + ((e.frag && s.marks[e.frag]) || 0));
      const prev = listed[listed.length - 1];
      if (!prev || prev.w !== w || prev.title !== e.title) listed.push({ title: e.title, w, d: e.d });
    }
    // « Chapitre I » suivi de son unique sous-titre (« Monsieur Myriel ») : une seule entrée
    for (let i = 0; i < listed.length - 1; i++) {
      const a = listed[i], c = listed[i + 1], next = listed[i + 2];
      if (c.d === a.d + 1 && c.w - a.w <= 8 && (!next || next.d <= a.d)) { a.title += ' — ' + c.title; listed.splice(i + 1, 1); }
    }
    listed.sort((a, b) => a.w - b.w);
    const chapters = listed.length > 1 || listed.length >= heads.length ? listed : heads;

    let cover = null;
    try {
      const c = findCover(opf, manifest, base);
      const f = c && zip.file(c.path);
      if (f) cover = await thumbnail(new Blob([await f.async('arraybuffer')], { type: c.type }));
    } catch (e) { console.warn('Couverture illisible', e); }
    return {
      cover,
      title: meta('title') || file.name.replace(/\.epub$/i, ''),
      author: meta('creator'),
      text: parts.join('\n'),
      chapters,
    };
  }

  // Titres de chapitre d'un TXT : « CHAPITRE IV. », « Livre premier », « Part 2 », « Prologue », « XIV »…
  const TXT_HEAD = /^(?:(?:chapitre|chapter|partie|part|livre|book|tome)\s+(?:\d+|[ivxlcdm]+|premi[eè]re?|[a-zé-]+i[eè]me|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|one|two|three|four|five|seven|eight|nine|ten)(?![\p{L}\p{N}])|(?:prologue|[ée]pilogue|pr[ée]face|avant-propos)\.?$)/iu;
  const TXT_ROMAN = /^[IVXLC]+\.?$/;

  async function parseText(file) {
    const buf = await file.arrayBuffer();
    let s = new TextDecoder('utf-8').decode(buf);
    if (s.includes('�')) s = new TextDecoder('windows-1252').decode(buf);
    s = s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const blanks = (s.match(/\n\s*\n/g) || []).length;
    if (blanks > 3) s = s.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
    if (!s.trim()) throw new Error('Fichier vide.');
    const chapters = [];
    let w = 0;
    for (const line of s.split('\n')) {
      const l = line.trim();
      if (l.length <= 160 && (TXT_HEAD.test(l) || TXT_ROMAN.test(l))) chapters.push({ title: l.length > 120 ? l.slice(0, 119) + '…' : l, w });
      w += tokenize(line).words.length;
    }
    return { title: file.name.replace(/\.(txt|text)$/i, ''), author: '', text: s, chapters: chapters.length > 1 ? chapters : [] };
  }

  async function saveBook(b) {
    const words = tokenize(b.text).words.length;
    const meta = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      title: b.title, author: b.author, words, chapters: b.chapters, pos: 0, addedAt: Date.now(), openedAt: 0,
    };
    await dbReq(['books', 'texts', 'covers'], 'readwrite', (t) => {
      t.objectStore('books').put(meta);
      t.objectStore('texts').put(b.text, meta.id);
      if (b.cover) t.objectStore('covers').put({ id: meta.id, blob: b.cover });
    });
    return meta;
  }

  async function importFiles(files) {
    let ok = 0;
    for (const f of files) {
      try {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip') { await restoreFile(f); continue; }
        toast(`Import de « ${f.name} »…`, true);
        let b;
        if (/\.epub$/i.test(f.name) || f.type === 'application/epub+zip') b = await parseEpub(f);
        else if (/\.(txt|text)$/i.test(f.name) || f.type.startsWith('text/')) b = await parseText(f);
        else throw new Error('format non pris en charge (EPUB ou TXT).');
        await saveBook(b);
        ok++;
      } catch (e) {
        console.error(e);
        toast(`${f.name} : ${e.message || e}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    if (ok) { toast(ok > 1 ? `${ok} livres importés.` : 'Livre importé.'); try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* ignore */ } }
    await refreshLibrary();
  }

  const SAMPLE = `La lecture rapide, mot par mot
La plupart des lecteurs ne lisent pas vraiment mot après mot. Leurs yeux sautent d'un point à un autre de la page, s'arrêtent, repartent en arrière, puis recommencent. Ces petits mouvements, appelés saccades, occupent une grande partie du temps de lecture.
Avec la présentation sérielle rapide, c'est le texte qui vient à vous. Chaque mot apparaît au même endroit, et une lettre précise, le point de reconnaissance, est mise en évidence. Vos yeux restent immobiles ; votre cerveau n'a plus qu'à comprendre.
Maintenez l'écran pour lire, relâchez pour faire une pause. Réglez la vitesse en bas de la page : commencez doucement, autour de trois cents mots par minute, puis accélérez petit à petit.
Au-delà de cinq cents mots par minute, la compréhension demande davantage de concentration. N'hésitez pas à revenir en arrière, mot par mot, quand un passage vous a échappé. Bonne lecture !`;

  async function addSample() {
    await saveBook({ title: 'La lecture rapide (exemple)', author: 'Éclair', text: SAMPLE, chapters: [] });
    await refreshLibrary();
  }

  /* ------------------------------------------------------------------ *
   *  Bibliothèque
   * ------------------------------------------------------------------ */
  let coverUrls = [];
  function coverEl(b, blob) {
    if (blob) {
      const img = document.createElement('img');
      img.className = 'cover'; img.alt = ''; img.src = URL.createObjectURL(blob);
      coverUrls.push(img.src);
      return img;
    }
    const ph = mk('cover ph', ((b.title || '').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase());
    ph.style.setProperty('--h', [...(b.title || '')].reduce((h, c) => (h * 31 + c.codePointAt(0)) % 360, 40));
    return ph;
  }

  // Tri (mémorisé) et recherche dans le titre et l'auteur, sans tenir compte des accents ni des majuscules
  const norm = (s) => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const progress = (b) => (b.words > 1 ? b.pos / (b.words - 1) : 0);
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true });
  const SORTS = {
    recent: (a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt),
    title: byTitle,
    author: (a, b) => (!a.author - !b.author) || (a.author || '').localeCompare(b.author || '', 'fr', { sensitivity: 'base' }) || byTitle(a, b),
    progress: (a, b) => progress(b) - progress(a) || byTitle(a, b),
  };
  let sortBy = SORTS[LS.get('sort', 'recent')] ? LS.get('sort', 'recent') : 'recent';

  function applySearch() {
    const raw = $('#search').value.trim(), words = norm(raw).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of $('#bookList').children) {
      li.hidden = !words.every((w) => li.dataset.q.includes(w));
      if (!li.hidden) shown++;
    }
    $('#noMatch').hidden = !words.length || shown > 0;
    $('#noMatch').textContent = `Aucun livre ne correspond à « ${raw} ».`;
  }

  async function refreshLibrary() {
    const [all, covers] = await Promise.all([getAll('books'), getAll('covers')]);
    const coverOf = new Map(covers.map((c) => [c.id, c.blob]));
    all.sort(SORTS[sortBy]);
    $('#libTools').hidden = all.length < 4;           // utile seulement quand la liste s'allonge
    if ($('#libTools').hidden) $('#search').value = '';
    const list = $('#bookList');
    list.replaceChildren();
    coverUrls.forEach((u) => URL.revokeObjectURL(u));
    coverUrls = [];
    $('#empty').hidden = all.length > 0;
    renderBackupNote(all.length);
    for (const b of all) {
      const li = document.createElement('li');
      li.dataset.q = norm(`${b.title} ${b.author || ''}`);
      const btn = document.createElement('button');
      btn.className = 'book';
      const pct = b.words > 1 ? Math.round((b.pos / (b.words - 1)) * 100) : 0;
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.append(mk('t', b.title));
      if (b.author) txt.append(mk('a', b.author));
      txt.append(mk('m', `${pct} % lu · ${fmt(b.words)} mots`));
      const bar = document.createElement('i'); bar.className = 'pbar';
      const fill = document.createElement('b'); fill.style.width = pct + '%';
      bar.append(fill); txt.append(bar);
      btn.append(coverEl(b, coverOf.get(b.id)), txt);
      btn.addEventListener('click', () => openBook(b.id));
      const del = document.createElement('button');
      del.className = 'icon del'; del.innerHTML = svg('trash');
      del.setAttribute('aria-label', `Supprimer « ${b.title} »`);
      del.addEventListener('click', async () => {
        if (!confirm(`Supprimer « ${b.title} » de la bibliothèque ?`)) return;
        await dbReq(['books', 'texts', 'covers'], 'readwrite', (t) => { for (const st of ['books', 'texts', 'covers']) t.objectStore(st).delete(b.id); });
        refreshLibrary();
      });
      li.append(btn, del);
      list.append(li);
    }
    applySearch();
  }
  $('#search').addEventListener('input', applySearch);
  $('#sort').value = sortBy;
  $('#sort').addEventListener('change', (e) => { sortBy = e.target.value; LS.set('sort', sortBy); refreshLibrary(); });

  /* ------------------------------------------------------------------ *
   *  Statistiques : mots lus et temps de lecture par jour,
   *  localStorage 'stats' = { 'AAAA-MM-JJ': [mots, millisecondes] }
   * ------------------------------------------------------------------ */
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function recordReading(words, ms) {
    if (!(words > 0)) return;
    const st = LS.get('stats', {});
    const k = dayKey(), e = st[k] || [0, 0];
    st[k] = [e[0] + words, e[1] + Math.round(ms)];
    LS.set('stats', st);
  }
  // Restauration : pour chaque jour on garde la valeur la plus haute (une même lecture n'est jamais comptée deux fois)
  function mergeStats(other) {
    if (!other || typeof other !== 'object') return;
    const st = LS.get('stats', {});
    for (const [k, v] of Object.entries(other)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(v) && v[0] > ((st[k] || [0])[0])) st[k] = [+v[0] || 0, +v[1] || 0];
    }
    LS.set('stats', st);
  }

  const niceCeil = (v) => { if (v <= 0) return 0; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
  const statsDlg = $('#stats');

  async function openStats() {
    const st = LS.get('stats', {});
    const all = Object.values(st);
    const words = all.reduce((a, v) => a + v[0], 0), ms = all.reduce((a, v) => a + v[1], 0);
    $('#statsEmpty').hidden = words > 0;
    $('#statsBody').hidden = !words;
    if (words) {
      const today = st[dayKey()] || [0, 0];
      $('#stToday').textContent = fmt(today[0]);
      $('#stTodayTime').textContent = today[1] ? `mots · ${fmtTime(today[1] / 60000)} de lecture` : 'mots · pas encore lu';
      // série : jours consécutifs avec lecture, jusqu'à aujourd'hui (ou hier si on n'a pas encore lu aujourd'hui)
      const d = new Date();
      if (!today[0]) d.setDate(d.getDate() - 1);
      let streak = 0;
      while ((st[dayKey(d)] || [0])[0] > 0) { streak++; d.setDate(d.getDate() - 1); }
      $('#stStreak').textContent = `${streak} jour${streak > 1 ? 's' : ''}`;
      $('#stStreakSub').textContent = streak > 1 ? 'd’affilée' : 'de lecture';
      $('#stSpeed').textContent = ms ? fmt(Math.round(words / (ms / 60000))) : '–';
      const books = await getAll('books');
      const done = books.filter((b) => b.words > 1 && b.pos >= b.words - 1).length;
      $('#stTotal').textContent = `Au total : ${fmt(words)} mots lus en ${fmtTime(ms / 60000)}`
        + (done ? `, ${done} livre${done > 1 ? 's' : ''} terminé${done > 1 ? 's' : ''}.` : '.');
      renderWeek(st);
    }
    statsDlg.showModal();
  }

  // Colonnes des 7 derniers jours : aujourd'hui en couleur d'accent, les autres jours en gris ;
  // valeur au survol ou au focus, tableau équivalent pour les lecteurs d'écran
  function renderWeek(st) {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push({ d, v: st[dayKey(d)] || [0, 0], today: i === 0 });
    }
    const top = niceCeil(Math.max(...days.map((x) => x.v[0])));
    const plot = $('#weekPlot'), tip = $('#weekTip');
    plot.querySelectorAll('.gl, .cols').forEach((n) => n.remove());
    for (const f of [1, 0.5]) {
      const gl = document.createElement('div');
      gl.className = 'gl'; gl.style.bottom = `${f * 100}%`;
      gl.append(mk('', fmt(top * f)));
      plot.insertBefore(gl, tip);   // derrière les colonnes
    }
    const cols = document.createElement('div');
    cols.className = 'cols';
    const rows = [];
    for (const x of days) {
      const long = x.d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      const time = x.v[1] ? ` · ${fmtTime(x.v[1] / 60000)}` : '';
      const col = document.createElement('button');
      col.className = x.today ? 'col today' : 'col';
      col.setAttribute('aria-label', `${x.today ? 'Aujourd’hui' : long} : ${fmt(x.v[0])} mots${time}`);
      const h = top ? (x.v[0] / top) * 100 : 0;
      const bar = document.createElement('i');
      bar.style.height = x.v[0] ? `max(2px, ${h}%)` : '0';
      col.append(bar);
      if (x.today && x.v[0]) { const v = mk('v', fmt(x.v[0])); v.style.bottom = `calc(${h}% + 4px)`; col.append(v); }
      const show = () => {
        tip.replaceChildren(mk('', `${x.today ? 'Aujourd’hui' : long} · `), Object.assign(document.createElement('b'), { textContent: `${fmt(x.v[0])} mots` }), mk('', time));
        tip.hidden = false;
        const pw = plot.clientWidth, tw = tip.offsetWidth, cx = col.offsetLeft + col.offsetWidth / 2;
        tip.style.left = `${Math.min(pw - tw / 2, Math.max(tw / 2, cx))}px`;
        tip.style.bottom = `calc(${h}% + ${x.today && x.v[0] ? 24 : 8}px)`;
      };
      const hide = () => { tip.hidden = true; };
      col.addEventListener('pointerenter', show);
      col.addEventListener('focus', show);
      col.addEventListener('pointerleave', hide);
      col.addEventListener('blur', hide);
      cols.append(col);
      rows.push([x.today ? 'Aujourd’hui' : long, fmt(x.v[0]), x.v[1] ? fmtTime(x.v[1] / 60000) : '0']);
    }
    plot.insertBefore(cols, tip);
    $('#weekDays').replaceChildren(...days.map((x) => mk('', x.today ? 'auj.' : x.d.toLocaleDateString('fr-FR', { weekday: 'short' }))));
    const table = $('#weekTable');
    table.replaceChildren();
    const head = table.insertRow();
    for (const t of ['Jour', 'Mots lus', 'Temps de lecture']) head.append(Object.assign(document.createElement('th'), { textContent: t }));
    for (const r of rows) { const tr = table.insertRow(); for (const c of r) tr.insertCell().textContent = c; }
  }

  $('#btnStats').addEventListener('click', () => openStats().catch((e) => console.error(e)));
  $('#btnStatsClose').addEventListener('click', () => statsDlg.close());
  statsDlg.addEventListener('click', (e) => { if (e.target === statsDlg) statsDlg.close(); });

  /* ------------------------------------------------------------------ *
   *  Sauvegarde / restauration : un .zip avec eclair.json (livres, positions),
   *  textes/<id>.txt et couvertures/<id>.jpg
   * ------------------------------------------------------------------ */
  const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'aujourd’hui' : d === 1 ? 'hier' : `il y a ${d} jours`; };
  function renderBackupNote(n) {
    const last = LS.get('lastBackup', 0);
    $('#btnBackup').hidden = !n;
    $('#backupNote').textContent = !n
      ? 'Vous avez une sauvegarde d’Éclair ? Restaurez-la pour retrouver vos livres et vos positions de lecture.'
      : `Vos livres ne sont enregistrés que sur cet appareil. ${last ? `Dernière sauvegarde : ${ago(last)}.` : 'Aucune sauvegarde pour l’instant.'}`;
  }

  async function backup() {
    const books = await getAll('books');
    if (!books.length) return;
    toast('Préparation de la sauvegarde…', true);
    const [keys, texts] = await dbReq('texts', 'readonly', (t) => { const st = t.objectStore('texts'); return [st.getAllKeys(), st.getAll()]; });
    const zip = new JSZip();
    zip.file('eclair.json', JSON.stringify({ app: 'eclair', version: 1, exportedAt: Date.now(), books, stats: LS.get('stats', {}) }));
    keys.result.forEach((id, i) => zip.file(`textes/${id}.txt`, texts.result[i]));
    for (const c of await getAll('covers')) zip.file(`couvertures/${c.id}.jpg`, c.blob);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eclair-sauvegarde-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    LS.set('lastBackup', Date.now());
    renderBackupNote(books.length);
    toast(books.length > 1 ? `Sauvegarde enregistrée (${books.length} livres).` : 'Sauvegarde enregistrée (1 livre).');
  }

  // Ajoute les livres absents ; pour un livre déjà là (même identifiant, ou même titre, auteur et
  // nombre de mots s'il a été importé à part), garde la position de la lecture la plus récente.
  async function restore(file) {
    const zip = await JSZip.loadAsync(file);
    const man = zip.file('eclair.json');
    const data = man && JSON.parse(await man.async('string'));
    if (!data || data.app !== 'eclair' || !Array.isArray(data.books)) throw new Error('ce fichier n’est pas une sauvegarde d’Éclair.');
    mergeStats(data.stats);
    const existing = await getAll('books');
    let added = 0, updated = 0;
    for (const src of data.books) {
      if (!src || typeof src.id !== 'string' || typeof src.title !== 'string' || !(src.words > 0)) continue;
      const b = {
        id: src.id, title: src.title, author: typeof src.author === 'string' ? src.author : '', words: src.words,
        chapters: Array.isArray(src.chapters) ? src.chapters.filter((c) => c && typeof c.title === 'string' && Number.isInteger(c.w)) : [],
        pos: Math.min(src.words - 1, Math.max(0, src.pos | 0)), addedAt: +src.addedAt || Date.now(), openedAt: +src.openedAt || 0,
      };
      const mine = existing.find((x) => x.id === b.id) || existing.find((x) => x.title === b.title && x.author === b.author && x.words === b.words);
      if (mine) {
        if (b.openedAt > (mine.openedAt || 0)) {
          await dbReq('books', 'readwrite', (t) => t.objectStore('books').put({ ...mine, pos: b.pos, openedAt: b.openedAt }));
          updated++;
        }
        continue;
      }
      const tf = zip.file(`textes/${b.id}.txt`);
      if (!tf) continue;
      const text = await tf.async('string');
      const cf = zip.file(`couvertures/${b.id}.jpg`);
      const cover = cf && new Blob([await cf.async('arraybuffer')], { type: 'image/jpeg' });
      await dbReq(['books', 'texts', 'covers'], 'readwrite', (t) => {
        t.objectStore('books').put(b);
        t.objectStore('texts').put(text, b.id);
        if (cover) t.objectStore('covers').put({ id: b.id, blob: cover });
      });
      existing.push(b);
      added++;
    }
    return { added, updated };
  }

  async function restoreFile(f) {
    try {
      toast('Restauration de la sauvegarde…', true);
      const { added, updated } = await restore(f);
      const parts = [];
      if (added) parts.push(added > 1 ? `${added} livres ajoutés` : '1 livre ajouté');
      if (updated) parts.push(updated > 1 ? `${updated} positions mises à jour` : '1 position mise à jour');
      toast(parts.length ? `Sauvegarde restaurée : ${parts.join(', ')}.` : 'Rien de nouveau dans cette sauvegarde.');
    } catch (e) {
      console.error(e);
      toast(`${f.name} : ${e.message || 'sauvegarde illisible.'}`);
    }
    await refreshLibrary();
  }

  $('#btnBackup').addEventListener('click', () => backup().catch((e) => { console.error(e); toast('La sauvegarde a échoué.'); }));
  $('#restoreInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await restoreFile(f);
  });

  $('#fileInput').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await importFiles(files);
  });
  $('#btnSample').addEventListener('click', addSample);
  let dragDepth = 0;
  addEventListener('dragenter', (e) => { if ($('#library').hidden) return; e.preventDefault(); dragDepth++; $('#dropHint').hidden = false; });
  addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').hidden = true; });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
    if ($('#library').hidden) return;
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
    if (files.length) importFiles(files);
  });

  /* ------------------------------------------------------------------ *
   *  Lecteur
   * ------------------------------------------------------------------ */
  const S = { book: null, words: [], paraEnd: null, idx: 0 };
  let wpm = Math.min(1000, Math.max(100, LS.get('wpm', 300)));
  let reading = false;
  let raf = 0, nextAt = 0, ramp = 0, saveTimer = 0;
  const RAMP = 8;
  let tapMode = LS.get('mode', 'hold') === 'tap';   // toucher pour lancer / arrêter au lieu de maintenir
  let rhythm = LS.get('rhythm', 'regular') === 'natural' ? 'natural' : 'regular';   // durée des mots longs
  let rewindOn = LS.get('rewind', true);
  let rampOn = LS.get('ramp', true);   // démarrage progressif : premiers mots plus lents à chaque reprise
  // Reprise : on revient d'au plus REWIND mots, sans remonter avant le début de la phrase,
  // après une pause d'au moins 1,5 s survenue en lisant (pas après un déplacement volontaire)
  const REWIND = 4;
  let pausedAt = 0, canRewind = false;
  let sessionStart = 0, sessionFrom = 0;   // pour les statistiques

  const elL = $('#wl'), elC = $('#wc'), elR = $('#wr'), elWord = $('#word'), elRail = $('#rail');

  const closers = /[»"”’')\] ]+$/;
  function delayFor(i) {
    const w = S.words[i];
    const base = 60000 / wpm;
    let f = 1;
    // Rythme naturel : les mots vraiment longs (9 lettres et plus) restent un peu plus longtemps, +30 % au plus.
    // Rythme régulier : tous les mots ont la même durée, seules la ponctuation et les fins de paragraphe marquent une pause.
    if (rhythm === 'natural') {
      const core = w.replace(/[^\p{L}\p{N}]/gu, '').length;
      if (core > 8) f += Math.min(0.3, (core - 8) * 0.05);
    }
    const last = w.replace(closers, '').slice(-1);
    if (/[.!?…]/.test(last) && !/^(?:M|Mme|Mlle|Dr|Pr|St|etc|vs|p|n°)\.$/i.test(w.replace(closers, ''))) f += 1.0;
    else if (/[,;:—–]/.test(last)) f += 0.5;
    if (S.paraEnd[i]) f += 1.0;
    return base * f;
  }
  const rampFactor = (k) => (rampOn ? 1 + Math.max(0, (RAMP - k) / RAMP) * 1.2 : 1);

  // Chaque mot reste affiché un nombre entier d'images de l'écran (arrondi au plus proche) : deux mots de même
  // durée voulue durent exactement autant, au lieu d'alterner par exemple 8 et 9 images, et une image en retard
  // allonge le mot affiché sans raccourcir le suivant. La durée d'une image est mesurée pendant la lecture.
  let frameMs = 1000 / 60, lastFrame = 0;
  const nextChange = (now, ms) => now + Math.max(1, Math.round(ms / frameMs)) * frameMs - frameMs / 2;

  function renderWord() {
    if (!S.words.length) return;
    const w = S.words[S.idx];
    const [a, c, b] = splitWord(w);
    elL.textContent = a; elC.textContent = c; elR.textContent = b;
    // mots très longs : on réduit pour rester dans l'écran (l'axe reste centré)
    elWord.style.transform = '';
    if (w.length > 8) {
      const avail = elRail.clientWidth / 2 - 14;
      const need = Math.max(elL.offsetWidth, elR.offsetWidth + 0);
      if (need > avail) elWord.style.transform = `scale(${(avail / need).toFixed(3)})`;
    }
    const n = S.words.length;
    $('#progressFill').style.transform = `scaleX(${n > 1 ? S.idx / (n - 1) : 1})`;
  }

  function fmtTime(min) {
    if (min < 1) return '< 1 min';
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    return `${h} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
  }
  const approx = (min) => (min < 1 ? '< 1 min' : '≈ ' + fmtTime(min));
  function chapterIdx(i) {
    const ch = S.book && S.book.chapters;
    if (!ch || !ch.length) return -1;
    let lo = 0, hi = ch.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ch[m].w <= i) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  const chapterAt = (i) => { const k = chapterIdx(i); return k >= 0 ? S.book.chapters[k].title : ''; };
  function renderPause() {
    const n = S.words.length;
    const ctx = $('#context');
    ctx.replaceChildren();
    const from = Math.max(0, S.idx - 12), to = Math.min(n, S.idx + 18);
    for (let j = from; j < to; j++) {
      const s = document.createElement('span');
      if (j === S.idx) s.className = 'cur';
      s.dataset.i = j;
      s.textContent = S.words[j] + (j < to - 1 ? ' ' : '');
      ctx.append(s);
    }
    $('#rChapter').textContent = chapterAt(S.idx);
    $('#info').textContent = `${fmt(S.idx + 1)} / ${fmt(n)} · ${approx((n - S.idx - 1) / wpm)}`;
    const ch = (S.book && S.book.chapters) || [];
    if (ch.length) {
      const k = chapterIdx(S.idx), last = k + 1 >= ch.length;
      const left = approx(((last ? n : ch[k + 1].w) - S.idx) / wpm);
      $('#chapInfo').textContent = k < 0 ? `Premier chapitre dans ${left}` : last ? `Fin du livre dans ${left}` : `Fin du chapitre dans ${left}`;
      $('#btnChapBack').disabled = S.idx === 0;
      $('#btnChapFwd').disabled = last;
    }
    $('#hint').textContent = S.idx >= n - 1 ? 'Fin du livre'
      : tapMode ? 'Touchez l’écran ou appuyez sur Espace pour lire ou faire une pause'
        : 'Maintenez l’écran ou la barre d’espace pour lire';
    $('#speedVal').textContent = `${wpm} mots/min`;
    $('#speed').value = wpm;
  }

  function tick(now) {
    if (!reading) return;
    const dt = now - lastFrame;
    lastFrame = now;
    if (dt > 4 && dt < frameMs * 1.5) frameMs += (dt - frameMs) * 0.1;   // images manquées ignorées
    if (now >= nextAt) {
      S.idx++;
      ramp++;
      renderWord();
      if (S.idx >= S.words.length - 1) { stop(); return; }
      nextAt = nextChange(now, delayFor(S.idx) * rampFactor(ramp));
    }
    raf = requestAnimationFrame(tick);
  }

  let wake = null;
  async function lockOn() {
    try { wake = await navigator.wakeLock.request('screen'); if (!reading) lockOff(); } catch { /* indisponible */ }
  }
  function lockOff() { try { wake && wake.release(); } catch { /* ignore */ } wake = null; }

  function start() {
    if (reading || !S.words.length || S.idx >= S.words.length - 1) return;
    if (rewindOn && canRewind && performance.now() - pausedAt >= 1500) {
      for (let k = 0; k < REWIND && !isStart(S.idx); k++) S.idx--;
      renderWord();
    }
    canRewind = false;
    sessionStart = performance.now(); sessionFrom = S.idx;
    reading = true; ramp = 0;
    document.body.classList.add('reading');
    lastFrame = 0;
    nextAt = nextChange(performance.now(), delayFor(S.idx) * rampFactor(0));
    raf = requestAnimationFrame(tick);
    saveTimer = setInterval(savePos, 5000);
    lockOn();
  }
  function stop() {
    if (!reading) return;
    reading = false;
    pausedAt = performance.now(); canRewind = true;
    recordReading(S.idx - sessionFrom, pausedAt - sessionStart);
    cancelAnimationFrame(raf);
    clearInterval(saveTimer);
    document.body.classList.remove('reading');
    renderWord(); renderPause(); savePos(); lockOff();
  }

  function savePos() {
    if (!S.book) return;
    const id = S.book.id, pos = S.idx;
    dbp.then((db) => {
      const st = db.transaction('books', 'readwrite').objectStore('books');
      const g = st.get(id);
      g.onsuccess = () => { if (g.result) { g.result.pos = pos; st.put(g.result); } };
    }).catch(() => {});
  }

  function go(i) {
    if (reading) return;
    canRewind = false;
    S.idx = Math.min(S.words.length - 1, Math.max(0, i));
    renderWord(); renderPause();
  }
  const step = (d) => go(S.idx + d);

  const isEnd = (w) => /[.!?…][»"”’')\] ]*$/.test(w) && !/^(?:M|Mme|Mlle|Dr|Pr|St|etc|vs|p)\.$/i.test(w);
  const isStart = (j) => j <= 0 || isEnd(S.words[j - 1]) || S.paraEnd[j - 1] === 1;
  function sentence(dir) {
    const n = S.words.length;
    let j = S.idx + dir;
    while (j > 0 && j < n - 1 && !isStart(j)) j += dir;
    go(j);
  }

  function chapter(dir) {
    const ch = (S.book && S.book.chapters) || [];
    if (!ch.length) return;
    const k = chapterIdx(S.idx);
    if (dir > 0) { if (k + 1 < ch.length) go(ch[k + 1].w); }
    else if (k >= 0 && ch[k].w < S.idx) go(ch[k].w);   // d'abord le début du chapitre en cours
    else { let j = k - 1; while (j >= 0 && ch[j].w >= S.idx) j--; go(j >= 0 ? ch[j].w : 0); }
    savePos();
  }

  async function openBook(id) {
    const meta = await dbReq('books', 'readonly', (t) => t.objectStore('books').get(id));
    const text = await dbReq('texts', 'readonly', (t) => t.objectStore('texts').get(id));
    if (!meta || typeof text !== 'string') { toast('Livre introuvable.'); return; }
    const tk = tokenize(text);
    S.book = meta; S.words = tk.words; S.paraEnd = tk.paraEnd;
    S.idx = Math.min(meta.pos || 0, Math.max(0, S.words.length - 1));
    $('#rTitle').textContent = meta.title;
    $('#btnToc').hidden = $('#chapRow').hidden = !(meta.chapters && meta.chapters.length);
    pausedAt = 0; canRewind = true;
    $('#library').hidden = true;
    $('#reader').hidden = false;
    history.pushState({ reader: 1 }, '');
    meta.openedAt = Date.now();
    dbReq('books', 'readwrite', (t) => t.objectStore('books').put(meta)).catch(() => {});
    renderWord(); renderPause();
  }

  function showLibrary() {
    stop();
    for (const d of [tocDlg, setDlg]) if (d.open) d.close();
    if (S.book) savePos();
    S.book = null; S.words = [];
    $('#reader').hidden = true;
    $('#library').hidden = false;
    setTimeout(refreshLibrary, 80);
  }
  $('#btnHome').addEventListener('click', () => {
    if (history.state && history.state.reader) history.back(); else showLibrary();
  });
  addEventListener('popstate', () => { if (!$('#reader').hidden) showLibrary(); });

  /* --- Liste des chapitres --- */
  const tocDlg = $('#toc');
  function openToc() {
    const ch = (S.book && S.book.chapters) || [];
    if (reading || !ch.length) return;
    const n = S.words.length, cur = chapterIdx(S.idx);
    const list = $('#tocList');
    list.replaceChildren();
    let curBtn = null;
    ch.forEach((c, k) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'toc-item';
      b.style.setProperty('--depth', Math.min(c.d || 0, 3));
      b.append(mk('t', c.title), mk('p', `${n > 1 ? Math.round((c.w / (n - 1)) * 100) : 0} %`));
      if (k === cur) { b.classList.add('cur'); b.setAttribute('aria-current', 'true'); curBtn = b; }
      b.addEventListener('click', () => { tocDlg.close(); go(c.w); savePos(); });
      li.append(b);
      list.append(li);
    });
    tocDlg.showModal();
    if (curBtn) { curBtn.focus({ preventScroll: true }); curBtn.scrollIntoView({ block: 'center' }); }
  }
  $('#btnToc').addEventListener('click', openToc);
  $('#btnTocClose').addEventListener('click', () => tocDlg.close());
  tocDlg.addEventListener('click', (e) => { if (e.target === tocDlg) tocDlg.close(); });

  /* --- Réglages --- */
  const setDlg = $('#settings');
  function syncSettings() {
    setDlg.querySelector(`input[name=mode][value=${tapMode ? 'tap' : 'hold'}]`).checked = true;
    setDlg.querySelector(`input[name=size][value="${sizeIdx}"]`).checked = true;
    $('#rewind').checked = rewindOn;
    $('#ramp').checked = rampOn;
    setDlg.querySelector(`input[name=rhythm][value=${rhythm}]`).checked = true;
    $('#rhythmNote').textContent = rhythm === 'natural' ? 'Mots longs un peu plus longtemps.' : 'Même durée pour chaque mot.';
    $('#modeNote').textContent = tapMode ? 'Un toucher lance, un autre arrête.' : 'Défile tant que l’écran est maintenu.';
  }
  $('#btnSettings').addEventListener('click', () => { if (reading) return; syncSettings(); setDlg.showModal(); });
  $('#btnSetClose').addEventListener('click', () => setDlg.close());
  setDlg.addEventListener('click', (e) => { if (e.target === setDlg) setDlg.close(); });
  setDlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'mode') { tapMode = t.value === 'tap'; LS.set('mode', t.value); }
    else if (t.name === 'size') { sizeIdx = +t.value; applySize(); renderWord(); }
    else if (t.id === 'rewind') { rewindOn = t.checked; LS.set('rewind', rewindOn); }
    else if (t.id === 'ramp') { rampOn = t.checked; LS.set('ramp', rampOn); }
    else if (t.name === 'rhythm') { rhythm = t.value; LS.set('rhythm', rhythm); }
    syncSettings();
    if (S.words.length) renderPause();
  });

  /* --- Lecture : appui maintenu (relâcher = pause), ou toucher pour lancer / arrêter --- */
  const stage = $('#stage');
  let activePointer = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    e.preventDefault();
    if (tapMode) { if (e.isPrimary) { if (reading) stop(); else start(); } return; }
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    start();
  });
  const release = (e) => { if (e.pointerId === activePointer) { activePointer = null; stop(); } };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('lostpointercapture', release);
  $('#reader').addEventListener('contextmenu', (e) => e.preventDefault());

  // En pause, toucher un mot du contexte y place la lecture (sans lancer la lecture)
  const ctxEl = $('#context');
  ctxEl.addEventListener('pointerdown', (e) => { if (!reading && e.target.dataset.i) e.stopPropagation(); });
  ctxEl.addEventListener('click', (e) => { const i = e.target.dataset.i; if (!reading && i) { go(+i); savePos(); } });

  /* --- Clavier --- */
  let spaceDown = false;
  addEventListener('keydown', (e) => {
    if ($('#reader').hidden || tocDlg.open || setDlg.open) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (e.repeat) break;
        if (tapMode) { if (reading) stop(); else start(); } else if (!spaceDown) { spaceDown = true; start(); }
        break;
      case 'ArrowLeft': e.preventDefault(); step(e.shiftKey ? -10 : -1); break;
      case 'ArrowRight': e.preventDefault(); step(e.shiftKey ? 10 : 1); break;
      case 'ArrowUp': e.preventDefault(); setWpm(wpm + 25); break;
      case 'ArrowDown': e.preventDefault(); setWpm(wpm - 25); break;
      case 'PageUp': e.preventDefault(); chapter(-1); break;
      case 'PageDown': e.preventDefault(); chapter(1); break;
      case 'Escape': if (reading) stop(); else $('#btnHome').click(); break;
      default:
    }
  });
  addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceDown) { spaceDown = false; stop(); } });
  addEventListener('blur', () => { spaceDown = false; stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); savePos(); } });
  addEventListener('pagehide', savePos);

  /* --- Vitesse --- */
  function setWpm(v) {
    wpm = Math.min(1000, Math.max(100, Math.round(v / 25) * 25));
    LS.set('wpm', wpm);
    $('#speed').value = wpm;
    $('#speedVal').textContent = `${wpm} mots/min`;
    if (!reading && S.words.length) renderPause();
  }
  $('#speed').addEventListener('input', (e) => setWpm(+e.target.value));
  $('#speed').value = wpm;
  $('#speedVal').textContent = `${wpm} mots/min`;

  /* --- Boutons pas à pas (appui long = répétition accélérée) --- */
  function holdRepeat(btn, fn) {
    let t = 0, d = 0;
    const stopRep = () => { clearTimeout(t); t = 0; };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      fn(); d = 140;
      const loop = () => { fn(); d = Math.max(30, d * 0.9); t = setTimeout(loop, d); };
      t = setTimeout(loop, 380);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => btn.addEventListener(ev, () => { if (t) { stopRep(); savePos(); } }));
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
  }
  holdRepeat($('#btnBack'), () => step(-1));
  holdRepeat($('#btnFwd'), () => step(1));
  $('#btnSentBack').addEventListener('click', () => { sentence(-1); savePos(); });
  $('#btnSentFwd').addEventListener('click', () => { sentence(1); savePos(); });
  $('#btnChapBack').addEventListener('click', () => chapter(-1));
  $('#btnChapFwd').addEventListener('click', () => chapter(1));

  /* --- Barre de progression (déplaçable en pause) --- */
  const prog = $('#progress');
  let seeking = false;
  const seek = (e) => {
    const r = prog.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    go(Math.round(f * (S.words.length - 1)));
  };
  prog.addEventListener('pointerdown', (e) => { if (reading) return; seeking = true; try { prog.setPointerCapture(e.pointerId); } catch { /* ignore */ } seek(e); });
  prog.addEventListener('pointermove', (e) => { if (seeking) seek(e); });
  const endSeek = () => { if (seeking) { seeking = false; savePos(); } };
  prog.addEventListener('pointerup', endSeek);
  prog.addEventListener('pointercancel', endSeek);

  /* ------------------------------------------------------------------ *
   *  Démarrage
   * ------------------------------------------------------------------ */
  // Livres partagés vers l'app (Android) : le service worker les dépose dans ce cache, on les importe ici
  async function importShared() {
    if (location.search.includes('partage')) history.replaceState(null, '', location.pathname);
    if (!('caches' in window) || !(await caches.has('eclair-shared'))) return;
    const cache = await caches.open('eclair-shared');
    const keys = await cache.keys();
    const files = [];
    for (const k of keys) {
      const r = await cache.match(k);
      if (r) files.push(new File([await r.blob()], decodeURIComponent(r.headers.get('X-Name') || 'livre'), { type: r.headers.get('Content-Type') || '' }));
    }
    if (files.length) await importFiles(files);
    await Promise.all(keys.map((k) => cache.delete(k)));
  }

  refreshLibrary().catch((e) => { console.error(e); toast('Stockage local indisponible.'); });
  importShared().catch((e) => { console.error(e); toast('Impossible d’importer le livre partagé.'); });
  // Mises à jour : le service worker télécharge la nouvelle version en entier puis prévient la page
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'update-ready') $('#update').hidden = false; });
    // au retour sur l'app laissée ouverte, on lui demande de vérifier s'il y a du nouveau
    document.addEventListener('visibilitychange', () => {
      const sw = navigator.serviceWorker.controller;
      if (!document.hidden && sw) sw.postMessage({ type: 'check' });
    });
  }
  $('#btnUpdate').addEventListener('click', () => location.reload());
  $('#btnUpdateLater').addEventListener('click', () => { $('#update').hidden = true; });

  // exposé pour les tests
  window.__eclair = { tokenize, splitWord, S, delayFor };
  window.__eclairReady = true;
  try { sessionStorage.removeItem('eclair.recover'); } catch { /* ignore */ }
})();

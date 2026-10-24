'use strict';
(() => {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => n.toLocaleString('fr-FR');

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
  $('#btnSize').addEventListener('click', () => { sizeIdx = (sizeIdx + 1) % SIZES.length; applySize(); renderWord(); });

  let toastTimer;
  function toast(msg, sticky) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
  }

  /* ------------------------------------------------------------------ *
   *  Stockage (IndexedDB) : 'books' = métadonnées, 'texts' = contenu
   * ------------------------------------------------------------------ */
  const dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open('eclair', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('books', { keyPath: 'id' });
      d.createObjectStore('texts');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
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

  function htmlToText(html) {
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script,style,nav,svg,img,head,[hidden]').forEach((n) => n.remove());
    d.querySelectorAll('a').forEach((a) => {
      const t = (a.getAttribute('epub:type') || a.getAttribute('role') || '');
      if (/noteref|doc-noteref/.test(t) || (a.parentElement && a.parentElement.tagName === 'SUP')) (a.parentElement.tagName === 'SUP' ? a.parentElement : a).remove();
    });
    const heading = d.querySelector('h1,h2,h3');
    let out = '';
    (function walk(node) {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue.replace(/\s+/g, ' ');
        else if (c.nodeType === 1) {
          if (c.tagName === 'BR') { out += '\n'; continue; }
          const b = BLOCK.has(c.tagName);
          if (b) out += '\n';
          walk(c);
          if (b) out += '\n';
        }
      }
    })(d.body || d);
    const text = out.split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
    return { text, title: heading ? heading.textContent.replace(/\s+/g, ' ').trim() : '' };
  }

  const resolvePath = (base, href) => decodeURIComponent(new URL(href.split('#')[0], 'http://x/' + base).pathname.slice(1));

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

    const parts = [];
    const chapters = [];
    let count = 0;
    for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
      const item = manifest[ref.getAttribute('idref')];
      if (!item) continue;
      const type = item.getAttribute('media-type') || '';
      if (!/x?html/.test(type)) continue;
      if (/\bnav\b/.test(item.getAttribute('properties') || '')) continue;
      const html = await read(resolvePath(base, item.getAttribute('href')));
      if (!html) continue;
      const { text, title } = htmlToText(html);
      const n = tokenize(text).words.length;
      if (!n) continue;
      if (title) chapters.push({ title, w: count });
      parts.push(text);
      count += n;
    }
    if (!count) throw new Error('Aucun texte trouvé dans cet EPUB (DRM ?).');
    return {
      title: meta('title') || file.name.replace(/\.epub$/i, ''),
      author: meta('creator'),
      text: parts.join('\n'),
      chapters,
    };
  }

  async function parseText(file) {
    const buf = await file.arrayBuffer();
    let s = new TextDecoder('utf-8').decode(buf);
    if (s.includes('�')) s = new TextDecoder('windows-1252').decode(buf);
    s = s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const blanks = (s.match(/\n\s*\n/g) || []).length;
    if (blanks > 3) s = s.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n');
    if (!s.trim()) throw new Error('Fichier vide.');
    return { title: file.name.replace(/\.(txt|text)$/i, ''), author: '', text: s, chapters: [] };
  }

  async function saveBook(b) {
    const words = tokenize(b.text).words.length;
    const meta = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      title: b.title, author: b.author, words, chapters: b.chapters, pos: 0, addedAt: Date.now(), openedAt: 0,
    };
    await dbReq(['books', 'texts'], 'readwrite', (t) => {
      t.objectStore('books').put(meta);
      t.objectStore('texts').put(b.text, meta.id);
    });
    return meta;
  }

  async function importFiles(files) {
    let ok = 0;
    for (const f of files) {
      try {
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
  async function refreshLibrary() {
    const all = await dbReq('books', 'readonly', (t) => t.objectStore('books').getAll());
    all.sort((a, b) => (b.openedAt || b.addedAt) - (a.openedAt || a.addedAt));
    const list = $('#bookList');
    list.replaceChildren();
    $('#empty').hidden = all.length > 0;
    for (const b of all) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'book';
      const mk = (cls, txt) => { const s = document.createElement('span'); s.className = cls; s.textContent = txt; return s; };
      const pct = b.words > 1 ? Math.round((b.pos / (b.words - 1)) * 100) : 0;
      btn.append(mk('t', b.title));
      if (b.author) btn.append(mk('a', b.author));
      btn.append(mk('m', `${pct} % lu · ${fmt(b.words)} mots`));
      const bar = document.createElement('i'); bar.className = 'pbar';
      const fill = document.createElement('b'); fill.style.width = pct + '%';
      bar.append(fill); btn.append(bar);
      btn.addEventListener('click', () => openBook(b.id));
      const del = document.createElement('button');
      del.className = 'icon del'; del.innerHTML = svg('trash');
      del.setAttribute('aria-label', `Supprimer « ${b.title} »`);
      del.addEventListener('click', async () => {
        if (!confirm(`Supprimer « ${b.title} » de la bibliothèque ?`)) return;
        await dbReq(['books', 'texts'], 'readwrite', (t) => { t.objectStore('books').delete(b.id); t.objectStore('texts').delete(b.id); });
        refreshLibrary();
      });
      li.append(btn, del);
      list.append(li);
    }
  }

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

  const elL = $('#wl'), elC = $('#wc'), elR = $('#wr'), elWord = $('#word'), elRail = $('#rail');

  const closers = /[»"”’')\] ]+$/;
  function delayFor(i) {
    const w = S.words[i];
    const base = 60000 / wpm;
    const core = w.replace(/[^\p{L}\p{N}]/gu, '').length;
    let f = 1;
    if (core > 6) f += Math.min(0.6, (core - 6) * 0.06);
    const last = w.replace(closers, '').slice(-1);
    if (/[.!?…]/.test(last) && !/^(?:M|Mme|Mlle|Dr|Pr|St|etc|vs|p|n°)\.$/i.test(w.replace(closers, ''))) f += 1.0;
    else if (/[,;:—–]/.test(last)) f += 0.5;
    if (S.paraEnd[i]) f += 1.0;
    return base * f;
  }
  const rampFactor = (k) => 1 + Math.max(0, (RAMP - k) / RAMP) * 1.2;

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
  function chapterAt(i) {
    const ch = S.book && S.book.chapters;
    if (!ch || !ch.length) return '';
    let lo = 0, hi = ch.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ch[m].w <= i) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans >= 0 ? ch[ans].title : '';
  }
  function renderPause() {
    const n = S.words.length;
    const ctx = $('#context');
    ctx.replaceChildren();
    const from = Math.max(0, S.idx - 12), to = Math.min(n, S.idx + 18);
    for (let j = from; j < to; j++) {
      const s = document.createElement('span');
      if (j === S.idx) s.className = 'cur';
      s.textContent = S.words[j] + (j < to - 1 ? ' ' : '');
      ctx.append(s);
    }
    $('#rChapter').textContent = chapterAt(S.idx);
    $('#info').textContent = `${fmt(S.idx + 1)} / ${fmt(n)} · ≈ ${fmtTime((n - S.idx - 1) / wpm)}`;
    $('#hint').textContent = S.idx >= n - 1 ? 'Fin du livre' : 'Maintenez l’écran ou la barre d’espace pour lire';
    $('#speedVal').textContent = `${wpm} mots/min`;
    $('#speed').value = wpm;
  }

  function tick(now) {
    if (!reading) return;
    if (now >= nextAt) {
      S.idx++;
      ramp++;
      renderWord();
      if (S.idx >= S.words.length - 1) { stop(); return; }
      nextAt += delayFor(S.idx) * rampFactor(ramp);
      if (nextAt < now - 40) nextAt = now;
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
    reading = true; ramp = 0;
    document.body.classList.add('reading');
    nextAt = performance.now() + delayFor(S.idx) * rampFactor(0);
    raf = requestAnimationFrame(tick);
    saveTimer = setInterval(savePos, 5000);
    lockOn();
  }
  function stop() {
    if (!reading) return;
    reading = false;
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

  async function openBook(id) {
    const meta = await dbReq('books', 'readonly', (t) => t.objectStore('books').get(id));
    const text = await dbReq('texts', 'readonly', (t) => t.objectStore('texts').get(id));
    if (!meta || typeof text !== 'string') { toast('Livre introuvable.'); return; }
    const tk = tokenize(text);
    S.book = meta; S.words = tk.words; S.paraEnd = tk.paraEnd;
    S.idx = Math.min(meta.pos || 0, Math.max(0, S.words.length - 1));
    $('#rTitle').textContent = meta.title;
    $('#library').hidden = true;
    $('#reader').hidden = false;
    history.pushState({ reader: 1 }, '');
    meta.openedAt = Date.now();
    dbReq('books', 'readwrite', (t) => t.objectStore('books').put(meta)).catch(() => {});
    renderWord(); renderPause();
  }

  function showLibrary() {
    stop();
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

  /* --- Appui maintenu = lecture ; relâchement = pause --- */
  const stage = $('#stage');
  let activePointer = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId;
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    start();
  });
  const release = (e) => { if (e.pointerId === activePointer) { activePointer = null; stop(); } };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('lostpointercapture', release);
  $('#reader').addEventListener('contextmenu', (e) => e.preventDefault());

  /* --- Clavier --- */
  let spaceDown = false;
  addEventListener('keydown', (e) => {
    if ($('#reader').hidden) return;
    switch (e.code) {
      case 'Space': e.preventDefault(); if (!e.repeat && !spaceDown) { spaceDown = true; start(); } break;
      case 'ArrowLeft': e.preventDefault(); step(e.shiftKey ? -10 : -1); break;
      case 'ArrowRight': e.preventDefault(); step(e.shiftKey ? 10 : 1); break;
      case 'ArrowUp': e.preventDefault(); setWpm(wpm + 25); break;
      case 'ArrowDown': e.preventDefault(); setWpm(wpm - 25); break;
      case 'Escape': if (!reading) $('#btnHome').click(); break;
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
  refreshLibrary().catch((e) => { console.error(e); toast('Stockage local indisponible.'); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // exposé pour les tests
  window.__eclair = { tokenize, splitWord, S };
})();

// Livres d'essai générés avant les tests (Playwright globalSetup), dans tests/.fixtures/.
// Ils reproduisent les cas rencontrés avec de vrais livres (Project Gutenberg notamment)
// sans dépendre du réseau.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('../vendor/jszip.min.js');

const DIR = path.join(__dirname, '.fixtures');

const SENTENCES = [
  'Le voyageur marchait lentement sur la route poussiéreuse du soir.',
  'Il pensait à la ville qu’il avait quittée, à ses rues étroites et à ses places désertes.',
  'Le vent se leva, et les arbres se mirent à chanter doucement.',
  'Personne ne savait où il allait ; lui-même l’ignorait peut-être.',
  'Une lumière brillait au loin, derrière la colline.',
  'Il pressa le pas, car la nuit tombait vite en cette saison.',
];
// Phrase de plus de trente mots, pour les essais de reprise en arrière
const LONG = 'Ce soir-là, tandis que la lumière baissait sur les collines et que les cloches du village voisin sonnaient '
  + 'pour la dernière fois de la journée, le voyageur s’arrêta au bord du chemin, posa son sac sur une pierre tiède '
  + 'et regarda longuement la vallée qui s’étendait devant lui jusqu’à l’horizon.';
const para = (n, from = 0) => Array.from({ length: n }, (_, i) => SENTENCES[(from + i) % SENTENCES.length]).join(' ');

function png(w, h, [r, g, b]) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => [r, g, b][i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const xhtml = (body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title></head><body>${body}</body></html>`;

async function epub(name, { title, author = '', version = '3.0', items, spine, files, meta = '', spineAttrs = '' }) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
    + '<rootfiles><rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OPS/content.opf', `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="${version}">`
    + `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title>${author ? `<dc:creator>${author}</dc:creator>` : ''}${meta}</metadata>`
    + `<manifest>${items}</manifest><spine${spineAttrs}>${spine.map((id) => `<itemref idref="${id}"/>`).join('')}</spine></package>`);
  for (const [p, data] of Object.entries(files)) zip.file(`OPS/${p}`, data);
  fs.writeFileSync(path.join(DIR, name), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

// (noms de fichiers sans accents : Playwright ne transmet pas les chemins accentués à la page)
const simple = (file, title, coverItem, coverMeta, coverFiles) => epub(file, {
  title,
  items: `<item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>${coverItem}`,
  meta: coverMeta,
  spine: ['c1'],
  files: { 'text/c1.xhtml': xhtml(`<h1>Un</h1><p>${para(6)}</p>`), ...coverFiles },
});

module.exports = async function buildFixtures() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });

  // Comme les EPUB de Project Gutenberg : peu de fichiers, chapitres repérés par des ancres,
  // table des matières imbriquée où « Chapitre I » est suivi de son unique sous-titre
  const nav = (parts) => `<nav epub:type="toc"><ol>${parts.map((pt) => `<li><a href="text/${pt.file}#${pt.id}">${pt.title}</a><ol>${
    pt.chapters.map((c) => `<li><a href="text/${pt.file}#${c.id}">${c.num}</a><ol><li><a href="text/${pt.file}#${c.id}t">${c.sub}</a></li></ol></li>`).join('')
  }</ol></li>`).join('')}</ol></nav>`;
  const parts = [
    { file: 'part1.xhtml', id: 'l1', title: 'Livre premier — Un début', chapters: [{ id: 'c1', num: 'Chapitre I', sub: 'Le départ' }, { id: 'c2', num: 'Chapitre II', sub: 'La route' }] },
    { file: 'part2.xhtml', id: 'l2', title: 'Livre deuxième — La suite', chapters: [{ id: 'c3', num: 'Chapitre III', sub: 'La ville' }, { id: 'c4', num: 'Chapitre IV', sub: 'Le retour' }] },
  ];
  const partBody = (pt, k) => `<h1 id="${pt.id}">${pt.title}</h1>${pt.chapters.map((c, i) => `<h2 id="${c.id}">${c.num}</h2><h3 id="${c.id}t">${c.sub}</h3>`
    + `<p>${para(40, k + i)}</p>${k === 0 && i === 0 ? `<p>${LONG}</p>` : ''}<p>${para(40, k + i + 2)}</p>`).join('')}`;
  await epub('roman.epub', {
    title: 'Roman d’essai', author: 'Auteur Essai',
    items: '<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="title" href="text/title.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="p1" href="text/part1.xhtml" media-type="application/xhtml+xml"/><item id="p2" href="text/part2.xhtml" media-type="application/xhtml+xml"/>'
      + '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      + '<item id="img" href="img/cover.png" media-type="image/png" properties="cover-image"/>',
    spine: ['cover', 'title', 'p1', 'p2'],
    files: {
      'text/cover.xhtml': xhtml('<div><img src="../img/cover.png" alt="Couverture"/></div>'),
      'text/title.xhtml': xhtml('<p>Roman d’essai</p><p>par Auteur Essai</p>'),   // page de titre, hors table des matières
      'text/part1.xhtml': xhtml(partBody(parts[0], 0)),
      'text/part2.xhtml': xhtml(partBody(parts[1], 2)),
      'nav.xhtml': xhtml(nav(parts)),
      'img/cover.png': png(600, 900, [40, 90, 160]),
    },
  });

  // EPUB 2 : table des matières NCX (titres différents des <h1> pour prouver qu'elle est lue), couverture par <meta>
  const labels = ['Premier chapitre', 'Deuxième chapitre', 'Troisième chapitre'];
  await epub('ncx.epub', {
    title: 'Livre NCX', author: 'Auteur NCX', version: '2.0',
    meta: '<meta name="cover" content="cv"/>', spineAttrs: ' toc="ncx"',
    items: labels.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')
      + '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="cv" href="cv.png" media-type="image/png"/>',
    spine: labels.map((_, i) => `ch${i + 1}`),
    files: {
      ...Object.fromEntries(labels.map((_, i) => [`ch${i + 1}.xhtml`, xhtml(`<h1>Chapitre ${i + 1}</h1><p>${para(20, i)}</p>`)])),
      'toc.ncx': `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${
        labels.map((l, i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${l}</text></navLabel><content src="ch${i + 1}.xhtml"/></navPoint>`).join('')
      }</navMap></ncx>`,
      'cv.png': png(300, 450, [160, 40, 40]),
    },
  });

  // Sans table des matières : on se rabat sur le premier titre de chaque fichier
  await epub('notoc.epub', {
    title: 'Sans sommaire',
    items: [1, 2, 3].map((i) => `<item id="c${i}" href="text/c${i}.xhtml" media-type="application/xhtml+xml"/>`).join(''),
    spine: ['c1', 'c2', 'c3'],
    files: Object.fromEntries([1, 2, 3].map((i) => [`text/c${i}.xhtml`, xhtml(`<h1>Partie ${i}</h1><p>${para(10, i)}</p>`)])),
  });

  // Variantes de couverture
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#2a5d8f"/></svg>';
  await simple('cover-svg.epub', 'Couverture SVG', '<item id="cv" href="img/cover.svg" media-type="image/svg+xml" properties="cover-image"/>', '', { 'img/cover.svg': svg });
  await simple('cover-byname.epub', 'Couverture par nom', '<item id="img1" href="images/cover.png" media-type="image/png"/>', '', { 'images/cover.png': png(400, 600, [200, 60, 40]) });
  await simple('cover-href.epub', 'Meta vers href', '<item id="x" href="pic.png" media-type="image/png"/>', '<meta name="cover" content="pic.png"/>', { 'pic.png': png(300, 450, [40, 140, 60]) });
  await simple('cover-broken.epub', 'Couverture cassée', '<item id="cv" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>', '', { 'cover.jpg': 'pas une image' });

  // TXT : paragraphes séparés par des lignes vides, titres « CHAPITRE I. » suivis d'un sous-titre
  fs.writeFileSync(path.join(DIR, 'chapitres.txt'), [
    'Préface', '', para(3), '', '',
    'CHAPITRE I.', 'Le commencement.', '', para(30), '', para(30, 1), '', '',
    'CHAPITRE II', 'La fin.', '', para(30, 2), '', LONG, '',
  ].join('\n'));

  // Un fichier qui n'est pas une sauvegarde d'Éclair (un EPUB renommé)
  fs.copyFileSync(path.join(DIR, 'ncx.epub'), path.join(DIR, 'pas-une-sauvegarde.zip'));
};

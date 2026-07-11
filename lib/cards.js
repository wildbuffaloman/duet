'use strict';

// Card building — the canvas-directory protocol's read side.
// Extracted from server.js so it can be tested without standing up the server.
//
// Two kinds of card file live directly inside a session's canvas dir:
//   *.html   — rendered verbatim (the file IS the card)
//   images   — wrapped server-side in a minimal self-contained <img> document
//
// Images become data-URIs rather than URLs on purpose: cards render in
// `sandbox="allow-scripts"` iframes with no same-origin, and the protocol
// promises self-contained documents (no external resources are honored).
// A data-URI needs no new HTTP route, no sandbox relaxation, and no client change.

const fs = require('fs');
const path = require('path');

const CARD_FILE_RE = /^[A-Za-z0-9._-]+\.html$/;
const IMAGE_FILE_RE = /^[A-Za-z0-9._-]+\.(png|jpe?g|gif|webp|svg)$/i;

const MAX_CARD_BYTES = 2 * 1024 * 1024; // cards above this are skipped, not truncated
// Base64 inflates ~33%, and "latency budget is law" — this bounds the WS frame
// while still covering Retina screenshots (typically 1-5 MB).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function isHtmlFile(name) {
  return CARD_FILE_RE.test(name);
}

function isImageFile(name) {
  return IMAGE_FILE_RE.test(name);
}

function isCardFile(name) {
  return isHtmlFile(name) || isImageFile(name);
}

// An .html card's id is its basename — PROTOCOL §5.1 card->card links address
// cards by id, so that derivation must not change. An image keeps its full
// filename, which both avoids mangling (`chart.png`.slice(0,-5) === 'char') and
// guarantees `chart.png` can never collide with `chart.html`.
function cardIdFor(name) {
  return isHtmlFile(name) ? name.slice(0, -'.html'.length) : name;
}

function extOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').trim();
}

// The filename regex admits only [A-Za-z0-9._-], so a name can never carry
// HTML-special characters into this document.
function imageDocument(title, mime, b64) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${title}</title>` +
    '<style>html,body{margin:0;height:100%;background:#0a0e16}' +
    'body{display:flex;align-items:center;justify-content:center}' +
    'img{max-width:100%;max-height:100vh;object-fit:contain;display:block}</style>' +
    `</head><body><img src="data:${mime};base64,${b64}" alt="${title}"></body></html>`
  );
}

function buildImageCard(full, filename, stat) {
  if (stat.size > MAX_IMAGE_BYTES) return null;
  let bytes;
  try {
    bytes = fs.readFileSync(full);
  } catch (e) {
    return null;
  }
  const mime = IMAGE_MIME[extOf(filename)];
  if (!mime) return null;
  const title = filename.slice(0, -(path.extname(filename).length));
  return {
    id: cardIdFor(filename),
    title,
    mtime: stat.mtimeMs,
    html: imageDocument(title, mime, bytes.toString('base64')),
  };
}

function buildHtmlCard(full, filename, stat) {
  if (stat.size > MAX_CARD_BYTES) return null;
  let html;
  try {
    html = fs.readFileSync(full, 'utf8');
  } catch (e) {
    return null;
  }
  const id = cardIdFor(filename);
  let title = id;
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t && stripTags(t[1])) {
    title = stripTags(t[1]);
  } else {
    const h = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h && stripTags(h[1])) title = stripTags(h[1]);
  }
  return { id, title, mtime: stat.mtimeMs, html };
}

function buildCard(canvasDir, filename) {
  // SECURITY: only plain filenames directly inside canvasDir.
  if (!isCardFile(filename)) return null;
  const full = path.join(canvasDir, filename);
  let stat;
  try {
    stat = fs.statSync(full);
    if (!stat.isFile()) return null;
  } catch (e) {
    return null;
  }
  return isImageFile(filename)
    ? buildImageCard(full, filename, stat)
    : buildHtmlCard(full, filename, stat);
}

// Resolve a card id back to its real file by READING the directory and matching on
// cardIdFor(). Deliberately not reconstructed from the id ('foo' -> 'foo.html'):
// string reconstruction is where traversal bugs breed. We can only ever return a name
// we literally just found inside canvasDir, which makes escaping it structurally
// impossible rather than merely validated against.
function findCardFile(canvasDir, id) {
  let names;
  try {
    names = fs.readdirSync(canvasDir);
  } catch (e) {
    return null;
  }
  for (const name of names) {
    if (!isCardFile(name)) continue;
    if (cardIdFor(name) === id) return name;
  }
  return null;
}

// A dropped file's real name is arbitrary — the single most common one you will ever
// drop is "Screen Shot 2026-07-11 at 10.30.00.png", which has spaces. Card filenames
// must match [A-Za-z0-9._-]+, so coerce the name rather than reject it: validating and
// refusing would make this feature silently fail on its main use case.
function sanitizeCardName(base) {
  const ext = path.extname(base).toLowerCase();
  const stem = base
    .slice(0, base.length - ext.length)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (stem || 'file') + ext;
}

// Copy a file into a session's canvas dir so it renders as a card.
// Returns the destination filename, or null if the file is refused.
function importIntoCanvas(canvasDir, srcPath) {
  const dest = sanitizeCardName(path.basename(srcPath));
  if (!isCardFile(dest)) return null; // only what buildCard can actually render

  let stat;
  try {
    stat = fs.statSync(srcPath);
    if (!stat.isFile()) return null;
  } catch (e) {
    return null;
  }
  if (stat.size > (isImageFile(dest) ? MAX_IMAGE_BYTES : MAX_CARD_BYTES)) return null;

  const full = path.join(canvasDir, dest);
  // dest is a bare name, so this holds by construction — assert it anyway.
  if (path.dirname(path.resolve(full)) !== path.resolve(canvasDir)) return null;

  try {
    fs.copyFileSync(srcPath, full); // overwrite: same filename => same card, updated in place
  } catch (e) {
    return null;
  }
  return dest;
}

function snapshotCards(canvasDir) {
  let names;
  try {
    names = fs.readdirSync(canvasDir);
  } catch (e) {
    return [];
  }
  const cards = [];
  for (const name of names) {
    if (!isCardFile(name)) continue;
    const card = buildCard(canvasDir, name);
    if (card) cards.push(card);
  }
  cards.sort((a, b) => a.mtime - b.mtime);
  return cards;
}

module.exports = {
  buildCard,
  findCardFile,
  sanitizeCardName,
  importIntoCanvas,
  snapshotCards,
  isCardFile,
  isImageFile,
  cardIdFor,
  MAX_CARD_BYTES,
  MAX_IMAGE_BYTES,
};

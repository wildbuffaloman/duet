'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildCard,
  snapshotCards,
  isCardFile,
  cardIdFor,
  findCardFile,
  sanitizeCardName,
  importIntoCanvas,
  isPathUnderHome,
  MAX_IMAGE_BYTES,
} = require('../lib/cards');

// A real 1x1 PNG. Content doesn't matter to buildCard (it base64s the bytes verbatim),
// but using genuine image bytes keeps the fixture honest.
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function tmpCanvas() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'duet-cards-'));
}

function write(dir, name, data) {
  fs.writeFileSync(path.join(dir, name), data);
  return path.join(dir, name);
}

// ---------------------------------------------------------------------------
// Existing behavior — .html cards (regression guard for the extraction)
// ---------------------------------------------------------------------------

test('builds an html card, taking its title from <title>', () => {
  const dir = tmpCanvas();
  write(dir, 'report.html', '<!doctype html><title>Q3 Report</title><body>hi</body>');

  const card = buildCard(dir, 'report.html');

  assert.equal(card.id, 'report');
  assert.equal(card.title, 'Q3 Report');
  assert.match(card.html, /Q3 Report/);
});

test('rejects a file whose extension is neither .html nor a known image', () => {
  const dir = tmpCanvas();
  write(dir, 'notes.txt', 'plain text');

  assert.equal(buildCard(dir, 'notes.txt'), null);
});

// ---------------------------------------------------------------------------
// FB-1 — image cards
// ---------------------------------------------------------------------------

test('renders a .png as a self-contained <img> data-URI card', () => {
  const dir = tmpCanvas();
  const bytes = Buffer.from(PNG_1X1_B64, 'base64');
  write(dir, 'chart.png', bytes);

  const card = buildCard(dir, 'chart.png');

  assert.ok(card, 'expected a card for chart.png, got null');
  assert.match(card.html, /^<!doctype html>/i);
  assert.match(card.html, /<img[^>]+src="data:image\/png;base64,/);
  // the exact bytes must survive the round-trip
  assert.ok(card.html.includes(bytes.toString('base64')));
  // self-contained: no external resource may be referenced
  assert.doesNotMatch(card.html, /(src|href)\s*=\s*["']https?:/i);
});

test('image card keeps its full filename as id, so chart.png cannot collide with chart.html', () => {
  const dir = tmpCanvas();
  write(dir, 'chart.png', Buffer.from(PNG_1X1_B64, 'base64'));
  write(dir, 'chart.html', '<!doctype html><title>Chart</title>');

  assert.equal(cardIdFor('chart.png'), 'chart.png');
  assert.equal(cardIdFor('chart.html'), 'chart');
  assert.notEqual(buildCard(dir, 'chart.png').id, buildCard(dir, 'chart.html').id);
});

test('image card titles itself with the basename, not the extension', () => {
  const dir = tmpCanvas();
  write(dir, 'sales-map.png', Buffer.from(PNG_1X1_B64, 'base64'));

  assert.equal(buildCard(dir, 'sales-map.png').title, 'sales-map');
});

test('maps each supported image extension to the right MIME type', () => {
  const dir = tmpCanvas();
  const bytes = Buffer.from(PNG_1X1_B64, 'base64');
  const cases = [
    ['a.png', 'image/png'],
    ['b.jpg', 'image/jpeg'],
    ['c.jpeg', 'image/jpeg'],
    ['d.gif', 'image/gif'],
    ['e.webp', 'image/webp'],
    ['f.svg', 'image/svg+xml'],
  ];

  for (const [name, mime] of cases) {
    write(dir, name, bytes);
    assert.match(buildCard(dir, name).html, new RegExp(`src="data:${mime.replace('+', '\\+')};base64,`), name);
  }
});

test('skips an image over the size cap instead of blowing up the WS frame', () => {
  const dir = tmpCanvas();
  write(dir, 'huge.png', Buffer.alloc(MAX_IMAGE_BYTES + 1));

  assert.equal(buildCard(dir, 'huge.png'), null);
});

test('isCardFile accepts html and images, rejects everything else', () => {
  assert.ok(isCardFile('a.html'));
  assert.ok(isCardFile('a.png'));
  assert.ok(isCardFile('a.SVG'), 'extension match must be case-insensitive');
  assert.ok(!isCardFile('a.txt'));
  assert.ok(!isCardFile('../escape.png'), 'path separators must never match');
});

test('snapshotCards returns html and image cards together, mtime-ascending', () => {
  const dir = tmpCanvas();
  write(dir, 'first.html', '<!doctype html><title>First</title>');
  const png = write(dir, 'second.png', Buffer.from(PNG_1X1_B64, 'base64'));
  write(dir, 'ignored.txt', 'nope');
  // force a deterministic ordering
  fs.utimesSync(path.join(dir, 'first.html'), new Date(1000), new Date(1000));
  fs.utimesSync(png, new Date(2000), new Date(2000));

  const cards = snapshotCards(dir);

  assert.deepEqual(cards.map((c) => c.id), ['first', 'second.png']);
});

// ---------------------------------------------------------------------------
// FB-3 — resolving a card id back to its file (for delete)
// ---------------------------------------------------------------------------

test('findCardFile resolves an html id to its file', () => {
  const dir = tmpCanvas();
  write(dir, 'report.html', '<!doctype html><title>R</title>');

  assert.equal(findCardFile(dir, 'report'), 'report.html');
});

test('findCardFile resolves an image id (which is the full filename)', () => {
  const dir = tmpCanvas();
  write(dir, 'chart.png', Buffer.from(PNG_1X1_B64, 'base64'));

  assert.equal(findCardFile(dir, 'chart.png'), 'chart.png');
});

test('findCardFile returns null for an unknown id', () => {
  const dir = tmpCanvas();

  assert.equal(findCardFile(dir, 'nope'), null);
});

test('findCardFile can never return a name outside the directory', () => {
  const dir = tmpCanvas();
  write(dir, 'a.html', '<!doctype html><title>A</title>');

  // Only names actually read out of `dir` are candidates, so a traversal id
  // resolves to nothing — escaping is structurally impossible, not just validated.
  assert.equal(findCardFile(dir, '../../../etc/passwd'), null);
  assert.equal(findCardFile(dir, '..'), null);
});

// ---------------------------------------------------------------------------
// FB-2 — importing a dropped file into a canvas dir
// ---------------------------------------------------------------------------

test('sanitizeCardName makes a real screenshot name card-safe, keeping the extension', () => {
  assert.equal(
    sanitizeCardName('Screen Shot 2026-07-11 at 10.30.00.png'),
    'Screen-Shot-2026-07-11-at-10.30.00.png'
  );
});

test('sanitizeCardName collapses unsafe runs and trims dashes', () => {
  assert.equal(sanitizeCardName('  wild   name!!.png'), 'wild-name.png');
});

test('importIntoCanvas copies an image in under a sanitized name', () => {
  const src = tmpCanvas();
  const dst = tmpCanvas();
  write(src, 'my shot.png', Buffer.from(PNG_1X1_B64, 'base64'));

  const name = importIntoCanvas(dst, path.join(src, 'my shot.png'));

  assert.equal(name, 'my-shot.png');
  assert.ok(fs.existsSync(path.join(dst, 'my-shot.png')));
  assert.ok(buildCard(dst, 'my-shot.png'), 'the copy must be renderable as a card');
});

test('importIntoCanvas refuses a file type the canvas cannot render', () => {
  const src = tmpCanvas();
  const dst = tmpCanvas();
  write(src, 'notes.txt', 'plain');

  assert.equal(importIntoCanvas(dst, path.join(src, 'notes.txt')), null);
});

test('importIntoCanvas refuses an image over the size cap', () => {
  const src = tmpCanvas();
  const dst = tmpCanvas();
  write(src, 'huge.png', Buffer.alloc(MAX_IMAGE_BYTES + 1));

  assert.equal(importIntoCanvas(dst, path.join(src, 'huge.png')), null);
});

test('importIntoCanvas cannot be made to write outside the canvas dir', () => {
  const src = tmpCanvas();
  const dst = tmpCanvas();
  write(src, 'ok.png', Buffer.from(PNG_1X1_B64, 'base64'));

  // basename() strips any traversal in the source path; the destination is always
  // a bare name inside dst.
  const name = importIntoCanvas(dst, path.join(src, '..', path.basename(src), 'ok.png'));

  assert.equal(name, 'ok.png');
  assert.ok(fs.existsSync(path.join(dst, 'ok.png')));
});

test('importIntoCanvas returns null for a missing source', () => {
  const dst = tmpCanvas();

  assert.equal(importIntoCanvas(dst, '/nope/missing.png'), null);
});

// ---------------------------------------------------------------------------
// Task 3 — fail-closed $HOME symlink guard
// ---------------------------------------------------------------------------

test('isPathUnderHome accepts paths under home, rejects escapes', () => {
  assert.strictEqual(isPathUnderHome('/Users/x/Documents/a.html', '/Users/x'), true);
  assert.strictEqual(isPathUnderHome('/Users/x', '/Users/x'), true);
  assert.strictEqual(isPathUnderHome('/etc/passwd', '/Users/x'), false);
  assert.strictEqual(isPathUnderHome('/Users/xevil/a', '/Users/x'), false); // prefix, not child
});

function tmpHomeDirs() {
  // realpath: macOS /var/folders resolves to /private/var/folders — without this,
  // a symlink target under the tmpdir home would fail the startsWith(home) check.
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-home-')));
  const canvasDir = path.join(home, '.duet', 'canvas', 's1');
  fs.mkdirSync(canvasDir, { recursive: true });
  return { home, canvasDir };
}

test('buildCard renders a symlink whose target is under home', () => {
  const { home, canvasDir } = tmpHomeDirs();
  const target = path.join(home, 'Documents', 'real.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '<title>Real</title><h1>Real</h1>');
  fs.symlinkSync(target, path.join(canvasDir, 'real.html'));

  const card = buildCard(canvasDir, 'real.html', { homeRoot: home });
  assert.strictEqual(card.title, 'Real');
  assert.match(card.html, /<h1>Real<\/h1>/);
});

test('buildCard blocks a symlink whose target escapes home — never leaks contents', () => {
  const { home, canvasDir } = tmpHomeDirs();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-outside-')));
  const secret = path.join(outside, 'secret.html');
  fs.writeFileSync(secret, '<title>SECRET</title>TOP-SECRET-BODY');
  fs.symlinkSync(secret, path.join(canvasDir, 'secret.html'));

  const card = buildCard(canvasDir, 'secret.html', { homeRoot: home });
  assert.strictEqual(card.id, 'secret');
  assert.match(card.html, /blocked: link escapes home/);
  assert.doesNotMatch(card.html, /TOP-SECRET-BODY/);
});

test('buildCard returns null for a broken symlink', () => {
  const { home, canvasDir } = tmpHomeDirs();
  fs.symlinkSync(path.join(home, 'gone.html'), path.join(canvasDir, 'dangling.html'));
  assert.strictEqual(buildCard(canvasDir, 'dangling.html', { homeRoot: home }), null);
});

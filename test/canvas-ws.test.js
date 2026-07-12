'use strict';

// Integration: drive the real server over the real /canvas WebSocket.
// Covers the wiring unit tests can't reach — the chokidar watcher's card-file
// gate and the unlink -> card-id path inside server.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const PORT = 7601;
const SESSION = 'test-fb1';
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await sleep(50);
  }
  throw new Error('server did not become healthy');
}

// Resolve with the first message satisfying `match`, else reject on timeout.
function nextMessage(ws, match, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMsg);
      reject(new Error('timed out waiting for a matching message'));
    }, timeoutMs);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!match(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(msg);
    }
    ws.on('message', onMsg);
  });
}

test('an image dropped into the canvas dir arrives as an <img> card, and its removal removes it', async (t) => {
  const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-cws-')));
  const CANVAS_DIR = path.join(HOME, '.duet', 'canvas', SESSION);
  fs.mkdirSync(CANVAS_DIR, { recursive: true });

  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DUET_PORT: String(PORT), HOME },
    stdio: 'ignore',
  });

  t.after(() => {
    srv.kill();
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  await waitForHealth();

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/canvas?session=${SESSION}`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await nextMessage(ws, (m) => m.type === 'snapshot');

  // give chokidar a beat to arm its watcher before we write
  await sleep(150);

  const bytes = Buffer.from(PNG_1X1_B64, 'base64');
  fs.writeFileSync(path.join(CANVAS_DIR, 'chart.png'), bytes);

  const added = await nextMessage(ws, (m) => m.type === 'card' && m.card.id === 'chart.png');
  assert.match(added.card.html, /<img[^>]+src="data:image\/png;base64,/);
  assert.equal(added.card.title, 'chart');

  fs.unlinkSync(path.join(CANVAS_DIR, 'chart.png'));

  const removed = await nextMessage(ws, (m) => m.type === 'remove');
  assert.equal(removed.id, 'chart.png', 'remove must carry the image card id, unmangled');

  ws.close();
});

test('an import message copies a file in and broadcasts it as a card; a delete removes it', async (t) => {
  const PORT2 = 7602;
  const SESSION2 = 'test-fb2';
  const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-cws-')));
  const CANVAS2 = path.join(HOME, '.duet', 'canvas', SESSION2);

  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-src-'));
  fs.writeFileSync(path.join(srcDir, 'my shot.png'), Buffer.from(PNG_1X1_B64, 'base64'));

  fs.mkdirSync(CANVAS2, { recursive: true });

  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DUET_PORT: String(PORT2), HOME },
    stdio: 'ignore',
  });
  t.after(() => {
    srv.kill();
    fs.rmSync(HOME, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  const deadline = Date.now() + 5000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${PORT2}/health`)).ok) break; } catch (e) { /* not up */ }
    if (Date.now() > deadline) throw new Error('server did not become healthy');
    await sleep(50);
  }

  const ws = new WebSocket(`ws://127.0.0.1:${PORT2}/canvas?session=${SESSION2}`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await nextMessage(ws, (m) => m.type === 'snapshot');
  await sleep(150);

  ws.send(JSON.stringify({ type: 'import', path: path.join(srcDir, 'my shot.png') }));

  const added = await nextMessage(ws, (m) => m.type === 'card');
  assert.equal(added.card.id, 'my-shot.png', 'the imported name must be sanitized');
  assert.match(added.card.html, /<img[^>]+src="data:image\/png;base64,/);

  ws.send(JSON.stringify({ type: 'delete', id: 'my-shot.png' }));

  const removed = await nextMessage(ws, (m) => m.type === 'remove');
  assert.equal(removed.id, 'my-shot.png');
  assert.ok(!fs.existsSync(path.join(CANVAS2, 'my-shot.png')), 'the file must actually be gone');

  ws.close();
});

test('the canvas snapshot advertises the absolute session directory (FB-6 copy-path)', async (t) => {
  const PORT3 = 7603;
  const SESSION3 = 'test-fb6';
  const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-cws-')));
  const CANVAS3 = path.join(HOME, '.duet', 'canvas', SESSION3);

  fs.mkdirSync(CANVAS3, { recursive: true });

  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DUET_PORT: String(PORT3), HOME },
    stdio: 'ignore',
  });
  t.after(() => {
    srv.kill();
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  const deadline = Date.now() + 5000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${PORT3}/health`)).ok) break; } catch (e) { /* not up */ }
    if (Date.now() > deadline) throw new Error('server did not become healthy');
    await sleep(50);
  }

  const ws = new WebSocket(`ws://127.0.0.1:${PORT3}/canvas?session=${SESSION3}`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  const snap = await nextMessage(ws, (m) => m.type === 'snapshot');
  assert.equal(snap.dir, CANVAS3, 'snapshot must carry the absolute canvas dir so the client can copy it');

  ws.close();
});

test('a symlinked card advertises its resolved vault target as src (FB-10 copy-file-path)', async (t) => {
  const PORT4 = 7604;
  const SESSION4 = 'test-fb10';
  const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-cws-')));
  const CANVAS4 = path.join(HOME, '.duet', 'canvas', SESSION4);
  fs.mkdirSync(CANVAS4, { recursive: true });

  // canonical vault file (real name has a space) ← symlink with a card-safe name
  const target = path.join(HOME, 'Documents', 'Obsidian Vault', 'Heros Quest.html');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '<title>Quest</title><h1>Quest</h1>');
  fs.symlinkSync(target, path.join(CANVAS4, 'heros-quest.html'));

  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DUET_PORT: String(PORT4), HOME },
    stdio: 'ignore',
  });
  t.after(() => {
    srv.kill();
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  const deadline = Date.now() + 5000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${PORT4}/health`)).ok) break; } catch (e) { /* not up */ }
    if (Date.now() > deadline) throw new Error('server did not become healthy');
    await sleep(50);
  }

  const ws = new WebSocket(`ws://127.0.0.1:${PORT4}/canvas?session=${SESSION4}`);
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  const snap = await nextMessage(ws, (m) => m.type === 'snapshot');
  const card = (snap.cards || []).find((c) => c.id === 'heros-quest');
  assert.ok(card, 'the symlinked card must appear in the snapshot');
  assert.equal(card.src, target, 'src must be the resolved vault file, not the symlink path in the canvas dir');

  ws.close();
});

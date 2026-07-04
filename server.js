'use strict';

// duet server — wire contract v1
// Performance rules: binary WS frames for PTY bytes, perMessageDeflate off,
// TCP_NODELAY on every socket, zero logging on the data path.

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('@lydell/node-pty');
const chokidar = require('chokidar');

const PORT = parseInt(process.env.DUET_PORT, 10) || 7433;
const HOST = '127.0.0.1';

const CANVAS_ROOT = path.join(os.homedir(), '.duet', 'canvas');
const SESSION_RE = /^[a-z0-9-]{1,32}$/;
const CARD_FILE_RE = /^[A-Za-z0-9._-]+\.html$/;

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));

const vendor = (rel) => path.join(__dirname, 'node_modules', rel);
app.get('/vendor/xterm.css', (req, res) => res.sendFile(vendor('@xterm/xterm/css/xterm.css')));
app.get('/vendor/xterm.js', (req, res) => res.sendFile(vendor('@xterm/xterm/lib/xterm.js')));
app.get('/vendor/addon-fit.js', (req, res) => res.sendFile(vendor('@xterm/addon-fit/lib/addon-fit.js')));
app.get('/vendor/addon-webgl.js', (req, res) => res.sendFile(vendor('@xterm/addon-webgl/lib/addon-webgl.js')));

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canvasDirFor(sessionId) {
  return path.join(CANVAS_ROOT, sessionId);
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').trim();
}

function buildCard(canvasDir, filename) {
  // SECURITY: only plain filenames directly inside canvasDir.
  if (!CARD_FILE_RE.test(filename)) return null;
  const full = path.join(canvasDir, filename);
  let html, stat;
  try {
    stat = fs.statSync(full);
    if (!stat.isFile()) return null;
    html = fs.readFileSync(full, 'utf8');
  } catch (e) {
    return null;
  }
  const id = filename.slice(0, -'.html'.length);
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

function snapshotCards(canvasDir) {
  let names;
  try {
    names = fs.readdirSync(canvasDir);
  } catch (e) {
    return [];
  }
  const cards = [];
  for (const name of names) {
    if (!CARD_FILE_RE.test(name)) continue;
    const card = buildCard(canvasDir, name);
    if (card) cards.push(card);
  }
  cards.sort((a, b) => a.mtime - b.mtime);
  return cards;
}

// ---------------------------------------------------------------------------
// WS: /term — one PTY per connection
// ---------------------------------------------------------------------------

const termWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

termWss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const sessionId = q.get('session');
  const cols = parseInt(q.get('cols'), 10) || 80;
  const rows = parseInt(q.get('rows'), 10) || 24;
  // paneId (q.get('pane')) is informational only.

  const canvasDir = canvasDirFor(sessionId);
  fs.mkdirSync(canvasDir, { recursive: true });

  let proc;
  try {
    proc = pty.spawn(process.env.SHELL || '/bin/zsh', ['-l'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: {
        ...process.env,
        DUET_SESSION: sessionId,
        DUET_CANVAS: canvasDir,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
  } catch (e) {
    ws.close(1011, 'pty spawn failed');
    return;
  }

  let exited = false;

  proc.onData((d) => {
    if (ws.readyState === 1) ws.send(Buffer.from(d));
  });

  proc.onExit(({ exitCode }) => {
    exited = true;
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      } catch (e) { /* ignore */ }
    }
    ws.close();
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // Raw input bytes -> PTY.
      try {
        proc.write(data.toString('utf8'));
      } catch (e) { /* pty gone */ }
    } else {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (e) {
        return;
      }
      if (msg && msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
        try {
          proc.resize(msg.cols, msg.rows);
        } catch (e) { /* ignore */ }
      }
    }
  });

  ws.on('close', () => {
    if (!exited) {
      try {
        proc.kill();
      } catch (e) { /* ignore */ }
    }
  });

  ws.on('error', () => { /* close handler does cleanup */ });
});

// ---------------------------------------------------------------------------
// WS: /canvas — snapshot + refcounted chokidar watcher per session
// ---------------------------------------------------------------------------

const canvasWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

// sessionId -> { watcher, subscribers: Set<ws> }
const canvasWatchers = new Map();

function broadcast(entry, obj) {
  const msg = JSON.stringify(obj);
  for (const sub of entry.subscribers) {
    if (sub.readyState === 1) sub.send(msg);
  }
}

function acquireWatcher(sessionId) {
  let entry = canvasWatchers.get(sessionId);
  if (entry) return entry;

  const canvasDir = canvasDirFor(sessionId);
  const watcher = chokidar.watch(canvasDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 40, pollInterval: 10 },
    depth: 0,
  });

  entry = { watcher, subscribers: new Set() };
  canvasWatchers.set(sessionId, entry);

  const onAddOrChange = (filePath) => {
    const name = path.basename(filePath);
    if (!CARD_FILE_RE.test(name)) return;
    if (path.dirname(path.resolve(filePath)) !== path.resolve(canvasDir)) return;
    const card = buildCard(canvasDir, name);
    if (card) broadcast(entry, { type: 'card', card });
  };

  watcher.on('add', onAddOrChange);
  watcher.on('change', onAddOrChange);
  watcher.on('unlink', (filePath) => {
    const name = path.basename(filePath);
    if (!CARD_FILE_RE.test(name)) return;
    broadcast(entry, { type: 'remove', id: name.slice(0, -'.html'.length) });
  });
  watcher.on('error', () => { /* keep watching; never log on data path */ });

  return entry;
}

function releaseWatcher(sessionId, ws) {
  const entry = canvasWatchers.get(sessionId);
  if (!entry) return;
  entry.subscribers.delete(ws);
  if (entry.subscribers.size === 0) {
    canvasWatchers.delete(sessionId);
    entry.watcher.close().catch(() => {});
  }
}

canvasWss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const sessionId = q.get('session');

  const canvasDir = canvasDirFor(sessionId);
  fs.mkdirSync(canvasDir, { recursive: true });

  ws.send(JSON.stringify({ type: 'snapshot', cards: snapshotCards(canvasDir) }));

  const entry = acquireWatcher(sessionId);
  entry.subscribers.add(ws);

  ws.on('close', () => releaseWatcher(sessionId, ws));
  ws.on('error', () => { /* close handler does cleanup */ });
});

// ---------------------------------------------------------------------------
// Upgrade routing
// ---------------------------------------------------------------------------

server.on('upgrade', (req, socket, head) => {
  socket.setNoDelay(true);

  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (e) {
    socket.destroy();
    return;
  }

  const sessionId = url.searchParams.get('session');
  if (!sessionId || !SESSION_RE.test(sessionId)) {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  if (url.pathname === '/term') {
    termWss.handleUpgrade(req, socket, head, (ws) => {
      termWss.emit('connection', ws, req);
    });
  } else if (url.pathname === '/canvas') {
    canvasWss.handleUpgrade(req, socket, head, (ws) => {
      canvasWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `duet: port ${PORT} is already in use. ` +
      `Stop the other process or start with a different port, e.g. DUET_PORT=${PORT + 1} node server.js`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`duet listening on http://${HOST}:${PORT}`);
});

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
const {
  buildCard,
  snapshotCards,
  isCardFile,
  cardIdFor,
  importIntoCanvas,
  findCardFile,
} = require('./lib/cards');

const PORT = parseInt(process.env.DUET_PORT, 10) || 7433;
const HOST = '127.0.0.1';

const CANVAS_ROOT = path.join(os.homedir(), '.duet', 'canvas');
const SESSION_RE = /^[a-z0-9-]{1,32}$/;

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

function clampDim(v, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, 2), 1000);
}

// ---------------------------------------------------------------------------
// WS: /term — one PTY per connection
// ---------------------------------------------------------------------------

const termWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

const livePtys = new Set();

termWss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const sessionId = q.get('session');
  const cols = clampDim(q.get('cols'), 80);
  const rows = clampDim(q.get('rows'), 24);
  // paneId (q.get('pane')) is informational only.

  const canvasDir = canvasDirFor(sessionId);
  try {
    fs.mkdirSync(canvasDir, { recursive: true });
  } catch (e) {
    ws.close(1011, 'canvas dir unavailable');
    return;
  }

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

  livePtys.add(proc);
  let exited = false;

  // Backpressure: pause the PTY when the WS send buffer backs up (slow client),
  // resume once it drains. Prevents unbounded memory growth on the data path.
  const HIGH_WATER = 1 << 20; // 1 MiB
  const LOW_WATER = 64 * 1024;
  let paused = false;
  let drainTimer = null;

  function resumeWhenDrained() {
    drainTimer = setInterval(() => {
      if (ws.readyState !== 1 || ws.bufferedAmount <= LOW_WATER) {
        clearInterval(drainTimer);
        drainTimer = null;
        paused = false;
        if (ws.readyState === 1) {
          try { proc.resume(); } catch (e) { /* pty gone */ }
        }
      }
    }, 50);
  }

  proc.onData((d) => {
    if (ws.readyState !== 1) return;
    ws.send(Buffer.from(d));
    if (!paused && ws.bufferedAmount > HIGH_WATER && typeof proc.pause === 'function') {
      paused = true;
      try { proc.pause(); } catch (e) { paused = false; return; }
      resumeWhenDrained();
    }
  });

  proc.onExit(({ exitCode }) => {
    exited = true;
    livePtys.delete(proc);
    if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
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
          proc.resize(clampDim(msg.cols, 80), clampDim(msg.rows, 24));
        } catch (e) { /* ignore */ }
      }
    }
  });

  ws.on('close', () => {
    if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
    if (!exited) {
      livePtys.delete(proc);
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
    if (!isCardFile(name)) return;
    if (path.dirname(path.resolve(filePath)) !== path.resolve(canvasDir)) return;
    const card = buildCard(canvasDir, name);
    if (card) broadcast(entry, { type: 'card', card });
  };

  watcher.on('add', onAddOrChange);
  watcher.on('change', onAddOrChange);
  watcher.on('unlink', (filePath) => {
    const name = path.basename(filePath);
    if (!isCardFile(name)) return;
    broadcast(entry, { type: 'remove', id: cardIdFor(name) });
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
  try {
    fs.mkdirSync(canvasDir, { recursive: true });
  } catch (e) {
    ws.close(1011, 'canvas dir unavailable');
    return;
  }

  ws.send(JSON.stringify({ type: 'snapshot', cards: snapshotCards(canvasDir) }));

  const entry = acquireWatcher(sessionId);
  entry.subscribers.add(ws);

  // Inbound canvas mutations. This socket already passed the Origin check on upgrade
  // and its sessionId is validated, so it is the ONLY channel we accept filesystem
  // mutations on — no HTTP route is opened (a route would have no Origin check, handing
  // any web page an arbitrary-file-copy primitive on localhost). Neither message
  // replies: the directory watcher turns the file change into the usual broadcast.
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'import' && typeof msg.path === 'string') {
      importIntoCanvas(canvasDir, msg.path);
      return;
    }
    if (msg.type === 'delete' && typeof msg.id === 'string') {
      const name = findCardFile(canvasDir, msg.id);
      if (!name) return; // unknown id — silent no-op
      try {
        fs.unlinkSync(path.join(canvasDir, name));
      } catch (e) { /* already gone */ }
    }
  });

  ws.on('close', () => releaseWatcher(sessionId, ws));
  ws.on('error', () => { /* close handler does cleanup */ });
});

// ---------------------------------------------------------------------------
// Upgrade routing
// ---------------------------------------------------------------------------

// SECURITY: browsers attach an Origin header to every WebSocket handshake. A
// /term socket is a full shell, so reject any browser origin that isn't this
// server itself (blocks arbitrary web pages connecting to 127.0.0.1). Requests
// without an Origin (curl, wscat, native clients) are allowed — they are not
// subject to the browser threat model.
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  let o;
  try {
    o = new URL(origin);
  } catch (e) {
    return false;
  }
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
  if (o.hostname !== '127.0.0.1' && o.hostname !== 'localhost' && o.hostname !== '[::1]') return false;
  const port = o.port || (o.protocol === 'https:' ? '443' : '80');
  return port === String(PORT);
}

server.on('upgrade', (req, socket, head) => {
  socket.setNoDelay(true);

  if (!originAllowed(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

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

// ---------------------------------------------------------------------------
// Shutdown — kill PTYs, close watchers and sockets, then exit.
// ---------------------------------------------------------------------------

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`duet: ${signal} — shutting down`);
  for (const proc of livePtys) {
    try { proc.kill(); } catch (e) { /* ignore */ }
  }
  livePtys.clear();
  for (const [sessionId, entry] of canvasWatchers) {
    canvasWatchers.delete(sessionId);
    entry.watcher.close().catch(() => {});
  }
  for (const ws of termWss.clients) ws.terminate();
  for (const ws of canvasWss.clients) ws.terminate();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

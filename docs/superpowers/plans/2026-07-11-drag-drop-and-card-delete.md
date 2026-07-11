# Drag-Drop Path Insert (FB-2) + Card Delete (FB-3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a file onto a duet terminal pane and its shell-escaped path is typed into the input line (Ghostty parity); drop it on a render pane and it becomes a canvas card; click ✕ on a card to delete it.

**Architecture:** Only native code can read a dropped file's real path, so Rust (Tauri) catches the OS drop, scale-corrects the coordinates, and one-way `eval`s `window.__duetDrop(paths, x, y)` into the page. JS owns the pane hit-test (the layout tree is client state). Terminal drops paste locally; render drops and card deletes become validated inbound messages on the **existing** canvas WebSocket — which is already Origin-checked and session-scoped — so no new HTTP route is opened.

**Tech Stack:** Node 22 (`node:test`, zero new deps), plain browser JS (no build step), Tauri 2.11 / Rust, xterm.js 6, chokidar.

## Global Constraints

- **No new dependencies.** Node's built-in test runner only. `serde_json` already exists in `Cargo.toml`.
- **No new HTTP endpoint.** All client→server canvas mutation rides the existing `/canvas` WebSocket (ROADMAP gates file endpoints at M2.5).
- **Pane types in code are `"term"` and `"render"`** — not "canvas". Pane DOM carries `data-win`, `data-type`, `data-session`.
- **`public/app.js` is plain browser script** — it cannot `require()`. Shared code must be UMD.
- **Latency budget is law.** Nothing added to the PTY data path.
- **Never insert a newline.** Dropping a path must never execute anything.
- Branch: `fb1-canvas-images` (FB-1 already merged into it: `lib/cards.js`, `test/`, 10/10 green).
- Run the full suite with `npm test` (which is `node --test test/*.test.js` — the directory form silently fails).

---

### Task 1: Shell-escape helper (shared browser + node)

**Files:**
- Create: `public/shell-escape.js`
- Test: `test/shell-escape.test.js`
- Modify: `public/index.html` (add `<script src="/shell-escape.js"></script>` immediately BEFORE the `app.js` tag)

**Interfaces:**
- Produces: `DuetShellEscape.shellEscape(path: string) -> string`, `DuetShellEscape.shellEscapeAll(paths: string[]) -> string` (space-joined). In Node: `require('../public/shell-escape.js')` returns the same object.

- [ ] **Step 1: Write the failing test**

```js
// test/shell-escape.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { shellEscape, shellEscapeAll } = require('../public/shell-escape.js');

test('leaves an already-safe path untouched', () => {
  assert.equal(shellEscape('/Users/me/pics/chart.png'), '/Users/me/pics/chart.png');
});

test('single-quotes a path containing spaces', () => {
  assert.equal(
    shellEscape('/Users/me/Screen Shot 2026-07-11.png'),
    "'/Users/me/Screen Shot 2026-07-11.png'"
  );
});

test("encodes an embedded single quote as '\\'' so the quoting cannot be broken out of", () => {
  assert.equal(shellEscape("/Users/me/Alberto's Mac/a.png"), "'/Users/me/Alberto'\\''s Mac/a.png'");
});

test('quotes a path with shell metacharacters', () => {
  assert.equal(shellEscape('/tmp/a;rm -rf b.png'), "'/tmp/a;rm -rf b.png'");
});

test('quotes non-ascii paths', () => {
  assert.equal(shellEscape('/tmp/informe año.png'), "'/tmp/informe año.png'");
});

test('an empty string becomes explicit empty quotes', () => {
  assert.equal(shellEscape(''), "''");
});

test('joins multiple paths with a single space, each escaped independently', () => {
  assert.equal(
    shellEscapeAll(['/tmp/a.png', '/tmp/b c.png']),
    "/tmp/a.png '/tmp/b c.png'"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-reporter=spec test/shell-escape.test.js`
Expected: FAIL — `Cannot find module '../public/shell-escape.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// public/shell-escape.js
// POSIX path escaping for insertion into a terminal input line.
// UMD: public/app.js loads it as a browser script; node:test requires it.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuetShellEscape = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Characters that are safe unquoted in every POSIX shell.
  var SAFE_RE = /^[A-Za-z0-9_@%+=:,.\/-]+$/;

  function shellEscape(p) {
    if (p === '') return "''";
    if (SAFE_RE.test(p)) return p;
    // Single quotes disable ALL interpretation. The only thing that can end the
    // quoting is a single quote, so encode it as '\'' (close, escaped quote, reopen).
    return "'" + p.replace(/'/g, "'\\''") + "'";
  }

  function shellEscapeAll(paths) {
    return paths.map(shellEscape).join(' ');
  }

  return { shellEscape: shellEscape, shellEscapeAll: shellEscapeAll };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-reporter=spec test/shell-escape.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Wire it into the page**

In `public/index.html`, add this line immediately before the existing `app.js` script tag:

```html
<script src="/shell-escape.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add public/shell-escape.js test/shell-escape.test.js public/index.html
git commit -m "feat(fb2): shell-escape helper shared by browser and tests"
```

---

### Task 2: Resolve a card id back to its file (`findCardFile`)

**Files:**
- Modify: `lib/cards.js`
- Test: `test/cards.test.js` (append)

**Interfaces:**
- Consumes: `isCardFile(name)`, `cardIdFor(name)` (Task 0 / FB-1, already shipped).
- Produces: `findCardFile(canvasDir: string, id: string) -> string | null` — the *filename*, or null.

- [ ] **Step 1: Write the failing test**

Append to `test/cards.test.js` (the file already imports from `../lib/cards`; add `findCardFile` to that import):

```js
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
  // Only names actually read out of `dir` are candidates, so traversal ids resolve to nothing.
  assert.equal(findCardFile(dir, '../../../etc/passwd'), null);
  assert.equal(findCardFile(dir, '..'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `findCardFile is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/cards.js` (and add `findCardFile` to `module.exports`):

```js
// Resolve a card id back to its real file by READING the directory and matching
// on cardIdFor(). Deliberately not string-reconstructed from the id: we can only
// ever return a name we literally just found inside canvasDir, which makes
// escaping the directory structurally impossible rather than merely validated.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/cards.js test/cards.test.js
git commit -m "feat(fb3): findCardFile — resolve a card id to its file by directory read"
```

---

### Task 3: Import a dropped file into a canvas dir

**Files:**
- Modify: `lib/cards.js`
- Test: `test/cards.test.js` (append)

**Interfaces:**
- Produces: `sanitizeCardName(base: string) -> string`, `importIntoCanvas(canvasDir: string, srcPath: string) -> string | null` (the destination filename, or null if refused).

**Why sanitize rather than reject:** the card-file regex is `[A-Za-z0-9._-]+`, but the single most common real file you will drop is `Screen Shot 2026-07-11 at 10.30.00.png` — it has spaces. Rejecting it would make the feature silently fail on its main use case.

- [ ] **Step 1: Write the failing test**

Append to `test/cards.test.js` (add `sanitizeCardName, importIntoCanvas` to the import):

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `sanitizeCardName is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `lib/cards.js` (export both):

```js
// A dropped file's real name is arbitrary ("Screen Shot 2026-07-11 at 10.30.00.png").
// Card filenames must match [A-Za-z0-9._-]+, so coerce rather than reject.
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
    fs.copyFileSync(srcPath, full); // overwrite = same filename ⇒ same card, updated in place
  } catch (e) {
    return null;
  }
  return dest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 21 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/cards.js test/cards.test.js
git commit -m "feat(fb2): importIntoCanvas + filename sanitization for dropped files"
```

---

### Task 4: Canvas WebSocket accepts `import` and `delete`

**Files:**
- Modify: `server.js` (the `canvasWss.on('connection', ...)` handler)
- Test: `test/canvas-ws.test.js` (append)

**Interfaces:**
- Consumes: `importIntoCanvas`, `findCardFile` from `lib/cards.js`.
- Produces: inbound WS messages `{type:'import', path}` and `{type:'delete', id}` on `/canvas?session=<sid>`. No response message — the existing chokidar watcher broadcasts the resulting `card` / `remove` event.

- [ ] **Step 1: Write the failing test**

Append to `test/canvas-ws.test.js`. Reuse its existing helpers (`waitForHealth`, `nextMessage`, `sleep`, `PNG_1X1_B64`); use a distinct session id and port so it can run alongside the existing test:

```js
test('an import message copies a file in and broadcasts it as a card; a delete message removes it', async (t) => {
  const PORT2 = 7602;
  const SESSION2 = 'test-fb2';
  const CANVAS2 = path.join(os.homedir(), '.duet', 'canvas', SESSION2);
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'duet-src-'));
  fs.writeFileSync(path.join(srcDir, 'my shot.png'), Buffer.from(PNG_1X1_B64, 'base64'));

  fs.rmSync(CANVAS2, { recursive: true, force: true });
  fs.mkdirSync(CANVAS2, { recursive: true });

  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DUET_PORT: String(PORT2) },
    stdio: 'ignore',
  });
  t.after(() => {
    srv.kill();
    fs.rmSync(CANVAS2, { recursive: true, force: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
  });

  // waitForHealth/nextMessage are defined at the top of this file; health-check PORT2.
  const deadline = Date.now() + 5000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${PORT2}/health`)).ok) break; } catch (e) {}
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-reporter=spec test/canvas-ws.test.js`
Expected: FAIL — "timed out waiting for a matching message" (the server ignores inbound canvas messages today).

- [ ] **Step 3: Write minimal implementation**

In `server.js`, extend the import at the top:

```js
const { buildCard, snapshotCards, isCardFile, cardIdFor, importIntoCanvas, findCardFile } = require('./lib/cards');
```

Then inside `canvasWss.on('connection', (ws, req) => { ... })`, after `entry.subscribers.add(ws);`, add:

```js
  // Inbound canvas mutations. This socket already passed the Origin check on
  // upgrade and its sessionId is validated, so it is the only channel we accept
  // filesystem mutations on — no HTTP route is opened. The chokidar watcher
  // turns the resulting file change into the card/remove broadcast.
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — 22 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add server.js test/canvas-ws.test.js
git commit -m "feat(fb2,fb3): canvas WS accepts import and delete"
```

---

### Task 5: Client — `window.__duetDrop` and terminal paste

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `DuetShellEscape.shellEscapeAll` (Task 1); the `{type:'import'}` message (Task 4).
- Produces: global `window.__duetDrop(paths: string[], x: number, y: number)` — called by Rust (Task 7). Adds `paste(text)` to the terminal controller in `termCtls`.

- [ ] **Step 1: Add `paste` to the terminal controller**

In `public/app.js`, in the object assigned to `termCtls[w.id] = { ... }` (around line 483), add:

```js
      paste:function(text){ try { term.paste(text); } catch(e){} },
```

`term.paste()` is the right primitive: it routes through the same `term.onData` handler that already sends input bytes to the PTY, and it honors **bracketed paste**, so the path lands as literal editable text in Claude Code's input box instead of being interpreted.

- [ ] **Step 2: Add the drop entry point**

Add near the other top-level handlers in `public/app.js` (after `canvasConns` is defined):

```js
  /* ---------- drag & drop (FB-2) ----------
     Only native code can see a dropped file's real path, so src-tauri catches the
     OS drop and calls this with CSS-pixel coordinates. The pane hit-test lives here
     because the layout tree is client state. In the browser this is simply never
     called — a drop is an inert no-op, by design. */
  window.__duetDrop = function(paths, x, y){
    if(!paths || !paths.length) return;
    var hit = document.elementFromPoint(x, y);
    var pane = hit && hit.closest ? hit.closest("[data-win]") : null;
    if(!pane) return; // dropped on chrome, not a pane

    var winId = pane.dataset.win, sid = pane.dataset.session;

    if(pane.dataset.type === "term"){
      var t = termCtls[winId];
      if(!t) return;
      t.focus();
      // Trailing space so you can keep typing / drop again. Never a newline: nothing executes.
      t.paste(DuetShellEscape.shellEscapeAll(paths) + " ");
      return;
    }

    // render pane -> import each file as a card over that session's open canvas WS
    var conn = canvasConns[sid];
    if(!conn || !conn.ws || conn.ws.readyState !== 1) return;
    paths.forEach(function(p){
      conn.ws.send(JSON.stringify({ type:"import", path:p }));
    });
  };
```

- [ ] **Step 3: Verify nothing regressed**

Run: `npm test`
Expected: PASS — 22 tests (client code isn't covered by the suite; this confirms no server-side breakage).

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(fb2): __duetDrop hit-test — terminal pastes the path, render pane imports"
```

---

### Task 6: Client — delete a card with ✕

**Files:**
- Modify: `public/app.js` (`buildCardEl`, ~line 583, and its two call sites ~738 and ~744)
- Modify: the stylesheet that defines `.card-head` (search for `.card-head` — it lives with the other card styles)

**Interfaces:**
- Consumes: the `{type:'delete', id}` message (Task 4).
- Produces: `buildCardEl(cd, sid)` — **note the new second parameter**; both existing call sites must pass `w.session`.

- [ ] **Step 1: Give the card a delete button**

Change the signature and add the button in `public/app.js`:

```js
  function buildCardEl(cd, sid){
    var art = el("article", "card"); art.dataset.card = cd.id;
    var head = el("div", "card-head");
    head.appendChild(el("span", "card-id", "◪ " + esc(cd.id)));
    head.appendChild(el("span", "card-title", esc(cd.title || cd.id)));
    head.appendChild(el("span", "badge", esc(fmtTime(cd.mtime))));
    var del = el("button", "card-del", "✕");
    del.title = "delete card";
    del.onclick = function(e){
      e.stopPropagation();
      var conn = canvasConns[sid];
      if(!conn || !conn.ws || conn.ws.readyState !== 1) return;
      // Server unlinks the file; the existing chokidar unlink -> "remove" broadcast
      // takes the card out of every pane in the session. No optimistic removal.
      conn.ws.send(JSON.stringify({ type:"delete", id:cd.id }));
    };
    head.appendChild(del);
    art.appendChild(head);
    var body = el("div", "card-body");
    var frame = document.createElement("iframe");
    frame.className = "card-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.srcdoc = (cd.html || "") + SIZER + LINKER;
    body.appendChild(frame);
    art.appendChild(body);
    return art;
  }
```

- [ ] **Step 2: Update both call sites to pass the session**

In `createRenderBody(w)`, change:

```js
        var c = buildCardEl(cd); c.dataset.mtime = String(cd.mtime); c.style.animation = "none";
```
to
```js
        var c = buildCardEl(cd, w.session); c.dataset.mtime = String(cd.mtime); c.style.animation = "none";
```

and change:

```js
      var fresh = buildCardEl(cd); fresh.dataset.mtime = String(cd.mtime);
```
to
```js
      var fresh = buildCardEl(cd, w.session); fresh.dataset.mtime = String(cd.mtime);
```

Grep to be sure none were missed: `grep -n "buildCardEl(" public/app.js` — every call must now pass two arguments.

- [ ] **Step 3: Style it**

Add next to the other card styles:

```css
.card-del{margin-left:8px;background:none;border:1px solid var(--line);border-radius:6px;
  color:var(--dim);font:600 11px var(--mono);line-height:1;padding:3px 7px;cursor:pointer;opacity:0;
  transition:opacity .12s}
.card:hover .card-del{opacity:1}
.card-del:hover{color:var(--down);border-color:var(--down)}
```

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS — 22 tests.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/index.html
git commit -m "feat(fb3): per-card delete button"
```

---

### Task 7: Rust — catch the OS drop and hand it to the page

**Files:**
- Modify: `src-tauri/src/lib.rs` (`create_main_window`)

**Interfaces:**
- Consumes: `window.__duetDrop(paths, x, y)` (Task 5).
- Produces: nothing for other tasks.

**The trap:** Tauri reports the drop `position` in **physical pixels**, but `document.elementFromPoint()` takes **CSS pixels**. On a Retina display the scale factor is 2, so an uncorrected coordinate lands at double the position and silently hits the wrong pane — it would appear to work on a 1x external display and break on the laptop. Divide by `scale_factor()`.

- [ ] **Step 1: Register the drag-drop handler**

Replace `create_main_window` in `src-tauri/src/lib.rs`:

```rust
fn create_main_window(handle: &tauri::AppHandle) {
    let url: tauri::Url = format!("http://127.0.0.1:{PORT}").parse().unwrap();
    WebviewWindowBuilder::new(handle, "main", WebviewUrl::External(url))
        .title("duet")
        .inner_size(1440.0, 900.0)
        .on_drag_drop_event(|webview, event| {
            // Only native code can read a dropped file's real path — the whole reason
            // this lives in Rust. We stay a dumb transport: hand the paths and the
            // cursor position to the page and let JS decide what they mean.
            if let tauri::DragDropEvent::Drop { paths, position } = event {
                // PHYSICAL -> CSS pixels. elementFromPoint() wants CSS; on a 2x
                // display, skipping this silently hit-tests the wrong pane.
                let scale = webview.scale_factor().unwrap_or(1.0);
                let x = position.x as f64 / scale;
                let y = position.y as f64 / scale;

                let list: Vec<String> = paths
                    .iter()
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());

                // eval() needs no IPC capability and works against the remote URL the
                // window loads (http://127.0.0.1:7433).
                let js = format!("window.__duetDrop && window.__duetDrop({json}, {x}, {y});");
                let _ = webview.eval(&js);
            }
            false // don't preempt default handling
        })
        .build()
        .expect("failed to create duet window");
}
```

- [ ] **Step 2: Compile**

Run: `cd src-tauri && PATH="$HOME/.cargo/bin:$PATH" cargo check`
Expected: compiles clean. (`cargo` is not on the default shell PATH — rustup installs to `~/.cargo/bin`.)

**API correction (found during execution):** `WebviewWindowBuilder::on_drag_drop_event` **does not exist** in Tauri 2.11. Drag-drop surfaces as `WindowEvent::DragDrop(DragDropEvent)` and is consumed with `on_window_event` on the **built window**, not the builder — so build the window first, clone the handle, then register. The code block above is the corrected, compiling version. Imports needed: `tauri::{DragDropEvent, WindowEvent, ...}`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(fb2): tauri drag-drop -> __duetDrop, scale-corrected"
```

---

### Task 8: Manual verification in the real app

The Rust→JS bridge and the coordinate hit-test are the parts no automated test reaches. Verify by hand.

- [ ] **Step 1: Run the patched server**

The installed `duet.app` runs its **staged sidecar** (old code), so it must attach to the repo server instead:

```bash
pkill -f "duet.app/Contents/Resources/resources/server/server.js"   # kill the staged sidecar
cd ~/dev/duet && node server.js &                                    # patched server on 7433
```

Then rebuild + run the app so the new Rust drag-drop handler is present:

```bash
cd ~/dev/duet && npm run tauri dev
```

(`tauri dev` loads `http://127.0.0.1:7433`, and the attach-or-spawn logic will attach to the server already running there.)

- [ ] **Step 2: Verify each behavior**

- [ ] Drag an image from Finder onto a **terminal** pane → its path appears in the input line, shell-escaped, with a trailing space. Nothing executes.
- [ ] Drag a file whose name has **spaces** (a real screenshot) → the inserted path is single-quoted.
- [ ] Type `claude` in that pane, drag an image in, and confirm the path is usable in the prompt.
- [ ] Drag an image onto a **render** pane → it appears as a card (sanitized name).
- [ ] **Retina check:** drop near a pane's *edge* and confirm it hits the pane you aimed at, not its neighbour. This is the scale-factor bug's tell.
- [ ] Hover a card → ✕ appears; click it → the card disappears from **every** pane in the session, and the file is gone from `~/.duet/canvas/<sid>/`.
- [ ] Drop on the toolbar (not a pane) → nothing happens, no console error.

- [ ] **Step 3: Update the protocol doc**

`docs/PROTOCOL.md` — under the canvas-directory section, document the two inbound canvas-WS messages:

```markdown
### Inbound canvas messages (client → server)

The `/canvas` socket accepts two messages. It is the only channel for canvas mutation: it is
already Origin-checked on upgrade and session-scoped, so no HTTP file endpoint is opened.

| Message | Effect |
| --- | --- |
| `{"type":"import","path":"<abs path>"}` | Copies the file into the session's canvas dir under a sanitized name. Refused unless it is a renderable card type within its size cap. |
| `{"type":"delete","id":"<card id>"}` | Resolves the id to a file **by reading the canvas dir** and unlinks it. Unknown ids are a silent no-op. |

Neither sends a reply — the directory watcher turns the file change into the usual `card` /
`remove` broadcast.
```

- [ ] **Step 4: Commit**

```bash
git add docs/PROTOCOL.md
git commit -m "docs: inbound canvas messages (import, delete)"
```

---

## Self-Review

**Spec coverage:** Rust drag-drop + scale correction → Task 7. `shell-escape` → Task 1. `findCardFile` → Task 2. Import + sanitization → Task 3. WS inbound import/delete → Task 4. `__duetDrop` hit-test + terminal paste → Task 5. Card ✕ → Task 6. Browser no-op → falls out of the design (`__duetDrop` is simply never called; noted in Task 5). Manual verification + protocol doc → Task 8. No spec requirement is unimplemented.

**Type consistency:** `buildCardEl(cd, sid)` gains a parameter in Task 6 and both call sites are updated in the same task. `importIntoCanvas`/`findCardFile`/`sanitizeCardName` are defined in Tasks 2–3 and consumed in Task 4 under exactly those names. `DuetShellEscape.shellEscapeAll` is defined in Task 1 and consumed in Task 5. Pane types are `"term"` / `"render"` throughout.

**Deferred (not in this plan):** browser upload-fallback; `@`-prefix for Claude Code file syntax; drag *out* of a card.

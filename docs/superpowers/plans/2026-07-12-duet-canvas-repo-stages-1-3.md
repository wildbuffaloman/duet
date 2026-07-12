# duet-canvas Canonical Artifacts — Repo Stages 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give duet the filesystem plumbing to render canonical vault files as cards through symlinks (no copies), and to keep those symlinks correct when the vault files move.

**Architecture:** Pure filesystem logic lives in a new testable module `lib/links.js` (mirrors how `lib/cards.js` isolates card-building from `server.js`). `bin/duet` becomes a thin subcommand dispatcher — its current launcher behavior is preserved as the no-argument default; `link`/`unlink`/`links`/`relink` route into `lib/links.js`. `lib/cards.js` gains a fail-closed `$HOME` symlink guard so a card that is a symlink only renders when its real target lives under `$HOME`. `server.js` runs a bounded self-heal at startup.

**Tech Stack:** Node.js (built-ins only: `fs`, `path`, `os`, `child_process`), `node:test` test runner. Zero new dependencies.

## Global Constraints

*(Copied from the spec `docs/superpowers/specs/2026-07-12-duet-canvas-canonical-artifacts-design.md`. Every task implicitly includes these.)*

- **Zero new dependencies.** Only Node built-ins and the existing `node:test` harness. `npm test` runs `node --test test/*.test.js` (the directory form `node --test test/` silently fails in this repo — always glob `test/*.test.js`).
- **No copies, ever.** `$DUET_CANVAS` holds symlinks (views); the vault holds the one canonical file. `duet link` only ever *creates* symlinks; `duet unlink`/`relink` never delete or edit canonical vault content.
- **`$HOME` symlink fence is fail-closed.** A card that is a symlink renders only if its real target resolves under `$HOME`. A target escaping `$HOME` renders a small inline **"blocked: link escapes home"** card — *never* the file's contents. A broken symlink (missing target) yields no card.
- **Card-safe names.** Symlink basenames must match `[A-Za-z0-9._-]+\.(html|png|jpg|jpeg|gif|webp|svg)` — reuse `lib/cards.js` `sanitizeCardName` (spaces/em-dashes → `-`, keep extension). Never reject a name; coerce it.
- **Marker-token contract (defines what stage-4 stamps).** The reverse index is a line `duet_symlink: <path>` on its **own line** in the artifact file (YAML frontmatter in `.md`, or inside a block comment in `.html`). `<path>` is the stable canvas-side symlink path and MAY use a leading `~`. `relink` normalizes `~`→`$HOME` before comparing. Stage 4 (the skill, a later plan) MUST stamp exactly this token form.
- **127.0.0.1-only app.** The guard is defense-in-depth, not a trust boundary; keep it cheap.
- **Never commit to `main`.** A git-safety hook blocks it. This work lands on branch `duet-canvas-canonical` (already checked out).

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `lib/links.js` | Pure filesystem link logic: card-safe naming, create/remove/list symlinks, read the `duet_symlink` marker, reconcile/self-heal (`relink`). No env, no `os.homedir()` assumptions except `expandTilde`. All entry points take explicit directory paths so tests are hermetic. | **Create** (Tasks 1, 4) |
| `bin/duet` | Thin CLI dispatcher. No-arg / `up` / `start` → existing launcher. `link`/`unlink`/`links`/`relink` → `lib/links.js`, resolving `$DUET_SESSION` and `~/.duet/canvas` / vault roots. | **Modify** (Tasks 2, 5) |
| `lib/cards.js` | Add the fail-closed `$HOME` symlink guard to `buildCard`; thread an optional `homeRoot` through `buildCard`/`snapshotCards` for hermetic testing. | **Modify** (Task 3) |
| `server.js` | Run a bounded `relink` self-heal once at startup (after `listen`, via `setImmediate`, best-effort). | **Modify** (Task 5) |
| `test/links.test.js` | Unit tests for `lib/links.js`. | **Create** (Tasks 1, 4) |
| `test/duet-cli.test.js` | Smoke tests for `bin/duet` subcommands (child process, `HOME` overridden to a temp dir). | **Create** (Tasks 2, 5) |
| `test/cards.test.js` | Extend existing suite with the `$HOME` guard tests. | **Modify** (Task 3) |

**Context the implementer must not "fix":** the server's chokidar dir-guard at `server.js:217` (`path.dirname(path.resolve(filePath)) !== path.resolve(canvasDir)`) already passes for a symlink placed *inside* the canvas dir — the reported path is the symlink's own location, whose dirname is the canvas dir. Symlink read-through and hot-reload already work (proven in the spec). Leave that line alone.

---

### Task 1: `lib/links.js` — link / unlink / list primitives

**Files:**
- Create: `lib/links.js`
- Test: `test/links.test.js`

**Interfaces:**
- Consumes: `lib/cards.js` → `sanitizeCardName(base) → string`, `isCardFile(name) → bool`.
- Produces:
  - `cardSafeLinkName(vaultFile, asName?) → string` — the card-safe symlink basename.
  - `linkInto(sessionDir, vaultFile, opts={as?}) → {name, symlinkPath, created}` — creates (or idempotently finds) a symlink `sessionDir/<name> → resolve(vaultFile)`. Throws if `vaultFile` does not exist.
  - `unlinkCard(sessionDir, name) → boolean` — removes the symlink named `name`; refuses (returns `false`) if it is a real file or absent.
  - `listLinks(sessionDir) → Array<{name, target, status}>` where `status ∈ 'ok' | 'broken' | 'file'`.

- [ ] **Step 1: Write the failing tests for `cardSafeLinkName`**

Create `test/links.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const links = require('../lib/links');

function tmp() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-links-')));
}

test('cardSafeLinkName coerces spaces and em-dashes, keeps extension', () => {
  assert.strictEqual(
    links.cardSafeLinkName('/v/Heros Quest — UX Flow Map.html'),
    'Heros-Quest-UX-Flow-Map.html'
  );
});

test('cardSafeLinkName honors --as, appending the source extension when absent', () => {
  assert.strictEqual(links.cardSafeLinkName('/v/Long Name.html', 'flow'), 'flow.html');
  assert.strictEqual(links.cardSafeLinkName('/v/Long Name.html', 'flow.html'), 'flow.html');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/links.test.js`
Expected: FAIL — `Cannot find module '../lib/links'`.

- [ ] **Step 3: Create `lib/links.js` with the naming helper**

Create `lib/links.js`:

```js
'use strict';

// Canonical-artifact linking: the vault holds the one true file; a session's
// canvas dir holds symlinks (views) into it. Pure filesystem — every entry point
// takes explicit directory paths so it is testable without touching ~/.duet.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeCardName } = require('./cards');

function suffixName(name, n) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  return `${stem}-${n}${ext}`;
}

// The symlink's card-safe basename. --as may omit an extension; borrow the
// source file's so the card type is preserved.
function cardSafeLinkName(vaultFile, asName) {
  const raw = asName || path.basename(vaultFile);
  const withExt = path.extname(raw) ? raw : raw + path.extname(vaultFile);
  return sanitizeCardName(withExt);
}

module.exports = { cardSafeLinkName };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/links.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing tests for `linkInto`**

Append to `test/links.test.js`:

```js
test('linkInto creates a symlink into the session dir pointing at the resolved target', () => {
  const root = tmp();
  const vault = path.join(root, 'note.html');
  fs.writeFileSync(vault, '<title>x</title>');
  const sessionDir = path.join(root, 'canvas', 's1');

  const r = links.linkInto(sessionDir, vault);

  assert.strictEqual(r.name, 'note.html');
  assert.strictEqual(r.created, true);
  assert.strictEqual(fs.lstatSync(r.symlinkPath).isSymbolicLink(), true);
  assert.strictEqual(fs.realpathSync(r.symlinkPath), vault);
});

test('linkInto is idempotent — re-linking the same target is a no-op, created=false', () => {
  const root = tmp();
  const vault = path.join(root, 'note.html');
  fs.writeFileSync(vault, 'x');
  const sessionDir = path.join(root, 's');

  const a = links.linkInto(sessionDir, vault);
  const b = links.linkInto(sessionDir, vault);

  assert.strictEqual(b.name, a.name);
  assert.strictEqual(b.created, false);
});

test('linkInto suffixes -2 when the name is taken by a different target', () => {
  const root = tmp();
  const one = path.join(root, 'a', 'note.html');
  const two = path.join(root, 'b', 'note.html');
  fs.mkdirSync(path.dirname(one), { recursive: true });
  fs.mkdirSync(path.dirname(two), { recursive: true });
  fs.writeFileSync(one, '1');
  fs.writeFileSync(two, '2');
  const sessionDir = path.join(root, 's');

  const a = links.linkInto(sessionDir, one);
  const b = links.linkInto(sessionDir, two);

  assert.strictEqual(a.name, 'note.html');
  assert.strictEqual(b.name, 'note-2.html');
  assert.strictEqual(fs.realpathSync(b.symlinkPath), two);
});

test('linkInto throws when the target does not exist', () => {
  const root = tmp();
  assert.throws(() => links.linkInto(path.join(root, 's'), path.join(root, 'nope.html')));
});
```

- [ ] **Step 6: Run to verify the new tests fail**

Run: `node --test test/links.test.js`
Expected: FAIL — `links.linkInto is not a function`.

- [ ] **Step 7: Implement `linkInto`**

In `lib/links.js`, add before `module.exports`:

```js
function linkInto(sessionDir, vaultFile, opts = {}) {
  const target = path.resolve(vaultFile);
  if (!fs.existsSync(target)) {
    throw new Error(`duet link: target does not exist: ${vaultFile}`);
  }
  fs.mkdirSync(sessionDir, { recursive: true });

  const base = cardSafeLinkName(vaultFile, opts.as);
  let name = base;
  let n = 1;
  while (true) {
    const p = path.join(sessionDir, name);
    let lst = null;
    try { lst = fs.lstatSync(p); } catch (e) { lst = null; }
    if (lst === null) {                       // free slot
      fs.symlinkSync(target, p);
      return { name, symlinkPath: p, created: true };
    }
    if (lst.isSymbolicLink()) {               // already ours?
      let real = null;
      try { real = fs.realpathSync(p); } catch (e) { /* dangling */ }
      if (real === target) return { name, symlinkPath: p, created: false };
    }
    n += 1;
    name = suffixName(base, n);               // note-2, note-3, ...
  }
}
```

Update `module.exports` to `{ cardSafeLinkName, linkInto }`.

- [ ] **Step 8: Run to verify all `linkInto` tests pass**

Run: `node --test test/links.test.js`
Expected: PASS (6 tests).

- [ ] **Step 9: Write the failing tests for `unlinkCard` and `listLinks`**

Append to `test/links.test.js`:

```js
test('unlinkCard removes a symlink and returns true', () => {
  const root = tmp();
  const vault = path.join(root, 'n.html');
  fs.writeFileSync(vault, 'x');
  const sessionDir = path.join(root, 's');
  const { name, symlinkPath } = links.linkInto(sessionDir, vault);

  assert.strictEqual(links.unlinkCard(sessionDir, name), true);
  assert.strictEqual(fs.existsSync(symlinkPath), false);
  assert.strictEqual(fs.existsSync(vault), true); // canonical file untouched
});

test('unlinkCard refuses to delete a real (non-symlink) file', () => {
  const root = tmp();
  const sessionDir = path.join(root, 's');
  fs.mkdirSync(sessionDir, { recursive: true });
  const real = path.join(sessionDir, 'real.html');
  fs.writeFileSync(real, 'content');

  assert.strictEqual(links.unlinkCard(sessionDir, 'real.html'), false);
  assert.strictEqual(fs.existsSync(real), true);
});

test('listLinks reports ok / broken / file statuses', () => {
  const root = tmp();
  const vault = path.join(root, 'ok.html');
  fs.writeFileSync(vault, 'x');
  const sessionDir = path.join(root, 's');
  links.linkInto(sessionDir, vault);                       // ok
  fs.symlinkSync(path.join(root, 'gone.html'), path.join(sessionDir, 'broken.html')); // broken
  fs.writeFileSync(path.join(sessionDir, 'plain.html'), 'y');                          // file

  const byName = Object.fromEntries(links.listLinks(sessionDir).map((r) => [r.name, r.status]));
  assert.strictEqual(byName['ok.html'], 'ok');
  assert.strictEqual(byName['broken.html'], 'broken');
  assert.strictEqual(byName['plain.html'], 'file');
});
```

- [ ] **Step 10: Run to verify they fail**

Run: `node --test test/links.test.js`
Expected: FAIL — `links.unlinkCard is not a function`.

- [ ] **Step 11: Implement `unlinkCard` and `listLinks`**

In `lib/links.js`, add before `module.exports`:

```js
const { isCardFile } = require('./cards');

function unlinkCard(sessionDir, name) {
  const p = path.join(sessionDir, name);
  let lst = null;
  try { lst = fs.lstatSync(p); } catch (e) { return false; }
  if (!lst.isSymbolicLink()) return false;   // never delete canonical content
  try { fs.unlinkSync(p); return true; } catch (e) { return false; }
}

function listLinks(sessionDir) {
  let names;
  try { names = fs.readdirSync(sessionDir); } catch (e) { return []; }
  const out = [];
  for (const name of names) {
    if (!isCardFile(name)) continue;
    const p = path.join(sessionDir, name);
    let lst = null;
    try { lst = fs.lstatSync(p); } catch (e) { continue; }
    if (!lst.isSymbolicLink()) { out.push({ name, target: null, status: 'file' }); continue; }
    const target = fs.readlinkSync(p);
    out.push({ name, target, status: fs.existsSync(p) ? 'ok' : 'broken' });
  }
  return out;
}
```

Move the `require('./cards')` destructure to a single line at the top of the file so `sanitizeCardName` and `isCardFile` come from one `require`:

```js
const { sanitizeCardName, isCardFile } = require('./cards');
```

(Delete the second `const { isCardFile } = require('./cards');` you just added — keep one destructure at the top.)

Update `module.exports` to `{ cardSafeLinkName, linkInto, unlinkCard, listLinks }`.

- [ ] **Step 12: Run the full links suite**

Run: `node --test test/links.test.js`
Expected: PASS (9 tests).

- [ ] **Step 13: Commit**

```bash
git add lib/links.js test/links.test.js
git commit -m "feat(links): duet link/unlink/list primitives (lib/links.js)"
```

---

### Task 2: `bin/duet` — subcommand dispatcher for link / unlink / links

**Files:**
- Modify: `bin/duet` (whole file — refactor launcher into a function, add dispatch)
- Test: `test/duet-cli.test.js`

**Interfaces:**
- Consumes: `lib/links.js` → `linkInto`, `unlinkCard`, `listLinks`.
- Produces: CLI contract — `duet` / `duet up` / `duet start` launch; `duet link <file> [--session sid] [--as name]`; `duet unlink <name> [--session sid]`; `duet links [--session sid]`. Session resolves from `--session` then `$DUET_SESSION`. Canvas root is `~/.duet/canvas` (from `os.homedir()`, so tests override `HOME`).

- [ ] **Step 1: Write the failing CLI smoke tests**

Create `test/duet-cli.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const BIN = path.resolve(__dirname, '..', 'bin', 'duet');

function tmpHome() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-home-')));
}
function run(home, args) {
  return execFileSync('node', [BIN, ...args], {
    env: { ...process.env, HOME: home, DUET_SESSION: '' },
    encoding: 'utf8',
  });
}

test('duet link creates a symlink under ~/.duet/canvas/<sid>', () => {
  const home = tmpHome();
  const vault = path.join(home, 'Documents', 'note.html');
  fs.mkdirSync(path.dirname(vault), { recursive: true });
  fs.writeFileSync(vault, '<title>x</title>');

  const out = run(home, ['link', vault, '--session', 's1']);

  const link = path.join(home, '.duet', 'canvas', 's1', 'note.html');
  assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true);
  assert.match(out, /note\.html/);
});

test('duet links lists the session symlinks', () => {
  const home = tmpHome();
  const vault = path.join(home, 'note.html');
  fs.writeFileSync(vault, 'x');
  run(home, ['link', vault, '--session', 's1']);

  const out = run(home, ['links', '--session', 's1']);
  assert.match(out, /note\.html/);
  assert.match(out, /ok/);
});

test('duet unlink removes the symlink but not the vault file', () => {
  const home = tmpHome();
  const vault = path.join(home, 'note.html');
  fs.writeFileSync(vault, 'x');
  run(home, ['link', vault, '--session', 's1']);

  run(home, ['unlink', 'note.html', '--session', 's1']);

  assert.strictEqual(fs.existsSync(path.join(home, '.duet', 'canvas', 's1', 'note.html')), false);
  assert.strictEqual(fs.existsSync(vault), true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/duet-cli.test.js`
Expected: FAIL — the current `bin/duet` ignores args and spawns the server (the child process hangs or errors, not the asserted symlink behavior).

- [ ] **Step 3: Refactor `bin/duet` into a dispatcher**

Replace the entire contents of `bin/duet` with:

```js
#!/usr/bin/env node
'use strict';

// duet CLI. No-arg (or `up`/`start`) launches the server + browser. The link
// subcommands manage canonical-artifact symlinks in ~/.duet/canvas/<session>/.

const path = require('path');
const os = require('os');
const http = require('http');
const { spawn, execFile } = require('child_process');
const linksLib = require('../lib/links');

const ROOT = path.resolve(__dirname, '..');
const CANVAS_ROOT = path.join(os.homedir(), '.duet', 'canvas');

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
function resolveSession(args) {
  const sid = flag(args, '--session') || process.env.DUET_SESSION;
  if (!sid) {
    console.error('duet: no session — pass --session <sid> or set $DUET_SESSION');
    process.exit(1);
  }
  return sid;
}
function positional(args) {
  return args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
}

function cmdLink(args) {
  const [file] = positional(args);
  if (!file) { console.error('usage: duet link <vault-file> [--session sid] [--as name]'); process.exit(1); }
  const sid = resolveSession(args);
  const sessionDir = path.join(CANVAS_ROOT, sid);
  const r = linksLib.linkInto(sessionDir, file, { as: flag(args, '--as') || undefined });
  console.log(r.symlinkPath);
}

function cmdUnlink(args) {
  const [name] = positional(args);
  if (!name) { console.error('usage: duet unlink <name> [--session sid]'); process.exit(1); }
  const sid = resolveSession(args);
  const ok = linksLib.unlinkCard(path.join(CANVAS_ROOT, sid), name);
  if (!ok) { console.error(`duet: no symlink named ${name} in session ${sid}`); process.exit(1); }
  console.log(`unlinked ${name}`);
}

function cmdLinks(args) {
  const sid = resolveSession(args);
  const rows = linksLib.listLinks(path.join(CANVAS_ROOT, sid));
  if (rows.length === 0) { console.log('(no links)'); return; }
  for (const r of rows) console.log(`${r.status.padEnd(6)} ${r.name}  ->  ${r.target || '(file)'}`);
}

function launch() {
  const PORT = parseInt(process.env.DUET_PORT, 10) || 7433;
  const URL_BASE = `http://127.0.0.1:${PORT}`;
  const server = spawn('node', [path.join(ROOT, 'server.js')], { cwd: ROOT, stdio: 'inherit' });
  server.on('exit', (code) => process.exit(code == null ? 1 : code));

  const DEADLINE = Date.now() + 5000;
  function pollHealth() {
    const req = http.get(`${URL_BASE}/health`, { timeout: 500 }, (res) => {
      res.resume();
      if (res.statusCode === 200) { execFile('open', [URL_BASE]); return; }
      retry();
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', retry);
  }
  function retry() {
    if (Date.now() > DEADLINE) {
      console.error(`duet: server did not become healthy at ${URL_BASE}/health within 5s`);
      server.kill();
      process.exit(1);
    }
    setTimeout(pollHealth, 100);
  }
  pollHealth();
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case 'up':
    case 'start': return launch();
    case 'link': return cmdLink(rest);
    case 'unlink': return cmdUnlink(rest);
    case 'links': return cmdLinks(rest);
    default:
      console.error(`duet: unknown command '${cmd}'. Commands: link, unlink, links, (up)`);
      process.exit(1);
  }
}

main();
```

Note on `positional`: it drops any token that is itself a `--flag` or immediately follows one (a flag value), leaving true positionals. `duet link /a/b.html --session s1 --as x` → positional is `['/a/b.html']`.

- [ ] **Step 4: Run the CLI smoke tests**

Run: `node --test test/duet-cli.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Manually confirm the launcher still works from the repo**

Run: `node bin/duet up` — expect it to start the server (`duet listening on http://127.0.0.1:7433`) or fail with the "port already in use" message (a dev server is already running on 7433). Either output proves the launcher path is intact. Press Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add bin/duet test/duet-cli.test.js
git commit -m "feat(cli): duet subcommand dispatcher (link/unlink/links + preserved launcher)"
```

---

### Task 3: `lib/cards.js` — fail-closed `$HOME` symlink guard

**Files:**
- Modify: `lib/cards.js` (add `os` require; add `isPathUnderHome`, `blockedCard`, `blockedDocument`; guard inside `buildCard`; thread `opts.homeRoot` through `buildCard`/`snapshotCards`)
- Test: `test/cards.test.js` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `isPathUnderHome(realPath, homeRoot) → boolean`.
  - `buildCard(canvasDir, filename, opts={homeRoot?})` — unchanged for plain files; for symlinks, requires the real target under `homeRoot` (default `os.homedir()`), else returns a **blocked** card `{id, title, mtime, html}`; broken symlink → `null`.
  - `snapshotCards(canvasDir, opts={homeRoot?})` — forwards `opts` to `buildCard`.

- [ ] **Step 1: Write the failing test for `isPathUnderHome`**

Append to `test/cards.test.js`:

```js
test('isPathUnderHome accepts paths under home, rejects escapes', () => {
  assert.strictEqual(cards.isPathUnderHome('/Users/x/Documents/a.html', '/Users/x'), true);
  assert.strictEqual(cards.isPathUnderHome('/Users/x', '/Users/x'), true);
  assert.strictEqual(cards.isPathUnderHome('/etc/passwd', '/Users/x'), false);
  assert.strictEqual(cards.isPathUnderHome('/Users/xevil/a', '/Users/x'), false); // prefix, not child
});
```

*(If `test/cards.test.js` does not already `require` the module as `cards`, check its top — the existing suite imports `lib/cards.js`. Use the same binding name it already uses; this plan assumes `const cards = require('../lib/cards');`.)*

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/cards.test.js`
Expected: FAIL — `cards.isPathUnderHome is not a function`.

- [ ] **Step 3: Implement `isPathUnderHome` and the blocked-card helpers**

In `lib/cards.js`, add `os` to the requires at the top:

```js
const os = require('os');
```

Add these functions (place them near `imageDocument`):

```js
function isPathUnderHome(realPath, homeRoot) {
  const rp = path.resolve(realPath);
  const hr = path.resolve(homeRoot);
  return rp === hr || rp.startsWith(hr + path.sep);
}

// A symlink whose real target escapes $HOME renders THIS, never the file's bytes.
function blockedDocument(id) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>blocked: ${id}</title>` +
    '<style>html,body{margin:0;height:100%;background:#1a0e0e;color:#f5b5b5;' +
    'font:14px/1.5 -apple-system,system-ui,sans-serif}' +
    'body{display:flex;align-items:center;justify-content:center;text-align:center;padding:1rem}</style>' +
    `</head><body><div>⛔ blocked: link escapes home<br><small>${id}</small></div></body></html>`
  );
}

function blockedCard(filename, mtimeMs) {
  const id = cardIdFor(filename);
  return { id, title: id, mtime: mtimeMs, html: blockedDocument(id) };
}
```

*(The `id` is derived from a name matching `[A-Za-z0-9._-]` — no HTML-special characters can reach `blockedDocument`, same guarantee `imageDocument` relies on.)*

- [ ] **Step 4: Run to verify the `isPathUnderHome` test passes**

Run: `node --test test/cards.test.js`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Write the failing tests for the `buildCard` symlink guard**

Append to `test/cards.test.js`:

```js
const os = require('os');

function tmpHomeDirs() {
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

  const card = cards.buildCard(canvasDir, 'real.html', { homeRoot: home });
  assert.strictEqual(card.title, 'Real');
  assert.match(card.html, /<h1>Real<\/h1>/);
});

test('buildCard blocks a symlink whose target escapes home — never leaks contents', () => {
  const { home, canvasDir } = tmpHomeDirs();
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-outside-')));
  const secret = path.join(outside, 'secret.html');
  fs.writeFileSync(secret, '<title>SECRET</title>TOP-SECRET-BODY');
  fs.symlinkSync(secret, path.join(canvasDir, 'secret.html'));

  const card = cards.buildCard(canvasDir, 'secret.html', { homeRoot: home });
  assert.strictEqual(card.id, 'secret');
  assert.match(card.html, /blocked: link escapes home/);
  assert.doesNotMatch(card.html, /TOP-SECRET-BODY/);
});

test('buildCard returns null for a broken symlink', () => {
  const { home, canvasDir } = tmpHomeDirs();
  fs.symlinkSync(path.join(home, 'gone.html'), path.join(canvasDir, 'dangling.html'));
  assert.strictEqual(cards.buildCard(canvasDir, 'dangling.html', { homeRoot: home }), null);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `node --test test/cards.test.js`
Expected: FAIL — the blocked case returns the file contents (guard not yet wired) or the allowed/broken cases behave wrongly.

- [ ] **Step 7: Wire the guard into `buildCard`**

Replace the body of `buildCard` in `lib/cards.js` with:

```js
function buildCard(canvasDir, filename, opts = {}) {
  // SECURITY: only plain filenames directly inside canvasDir.
  if (!isCardFile(filename)) return null;
  const full = path.join(canvasDir, filename);

  // A card file may be a symlink into the vault (canonical-artifact model).
  // Fail-closed: require its real target under $HOME; escapes render a blocked
  // card (never the bytes); a broken link yields no card.
  let lst;
  try { lst = fs.lstatSync(full); } catch (e) { return null; }
  if (lst.isSymbolicLink()) {
    let real;
    try { real = fs.realpathSync(full); } catch (e) { return null; } // broken → no card
    const homeRoot = opts.homeRoot || os.homedir();
    if (!isPathUnderHome(real, homeRoot)) return blockedCard(filename, lst.mtimeMs);
  }

  let stat;
  try {
    stat = fs.statSync(full);       // follows the link → target's stat
    if (!stat.isFile()) return null;
  } catch (e) {
    return null;
  }
  return isImageFile(filename)
    ? buildImageCard(full, filename, stat)
    : buildHtmlCard(full, filename, stat);
}
```

- [ ] **Step 8: Thread `opts` through `snapshotCards`**

Replace the `snapshotCards` signature line and its `buildCard` call:

```js
function snapshotCards(canvasDir, opts = {}) {
  let names;
  try { names = fs.readdirSync(canvasDir); } catch (e) { return []; }
  const cards = [];
  for (const name of names) {
    if (!isCardFile(name)) continue;
    const card = buildCard(canvasDir, name, opts);
    if (card) cards.push(card);
  }
  cards.sort((a, b) => a.mtime - b.mtime);
  return cards;
}
```

- [ ] **Step 9: Export `isPathUnderHome`**

Add `isPathUnderHome` to the `module.exports` object in `lib/cards.js`.

- [ ] **Step 10: Run the full cards suite**

Run: `node --test test/cards.test.js`
Expected: PASS — all existing tests plus the four new ones. (Existing plain-file cards behave identically: a non-symlink `lstatSync` skips the guard.)

- [ ] **Step 11: Commit**

```bash
git add lib/cards.js test/cards.test.js
git commit -m "feat(cards): fail-closed \$HOME symlink guard for card rendering"
```

---

### Task 4: `lib/links.js` — reverse-lookup + reconcile (`relink`)

**Files:**
- Modify: `lib/links.js` (add marker reader + reconcile functions)
- Test: `test/links.test.js` (extend)

**Interfaces:**
- Consumes: `lib/links.js` own helpers from Task 1.
- Produces:
  - `expandTilde(p) → string` — leading `~` → `os.homedir()`.
  - `readDuetSymlink(file) → string | null` — the absolute, tilde-expanded `duet_symlink` value found in `file`, or `null`.
  - `scanArtifacts(roots) → Map<symlinkPath, artifactFile>` — walks `roots` for `.md`/`.html` files carrying the marker.
  - `relinkArtifact(artifactPath) → {symlinkPath, target} | null` — re-points the artifact's declared symlink at the artifact's current location (single-file form for movers).
  - `relink(canvasRoot, roots, opts={recreate?}) → {repaired, recreated, stillBroken, orphans}` — reconcile. **Cheap-exits without scanning `roots` when there are no broken links and `recreate` is false.**

- [ ] **Step 1: Write the failing tests for `readDuetSymlink` / `expandTilde`**

Append to `test/links.test.js`:

```js
test('expandTilde expands a leading ~ to the home dir', () => {
  assert.strictEqual(links.expandTilde('~/.duet/canvas/s1/a.html'),
    path.join(os.homedir(), '.duet/canvas/s1/a.html'));
  assert.strictEqual(links.expandTilde('/abs/path'), '/abs/path');
});

test('readDuetSymlink extracts a YAML-style marker and normalizes ~', () => {
  const root = tmp();
  const f = path.join(root, 'note.md');
  fs.writeFileSync(f, '---\nproject: "[[X]]"\nduet_symlink: ~/.duet/canvas/s1/note.html\n---\nbody');
  assert.strictEqual(links.readDuetSymlink(f), path.join(os.homedir(), '.duet/canvas/s1/note.html'));
});

test('readDuetSymlink tolerates an HTML block-comment marker with a trailing -->', () => {
  const root = tmp();
  const f = path.join(root, 'note.html');
  fs.writeFileSync(f, '<!--\nduet_symlink: /abs/s1/note.html\n-->\n<h1>x</h1>');
  assert.strictEqual(links.readDuetSymlink(f), '/abs/s1/note.html');
});

test('readDuetSymlink returns null when no marker is present', () => {
  const root = tmp();
  const f = path.join(root, 'plain.md');
  fs.writeFileSync(f, '# just a note');
  assert.strictEqual(links.readDuetSymlink(f), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/links.test.js`
Expected: FAIL — `links.expandTilde is not a function`.

- [ ] **Step 3: Implement `expandTilde` and `readDuetSymlink`**

In `lib/links.js`, add before `module.exports`:

```js
function expandTilde(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

// The marker is a line `duet_symlink: <path>` (YAML in .md, or inside a block
// comment in .html). Capture the value, drop a trailing block-comment close,
// tilde-expand, and resolve to absolute. Zero-dependency — no YAML parser.
function readDuetSymlink(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const m = text.match(/^\s*duet_symlink:\s*["']?(.+?)["']?\s*$/m);
  if (!m) return null;
  let v = m[1].trim().replace(/\s*-->\s*$/, '').trim();
  if (!v) return null;
  return path.resolve(expandTilde(v));
}
```

Update `module.exports` to include `expandTilde, readDuetSymlink`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/links.test.js`
Expected: PASS (13 tests total).

- [ ] **Step 5: Write the failing tests for `scanArtifacts` and `relinkArtifact`**

Append to `test/links.test.js`:

```js
test('scanArtifacts maps declared symlink paths to their artifact files', () => {
  const root = tmp();
  const a = path.join(root, 'proj', 'a.md');
  fs.mkdirSync(path.dirname(a), { recursive: true });
  fs.writeFileSync(a, 'duet_symlink: /c/s1/a.html\n');
  fs.writeFileSync(path.join(root, 'proj', 'plain.md'), 'no marker');

  const map = links.scanArtifacts([root]);
  assert.strictEqual(map.get('/c/s1/a.html'), a);
  assert.strictEqual(map.size, 1);
});

test('relinkArtifact re-points the declared symlink at the artifact', () => {
  const root = tmp();
  const canvas = path.join(root, 'c', 's1');
  const sym = path.join(canvas, 'a.html');
  const artifact = path.join(root, 'moved', 'a.md');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, `duet_symlink: ${sym}\n`);

  const r = links.relinkArtifact(artifact);
  assert.strictEqual(r.symlinkPath, sym);
  assert.strictEqual(fs.realpathSync(sym), artifact);
});

test('relinkArtifact returns null when the file has no marker', () => {
  const root = tmp();
  const f = path.join(root, 'x.md');
  fs.writeFileSync(f, 'nothing');
  assert.strictEqual(links.relinkArtifact(f), null);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `node --test test/links.test.js`
Expected: FAIL — `links.scanArtifacts is not a function`.

- [ ] **Step 7: Implement `scanArtifacts` and `relinkArtifact`**

In `lib/links.js`, add before `module.exports`:

```js
const ARTIFACT_EXT = new Set(['.md', '.html']);

function walkFiles(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      walkFiles(path.join(dir, ent.name), out);
    } else if (ent.isFile() && ARTIFACT_EXT.has(path.extname(ent.name).toLowerCase())) {
      out.push(path.join(dir, ent.name));
    }
  }
}

function scanArtifacts(roots) {
  const map = new Map();
  for (const root of roots) {
    const files = [];
    walkFiles(root, files);
    for (const f of files) {
      const sym = readDuetSymlink(f);
      if (sym) map.set(sym, f);
    }
  }
  return map;
}

function pathPresent(p) {
  try { fs.lstatSync(p); return true; } catch (e) { return false; }
}

function relinkArtifact(artifactPath) {
  const sym = readDuetSymlink(artifactPath);
  if (!sym) return null;
  const target = path.resolve(artifactPath);
  let lst = null;
  try { lst = fs.lstatSync(sym); } catch (e) { /* absent */ }
  if (lst && !lst.isSymbolicLink()) {
    throw new Error(`duet relink: refusing to overwrite non-symlink at ${sym}`);
  }
  fs.mkdirSync(path.dirname(sym), { recursive: true });
  if (lst) fs.rmSync(sym, { force: true });
  fs.symlinkSync(target, sym);
  return { symlinkPath: sym, target };
}
```

Update `module.exports` to include `scanArtifacts, relinkArtifact`.

- [ ] **Step 8: Run to verify they pass**

Run: `node --test test/links.test.js`
Expected: PASS (16 tests total).

- [ ] **Step 9: Write the failing tests for `relink`**

Append to `test/links.test.js`:

```js
test('relink repairs a broken symlink via reverse lookup', () => {
  const root = tmp();
  const canvasRoot = path.join(root, 'c');
  const sessionDir = path.join(canvasRoot, 's1');
  const sym = path.join(sessionDir, 'a.html');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.symlinkSync(path.join(root, 'old', 'a.md'), sym);       // now broken (old path gone)
  const moved = path.join(root, 'new', 'a.md');
  fs.mkdirSync(path.dirname(moved), { recursive: true });
  fs.writeFileSync(moved, `duet_symlink: ${sym}\n`);

  const report = links.relink(canvasRoot, [root]);
  assert.strictEqual(report.repaired.length, 1);
  assert.strictEqual(fs.realpathSync(sym), moved);
  assert.strictEqual(report.stillBroken.length, 0);
});

test('relink reports stillBroken when no artifact claims the link', () => {
  const root = tmp();
  const canvasRoot = path.join(root, 'c');
  const sessionDir = path.join(canvasRoot, 's1');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.symlinkSync(path.join(root, 'gone.md'), path.join(sessionDir, 'orphan.html'));

  const report = links.relink(canvasRoot, [root]);
  assert.strictEqual(report.repaired.length, 0);
  assert.strictEqual(report.stillBroken.length, 1);
});

test('relink cheap-exits (no vault scan) when nothing is broken and recreate is off', () => {
  const root = tmp();
  const canvasRoot = path.join(root, 'c');
  const sessionDir = path.join(canvasRoot, 's1');
  const vault = path.join(root, 'a.html');
  fs.writeFileSync(vault, 'x');
  links.linkInto(sessionDir, vault);                          // healthy link

  const report = links.relink(canvasRoot, ['/nonexistent-root-that-would-error-if-scanned']);
  assert.deepStrictEqual(report, { repaired: [], recreated: [], stillBroken: [], orphans: [] });
});

test('relink with recreate:true rebuilds a missing symlink the artifact expects', () => {
  const root = tmp();
  const canvasRoot = path.join(root, 'c');
  const sym = path.join(canvasRoot, 's1', 'a.html');
  const artifact = path.join(root, 'proj', 'a.md');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, `duet_symlink: ${sym}\n`);        // symlink does not exist yet

  const report = links.relink(canvasRoot, [root], { recreate: true });
  assert.strictEqual(report.recreated.length, 1);
  assert.strictEqual(fs.realpathSync(sym), artifact);
});
```

- [ ] **Step 10: Run to verify they fail**

Run: `node --test test/links.test.js`
Expected: FAIL — `links.relink is not a function`.

- [ ] **Step 11: Implement `relink` (with `scanCanvasSymlinks`)**

In `lib/links.js`, add before `module.exports`:

```js
function scanCanvasSymlinks(canvasRoot) {
  const ok = [], broken = [];
  let sessions;
  try { sessions = fs.readdirSync(canvasRoot, { withFileTypes: true }); } catch (e) { return { ok, broken }; }
  for (const s of sessions) {
    if (!s.isDirectory()) continue;
    const sessionDir = path.join(canvasRoot, s.name);
    let names;
    try { names = fs.readdirSync(sessionDir); } catch (e) { continue; }
    for (const name of names) {
      if (!isCardFile(name)) continue;
      const p = path.join(sessionDir, name);
      let lst = null;
      try { lst = fs.lstatSync(p); } catch (e) { continue; }
      if (!lst.isSymbolicLink()) continue;
      const rec = { sessionDir, name, symlinkPath: p };
      (fs.existsSync(p) ? ok : broken).push(rec);   // existsSync follows the link
    }
  }
  return { ok, broken };
}

function relink(canvasRoot, roots, opts = {}) {
  const recreate = !!opts.recreate;
  const report = { repaired: [], recreated: [], stillBroken: [], orphans: [] };
  const { ok, broken } = scanCanvasSymlinks(canvasRoot);
  if (broken.length === 0 && !recreate) return report;   // cheap exit: no vault scan

  const artifactMap = scanArtifacts(roots);              // symlinkPath -> artifact
  for (const b of broken) {
    const artifact = artifactMap.get(b.symlinkPath);
    if (artifact) {
      fs.rmSync(b.symlinkPath, { force: true });
      fs.symlinkSync(path.resolve(artifact), b.symlinkPath);
      report.repaired.push({ symlinkPath: b.symlinkPath, target: path.resolve(artifact) });
    } else {
      report.stillBroken.push(b.symlinkPath);
    }
  }
  if (recreate) {
    for (const [sym, artifact] of artifactMap) {
      if (!pathPresent(sym)) {
        fs.mkdirSync(path.dirname(sym), { recursive: true });
        fs.symlinkSync(path.resolve(artifact), sym);
        report.recreated.push({ symlinkPath: sym, target: path.resolve(artifact) });
      }
    }
    const claimed = new Set(artifactMap.keys());
    for (const rec of ok.concat(broken)) {
      if (!claimed.has(rec.symlinkPath)) report.orphans.push(rec.symlinkPath);
    }
  }
  return report;
}
```

Update `module.exports` to include `relink` (final exports: `cardSafeLinkName, linkInto, unlinkCard, listLinks, expandTilde, readDuetSymlink, scanArtifacts, relinkArtifact, relink`).

- [ ] **Step 12: Run the full links suite**

Run: `node --test test/links.test.js`
Expected: PASS (20 tests total).

- [ ] **Step 13: Commit**

```bash
git add lib/links.js test/links.test.js
git commit -m "feat(links): relink reverse-lookup, reconcile, and self-heal core"
```

---

### Task 5: `bin/duet relink` subcommand + server startup self-heal

**Files:**
- Modify: `bin/duet` (add the `relink` case + vault-root resolution)
- Modify: `server.js` (add `VAULT_ROOT`; run `relink` self-heal after `listen`)
- Test: `test/duet-cli.test.js` (extend)

**Interfaces:**
- Consumes: `lib/links.js` → `relink`, `relinkArtifact`.
- Produces: CLI `duet relink [--artifact <path>]`. Default vault root is `~/Documents/Obsidian Vault`; overridable with `--vault <dir>` (tests use it). Server runs `relink(CANVAS_ROOT, [VAULT_ROOT], {recreate:false})` once at startup, best-effort, non-blocking.

- [ ] **Step 1: Write the failing CLI test for `relink --artifact`**

Append to `test/duet-cli.test.js`:

```js
test('duet relink --artifact re-points the declared symlink', () => {
  const home = tmpHome();
  const sym = path.join(home, '.duet', 'canvas', 's1', 'a.html');
  const artifact = path.join(home, 'proj', 'a.md');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  fs.writeFileSync(artifact, `duet_symlink: ${sym}\n`);

  run(home, ['relink', '--artifact', artifact]);

  assert.strictEqual(fs.realpathSync(sym), artifact);
});

test('duet relink (full) repairs a broken link found under --vault', () => {
  const home = tmpHome();
  const sessionDir = path.join(home, '.duet', 'canvas', 's1');
  const sym = path.join(sessionDir, 'a.html');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.symlinkSync(path.join(home, 'old', 'a.md'), sym);          // broken
  const vault = path.join(home, 'vault');
  const moved = path.join(vault, 'a.md');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(moved, `duet_symlink: ${sym}\n`);

  const out = run(home, ['relink', '--vault', vault]);

  assert.strictEqual(fs.realpathSync(sym), moved);
  assert.match(out, /repaired/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/duet-cli.test.js`
Expected: FAIL — `duet: unknown command 'relink'` (child exits non-zero).

- [ ] **Step 3: Add the `relink` case to `bin/duet`**

In `bin/duet`, add a vault-root default near `CANVAS_ROOT`:

```js
const VAULT_ROOT = path.join(os.homedir(), 'Documents', 'Obsidian Vault');
```

Add the command handler (before `function launch()`):

```js
function cmdRelink(args) {
  const artifact = flag(args, '--artifact');
  if (artifact) {
    const r = linksLib.relinkArtifact(artifact);
    console.log(r ? `re-pointed ${r.symlinkPath} -> ${r.target}` : 'no duet_symlink marker; nothing to do');
    return;
  }
  const vaultRoot = flag(args, '--vault') || VAULT_ROOT;
  const report = linksLib.relink(CANVAS_ROOT, [vaultRoot], { recreate: true });
  console.log(
    `relink: repaired ${report.repaired.length}, recreated ${report.recreated.length}, ` +
    `stillBroken ${report.stillBroken.length}, orphans ${report.orphans.length}`
  );
}
```

Add `case 'relink': return cmdRelink(rest);` to the `switch` in `main()`, and add `relink` to the unknown-command usage string.

- [ ] **Step 4: Run the CLI relink tests**

Run: `node --test test/duet-cli.test.js`
Expected: PASS (5 tests total).

- [ ] **Step 5: Wire the startup self-heal into `server.js`**

In `server.js`, near the existing `const CANVAS_ROOT = ...` (line ~27), add:

```js
const VAULT_ROOT = path.join(os.homedir(), 'Documents', 'Obsidian Vault');
```

Replace the `server.listen(...)` callback (lines ~368-370) with:

```js
server.listen(PORT, HOST, () => {
  console.log(`duet listening on http://${HOST}:${PORT}`);
  // Self-heal canvas symlinks left dangling by out-of-band vault moves.
  // Bounded: relink cheap-exits (no vault scan) unless a link is actually broken.
  // Deferred + best-effort so it never delays or breaks startup.
  setImmediate(() => {
    try {
      const { relink } = require('./lib/links');
      const r = relink(CANVAS_ROOT, [VAULT_ROOT], { recreate: false });
      if (r.repaired.length) console.log(`duet: relink repaired ${r.repaired.length} symlink(s)`);
    } catch (e) { /* self-heal is optional; ignore */ }
  });
});
```

- [ ] **Step 6: Verify the server still boots and self-heal doesn't throw**

Run: `DUET_PORT=7599 node server.js &` then, after ~1s, `curl -s http://127.0.0.1:7599/health` (expect `ok`/200), then `kill %1`.
Expected: `duet listening on http://127.0.0.1:7599`, health responds, no self-heal stack trace. (With an empty `~/.duet/canvas`, relink cheap-exits silently.)

- [ ] **Step 7: Run the entire test suite**

Run: `npm test`
Expected: PASS — all suites green (`cards`, `canvas-ws`, `shell-escape`, `links`, `duet-cli`).

- [ ] **Step 8: Commit**

```bash
git add bin/duet server.js test/duet-cli.test.js
git commit -m "feat(cli+server): duet relink subcommand and bounded startup self-heal"
```

---

## Self-Review

**1. Spec coverage:**
- Component 1 (`duet link`/`unlink`/`links` + `sanitizeCardName` reuse + card-safe name + collision + idempotency) → Tasks 1, 2. ✓
- Component 2 (`$HOME` symlink fence, blocked card never leaks contents, broken → graceful null) → Task 3. ✓
- Component 3 subset in scope (`duet relink`, `--artifact` form, reverse-lookup via `duet_symlink`, startup self-heal) → Tasks 4, 5. ✓
- Testing table rows for stages 1–3 (link naming/collision/idempotency; `$HOME` guard blocked-vs-allowed; broken→null; reverse-lookup repaired; missing recreated; orphan reported) → covered across `test/links.test.js`, `test/cards.test.js`, `test/duet-cli.test.js`. ✓
- Out of scope by design (stages 4–5): the `duet-canvas` skill, artifact frontmatter *stamping*, the `## Canvas Artifacts` brief section, `/inbox-clear` mover edits — a separate later plan. The marker-token contract is fixed here (Global Constraints) so stage 4 stamps a compatible form. ✓
- Spec open question "startup self-heal cost" → resolved by the cheap-exit (no vault scan unless a link is broken) + `setImmediate` deferral. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N" — every code step carries complete code. ✓

**3. Type consistency:** `linkInto`/`relinkArtifact` return `{symlinkPath, ...}` (consistent key name); `relink` returns `{repaired, recreated, stillBroken, orphans}` used identically in `server.js` and `bin/duet`; `buildCard(canvasDir, filename, opts)` and `snapshotCards(canvasDir, opts)` both take `opts.homeRoot`; `readDuetSymlink` returns an absolute path that `scanArtifacts` keys the map on and `relink` looks up with `.get(b.symlinkPath)` — the symlink path written by `scanCanvasSymlinks` (`path.join(sessionDir, name)`, absolute) matches the map key form. ✓

## Deferred to the next plan (stages 4–5, vault context)
- `duet-canvas` skill (generate → canonical-vault → `duet link` → stamp frontmatter + brief row).
- `[[Frontmatter Schema]]` gaining `duet_session` / `duet_symlink`.
- `/inbox-clear` (+ `/session-close`, `/meeting-agenda promote`) calling `duet relink --artifact` on moving a `duet_symlink`-tagged file, and moving the brief's `## Canvas Artifacts` row.

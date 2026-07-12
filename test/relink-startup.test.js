'use strict';

// Integration: the server's startup self-heal (server.js listen callback ->
// setImmediate -> relink(CANVAS_ROOT, [VAULT_ROOT], {recreate:false})) actually
// repairs a broken canvas symlink on boot. Fully HOME-isolated: HOME redirects
// BOTH os.homedir()-derived roots (CANVAS_ROOT and VAULT_ROOT) into a temp dir,
// so this never touches the developer's real ~/.duet or ~/Documents.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 7604;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await sleep(50);
  }
  throw new Error('server did not become healthy');
}

test('server startup self-heal repairs a broken canvas symlink on boot', async (t) => {
  const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'duet-selfheal-')));

  // A broken symlink: ~/.duet/canvas/s1/a.html -> a stale, non-existent target.
  const sessionDir = path.join(HOME, '.duet', 'canvas', 's1');
  const sym = path.join(sessionDir, 'a.html');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.symlinkSync(path.join(HOME, 'stale', 'a.html'), sym); // target does not exist => broken

  // The repair artifact under VAULT_ROOT (~/Documents/Obsidian Vault), carrying a
  // duet_symlink marker on its own line that points back at the broken symlink.
  const vaultRoot = path.join(HOME, 'Documents', 'Obsidian Vault');
  const artifact = path.join(vaultRoot, 'a.html');
  fs.mkdirSync(vaultRoot, { recursive: true });
  fs.writeFileSync(artifact, '<!--\nduet_symlink: ' + sym + '\n-->\n<h1>a</h1>');

  // HOME redirects both CANVAS_ROOT and VAULT_ROOT (both derive from os.homedir()).
  const srv = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DUET_PORT: String(PORT), HOME },
    stdio: 'ignore',
  });

  t.after(() => {
    srv.kill();
    fs.rmSync(HOME, { recursive: true, force: true });
  });

  await waitForHealth(PORT);

  // The self-heal runs in setImmediate AFTER listen, so poll for the repair.
  // recreate:false still repairs BROKEN links (the cheap-exit only triggers when
  // broken.length === 0), so this genuinely exercises the startup repair path.
  const deadline = Date.now() + 2000;
  let repaired = false;
  while (Date.now() < deadline) {
    try {
      if (fs.realpathSync(sym) === artifact) { repaired = true; break; }
    } catch (e) { /* still dangling */ }
    await sleep(25);
  }

  assert.strictEqual(repaired, true, 'startup self-heal must re-point the broken symlink at the vault artifact');
  assert.strictEqual(fs.realpathSync(sym), artifact);
});

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

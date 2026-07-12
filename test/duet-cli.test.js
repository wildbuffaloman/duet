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

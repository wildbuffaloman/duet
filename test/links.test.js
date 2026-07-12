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

test('unlinkCard refuses a path-traversal name and never deletes outside the session dir', () => {
  const root = tmp();
  const sessionDir = path.join(root, 'canvas', 's');       // two levels below root
  fs.mkdirSync(sessionDir, { recursive: true });
  const realTarget = path.join(root, 'canonical.html');
  fs.writeFileSync(realTarget, 'x');
  const outsideLink = path.join(root, 'evil.html');        // sessionDir/../../evil.html
  fs.symlinkSync(realTarget, outsideLink);

  assert.strictEqual(links.unlinkCard(sessionDir, '../../evil.html'), false);
  assert.strictEqual(fs.lstatSync(outsideLink).isSymbolicLink(), true); // symlink survives
  assert.strictEqual(fs.existsSync(realTarget), true);                  // target survives
});

test('linkInto rejects a non-renderable file type instead of coercing it', () => {
  const root = tmp();
  const md = path.join(root, 'notes.md');
  fs.writeFileSync(md, '# hi');
  const sessionDir = path.join(root, 's');

  assert.throws(() => links.linkInto(sessionDir, md), /renderable card file/);
  assert.strictEqual(fs.existsSync(path.join(sessionDir, 'notes.md')), false);
});

test('linkInto is idempotent when the same file is reached through a symlinked ancestor dir', () => {
  const root = tmp();
  const realDir = path.join(root, 'real');
  fs.mkdirSync(realDir, { recursive: true });
  const vault = path.join(realDir, 'note.html');
  fs.writeFileSync(vault, 'x');
  const linkDir = path.join(root, 'linked');
  fs.symlinkSync(realDir, linkDir);                        // linkDir -> realDir
  const sessionDir = path.join(root, 's');

  const a = links.linkInto(sessionDir, vault);                             // via real path
  const b = links.linkInto(sessionDir, path.join(linkDir, 'note.html'));   // via symlinked ancestor

  assert.strictEqual(a.name, 'note.html');
  assert.strictEqual(b.name, 'note.html');   // NOT note-2.html
  assert.strictEqual(b.created, false);
});

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

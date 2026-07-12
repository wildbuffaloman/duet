'use strict';

// Canonical-artifact linking: the vault holds the one true file; a session's
// canvas dir holds symlinks (views) into it. Pure filesystem — every entry point
// takes explicit directory paths so it is testable without touching ~/.duet.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitizeCardName, isCardFile } = require('./cards');

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

function linkInto(sessionDir, vaultFile, opts = {}) {
  if (!fs.existsSync(vaultFile)) {
    throw new Error(`duet link: target does not exist: ${vaultFile}`);
  }
  // realpath so `target` is normalized the same way as the idempotency compare
  // below (`fs.realpathSync(p)`) — a symlinked ancestor dir must not spuriously
  // fork a `-2` view of a file already linked.
  const target = fs.realpathSync(vaultFile);
  fs.mkdirSync(sessionDir, { recursive: true });

  const base = cardSafeLinkName(vaultFile, opts.as);
  // Only renderable card files get a link — a link into a non-card file (e.g.
  // .md) would surface as a broken card, so reject rather than coerce (matches
  // lib/cards.js importIntoCanvas refusing non-card dests).
  if (!isCardFile(base)) {
    throw new Error(`duet link: not a renderable card file (expected .html or an image): ${vaultFile}`);
  }
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

function unlinkCard(sessionDir, name) {
  // A card name is a card-safe basename ([A-Za-z0-9._-] via isCardFile), so this
  // also rejects any `/` or `..` — a traversal name must never delete a symlink
  // outside the session dir (matches the security guard in lib/cards.js buildCard).
  if (!isCardFile(name)) return false;
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
  // Normalize once so scanCanvasSymlinks' keys (path.join(canvasRoot, ...)) are
  // absolute and thus comparable to scanArtifacts' path.resolve(...) keys — a
  // relative canvasRoot would otherwise make every artifactMap.get() miss and
  // silently dump all broken links into stillBroken.
  canvasRoot = path.resolve(canvasRoot);
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

module.exports = {
  cardSafeLinkName,
  linkInto,
  unlinkCard,
  listLinks,
  expandTilde,
  readDuetSymlink,
  scanArtifacts,
  relinkArtifact,
  relink,
};

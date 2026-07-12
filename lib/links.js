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

module.exports = { cardSafeLinkName, linkInto, unlinkCard, listLinks };

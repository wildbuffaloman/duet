'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { shellEscape, shellEscapeAll, stripControlBytes } = require('../public/shell-escape.js');

test('leaves an already-safe path untouched', () => {
  assert.equal(shellEscape('/Users/me/pics/chart.png'), '/Users/me/pics/chart.png');
});

test('single-quotes a path containing spaces', () => {
  assert.equal(
    shellEscape('/Users/me/Screen Shot 2026-07-11.png'),
    "'/Users/me/Screen Shot 2026-07-11.png'"
  );
});

test("encodes an embedded single quote so the quoting cannot be broken out of", () => {
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
  assert.equal(shellEscapeAll(['/tmp/a.png', '/tmp/b c.png']), "/tmp/a.png '/tmp/b c.png'");
});

// ---------------------------------------------------------------------------
// Terminal safety — control bytes (security review 2026-07-11)
// ---------------------------------------------------------------------------

test('stripControlBytes removes C0, DEL and C1 bytes but keeps legitimate unicode', () => {
  assert.equal(stripControlBytes('a\x00\x07\x1b\x7f\x9fb'), 'ab');
  assert.equal(stripControlBytes('año €'), 'año €'); // U+00F1 and U+20AC are above the C1 range
});

test('shellEscape strips terminal control bytes so a filename cannot smuggle escape sequences', () => {
  // A filename carrying the bracketed-paste END marker (ESC [ 2 0 1 ~) must not survive:
  // the ESC is stripped, so it can never terminate bracketed paste early and be interpreted.
  const out = shellEscape('/tmp/a\x1b[201~b.png');
  assert.equal(out, "'/tmp/a[201~b.png'");
  assert.doesNotMatch(out, /[\x00-\x1f\x7f-\x9f]/);
});

test('shellEscape preserves legitimate non-ascii filenames', () => {
  assert.equal(shellEscape('/tmp/informe año €.png'), "'/tmp/informe año €.png'");
});

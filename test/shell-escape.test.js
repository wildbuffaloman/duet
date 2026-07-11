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

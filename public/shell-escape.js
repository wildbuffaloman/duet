// POSIX path escaping for insertion into a terminal input line.
// UMD: app.js loads this as a browser script; node:test requires it. One source of truth,
// and the escaping rules can change without rebuilding the Tauri shell.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuetShellEscape = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Characters that need no quoting in any POSIX shell.
  var SAFE_RE = /^[A-Za-z0-9_@%+=:,.\/-]+$/;

  function shellEscape(p) {
    if (p === '') return "''";
    if (SAFE_RE.test(p)) return p;
    // Single quotes disable all interpretation. The only character that can end the
    // quoting is a single quote, so encode it as '\'' — close, escaped quote, reopen.
    return "'" + p.replace(/'/g, "'\\''") + "'";
  }

  function shellEscapeAll(paths) {
    return paths.map(shellEscape).join(' ');
  }

  return { shellEscape: shellEscape, shellEscapeAll: shellEscapeAll };
});

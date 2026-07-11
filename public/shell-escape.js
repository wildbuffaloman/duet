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
  // C0 controls, DEL, and C1 controls. Legitimate paths never contain these; U+00A0+
  // (accented letters, symbols, emoji) is well above this range and is preserved.
  var CONTROL_RE = /[\x00-\x1f\x7f-\x9f]/g;

  // Remove terminal control bytes. Quoting protects the SHELL; this protects the TERMINAL:
  // a filename may legally embed ESC, and pasted raw it could smuggle escape sequences —
  // notably the bracketed-paste END marker (ESC[201~) — past the paste boundary and be
  // interpreted as terminal input rather than literal text.
  function stripControlBytes(s) {
    return String(s).replace(CONTROL_RE, '');
  }

  function shellEscape(p) {
    p = stripControlBytes(p);
    if (p === '') return "''";
    if (SAFE_RE.test(p)) return p;
    // Single quotes disable all interpretation. The only character that can end the
    // quoting is a single quote, so encode it as '\'' — close, escaped quote, reopen.
    return "'" + p.replace(/'/g, "'\\''") + "'";
  }

  function shellEscapeAll(paths) {
    return paths.map(shellEscape).join(' ');
  }

  return {
    shellEscape: shellEscape,
    shellEscapeAll: shellEscapeAll,
    stripControlBytes: stripControlBytes,
  };
});

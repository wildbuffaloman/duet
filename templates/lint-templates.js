#!/usr/bin/env node
// Lint duet HTML templates against the library rules (spec 2026-07-04).
// Usage: node templates/lint-templates.js [dir]   (default: this script's dir)
"use strict";
const fs = require("fs"), path = require("path");
const dir = process.argv[2] || __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith(".html"));
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  const fail = msg => { console.log(`${f}: ${msg}`); bad++; };
  if (!/<title>[^<]+<\/title>/.test(src)) fail("missing <title>");
  if (!src.includes('"use strict"')) fail('missing "use strict"');
  if (!src.includes("CRITIQUE-KIT BEGIN") || !src.includes("CRITIQUE-KIT END"))
    fail("missing CRITIQUE-KIT fences");
  if (!src.includes("===== DATA BLOCKS") || !src.includes("===== END DATA BLOCKS"))
    fail("missing DATA BLOCKS markers");
  if (!src.includes("function emitToSession")) fail("missing emitToSession hook slot");
  // external resource refs (comments stripped first; duet: hrefs allowed)
  const noComments = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/(src|href)\s*=\s*["']https?:/i.test(noComments)) fail("external http(s) resource reference");
  // Match actual USAGE, not prose that merely names the API (a template's content data may
  // legitimately describe localStorage/WebSocket). Usage = call form or member access.
  if (/\bfetch\s*\(|\blocalStorage\s*[.\[]|\bsessionStorage\s*[.\[]|new\s+XMLHttpRequest|\bXMLHttpRequest\s*\(|new\s+WebSocket|\bWebSocket\s*\(/.test(noComments))
    fail("network/storage API used (sandbox-unsafe)");
}
if (!files.length) { console.log("no templates found in " + dir); process.exit(1); }
console.log(bad ? `FAIL: ${bad} finding(s)` : `OK: ${files.length} template(s) clean`);
process.exit(bad ? 1 : 0);

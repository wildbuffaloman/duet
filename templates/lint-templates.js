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
  // universal contract
  if (!/<title>[^<]+<\/title>/.test(src)) fail("missing <title>");
  if (!src.includes('"use strict"')) fail('missing "use strict"');
  if (!src.includes("===== DATA BLOCKS") || !src.includes("===== END DATA BLOCKS"))
    fail("missing DATA BLOCKS markers");
  // metadata header (universal)
  const meta = (src.match(/<!--\s*HTML-TEMPLATE-META([\s\S]*?)-->/) || [])[1];
  if (!meta) fail("missing HTML-TEMPLATE-META block");
  else for (const k of ["name", "category", "task-shape", "capabilities"])
    if (!new RegExp("(^|\\n)\\s*" + k + "\\s*:", "i").test(meta)) fail(`meta missing '${k}:'`);
  const caps = ((meta && meta.match(/\ncapabilities\s*:\s*([^\n]*)/i)) || [])[1] || "";
  const hasKit = /\bcritique-kit\b/i.test(caps);
  // critique-kit checks (only when the template declares the capability)
  if (hasKit) {
    if (!src.includes("CRITIQUE-KIT BEGIN") || !src.includes("CRITIQUE-KIT END"))
      fail("declares critique-kit but missing CRITIQUE-KIT fences");
    if (!src.includes("function emitToSession"))
      fail("declares critique-kit but missing emitToSession hook slot");
  }
  // external resource refs (comments stripped first)
  const noComments = src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/(src|href)\s*=\s*["']https?:/i.test(noComments)) fail("external http(s) resource reference");
  if (/\bfetch\s*\(|\blocalStorage\s*[.\[]|\bsessionStorage\s*[.\[]|new\s+XMLHttpRequest|\bXMLHttpRequest\s*\(|new\s+WebSocket|\bWebSocket\s*\(/.test(noComments))
    fail("network/storage API used (sandbox-unsafe)");
}
if (!files.length) { console.log("no templates found in " + dir); process.exit(1); }
console.log(bad ? `FAIL: ${bad} finding(s)` : `OK: ${files.length} template(s) clean`);
process.exit(bad ? 1 : 0);

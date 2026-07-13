#!/usr/bin/env node
"use strict";
const fs = require("fs"), path = require("path");
const [, , libDir, skillMd] = process.argv;
if (!libDir || !skillMd) { console.error("usage: regen-indexes.js <libDir> <skillMdPath>"); process.exit(2); }
const files = fs.readdirSync(libDir).filter(f => f.endsWith(".html") && f !== "_skeleton.html").sort();
const field = (m, k) => ((m.match(new RegExp("\\n\\s*" + k + "\\s*:\\s*([^\\n]*)", "i")) || [])[1] || "").trim();
const rows = files.map(f => {
  const m = (fs.readFileSync(path.join(libDir, f), "utf8").match(/<!--\s*HTML-TEMPLATE-META([\s\S]*?)-->/) || [])[1] || "";
  return { f, category: field(m, "category"), task: field(m, "task-shape"), data: field(m, "data-blocks"), updated: field(m, "updated") };
});
const splice = (text, begin, end, block) => {
  const b = text.indexOf(begin), e = text.indexOf(end);
  if (b < 0 || e < 0) throw new Error("markers not found: " + begin);
  return text.slice(0, b + begin.length) + "\n" + block + "\n" + text.slice(e);
};
const readmePath = path.join(libDir, "README.md");
let readme = fs.readFileSync(readmePath, "utf8");
const rtbl = ["| Template | Category | Task shape | Data blocks | Updated |", "| --- | --- | --- | --- | --- |",
  ...rows.map(r => `| \`${r.f}\` | ${r.category} | ${r.task} | ${r.data} | ${r.updated} |`)].join("\n");
readme = splice(readme, "<!-- TEMPLATES-TABLE:BEGIN -->", "<!-- TEMPLATES-TABLE:END -->", rtbl);
fs.writeFileSync(readmePath, readme);
let skill = fs.readFileSync(skillMd, "utf8");
const stbl = ["| You need to… | Instantiate |", "| --- | --- |",
  ...rows.map(r => `| ${r.task} | \`${r.f}\` |`)].join("\n");
skill = splice(skill, "<!-- ROUTING-TABLE:BEGIN -->", "<!-- ROUTING-TABLE:END -->", stbl);
fs.writeFileSync(skillMd, skill);
console.log(`regenerated indexes for ${rows.length} template(s)`);

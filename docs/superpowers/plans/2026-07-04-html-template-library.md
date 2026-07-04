# HTML Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow duet's one-template seed into a five-template, ecosystem-wide HTML template library — canonical in the vault, incubated in duet, wired into skills.

**Architecture:** Templates are authored in `~/dev/duet/templates/` (git-versioned incubator) following the skeleton convention: shared critique machinery (`Kit`) inside `CRITIQUE-KIT` comment fences, domain body + `const` data blocks per template, no build step. A graduation task copies the finished library to the vault (`03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/`), which becomes canonical; a tiny router skill plus one-line pointers make any Claude session discover it.

**Tech Stack:** Plain HTML/CSS/JS single files (zero dependencies, sandbox-safe), Node (lint script only), Claude Code skill markdown.

**Spec:** `docs/superpowers/specs/2026-07-04-html-template-library-design.md` (approved 2026-07-04, rev `4c8ccc8`).

## Global Constraints

- **One file, zero deps:** no CDNs, webfonts, fetches, or external images in any template. `href="duet:..."` is allowed; `http(s)://` in `src=`/`href=` is not (comments are fine).
- **Sandbox-safe:** templates run under `sandbox="allow-scripts"` (no same-origin). Clipboard = `execCommand('copy')`-first with select-for-⌘C fallback. No `localStorage`, no `fetch`.
- **Data blocks:** `const` declarations immediately after `"use strict"`, between `/* ===== DATA BLOCKS (replace on instantiation) ===== */` and `/* ===== END DATA BLOCKS ===== */` markers, each preceded by a shape comment with one example element. Instantiation touches ONLY `<title>`, the header, and these blocks.
- **Palette (duet, dark):** ground `#0a0e16`, panel `#0f1523`, line `#243049`, ink `#c6d0de`, dim `#6f7d92`, amber `#e8b862`, teal `#3fd3bf`, purple `#a78bfa`, good `#4ade80`, warn `#fbbf24`, down `#f87171`. Mono stack: `ui-monospace,"SF Mono",Menlo,Consolas,monospace`.
- **CRITIQUE-KIT fences:** the shared machinery lives verbatim between `<!-- CRITIQUE-KIT BEGIN ... -->` and `<!-- CRITIQUE-KIT END -->` in every template; templates never modify it, fixes propagate by grep.
- **M3a hook slot:** the kit's `emitToSession(text)` returns `false` in v1 (feature-detect placeholder). Do NOT build any duet app-side event plumbing — out of scope (ROADMAP M3a owns it).
- **Vault edit policy:** creating `03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/` and editing the duet project brief's AI Context rule #1 are pre-authorized. Any OTHER vault note edit: propose in the final report, don't apply.
- **English copy** in templates (duet is an English-language project).
- Commit after every task in `~/dev/duet` (vault has no git — vault steps are verified by `diff`, not commits).

---

### Task 1: Library lint script + updated founding rules

**Files:**
- Create: `templates/lint-templates.js`
- Modify: `templates/README.md` (append rules 6–7 + M3a note to the `## Rules` section)

**Interfaces:**
- Produces: `node templates/lint-templates.js` — exits 0 when every `templates/*.html` passes the library rules, exits 1 listing `file: failure` lines. Every later task uses this as its test command.

- [ ] **Step 1: Write the lint script (the failing test for the whole library)**

```js
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
  if (/\b(fetch\s*\(|localStorage|XMLHttpRequest|WebSocket\s*\()/.test(noComments))
    fail("network/storage API used (sandbox-unsafe)");
}
if (!files.length) { console.log("no templates found in " + dir); process.exit(1); }
console.log(bad ? `FAIL: ${bad} finding(s)` : `OK: ${files.length} template(s) clean`);
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails on the current library**

Run: `node ~/dev/duet/templates/lint-templates.js`
Expected: FAIL — `system-map-critique.html` reports at least `missing CRITIQUE-KIT fences`, `missing DATA BLOCKS markers`, `missing emitToSession hook slot` (it predates the convention; Task 3 fixes it).

- [ ] **Step 3: Append rules 6–7 to `templates/README.md`**

Append to the `## Rules for templates in this library` numbered list (after rule 5):

```markdown
6. **The critique kit.** Shared machinery (stance state, notes, prompt compiler, sandbox-safe
   copy, data-block validator) lives inside `<!-- CRITIQUE-KIT BEGIN -->` / `<!-- CRITIQUE-KIT END -->`
   fences in every template — identical across the library, sourced from `_skeleton.html`.
   Templates never modify the kit; a kit fix is applied to every fence by grep. The kit's
   submit path is `emitToSession(text)`: a feature-detect hook slot that returns `false` in v1
   (always fall back to the compiled-prompt box + copy button). When duet M3a ships its injected
   event helper, one fence edit flips "Copy feedback" to "Send to session" inside duet.
7. **Degrade gracefully outside duet.** duet niceties (`data-duet-card` links, the future M3a
   channel) are allowed but the template must stay fully functional as a lone browser tab or
   artifact — duet-only affordances render inert, never broken.
```

Also append at the end of the README:

```markdown
## Linting

`node templates/lint-templates.js` — checks every template against rules 1–7
(title, strict mode, fences, data-block markers, hook slot, no external resources).
Run it before committing any template change.
```

- [ ] **Step 4: Commit**

```bash
cd ~/dev/duet && git add templates/lint-templates.js templates/README.md
git commit -m "templates: lint script + rules 6-7 (critique-kit fences, graceful degradation)"
```

---

### Task 2: `_skeleton.html` — the critique-kit skeleton

**Files:**
- Create: `templates/_skeleton.html`

**Interfaces:**
- Produces (used verbatim by Tasks 3–7): global `Kit` with
  `Kit.init({compile: (state) => string})` · `Kit.stanceEl(id) => HTMLElement` ·
  `Kit.validate(name, arr, requiredKeys) => boolean` · `Kit.el(tag, cls?, text?) => HTMLElement` ·
  `Kit.state` (`{[id]: {stance: null|"keep"|"change"|"question", note: string}}`) ·
  `Kit.banner(msg)`. Plus the fenced kit HTML (`#kit-out` box, `#kit-copy` button) and the
  shared `:root` palette CSS. New templates start as `cp _skeleton.html <name>.html`.

- [ ] **Step 1: Write the skeleton (complete file)**

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Template skeleton — replace me</title>
<style>
  :root{--bg:#0a0e16;--panel:#0f1523;--line:#243049;--ink:#c6d0de;--dim:#6f7d92;
    --amber:#e8b862;--teal:#3fd3bf;--purple:#a78bfa;--good:#4ade80;--warn:#fbbf24;--down:#f87171;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:13.5px/1.6 var(--sans);padding:20px 22px 30px}
  h1{margin:0 0 4px;font:700 19px var(--sans)}
  .sub{color:var(--dim);margin:0 0 18px;font-size:12.5px}
  h2{margin:22px 0 8px;font:10.5px var(--mono);letter-spacing:1.1px;text-transform:uppercase;color:var(--dim)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 14px}
  /* kit styles (part of the kit contract — keep with the fences) */
  .kit-stance{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
  .kit-stance button{font:600 11px var(--mono);background:none;border:1px solid var(--line);
    border-radius:7px;color:var(--dim);padding:4px 9px;cursor:pointer}
  .kit-stance button.on-keep{color:var(--good);border-color:var(--good)}
  .kit-stance button.on-change{color:var(--warn);border-color:var(--warn)}
  .kit-stance button.on-question{color:var(--purple);border-color:var(--purple)}
  .kit-stance textarea{flex:1 1 100%;background:var(--bg);border:1px solid var(--line);
    border-radius:7px;color:var(--ink);font:12px var(--sans);padding:6px 8px;min-height:30px;resize:vertical}
  .kit-banner{background:rgba(248,113,113,.12);border:1px solid var(--down);color:var(--down);
    border-radius:8px;padding:8px 12px;margin:0 0 12px;font:600 12px var(--mono)}
  .kit-box{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
  .kit-out{font:12px var(--mono);white-space:pre-wrap;color:var(--ink);min-height:40px}
  .kit-copy{margin-top:10px;font:600 12px var(--mono);background:none;border:1px solid var(--teal);
    color:var(--teal);border-radius:8px;padding:6px 14px;cursor:pointer}
</style></head>
<body>
  <h1 id="hdr">Skeleton</h1>
  <p class="sub" id="sub">Copy this file to start a new template. Replace the data blocks, build the body, leave the kit fences intact.</p>

  <div id="app"></div>

<script>
"use strict";
/* ===== DATA BLOCKS (replace on instantiation) ===== */
// ITEMS: things to critique — [{id:"a", name:"First item", desc:"What it is"}]
const ITEMS = [
  {id:"a", name:"Example item A", desc:"Replace ITEMS with your template's real data blocks."},
  {id:"b", name:"Example item B", desc:"Each block gets a shape comment with one example element."}
];
/* ===== END DATA BLOCKS ===== */

/* ---- domain body (template-specific: replace everything below until the kit fence) ---- */
(function(){
  if (!Kit.validate("ITEMS", ITEMS, ["id","name","desc"])) return;
  var app = document.getElementById("app");
  ITEMS.forEach(function(it){
    var p = Kit.el("div","panel");
    p.appendChild(Kit.el("h2",null,it.name));
    p.appendChild(Kit.el("div",null,it.desc));
    p.appendChild(Kit.stanceEl(it.id));
    app.appendChild(p);
  });
  Kit.init({compile:function(state){
    var lines = ["Feedback on: " + document.title, ""];
    ITEMS.forEach(function(it){
      var s = state[it.id]; if(!s || (!s.stance && !s.note)) return;
      lines.push("- " + it.name + ": " + (s.stance || "note") + (s.note ? " — " + s.note : ""));
    });
    if (lines.length === 2) lines.push("(nothing flagged yet — mark stances above)");
    return lines.join("\n");
  }});
})();
</script>

<!-- CRITIQUE-KIT BEGIN (shared machinery — keep in sync across library, see _skeleton.html) -->
<h2>Compiled feedback</h2>
<div class="kit-box"><div class="kit-out" id="kit-out"></div>
<button class="kit-copy" id="kit-copy">Copy feedback</button></div>
<script>
"use strict";
var Kit = (function(){
  var state = {}, compileFn = null;
  function el(tag, cls, text){ var n = document.createElement(tag);
    if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function banner(msg){ document.body.prepend(el("div","kit-banner",msg)); }
  function validate(name, arr, keys){
    if (!Array.isArray(arr) || !arr.length){ banner("data block invalid: " + name + " must be a non-empty array"); return false; }
    for (var i = 0; i < arr.length; i++) for (var k = 0; k < keys.length; k++)
      if (!(keys[k] in arr[i])){ banner("data block invalid: " + name + "[" + i + "] missing `" + keys[k] + "`"); return false; }
    return true;
  }
  function stanceEl(id){
    state[id] = state[id] || {stance:null, note:""};
    var box = el("div","kit-stance");
    ["keep","change","question"].forEach(function(s){
      var b = el("button",null,{keep:"✓ keep",change:"✎ change",question:"? question"}[s]);
      b.dataset.s = s;
      b.onclick = function(){ state[id].stance = state[id].stance === s ? null : s; sync(box,id); recompile(); };
      box.appendChild(b);
    });
    var t = document.createElement("textarea"); t.placeholder = "note…";
    t.oninput = function(){ state[id].note = t.value; recompile(); };
    box.appendChild(t); sync(box,id); return box;
  }
  function sync(box,id){ box.querySelectorAll("button").forEach(function(b){
    b.className = state[id].stance === b.dataset.s ? "on-" + b.dataset.s : ""; }); }
  function recompile(){ if (compileFn) document.getElementById("kit-out").textContent = compileFn(state); }
  function emitToSession(text){
    /* M3a HOOK SLOT (duet ROADMAP): when duet injects its event helper, feature-detect it here
       and send {type:"feedback", data:{text:text}} — flipping this button to "Send to session"
       inside duet. Until then: always return false (copy fallback is the v1 output, and the
       permanent standalone-tab behavior). */
    return false;
  }
  function copy(){
    var out = document.getElementById("kit-out"), txt = out.textContent, btn = document.getElementById("kit-copy");
    if (emitToSession(txt)) return;
    var ta = document.createElement("textarea"); ta.value = txt;
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch(e){}
    document.body.removeChild(ta);
    if (ok){ btn.textContent = "copied ✓"; setTimeout(function(){ btn.textContent = "Copy feedback"; }, 1200); }
    else { var r = document.createRange(); r.selectNodeContents(out);
      var s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.textContent = "press ⌘C"; }
  }
  function init(opts){ compileFn = opts.compile;
    document.getElementById("kit-copy").onclick = copy; recompile(); }
  return {init:init, stanceEl:stanceEl, validate:validate, el:el, state:state, banner:banner};
})();
</script>
<!-- CRITIQUE-KIT END -->
</body></html>
```

Note the load order: the kit `<script>` sits AFTER the domain script in the file, but the domain code runs inside an IIFE that references `Kit` — so the domain script must be deferred. **Correction (do this exactly):** wrap the domain IIFE invocation in `window.addEventListener("DOMContentLoaded", function(){ ... })` — i.e. the domain script's last line changes from `})();` to `});` and its first line from `(function(){` to `window.addEventListener("DOMContentLoaded", function(){`. Every template (Tasks 3–7) follows this same pattern: domain code runs on `DOMContentLoaded`, kit defines `Kit` at parse time.

- [ ] **Step 2: Lint**

Run: `node ~/dev/duet/templates/lint-templates.js`
Expected: `_skeleton.html` clean; `system-map-critique.html` still failing (fixed next task). Exit 1 overall — that's expected until Task 3.

- [ ] **Step 3: Render check in a browser**

Run: `open ~/dev/duet/templates/_skeleton.html`
Verify: two example panels render; clicking `✓ keep` highlights green and the compiled box updates; typing a note updates the box; `Copy feedback` shows `copied ✓` (or `press ⌘C` fallback). Corrupt test: temporarily delete `"name"` from ITEMS[0] in the browser devtools-free way — edit the file, reload, expect the red banner `data block invalid: ITEMS[0] missing \`name\``, then undo the edit.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/duet && git add templates/_skeleton.html
git commit -m "templates: _skeleton.html — critique-kit skeleton (Kit API, M3a hook slot)"
```

---

### Task 3: Retrofit `system-map-critique.html` to the kit convention

**Files:**
- Modify: `templates/system-map-critique.html`

**Interfaces:**
- Consumes: `Kit` API from Task 2 (fence block copied verbatim from `_skeleton.html`).
- Produces: the first template passing lint — proof the convention fits a rich pre-existing template.

The existing template has its own stance buttons, notes, prompt compiler, and copy button. Retrofit = make it satisfy the lint without breaking its (already working) UX:

- [ ] **Step 1: Add the data-block markers**

Locate its `const`-style data declarations (COMPONENTS, WIRES, FLOWS, PRIORITIES, PRESETS — right after `"use strict"`). Wrap them:

```js
/* ===== DATA BLOCKS (replace on instantiation) ===== */
// COMPONENTS: [{id:"wm", col:"browser", color:"neutral", name:"...", sub:"...", role:"...", decision:"..."}]
const COMPONENTS = [ /* ...existing content unchanged... */ ];
// ... same one-line shape comment above each of WIRES, FLOWS, PRIORITIES, PRESETS ...
/* ===== END DATA BLOCKS ===== */
```

- [ ] **Step 2: Append the CRITIQUE-KIT fence block**

Copy the entire fenced block from `_skeleton.html` (from `<!-- CRITIQUE-KIT BEGIN` to `<!-- CRITIQUE-KIT END -->`, including both the HTML and the `<script>`) and paste it just before `</body>`. Then wire the existing copy path through the hook slot: find the template's own copy-button handler and insert at its top:

```js
if (typeof Kit !== "undefined" && Kit.emitToSession && Kit.emitToSession(promptText)) return;
```

…where `promptText` is the variable the existing handler already copies. Expose the hook from the kit's return object for this: in the pasted fence, change the return line to
`return {init:init, stanceEl:stanceEl, validate:validate, el:el, state:state, banner:banner, emitToSession:emitToSession};`
**and make the same one-line change in `_skeleton.html`** (fences stay identical — that's the convention; re-run lint after).
Hide the kit's own output box in this template (its compiled-prompt UI already exists): add `style="display:none"` on the fence's `<h2>` and `.kit-box` elements. The fence *content* stays identical; visibility is the template's call.

- [ ] **Step 3: Lint — whole library green**

Run: `node ~/dev/duet/templates/lint-templates.js`
Expected: `OK: 2 template(s) clean`, exit 0.

- [ ] **Step 4: Render check**

Run: `open ~/dev/duet/templates/system-map-critique.html`
Verify: identical behavior to before (map, flows, stances, compiled prompt, copy). No red banner.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/duet && git add templates/system-map-critique.html templates/_skeleton.html
git commit -m "templates: retrofit system-map-critique to kit convention (fences, data-block markers, hook slot)"
```

---

### Task 4: `ui-design-chooser.html`

**Files:**
- Create: `templates/ui-design-chooser.html` (start: `cp templates/_skeleton.html templates/ui-design-chooser.html`)

**Interfaces:**
- Consumes: `Kit.init/validate/el/state` (Task 2). Stances here are custom (pick/reject/mixed), so this template renders its own stance buttons but stores into `Kit.state` via the same shape (`{stance, note}`) so `compile` reads one structure.

- [ ] **Step 1: Replace `<title>`, header, data blocks, and domain body**

`<title>`: `UI design chooser — pick between rendered options`. `<h1 id="hdr">`: `UI design chooser`; `.sub`: `Each option is a real rendered mockup. Zoom, pick/reject, note what to keep from the losers.`

Data blocks (replace ITEMS):

```js
/* ===== DATA BLOCKS (replace on instantiation) ===== */
// OPTIONS: design candidates. mockupHTML is a self-contained inline fragment (inline styles
// only, no scripts) rendered scaled-down in its panel.
// [{id:"a", name:"Option A — cards", rationale:"why this direction", mockupHTML:"<div style=...>...</div>"}]
const OPTIONS = [
  {id:"a", name:"Option A — stacked cards",
   rationale:"Vertical scan order; every record gets equal weight.",
   mockupHTML:"<div style='font-family:sans-serif;background:#f5f6f8;padding:16px;height:100%'>" +
     "<div style='background:#fff;border-radius:8px;padding:12px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,.15)'><b>Record one</b><br><span style='color:#777'>detail line</span></div>" +
     "<div style='background:#fff;border-radius:8px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.15)'><b>Record two</b><br><span style='color:#777'>detail line</span></div></div>"},
  {id:"b", name:"Option B — dense table",
   rationale:"Maximum records per screen; comparison across columns.",
   mockupHTML:"<div style='font-family:sans-serif;background:#fff;padding:12px;height:100%'>" +
     "<table style='width:100%;border-collapse:collapse;font-size:13px'>" +
     "<tr style='border-bottom:2px solid #333;text-align:left'><th>Name</th><th>Status</th><th>Qty</th></tr>" +
     "<tr style='border-bottom:1px solid #ddd'><td>Record one</td><td>ok</td><td>12</td></tr>" +
     "<tr style='border-bottom:1px solid #ddd'><td>Record two</td><td>late</td><td>3</td></tr></table></div>"}
];
/* ===== END DATA BLOCKS ===== */
```

Domain body (replaces the skeleton's ITEMS loop; runs on `DOMContentLoaded` per the skeleton pattern):

```js
window.addEventListener("DOMContentLoaded", function(){
  if (!Kit.validate("OPTIONS", OPTIONS, ["id","name","rationale","mockupHTML"])) return;
  var app = document.getElementById("app");
  var grid = Kit.el("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px";
  app.appendChild(grid);
  OPTIONS.forEach(function(o){
    Kit.state[o.id] = Kit.state[o.id] || {stance:null, note:""};
    var p = Kit.el("div","panel");
    p.appendChild(Kit.el("h2",null,o.name));
    // scaled live mockup, click to zoom
    var vp = Kit.el("div"); vp.style.cssText = "height:180px;overflow:hidden;border:1px solid var(--line);border-radius:8px;cursor:zoom-in;background:#fff";
    var stage = Kit.el("div"); stage.style.cssText = "width:200%;height:360px;transform:scale(.5);transform-origin:0 0";
    stage.innerHTML = o.mockupHTML; vp.appendChild(stage);
    var zoomed = false;
    vp.onclick = function(){ zoomed = !zoomed;
      vp.style.height = zoomed ? "380px" : "180px"; vp.style.cursor = zoomed ? "zoom-out" : "zoom-in";
      stage.style.cssText = zoomed ? "width:100%;height:360px;transform:none"
                                   : "width:200%;height:360px;transform:scale(.5);transform-origin:0 0"; };
    p.appendChild(vp);
    p.appendChild(Kit.el("div","sub",o.rationale));
    // pick / reject / mixed stance row (custom labels, kit state shape)
    var row = Kit.el("div","kit-stance");
    [["pick","✓ pick","on-keep"],["reject","✗ reject","on-question"],["mixed","◑ mixed","on-change"]]
      .forEach(function(def){
        var b = Kit.el("button",null,def[1]); b.dataset.s = def[0];
        b.onclick = function(){
          Kit.state[o.id].stance = Kit.state[o.id].stance === def[0] ? null : def[0];
          row.querySelectorAll("button").forEach(function(x){
            x.className = Kit.state[o.id].stance === x.dataset.s
              ? {pick:"on-keep",reject:"on-question",mixed:"on-change"}[x.dataset.s] : ""; });
          rec(); };
        row.appendChild(b); });
    var t = document.createElement("textarea"); t.placeholder = "what works / what to steal from this one…";
    t.oninput = function(){ Kit.state[o.id].note = t.value; rec(); };
    row.appendChild(t); p.appendChild(row);
    grid.appendChild(p);
  });
  function rec(){ document.getElementById("kit-out").textContent = compile(Kit.state); }
  function compile(state){
    var picked = OPTIONS.filter(function(o){ return state[o.id].stance === "pick"; });
    var lines = ["UI design feedback — " + document.title, ""];
    lines.push(picked.length ? "Chosen: " + picked.map(function(o){ return o.name; }).join(", ")
                             : "No option picked yet.");
    OPTIONS.forEach(function(o){
      var s = state[o.id]; if (!s.stance && !s.note) return;
      lines.push("- " + o.name + " [" + (s.stance || "note") + "]" + (s.note ? ": " + s.note : ""));
    });
    return lines.join("\n");
  }
  Kit.init({compile: compile});
});
```

- [ ] **Step 2: Lint** — Run: `node ~/dev/duet/templates/lint-templates.js` → Expected: `OK: 3 template(s) clean`.

- [ ] **Step 3: Render check** — Run: `open ~/dev/duet/templates/ui-design-chooser.html`. Verify: two mockups render scaled (real card list vs real table), click zooms, pick/reject/mixed toggle with colors, compiled box says `Chosen: …` and per-option lines, copy works.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/duet && git add templates/ui-design-chooser.html
git commit -m "templates: ui-design-chooser — rendered options, pick/reject/mixed, compiled choice"
```

---

### Task 5: `sop-map-critique.html`

**Files:**
- Create: `templates/sop-map-critique.html` (start: `cp templates/_skeleton.html templates/sop-map-critique.html`)

**Interfaces:**
- Consumes: `Kit.init/validate/stanceEl/el/state` (Task 2) — standard keep/change/question stances.

- [ ] **Step 1: Replace `<title>`, header, data blocks, domain body**

`<title>`: `SOP map & critique`. `<h1>`: `SOP map & critique`; `.sub`: `Swimlanes by role. Mark keep / change / question per step — an all-blank critique of a draft process IS the design session.`

Data blocks:

```js
/* ===== DATA BLOCKS (replace on instantiation) ===== */
// ROLES: swimlanes, in display order — [{id:"op", name:"Operator"}]
const ROLES = [
  {id:"op", name:"Operator"},
  {id:"sup", name:"Supervisor"},
  {id:"qa", name:"Quality"}
];
// STEPS: [{id:"s1", role:"op", name:"Receive batch", desc:"...", inputs:"...", outputs:"...", failure_modes:"..."}]
const STEPS = [
  {id:"s1", role:"op",  name:"Receive batch",  desc:"Log arrival and check paperwork.",
   inputs:"Delivery note", outputs:"Logged batch record", failure_modes:"Paperwork mismatch not caught"},
  {id:"s2", role:"qa",  name:"Sample & test",  desc:"Pull sample per sampling plan; run acceptance tests.",
   inputs:"Logged batch record", outputs:"Test result", failure_modes:"Sample skipped under time pressure"},
  {id:"s3", role:"sup", name:"Release / hold", desc:"Decide release based on test result.",
   inputs:"Test result", outputs:"Release decision", failure_modes:"Hold criteria ambiguous"}
];
// HANDOFFS: directed edges between steps — [{from:"s1", to:"s2"}]
const HANDOFFS = [ {from:"s1", to:"s2"}, {from:"s2", to:"s3"} ];
/* ===== END DATA BLOCKS ===== */
```

Domain body:

```js
window.addEventListener("DOMContentLoaded", function(){
  if (!Kit.validate("ROLES", ROLES, ["id","name"])) return;
  if (!Kit.validate("STEPS", STEPS, ["id","role","name","desc","inputs","outputs","failure_modes"])) return;
  if (!Kit.validate("HANDOFFS", HANDOFFS, ["from","to"])) return;
  var app = document.getElementById("app"), byStep = {};
  ROLES.forEach(function(r){
    var lane = Kit.el("div","panel");
    lane.style.borderLeft = "3px solid var(--teal)";
    lane.appendChild(Kit.el("h2",null,"lane — " + r.name));
    var row = Kit.el("div"); row.style.cssText = "display:flex;flex-wrap:wrap;gap:12px";
    STEPS.filter(function(s){ return s.role === r.id; }).forEach(function(s){
      var card = Kit.el("div"); byStep[s.id] = s;
      card.style.cssText = "flex:1 1 260px;border:1px solid var(--line);border-radius:8px;padding:10px 12px;background:var(--bg)";
      card.appendChild(Kit.el("b",null,s.name));
      card.appendChild(Kit.el("div","sub",s.desc));
      var meta = Kit.el("div"); meta.style.cssText = "font:11px var(--mono);color:var(--dim);margin:6px 0";
      meta.appendChild(Kit.el("div",null,"in: " + s.inputs));
      meta.appendChild(Kit.el("div",null,"out: " + s.outputs));
      var fm = Kit.el("div",null,"⚠ " + s.failure_modes); fm.style.color = "var(--warn)"; meta.appendChild(fm);
      card.appendChild(meta);
      card.appendChild(Kit.stanceEl(s.id));
      row.appendChild(card);
    });
    if (!row.children.length) row.appendChild(Kit.el("div","sub","(no steps in this lane)"));
    lane.appendChild(row); app.appendChild(lane);
  });
  var flow = Kit.el("div","sub","flow: " + HANDOFFS.map(function(h){
    return (byStep[h.from] ? byStep[h.from].name : h.from) + " → " + (byStep[h.to] ? byStep[h.to].name : h.to);
  }).join("  ·  "));
  app.appendChild(flow);
  Kit.init({compile:function(state){
    var lines = ["SOP feedback — " + document.title, ""];
    var touched = 0;
    STEPS.forEach(function(s){
      var st = state[s.id]; if (!st || (!st.stance && !st.note)) return;
      touched++;
      lines.push("- [" + (st.stance || "note") + "] " + s.name + " (" +
        (ROLES.filter(function(r){ return r.id === s.role; })[0] || {name:s.role}).name + ")" +
        (st.note ? " — " + st.note : ""));
    });
    lines.push("", touched + "/" + STEPS.length + " steps reviewed" +
      (touched === 0 ? " — blank critique of a draft = design mode: describe the intended process step by step." : ""));
    return lines.join("\n");
  }});
});
```

- [ ] **Step 2: Lint** — Run: `node ~/dev/duet/templates/lint-templates.js` → Expected: `OK: 4 template(s) clean`.

- [ ] **Step 3: Render check** — `open ~/dev/duet/templates/sop-map-critique.html`. Verify: three lanes, step cards with in/out/⚠, stances update the compiled box, `0/3 steps reviewed` note mentions design mode when blank.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/duet && git add templates/sop-map-critique.html
git commit -m "templates: sop-map-critique — swimlane SOP review/design with per-step stances"
```

---

### Task 6: `decision-matrix.html`

**Files:**
- Create: `templates/decision-matrix.html` (start: `cp templates/_skeleton.html templates/decision-matrix.html`)

**Interfaces:**
- Consumes: `Kit.init/validate/el` (Task 2). No stance widgets — the interaction is weights; notes live in one free-text field wired into `Kit.state["_notes"]`.

- [ ] **Step 1: Replace `<title>`, header, data blocks, domain body**

`<title>`: `Decision matrix — weighted options`. `<h1>`: `Decision matrix`; `.sub`: `Drag the weights; the ranking re-sorts live. The sensitivity hint flags criteria that can flip the winner.`

Data blocks:

```js
/* ===== DATA BLOCKS (replace on instantiation) ===== */
// OPTIONS: [{id:"a", name:"Option A"}]
const OPTIONS = [ {id:"a", name:"Option A"}, {id:"b", name:"Option B"}, {id:"c", name:"Option C"} ];
// CRITERIA: weight 0-10; direction "higher"|"lower" (lower = smaller score is better, e.g. cost)
// [{id:"cost", name:"Cost", weight:5, direction:"lower"}]
const CRITERIA = [
  {id:"cost",  name:"Cost",           weight:5, direction:"lower"},
  {id:"speed", name:"Time to ship",   weight:7, direction:"lower"},
  {id:"fit",   name:"Strategic fit",  weight:8, direction:"higher"}
];
// SCORES: raw 1-10 per option per criterion — {optionId: {criterionId: n}}
const SCORES = {
  a: {cost:4, speed:3, fit:9},
  b: {cost:7, speed:8, fit:5},
  c: {cost:5, speed:6, fit:7}
};
/* ===== END DATA BLOCKS ===== */
```

Domain body:

```js
window.addEventListener("DOMContentLoaded", function(){
  if (!Kit.validate("OPTIONS", OPTIONS, ["id","name"])) return;
  if (!Kit.validate("CRITERIA", CRITERIA, ["id","name","weight","direction"])) return;
  for (var i = 0; i < OPTIONS.length; i++){
    var oid = OPTIONS[i].id;
    if (!SCORES[oid]){ Kit.banner("data block invalid: SCORES missing option `" + oid + "`"); return; }
    for (var j = 0; j < CRITERIA.length; j++)
      if (!(CRITERIA[j].id in SCORES[oid])){
        Kit.banner("data block invalid: SCORES." + oid + " missing `" + CRITERIA[j].id + "`"); return; }
  }
  Kit.state["_notes"] = {stance:null, note:""};
  var w = {}; CRITERIA.forEach(function(c){ w[c.id] = c.weight; });
  var app = document.getElementById("app");
  var sliders = Kit.el("div","panel"); sliders.appendChild(Kit.el("h2",null,"weights"));
  CRITERIA.forEach(function(c){
    var row = Kit.el("div"); row.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0";
    var lbl = Kit.el("span",null,c.name + (c.direction === "lower" ? " (lower is better)" : ""));
    lbl.style.cssText = "flex:0 0 220px";
    var inp = document.createElement("input"); inp.type = "range"; inp.min = 0; inp.max = 10; inp.value = c.weight;
    inp.style.flex = "1";
    var val = Kit.el("b",null,String(c.weight)); val.style.cssText = "flex:0 0 20px;color:var(--amber)";
    inp.oninput = function(){ w[c.id] = +inp.value; val.textContent = inp.value; render(); };
    row.appendChild(lbl); row.appendChild(inp); row.appendChild(val); sliders.appendChild(row);
  });
  app.appendChild(sliders);
  var board = Kit.el("div","panel"); app.appendChild(board);
  var noteP = Kit.el("div","panel"); noteP.appendChild(Kit.el("h2",null,"notes"));
  var ta = document.createElement("textarea");
  ta.style.cssText = "width:100%;min-height:50px;background:var(--bg);border:1px solid var(--line);border-radius:7px;color:var(--ink);font:12px var(--sans);padding:8px";
  ta.placeholder = "constraints, vetoes, context the matrix can't hold…";
  ta.oninput = function(){ Kit.state["_notes"].note = ta.value; render(); };
  noteP.appendChild(ta); app.appendChild(noteP);

  function totals(weights){
    return OPTIONS.map(function(o){
      var t = 0; CRITERIA.forEach(function(c){
        var raw = SCORES[o.id][c.id], v = c.direction === "lower" ? 11 - raw : raw;
        t += v * weights[c.id]; });
      return {o:o, t:t};
    }).sort(function(a,b){ return b.t - a.t; });
  }
  function sensitivity(){
    var win = totals(w)[0].o.id, flips = [];
    CRITERIA.forEach(function(c){
      for (var d = 0; d <= 10; d++){
        var w2 = {}; CRITERIA.forEach(function(x){ w2[x.id] = w[x.id]; }); w2[c.id] = d;
        if (totals(w2)[0].o.id !== win){ flips.push(c.name); break; }
      }
    });
    return flips;
  }
  function render(){
    board.innerHTML = ""; board.appendChild(Kit.el("h2",null,"ranking"));
    var rk = totals(w), max = rk[0].t || 1;
    rk.forEach(function(r,i){
      var row = Kit.el("div"); row.style.cssText = "display:flex;align-items:center;gap:10px;margin:6px 0";
      row.appendChild(Kit.el("b",null,(i+1) + ". " + r.o.name)).style.cssText = "flex:0 0 200px;color:" + (i === 0 ? "var(--good)" : "var(--ink)");
      var bar = Kit.el("div"); bar.style.cssText = "height:10px;border-radius:5px;background:" +
        (i === 0 ? "var(--good)" : "var(--line)") + ";width:" + Math.round(r.t / max * 60) + "%";
      row.appendChild(bar);
      row.appendChild(Kit.el("span","sub",String(r.t)));
      board.appendChild(row);
    });
    var fl = sensitivity();
    board.appendChild(Kit.el("div","sub", fl.length
      ? "⚠ sensitive: re-weighting " + fl.join(" or ") + " can flip the winner"
      : "✓ robust: no single weight change flips the winner"));
    document.getElementById("kit-out").textContent = compile();
  }
  function compile(){
    var rk = totals(w), fl = sensitivity();
    var lines = ["Decision rationale — " + document.title, ""];
    lines.push("Winner: " + rk[0].o.name + " (score " + rk[0].t + ", runner-up " + rk[1].o.name + " at " + rk[1].t + ").");
    lines.push("Weights: " + CRITERIA.map(function(c){ return c.name + "=" + w[c.id]; }).join(", ") + ".");
    lines.push(fl.length ? "Sensitivity: re-weighting " + fl.join(" or ") + " can flip the winner."
                         : "Sensitivity: robust to any single weight change.");
    if (Kit.state["_notes"].note) lines.push("Notes: " + Kit.state["_notes"].note);
    return lines.join("\n");
  }
  Kit.init({compile: compile}); render();
});
```

- [ ] **Step 2: Lint** — Run: `node ~/dev/duet/templates/lint-templates.js` → Expected: `OK: 5 template(s) clean`.

- [ ] **Step 3: Render check** — `open ~/dev/duet/templates/decision-matrix.html`. Verify: sliders re-rank live (drag "Strategic fit" to 0 — ranking reorders), sensitivity line updates, compiled rationale names winner + weights, copy works.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/duet && git add templates/decision-matrix.html
git commit -m "templates: decision-matrix — weighted ranking with live sensitivity hint"
```

---

### Task 7: `doc-review.html`

**Files:**
- Create: `templates/doc-review.html` (start: `cp templates/_skeleton.html templates/doc-review.html`)

**Interfaces:**
- Consumes: `Kit.init/validate/stanceEl/el/state` (Task 2) — standard stances per section.

- [ ] **Step 1: Replace `<title>`, header, data blocks, domain body**

`<title>`: `Document review — section by section`. `<h1>`: `Document review`; `.sub`: `Read each section, mark keep / change / question, note specifics. The compiled review tracks your progress.`

Data blocks:

```js
/* ===== DATA BLOCKS (replace on instantiation) ===== */
// SECTIONS: the document, in order. bodyHTML is trusted instantiator-authored HTML
// (inline markup only — same self-containment rules as the template itself).
// [{id:"s1", title:"Problem", bodyHTML:"<p>...</p>"}]
const SECTIONS = [
  {id:"s1", title:"Problem",  bodyHTML:"<p>Example section body. Replace SECTIONS with the real document, one entry per section.</p>"},
  {id:"s2", title:"Proposal", bodyHTML:"<p>Second example section — <b>inline markup</b> is fine.</p>"},
  {id:"s3", title:"Risks",    bodyHTML:"<p>Third example section.</p>"}
];
/* ===== END DATA BLOCKS ===== */
```

Domain body:

```js
window.addEventListener("DOMContentLoaded", function(){
  if (!Kit.validate("SECTIONS", SECTIONS, ["id","title","bodyHTML"])) return;
  var app = document.getElementById("app");
  var prog = Kit.el("div","sub"); prog.style.cssText = "font:600 12px var(--mono);color:var(--teal)";
  app.appendChild(prog);
  SECTIONS.forEach(function(sec, i){
    var p = Kit.el("div","panel");
    p.appendChild(Kit.el("h2",null,(i+1) + ". " + sec.title));
    var body = Kit.el("div"); body.innerHTML = sec.bodyHTML; p.appendChild(body);
    p.appendChild(Kit.stanceEl(sec.id));
    app.appendChild(p);
  });
  function reviewed(state){
    return SECTIONS.filter(function(s){ var st = state[s.id]; return st && (st.stance || st.note); }).length;
  }
  function compile(state){
    var lines = ["Document review — " + document.title, ""];
    SECTIONS.forEach(function(s, i){
      var st = state[s.id]; if (!st || (!st.stance && !st.note)) return;
      lines.push("- §" + (i+1) + " " + s.title + " [" + (st.stance || "note") + "]" + (st.note ? ": " + st.note : ""));
    });
    lines.push("", reviewed(state) + "/" + SECTIONS.length + " sections reviewed");
    prog.textContent = reviewed(state) + "/" + SECTIONS.length + " sections reviewed";
    return lines.join("\n");
  }
  Kit.init({compile: compile});
});
```

- [ ] **Step 2: Lint** — Run: `node ~/dev/duet/templates/lint-templates.js` → Expected: `OK: 6 template(s) clean`.

- [ ] **Step 3: Render check** — `open ~/dev/duet/templates/doc-review.html`. Verify: three numbered sections, progress counter updates as stances land (`1/3 sections reviewed`…), compiled review lists §-references, copy works.

- [ ] **Step 4: Update the duet README catalog**

Append to `templates/README.md` `## Templates` section, one entry per new template (Tasks 4–7), following the existing `system-map-critique` entry format — for each: one-sentence description, **Data blocks to replace** line naming the exact consts, **Use for** line, **First used:** `2026-07-04, library v1`.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/duet && git add templates/doc-review.html templates/README.md
git commit -m "templates: doc-review — section-by-section critique; README catalog for v1 set"
```

---

### Task 8: Graduation — vault canonical home

**Files:**
- Create: `/Users/albertoduhau/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/` (folder + 6 `.html` + `README.md`)
- Modify: `~/dev/duet/templates/README.md` (canonical markers)

**Interfaces:**
- Produces: the vault path every skill points at:
  `03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/` with `README.md` as the library index.

- [ ] **Step 1: Copy the library to the vault**

```bash
V="/Users/albertoduhau/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES"
mkdir -p "$V"
cp ~/dev/duet/templates/_skeleton.html ~/dev/duet/templates/system-map-critique.html \
   ~/dev/duet/templates/ui-design-chooser.html ~/dev/duet/templates/sop-map-critique.html \
   ~/dev/duet/templates/decision-matrix.html ~/dev/duet/templates/doc-review.html "$V/"
```

- [ ] **Step 2: Write the vault `README.md`**

Create `"$V/README.md"` with: (a) the full `## Rules` section 1–7 copied from duet's `templates/README.md`; (b) the instantiation guide (`cp` + edit-only-data-blocks contract); (c) this catalog table:

```markdown
# HTML Template Library (canonical)

Canonical home of the reusable HTML template library. Born in duet (`~/dev/duet/templates/`,
the incubator — templates stabilize there, then graduate here). Post-graduation edits happen
HERE; the duet copy is a snapshot. Skills point only at this folder.

| Template | Task shape | Data blocks | First used / Last updated |
| --- | --- | --- | --- |
| `system-map-critique.html` | explain a system/plan/pipeline + harvest structured critique | `COMPONENTS`, `WIRES`, `FLOWS`, `PRIORITIES`/`PRESETS` | 2026-07-04 / 2026-07-04 |
| `ui-design-chooser.html` | choose between rendered visual design options | `OPTIONS` | 2026-07-04 / 2026-07-04 |
| `sop-map-critique.html` | review an existing SOP or design a new one (blank stances = design mode) | `ROLES`, `STEPS`, `HANDOFFS` | 2026-07-04 / 2026-07-04 |
| `decision-matrix.html` | options × weighted criteria decision | `OPTIONS`, `CRITERIA`, `SCORES` | 2026-07-04 / 2026-07-04 |
| `doc-review.html` | critique any document section-by-section (generic fallback) | `SECTIONS` | 2026-07-04 / 2026-07-04 |

`_skeleton.html` is not a deliverable template — it's where new templates start
(copy it, keep the CRITIQUE-KIT fences intact).

## Graduation ritual (duet → here)
1. Template stabilizes in `~/dev/duet/templates/` (lint green, README entry there).
2. Copy the file here; add its row to the table above.
3. Mark the duet README entry: `canonical: vault/HTML TEMPLATES/`.
4. From then on, edit here; re-copy to duet only if duet's own docs need the refresh.
```

- [ ] **Step 3: Mark duet entries as graduated**

In `~/dev/duet/templates/README.md`, add to each of the five template entries the line:
`- **Canonical:** vault \`03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/\` (graduated 2026-07-04; this copy is the incubator snapshot).`

- [ ] **Step 4: Verify the two copies match**

```bash
for f in _skeleton system-map-critique ui-design-chooser sop-map-critique decision-matrix doc-review; do
  diff -q ~/dev/duet/templates/$f.html "$V/$f.html" || echo "DRIFT: $f"; done
node ~/dev/duet/templates/lint-templates.js "$V"
```
Expected: no `DRIFT` lines; lint on the vault dir: `OK: 6 template(s) clean`.

- [ ] **Step 5: Commit (duet side only — vault has no git)**

```bash
cd ~/dev/duet && git add templates/README.md
git commit -m "templates: graduate v1 library to vault canonical home (duet = incubator)"
```

---

### Task 9: Router skill `html-template`

**Files:**
- Create: `<skills-dir>/html-template/SKILL.md` where `<skills-dir>` is resolved in Step 1.

**Interfaces:**
- Produces: `/html-template` — the canonical entry point other skills' pointers reference.

- [ ] **Step 1: Resolve the personal skills directory**

```bash
ls -la ~/.claude/skills | head -3   # if a symlink, follow it — skills live in the 05 AI repo
SKILLS_DIR=$(readlink ~/.claude/skills || echo ~/.claude/skills)
ls "$SKILLS_DIR" | head            # confirm sibling personal skills (generate-html, iterate-html…)
mkdir -p "$SKILLS_DIR/html-template"
```
If `05 AI/` conventions require skills on a session branch (capture-reconcile), create the file in the working tree normally — the session's infra-capture flow owns the push.

- [ ] **Step 2: Write `SKILL.md`**

```markdown
---
name: html-template
description: Pick and instantiate a reusable HTML template (system/architecture critique, UI design chooser, SOP map, decision matrix, doc review) instead of designing rich interactive HTML from scratch. Use whenever a task needs an interactive HTML deliverable whose shape matches the catalog — reviews, choices, process maps, structured feedback.
---

# HTML Template Library — router

Canonical library: `~/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/`
(read its `README.md` for rules + full instantiation guide; duet's `~/dev/duet/templates/` is the
incubator for templates still stabilizing).

## Pick by task shape

| You need to… | Instantiate |
| --- | --- |
| Explain a system/plan/pipeline and harvest structured critique | `system-map-critique.html` |
| Choose between visual design options (rendered mockups) | `ui-design-chooser.html` |
| Review an existing SOP or design a new one | `sop-map-critique.html` |
| Make a weighted multi-criteria decision | `decision-matrix.html` |
| Critique any document section by section (generic fallback) | `doc-review.html` |

Nothing fits → design from scratch (see /generate-html); if the result is general, graduate it
into the library per the README's graduation ritual.

## Instantiate

1. `cp` the template to the destination (`$DUET_CANVAS/…` in duet; anywhere otherwise).
2. Edit ONLY: `<title>`, the `<h1>`/header, and the marked `DATA BLOCKS` (const declarations
   with shape comments). Never touch layout or the `CRITIQUE-KIT` fences.
3. Verify: `node ~/dev/duet/templates/lint-templates.js <dir>` if available; otherwise open in a
   browser — a red banner means a malformed data block.
```

- [ ] **Step 3: Verify registration**

Run: `ls "$SKILLS_DIR/html-template/SKILL.md" && head -4 "$SKILLS_DIR/html-template/SKILL.md"`
Expected: file exists, frontmatter shows `name: html-template`. (New skills register on next session start; that's fine.)

---

### Task 10: Pointer wiring + repointing existing references

**Files:**
- Modify: `<skills-dir>/generate-html/SKILL.md`, `<skills-dir>/iterate-html/SKILL.md`
- Modify (only if personal, see Step 2): the `playground` skill
- Modify: `~/dev/duet/examples/claude-instructions.md`
- Modify (pre-authorized vault edit): `01 PROJECTS/Duet — Tiling Agent Terminal/Duet — Tiling Agent Terminal.md` AI Context rule #1
- Create: `~/.claude/projects/-Users-albertoduhau/memory/project_duet_html_template_library.md` (+ index line in `MEMORY.md`)

- [ ] **Step 1: Add the pointer line to generate-html and iterate-html**

Insert near the top of each SKILL.md body (after the frontmatter, before the first workflow step):

```markdown
> **Template library first:** before designing rich/interactive HTML from scratch, check the
> HTML template library (`/html-template`) — instantiate a template if one fits the task shape.
```

- [ ] **Step 2: Playground skill — personal vs plugin**

Run: `ls "$SKILLS_DIR" | grep -i playground; ls ~/.claude/plugins/cache 2>/dev/null | grep -i playground`
If a **personal** playground skill exists in `$SKILLS_DIR`, add the same pointer line. If playground only exists as a **plugin** (cache is read-only, overwritten on update): do NOT edit the cache — record in the final report: "playground is a plugin; add the pointer upstream in its repo" as a proposed follow-up.

- [ ] **Step 3: duet agent instructions**

In `~/dev/duet/examples/claude-instructions.md`, append:

```markdown
Before designing a rich/interactive card from scratch, check the HTML template library —
canonical: `~/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/`
(incubator: `templates/` in this repo). Instantiate per its README: copy the file, replace
only the marked DATA BLOCKS + title/header.
```

- [ ] **Step 4: Repoint the duet project brief (pre-authorized)**

In the brief (`01 PROJECTS/Duet — Tiling Agent Terminal/Duet — Tiling Agent Terminal.md`), AI Context rule #1 currently reads:

> 1. **Template library first:** before building any rich/interactive HTML for this project (or rendering into a duet canvas), check `~/dev/duet/templates/` and instantiate; contribute generalizable new designs back with a README entry.

Replace with:

> 1. **Template library first:** before building any rich/interactive HTML for this project (or rendering into a duet canvas), check the canonical library at `03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/` (vault) and instantiate; `~/dev/duet/templates/` is the incubator — new duet-born designs stabilize there, then graduate to the vault per its README ritual.

No other vault note edits — anything else discovered goes in the final report as a proposal.

- [ ] **Step 5: Memory file**

Create `~/.claude/projects/-Users-albertoduhau/memory/project_duet_html_template_library.md` (or update if present):

```markdown
---
name: project-duet-html-template-library
description: HTML template library — canonical home is the vault HTML TEMPLATES folder; duet templates/ is the incubator; /html-template routes
metadata:
  type: project
---

The reusable HTML template library (system-map-critique, ui-design-chooser, sop-map-critique,
decision-matrix, doc-review + _skeleton) is CANONICAL at
`03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/` in the vault (Obsidian-synced, no git).
`~/dev/duet/templates/` is the incubator: templates born in duet work stabilize there
(git-versioned, `lint-templates.js`), then graduate by copy + README rows both sides.
Route via the `/html-template` skill. Kit convention: shared machinery in CRITIQUE-KIT fences,
`emitToSession()` is the M3a hook slot (v1: always copy-fallback). Shipped 2026-07-04
([[project-duet-tiling-agent-terminal]]).
```

Add to `MEMORY.md` under Active Projects: `- [HTML template library — vault canonical, duet incubator, /html-template routes](project_duet_html_template_library.md)`.

- [ ] **Step 6: Commit duet-side changes**

```bash
cd ~/dev/duet && git add examples/claude-instructions.md
git commit -m "examples: point duet agents at the canonical HTML template library"
```

---

### Task 11: Acceptance — real-world instantiation dry-run + sandbox pass

**Files:**
- Create: `~/.duet/canvas/s1/sop-recepcion-leche.html` (instantiated on a duet canvas — disposable scratch, not a repo file)

- [ ] **Step 1: Instantiate `sop-map-critique` with a real Bufalinda SOP**

Read one real SOP from bufalinda-knowledge (read-only; locate via Glob `**/bufalinda-knowledge/CLAUDE.md`, then an SOP note under `02-AREAS/` — e.g. a fábrica reception/production process). Then:

```bash
cp "/Users/albertoduhau/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES/sop-map-critique.html" \
   ~/.duet/canvas/s1/sop-recepcion-leche.html
```
Edit ONLY `<title>`, `<h1>`, `.sub`, and the `ROLES`/`STEPS`/`HANDOFFS` data blocks with the real process (Spanish content in data blocks is fine — the chrome stays English).

- [ ] **Step 2: Verify the contract held**

```bash
diff <(sed -n '/CRITIQUE-KIT BEGIN/,/CRITIQUE-KIT END/p' ~/.duet/canvas/s1/sop-recepcion-leche.html) \
     <(sed -n '/CRITIQUE-KIT BEGIN/,/CRITIQUE-KIT END/p' ~/dev/duet/templates/sop-map-critique.html) \
  && echo "KIT UNTOUCHED"
```
Expected: `KIT UNTOUCHED`. If the instantiation needed edits outside title/header/data blocks, that is a template bug — fix the template (both copies + lint), not the instance.

- [ ] **Step 3: Render in duet (sandbox) if the server is up, else browser**

duet up (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7433` → `200`): the card appears on canvas `s1`; verify it renders and stances/copy work in the sandboxed pane. Otherwise: `open ~/.duet/canvas/s1/sop-recepcion-leche.html` and verify the same.

- [ ] **Step 4: Sandbox pass — every template renders in a duet card**

With duet up, copy all six library files to a scratch canvas and check each in a render pane
(spec verification #1–2: sandboxed render + copy button under sandbox):

```bash
mkdir -p ~/.duet/canvas/tpl-check
cp ~/dev/duet/templates/*.html ~/.duet/canvas/tpl-check/
```
Open duet, point a render pane at session `tpl-check`, and for each card verify: renders
without a red banner, stances/interactions work, copy button reports `copied ✓` (or the ⌘C
fallback). Then clean up: `rm -rf ~/.duet/canvas/tpl-check`. If duet cannot run in this
environment, do the same via `open` on each file and note the sandbox pass as pending in the
final report.

- [ ] **Step 5: Final library-wide checks**

```bash
node ~/dev/duet/templates/lint-templates.js
node ~/dev/duet/templates/lint-templates.js "/Users/albertoduhau/Documents/Obsidian Vault/03 REFERENCE/CHECKLISTS & TEMPLATES/HTML TEMPLATES"
```
Expected: both `OK: 6 template(s) clean`.

- [ ] **Step 6: Commit anything outstanding + report**

```bash
cd ~/dev/duet && git status --short   # expect clean; commit stragglers if any
```
Final report must include: per-template verification results, the playground-plugin pointer follow-up if it applied (Task 10 Step 2), and any proposed-not-applied vault edits.
